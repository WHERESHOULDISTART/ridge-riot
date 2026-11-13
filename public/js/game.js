// One race: world, riders, power-ups, combat, split-screen cameras, HUD and net sync.
import * as THREE from 'three';
import { Track, makeSky, P, merge } from './track.js';
import { Rider } from './rider.js';
import { Hazards } from './hazards.js';
import { LEVELS, COLORS, ITEMS, ITEM_KEYS, AI_NAMES } from './levels.js';
import { clamp, lerp, damp, mulberry32, fmtTime, ordinal, esc } from './util.js';

const GRID = 8;
const hexCss = (h) => '#' + h.toString(16).padStart(6, '0');

class Particles {
  constructor(scene, n = 500) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3).fill(-9999); this.col = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.2, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    this.pts.frustumCulled = false; scene.add(this.pts); this.c = new THREE.Color();
  }
  burst(p, n, hex, speed = 4, up = 3, life = 0.8) {
    for (let k = 0; k < n; k++) {
      const i = (this.i = (this.i + 1) % this.n), o = i * 3;
      this.c.set(Array.isArray(hex) ? hex[(Math.random() * hex.length) | 0] : hex);
      this.pos[o] = p.x + (Math.random() - 0.5) * 0.6; this.pos[o + 1] = p.y + 0.3 + Math.random() * 0.5; this.pos[o + 2] = p.z + (Math.random() - 0.5) * 0.6;
      this.vel[o] = (Math.random() - 0.5) * speed; this.vel[o + 1] = Math.random() * up; this.vel[o + 2] = (Math.random() - 0.5) * speed;
      this.col[o] = this.c.r; this.col[o + 1] = this.c.g; this.col[o + 2] = this.c.b; this.life[i] = life * (0.6 + Math.random() * 0.6);
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      const o = i * 3; this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[o + 1] = -9999; continue; }
      this.vel[o + 1] -= 9 * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
    }
    this.pts.geometry.attributes.position.needsUpdate = true; this.pts.geometry.attributes.color.needsUpdate = true;
  }
}

export class Game {
  // app: { renderer, audio, input, net, hudRoot, onRaceOver }
  // cfg: { mode, level, locals:[{name,bike,color,devs}], online?:{roster,host,seed,myId} }
  constructor(app, cfg) {
    Object.assign(this, { app, cfg, audio: app.audio, input: app.input, net: app.net, renderer: app.renderer });
    const level = (this.level = LEVELS[cfg.level]);
    this.online = cfg.mode === 'online'; this.isHost = !this.online || cfg.online.host === cfg.online.myId;
    this.time = 0; this.dt = 1 / 60; this.raceTime = 0; this.phase = 'count'; this.countT = 4.4; this.countShown = 4;
    this.paused = false; this.over = false; this.endT = null; this.limitT = null; this.netT = 0; this.bandT = 0; this.tickT = 0; this.seq = 0;
    this.muds = []; this.goats = []; this.rings = []; this.projs = [];
    this.zoom = app.zoom || 0;

    const scene = (this.scene = new THREE.Scene());
    const Lt = level.light;
    scene.add(new THREE.HemisphereLight(Lt.sky, Lt.gnd, 2.0 * Lt.k));
    const sun = new THREE.DirectionalLight(Lt.sun, 2.3 * Lt.k); sun.position.set(0.5, 1, -0.35); scene.add(sun);
    const sk = makeSky(level); this.sky = sk.mesh; scene.add(this.sky);
    scene.fog = new THREE.Fog(sk.fog, level.fog[0] * 1.3, level.fog[1] * 1.55); scene.background = new THREE.Color(sk.fog);
    this.dust = 0x9a8468;
    this.track = new Track(level); scene.add(this.track.group);
    this.fx = new Particles(scene);

    // shared meshes for power-ups
    this.goatGeo = merge([P(new THREE.BoxGeometry(0.55, 0.6, 1.1), 0xf4f0e6, 0, 0.75, 0), P(new THREE.BoxGeometry(0.4, 0.45, 0.5), 0xf4f0e6, 0, 1.15, 0.7), P(new THREE.ConeGeometry(0.08, 0.5, 4), 0x4a3a2a, 0.14, 1.55, 0.6, 1, 1, 1, -0.5), P(new THREE.ConeGeometry(0.08, 0.5, 4), 0x4a3a2a, -0.14, 1.55, 0.6, 1, 1, 1, -0.5), P(new THREE.BoxGeometry(0.1, 0.3, 0.1), 0xd8d0c0, 0, 0.82, 0.92),
      ...[[0.2, 0.4], [-0.2, 0.4], [0.2, -0.4], [-0.2, -0.4]].map(([x, z]) => P(new THREE.BoxGeometry(0.12, 0.5, 0.12), 0x3a3a3a, x, 0.25, z)), P(new THREE.ConeGeometry(0.25, 1.2, 5), 0xff7a1e, 0, 0.8, -1.1, 1, 1, 1, -Math.PI / 2)]);
    this.mudGeo = merge([P(new THREE.IcosahedronGeometry(1, 0), 0x5a3a1e, 0, 0.1, 0, 1.7, 0.28, 1.7), P(new THREE.IcosahedronGeometry(0.5, 0), 0x6f4a26, 0.3, 0.3, 0.2, 1, 0.6, 1)]);
    this.propMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

    // ---- riders on the grid
    this.riders = []; this.byId = new Map(); this.locals = [];
    const add = (o) => { const r = new Rider(this, o); this.riders.push(r); this.byId.set(r.id, r); return r; };
    const single = cfg.locals.length === 1;
    if (this.online) {
      for (const p of cfg.online.roster) {
        const me = p.id === cfg.online.myId;
        const r = add({ id: p.id, name: p.name, bike: p.bike, color: p.color, owned: me, local: me ? 0 : -1, tag: !me });
        if (me) this.locals.push(r);
      }
    } else cfg.locals.forEach((p, i) => this.locals.push(add({ id: 'L' + i, name: p.name, bike: p.bike, color: p.color, owned: true, local: i, tag: !single })));
    const rnd = mulberry32(this.online ? cfg.online.seed : (Math.random() * 1e9) | 0);
    const names = AI_NAMES.slice().sort(() => rnd() - 0.5), nAI = GRID - this.riders.length;
    for (let i = 0; i < nAI; i++) {
      add({ id: 'a' + i, name: names[i], bike: (rnd() * 6) | 0, color: (rnd() * 8) | 0, isAI: true, owned: this.isHost, skill: 0.945 + 0.085 * (nAI > 1 ? i / (nAI - 1) : 1) });
    }
    // humans start mid-pack so there is always someone to chase
    const order = this.riders.slice().sort((a, b) => (a.isAI ? a.skill : 0.99) - (b.isAI ? b.skill : 0.99));
    order.forEach((r, k) => { const row = Math.floor(k / 4), col = k % 4; r.place0(34 - row * 4.5, (col - 1.5) * 2.6 + (row % 2) * 0.8); });
    for (const r of this.riders) r.sync(0.016, 0);
    this.hazards = new Hazards(this);

    // ---- cameras + HUD
    this.cams = this.locals.map(() => ({ cam: new THREE.PerspectiveCamera(78, 1, 0.3, 3200), look: new THREE.Vector3(), init: false, fov: 70 }));
    this.huds = this.locals.map((r, i) => this._makeHud(r, i));
    this.center = document.createElement('div'); this.center.className = 'bigtext'; app.hudRoot.appendChild(this.center);
    this.resize();
    this.input.reset(); this.input.capture = true;
    this.audio.setMusic('race', level.music);
    if (this.online) this._bindNet();
    this._tmp = new THREE.Vector3(); this._tmp2 = new THREE.Vector3();
  }

  // ---------------------------------------------------------------- layout
  resize() {
    const n = this.locals.length, W = innerWidth, H = innerHeight;
    const rects = n === 1 ? [[0, 0, 1, 1]] : n === 2 ? [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] : [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]];
    this.vps = rects.slice(0, n).map(([x, y, w, h]) => ({ x: Math.round(x * W), y: Math.round(y * H), w: Math.round(w * W), h: Math.round(h * H) }));
    this.vps.forEach((v, i) => {
      const c = this.cams[i].cam; c.aspect = v.w / v.h; c.updateProjectionMatrix();
      const s = this.huds[i].el.style; s.left = v.x + 'px'; s.top = v.y + 'px'; s.width = v.w + 'px'; s.height = v.h + 'px';
      this.huds[i].el.classList.toggle('small', n > 1);
    });
  }

  _makeHud(r, i) {
    const el = document.createElement('div'); el.className = 'hud';
    el.innerHTML = `<div class="h-place"><b>1</b><sup>st</sup><span>/${GRID}</span></div>
      <div class="h-name" style="color:${hexCss(COLORS[r.colorIdx].a)}">${esc(r.name)}</div>
      <div class="h-right"><div class="h-time">0:00.00</div><div class="h-score">TRICKS <b>0</b></div></div>
      <div class="h-item"><span></span><em></em></div>
      <div class="h-speed"><b>0</b><small>km/h</small><div class="h-boost"><i></i><em>BOOST</em></div></div>
      <div class="h-prog"><u></u>${this.riders.map((x) => `<i style="background:${hexCss(COLORS[x.colorIdx].a)}"></i>`).join('')}</div>
      <div class="h-trick"></div><div class="h-msg"></div><div class="h-flash"></div><div class="h-fin"></div>`;
    this.app.hudRoot.appendChild(el);
    const q = (s) => el.querySelector(s);
    return { el, place: q('.h-place b'), sup: q('.h-place sup'), time: q('.h-time'), score: q('.h-score b'), item: q('.h-item'), icon: q('.h-item span'), iname: q('.h-item em'),
      speed: q('.h-speed b'), boost: q('.h-boost i'), dots: [...el.querySelectorAll('.h-prog i')], trick: q('.h-trick'), msg: q('.h-msg'), flash: q('.h-flash'), fin: q('.h-fin'), last: {} };
  }
  msg(r, text, cls = '') {
    if (r.local < 0) return; const h = this.huds[r.local];
    h.msg.textContent = text; h.msg.className = 'h-msg show ' + cls; clearTimeout(h.msgT); h.msgT = setTimeout(() => (h.msg.className = 'h-msg'), 1800);
  }
  flash(r, color) {
    if (r.local < 0) return; const f = this.huds[r.local].flash;
    f.style.background = color; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  }

  // ---------------------------------------------------------------- sound
  sfx(name, r, always) {
    let vol = 1;
    if (r && r.local < 0 && !always) {
      let best = 999;
      for (const l of this.locals) best = Math.min(best, Math.hypot(l.s - r.s, l.u - r.u));
      vol = clamp(1 - best / 70, 0, 1) * 0.7;
    }
    this.audio.play(name, vol);
  }

  // ---------------------------------------------------------------- rider callbacks
  onItemReady(r) { if (r.local >= 0) { this.sfx('ready'); this.msg(r, ITEMS[r.item].icon + ' ' + ITEMS[r.item].name, 'good'); } }
  onKick(r) {
    this.sfx('kick', r);
    for (const o of this.riders) {
      if (o === r || o.crashT > 0) continue;
      const side = (o.u - r.u) * r.kickSide;
      if (Math.abs(o.s - r.s) < 2.4 && side > 0.15 && side < 3.1 && Math.abs(o.y - r.y) < 2) { this.emit({ ev: 'hit', target: o.id, kind: 'kick', side: r.kickSide, from: r.id }); break; }
    }
  }
  onTrick(r, name, pts) {
    this.sfx('trick', r);
    this.fx.burst(r.m.root.position, 14, [0xffe23e, 0xff7a1e, 0xffffff], 5, 5, 0.7);
    if (r.local < 0) return; const h = this.huds[r.local];
    h.trick.innerHTML = `${esc(name)}<b>+${pts}</b>`; h.trick.className = 'h-trick'; void h.trick.offsetWidth; h.trick.className = 'h-trick show';
  }
  onLand(r, impact) { if (impact > 5 && r.airT > 0.45) { this.sfx('land', r); this.fx.burst(r.m.root.position, 8, this.dust, 4, 2, 0.5); } }
  onCrash(r, why) {
    this.sfx(why === 'goat' ? 'goatHit' : 'crash', r);
    this.fx.burst(r.m.root.position, 26, [this.dust, 0xffffff, COLORS[r.colorIdx].a], 9, 7, 1);
    this.msg(r, { tree: 'WIPEOUT!', bail: 'BAILED! LAND IT STRAIGHT', goat: "🐐 GOAT'D!" }[why] || 'CRASH!', 'bad');
    this.flash(r, 'rgba(255,40,20,0.45)');
    if (r.local >= 0 && this.input.rumbleOn !== false) this.input.rumble(this.cfg.locals[r.local].devs);
  }
  onShieldPop(r) { this.sfx('pop', r); this.fx.burst(r.m.root.position, 16, 0x8fe8ff, 7, 5, 0.6); this.msg(r, '🫧 SHIELD SAVED YOU', 'good'); }
  onFinish(r) {
    this.emit({ ev: 'fin', id: r.id, time: r.finishTime });
    if (r.local >= 0) {
      this._places();
      this.sfx(r.place <= 3 ? 'finish' : 'lose');
      const h = this.huds[r.local]; h.fin.innerHTML = `<b>${ordinal(r.place)}</b><span>${fmtTime(r.finishTime)}</span>`; h.fin.classList.add('show');
    }
    if (this.limitT === null && this.locals.length > 1) this.limitT = 45;
  }

  // ---------------------------------------------------------------- events (local + network)
  emit(e) { this.handle(e); if (this.online) this.net.send({ t: 'ev', e }); }
  handle(e) {
    const from = this.byId.get(e.from), T = this.track;
    switch (e.ev) {
      case 'hit': {
        const r = this.byId.get(e.target); if (!r) break;
        const fn = from ? from.name : 'someone';
        if (from && from.owned && from !== r) from.nitro = Math.min(1, from.nitro + 0.22);
        if (e.kind === 'kick') {
          this.sfx('hit', r, from && from.local >= 0);
          this.fx.burst(r.m.root.position, 8, 0xffffff, 5, 4, 0.4);
          if (r.owned && r.takeHit('kick', e.side)) { this.msg(r, 'KICKED BY ' + fn.toUpperCase() + '!', 'bad'); this.flash(r, 'rgba(255,255,255,0.35)'); }
          if (from) this.msg(from, 'BOOT TO ' + r.name.toUpperCase() + '!', 'good');
        } else if (e.kind === 'goat') {
          if (r.owned) r.takeHit('goat');
          if (from && from !== r) { this.msg(from, '🐐 GOAT GOT ' + r.name.toUpperCase() + '!', 'good'); if (from.local >= 0) this.sfx('goatHit'); }
        } else {
          const it = ITEMS[e.kind] || { icon: '', name: e.kind };
          this.sfx(e.kind === 'bomb' ? 'crash' : 'hit', r, from && from.local >= 0);
          this.fx.burst(r.m.root.position, 12, e.kind === 'snowball' ? 0xffffff : [0xffd23e, 0xffffff], 6, 5, 0.5);
          if (r.owned && r.takeHit(e.kind, e.side || 1)) { this.msg(r, it.icon + ' ' + e.kind.toUpperCase() + ' FROM ' + fn.toUpperCase() + '!', 'bad'); this.flash(r, 'rgba(255,255,255,0.35)'); }
          if (from && from !== r) this.msg(from, it.icon + ' NAILED ' + r.name.toUpperCase() + '!', 'good');
        }
        break;
      }
      case 'use': { const r = this.byId.get(e.id); if (r) { this.sfx(e.kind, r); this.fx.burst(r.m.root.position, 12, e.kind === 'chili' ? [0xff3e1e, 0xffb41e] : e.kind === 'shield' ? 0x8fe8ff : 0x7dff5a, 5, 5, 0.6); } break; }
      case 'horn': {
        this.sfx('horn', from);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 5, 28).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe23e, transparent: true, depthWrite: false }));
        T.ground(e.s, e.u, ring.position, 1); this.scene.add(ring); this.rings.push({ mesh: ring, t: 0 });
        for (const r of this.riders) {
          if (!r.owned || r === from || Math.hypot(r.s - e.s, r.u - e.u) > 30) continue;
          if (r.takeHit('horn', Math.sign(r.u - e.u) || 1)) { this.msg(r, '📯 BLASTED!', 'bad'); this.flash(r, 'rgba(255,226,62,0.4)'); }
        }
        break;
      }
      case 'bliz': {
        this.sfx('blizzard');
        for (const r of this.riders) {
          if (r === from || r.finished || r.s <= e.s) continue;
          this.fx.burst(r.m.root.position, 14, [0xffffff, 0xbfeaff], 5, 6, 0.9);
          if (r.owned && r.takeHit('bliz')) { this.msg(r, '❄️ FROZEN BY ' + (from ? from.name.toUpperCase() : '???') + '!', 'bad'); this.flash(r, 'rgba(160,220,255,0.55)'); if (r.local >= 0) this.sfx('frozen'); }
        }
        if (from) this.msg(from, '❄️ BLIZZARD!', 'good');
        break;
      }
      case 'mud': {
        const mesh = new THREE.Mesh(this.mudGeo, this.propMat); T.ground(e.s, e.u, mesh.position, 0.05); mesh.rotation.y = Math.random() * 6;
        this.scene.add(mesh); this.muds.push({ id: e.id, s: e.s, u: e.u, mesh, life: 45, owner: e.from, arm: 0.6 });
        this.sfx('mudDrop', from);
        break;
      }
      case 'mudhit': {
        const k = this.muds.findIndex((m) => m.id === e.id); if (k < 0) break;
        const m = this.muds[k]; this.fx.burst(m.mesh.position, 22, [0x5a3a1e, 0x7a5230], 7, 6, 0.8);
        const r = this.byId.get(e.rid); this.sfx('splat', r);
        this.scene.remove(m.mesh); this.muds.splice(k, 1);
        break;
      }
      case 'goat': {
        if (!from) break;
        const mesh = new THREE.Mesh(this.goatGeo, this.propMat); mesh.scale.setScalar(1.3); this.scene.add(mesh);
        from.throwT = 0.4;
        this.goats.push({ s: from.s + 2, u: from.u, from, target: e.target, auth: from.owned, life: 7, mesh });
        this.sfx('goat', from);
        break;
      }
      case 'proj': {
        if (!from) break;
        from.throwT = 0.4; this.sfx('throw', from);
        const geo = { snowball: [new THREE.SphereGeometry(0.3, 8, 6), 0xffffff], coconut: [new THREE.SphereGeometry(0.42, 8, 6), 0x6a4a2a], bomb: [new THREE.SphereGeometry(0.4, 8, 6), 0x18181c], boomerang: [new THREE.BoxGeometry(1.5, 0.08, 0.3), 0xf2a01e] }[e.k];
        if (!geo) break;
        const mesh = new THREE.Mesh(geo[0], new THREE.MeshLambertMaterial({ color: geo[1] })); this.scene.add(mesh);
        if (e.k === 'boomerang') { const b2 = new THREE.Mesh(geo[0], mesh.material); b2.rotation.y = Math.PI / 2; mesh.add(b2); }
        const cs = Math.cos(e.th), sn = Math.sin(e.th), sp = e.k === 'snowball' ? e.v + 36 : e.k === 'coconut' ? Math.max(e.v + 16, 40) : e.k === 'bomb' ? e.v + 20 : e.v + 32;
        this.projs.push({ k: e.k, s: e.s, u: e.u, y: e.y, vs: sp * cs, vu: e.k === 'coconut' ? (Math.abs(sn) > 0.1 ? Math.sign(sn) : Math.random() < 0.5 ? -1 : 1) * 10 : sp * sn, vy: e.k === 'bomb' ? 9 : 1.5, from, auth: from.owned, life: { snowball: 2.4, coconut: 7, bomb: 2.2, boomerang: 3.5 }[e.k], t: 0, mesh, hit: new Set() });
        break;
      }
      case 'boom': {
        this.audio.play('boom', 1);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 5, 24).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff7a1e, transparent: true, depthWrite: false }));
        T.ground(e.s, e.u, ring.position, 0.8); this.scene.add(ring); this.rings.push({ mesh: ring, t: 0, r: 9 });
        this.fx.burst(ring.position, 60, [0xff5a1e, 0xffd23e, 0x3a3a3a], 16, 14, 1.0);
        break;
      }
      case 'fin': { const r = this.byId.get(e.id); if (r && !r.owned && !r.finished) { r.finished = true; r.finishTime = e.time; } break; }
    }
  }

  rollItem(r) {
    const f = this.riders.length > 1 ? (r.place - 1) / (this.riders.length - 1) : 0.5;
    let sum = 0; const w = ITEM_KEYS.map((k) => { const x = lerp(ITEMS[k].w[0], ITEMS[k].w[1], f); sum += x; return x; });
    let p = Math.random() * sum;
    for (let i = 0; i < w.length; i++) { p -= w[i]; if (p <= 0) return ITEM_KEYS[i]; }
    return 'chili';
  }
  useItem(r) {
    const kind = r.item; if (!kind || r.crashT > 0) return;
    r.item = null;
    if (kind === 'chili') { r.boostT = Math.min(5, r.boostT + 3.2); this.emit({ ev: 'use', id: r.id, kind }); this.flash(r, 'rgba(255,120,20,0.35)'); }
    else if (kind === 'shield') { r.shieldT = 12; this.emit({ ev: 'use', id: r.id, kind }); }
    else if (kind === 'spring') {
      r.springT = 8; if (r.grounded) { r.vy += 13; r.grounded = false; r.airT = 0; r._takeoff(); }
      this.emit({ ev: 'use', id: r.id, kind });
    } else if (kind === 'goat') {
      let tgt = null, best = 1e9;
      for (const o of this.riders) { const d = o.s - r.s; if (o !== r && !o.finished && d > 0 && d < best) { best = d; tgt = o; } }
      this.emit({ ev: 'goat', from: r.id, target: tgt ? tgt.id : null });
    } else if (kind === 'mud') this.emit({ ev: 'mud', id: r.id + '-' + this.seq++, s: Math.max(0, r.s - 3), u: r.u, from: r.id });
    else if (kind === 'horn') this.emit({ ev: 'horn', s: r.s, u: r.u, from: r.id });
    else if (kind === 'blizzard') this.emit({ ev: 'bliz', s: r.s, from: r.id });
    else {
      // throwables: snowball (x3), coconut, boomerang, bomb
      if (kind === 'snowball') { r.ammo = (r.ammo > 0 ? r.ammo : 3) - 1; if (r.ammo > 0) r.item = kind; }
      this.emit({ ev: 'proj', k: kind, from: r.id, s: r.s + 1, u: r.u, y: r.y + 1.3, th: this.track.phiAt(r.s) - r.psi, v: r.v });
    }
  }

  onHazard(r, h, kind) {
    const k = h.k || h.t;
    if (h.K && h.K.snd) this.sfx(h.K.snd, r);
    const txt = { tornado: '🌪️ SUCKED INTO A TORNADO!', geyser: '🌋 GEYSER LAUNCH! LAND IT!', car: '🚗 HIT BY A ' + k.toUpperCase() + '!', person: 'YOU HIT A ' + k.toUpperCase() + '!', small: 'OOF! ' + k.toUpperCase() + '!' }[kind] || 'TRAMPLED BY A ' + k.toUpperCase() + '!';
    this.msg(r, txt, kind === 'geyser' ? 'good' : 'bad');
    if (kind !== 'geyser') this.flash(r, 'rgba(255,40,20,0.4)');
  }

  _projectiles(dt) {
    const T = this.track, R = this.riders;
    for (let k = this.projs.length - 1; k >= 0; k--) {
      const p = this.projs[k]; p.t += dt; p.life -= dt;
      let dead = p.life <= 0, boom = false;
      if (p.k === 'boomerang' && p.t > 0.75) {
        if (!p.back) { p.back = true; p.hit.clear(); }
        const ds = p.from.s + 1 - p.s, du = p.from.u - p.u, d = Math.hypot(ds, du) || 1, sp = 42 + p.from.v;
        p.vs = (ds / d) * sp; p.vu = (du / d) * sp; if (d < 2.5) dead = true;
      }
      p.s += p.vs * dt; p.u += p.vu * dt;
      const gh = T.heightAt(p.s, p.u);
      if (p.k === 'coconut') { const lim = Math.min(T.trailW + 7, T.edge - 1.5), c = T.trailAt(p.s); if (Math.abs(p.u - c) > lim) { p.u = c + Math.sign(p.u - c) * lim; p.vu = -p.vu; } p.y = gh + 0.45; p.mesh.rotation.x += dt * 14; }
      else if (p.k === 'boomerang') { p.y = Math.max(gh + 1.2, p.y); p.mesh.rotation.y += dt * 22; }
      else { p.vy -= (p.k === 'bomb' ? 13 : 5) * dt; p.y += p.vy * dt; if (p.y <= gh + 0.2) { if (p.k === 'bomb') boom = true; dead = true; } }
      if (p.s > T.length - 10 || p.s < 5 || Math.abs(p.u) > T.half) dead = true;
      T.pos(p.s, p.u, p.y, p.mesh.position);
      if (p.k === 'bomb' && Math.random() < 0.6) this.fx.burst(p.mesh.position, 1, [0xffd23e, 0xff5a1e], 1, 2, 0.25);
      if (!dead && p.k !== 'bomb') for (const r of R) {
        if (r === p.from || r.crashT > 0 || p.hit.has(r) || Math.abs(r.s - p.s) > 2 || Math.abs(r.u - p.u) > 1.5 || Math.abs(r.y + 0.9 - p.y) > 2.2) continue;
        p.hit.add(r);
        if (p.auth) this.emit({ ev: 'hit', target: r.id, kind: p.k, from: p.from.id, side: Math.sign(r.u - p.u) || 1 });
        if (p.k !== 'boomerang') dead = true;
        break;
      }
      if (p.k === 'bomb' && (p.life <= 0)) boom = true;
      if (boom && p.auth) {
        this.emit({ ev: 'boom', s: p.s, u: p.u });
        for (const r of R) if (r !== p.from && Math.hypot(r.s - p.s, r.u - p.u) < 9 && r.y - gh < 6) this.emit({ ev: 'hit', target: r.id, kind: 'bomb', from: p.from.id, side: Math.sign(r.u - p.u) || 1 });
      }
      if (dead) { if (p.k !== 'bomb') this.fx.burst(p.mesh.position, 10, p.k === 'snowball' ? 0xffffff : 0x8a6a3a, 5, 4, 0.4); this.scene.remove(p.mesh); this.projs.splice(k, 1); }
    }
  }

  // ---------------------------------------------------------------- network
  _bindNet() {
    const n = this.net.on;
    n.s = (m) => { const r = this.byId.get(m.id); if (r && !r.owned) this._netState(r, m.d); };
    n.ai = (m) => { for (const a of m.d) { const r = this.riders[a[0]]; if (r && !r.owned) this._netState(r, a.slice(1)); } };
    n.ev = (m) => { if (m.e && typeof m.e === 'object') this.handle(m.e); };
    n.left = (m) => { const r = this.byId.get(m.id); if (r) { r.isAI = true; r.owned = this.isHost; r.skill = 0.98; } };
  }
  onRoom(m) {
    if (!this.online) return;
    const host = m.host === this.cfg.online.myId;
    if (host !== this.isHost) { this.isHost = host; for (const r of this.riders) if (r.isAI) r.owned = host; }
  }
  _netState(r, d) {
    r.netApply(d, performance.now());
    if (d[8] & 2048 && !r.finished) { r.finished = true; r.finishTime = this.raceTime; }
  }
  _netSend(dt) {
    this.netT -= dt; if (this.netT > 0) return; this.netT = 1 / 15;
    this.net.send({ t: 's', d: this.locals[0].netState() });
    if (this.isHost) {
      const d = []; this.riders.forEach((r, i) => { if (r.isAI && r.owned) d.push([i, ...r.netState()]); });
      if (d.length) this.net.send({ t: 'ai', d });
    }
  }

  // ---------------------------------------------------------------- main loop
  update(rawDt) {
    if (this.paused) return this.render();
    const dt = (this.dt = Math.min(rawDt, 1 / 30)), T = this.track, now = performance.now();
    this.time += dt;
    if (this.phase === 'count') {
      this.countT -= dt;
      const n = Math.ceil(this.countT);
      if (n !== this.countShown && n <= 3) {
        this.countShown = n;
        if (n > 0) { this.center.textContent = n; this.audio.play('count'); } else { this.center.textContent = 'GO!'; this.audio.play('go'); this.phase = 'race'; setTimeout(() => (this.center.textContent = ''), 900); }
        this.center.classList.remove('pop'); void this.center.offsetWidth; this.center.classList.add('pop');
      }
    } else this.raceTime += dt;
    const racing = this.phase !== 'count';

    for (const r of this.riders) {
      if (r.owned) {
        if (racing) {
          const human = r.local >= 0 && !r.finished;
          const inp = human ? this.input.read(r.local, this.cfg.locals[r.local].devs, dt) : r.aiThink(dt);
          r.update(dt, inp);
          if (inp.item) this.useItem(r);
        }
      } else r.netUpdate(dt, now);
    }
    if (racing) this._interact(dt);
    this.hazards.update(dt, this.raceTime);
    this._places();
    for (const r of this.riders) {
      r.sync(dt, this.time);
      if (r.boostT > 0 && r.crashT <= 0 && Math.random() < 0.5) this.fx.burst(r.m.root.position, 1, [0xff7a1e, 0xffd23e], 2, 2, 0.35);
      else if (r.grounded && r.v > 12 && r.off > 0.5 && Math.random() < 0.25) this.fx.burst(r.m.root.position, 1, this.dust, 2, 2, 0.4);
    }
    T.update(dt, this.time); this.fx.update(dt);
    this._hud(dt);

    // race end bookkeeping
    if (this.limitT !== null && !this.over) {
      this.limitT -= dt;
      if (this.limitT <= 0) for (const r of this.locals) if (!r.finished) { r.finished = true; r.dnf = true; }
    }
    if (!this.over && this.locals.every((r) => r.finished)) {
      if (this.endT === null) this.endT = 2.6;
      this.endT -= dt;
      if (this.endT <= 0) { this.over = true; this.input.capture = false; this.app.onRaceOver(this); }
    }
    let lead = this.locals[0]; for (const r of this.locals) if (r.v > lead.v) lead = r;
    this.audio.setRide(lead.crashT > 0 ? 0 : lead.v, lead.grounded, lead.off || 0);
    if (this.online) this._netSend(dt);
    this._cameras(dt);
    this.render();
  }

  _interact(dt) {
    const R = this.riders, T = this.track;
    // rider vs rider
    for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
      const a = R[i], b = R[j];
      if ((!a.owned && !b.owned) || a.crashT > 0 || b.crashT > 0) continue;
      const ds = b.s - a.s, du = b.u - a.u;
      if (Math.abs(ds) < 1.7 && Math.abs(du) < 0.95 && Math.abs(a.y - b.y) < 1.4) {
        const push = (0.95 - Math.abs(du)) * 0.5 * (Math.sign(du) || 1);
        if (a.owned) a.u -= push; if (b.owned) b.u += push;
        const back = ds > 0 ? a : b; if (back.owned) back.v *= 0.985;
        if ((a.local >= 0 || b.local >= 0) && a.bumpCd <= 0 && b.bumpCd <= 0) { this.audio.play('bump', 0.8); a.bumpCd = b.bumpCd = 0.5; }
      }
    }
    for (const r of R) {
      if (!r.owned || r.crashT > 0) continue;
      // item boxes
      if (!r.item && r.rouletteT <= 0) for (const b of T.boxes) {
        if (b.t > 0 || Math.abs(r.s - b.s) > 1.9 || Math.abs(r.u - b.u) > 1.8 || Math.abs(r.y + 0.8 - b.y) > 2.8) continue;
        b.t = 4; b.mesh.visible = false; r.pendingItem = this.rollItem(r); r.rouletteT = 1.3; r.ammo = 0;
        this.sfx('pickup', r); this.fx.burst(b.mesh.position, 18, [0xff3e3e, 0xffb400, 0x3eff6a, 0x3ec8ff, 0xb03eff], 7, 6, 0.7);
        break;
      }
      // boost pads
      if (r.grounded && r.padCd <= 0) for (const p of T.pads) {
        if (Math.abs(r.s - p.s) < 4.4 && Math.abs(r.u - p.u) < 2) { r.boostT = Math.max(r.boostT, 1.8); r.padCd = 1.2; this.sfx('pad', r); this.flash(r, 'rgba(255,160,20,0.3)'); break; }
      }
      // mud pies
      if (r.y - T.heightAt(r.s, r.u) < 1) for (const m of this.muds) {
        if (Math.abs(r.s - m.s) > 1.9 || Math.abs(r.u - m.u) > 1.9 || (m.arm > 0 && m.owner === r.id)) continue;
        if (r.takeHit('mud')) this.msg(r, '💩 SPLAT!', 'bad');
        this.emit({ ev: 'mudhit', id: m.id, rid: r.id }); break;
      }
    }
    for (let k = this.muds.length - 1; k >= 0; k--) { const m = this.muds[k]; m.arm -= dt; m.life -= dt; if (m.life <= 0) { this.scene.remove(m.mesh); this.muds.splice(k, 1); } }
    // goat rockets
    for (let k = this.goats.length - 1; k >= 0; k--) {
      const g = this.goats[k], tgt = this.byId.get(g.target);
      g.life -= dt; g.s += 50 * dt;
      const want = tgt && tgt.s > g.s - 3 ? tgt.u : T.trailAt(g.s + 8);
      g.u += clamp(want - g.u, -18 * dt, 18 * dt);
      const gh = T.heightAt(g.s, g.u);
      T.pos(g.s, g.u, gh + Math.abs(Math.sin(this.time * 13)) * 0.7, g.mesh.position); g.mesh.rotation.y = T.phiAt(g.s);
      let dead = g.life <= 0 || g.s > T.length - 10 || (tgt && g.s > tgt.s + 40);
      for (const r of R) {
        if (r === g.from || r.crashT > 0 || Math.abs(r.s - g.s) > 2.4 || Math.abs(r.u - g.u) > 1.7 || r.y - gh > 3.2) continue;
        if (g.auth) this.emit({ ev: 'hit', target: r.id, kind: 'goat', from: g.from.id });
        dead = true; break;
      }
      if (dead) { this.fx.burst(g.mesh.position, 14, [0xffffff, 0xff7a1e], 6, 5, 0.5); this.scene.remove(g.mesh); this.goats.splice(k, 1); }
    }
    this._projectiles(dt);
    // shockwave rings
    for (let k = this.rings.length - 1; k >= 0; k--) {
      const g = this.rings[k]; g.t += dt; const f = g.t / 0.7;
      g.mesh.scale.setScalar(1 + f * (g.r || 30)); g.mesh.material.opacity = 1 - f;
      if (f >= 1) { this.scene.remove(g.mesh); g.mesh.geometry.dispose(); g.mesh.material.dispose(); this.rings.splice(k, 1); }
    }
    // AI rubber-banding keeps the pack honest in both directions
    this.bandT -= dt;
    if (this.bandT <= 0) {
      this.bandT = 0.5;
      let hs = -1; for (const r of R) if (!r.isAI && !r.finished) hs = Math.max(hs, r.s);
      for (const r of R) if (r.isAI && r.owned) { const d = hs < 0 ? 0 : r.s - hs; r.band = d > 160 ? 0.9 : d > 60 ? 0.95 : d > 20 ? 0.985 : d < -220 ? 1.08 : d < -80 ? 1.04 : 1; }
    }
  }

  _places() {
    const arr = (this._order ||= this.riders.slice());
    arr.sort((a, b) => (a.finished && !a.dnf ? (b.finished && !b.dnf ? a.finishTime - b.finishTime : -1) : b.finished && !b.dnf ? 1 : b.s - a.s));
    arr.forEach((r, i) => (r.place = i + 1));
  }
  cycleZoom() {
    this.zoom = (this.zoom + 1) % 3; this.app.zoom = this.zoom;
    try { localStorage.setItem('rr_zoom', this.zoom); } catch {}
    for (const r of this.locals) this.msg(r, ['CAMERA: FAR', 'CAMERA: CLOSE', 'CAMERA: CLOSEST'][this.zoom], 'good');
    this.audio.play('move');
  }
  standings() { this._places(); return this._order.slice(); }

  _hud(dt) {
    const L = this.track.finishS;
    this.tickT -= dt; let tick = false;
    this.huds.forEach((h, i) => {
      const r = this.locals[i], last = h.last;
      const set = (k, v, fn) => { if (last[k] !== v) { last[k] = v; fn(v); } };
      set('place', r.place, (v) => { h.place.textContent = v; h.sup.textContent = ordinal(v).slice(-2); h.place.parentElement.classList.remove('bump'); void h.place.offsetWidth; h.place.parentElement.classList.add('bump'); });
      if (!r.finished) h.time.textContent = fmtTime(this.raceTime);
      set('speed', Math.round(r.v * 3.6), (v) => (h.speed.textContent = v));
      set('score', r.score, (v) => (h.score.textContent = v));
      set('boost', Math.round(clamp(r.nitro, 0, 1) * 50), (v) => { h.boost.style.width = v * 2 + '%'; h.boost.parentElement.classList.toggle('full', v >= 49); });
      set('burn', r.boostT > 0, (v) => h.boost.parentElement.classList.toggle('burn', v));
      set('lock', r.nitroLock > 0, (v) => { h.boost.parentElement.classList.toggle('lock', v); h.boost.nextElementSibling.textContent = v ? 'EMPTY - RECHARGING' : 'BOOST'; });
      let icon = '', name = '';
      if (r.rouletteT > 0) { icon = ITEMS[ITEM_KEYS[Math.floor(this.time * 14) % ITEM_KEYS.length]].icon; name = '???'; if (this.tickT <= 0) tick = true; }
      else if (r.item) { icon = ITEMS[r.item].icon; name = r.item === 'snowball' ? 'SNOWBALLS x' + (r.ammo || 3) : ITEMS[r.item].name; }
      set('icon', icon, (v) => { h.icon.textContent = v; h.item.classList.toggle('has', !!v); });
      set('iname', name, (v) => (h.iname.textContent = v));
      this.riders.forEach((x, k) => { const d = h.dots[k]; d.style.top = clamp(x.s / L, 0, 1) * 100 + '%'; if (x === r && !last.me) { d.classList.add('me'); last.me = 1; } });
    });
    if (tick) { this.tickT = 0.09; this.audio.play('tick'); }
  }

  _cameras(dt) {
    const T = this.track, a = this._tmp, b = this._tmp2;
    this.locals.forEach((r, i) => {
      const c = this.cams[i], cam = c.cam, rp = r.m.root.position;
      const fx = Math.sin(r.psi), fz = Math.cos(r.psi), boost = r.boostT > 0 ? 1 : 0;
      const Z = [[6.4, 2.9, 1.3], [4.5, 2.3, 1.1], [3.0, 1.75, 0.95]][this.zoom], camH = Z[1];
      const dist = Z[0] + boost * 1.0, th = T.phiAt(r.s) - r.psi;
      a.set(rp.x - fx * dist, rp.y + camH, rp.z - fz * dist);
      const minY = T.heightAt(r.s - Math.cos(th) * dist, r.u - Math.sin(th) * dist) + Z[2];
      if (a.y < minY) a.y = minY;
      b.set(rp.x + fx * 7, rp.y + 1.1, rp.z + fz * 7);
      if (!c.init) { cam.position.copy(a); c.look.copy(b); c.init = true; }
      else { cam.position.lerp(a, damp(dt, 7)); cam.position.y = lerp(cam.position.y, a.y, damp(dt, 10)); c.look.lerp(b, damp(dt, 12)); }
      if (this.phase === 'count') { const k = clamp((this.countT - 1) / 3, 0, 1), ang = k * 2.2; cam.position.set(rp.x - Math.sin(r.psi + ang) * (dist + k * 6), rp.y + 2.9 + k * 3, rp.z - Math.cos(r.psi + ang) * (dist + k * 6)); c.look.copy(b).lerp(rp, k); }
      if (cam.position.y < minY - 0.4 && this.phase !== 'count') cam.position.y = minY - 0.4;
      cam.lookAt(c.look);
      const fov = 78 + clamp(r.v / 40, 0, 1) * 8 + boost * 10;
      c.fov = lerp(c.fov, fov, damp(dt, 5));
      if (Math.abs(cam.fov - c.fov) > 0.05) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
    });
  }

  render() {
    const rn = this.renderer, H = innerHeight;
    rn.setScissorTest(false); rn.setClearColor(0x000000); rn.clear();
    rn.setScissorTest(true);
    this.vps.forEach((v, i) => {
      const cam = this.cams[i].cam;
      rn.setViewport(v.x, H - v.y - v.h, v.w, v.h); rn.setScissor(v.x, H - v.y - v.h, v.w, v.h);
      this.sky.position.copy(cam.position);
      rn.render(this.scene, cam);
    });
    rn.setScissorTest(false);
  }

  dispose() {
    this.input.capture = false; this.audio.stopRide();
    if (this.online) for (const k of ['s', 'ai', 'ev', 'left']) delete this.net.on[k];
    for (const h of this.huds) h.el.remove(); this.center.remove();
    for (const r of this.riders) r.dispose();
    this.hazards.dispose(); for (const p of this.projs) { p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
    this.track.dispose(); this.sky.geometry.dispose(); this.sky.material.map.dispose(); this.sky.material.dispose();
    this.goatGeo.dispose(); this.mudGeo.dispose(); this.propMat.dispose(); this.fx.pts.geometry.dispose(); this.fx.pts.material.dispose();
  }
}
