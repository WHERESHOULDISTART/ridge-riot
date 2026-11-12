#!/usr/bin/env python3
"""RIDGE RIOT game server.

Zero-dependency (Python 3.9+ standard library only):
  * serves the game from ./public
  * WebSocket rooms: quick match + private invite rooms, state relay
  * solo leaderboard API, persisted to ./data/leaderboard.json

Run:  python3 server.py            (then open http://localhost:3000)
      PORT=8080 python3 server.py
"""
import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import random
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUB = ROOT / "public"
DATA = ROOT / "data"
LB_FILE = DATA / "leaderboard.json"
PORT = int(os.environ.get("PORT", "3000"))
NUM_LEVELS = 12
MAX_ROOM = 8
QUICK_WAIT = 12.0  # seconds a quick-match room waits for more riders
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

# ----------------------------------------------------------------- leaderboard
def load_lb():
    try:
        return json.loads(LB_FILE.read_text())
    except Exception:
        return {}


LB = load_lb()


def save_lb():
    DATA.mkdir(exist_ok=True)
    tmp = LB_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(LB))
    tmp.replace(LB_FILE)


def clean_name(n):
    n = re.sub(r"[^\w \-\.!]", "", str(n or ""), flags=re.UNICODE).strip()[:14]
    return n or "Rider"


def lb_get(level):
    return LB.get(str(level), [])[:50]


def lb_add(entry):
    level = int(entry.get("level", -1))
    t = float(entry.get("time", 0))
    if not (0 <= level < NUM_LEVELS) or not (25.0 <= t <= 3600.0):
        return None
    name = clean_name(entry.get("name"))
    rows = LB.setdefault(str(level), [])
    row = {
        "name": name,
        "time": round(t, 2),
        "bike": int(entry.get("bike", 0)) % 6,
        "score": max(0, min(int(entry.get("score", 0)), 9999999)),
        "date": time.strftime("%Y-%m-%d"),
    }
    old = next((r for r in rows if r["name"].lower() == name.lower()), None)
    if old:
        if row["time"] < old["time"]:
            rows.remove(old)
            rows.append(row)
    else:
        rows.append(row)
    rows.sort(key=lambda r: r["time"])
    del rows[100:]
    save_lb()
    rank = next((i for i, r in enumerate(rows) if r["name"].lower() == name.lower()), -1)
    return {"rank": rank + 1, "rows": rows[:50]}


# ----------------------------------------------------------------------- rooms
class Client:
    _n = 0

    def __init__(self, writer):
        Client._n += 1
        self.id = "p%d" % Client._n
        self.w = writer
        self.name = "Rider"
        self.bike = 0
        self.color = 0
        self.room = None
        self.alive = True

    def send(self, obj):
        if not self.alive:
            return
        try:
            self.w.write(ws_frame(json.dumps(obj, separators=(",", ":")).encode()))
        except Exception:
            self.alive = False

    def send_raw(self, frame):
        if not self.alive:
            return
        try:
            # drop realtime packets for clients that cannot keep up
            if self.w.transport.get_write_buffer_size() < 262144:
                self.w.write(frame)
        except Exception:
            self.alive = False


class Room:
    def __init__(self, code, private):
        self.code = code
        self.private = private
        self.clients = []
        self.host = None
        self.state = "lobby"
        self.level = 0
        self.start_at = None
        self.task = None

    def info(self):
        left = None
        if self.start_at is not None:
            left = max(0.0, round(self.start_at - time.time(), 1))
        return {
            "t": "room",
            "code": self.code,
            "private": self.private,
            "host": self.host.id if self.host else None,
            "state": self.state,
            "level": self.level,
            "countdown": left,
            "players": [
                {"id": c.id, "name": c.name, "bike": c.bike, "color": c.color}
                for c in self.clients
            ],
        }

    def broadcast(self, obj, skip=None):
        frame = ws_frame(json.dumps(obj, separators=(",", ":")).encode())
        for c in self.clients:
            if c is not skip:
                c.send_raw(frame) if obj.get("t") in ("s", "ai") else c.send(obj)

    def start(self):
        if self.state != "lobby" or not self.clients:
            return
        self.state = "racing"
        self.start_at = None
        if not self.private:
            self.level = random.randrange(NUM_LEVELS)
        self.broadcast(
            {
                "t": "start",
                "level": self.level,
                "seed": random.randrange(1 << 30),
                "host": self.host.id,
                "roster": [
                    {"id": c.id, "name": c.name, "bike": c.bike, "color": c.color}
                    for c in self.clients
                ],
            }
        )


ROOMS = {}


def new_code():
    while True:
        code = "".join(random.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(5))
        if code not in ROOMS:
            return code


def join_room(c, room):
    leave_room(c)
    room.clients.append(c)
    c.room = room
    if room.host is None:
        room.host = c
    room.broadcast(room.info())


def leave_room(c):
    room = c.room
    if not room:
        return
    c.room = None
    if c in room.clients:
        room.clients.remove(c)
    if not room.clients:
        if room.task:
            room.task.cancel()
        ROOMS.pop(room.code, None)
        return
    if room.host is c:
        room.host = room.clients[0]
    room.broadcast({"t": "left", "id": c.id})
    room.broadcast(room.info())


async def quick_timer(room):
    try:
        while room.start_at and time.time() < room.start_at:
            await asyncio.sleep(0.25)
        room.start()
    except asyncio.CancelledError:
        pass


def handle_msg(c, m):
    t = m.get("t")
    room = c.room
    if t in ("s", "ai", "ev"):
        if room and room.state == "racing":
            m["id"] = c.id
            room.broadcast(m, skip=c)
        return
    if t == "hello":
        c.name = clean_name(m.get("name"))
        c.bike = int(m.get("bike", 0)) % 6
        c.color = int(m.get("color", 0)) % 8
        c.send({"t": "hello", "id": c.id})
    elif t == "quick":
        room = next(
            (r for r in ROOMS.values()
             if not r.private and r.state == "lobby" and len(r.clients) < MAX_ROOM),
            None,
        )
        if room is None:
            room = Room(new_code(), False)
            ROOMS[room.code] = room
            room.start_at = time.time() + QUICK_WAIT
            room.task = asyncio.ensure_future(quick_timer(room))
        elif room.start_at:
            # give the newcomer a moment, never extend beyond the original wait
            room.start_at = max(room.start_at, time.time() + 4.0)
        join_room(c, room)
    elif t == "create":
        room = Room(new_code(), True)
        room.level = int(m.get("level", 0)) % NUM_LEVELS
        ROOMS[room.code] = room
        join_room(c, room)
    elif t == "join":
        code = str(m.get("code", "")).upper().strip()
        room = ROOMS.get(code)
        if not room or not room.private:
            c.send({"t": "err", "msg": "Room not found. Check the code."})
        elif len(room.clients) >= MAX_ROOM:
            c.send({"t": "err", "msg": "That room is full."})
        elif room.state != "lobby":
            c.send({"t": "err", "msg": "Race in progress - try again in a minute."})
        else:
            join_room(c, room)
    elif t == "set" and room:
        c.bike = int(m.get("bike", c.bike)) % 6
        c.color = int(m.get("color", c.color)) % 8
        room.broadcast(room.info())
    elif t == "level" and room and room.host is c and room.private:
        room.level = int(m.get("level", 0)) % NUM_LEVELS
        room.broadcast(room.info())
    elif t == "start" and room and room.host is c:
        room.start()
    elif t == "lobby" and room and room.private:
        if room.state != "lobby":
            room.state = "lobby"
        room.broadcast(room.info())
    elif t == "leave":
        leave_room(c)
    elif t == "ping":
        c.send({"t": "pong", "ts": m.get("ts")})


# ------------------------------------------------------------------ websockets
def ws_frame(payload, opcode=1):
    n = len(payload)
    head = bytes([0x80 | opcode])
    if n < 126:
        head += bytes([n])
    elif n < 65536:
        head += bytes([126]) + n.to_bytes(2, "big")
    else:
        head += bytes([127]) + n.to_bytes(8, "big")
    return head + payload


def unmask(data, key):
    n = len(data)
    if not n:
        return b""
    mask = (key * (n // 4 + 1))[:n]
    return (int.from_bytes(data, "big") ^ int.from_bytes(mask, "big")).to_bytes(n, "big")


async def ws_loop(reader, writer):
    c = Client(writer)
    buf = b""
    try:
        while True:
            h = await reader.readexactly(2)
            fin, opcode = h[0] & 0x80, h[0] & 0x0F
            masked, n = h[1] & 0x80, h[1] & 0x7F
            if n == 126:
                n = int.from_bytes(await reader.readexactly(2), "big")
            elif n == 127:
                n = int.from_bytes(await reader.readexactly(8), "big")
            if n > 65536:
                break
            key = await reader.readexactly(4) if masked else None
            data = await reader.readexactly(n)
            if key:
                data = unmask(data, key)
            if opcode == 8:
                break
            if opcode == 9:
                writer.write(ws_frame(data, 10))
                continue
            if opcode == 10:
                continue
            buf += data
            if not fin:
                if len(buf) > 65536:
                    break
                continue
            msg, buf = buf, b""
            try:
                m = json.loads(msg)
                if isinstance(m, dict):
                    handle_msg(c, m)
            except (ValueError, TypeError, KeyError):
                pass
            if not c.alive:
                break
    except (asyncio.IncompleteReadError, ConnectionError, OSError):
        pass
    finally:
        c.alive = False
        leave_room(c)
        try:
            writer.close()
        except Exception:
            pass


# ------------------------------------------------------------------------ http
def http_resp(writer, status, body, ctype="text/plain; charset=utf-8", extra=""):
    if isinstance(body, str):
        body = body.encode()
    writer.write(
        (
            "HTTP/1.1 %s\r\nContent-Type: %s\r\nContent-Length: %d\r\n"
            "Cache-Control: no-cache\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n"
            "Access-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\n%s\r\n"
            % (status, ctype, len(body), extra)
        ).encode()
        + body
    )


async def handle(reader, writer):
    try:
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 15)
    except Exception:
        writer.close()
        return
    try:
        lines = head.decode("latin1").split("\r\n")
        method, target, _ = lines[0].split(" ", 2)
        headers = {}
        for ln in lines[1:]:
            if ":" in ln:
                k, v = ln.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        path = target.split("?", 1)[0]
        query = target.split("?", 1)[1] if "?" in target else ""

        if headers.get("upgrade", "").lower() == "websocket":
            key = headers.get("sec-websocket-key", "")
            acc = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
            writer.write(
                (
                    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                    "Connection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n" % acc
                ).encode()
            )
            await ws_loop(reader, writer)
            return

        if path == "/api/leaderboard" and method == "GET":
            mm = re.search(r"level=(\d+)", query)
            level = int(mm.group(1)) if mm else 0
            http_resp(writer, "200 OK", json.dumps({"rows": lb_get(level)}), "application/json")
        elif path == "/api/score" and method == "POST":
            n = min(int(headers.get("content-length", "0")), 4096)
            body = await asyncio.wait_for(reader.readexactly(n), 10)
            try:
                res = lb_add(json.loads(body))
            except Exception:
                res = None
            if res is None:
                http_resp(writer, "400 Bad Request", '{"error":"bad score"}', "application/json")
            else:
                http_resp(writer, "200 OK", json.dumps(res), "application/json")
        elif method == "OPTIONS":
            http_resp(writer, "204 No Content", "")
        elif method in ("GET", "HEAD"):
            rel = "index.html" if path == "/" else path.lstrip("/")
            f = (PUB / rel).resolve()
            if PUB not in f.parents or not f.is_file():
                http_resp(writer, "404 Not Found", "Not found")
            else:
                ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
                if ctype.startswith("text/") or ctype == "application/javascript":
                    ctype += "; charset=utf-8"
                http_resp(writer, "200 OK", f.read_bytes(), ctype)
        else:
            http_resp(writer, "405 Method Not Allowed", "Nope")
        await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def main():
    server = await asyncio.start_server(handle, "0.0.0.0", PORT)
    print("RIDGE RIOT running  ->  http://localhost:%d" % PORT)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
