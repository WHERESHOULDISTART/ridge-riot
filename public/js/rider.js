// Rider: articulated bike + rider model (IK legs/arms), arcade downhill physics, stunts and AI brain.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, damp } from './util.js';
import { BIKES, COLORS } from './levels.js';

export const G = 13;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const hexCss = (h) => '#' + h.toString(16).padStart(6, '0');

const shared = {};
function mats() {
  if (!shared.black) {
    const L = (o) => new THREE.MeshLambertMaterial(o);
    shared.black = L({ color: 0x141416 }); shared.metal = L({ color: 0xb8bcc4 }); shared.gold = L({ color: 0xc8a040 });
    shared.skin = L({ color: 0xd9a070 }); shared.pants = L({ color: 0x26282f }); shared.visor = L({ color: 0x0c1418 }); shared.white = L({ color: 0xf4f4f4 });
    shared.pad = L({ color: 0x3a3c44 });
    shared.shadow = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    shared.shadowGeo = new THREE.CircleGeometry(0.95, 14).rotateX(-Math.PI / 2);
    shared.bubble = new THREE.MeshBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.3, depthWrite: false });
    shared.flame = new THREE.MeshBasicMaterial({ color: 0xff8a1e, transparent: true, opacity: 0.85, depthWrite: false });
    shared.ice = new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.45, depthWrite: false });
    // spoked wheel disc (alpha texture)
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.translate(64, 64);
    g.strokeStyle = '#fff'; g.lineWidth = 7; g.beginPath(); g.arc(0, 0, 58, 0, 7); g.stroke();
    g.strokeStyle = '#c8ccd4'; g.lineWidth = 1.6;
    for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU; g.beginPath(); g.moveTo(Math.cos(a + 0.5) * 8, Math.sin(a + 0.5) * 8); g.lineTo(Math.cos(a) * 56, Math.sin(a) * 56); g.stroke(); }
    g.fillStyle = '#9aa0aa'; g.beginPath(); g.arc(0, 0, 22, 0, 7); g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(0, 0, 17, 0, 7); g.fill();
    g.globalCompositeOperation = 'source-over'; g.fillStyle = '#44484f'; g.beginPath(); g.arc(0, 0, 8, 0, 7); g.fill();
    shared.spokeTex = new THREE.CanvasTexture(c); shared.spokeTex.colorSpace = THREE.SRGBColorSpace;
    shared.geo = {
      tube: new THREE.CylinderGeometry(1, 1, 1, 8), sph: new THREE.SphereGeometry(1, 12, 9), box: new THREE.BoxGeometry(1, 1, 1),
      disc: new THREE.CircleGeometry(1, 20).rotateY(Math.PI / 2), cap: new THREE.CapsuleGeometry(1, 2, 4, 10),
    };
  }
  return shared;
}
// unit primitives scaled per use (shared geometry, few buffers)
function tube(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a), m = new THREE.Mesh(shared.geo.tube, mat);
  m.scale.set(r, d.length(), r); m.position.addVectors(a, b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(UP, d.normalize());
  return m;
}
const part = (geo, mat, sx, sy, sz, px = 0, py = 0, pz = 0) => { const m = new THREE.Mesh(shared.geo[geo], mat); m.scale.set(sx, sy, sz); m.position.set(px, py, pz); return m; };
// a limb segment hanging down -y from its pivot (unit capsule is 4 tall)
function seg(len, r, mat) {
  const g = new THREE.Group(), m = new THREE.Mesh(shared.geo.cap, mat);
  m.scale.set(r, len / 4, r); m.position.y = -len / 2; g.add(m);
  return g;
}

function jerseyTex(Cc, num) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = hexCss(Cc.a); g.fillRect(0, 0, 256, 128);
  g.fillStyle = hexCss(Cc.b); g.fillRect(0, 0, 256, 20); g.fillRect(52, 0, 14, 128); g.fillRect(190, 0, 14, 128);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 100, 256, 28);
  g.font = '900 64px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.fillStyle = hexCss(Cc.b);
  g.strokeText(num, 128, 66); g.fillText(num, 128, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}

const L_THIGH = 0.45, L_SHIN = 0.46, L_UARM = 0.3, L_FARM = 0.3, CRANK = 0.17;

export function buildBike(bikeIdx, colorIdx, num = 7) {
  const B = BIKES[bikeIdx], Cc = COLORS[colorIdx], S = mats();
  const mA = new THREE.MeshLambertMaterial({ color: Cc.a }), mB = new THREE.MeshLambertMaterial({ color: Cc.b });
  const jt = jerseyTex(Cc, String(num)), mJ = new THREE.MeshLambertMaterial({ map: jt });
  const mRim = new THREE.MeshLambertMaterial({ map: S.spokeTex, color: Cc.b, alphaTest: 0.4, side: THREE.DoubleSide });
  const root = new THREE.Group(), tilt = new THREE.Group(), body = new THREE.Group();
  tilt.position.y = 0.8; body.position.y = -0.8; tilt.add(body); root.add(tilt);
  root.scale.setScalar(1.18);
  const R = B.wheel, th = 0.02 + 0.012 * B.fat, tw = 0.028 + 0.016 * B.fat;

  const wheel = (z) => {
    const g = new THREE.Group(); g.position.set(0, R, z);
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(R - tw, tw, 7, 22).rotateY(Math.PI / 2), S.black);
    g.add(tyre, part('disc', mRim, 1, R - tw * 1.2, R - tw * 1.2), part('disc', S.metal, 1, 0.075, 0.075, 0.035));
    body.add(g); return g;
  };
  const wF = wheel(0.64), wR = wheel(-0.56);
  const seat = V3(0, 0.88, -0.26), head = V3(0, 0.98, 0.4), headLo = V3(0, 0.84, 0.44), bb = V3(0, 0.36, 0.02);
  body.add(tube(seat, head, th, mA), tube(headLo, bb, th * 1.35, mA), tube(bb, seat, th, mA), tube(head, headLo, th * 1.3, mA));
  for (const x of [-0.055, 0.055]) {
    body.add(tube(V3(x, 0.38, 0), V3(x, R, -0.56), th * 0.7, mB), tube(V3(x * 0.6, 0.86, -0.25), V3(x, R, -0.56), th * 0.6, mB));
    body.add(tube(V3(x, 0.9, 0.43), V3(x, 0.62, 0.53), 0.017, S.gold), tube(V3(x, 0.64, 0.525), V3(x, R, 0.64), 0.024, S.black));
  }
  body.add(tube(V3(-0.1, 0.9, 0.43), V3(0.1, 0.9, 0.43), 0.02, S.black), tube(head, V3(0, 1.07, 0.36), 0.02, S.black));
  body.add(tube(V3(-0.36, 1.08, 0.35), V3(0.36, 1.08, 0.35), 0.015, S.black), tube(V3(-0.37, 1.08, 0.35), V3(-0.27, 1.08, 0.35), 0.021, mB), tube(V3(0.27, 1.08, 0.35), V3(0.37, 1.08, 0.35), 0.021, mB));
  body.add(tube(V3(0, 0.82, -0.26), V3(0, 0.95, -0.28), 0.016, S.metal), part('sph', S.black, 0.075, 0.03, 0.15, 0, 0.965, -0.29), tube(V3(0, 0.6, -0.1), V3(0, 0.74, 0.1), 0.022, S.gold));
  body.add(part('box', S.white, 0.2, 0.17, 0.02, 0, 1.0, 0.47));
  const crank = new THREE.Group(); crank.position.copy(bb);
  crank.add(part('disc', S.metal, 1, 0.095, 0.095, -0.05), tube(V3(-0.1, 0, 0), V3(-0.1, -CRANK, 0), 0.014, S.black), tube(V3(0.1, 0, 0), V3(0.1, CRANK, 0), 0.014, S.black), tube(V3(-0.1, 0, 0), V3(0.1, 0, 0), 0.02, S.metal));
  const pedR = part('box', S.black, 0.11, 0.025, 0.09, -0.16, -CRANK, 0), pedL = part('box', S.black, 0.11, 0.025, 0.09, 0.16, CRANK, 0);
  crank.add(pedR, pedL); body.add(crank);

  // ---- rider
  const rider = new THREE.Group(); body.add(rider);
  rider.add(part('sph', S.pants, 0.17, 0.12, 0.14, 0, 0.02, 0));
  const torso = new THREE.Group(); rider.add(torso);
  const chest = new THREE.Mesh(S.geo.cap, mJ); chest.scale.set(0.175, 0.105, 0.115); chest.position.y = 0.27;
  torso.add(chest, part('sph', mJ, 0.21, 0.09, 0.12, 0, 0.47, 0), part('box', mB, 0.2, 0.26, 0.07, 0, 0.3, -0.13));
  const hd = new THREE.Group(); hd.position.set(0, 0.6, 0.02); torso.add(hd);
  hd.add(tube(V3(0, -0.08, 0), V3(0, 0.02, 0), 0.05, S.skin), part('sph', mA, 0.135, 0.14, 0.16, 0, 0.09, 0.01), part('sph', S.skin, 0.09, 0.09, 0.06, 0, 0.06, 0.11));
  hd.add(part('box', S.visor, 0.2, 0.065, 0.06, 0, 0.09, 0.14), part('box', mA, 0.16, 0.06, 0.1, 0, 0.0, 0.15), part('box', mB, 0.2, 0.018, 0.14, 0, 0.17, 0.16), part('box', mB, 0.03, 0.1, 0.24, 0, 0.2, 0.0));
  const arm = (x) => {
    const up = seg(L_UARM, 0.052, mJ); up.position.set(x, 0.47, 0);
    const fo = seg(L_FARM, 0.042, S.skin); fo.position.y = -L_UARM; fo.add(part('sph', S.black, 0.05, 0.055, 0.05, 0, -L_FARM, 0), part('sph', S.pad, 0.055, 0.06, 0.055, 0, -0.02, 0));
    up.add(fo); torso.add(up); return { up, fo };
  };
  const armL = arm(0.2), armR = arm(-0.2);
  const leg = (x) => {
    const thigh = seg(L_THIGH, 0.078, S.pants); thigh.position.set(x, 0, 0);
    const shin = seg(L_SHIN - 0.06, 0.052, S.skin); shin.position.y = -L_THIGH;
    shin.add(part('sph', S.pad, 0.07, 0.085, 0.075, 0, -0.02, 0.02), part('box', mB, 0.1, 0.085, 0.25, 0, -L_SHIN + 0.03, 0.06), part('box', S.white, 0.095, 0.1, 0.1, 0, -L_SHIN + 0.11, 0));
    thigh.add(shin); rider.add(thigh); return { thigh, shin, x };
  };
  const legL = leg(0.11), legR = leg(-0.11);

  // effects
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(1.3, 14, 10), S.bubble); bubble.position.y = 0.9; bubble.visible = false; root.add(bubble);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.26, 1.6, 7), S.flame); flame.rotation.x = -Math.PI / 2; flame.position.set(0, 0.5, -1.55); flame.visible = false; body.add(flame);
  const ice = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 2.0), S.ice); ice.position.y = 0.95; ice.visible = false; root.add(ice);
  return { root, tilt, body, wF, wR, crank, pedL, pedR, rider, torso, hd, armL, armR, legL, legR, bubble, flame, ice, R, bb, own: [mA, mB, mJ, mRim, jt, wF.children[0].geometry, wR.children[0].geometry, bubble.geometry, flame.geometry, ice.geometry] };
}

// Pose the rider: IK legs to the pedals and arms to the grips, blended with stunt poses.
// k: { crankA, stand, sup, noh, kickL, kickR, throwK, steer, land }
export function poseBike(m, k) {
  const tau = lerp(lerp(0.74, 0.96, k.stand), 1.38, k.sup) - k.noh * 0.75;
  const hipY = lerp(lerp(0.985, 1.07, k.stand), 1.16, k.sup) - k.land * 0.1, hipZ = lerp(lerp(-0.25, -0.13, k.stand), -0.66, k.sup);
  m.rider.position.set(0, hipY, hipZ); m.torso.rotation.set(tau, 0, -k.steer * 0.12); m.hd.rotation.x = -tau * 0.78 + 0.1;
  m.crank.rotation.x = k.crankA; m.pedL.rotation.x = m.pedR.rotation.x = -k.crankA;
  const ca = Math.cos(k.crankA), sa = Math.sin(k.crankA);
  const legIK = (L, sign, kick) => {
    const fy = m.bb.y + sign * CRANK * ca + 0.1, fz = m.bb.z + sign * CRANK * sa - 0.03;
    const dy = fy - hipY, dz = fz - hipZ, d = clamp(Math.hypot(dy, dz), 0.2, L_THIGH + L_SHIN - 0.005);
    const a = Math.atan2(dz, -dy), al = Math.acos(clamp((L_THIGH * L_THIGH + d * d - L_SHIN * L_SHIN) / (2 * L_THIGH * d), -1, 1)), be = Math.acos(clamp((L_SHIN * L_SHIN + d * d - L_THIGH * L_THIGH) / (2 * L_SHIN * d), -1, 1));
    const out = Math.max(k.sup, kick);
    L.thigh.rotation.x = lerp(-(a + al), k.sup > kick ? 0.8 : -0.5, out); L.shin.rotation.x = lerp(al + be, 0.12, out);
    L.thigh.rotation.z = Math.sign(L.x) * kick * 1.2;
  };
  legIK(m.legL, 1, k.kickL); legIK(m.legR, -1, k.kickR);
  const sy = hipY + 0.47 * Math.cos(tau), sz = hipZ + 0.47 * Math.sin(tau);
  const dy = 1.1 - sy, dz = 0.34 - sz, d = clamp(Math.hypot(dy, dz), 0.15, L_UARM + L_FARM - 0.004);
  const a = Math.atan2(dz, -dy), al = Math.acos(clamp((L_UARM * L_UARM + d * d - L_FARM * L_FARM) / (2 * L_UARM * d), -1, 1)), be = Math.acos(clamp((L_FARM * L_FARM + d * d - L_UARM * L_UARM) / (2 * L_FARM * d), -1, 1));
  const upX = -(a - al) - tau, foX = -(al + be);
  for (const [A, sgn, thr] of [[m.armL, 1, 0], [m.armR, -1, k.throwK]]) {
    const free = Math.max(k.noh, thr);
    A.up.rotation.x = lerp(upX, thr > 0 ? lerp(-0.4, -3.0, thr) : -2.4, free); A.fo.rotation.x = lerp(foX, thr > 0 ? -0.5 : -0.25, free);
    A.up.rotation.z = sgn * (0.14 + k.noh * 0.9);
  }
}

export function makeTag(name, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'italic 900 34px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.9)'; g.strokeText(name, 128, 34);
  g.fillStyle = color; g.fillText(name, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, sizeAttenuation: false }));
  sp.scale.set(0.2, 0.05, 1);
  return sp;
}

const TIMERS = ['boostT', 'shieldT', 'frozenT', 'slowT', 'springT', 'stunT', 'invT', 'kickT', 'kickCd', 'padCd', 'bumpCd', 'throwT', 'hazCd'];
const blankInput = () => ({ steer: 0, accel: false, brake: false, up: false, down: false, hop: false, trick: false, kl: false, kr: false, klHeld: false, krHeld: false, item: false, boost: false });

export class Rider {
  constructor(game, o) {
    Object.assign(this, { game, T: game.track, id: o.id, name: o.name, bikeIdx: o.bike, colorIdx: o.color, isAI: !!o.isAI, owned: !!o.owned, local: o.local ?? -1 });
    this.B = BIKES[o.bike];
    this.skill = o.skill ?? 1; this.band = 1;
    this.s = 0; this.u = 0; this.y = 0; this.v = 0; this.vy = 0; this.psi = 0; this.pu = 0;
    this.grounded = true; this.airT = 0; this.flip = 0; this.spin = 0; this.pose = 0; this.poseT = [0, 0, 0, 0];
    this.grad = 0; this.gpitch = 0; this.steerSm = 0; this.tumble = 0; this.off = 0; this.landK = 0; this.standK = 0;
    for (const k of TIMERS) this[k] = 0;
    this.crashT = 0; this.kickSide = 0;
    this.nitro = 0.3; this.nitroLock = 0; this.item = null; this.ammo = 0; this.pendingItem = null; this.rouletteT = 0;
    this.score = 0; this.finished = false; this.finishTime = null; this.place = 1;
    this.inp = blankInput(); this.ai = { lane: (Math.random() - 0.5) * Math.min(5, this.T.trailW), itemT: 0, plan: null, wob: Math.random() * 9 };
    this.net = null; this.accelVis = false;
    this.m = buildBike(o.bike, o.color, o.num ?? 1 + Math.floor(Math.random() * 98));
    this.pp = [0, 0, 0, 0, 0]; this.wheelA = 0; this.pedalA = Math.PI / 2;
    this.pk = { crankA: 0, stand: 0, sup: 0, noh: 0, kickL: 0, kickR: 0, throwK: 0, steer: 0, land: 0 };
    game.scene.add(this.m.root);
    this.shadow = new THREE.Mesh(shared.shadowGeo, shared.shadow); game.scene.add(this.shadow);
    if (o.tag !== false) { this.tag = makeTag(o.name, this.isAI ? '#ffd23e' : '#ffffff'); this.tag.position.y = 2.2; this.m.root.add(this.tag); }
  }

  place0(s, u) {
    const T = this.T; this.s = s; this.u = u; this.y = T.heightAt(s, u); this.psi = T.phiAt(s);
    this.v = 0; this.vy = 0; this.grounded = true;
  }

  // ------------------------------------------------------------------ physics
  update(dt, inp) {
    const T = this.T, B = this.B, g = this.game;
    for (const k of TIMERS) if (this[k] > 0) this[k] = Math.max(0, this[k] - dt);
    if (this.rouletteT > 0) { this.rouletteT -= dt; if (this.rouletteT <= 0) { this.item = this.pendingItem; this.ai.itemT = 1 + Math.random() * 3; g.onItemReady(this); } }
    if (this.crashT > 0) return this._crashUpdate(dt);
    this.accelVis = inp.accel;
    // boost bar: trickles up on its own, fills fast in the air, burns while the boost button is held
    // un-stick: pedalling but going nowhere for 3 s puts you back on the trail
    this.stuckT = inp.accel && this.v < 2.5 && !this.finished ? (this.stuckT || 0) + dt : 0;
    if (this.stuckT > 3) { this.stuckT = 0; this.s = Math.min(this.s + 4, T.length - 10); this.u = T.trailAt(this.s); this.y = T.heightAt(this.s, this.u); this.psi = T.phiAt(this.s); this.v = 9; this.vy = 0; this.grounded = true; this.invT = 1.5; }
    // Boost bar. Burning it to zero locks it for 2.5 s: nothing refills it and the button does nothing.
    // Otherwise it trickles up on its own and fills faster in the air (tricks and hits add chunks elsewhere).
    // A burn can only start with at least 10% in the bar; once started it runs until released or empty.
    if (!inp.boost) this.burning = false;
    if (this.nitroLock > 0) { this.nitroLock -= dt; this.nitro = 0; this.burning = false; }
    else if (inp.boost && this.stunT <= 0 && (this.burning || this.nitro >= 0.1)) {
      if (!this.burning) g.sfx('pad', this);
      this.burning = true;
      this.nitro -= dt * 0.38; this.boostT = Math.max(this.boostT, 0.14);
      if (this.nitro <= 0) { this.nitro = 0; this.nitroLock = 2.5; this.burning = false; }
    } else this.nitro = Math.min(1, this.nitro + dt * (0.018 + (!this.grounded && this.airT > 0.2 ? 0.11 : 0)));

    const phi = T.phiAt(this.s);
    let th = phi - this.psi;
    const air = !this.grounded, trickAir = air && this.airT > 0.1;
    let steer = clamp(inp.steer, -1, 1);
    if (this.slowT > 0 || this.stunT > 0.35) steer = clamp(steer + Math.sin(g.time * 13 + this.ai.wob) * 0.7, -1, 1);
    this.steerSm = lerp(this.steerSm, steer, damp(dt, 10));
    if (!(trickAir && inp.trick)) th += steer * B.handling * (air ? 0.3 : 1) / (1 + this.v / 70) * dt;
    th = clamp(th, -1.2, 1.2);
    this.psi = phi - th;
    const cs = Math.cos(th), sn = Math.sin(th);
    const gh = T.heightAt(this.s, this.u);
    const grad = (this.grad = (T.heightAt(this.s + cs * 1.5, this.u + sn * 1.5) - gh) / 1.5);

    const boosting = this.boostT > 0;
    let vmax = B.top * this.skill * this.band;
    if (boosting) vmax *= 1.42;
    if (this.frozenT > 0) vmax *= 0.55;
    if (this.slowT > 0) vmax *= 0.6;

    if (this.grounded) {
      let a = (-G * grad) / Math.sqrt(1 + grad * grad);
      if (inp.accel && this.stunT <= 0) a += B.accel * clamp(1.15 - this.v / vmax, 0, 1);
      if (inp.brake) a -= 15;
      if (boosting) a += 16;
      const off = (this.off = smoothstep(T.trailW + 2, T.trailW + 14, Math.abs(this.u - T.trailAt(this.s))));
      a -= 0.0034 * this.v * this.v + 0.3 + off * 0.07 * this.v;
      this.v += a * dt;
      if (this.v > vmax) this.v -= (this.v - vmax) * Math.min(1, 2.5 * dt);
      if (this.v < 0) this.v = 0;
      if (inp.hop && this.stunT <= 0) {
        this.vy += this.springT > 0 ? 13 : 5.5; this.grounded = false; this.airT = 0; this._takeoff();
        g.sfx('hop', this);
      }
      if ((inp.kl || inp.kr) && this.kickCd <= 0) { this.kickT = 0.32; this.kickCd = 0.55; this.kickSide = inp.kl ? -1 : 1; g.onKick(this); }
    } else {
      this.v -= 0.0015 * this.v * this.v * dt;
      if (boosting) this.v += 6 * dt;
    }

    // move
    this.s += this.v * cs * dt; this.u += (this.v * sn + this.pu) * dt; this.pu *= Math.exp(-4 * dt);
    if (this.s > T.length - 8) { this.s = T.length - 8; this.v = 0; }
    if (T.city) {
      // street walls: slide along the buildings
      const lim = T.edge - 0.9;
      if (Math.abs(this.u) > lim) { this.u = clamp(this.u, -lim, lim); this.pu = 0; this.v -= this.v * 1.2 * dt; this.psi = lerp(this.psi, T.phiAt(this.s), 0.25); if (this.bumpCd <= 0 && this.v > 8) { this.bumpCd = 0.5; g.sfx('bump', this); } }
    } else {
      const lim = T.edge + 3;
      if (Math.abs(this.u) > lim) { this.pu = -Math.sign(this.u) * 7; this.v -= this.v * 1.6 * dt; this.u = clamp(this.u, -lim - 5, lim + 5); }
    }
    const ngh = T.heightAt(this.s, this.u);

    if (this.grounded) {
      const vg = (ngh - this.y) / dt;
      if (vg < this.vy - G * dt - 2.2) { this.grounded = false; this.airT = 0; this.y = Math.max(ngh, this.y + this.vy * dt); this._takeoff(); }
      else { this.vy = vg; this.y = ngh; }
      this.pose = 0;
    } else {
      this.airT += dt;
      this.vy -= G * (this.springT > 0 ? 0.5 : 1) * dt; this.y += this.vy * dt;
      if (this.airT > 0.1) this._airTricks(dt, inp, steer);
      if (this.y <= ngh) this._land(ngh);
    }

    this._obstacles(ngh);
    if (!this.finished && this.s >= T.finishS) { this.finished = true; this.finishTime = g.raceTime; g.onFinish(this); }
  }

  _takeoff() {
    this.flip = 0; this.spin = 0; this.poseT = [0, 0, 0, 0]; this.ai.plan = null;
    if (!this.isAI) return;
    // predict hang time, then plan a trick that will land clean
    const T = this.T, th = T.phiAt(this.s) - this.psi, cs = Math.cos(th), sn = Math.sin(th);
    let y = this.y, vy = this.vy, t = 0;
    for (; t < 5; t += 0.08) { vy -= G * 0.08; y += vy * 0.08; if (y <= T.heightAt(this.s + this.v * cs * t, this.u + this.v * sn * t)) break; }
    const rate = this._flipRate(), per = TAU / rate;
    const flips = Math.min(2, Math.floor((t - 0.35) / per));
    if (flips >= 1 && Math.random() < 0.85) this.ai.plan = { flip: flips * TAU * (Math.random() < 0.75 ? 1 : -1) };
    else if (t > 1.0) this.ai.plan = { spin: TAU * (Math.random() < 0.5 ? 1 : -1), need: TAU / 6.2 };
    else if (t > 0.6) this.ai.plan = { pose: 1 + Math.floor(Math.random() * 3), until: t - 0.3 };
    if (this.ai.plan && this.ai.plan.spin && t < this.ai.plan.need + 0.3) this.ai.plan = { pose: 2, until: t - 0.3 };
  }
  _flipRate() { return 5.4 * (0.7 + 0.3 * this.B.air); }

  _airTricks(dt, inp, steer) {
    const rate = this._flipRate(), p = this.ai.plan;
    let pose = 0;
    if (this.isAI) {
      if (p) {
        if (p.flip) { const d = p.flip - this.flip, st = Math.sign(d) * rate * dt; if (Math.abs(d) <= Math.abs(st)) { this.flip = p.flip; this.ai.plan = null; } else this.flip += st; }
        else if (p.spin) { const d = p.spin - this.spin, st = Math.sign(d) * 6.2 * dt; if (Math.abs(d) <= Math.abs(st)) { this.spin = p.spin; this.ai.plan = null; } else this.spin += st; }
        else if (p.pose) { if (this.airT < p.until) pose = p.pose; else this.ai.plan = null; }
      }
    } else {
      let fd = 0;
      if (inp.trick) {
        fd = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
        this.flip += fd * rate * dt;
        if (Math.abs(steer) > 0.25) this.spin += steer * 6.2 * (0.7 + 0.3 * this.B.air) * dt;
      }
      pose = inp.klHeld ? 1 : inp.krHeld ? 2 : inp.trick && !fd && Math.abs(steer) <= 0.25 ? 3 : 0;
    }
    this.pose = pose; if (pose) this.poseT[pose] += dt;
  }

  _land(ngh) {
    const g = this.game, impact = this.grad * this.v - this.vy;
    this.grounded = true; this.y = ngh; this.vy = this.grad * this.v;
    if (this.airT < 0.3) { this.flip = this.spin = 0; return; }
    this.landK = clamp(impact / 12, 0.3, 1);
    const nf = Math.round(this.flip / TAU), ferr = Math.abs(this.flip - nf * TAU);
    const ns = Math.round(this.spin / TAU), serr = Math.abs(this.spin - ns * TAU);
    const badPose = this.pose === 1 || this.pose === 2;
    this.flip = this.spin = 0;
    if (ferr > 1.0 || serr > 1.2 || badPose) { this.pose = 0; if (this.crash('bail')) return; }
    const parts = []; let pts = 0;
    const mult = ['', '', 'DOUBLE ', 'TRIPLE ', 'QUAD '];
    if (nf) { const n = Math.abs(nf); pts += 600 * n * (n > 1 ? 1.3 : 1); parts.push((mult[n] ?? n + 'x ') + (nf > 0 ? 'BACKFLIP' : 'FRONTFLIP')); }
    if (ns) { pts += 400 * Math.abs(ns); parts.push(360 * Math.abs(ns) + ' SPIN'); }
    if (this.poseT[1] > 0.25) { pts += 300 + this.poseT[1] * 500; parts.push('SUPERMAN'); }
    if (this.poseT[2] > 0.25) { pts += 250 + this.poseT[2] * 450; parts.push('TABLETOP'); }
    if (this.poseT[3] > 0.25) { pts += 200 + this.poseT[3] * 400; parts.push('NO-HANDER'); }
    if (this.airT > 2.3) { pts += 150; if (!parts.length) parts.push('BIG AIR'); }
    this.pose = 0;
    if (pts > 0) {
      pts = Math.round(pts / 10) * 10; this.score += pts;
      this.nitro = Math.min(1, this.nitro + (0.1 + pts / 4000) * (this.isAI ? 0.45 : 1));
      g.onTrick(this, parts.join(' + '), pts);
    } else g.onLand(this, impact);
  }

  _obstacles(ngh) {
    if (this.y - ngh > 9) return;
    const T = this.T, k0 = Math.floor(this.s / 8);
    for (let k = k0 - 1; k <= k0 + 1; k++) {
      const arr = T.obst.get(k); if (!arr) continue;
      for (const o of arr) {
        const ds = o.s - this.s, du = o.u - this.u, rr = o.r + 0.45;
        if (ds * ds + du * du > rr * rr || this.y - T.heightAt(o.s, o.u) > o.h) continue;
        if (o.soft) { this.v -= this.v * 2.5 * this.game.dt; continue; }
        if (this.v > 14) { this.crash('tree'); return; }
        this.v *= 0.4; this.u -= Math.sign(du || 1) * 0.5; this.s -= 0.4;
        if (this.bumpCd <= 0) { this.bumpCd = 0.4; this.game.sfx('bump', this); }
      }
    }
  }

  crash(why) {
    if (this.invT > 0 || this.crashT > 0) return false;
    if (this.shieldT > 0) { this.shieldT = 0; this.invT = 1.2; this.game.onShieldPop(this); return false; }
    this.crashT = 1.7; this.pose = 0; this.flip = this.spin = 0; this.tumble = 0; this.boostT = 0; this.ai.plan = null;
    this.game.onCrash(this, why);
    return true;
  }
  _crashUpdate(dt) {
    const T = this.T;
    this.crashT -= dt; this.v *= Math.exp(-2.4 * dt);
    const th = T.phiAt(this.s) - this.psi, lim = T.city ? T.edge - 1 : T.edge + 6;
    this.s = Math.min(this.s + this.v * Math.cos(th) * dt, T.length - 8); this.u = clamp(this.u + (this.v * Math.sin(th) + this.pu) * dt, -lim, lim); this.pu *= Math.exp(-3 * dt);
    const gh = T.heightAt(this.s, this.u);
    this.vy -= G * dt; this.y += this.vy * dt;
    if (this.y <= gh) { this.y = gh; this.vy = Math.abs(this.vy) > 4 ? -this.vy * 0.3 : 0; }
    this.tumble += dt * (5 + this.v * 0.5);
    if (this.crashT <= 0) {
      if (this.y - gh > 1) { this.crashT = 0.1; return; } // still flying: keep tumbling until we come down
      this.u = T.trailAt(this.s); this.y = T.heightAt(this.s, this.u); this.psi = T.phiAt(this.s);
      this.v = 10; this.vy = 0; this.grounded = true; this.invT = 2; this.tumble = 0; this.pu = 0;
    }
    if (!this.finished && this.s >= T.finishS) { this.finished = true; this.finishTime = this.game.raceTime; this.game.onFinish(this); }
  }

  // kinds: kick, snowball, boomerang, coconut, bomb, goat, horn, mud, bliz, + hazards animal/person/car/tornado/geyser/small
  takeHit(kind, side = 0) {
    if (this.invT > 0 || this.crashT > 0) return false;
    if (kind === 'geyser') { this.vy = 16; this.grounded = false; this.airT = 0; this._takeoff(); this.y += 0.3; return true; }
    if (this.shieldT > 0) { this.shieldT = 0; this.invT = 1.2; this.game.onShieldPop(this); return false; }
    const tough = this.B.tough;
    if (kind === 'kick') { this.v *= 1 - 0.3 / tough; this.pu = side * 8 / tough; this.stunT = 0.6; }
    else if (kind === 'snowball') { this.v *= 1 - 0.28 / tough; this.pu = side * 4; this.stunT = 0.8; }
    else if (kind === 'boomerang') { this.v *= 0.6; this.pu = side * 6; this.stunT = 1.2; }
    else if (kind === 'horn') { this.v *= 0.5; this.pu = side * 9; this.stunT = 1.0; if (!this.grounded) this.vy += 3; }
    else if (kind === 'mud') { this.slowT = 2.6; this.v *= 0.75; }
    else if (kind === 'bliz') { this.frozenT = 3.6; }
    else if (kind === 'small') { this.v *= 0.7; this.stunT = 0.5; }
    else {
      // everything else sends you flying
      const up = { goat: 7, coconut: 6, bomb: 11, animal: 7, person: 4, car: 9, tornado: 19 }[kind] ?? 6;
      this.vy = up; this.grounded = false; this.y += 0.2; this.pu = side * (kind === 'car' || kind === 'bomb' ? 7 : 3);
      if (kind === 'car' || kind === 'animal') this.v *= 0.5;
      this.crash(kind);
      if (kind === 'tornado') this.crashT = 2.6;
    }
    return true;
  }

  // ---------------------------------------------------------------------- AI
  aiThink(dt) {
    const T = this.T, g = this.game, inp = this.inp, ai = this.ai;
    inp.hop = inp.kl = inp.kr = inp.item = inp.brake = false; inp.accel = true;
    if (this.nitro > 0.85) ai.burn = true; else if (this.nitro <= 0.02) ai.burn = false;
    inp.boost = !!ai.burn && this.grounded && Math.abs(inp.steer) < 0.6;
    if (this.finished) { inp.accel = false; inp.brake = true; inp.steer = 0; return inp; }
    const look = 10 + this.v * 0.55;
    let target = T.trailAt(this.s + look) + ai.lane;
    let bestF = 2, dodge = null;
    const consider = (o) => {
      const f = (o.s - this.s) / look; if (f < 0.04 || f > 1 || f >= bestF) return;
      const cl = o.r + 1.5;
      if (Math.abs(o.u - lerp(this.u, target, f)) < cl) { bestF = f; dodge = o.u + (o.vu ? -Math.sign(o.vu) : T.trailAt(o.s) >= o.u ? 1 : -1) * (cl + 0.7); }
    };
    for (let k = Math.floor((this.s + 1) / 8), k1 = Math.floor((this.s + look) / 8); k <= k1; k++) {
      const arr = T.obst.get(k); if (!arr) continue;
      for (const o of arr) if (!o.soft) consider(o);
    }
    if (g.hazards) for (const o of g.hazards.live) consider(o);
    if (dodge !== null) target = this.u + clamp((dodge - this.u) / Math.max(bestF, 0.25), -22, 22);
    for (const m of g.muds) { const d = m.s - this.s; if (d > 2 && d < look && Math.abs(m.u - this.u) < 2.5) target += m.u > this.u ? -4 : 4; }
    const lim = T.city ? T.edge - 2 : T.edge - 1; target = clamp(target, -lim, lim);
    const want = Math.atan2(target - this.u, look), th = T.phiAt(this.s) - this.psi;
    inp.steer = clamp((want - th) * 3.2, -1, 1);
    if (Math.abs(want - th) > 0.75 && this.v > 18) inp.brake = true;

    // combat + items
    if (this.grounded && this.kickCd <= 0) {
      for (const r of g.riders) {
        if (r === this || r.crashT > 0) continue;
        const ds = r.s - this.s, du = r.u - this.u;
        if (Math.abs(ds) < 2 && Math.abs(du) > 0.4 && Math.abs(du) < 2.6 && Math.random() < 1.6 * dt) { if (du < 0) inp.kl = true; else inp.kr = true; }
      }
    }
    if (this.item) {
      ai.itemT -= dt;
      if (ai.itemT <= 0) {
        const it = this.item; let use = ai.itemT < -6;
        const near = (a, b, w = 99) => g.riders.some((r) => r !== this && r.s - this.s > a && r.s - this.s < b && Math.abs(r.u - this.u) < w);
        if (it === 'chili' || it === 'shield') use = true;
        else if (it === 'spring') use = this.grounded;
        else if (it === 'goat' || it === 'coconut') use = use || near(4, 160);
        else if (it === 'snowball') use = use || near(4, 45, 5);
        else if (it === 'boomerang') use = use || near(4, 42, 7);
        else if (it === 'bomb') use = use || near(18, 42, 9);
        else if (it === 'mud') use = use || near(-30, -3);
        else if (it === 'horn') use = use || g.riders.some((r) => r !== this && Math.abs(r.s - this.s) < 18 && Math.abs(r.u - this.u) < 18);
        else if (it === 'blizzard') use = this.place > 1;
        if (use) { inp.item = true; ai.itemT = 0.5 + Math.random(); }
      }
    }
    return inp;
  }

  // ------------------------------------------------------------ remote riders
  netApply(d, now) { this.net = { d, t: now }; }
  netUpdate(dt, now) {
    const n = this.net; if (!n) return;
    const d = n.d, age = Math.min((now - n.t) / 1000, 0.35), T = this.T, k = damp(dt, 12);
    const th = T.phiAt(d[0]) - d[3];
    this.s = lerp(this.s, d[0] + d[4] * Math.cos(th) * age, k); this.u = lerp(this.u, d[1] + d[4] * Math.sin(th) * age, k);
    const f = d[8], gr = !!(f & 1);
    const gh = T.heightAt(this.s, this.u);
    this.y = gr ? gh : Math.max(gh, lerp(this.y, d[2] + d[5] * age, k));
    const dp = d[3] - this.psi; this.psi += dp * k;
    this.v = d[4]; this.vy = d[5]; this.flip = lerp(this.flip, d[6], damp(dt, 20)); this.spin = lerp(this.spin, d[7], damp(dt, 20));
    this.grounded = gr; this.boostT = f & 2 ? 1 : 0; this.shieldT = f & 4 ? 1 : 0; this.frozenT = f & 8 ? 1 : 0; this.slowT = f & 16 ? 1 : 0;
    const cr = !!(f & 32); if (cr && this.crashT <= 0) this.tumble = 0; this.crashT = cr ? 1 : 0; if (cr) this.tumble += dt * 9;
    this.kickT = f & 192 ? 0.2 : 0; this.kickSide = f & 64 ? -1 : 1;
    this.pose = f & 256 ? 1 : f & 512 ? 2 : f & 1024 ? 3 : 0;
    this.accelVis = !!(f & 4096); this.throwT = f & 8192 ? 0.2 : 0;
    this.steerSm = lerp(this.steerSm, clamp(-dp * 6, -1, 1), k);
    const cs = Math.cos(T.phiAt(this.s) - this.psi), sn = Math.sin(T.phiAt(this.s) - this.psi);
    this.grad = (T.heightAt(this.s + cs * 1.5, this.u + sn * 1.5) - gh) / 1.5;
  }
  netState() {
    const f = (this.grounded ? 1 : 0) | (this.boostT > 0 ? 2 : 0) | (this.shieldT > 0 ? 4 : 0) | (this.frozenT > 0 ? 8 : 0) | (this.slowT > 0 ? 16 : 0) | (this.crashT > 0 ? 32 : 0) |
      (this.kickT > 0 ? (this.kickSide < 0 ? 64 : 128) : 0) | (this.pose === 1 ? 256 : this.pose === 2 ? 512 : this.pose === 3 ? 1024 : 0) | (this.finished ? 2048 : 0) | (this.accelVis ? 4096 : 0) | (this.throwT > 0 ? 8192 : 0);
    const r = (x) => Math.round(x * 100) / 100;
    return [r(this.s), r(this.u), r(this.y), r(this.psi), r(this.v), r(this.vy), r(this.flip), r(this.spin), f];
  }

  // ------------------------------------------------------------------- visuals
  sync(dt, time) {
    const m = this.m, T = this.T;
    T.pos(this.s, this.u, this.y, m.root.position);
    const crashed = this.crashT > 0;
    this.gpitch = lerp(this.gpitch, this.grounded ? Math.atan(this.grad) : Math.atan2(this.vy, Math.max(this.v, 6)) * 0.45, damp(dt, this.grounded ? 14 : 5));
    m.root.rotation.y = this.psi - this.spin + (crashed ? this.tumble * 0.6 : 0);
    const pp = this.pp, k = damp(dt, 14), k2 = damp(dt, 22);
    pp[0] = lerp(pp[0], this.pose === 1 ? 1 : 0, k); pp[1] = lerp(pp[1], this.pose === 2 ? 1 : 0, k); pp[2] = lerp(pp[2], this.pose === 3 ? 1 : 0, k);
    pp[3] = lerp(pp[3], this.kickT > 0 && this.kickSide < 0 ? 1 : 0, k2); pp[4] = lerp(pp[4], this.kickT > 0 && this.kickSide > 0 ? 1 : 0, k2);
    m.tilt.rotation.x = -this.gpitch - this.flip + (crashed ? this.tumble : 0);
    const wobble = this.stunT > 0 ? Math.sin(time * 30) * 0.2 : 0;
    m.tilt.rotation.z = this.steerSm * 0.36 + pp[1] * 1.25 + wobble + (crashed ? Math.sin(this.tumble) * 0.8 : 0);
    m.tilt.rotation.y = pp[1] * 0.5;
    this.wheelA += (this.v * dt) / (m.R * 1.18); m.wF.rotation.x = this.wheelA; m.wR.rotation.x = this.wheelA;
    m.wF.rotation.y = -this.steerSm * 0.3;
    const pedalling = this.accelVis && this.grounded && !crashed && this.v < this.B.top * 0.93;
    if (pedalling) this.pedalA += dt * (6 + this.v * 0.25);
    else { const tgt = Math.round((this.pedalA - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2; this.pedalA = lerp(this.pedalA, tgt, damp(dt, 8)); }
    this.standK = lerp(this.standK, pedalling && this.v < 16 ? 0 : 1, damp(dt, 5));
    this.landK = Math.max(0, this.landK - dt * 3.5);
    const pk = this.pk;
    pk.crankA = this.pedalA; pk.stand = this.standK; pk.sup = pp[0]; pk.noh = pp[2]; pk.kickL = pp[3]; pk.kickR = pp[4];
    pk.throwK = this.throwT > 0 ? Math.sin(clamp(this.throwT / 0.4, 0, 1) * Math.PI) : 0; pk.steer = this.steerSm; pk.land = this.landK;
    poseBike(m, pk);
    // status effects
    m.bubble.visible = this.shieldT > 0; if (m.bubble.visible) m.bubble.scale.setScalar(1 + Math.sin(time * 9) * 0.05);
    m.flame.visible = this.boostT > 0 && !crashed; if (m.flame.visible) m.flame.scale.set(1 + Math.random() * 0.4, 0.7 + Math.random() * 0.8, 1 + Math.random() * 0.4);
    m.ice.visible = this.frozenT > 0;
    m.root.visible = !(this.invT > 0 && !crashed && Math.floor(time * 14) % 2 === 0);
    const gh = T.heightAt(this.s, this.u), hgt = Math.max(0, this.y - gh);
    T.pos(this.s, this.u, gh + 0.06, this.shadow.position);
    this.shadow.scale.setScalar(clamp(1.1 - hgt * 0.05, 0.4, 1.1));
    if (this.tag) this.tag.visible = !crashed;
  }

  dispose() {
    this.game.scene.remove(this.m.root, this.shadow);
    if (this.tag) { this.tag.material.map.dispose(); this.tag.material.dispose(); }
    this.m.own.forEach((x) => x.dispose());
  }
}
