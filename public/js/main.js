// App shell: menus, bike showroom, lobby, leaderboard, results and the main loop.
import * as THREE from 'three';
import { LEVELS, BIKES, COLORS, ITEMS } from './levels.js';
import { AudioSys } from './audio.js';
import { Input, Net, DEVICES, ACTIONS, PAD_NAMES, binds, saveBinds, resetBinds } from './input.js';
import { Game } from './game.js';
import { buildBike, poseBike } from './rider.js';
import { fmtTime, ordinal, esc } from './util.js';
import { loadAssets, levelTex } from './assets.js';

const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const hexCss = (h) => '#' + h.toString(16).padStart(6, '0');
const FLAGS = ['🇮🇳', '🇺🇸', '🇮🇹', '🇨🇱', '🇯🇵', '🇹🇿', '🇮🇸', '🇲🇦', '🇨🇦', '🇧🇷', '🇳🇿', '🇨🇭'];
const API = (window.RR_SERVER || '').replace(/\/$/, '');

const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
const audio = new AudioSys(), input = new Input(), net = new Net();
const app = { renderer, audio, input, net, hudRoot: $('#hud'), onRaceOver, zoom: +(localStorage.getItem('rr_zoom') || 0) % 3 };
let game = null, lastCfg = null, room = null, flow = { mode: 'solo', level: 0 }, resTimer = 0, lobbyTimer = 0;

// ------------------------------------------------------------------ profile
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const profile = store.get('rr_profile', { name: '', bike: 0, color: 0 });
const saveProfile = () => store.set('rr_profile', profile);
const opts = { music: 0.7, sfx: 0.9, retro: false, rumble: true, ...store.get('rr_opts', {}) };
function applyOpts() {
  store.set('rr_opts', opts); audio.setVolumes({ music: opts.music, sfx: opts.sfx }); input.rumbleOn = opts.rumble;
  // "PS2 resolution": render at roughly 480 lines and let the browser scale it up
  renderer.setPixelRatio(opts.retro ? Math.min(1, 480 / innerHeight) : Math.min(devicePixelRatio || 1, 2)); renderer.setSize(innerWidth, innerHeight);
}
let listen = null; // { dev, act, el } while waiting for a new key / pad button
const keyName = (c) => c.replace(/^Key|^Digit/, '').replace('Arrow', '').replace('Left', ' L').replace('Right', ' R').trim() || c;
function renderOpts() {
  $('#opt-music').value = opts.music * 100; $('#opt-sfx').value = opts.sfx * 100;
  $('#opt-retro').textContent = 'PS2 RETRO RESOLUTION: ' + (opts.retro ? 'ON' : 'OFF'); $('#opt-retro').classList.toggle('on', opts.retro);
  $('#opt-rumble').textContent = 'CONTROLLER VIBRATION: ' + (opts.rumble ? 'ON' : 'OFF'); $('#opt-rumble').classList.toggle('on', opts.rumble);
  $('#bind-table').innerHTML = '<span class="hd">ACTION</span><span class="hd">KEYBOARD 1</span><span class="hd">KEYBOARD 2</span><span class="hd">GAMEPAD</span>' + ACTIONS.map(([k, label, pk]) =>
    `<span>${label}</span><button data-bind="k0:${k}">${keyName(binds.k0[k])}</button><button data-bind="k1:${k}">${keyName(binds.k1[k])}</button>` +
    (pk ? `<button data-bind="pad:${pk}">${PAD_NAMES[binds.pad[pk]] ?? 'Btn ' + binds.pad[pk]}</button>` : `<span class="na">${k === 'l' || k === 'r' ? 'Left stick' : ''}</span>`)).join('');
  renderPads();
}
function renderPads() {
  const pads = input.pads();
  $('#pad-list').innerHTML = pads.length ? pads.map((p, i) => `<div>GAMEPAD ${i + 1} — ${esc(p.id.slice(0, 44))}</div>`).join('') : '<div class="none">No controller detected yet. Press a button on it.</div>';
}
function setBind(dev, act, val) { binds[dev][act] = val; saveBinds(); listen = null; renderOpts(); audio.play('ready'); }
const split = store.get('rr_split', { n: 2, p: [{ bike: 0, color: 0, dev: 'k0' }, { bike: 2, color: 1, dev: 'k1' }, { bike: 4, color: 2, dev: 'g0' }, { bike: 5, color: 3, dev: 'g1' }] });
let pendingCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

// ------------------------------------------------------------------ showroom (menu backdrop)
const show = (() => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2a1a3a, 40, 170);
  scene.add(new THREE.HemisphereLight(0xffd8b0, 0x30284a, 2.2));
  const d = new THREE.DirectionalLight(0xffe2c0, 2.6); d.position.set(-3, 5, 4); scene.add(d);
  const c = document.createElement('canvas'); c.width = 16; c.height = 256; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  [[0, '#070a1c'], [0.3, '#1c1f5a'], [0.44, '#a03a6a'], [0.5, '#ff8a3a'], [0.53, '#ffd27a'], [0.56, '#2a1a3a'], [1, '#2a1a3a']].forEach(([t, col]) => gr.addColorStop(t, col));
  g.fillStyle = gr; g.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(400, 16, 12), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })));
  const flat = (col) => new THREE.MeshLambertMaterial({ color: col, flatShading: true });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(300, 24).rotateX(-Math.PI / 2), flat(0x2a2038)); scene.add(ground);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.sin(i * 7) * 0.1, r = 70 + ((i * 37) % 60), h = 26 + ((i * 53) % 44);
    const m = new THREE.Mesh(new THREE.ConeGeometry(h * 0.75, h, 6), flat(i % 2 ? 0x4a3a6a : 0x5a3a5a)); m.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r); m.rotation.y = i; scene.add(m);
    const s = new THREE.Mesh(new THREE.ConeGeometry(h * 0.26, h * 0.34, 6), flat(0xfff0e6)); s.position.set(m.position.x, h - h * 0.17 - 0.8, m.position.z); s.rotation.y = i; scene.add(s);
  }
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 3.0, 0.35, 20), flat(0x1a1c26)); plat.position.y = 0.175; scene.add(plat);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.72, 0.07, 6, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff7a00 })); ring.position.y = 0.36; scene.add(ring);
  const cam = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 900);
  const pivot = new THREE.Group(); pivot.position.y = 0.35; scene.add(pivot);
  let model = null, key = '';
  return {
    scene, cam, pivot, t: 0,
    setBike(b, col) {
      if (key === b + '|' + col) return; key = b + '|' + col;
      if (model) { pivot.remove(model.root); model.root.traverse((o) => o.geometry && o.geometry.dispose()); }
      model = buildBike(b, col); model.root.scale.setScalar(1.45); pivot.add(model.root);
    },
    render(dt) {
      this.t += dt; pivot.rotation.y = this.t * 0.7;
      if (model) { model.wF.rotation.x = model.wR.rotation.x = this.t * 4; poseBike(model, { crankA: this.t * 3, stand: 0, sup: 0, noh: 0, kickL: 0, kickR: 0, throwK: 0, steer: Math.sin(this.t) * 0.3, land: 0 }); }
      const wide = innerWidth > innerHeight * 1.15;
      cam.position.set(wide ? -0.6 : 0, 2.4, wide ? 8.2 : 11); cam.lookAt(wide ? -2.3 : 0, wide ? 1.3 : 2.6, 0);
      renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight); renderer.render(scene, cam);
    },
  };
})();
show.setBike(profile.bike, profile.color);

// ------------------------------------------------------------------ screen manager
let cur = null; const stack = [];
function showScr(id, push = true) {
  if (cur && push && cur !== 'wait') stack.push(cur);
  $$('.screen').forEach((s) => s.classList.remove('active'));
  cur = id;
  if (!id) { document.activeElement && document.activeElement.blur(); return; }
  const el = $('#scr-' + id); el.classList.add('active');
  const f = el.querySelector('input, .btn:not(.back):not(:disabled), .lvl'); if (f) f.focus({ preventScroll: true });
  if (id === 'lb') renderLB(flow.level || 0);
}
function back() { audio.play('back'); showScr(stack.pop() || 'main', false); }
let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); audio.play('error'); }

// ------------------------------------------------------------------ static UI
$('#levels').innerHTML = LEVELS.map((l, i) => `<button class="lvl" data-level="${i}" style="background:url(assets/sky/${l.sky.img}.jpg) center 38%/420% auto">
    <span class="num">${i + 1}</span><span class="flag">${FLAGS[i]}</span>
    <span class="n">${l.name}</span><span class="p">${l.place} · ${l.kind}</span><span class="d">${(l.length / 1000).toFixed(1)} km · ${'★'.repeat(l.stars)}${'☆'.repeat(3 - l.stars)}</span></button>`).join('');
$('#help-items').innerHTML = Object.values(ITEMS).map((it) => `<li><span>${it.icon}</span><b>${it.name}</b> — ${it.tip}</li>`).join('');
$('#swatches').innerHTML = COLORS.map((c, i) => `<button class="sw" data-color="${i}" title="${c.name}" style="background:linear-gradient(135deg, ${hexCss(c.a)} 62%, ${hexCss(c.b)} 62%)"></button>`).join('');
$('#lb-tabs').innerHTML = LEVELS.map((l, i) => `<button class="tab" data-lb="${i}">${i + 1}. ${l.name}</button>`).join('');

function renderBike() {
  const b = BIKES[profile.bike];
  $('#bike-name').textContent = b.name; $('#bike-tag').textContent = b.tag;
  const st = [['SPEED', (b.top - 27) / 5.5], ['ACCEL', (b.accel - 3) / 4], ['HANDLING', (b.handling - 1.6) / 1.9], ['AIR TRICKS', (b.air - 0.6) / 0.9], ['TOUGHNESS', (b.tough - 0.5) / 1.2]];
  $('#bike-stats').innerHTML = st.map(([n, v]) => `<div class="stat"><span>${n}</span><div><i style="width:${Math.round(Math.min(1, Math.max(0.08, v)) * 100)}%"></i></div></div>`).join('');
  $$('.sw').forEach((s, i) => s.classList.toggle('on', i === profile.color));
  show.setBike(profile.bike, profile.color);
}
function renderSplit() {
  $$('#scr-split .chip').forEach((c) => c.classList.toggle('on', +c.dataset.n === split.n));
  const pick = (i, k, label) => `<div class="pick"><button data-p="${i}" data-k="${k}" data-d="-1">◀</button><span>${label}</span><button data-p="${i}" data-k="${k}" data-d="1">▶</button></div>`;
  $('#split-rows').innerHTML = split.p.slice(0, split.n).map((p, i) => `<div class="prow"><div class="pn" style="color:${hexCss(COLORS[p.color].a)}">P${i + 1}</div>
    ${pick(i, 'bike', BIKES[p.bike].name)}${pick(i, 'color', COLORS[p.color].name)}${pick(i, 'dev', DEVICES.find((d) => d.id === p.dev).name)}</div>`).join('');
  store.set('rr_split', split);
}

// ------------------------------------------------------------------ leaderboard
const lbLocal = () => store.get('rr_lb', {});
async function lbFetch(level) {
  try { const r = await fetch(API + '/api/leaderboard?level=' + level); if (!r.ok) throw 0; return { rows: (await r.json()).rows }; }
  catch { return { rows: lbLocal()[level] || [], local: true }; }
}
async function lbSubmit(entry) {
  try {
    const r = await fetch(API + '/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) });
    if (!r.ok) throw 0; return await r.json();
  } catch {
    const all = lbLocal(), rows = (all[entry.level] ||= []);
    const old = rows.find((x) => x.name === entry.name);
    if (!old) rows.push({ ...entry, date: new Date().toISOString().slice(0, 10) }); else if (entry.time < old.time) Object.assign(old, entry);
    rows.sort((a, b) => a.time - b.time); store.set('rr_lb', all);
    return { rank: rows.findIndex((x) => x.name === entry.name) + 1, rows, local: true };
  }
}
function lbRows(rows, me) {
  if (!rows.length) return '<div class="empty">No times yet. Be the first on the board!</div>';
  return '<div class="tr h"><span>POS</span><span>RIDER</span><span>TIME</span><span>BIKE</span><span>DATE</span></div>' + rows.slice(0, 20).map((r, i) =>
    `<div class="tr${me && r.name.toLowerCase() === me.toLowerCase() ? ' me' : ''}"><span class="pos">${i + 1}</span><span>${esc(r.name)}</span><span class="t">${fmtTime(r.time)}</span><span>${BIKES[r.bike % 6].name}</span><span>${esc(r.date || '')}</span></div>`).join('');
}
async function renderLB(level) {
  flow.lb = level; $$('.tab').forEach((t, i) => t.classList.toggle('on', i === level));
  $('#lb-table').innerHTML = '<div class="empty">Loading…</div>';
  const res = await lbFetch(level); if (flow.lb !== level) return;
  $('#lb-table').innerHTML = lbRows(res.rows, profile.name) + (res.local ? '<p class="hint">Server offline — showing times saved on this device.</p>' : '');
}

// ------------------------------------------------------------------ racing
function disposeGame() {
  clearInterval(resTimer);
  if (game) { game.dispose(); game = null; }
  app.hudRoot.style.display = '';
  document.body.classList.remove('racing');
}
async function startRace(cfg) {
  disposeGame(); lastCfg = cfg; stack.length = 0;
  $('#wait-text').textContent = 'LOADING…'; showScr('wait', false);
  try { await loadAssets(levelTex(LEVELS[cfg.level]), LEVELS[cfg.level].sky.img); } catch (e) { toast('Could not load textures: ' + e.message); toMenu(); return; }
  if (lastCfg !== cfg) return;
  showScr(null);
  document.body.classList.add('racing');
  try { game = new Game(app, cfg); } catch (e) { console.error(e); toast('Could not start the race: ' + e.message); toMenu(); }
}
const soloCfg = (level) => ({ mode: 'solo', level, locals: [{ name: profile.name, bike: profile.bike, color: profile.color, devs: ['k0', 'k1', 'g0'] }] });
const splitCfg = (level) => ({ mode: 'split', level, locals: split.p.slice(0, split.n).map((p, i) => ({ name: i === 0 ? profile.name : 'P' + (i + 1), bike: p.bike, color: p.color, devs: [p.dev] })) });
function toMenu() {
  disposeGame();
  if (room) { net.send({ t: 'leave' }); room = null; }
  stack.length = 0; showScr('main', false); audio.setMusic('menu'); show.setBike(profile.bike, profile.color);
}

function resultsTable() {
  if (!game) return;
  const st = game.standings();
  $('#res-table').innerHTML = '<div class="tr h"><span>POS</span><span>RIDER</span><span>TIME</span><span>TRICKS</span><span>BIKE</span></div>' + st.map((r, i) =>
    `<div class="tr${r.local >= 0 ? ' me' : ''}"><span class="pos">${i + 1}</span><span>${esc(r.name)}${r.isAI ? '<i class="ai">AI</i>' : ''}</span><span class="t">${r.dnf ? 'DNF' : r.finished ? fmtTime(r.finishTime) : 'riding…'}</span><span>${r.owned ? r.score : '–'}</span><span>${BIKES[r.bikeIdx].name}</span></div>`).join('');
}
async function onRaceOver(g) {
  const cfg = g.cfg, me = g.locals[0];
  audio.setMusic('menu');
  $('#res-title').textContent = LEVELS[cfg.level].name + ' — RESULTS';
  $('#res-info').textContent = cfg.mode === 'split' ? '' : me.dnf ? 'DID NOT FINISH' : `YOU FINISHED ${ordinal(me.place).toUpperCase()}  ·  ${fmtTime(me.finishTime)}`;
  const btn = (id, label, big) => `<button class="btn${big ? ' big' : ''}" data-res="${id}">${label}</button>`;
  $('#res-btns').innerHTML = cfg.mode === 'online'
    ? (room && room.private ? btn('room', 'BACK TO ROOM', 1) : btn('again', 'RACE AGAIN', 1)) + btn('menu', 'MENU')
    : btn('retry', cfg.mode === 'solo' ? 'RETRY' : 'REMATCH', 1) + btn('next', 'NEXT MOUNTAIN') + btn('menu', 'MENU');
  app.hudRoot.style.display = 'none';
  resultsTable(); showScr('results', false);
  clearInterval(resTimer); resTimer = setInterval(resultsTable, 1000);
  if (cfg.mode === 'solo' && !me.dnf && me.finishTime) {
    const res = await lbSubmit({ name: profile.name, level: cfg.level, time: me.finishTime, bike: profile.bike, score: me.score });
    if (game === g && res && res.rank) $('#res-info').textContent += `  ·  WORLD RANK #${res.rank}${res.local ? ' (this device)' : ''}`;
  }
}

// ------------------------------------------------------------------ online
async function goOnline(kind, code) {
  $('#wait-text').textContent = kind === 'quick' ? 'FINDING RIDERS…' : 'CONNECTING…'; showScr('wait', false);
  try { await net.connect({ name: profile.name, bike: profile.bike, color: profile.color }); }
  catch { toast('Cannot reach the race server right now. Try again in a moment.'); showScr('main', false); return; }
  net.send(kind === 'quick' ? { t: 'quick' } : kind === 'create' ? { t: 'create', level: 0 } : { t: 'join', code });
}
function renderLobby() {
  if (!room) return;
  const host = room.host === net.id, priv = room.private, lv = LEVELS[room.level];
  $('#lobby-title').textContent = priv ? 'PRIVATE ROOM' : 'QUICK RACE LOBBY';
  $('#lobby-code').innerHTML = priv ? `ROOM CODE<b>${esc(room.code)}</b>` : 'PUBLIC MATCHMAKING';
  $('#lobby-copy').style.display = priv ? '' : 'none';
  const slots = [];
  for (let i = 0; i < 8; i++) {
    const p = room.players[i];
    slots.push(p ? `<div class="pl${p.id === net.id ? ' me' : ''}" style="border-left-color:${hexCss(COLORS[p.color].a)}">${esc(p.name)}${p.id === room.host ? ' ★' : ''}<small>${BIKES[p.bike].name}</small></div>` : '<div class="pl ai">AI RIDER<small>fills empty seat</small></div>');
  }
  $('#lobby-players').innerHTML = slots.join('');
  $('#lobby-lvname').innerHTML = priv ? `${lv.name}<small>${lv.place}</small>` : 'RANDOM MOUNTAIN<small>picked when the race starts</small>';
  $('#lv-prev').style.visibility = $('#lv-next').style.visibility = priv && host ? 'visible' : 'hidden';
  $('#lobby-start').style.display = priv && host ? '' : 'none';
  clearInterval(lobbyTimer);
  const status = $('#lobby-status');
  if (!priv && room.countdown != null) {
    let left = room.countdown; const tick = () => { status.textContent = `Race starts in ${Math.ceil(Math.max(0, left))}s — empty seats get tough AI riders.`; left -= 0.25; };
    tick(); lobbyTimer = setInterval(tick, 250);
  } else status.textContent = priv ? (host ? 'Share the code or invite link. Start whenever you like — empty seats are filled with AI riders.' : 'Waiting for the host (★) to start the race…') : '';
}
net.on.room = (m) => {
  room = m;
  if (game) { game.onRoom(m); if (cur !== 'lobby') return; }
  renderLobby(); if (cur !== 'lobby') showScr('lobby', false);
};
net.on.start = (m) => {
  clearInterval(lobbyTimer);
  startRace({ mode: 'online', level: m.level, locals: [{ name: profile.name, bike: profile.bike, color: profile.color, devs: ['k0', 'k1', 'g0'] }], online: { roster: m.roster, host: m.host, seed: m.seed, myId: net.id } });
};
net.on.err = (m) => { toast(m.msg); if (cur === 'wait') showScr('room', false); };
net.on.close = () => { room = null; if ((game && game.online) || cur === 'lobby' || cur === 'wait') { toast('Lost connection to the race server'); toMenu(); } };

// ------------------------------------------------------------------ events
function togglePause() {
  if (!game || game.over) return;
  if (cur === 'pause') { game.paused = false; input.capture = true; showScr(null); return; }
  if (!game.online) game.paused = true;
  $('#pause-restart').style.display = game.online ? 'none' : '';
  input.capture = false; showScr('pause', false);
}
document.addEventListener('click', (e) => {
  audio.init();
  const b = e.target.closest('button'); if (!b) return;
  if (b.matches('[data-back]')) return back();
  audio.play('select');
  const d = b.dataset;
  if (d.go) {
    flow = { mode: d.go, level: flow.level || 0 };
    showScr({ solo: 'level', split: 'split', quick: 'bike', private: 'bike', lb: 'lb', help: 'help', opts: 'opts' }[d.go]);
    if (d.go === 'opts') renderOpts();
    if (d.go === 'quick' || d.go === 'private') renderBike();
  } else if (d.level != null) {
    flow.level = +d.level;
    if (flow.mode === 'split') startRace(splitCfg(flow.level)); else { renderBike(); showScr('bike'); }
  } else if (d.color != null) { profile.color = +d.color; saveProfile(); renderBike(); }
  else if (d.lb != null) renderLB(+d.lb);
  else if (d.bind) { const [dev, act] = d.bind.split(':'); listen = { dev, act, t: performance.now() }; b.classList.add('wait'); b.textContent = 'PRESS…'; b.blur(); }
  else if (d.n) { split.n = +d.n; renderSplit(); }
  else if (d.k) {
    const p = split.p[+d.p], dir = +d.d;
    if (d.k === 'bike') p.bike = (p.bike + dir + 6) % 6; else if (d.k === 'color') p.color = (p.color + dir + 8) % 8;
    else { const i = DEVICES.findIndex((x) => x.id === p.dev); p.dev = DEVICES[(i + dir + DEVICES.length) % DEVICES.length].id; }
    renderSplit();
  } else if (d.res) {
    const cfg = lastCfg;
    if (d.res === 'retry') startRace(cfg.mode === 'solo' ? soloCfg(cfg.level) : splitCfg(cfg.level));
    else if (d.res === 'next') { const n = (cfg.level + 1) % LEVELS.length; flow.level = n; startRace(cfg.mode === 'solo' ? soloCfg(n) : splitCfg(n)); }
    else if (d.res === 'room') { disposeGame(); audio.setMusic('menu'); net.send({ t: 'lobby' }); renderLobby(); showScr('lobby', false); }
    else if (d.res === 'again') { disposeGame(); net.send({ t: 'leave' }); room = null; goOnline('quick'); }
    else toMenu();
  } else switch (b.id) {
    case 'name-ok': {
      const n = $('#name-input').value.replace(/[^\p{L}\p{N} _\-.!]/gu, '').trim().slice(0, 14);
      if (!n) { toast('Type a rider name first'); break; }
      profile.name = n; saveProfile(); $('#who').textContent = n; stack.length = 0;
      if (pendingCode) { flow = { mode: 'private', level: 0 }; renderBike(); showScr('main', false); showScr('bike'); toast('Pick a bike to join room ' + pendingCode); }
      else showScr('main', false);
      audio.setMusic('menu');
      break;
    }
    case 'rename': $('#name-input').value = profile.name; showScr('name', false); break;
    case 'bike-prev': case 'bike-next': profile.bike = (profile.bike + (b.id === 'bike-next' ? 1 : 5)) % 6; saveProfile(); renderBike(); break;
    case 'bike-ok':
      if (flow.mode === 'solo') startRace(soloCfg(flow.level));
      else if (flow.mode === 'quick') goOnline('quick');
      else if (pendingCode) { const c = pendingCode; pendingCode = ''; history.replaceState(null, '', location.pathname); goOnline('join', c); }
      else showScr('room');
      break;
    case 'split-ok': {
      const devs = split.p.slice(0, split.n).map((p) => p.dev);
      if (new Set(devs).size < devs.length) { toast('Two players are using the same controls'); break; }
      flow.mode = 'split'; showScr('level'); break;
    }
    case 'room-create': goOnline('create'); break;
    case 'room-join': { const c = $('#room-code').value.toUpperCase().trim(); if (c.length < 4) toast('Enter the 5-letter room code'); else goOnline('join', c); break; }
    case 'lobby-copy': {
      const url = location.origin + location.pathname + '?room=' + room.code;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => { b.textContent = 'LINK COPIED!'; }, () => { b.textContent = url; });
      setTimeout(() => (b.textContent = 'COPY INVITE LINK'), 2500); break;
    }
    case 'lv-prev': case 'lv-next': net.send({ t: 'level', level: (room.level + (b.id === 'lv-next' ? 1 : LEVELS.length - 1)) % LEVELS.length }); break;
    case 'lobby-start': net.send({ t: 'start' }); break;
    case 'lobby-leave': audio.play('back'); clearInterval(lobbyTimer); toMenu(); break;
    case 'pause-resume': togglePause(); break;
    case 'pause-opts': showScr('opts'); renderOpts(); break;
    case 'opt-retro': opts.retro = !opts.retro; applyOpts(); renderOpts(); if (game) game.resize(); break;
    case 'opt-rumble': opts.rumble = !opts.rumble; applyOpts(); renderOpts(); break;
    case 'opt-reset': resetBinds(); renderOpts(); break;
    case 'pause-restart': startRace(lastCfg); break;
    case 'pause-quit': toMenu(); break;
  }
});
let lastHover = null;
document.addEventListener('mouseover', (e) => { const b = e.target.closest('button'); if (b && b !== lastHover) audio.play('move', 0.6); lastHover = b; });
document.addEventListener('focusin', (e) => { if (e.target.matches('button') && e.target !== lastHover) audio.play('move', 0.6); });
document.addEventListener('input', (e) => {
  if (e.target.id === 'opt-music') opts.music = e.target.value / 100; else if (e.target.id === 'opt-sfx') { opts.sfx = e.target.value / 100; audio.play('move'); } else return;
  applyOpts();
});
function moveFocus(dir) {
  if (!cur) return;
  const f = [...$('#scr-' + cur).querySelectorAll('button:not(:disabled), input')].filter((x) => x.offsetParent !== null);
  if (f.length) f[(f.indexOf(document.activeElement) + dir + f.length) % f.length].focus();
}
function goBack() {
  if (game && !game.over) togglePause();
  else if (cur === 'pause') togglePause();
  else if (cur && !['main', 'name', 'results', 'wait', 'lobby'].includes(cur)) back();
}
addEventListener('keydown', (e) => {
  audio.init();
  if (listen) { e.preventDefault(); if (e.code === 'Escape') { listen = null; renderOpts(); } else if (listen.dev !== 'pad') setBind(listen.dev, listen.act, e.code); return; }
  const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
  if (e.code === 'KeyZ' && !typing && game && !game.over && cur !== 'pause') { game.cycleZoom(); return; }
  if (e.code === 'KeyM' && !typing) { toast(audio.toggleMute() ? 'SOUND OFF' : 'SOUND ON'); return; }
  if (e.code === 'Escape') {
    if (game && !game.over) togglePause();
    else if (cur && !['main', 'name', 'results', 'wait', 'lobby'].includes(cur)) back();
    return;
  }
  if (e.code === 'Enter' && typing) { const el = $('#scr-' + cur); const b = el && el.querySelector(cur === 'room' ? '#room-join' : '.btn.big'); if (b) b.click(); return; }
  if (!cur || typing) return;
  const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.code];
  if (!dir) return;
  e.preventDefault();
  const f = [...$('#scr-' + cur).querySelectorAll('button:not(:disabled), input')].filter((x) => x.offsetParent !== null);
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  f[(i + dir + f.length) % f.length].focus();
});
addEventListener('pointerdown', () => audio.init());
addEventListener('resize', () => { applyOpts(); show.cam.aspect = innerWidth / innerHeight; show.cam.updateProjectionMatrix(); if (game) game.resize(); });
addEventListener('blur', () => { if (game && !game.over && !game.online && cur !== 'pause') togglePause(); });

// ------------------------------------------------------------------ boot
applyOpts(); renderSplit(); renderBike();
$('#who').textContent = profile.name; $('#name-input').value = profile.name;
if (pendingCode) $('#room-code').value = pendingCode;
showScr(profile.name && !pendingCode ? 'main' : 'name', false);
audio.setMusic('menu');
window.__booted = true;
window.__rr = { get game() { return game; }, startRace, soloCfg, splitCfg, profile };

let lastT = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min((t - lastT) / 1000, 0.1); lastT = t;
  // gamepad: rebinding, menu navigation, pause
  if (listen && listen.dev === 'pad' && performance.now() - listen.t > 250) { const bi = input.padButton(); if (bi >= 0) setBind('pad', listen.act, bi); }
  else if (!listen) {
    const mp = input.menuPoll();
    if (cur) {
      if (mp.down || mp.right) moveFocus(1); else if (mp.up || mp.left) moveFocus(-1);
      if (mp.ok && document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.click();
      if (mp.back) goBack();
    }
    if (mp.start && game && !game.over) togglePause();
    if (mp.zoom && game && !game.over && !cur) game.cycleZoom();
  }
  if (cur === 'opts' && ((frame.n = (frame.n || 0) + 1) % 40 === 0)) renderPads();
  if (game) { try { game.update(dt); } catch (e) { console.error(e); toast('Game error: ' + e.message); toMenu(); } }
  else show.render(dt);
}
requestAnimationFrame(frame);
