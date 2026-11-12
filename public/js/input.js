// Keyboard (two layouts) + up to four gamepads.
const DEFAULTS = {
  k0: { l: 'KeyA', r: 'KeyD', u: 'KeyW', d: 'KeyS', hop: 'Space', trick: 'ShiftLeft', kl: 'KeyQ', kr: 'KeyE', item: 'KeyF', boost: 'KeyX' },
  k1: { l: 'ArrowLeft', r: 'ArrowRight', u: 'ArrowUp', d: 'ArrowDown', hop: 'Slash', trick: 'ShiftRight', kl: 'Comma', kr: 'Period', item: 'Enter', boost: 'KeyN' },
  pad: { pa: 7, pb: 6, hop: 0, trick: 2, kl: 4, kr: 5, item: 1, boost: 3 },
};
export const ACTIONS = [['u', 'Pedal / front flip', 'pa'], ['d', 'Brake / back flip', 'pb'], ['l', 'Steer left'], ['r', 'Steer right'], ['hop', 'Bunny hop', 'hop'], ['trick', 'Trick button', 'trick'], ['kl', 'Kick left / Superman', 'kl'], ['kr', 'Kick right / Tabletop', 'kr'], ['item', 'Use / throw power-up', 'item'], ['boost', 'Burn boost bar', 'boost']];
export const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-Up', 'D-Down', 'D-Left', 'D-Right', 'Home'];
const clone = (o) => JSON.parse(JSON.stringify(o));
export let binds = clone(DEFAULTS);
try { const sv = JSON.parse(localStorage.getItem('rr_binds')); if (sv && sv.k0 && sv.k1 && sv.pad) binds = { k0: { ...DEFAULTS.k0, ...sv.k0 }, k1: { ...DEFAULTS.k1, ...sv.k1 }, pad: { ...DEFAULTS.pad, ...sv.pad } }; } catch {}
export const saveBinds = () => { try { localStorage.setItem('rr_binds', JSON.stringify(binds)); } catch {} };
export const resetBinds = () => { binds = clone(DEFAULTS); saveBinds(); };
const KB = { get 0() { return binds.k0; }, get 1() { return binds.k1; } };
const GAME_KEYS = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Slash']);

export const DEVICES = [
  { id: 'k0', name: 'Keyboard WASD' }, { id: 'k1', name: 'Keyboard Arrows' },
  { id: 'g0', name: 'Gamepad 1' }, { id: 'g1', name: 'Gamepad 2' }, { id: 'g2', name: 'Gamepad 3' }, { id: 'g3', name: 'Gamepad 4' },
];

export class Input {
  constructor() {
    this.keys = new Set(); this.capture = false; this.state = new Map();
    addEventListener('keydown', (e) => { this.keys.add(e.code); if (this.capture && GAME_KEYS.has(e.code)) e.preventDefault(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  pads() { return (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter(Boolean); }

  // devs: list of device ids feeding this player, e.g. ['k0','k1','g0'] for solo
  read(slot, devs, dt) {
    let st = this.state.get(slot);
    if (!st) this.state.set(slot, (st = { steer: 0, prev: {}, out: { steer: 0 } }));
    const K = this.keys, raw = { l: 0, r: 0, ku: false, kd: false, pa: false, pb: false, su: false, sd: false, hop: false, trick: false, kl: false, kr: false, item: false, ax: 0 };
    for (const dv of devs) {
      if (dv[0] === 'k') {
        const m = KB[+dv[1]];
        if (K.has(m.l)) raw.l = 1; if (K.has(m.r)) raw.r = 1;
        raw.ku ||= K.has(m.u); raw.kd ||= K.has(m.d); raw.hop ||= K.has(m.hop); raw.trick ||= K.has(m.trick);
        raw.kl ||= K.has(m.kl); raw.kr ||= K.has(m.kr); raw.item ||= K.has(m.item); raw.boost ||= K.has(m.boost);
      } else {
        const p = this.pads()[+dv[1]]; if (!p) continue;
        const b = (i) => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.4));
        const ax = Math.abs(p.axes[0]) > 0.15 ? p.axes[0] : 0; if (Math.abs(ax) > Math.abs(raw.ax)) raw.ax = ax;
        if (b(14)) raw.l = 1; if (b(15)) raw.r = 1;
        // triggers pedal / brake, left stick or d-pad up/down flips
        const P = binds.pad; raw.pa ||= b(P.pa); raw.pb ||= b(P.pb);
        raw.su ||= p.axes[1] < -0.6 || b(12); raw.sd ||= p.axes[1] > 0.6 || b(13);
        raw.hop ||= b(P.hop); raw.trick ||= b(P.trick); raw.kl ||= b(P.kl); raw.kr ||= b(P.kr); raw.item ||= b(P.item); raw.boost ||= b(P.boost);
      }
    }
    const tgt = raw.ax || raw.r - raw.l;
    st.steer += (tgt - st.steer) * Math.min(1, dt * (tgt === 0 ? 12 : 8));
    const o = st.out, pv = st.prev;
    o.steer = raw.ax ? raw.ax : st.steer;
    o.accel = raw.ku || raw.pa; o.brake = raw.kd || raw.pb;
    o.up = raw.ku || raw.su; o.down = raw.kd || raw.sd;
    o.boost = !!raw.boost; o.trick = raw.trick; o.klHeld = raw.kl; o.krHeld = raw.kr;
    o.hop = raw.hop && !pv.hop; o.kl = raw.kl && !pv.kl; o.kr = raw.kr && !pv.kr; o.item = raw.item && !pv.item;
    pv.hop = raw.hop; pv.kl = raw.kl; pv.kr = raw.kr; pv.item = raw.item;
    return o;
  }
  reset() { this.state.clear(); }
  rumble(devs, strong = 0.8, ms = 260) {
    for (const dv of devs) if (dv[0] === 'g') { const p = this.pads()[+dv[1]]; try { p && p.vibrationActuator && p.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: strong * 0.6 }); } catch {} }
  }
  // first gamepad button currently held (for rebinding), or -1
  padButton() { for (const p of this.pads()) for (let i = 0; i < p.buttons.length; i++) if (p.buttons[i].pressed) return i; return -1; }
  // edge-triggered menu navigation from any gamepad
  menuPoll() {
    const m = (this._menu ||= {}), now = { up: false, down: false, left: false, right: false, ok: false, back: false, start: false, zoom: false };
    for (const p of this.pads()) {
      const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      now.up ||= b(12) || p.axes[1] < -0.6; now.down ||= b(13) || p.axes[1] > 0.6; now.left ||= b(14) || p.axes[0] < -0.6; now.right ||= b(15) || p.axes[0] > 0.6;
      now.ok ||= b(0); now.back ||= b(1); now.start ||= b(9); now.zoom ||= b(11);
    }
    const out = {}; for (const k in now) { out[k] = now[k] && !m[k]; m[k] = now[k]; }
    return out;
  }
}

// Thin WebSocket wrapper for the room server.
export class Net {
  constructor() { this.ws = null; this.id = null; this.on = {}; this.open = false; }
  connect(profile) {
    return new Promise((res, rej) => {
      if (this.open) { this.send({ t: 'hello', ...profile }); return res(); }
      let done = false;
      try { const base = window.RR_SERVER ? window.RR_SERVER.replace(/^http/, 'ws').replace(/\/$/, '') : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host; this.ws = new WebSocket(base + '/ws'); } catch (e) { return rej(e); }
      const fail = () => { if (!done) { done = true; rej(new Error('offline')); } };
      this.ws.onopen = () => { this.open = true; this.send({ t: 'hello', ...profile }); clearInterval(this.ka); this.ka = setInterval(() => this.send({ t: 'ping' }), 20000); };
      this.ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'hello') { this.id = m.id; if (!done) { done = true; res(); } return; }
        const h = this.on[m.t]; if (h) h(m);
      };
      this.ws.onerror = fail;
      this.ws.onclose = () => { const was = this.open; this.open = false; this.ws = null; fail(); if (was && this.on.close) this.on.close(); };
      setTimeout(fail, 6000);
    });
  }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close() { if (this.ws) { this.open = false; this.ws.onclose = null; this.ws.close(); this.ws = null; } }
}
