// Environmental hazards: animals, people, vehicles, tornadoes and geysers.
// Everything moves as a pure function of race time, so every online player sees the same thing.
import * as THREE from 'three';
import { mulberry32, clamp } from './util.js';

const L = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
const G = { sph: new THREE.SphereGeometry(1, 10, 8), cyl: new THREE.CylinderGeometry(1, 1, 1, 8), box: new THREE.BoxGeometry(1, 1, 1), cone: new THREE.ConeGeometry(1, 1, 7), ico: new THREE.IcosahedronGeometry(1, 1), ring: new THREE.CylinderGeometry(1, 0.72, 1, 14, 1, true) };
const M = (geo, mat, sx, sy, sz, x = 0, y = 0, z = 0, rx = 0, rz = 0) => { const m = new THREE.Mesh(G[geo], mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); return m; };
const tri = (x) => { const f = x - Math.floor(x); return f < 0.5 ? f * 4 - 1 : 3 - f * 4; };

function stripeMat() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#16161a';
  for (let x = 0; x < 64; x += 9) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 4, 0); g.lineTo(x + 7, 64); g.lineTo(x + 2, 64); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1);
  return new THREE.MeshLambertMaterial({ map: t });
}

// four-legged animal facing +z. o: {len, r, leg, col, head, horns, antlers, trunk, tail}
function quadruped(o, own) {
  const g = new THREE.Group(), body = o.mat || L(o.col), dark = L(o.dark ?? 0x2a2420), head = L(o.head ?? o.col);
  own.push(body, dark, head);
  const by = o.leg + o.r * 0.9;
  g.add(M('sph', body, o.r, o.r * 0.95, o.len / 2, 0, by, 0));
  const hz = o.len / 2 + o.r * 0.35, hy = by + o.r * (o.trunk ? 0.3 : 0.75), hr = o.r * (o.trunk ? 0.7 : 0.48);
  g.add(M('sph', body, o.r * 0.55, o.r * 0.7, o.r * 0.6, 0, by + o.r * 0.45, o.len / 2 - o.r * 0.1), M('sph', head, hr * 0.8, hr * 0.85, hr * 1.25, 0, hy, hz));
  if (o.horns) for (const x of [-1, 1]) g.add(M('cone', dark, 0.06 * o.horns, 0.5 * o.horns, 0.06 * o.horns, x * hr * 0.6, hy + hr * 0.9, hz - 0.05, -0.3, -x * 0.5));
  if (o.antlers) for (const x of [-1, 1]) { g.add(M('cyl', dark, 0.03, 0.7, 0.03, x * 0.16, hy + 0.5, hz - 0.1, 0, -x * 0.35), M('cyl', dark, 0.025, 0.35, 0.025, x * 0.33, hy + 0.7, hz - 0.1, 0, -x * 1.0)); }
  if (o.trunk) { g.add(M('cyl', body, 0.2, 1.5, 0.2, 0, hy - 0.8, hz + hr * 0.9, 0.25), M('sph', body, 0.75, 0.9, 0.12, -hr * 1.1, hy + 0.1, hz - 0.3), M('sph', body, 0.75, 0.9, 0.12, hr * 1.1, hy + 0.1, hz - 0.3)); for (const x of [-1, 1]) g.add(M('cone', L(0xf4f0e0), 0.07, 0.8, 0.07, x * 0.35, hy - 0.5, hz + hr * 0.8, 1.9)); }
  if (o.tail !== false) g.add(M('cyl', dark, 0.035, o.r * 1.1, 0.035, 0, by - o.r * 0.1, -o.len / 2 - 0.02, 0.4));
  const legs = [];
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const p = new THREE.Group(); p.position.set(x * o.r * 0.55, o.leg + o.r * 0.3, z * (o.len / 2 - o.r * 0.45));
    p.add(M('cyl', o.legCol ? L(o.legCol) : body, o.r * 0.2, o.leg + o.r * 0.3, o.r * 0.2, 0, -(o.leg + o.r * 0.3) / 2, 0));
    g.add(p); legs.push(p);
  }
  return { g, anim: (t, sp) => legs.forEach((p, i) => (p.rotation.x = Math.sin(t * sp + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.55)) };
}
function human(o, own) {
  const g = new THREE.Group(), shirt = L(o.shirt), pants = L(o.pants ?? 0x2e3442), skin = L(o.skin ?? 0xd9a070), pack = L(o.pack ?? 0xc8482a);
  own.push(shirt, pants, skin, pack);
  g.add(M('sph', shirt, 0.21, 0.33, 0.14, 0, 1.2, 0), M('sph', skin, 0.12, 0.14, 0.12, 0, 1.66, 0), M('sph', L(o.hat ?? 0x3a2a1a), 0.13, 0.08, 0.13, 0, 1.76, 0));
  if (o.backpack) g.add(M('box', pack, 0.3, 0.42, 0.18, 0, 1.25, -0.2));
  const limbs = [];
  for (const x of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(x * 0.1, 0.9, 0); leg.add(M('cyl', pants, 0.075, 0.9, 0.075, 0, -0.45, 0)); g.add(leg);
    const arm = new THREE.Group(); arm.position.set(x * 0.25, 1.42, 0); arm.add(M('cyl', shirt, 0.05, 0.6, 0.05, 0, -0.3, 0)); g.add(arm);
    limbs.push([leg, x], [arm, -x]);
  }
  return { g, anim: (t, sp) => limbs.forEach(([p, s]) => (p.rotation.x = Math.sin(t * sp) * 0.6 * s)) };
}
function vehicle(o, own, rnd) {
  const g = new THREE.Group(), cols = [0xd62a2a, 0x2a6fd6, 0xf2f2f2, 0xf2c21a, 0x2a2a30, 0x3aa86a, 0xc0c4cc];
  const body = L(o.col ?? cols[(rnd() * cols.length) | 0]), glass = L(0x1a2630), tyre = L(0x141416), lamp = new THREE.MeshBasicMaterial({ color: 0xfff6c8 }), red = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  own.push(body, glass, tyre, lamp, red);
  if (o.scooter) {
    g.add(M('box', body, 0.34, 0.45, 1.25, 0, 0.55, 0), M('box', body, 0.3, 0.8, 0.12, 0, 0.95, 0.55), M('sph', lamp, 0.09, 0.09, 0.05, 0, 1.2, 0.63));
    for (const z of [-0.55, 0.6]) g.add(M('cyl', tyre, 0.24, 0.12, 0.24, 0, 0.24, z, 0, Math.PI / 2));
    const h = human({ shirt: 0xf2f2f2, hat: 0xd62a2a }, own); h.g.scale.setScalar(0.85); h.g.position.set(0, 0.05, -0.1); g.add(h.g);
    return { g, anim: () => {} };
  }
  const jeep = o.jeep, w = jeep ? 1.9 : 1.75, len = jeep ? 4.0 : 4.3, h0 = jeep ? 0.75 : 0.5;
  g.add(M('box', body, w, jeep ? 0.75 : 0.6, len, 0, h0 + 0.3, 0), M('box', glass, w * 0.9, 0.55, len * (jeep ? 0.5 : 0.48), 0, h0 + 0.9, -0.25), M('box', body, w * 0.92, 0.07, len * (jeep ? 0.52 : 0.46), 0, h0 + 1.2, -0.25));
  for (const x of [-1, 1]) { g.add(M('sph', lamp, 0.16, 0.12, 0.05, x * w * 0.33, h0 + 0.38, len / 2), M('box', red, 0.3, 0.12, 0.05, x * w * 0.33, h0 + 0.38, -len / 2)); for (const z of [-1, 1]) g.add(M('cyl', tyre, jeep ? 0.42 : 0.33, 0.25, jeep ? 0.42 : 0.33, x * w * 0.48, jeep ? 0.42 : 0.33, z * len * 0.31, 0, Math.PI / 2)); }
  if (jeep) g.add(M('cyl', tyre, 0.4, 0.22, 0.4, 0, h0 + 0.5, -len / 2 - 0.12, Math.PI / 2));
  return { g, anim: () => {} };
}

// kind -> { build, r (collision radius), h (height), speed m/s, hit (takeHit kind), sound, herd }
const KINDS = {
  yak: { q: { len: 2.3, r: 0.62, leg: 0.6, col: 0x2a2018, head: 0x1c1410, horns: 1.2 }, r: 1.3, h: 2, speed: 2.4, hit: 'animal', snd: 'moo' },
  goat: { q: { len: 1.15, r: 0.3, leg: 0.42, col: 0xe8e0d0, horns: 0.6 }, r: 0.75, h: 1.2, speed: 3.6, hit: 'animal', snd: 'bleat', herd: 2 },
  ram: { q: { len: 1.4, r: 0.38, leg: 0.5, col: 0x9a7a58, head: 0xb89a78, horns: 0.9 }, r: 0.85, h: 1.4, speed: 4.5, hit: 'animal', snd: 'bleat' },
  sheep: { q: { len: 1.3, r: 0.46, leg: 0.34, col: 0xf0ece2, head: 0x2a2420, legCol: 0x2a2420 }, r: 0.85, h: 1.3, speed: 2.2, hit: 'animal', snd: 'bleat', herd: 3 },
  deer: { q: { len: 1.6, r: 0.36, leg: 0.8, col: 0xa8784a, antlers: true }, r: 0.9, h: 1.8, speed: 6.5, hit: 'animal', snd: 'thud' },
  boar: { q: { len: 1.3, r: 0.4, leg: 0.3, col: 0x3a2e28 }, r: 0.8, h: 1.1, speed: 5.5, hit: 'animal', snd: 'thud' },
  zebra: { q: { len: 2.0, r: 0.48, leg: 0.8, col: 0xf2f0ea, stripes: true, legCol: 0xd8d6d0 }, r: 1.05, h: 1.9, speed: 6.5, hit: 'animal', snd: 'thud', herd: 3 },
  elephant: { q: { len: 3.6, r: 1.25, leg: 1.3, col: 0x7a7a80, trunk: true }, r: 2.3, h: 4, speed: 1.7, hit: 'animal', snd: 'trumpet' },
  camel: { q: { len: 2.4, r: 0.6, leg: 1.25, col: 0xc8a06a, head: 0xb89058 }, r: 1.3, h: 2.8, speed: 2.6, hit: 'animal', snd: 'moo', herd: 3 },
  bear: { q: { len: 1.9, r: 0.72, leg: 0.5, col: 0x2e2218, head: 0x3a2c20, tail: false }, r: 1.3, h: 1.9, speed: 4.2, hit: 'animal', snd: 'moo' },
  dog: { q: { len: 0.85, r: 0.2, leg: 0.3, col: 0x9a6a3a }, r: 0.55, h: 0.8, speed: 5.5, hit: 'small', snd: 'thud' },
  tumbleweed: { roll: 0.7, col: 0x9a7a4a, r: 0.8, h: 1.4, speed: 7, hit: 'small', snd: 'thud', wire: true },
  boulder: { roll: 1.5, col: 0x7a746c, r: 1.6, h: 3, speed: 8, hit: 'animal', snd: 'thud' },
  hiker: { p: { shirt: 0xd8482a, backpack: true, hat: 0x3a5a2a }, r: 0.55, h: 1.9, speed: 1.4, hit: 'person', snd: 'hey' },
  tourist: { p: { shirt: 0xf2c21a, hat: 0xf4f0e0, pants: 0x4a6a9a }, r: 0.55, h: 1.9, speed: 1.3, hit: 'person', snd: 'hey' },
  skier: { p: { shirt: 0x2a6fd6, hat: 0xd62a2a, pants: 0x1a1a22 }, r: 0.6, h: 1.9, speed: 9, hit: 'person', snd: 'hey' },
  pedestrian: { p: { shirt: 0x3a7ac8, pants: 0x2a2a30 }, r: 0.55, h: 1.9, speed: 1.6, hit: 'person', snd: 'hey' },
  car: { v: {}, r: 1.5, h: 1.8, speed: 11, hit: 'car', snd: 'carhorn', box: [1.05, 2.3] },
  jeep: { v: { jeep: true, col: 0x6a7a4a }, r: 1.6, h: 2.2, speed: 9, hit: 'car', snd: 'carhorn', box: [1.1, 2.2] },
  scooter: { v: { scooter: true }, r: 0.7, h: 1.8, speed: 13, hit: 'person', snd: 'carhorn' },
};

export class Hazards {
  constructor(game) {
    this.game = game; const T = (this.T = game.track), level = game.level, rnd = mulberry32(level.seed + 4242);
    this.list = []; this.live = []; this.own = []; this.grp = new THREE.Group(); game.scene.add(this.grp);
    this.stripes = null; this.tornadoVol = 0;
    const Lg = T.length, clear = (s) => !T.jumps.some((j) => s > j.s - j.len - 4 && s < j.s + 34) && !T.drops.some((d) => Math.abs(d.s - s) < 30) && !T.stair[Math.round(s / 2)];
    const range = Math.min(T.edge - 2, 26);
    for (const hz of level.hazards) {
      if (hz.t === 'cross') {
        for (let s = 280 + rnd() * hz.every; s < Lg - 200; s += hz.every * (0.7 + rnd() * 0.6)) {
          if (!clear(s) || (T.city && T.crossings.some((c) => Math.abs(c - s) < 20))) continue;
          const K = KINDS[hz.k], n = K.herd ? 1 + ((rnd() * K.herd) | 0) : 1, ph = rnd();
          for (let i = 0; i < n; i++) this._add({ t: 'cross', k: hz.k, s: s + i * (K.r * 2 + 1.2), ph: ph + i * 0.035, A: range }, rnd);
        }
      } else if (hz.t === 'walk') {
        for (let s = 240 + rnd() * hz.every; s < Lg - 200; s += hz.every * (0.7 + rnd() * 0.6)) this._add({ t: 'walk', k: hz.k, s, ph: rnd(), side: rnd() < 0.5 ? -1 : 1 }, rnd);
      } else if (hz.t === 'traffic') {
        const n = Math.max(1, Math.round(Lg / hz.every)), span = Lg - 420;
        for (let i = 0; i < n; i++) this._add({ t: 'traffic', k: hz.k, off: (i + rnd() * 0.6) / n * span, span, lane: T.level.route.road ? -2.5 : (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 3) }, rnd);
      } else if (hz.t === 'crosscar') {
        for (const c of T.crossings) this._add({ t: 'crosscar', k: rnd() < 0.25 ? 'scooter' : 'car', s: c, ph: rnd() * 120, dir: rnd() < 0.5 ? -1 : 1, sp: 9 + rnd() * 5 }, rnd);
      } else if (hz.t === 'parked') {
        let side = 1;
        for (let s = 110 + rnd() * 30; s < Lg - 120; s += hz.every * (0.6 + rnd() * 0.9)) {
          if (!clear(s) || T.crossings.some((c) => Math.abs(c - s) < 16)) continue;
          side = -side; const u = side * (T.trailW - 1.5), h = this._add({ t: 'parked', k: 'car', s, u }, rnd);
          T.ground(s, u, h.obj.g.position); h.obj.g.rotation.y = T.phiAt(s) + (side > 0 ? 0 : Math.PI);
          T.addObstacle(s - 1.2, u, 1.15, 1.7); T.addObstacle(s + 1.2, u, 1.15, 1.7);
        }
      } else if (hz.t === 'tornado') {
        for (let i = 0; i < hz.n; i++) this._add({ t: 'tornado', s: Lg * (0.22 + 0.6 * (i + 0.5) / hz.n), p1: rnd() * 6, p2: rnd() * 6, ph: rnd() * 40 }, rnd);
      } else if (hz.t === 'geyser') {
        for (let s = 300 + rnd() * hz.every; s < Lg - 220; s += hz.every * (0.7 + rnd() * 0.6)) if (clear(s)) this._add({ t: 'geyser', s, u: T.trailAt(s) + (rnd() - 0.5) * T.trailW * 1.6, ph: rnd() * 7 }, rnd);
      }
    }
  }

  _add(h, rnd) {
    const K = KINDS[h.k]; let obj;
    if (h.t === 'tornado') {
      const g = new THREE.Group(), rings = [], mat = new THREE.MeshBasicMaterial({ color: this.game.level.sky.night || this.game.level.tex.a === 'snow_02' ? 0xe8f4ff : 0xc8a47a, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
      this.own.push(mat);
      for (let i = 0; i < 11; i++) { const r = 1.3 + i * 0.75, m = M('ring', mat, r, 2.6, r, 0, 1.3 + i * 2.4, 0); g.add(m); rings.push(m); }
      obj = { g, rings, mat };
    } else if (h.t === 'geyser') {
      const g = new THREE.Group(), glow = new THREE.MeshBasicMaterial({ color: 0xff6a1a }), jet = new THREE.MeshBasicMaterial({ color: 0xffd8a0, transparent: true, opacity: 0.55, depthWrite: false });
      this.own.push(glow, jet);
      const col = M('cyl', jet, 0.8, 14, 0.8, 0, 7, 0); col.visible = false;
      g.add(M('cone', L(0x1a181c), 2.2, 0.7, 2.2, 0, 0.3, 0), M('cyl', glow, 0.9, 0.12, 0.9, 0, 0.68, 0), col);
      this.T.ground(h.s, h.u, g.position, -0.1); obj = { g, col };
    } else if (K.q) { if (K.q.stripes) K.q.mat = this.stripes || (this.stripes = stripeMat()); obj = quadruped(K.q, this.own); }
    else if (K.p) obj = human(K.p, this.own);
    else if (K.v) obj = vehicle(K.v, this.own, rnd);
    else { const mat = K.wire ? new THREE.MeshBasicMaterial({ color: K.col, wireframe: true }) : L(K.col, { flatShading: true }); this.own.push(mat); const g = new THREE.Group(), ball = M('ico', mat, K.roll, K.roll, K.roll, 0, K.roll, 0); g.add(ball); obj = { g, ball, anim: (t, sp) => (ball.rotation.x = t * sp) }; }
    h.obj = obj; h.K = K; h.u = h.u ?? 0; h.vu = 0; h.warned = 0; h.r = K ? K.r : 0;
    this.grp.add(obj.g); this.list.push(h);
    return h;
  }

  update(dt, t) {
    const T = this.T, g = this.game, live = (this.live = []);
    let storm = 0;
    for (const h of this.list) {
      if (h.t === 'parked') continue;
      const K = h.K, o = h.obj;
      let near = 1e9; for (const r of g.locals) near = Math.min(near, Math.abs(r.s - h.s));
      if (h.t === 'cross') {
        const A = h.A, x = t * K.speed / (4 * A) + h.ph, tu = T.trailAt(h.s);
        h.u = clamp(tu + A * tri(x), -T.edge + 1, T.edge - 1); h.vu = (x - Math.floor(x) < 0.5 ? 1 : -1) * K.speed;
        o.g.rotation.y = T.phiAt(h.s) + (h.vu > 0 ? -Math.PI / 2 : Math.PI / 2);
      } else if (h.t === 'walk') {
        const x = t * K.speed / 56 + h.ph; h.s0 ??= h.s; h.s = h.s0 + 14 * tri(x);
        h.u = T.trailAt(h.s) + h.side * Math.max(1.6, T.trailW * 0.7);
        o.g.rotation.y = T.phiAt(h.s) + (x - Math.floor(x) < 0.5 ? 0 : Math.PI);
      } else if (h.t === 'traffic') {
        h.s = T.length - 210 - ((t * K.speed + h.off) % h.span); h.u = T.trailAt(h.s) + h.lane;
        o.g.rotation.y = T.phiAt(h.s) + Math.PI;
        o.g.rotation.x = Math.atan((T.heightAt(h.s + 2, h.u) - T.heightAt(h.s - 2, h.u)) / 4);
      } else if (h.t === 'crosscar') {
        h.u = h.dir * (-45 + ((t * h.sp + h.ph) % 130)); h.vu = h.dir * h.sp;
        o.g.rotation.y = T.phiAt(h.s) + (h.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
        o.g.visible = Math.abs(h.u) < T.half - 2 && near < 380;
      } else if (h.t === 'tornado') {
        h.s0 ??= h.s; h.s = h.s0 + 60 * Math.sin(0.21 * t + h.p1); h.u = (T.edge - 7) * Math.sin(0.37 * t + h.p2);
        const cyc = (t + h.ph) % 40, k = clamp(Math.min(cyc, 27 - cyc) / 2.5, 0, 1); h.on = k > 0.5;
        o.g.visible = k > 0 && near < 420; o.g.scale.set(k, 0.4 + 0.6 * k, k); o.mat.opacity = 0.42 * k;
        o.rings.forEach((m, i) => { m.rotation.y = t * (5 - i * 0.25) + i; m.position.x = Math.sin(t * 2.2 + i * 0.7) * i * 0.16; m.position.z = Math.cos(t * 1.7 + i * 0.6) * i * 0.16; });
        T.ground(h.s, h.u, o.g.position);
        if (o.g.visible && Math.random() < 0.6) g.fx.burst(o.g.position, 2, g.dust, 16, 14, 1.1);
        if (k > 0) for (const r of g.locals) storm = Math.max(storm, k * clamp(1 - Math.hypot(r.s - h.s, r.u - h.u) / 90, 0, 1));
        if (h.on) live.push({ s: h.s, u: h.u, r: 7, vu: 0 });
      } else if (h.t === 'geyser') {
        const cyc = (t + h.ph) % 7; h.on = cyc < 1.6; o.col.visible = h.on && near < 300;
        if (near < 300) {
          if (h.on) { o.col.scale.set(0.6 + Math.random() * 0.4, 12 + Math.random() * 4, 0.6 + Math.random() * 0.4); if (Math.random() < 0.7) g.fx.burst(o.g.position, 3, [0xff7a1e, 0xffd23e, 0xffffff], 5, 22, 1.1); }
          else if (cyc > 6 && Math.random() < 0.3) g.fx.burst(o.g.position, 1, 0xffffff, 1, 5, 0.6);
          if (h.on && !h.was && near < 110) g.audio.play('geyser', clamp(1 - near / 110, 0, 1));
        }
        h.was = h.on; live.push({ s: h.s, u: h.u, r: 2.4, vu: 0 });
      }
      if (K) {
        if (h.t !== 'crosscar') o.g.visible = near < 380;
        if (o.g.visible) { T.ground(h.s, h.u, o.g.position); o.anim(t, K.speed * (K.roll ? 1 / K.roll : K.q ? 3.2 / (K.q.leg + 0.4) : 5)); }
        if (h.t !== 'crosscar' || Math.abs(h.u) < T.edge + 4) live.push(h);
        // warning toot / shout as a local rider closes in
        if (h.t === 'traffic' && t > h.warned) for (const r of g.locals) { const d = r.s - h.s; if (d < -8 && d > -70 && Math.abs(r.u - h.u) < 4) { g.audio.play('carhorn', 0.8); h.warned = t + 4; } }
      }
      // collisions with riders this client simulates
      for (const r of g.riders) {
        if (!r.owned || r.crashT > 0 || r.hazCd > 0 || r.invT > 0) continue;
        const ds = r.s - h.s, du = r.u - h.u;
        if (Math.abs(ds) > 9 || Math.abs(du) > 9) continue;
        let hit;
        if (h.t === 'tornado') hit = h.on && ds * ds + du * du < 36;
        else if (h.t === 'geyser') hit = h.on && ds * ds + du * du < 7 && r.y - T.heightAt(h.s, h.u) < 3;
        else if (K.box) { const along = h.t === 'crosscar'; hit = Math.abs(along ? du : ds) < K.box[1] + 0.3 && Math.abs(along ? ds : du) < K.box[0] + 0.4 && r.y - T.heightAt(h.s, h.u) < K.h; }
        else hit = ds * ds + du * du < (K.r + 0.4) ** 2 && r.y - T.heightAt(h.s, h.u) < K.h;
        if (!hit) continue;
        r.hazCd = 1.2;
        const kind = h.t === 'tornado' ? 'tornado' : h.t === 'geyser' ? 'geyser' : K.hit === 'person' && r.v < 9 ? 'small' : K.hit;
        if (r.takeHit(kind, Math.sign(du) || 1)) g.onHazard(r, h, kind);
      }
    }
    this.tornadoVol = storm; g.audio.setStorm(storm);
  }

  dispose() {
    this.game.scene.remove(this.grp); this.game.audio.setStorm(0);
    for (const m of this.own) { if (m.map) m.map.dispose(); m.dispose(); }
    if (this.stripes) { this.stripes.map.dispose(); this.stripes.dispose(); }
  }
}
