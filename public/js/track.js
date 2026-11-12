// Procedural course: a long descending ribbon of terrain built in "track space"
// (s = metres down the course, u = metres right of the centreline), dressed with
// CC0 photo textures, billboard trees, buildings, ocean and landmarks.
import * as THREE from 'three';
import { mulberry32, makeNoise, clamp, lerp, smoothstep } from './util.js';
import { tex, texImage, skyImage } from './assets.js';

export const DS = 2, DU = 4;
const CHUNK = 50; // rows per terrain chunk (100 m)

const C = (hex) => new THREE.Color(hex);
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();

// ---------------------------------------------------------------- geometry kit
export function P(geo, hex, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  _e.set(rx, ry, rz); _q.setFromEuler(_e);
  _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  const n = g.attributes.position.count, c = new Float32Array(n * 3), k = C(hex);
  for (let i = 0; i < n; i++) { c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
export function merge(parts) {
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const p of parts) {
    const c = p.attributes.position.count;
    pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); col.set(p.attributes.color.array, o * 3);
    if (p.attributes.uv) uv.set(p.attributes.uv.array, o * 2);
    o += c; p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
const cyl = (a, b, h, n = 8) => new THREE.CylinderGeometry(a, b, h, n);
const cone = (r, h, n = 8) => new THREE.ConeGeometry(r, h, n);
const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

export function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
const css = (hex) => '#' + hex.toString(16).padStart(6, '0');

// ---------------------------------------------------------------- painted tree billboards
function paintTree(kind, rnd) {
  const dims = { conifer: [128, 256], coniferSnow: [128, 256], deodar: [128, 256], cypress: [64, 256], broad: [256, 256], sakura: [256, 256], palm: [256, 256], acacia: [256, 192], bush: [128, 96] }[kind];
  return canvasTex(dims[0], dims[1], (g, W, H) => {
    const blob = (x, y, rx, ry, col, rot = 0) => { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, 7); g.fill(); };
    const trunk = (x0, y0, x1, y1, w, col = '#4a3524') => {
      g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = w * 0.35; g.beginPath(); g.moveTo(x0 + w * 0.2, y0); g.lineTo(x1 + w * 0.2, y1); g.stroke();
    };
    if (kind === 'conifer' || kind === 'coniferSnow' || kind === 'deodar' || kind === 'cypress') {
      const cy = kind === 'cypress', layers = kind === 'deodar' ? 9 : 7, hue = kind === 'deodar' ? 150 : cy ? 135 : 125;
      trunk(W / 2, H - 2, W / 2, H * 0.55, cy ? 5 : 9);
      const top = 5, span = H * (cy ? 0.9 : 0.82);
      const hw = (t) => (cy ? W * 0.44 * Math.pow(Math.sin(Math.PI * Math.min(0.98, t * 0.92 + 0.04)), 0.6) : (3 + t * W * 0.47) * (0.62 + 0.38 * ((t * layers) % 1)));
      for (let i = 0; i < 1500; i++) {
        const t = Math.pow(rnd(), 0.75), w = hw(t), dx = (rnd() * 2 - 1) * w, x = W / 2 + dx, y = top + t * span;
        const l = 13 + rnd() * 18 + (dx < 0 ? 7 : 0) + (1 - Math.abs(dx) / (w + 1)) * 4;
        blob(x, y, 4 + rnd() * 6, 2 + rnd() * 3, `hsl(${hue + rnd() * 20 - 10},${38 + rnd() * 20}%,${l}%)`, dx * 0.012);
      }
      if (kind === 'coniferSnow') for (let i = 0; i < 520; i++) {
        const t = rnd(), fr = (t * layers) % 1; if (fr < 0.35) continue;
        const w = hw(t), dx = (rnd() * 2 - 1) * w;
        blob(W / 2 + dx, top + t * span - 3, 4 + rnd() * 6, 2 + rnd() * 2.5, `hsl(210,30%,${86 + rnd() * 13}%)`, dx * 0.012);
      }
    } else if (kind === 'broad' || kind === 'sakura' || kind === 'bush' || kind === 'acacia') {
      let circles, hue, sat, l0;
      if (kind === 'broad') { trunk(128, 254, 126, 120, 16); trunk(126, 150, 80, 110, 8); trunk(126, 140, 178, 108, 8); circles = [[128, 92, 84, 78], [74, 124, 56, 50], [184, 126, 56, 50], [128, 52, 60, 46]]; hue = 105; sat = 45; l0 = 17; }
      else if (kind === 'sakura') { trunk(128, 254, 122, 130, 13, '#2e2220'); trunk(122, 160, 70, 112, 7, '#2e2220'); trunk(122, 150, 186, 106, 7, '#2e2220'); circles = [[128, 92, 88, 70], [70, 118, 58, 46], [190, 116, 58, 46], [128, 54, 62, 42]]; hue = 338; sat = 75; l0 = 68; }
      else if (kind === 'acacia') { trunk(128, 190, 122, 96, 12, '#3e3024'); trunk(122, 110, 62, 62, 7, '#3e3024'); trunk(122, 104, 196, 56, 7, '#3e3024'); circles = [[128, 42, 118, 24], [64, 56, 60, 17], [198, 50, 56, 17]]; hue = 82; sat = 45; l0 = 20; }
      else { circles = [[64, 58, 56, 34], [34, 68, 30, 24], [96, 66, 30, 26]]; hue = 100; sat = 40; l0 = 16; }
      const n = kind === 'bush' ? 420 : 1900;
      for (let i = 0; i < n; i++) {
        const [cx, cy, rx, ry] = circles[(rnd() * circles.length) | 0], a = rnd() * 6.283, r = Math.sqrt(rnd());
        const x = cx + Math.cos(a) * rx * r, y = cy + Math.sin(a) * ry * r;
        const lit = (cy - y) / ry * 7 + (cx - x) / rx * 4;
        const l = l0 + rnd() * (kind === 'sakura' ? 22 : 20) + lit;
        blob(x, y, 4 + rnd() * 6, 3 + rnd() * 4, `hsl(${hue + rnd() * 26 - 13},${sat + rnd() * 18}%,${clamp(l, 6, 96)}%)`, rnd() * 3);
      }
    } else if (kind === 'palm') {
      g.strokeStyle = '#6a5238'; g.lineWidth = 11; g.lineCap = 'round'; g.beginPath(); g.moveTo(134, 254); g.quadraticCurveTo(144, 150, 124, 74); g.stroke();
      g.strokeStyle = 'rgba(40,28,16,0.55)'; g.lineWidth = 2;
      for (let y = 250; y > 80; y -= 9) { g.beginPath(); g.moveTo(124, y); g.lineTo(146, y - 3); g.stroke(); }
      for (let f = 0; f < 13; f++) {
        const a = -Math.PI * 1.08 + (f / 12) * Math.PI * 1.16 + (rnd() - 0.5) * 0.15, len = 92 + rnd() * 26;
        const ex = 124 + Math.cos(a) * len, ey = 74 + Math.sin(a) * len * 0.6 + 34, mx = 124 + Math.cos(a) * len * 0.55, my = 74 + Math.sin(a) * len * 0.75 - 12;
        g.strokeStyle = '#2f5a24'; g.lineWidth = 3; g.beginPath(); g.moveTo(124, 74); g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
        for (let k = 1; k <= 22; k++) {
          const t = k / 22, x = (1 - t) * (1 - t) * 124 + 2 * (1 - t) * t * mx + t * t * ex, y = (1 - t) * (1 - t) * 74 + 2 * (1 - t) * t * my + t * t * ey;
          g.strokeStyle = `hsl(${95 + rnd() * 25},${45 + rnd() * 15}%,${18 + rnd() * 20}%)`; g.lineWidth = 2.6;
          const ll = 20 * Math.sin(Math.PI * t) + 5;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 5 - 3, y + ll); g.stroke();
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 5 + 3, y - ll * 0.35); g.stroke();
        }
      }
      for (let k = 0; k < 5; k++) blob(120 + rnd() * 10, 80 + rnd() * 8, 5, 6, '#5a4020');
    }
  });
}
function crossGeo(w, h, planes = 2) {
  const pos = [], uv = [], nor = [], idx = [];
  for (let p = 0; p < planes; p++) {
    const a = (p / planes) * Math.PI, cx = Math.cos(a) * w / 2, cz = Math.sin(a) * w / 2, o = p * 4;
    pos.push(-cx, -0.15, -cz, cx, -0.15, cz, cx, h, cz, -cx, h, -cz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1); nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx); return g;
}

// Flora: billboards (bill) or meshes (g) + collision radius / height
const FLORA = {
  conifer: { r: 0.5, h: 9, bill: [5.4, 10.5] }, coniferSnow: { r: 0.5, h: 9, bill: [5.4, 10.5] }, deodar: { r: 0.6, h: 12, bill: [6.8, 14] },
  cypress: { r: 0.5, h: 9, bill: [2.7, 10] }, broad: { r: 0.55, h: 7, bill: [9, 9] }, sakura: { r: 0.5, h: 6, bill: [8, 7.5] },
  palm: { r: 0.4, h: 9, bill: [7.5, 10.5] }, acacia: { r: 0.5, h: 6, bill: [12, 8.5] }, bush: { r: 0.6, h: 1.0, soft: true, bill: [2.8, 2] },
  cactus: { r: 0.5, h: 4, mat: 'lit', g: () => merge([P(cyl(0.38, 0.44, 4.4, 9), 0x3f8f4a, 0, 2.2), P(new THREE.SphereGeometry(0.38, 9, 5), 0x479a52, 0, 4.4), P(cyl(0.22, 0.22, 1.2, 7), 0x3f8f4a, 0.75, 2.3, 0, 1, 1, 1, 0, 0, Math.PI / 2), P(cyl(0.22, 0.24, 1.5, 7), 0x479a52, 1.2, 3.0), P(cyl(0.2, 0.2, 1.0, 7), 0x3f8f4a, -0.65, 1.7, 0, 1, 1, 1, 0, 0, Math.PI / 2), P(cyl(0.2, 0.22, 1.2, 7), 0x479a52, -1.05, 2.3)]) },
  hoodoo: { r: 1.4, h: 7, mat: 'rock', g: () => merge([P(cyl(1.1, 1.6, 2.6, 8), 0xffffff, 0, 1.3), P(cyl(0.8, 1.1, 2.4, 8), 0xf0e0d8, 0, 3.8), P(cyl(0.6, 0.8, 1.6, 8), 0xffffff, 0, 5.8), P(cyl(1.2, 0.9, 0.9, 8), 0xd8c0b0, 0, 7.0)]) },
  rock: { r: 1.25, h: 1.5, rock: true, mat: 'rock', g: () => merge([P(ico(1.4), 0xffffff, 0, 0.5, 0, 1.2, 0.75, 1), P(ico(0.8), 0xe0e0e0, 1.1, 0.25, 0.5, 1, 0.7, 1.2)]) },
  lava: { r: 1.2, h: 1.8, mat: 'glow', g: () => merge([P(ico(1.5), 0x1c1a1d, 0, 0.5, 0, 1.2, 0.8, 1), P(ico(0.75), 0xff5a14, 0.1, 1.05, 0, 1, 0.6, 1), P(ico(0.4), 0xffc21e, 0.2, 1.3, 0.1)]) },
  ice: { r: 0.9, h: 3, mat: 'glow', g: () => merge([P(cone(0.9, 3.4, 5), 0x9fe0ff, 0, 1.7), P(cone(0.6, 2.2, 5), 0xd8f6ff, 0.7, 1.0, 0.2, 1, 1, 1, 0, 0, -0.3), P(cone(0.5, 1.8, 5), 0x7fc8f0, -0.6, 0.8, -0.3, 1, 1, 1, 0, 0, 0.35)]) },
};

// Landmarks. `across` props span the trail, the rest sit beside it.
const PROPS = {
  flags: {
    across: true, posts: [9],
    g: () => {
      const parts = [P(cyl(0.1, 0.14, 7, 6), 0x6a4a30, -9, 3.5), P(cyl(0.1, 0.14, 7, 6), 0x6a4a30, 9, 3.5)];
      const cols = [0x2a6fd6, 0xffffff, 0xd62a2a, 0x2aa84a, 0xf2c21a];
      for (let i = 0; i < 21; i++) {
        const x = -8.4 + i * 0.84, y = 6.7 - 1.5 * (1 - (x / 8.7) ** 2);
        parts.push(P(box(0.6, 0.5, 0.03), cols[i % 5], x, y - 0.3, 0, 1, 1, 1, 0, 0, x * 0.035));
      }
      return merge(parts);
    },
  },
  torii: {
    across: true, posts: [6.5],
    g: () => merge([P(cyl(0.34, 0.4, 7.4, 10), 0xc8321e, -6.5, 3.7), P(cyl(0.34, 0.4, 7.4, 10), 0xc8321e, 6.5, 3.7), P(box(16.5, 0.55, 0.8), 0xc8321e, 0, 7.4), P(box(17.6, 0.3, 1.0), 0x1c1a1a, 0, 7.85), P(box(14, 0.4, 0.45), 0xc8321e, 0, 5.9), P(box(0.5, 1.1, 0.3), 0x1c1a1a, 0, 6.65)]),
  },
  arch: {
    across: true, posts: [13.5], postR: 2.2, mat: 'rock',
    g: () => merge([P(new THREE.TorusGeometry(13.5, 2.1, 7, 14, Math.PI), 0xffffff, 0, -0.5, 0, 1, 0.85, 1.4), P(ico(3), 0xe8d8d0, -13.5, 0.6, 0, 1, 0.8, 1), P(ico(3), 0xffffff, 13.5, 0.6, 0, 1, 0.8, 1)]),
  },
  chorten: {
    r: 2.4,
    g: () => merge([P(box(3.4, 1.2, 3.4), 0xf2efe6, 0, 0.6), P(box(2.6, 1.0, 2.6), 0xffffff, 0, 1.7), P(box(3.0, 0.25, 3.0), 0xc8321e, 0, 2.3), P(new THREE.SphereGeometry(1.2, 12, 8), 0xffffff, 0, 3.2, 0, 1, 1.1, 1), P(box(0.8, 0.6, 0.8), 0xf2c21a, 0, 4.5), P(cone(0.45, 2.2, 10), 0xe8b020, 0, 5.8), P(new THREE.SphereGeometry(0.22, 8, 6), 0xffe060, 0, 7.0)]),
  },
  villa: {
    r: 4.4,
    g: () => merge([P(box(7.2, 4.2, 5.8), 0xf6efe0, 0, 2.1), P(cyl(0.01, 4.8, 1.8, 4), 0xc8643a, 0, 5.1, 0, 1.1, 1, 0.9, 0, Math.PI / 4), P(box(1.0, 1.3, 0.1), 0x4a7a9a, -1.9, 2.8, 2.92), P(box(1.0, 1.3, 0.1), 0x4a7a9a, 1.9, 2.8, 2.92), P(box(1.2, 2.2, 0.1), 0x6a4a2a, 0, 1.1, 2.92), P(box(7.4, 0.25, 1.2), 0xe8e0d0, 0, 2.2, 3.3), P(box(0.3, 0.3, 5.8), 0x2f6a34, 3.7, 4.3, 0)]),
  },
  hut: {
    r: 2.8,
    g: () => merge([P(cyl(2.2, 2.3, 2.2, 14), 0xb5804a, 0, 1.1), P(cone(3.2, 2.6, 14), 0xd8b45a, 0, 3.5), P(box(0.9, 1.6, 0.2), 0x3a2416, 0, 0.8, 2.25), P(cyl(0.12, 0.12, 0.5, 5), 0x7a5a30, 0, 5.0)]),
  },
  vent: {
    r: 2.6, mat: 'glow',
    g: () => merge([P(cyl(1.2, 2.8, 2.6, 9), 0x1a181c, 0, 1.3), P(cyl(1.0, 1.15, 0.3, 9), 0xff5a14, 0, 2.62), P(ico(0.6), 0xffd21e, 0, 2.8), P(ico(1.0), 0x18161a, 2.4, 0.3, 1), P(cone(0.5, 1.6, 5), 0xff7a1e, -0.3, 3.4, 0.2)]),
  },
};

// ---------------------------------------------------------------------- sky
// Real photo panorama for the sky, with painted ridgelines over the horizon.
export function makeSky(level) {
  const S = level.sky, rnd = mulberry32(level.seed + 99), img = skyImage(S.img);
  let fog = 0x8090a0;
  const t = canvasTex(2048, 1024, (g, W, H) => {
    const hz = H * 0.5;
    g.drawImage(img, 0, 0, W, H);
    // average the horizon band -> fog colour, so terrain fades into the photo
    const d = g.getImageData(0, hz - 26, W, 6).data; let r = 0, gg = 0, b = 0, n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    r = Math.round(r / n); gg = Math.round(gg / n); b = Math.round(b / n);
    if (S.night) { r = Math.round(r * 0.8 + 10); gg = Math.round(gg * 0.8 + 16); b = Math.round(b * 0.8 + 26); }
    fog = (r << 16) | (gg << 8) | b;
    const fc = `rgb(${r},${gg},${b})`;
    if (S.night) {
      for (let bnd = 0; bnd < 4; bnd++) {
        const y0 = hz * (0.3 + bnd * 0.12), ph = rnd() * 6;
        for (let x = 0; x < W; x += 4) {
          const a = x / W * Math.PI * 2, y = y0 + Math.sin(a * 3 + ph) * 40 + Math.sin(a * 7 + ph * 2) * 18, hgt = 110 + Math.sin(a * 5 + ph) * 50;
          const ag = g.createLinearGradient(0, y - hgt, 0, y), col = bnd % 2 ? '120,255,190' : '90,255,140';
          ag.addColorStop(0, `rgba(${col},0)`); ag.addColorStop(0.7, `rgba(${col},${0.16 + 0.1 * Math.sin(a * 9 + bnd)})`); ag.addColorStop(1, 'rgba(160,120,255,0.03)');
          g.fillStyle = ag; g.fillRect(x, y - hgt, 4, hgt);
        }
      }
    }
    // hide the photo's own ground: fade to fog just under the horizon
    const fg = g.createLinearGradient(0, hz - 30, 0, hz + 6);
    fg.addColorStop(0, `rgba(${r},${gg},${b},0)`); fg.addColorStop(1, fc);
    g.fillStyle = fg; g.fillRect(0, hz - 30, W, 36); g.fillStyle = fc; g.fillRect(0, hz + 5, W, H - hz);
    S.peaks.forEach((hex, li) => {
      const amp = [105, 70, 40][li], base = hz - [30, 14, 2][li], f = [];
      for (let k = 0; k < 7; k++) f.push([1 + Math.floor(rnd() * (3 + li * 2 + k * 3)), rnd() * 6.28, 1 / (k + 1.2)]);
      const hAt = (x) => { const a = x / W * Math.PI * 2; let v = 0; for (const [fr, ph, am] of f) v += Math.abs(Math.sin(a * fr + ph)) * am; return v / 2.2; };
      const col = C(hex).lerp(C(fog), 0.58 - li * 0.14);
      g.fillStyle = '#' + col.getHexString(); g.beginPath(); g.moveTo(0, hz + 4);
      for (let x = 0; x <= W; x += 2) g.lineTo(x, base - hAt(x) * amp);
      g.lineTo(W, hz + 4); g.fill();
      if (S.snow && li < 2) {
        g.fillStyle = S.night ? 'rgba(190,215,255,0.5)' : 'rgba(255,255,255,0.72)';
        for (let x = 0; x <= W; x += 2) { const h = hAt(x) * amp, cut = amp * (li ? 0.62 : 0.5); if (h > cut) g.fillRect(x, base - h, 2, (h - cut) * (0.5 + 0.14 * Math.sin(x * 0.047) + 0.1 * Math.sin(x * 0.013))); }
      }
      const hg = g.createLinearGradient(0, base - amp * 0.5, 0, hz + 2);
      hg.addColorStop(0, `rgba(${r},${gg},${b},0)`); hg.addColorStop(1, `rgba(${r},${gg},${b},0.85)`);
      g.fillStyle = hg; g.fillRect(0, base - amp * 0.5, W, hz + 2 - (base - amp * 0.5));
    });
  });
  t.wrapS = THREE.RepeatWrapping;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1900, 40, 24), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, depthWrite: false }));
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return { mesh, fog };
}

// -------------------------------------------------------------------- track
export class Track {
  constructor(level) {
    this.level = level;
    const R = (this.route = level.route);
    const L = (this.length = level.length), N = (this.N = Math.floor(L / DS) + 1);
    const edge = (this.edge = R.edge), trailW = (this.trailW = R.trailW), city = (this.city = R.side === 'city');
    const half = (this.half = Math.ceil((edge + (city ? 30 : 38)) / DU) * DU), M = (this.M = (2 * half) / DU + 1);
    const rnd = mulberry32(level.seed), noise = makeNoise(level.seed);
    const p = []; for (let i = 0; i < 10; i++) p.push(rnd() * 6.283);
    this.finishS = L - 60;
    this.group = new THREE.Group(); this.mats = [];

    // ---- centreline: heading, position, elevation
    const phi = (this.phi = new Float32Array(N)), cx = (this.cx = new Float32Array(N)), cy = (this.cy = new Float32Array(N)), cz = (this.cz = new Float32Array(N));
    const tu = (this.tu = new Float32Array(N)), sideL = new Float32Array(N), sideR = new Float32Array(N), stair = (this.stair = new Uint8Array(N));
    const drops = (this.drops = []);
    if (R.drops > 0) for (let s = 420 + rnd() * 200; s < L - 400; s += (520 + rnd() * 380) / R.drops) drops.push({ s: Math.round(s / DS) * DS, d: (4 + rnd() * 4) * Math.min(1, 0.5 + R.drops / 2) });
    const flights = [];
    if (R.stairs) for (let s = 260 + rnd() * 80; s < L - 300; s += 300 + rnd() * 160) flights.push([s, 26 + rnd() * 20]);
    // cross streets (city) are needed before the terrain is built
    this.crossings = [];
    if (city) for (let s = 190 + rnd() * 40; s < L - 160; s += 170 + rnd() * 70) if (!flights.some(([a, b]) => s > a - 20 && s < a + b + 20)) this.crossings.push(Math.round(s));
    let x = 0, y = 0, z = 0;
    const [a1, l1, a2, l2] = R.turn;
    for (let i = 0; i < N; i++) {
      const s = i * DS;
      const ramp = smoothstep(30, 200, s) * smoothstep(L - 40, L - 200, s);
      const w1 = Math.sin(s / l1 + p[0]);
      phi[i] = ramp * (a1 * (R.square ? Math.tanh(2.6 * w1) : w1) + a2 * Math.sin(s / l2 + p[1]));
      cx[i] = x; cy[i] = y; cz[i] = z;
      let sl = level.slope * (0.62 + 0.5 * Math.sin(s / 215 + p[2]) + 0.24 * Math.sin(s / 83 + p[3]));
      sl = Math.max(sl, 0.03);
      if (s < 70) sl = lerp(0.13, sl, s / 70);
      sl *= smoothstep(L - 20, L - 130, s);
      if (flights.some(([a, b]) => s >= a && s < a + b)) { stair[i] = 1; sl = 0; if (i % 2 === 0) y -= 1.05; }
      y -= sl * DS;
      for (const d of drops) if (s === d.s) y -= d.d;
      x += Math.sin(phi[i]) * DS; z += Math.cos(phi[i]) * DS;
      tu[i] = ramp * (R.wander[0] * Math.sin(s / 150 + p[4]) + R.wander[1] * Math.sin(s / 61 + p[5]));
      const k = Math.sin(s / 520 + p[6]);
      // + = wall rising beside the course, - = ground dropping away
      if (R.side === 'ocean') { sideL[i] = 0.95; sideR[i] = -1.25; }
      else if (R.side === 'canyon') { sideL[i] = 0.75 + 0.3 * k; sideR[i] = 0.75 - 0.3 * k; }
      else if (R.side === 'ridge') { sideL[i] = -0.9 + 0.25 * k; sideR[i] = -0.9 - 0.25 * k; }
      else if (city) { sideL[i] = 0; sideR[i] = 0; }
      else { sideL[i] = k; sideR[i] = -k; }
    }
    this.seaY = y - 2.2;

    // ---- jumps (kickers on the trail)
    const jumps = (this.jumps = []);
    for (let s = 150 + rnd() * 60; s < L - 220; s += R.jumps[0] + rnd() * R.jumps[1]) {
      const sj = Math.round(s / DS) * DS;
      if (drops.some((d) => Math.abs(d.s - sj) < 40) || flights.some(([a, b]) => sj > a - 30 && sj < a + b + 30) || this.crossings.some((c) => Math.abs(c - sj) < 26)) continue;
      const big = rnd() < 0.22, narrow = edge < 26;
      jumps.push({ s: sj, u: tu[sj / DS] + (rnd() - 0.5) * (narrow ? 2 : 5), w: narrow ? 7 + rnd() * 3 : big ? 16 : 9 + rnd() * 5, len: big ? 14 : 8 + rnd() * 4, h: big ? 3.0 + rnd() * 0.8 : 1.3 + rnd() * 1.2 });
    }

    // ---- height field
    const H = (this.H = new Float32Array(N * M)), ramped = new Uint8Array(N * M);
    const tilt = R.side === 'mixed' || R.side === 'ocean' ? 0.06 : 0;
    for (let i = 0; i < N; i++) {
      const s = i * DS, calm = smoothstep(16, 70, s) * smoothstep(L - 30, L - 90, s);
      for (let j = 0; j < M; j++) {
        const u = -half + j * DU, d = u - tu[i], off = smoothstep(trailW, trailW + 13, Math.abs(d));
        let h = cy[i];
        if (!city) {
          h += ((noise(s / 24, u / 24) - 0.5) * 4.6 * R.bumps + (noise(s / 7 + 50, u / 7) - 0.5) * 0.7) * ((R.road ? 0.02 : 0.1) + 0.9 * off) * calm;
          h += 0.0012 * u * u - u * tilt * sideL[i] * calm - (R.road ? 0 : 0.35 * (1 - off));
          const e = Math.abs(u) - edge;
          if (e > 0) {
            const f = (u < 0 ? sideL[i] : sideR[i]) * calm;
            h += e * (f > 0 ? 1.25 * f + 0.25 : 1.9 * f + 0.25) + (noise(s / 13, u / 9 + 7) - 0.5) * e * 0.35;
          }
        }
        H[i * M + j] = h;
      }
    }
    for (const jp of jumps) {
      const i1 = jp.s / DS, i0 = Math.max(1, Math.floor((jp.s - jp.len) / DS));
      for (let i = i0; i <= i1; i++) {
        const t = clamp((i * DS - (jp.s - jp.len)) / jp.len, 0, 1);
        for (let j = 0; j < M; j++) {
          const u = -half + j * DU, lat = smoothstep(jp.w / 2 + 3, jp.w / 2 - 1, Math.abs(u - jp.u));
          if (lat > 0) { H[i * M + j] += jp.h * t * t * lat; if (lat > 0.5) ramped[i * M + j] = 1; }
        }
      }
    }

    this.obst = new Map();
    this._buildTerrain(level, noise, ramped);
    this._buildScenery(level, rnd);
    if (city) this._buildCity(rnd);
    if (R.side === 'ocean') this._buildOcean();
    this._buildPickups(level, rnd);
  }

  // ---- sampling ------------------------------------------------------------
  heightAt(s, u) {
    const M = this.M, fi = clamp(s / DS, 0, this.N - 1.001), fj = clamp((u + this.half) / DU, 0, M - 1.001);
    const i = fi | 0, j = fj | 0, a = fi - i, b = fj - j, H = this.H, o = i * M + j;
    return (H[o] * (1 - b) + H[o + 1] * b) * (1 - a) + (H[o + M] * (1 - b) + H[o + M + 1] * b) * a;
  }
  _lerpArr(arr, s) {
    const f = clamp(s / DS, 0, this.N - 1.001), i = f | 0;
    return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
  }
  phiAt(s) { return this._lerpArr(this.phi, s); }
  trailAt(s) { return this._lerpArr(this.tu, s); }
  // track space -> world. Right vector = (-cos phi, 0, sin phi)
  pos(s, u, y, out) {
    const ph = this.phiAt(s);
    return out.set(this._lerpArr(this.cx, s) - Math.cos(ph) * u, y, this._lerpArr(this.cz, s) + Math.sin(ph) * u);
  }
  ground(s, u, out, lift = 0) { return this.pos(s, u, this.heightAt(s, u) + lift, out); }

  addObstacle(s, u, r, h, soft) {
    const k = Math.floor(s / 8);
    let a = this.obst.get(k); if (!a) this.obst.set(k, (a = []));
    a.push({ s, u, r, h, soft });
  }

  // ---- terrain mesh: four photo textures blended per vertex ---------------------
  _buildTerrain(level, noise, ramped) {
    const { N, M, H, cx, cz, phi, tu, half, trailW, edge, city, stair } = this, L = this.length, T = level.tex;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex(T.a) });
    const uni = { tB: { value: tex(T.b) }, tT: { value: tex(T.trail) }, tR: { value: tex(T.rock) } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tB;\nuniform sampler2D tT;\nuniform sampler2D tR;\nvarying vec4 vSplat;')
        .replace('#include <map_fragment>', `
          vec4 cA = texture2D(map, vMapUv), cB = texture2D(tB, vMapUv), cT = texture2D(tT, vMapUv * 1.25), cR = texture2D(tR, vMapUv * 0.45);
          vec4 sampledDiffuseColor = cA * vSplat.x + cB * vSplat.y + cT * vSplat.z + cR * vSplat.w;
          float macro = dot(texture2D(map, vMapUv * 0.071).rgb + texture2D(tB, vMapUv * 0.113).rgb, vec3(0.1667));
          sampledDiffuseColor.rgb *= 0.62 + 0.9 * macro;
          diffuseColor *= sampledDiffuseColor;`);
    };
    this.terrainMat = mat; this.mats.push(mat);

    const wx = (i, j) => cx[i] - Math.cos(phi[i]) * (-half + j * DU), wz = (i, j) => cz[i] + Math.sin(phi[i]) * (-half + j * DU);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i0 = 0; i0 < N - 1; i0 += CHUNK) {
      const rows = Math.min(CHUNK, N - 1 - i0) + 1, cnt = rows * M;
      const pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3), col = new Float32Array(cnt * 3), uv = new Float32Array(cnt * 2), spl = new Float32Array(cnt * 4);
      for (let r = 0; r < rows; r++) {
        const i = i0 + r, s = i * DS;
        for (let j = 0; j < M; j++) {
          const o = r * M + j, u = -half + j * DU;
          pos[o * 3] = wx(i, j); pos[o * 3 + 1] = H[i * M + j]; pos[o * 3 + 2] = wz(i, j);
          const ia = Math.max(i - 1, 0), ib = Math.min(i + 1, N - 1), ja = Math.max(j - 1, 0), jb = Math.min(j + 1, M - 1);
          a.set(wx(ib, j) - wx(ia, j), H[ib * M + j] - H[ia * M + j], wz(ib, j) - wz(ia, j));
          b.set(wx(i, jb) - wx(i, ja), H[i * M + jb] - H[i * M + ja], wz(i, jb) - wz(i, ja));
          n.crossVectors(b, a).normalize(); if (n.y < 0) n.negate();
          nor[o * 3] = n.x; nor[o * 3 + 1] = n.y; nor[o * 3 + 2] = n.z;
          const d = Math.abs(u - tu[i]), t = s / L;
          let wT = 1 - smoothstep(trailW * 0.75, trailW * 1.25 + 1.5, d);
          if (ramped[i * M + j]) wT = Math.max(wT, 0.85);
          let wR = smoothstep(0.1, 0.32, 1 - n.y) * 0.95;
          if (stair[i] && d < edge) { wR = 1; wT = 0; }
          if (city && d >= trailW + 1) wR = 0;
          wR *= 1 - wT;
          const mixB = smoothstep(T.mix[0], T.mix[1], t + (noise(s / 31 + 9, u / 31) - 0.5) * 0.12), rest = 1 - wT - wR;
          spl[o * 4] = rest * (1 - mixB); spl[o * 4 + 1] = rest * mixB; spl[o * 4 + 2] = wT; spl[o * 4 + 3] = wR;
          let v = 0.86 + 0.28 * noise(s / 5 + 3, u / 5 + 8);
          if (ramped[i * M + j]) v *= 0.8;
          if (level.route.road && d < 0.6 && !stair[i] && i % 6 < 3) v *= 1.9; // centre line on tarmac
          col[o * 3] = v; col[o * 3 + 1] = v; col[o * 3 + 2] = v;
          uv[o * 2] = u / 6; uv[o * 2 + 1] = s / 6;
        }
      }
      const idx = [];
      for (let r = 0; r < rows - 1; r++) for (let j = 0; j < M - 1; j++) { const o = r * M + j; idx.push(o, o + 1, o + M, o + 1, o + M + 1, o + M); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
      g.setIndex(idx); g.computeBoundingSphere();
      this.group.add(new THREE.Mesh(g, mat));
    }
  }

  // ---- trees, rocks, landmarks ----------------------------------------------
  _buildScenery(level, rnd) {
    const L = this.length, { edge, trailW, half, city } = this;
    const M3 = {
      lit: new THREE.MeshLambertMaterial({ vertexColors: true }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
      rock: new THREE.MeshLambertMaterial({ vertexColors: true, map: tex(level.tex.rock) }),
    };
    this.mats.push(M3.lit, M3.glow, M3.rock);
    const taken = [], yaw = (s) => this.phiAt(s);

    // start + finish gates
    const gw = Math.min(10, edge - 2.5);
    const banner = (text, s, checker) => {
      const bt = canvasTex(1024, 128, (g, W, Hh) => {
        if (checker) { for (let x = 0; x < 32; x++) for (let yy = 0; yy < 4; yy++) { g.fillStyle = (x + yy) % 2 ? '#111' : '#fff'; g.fillRect(x * 32, yy * 32, 32, 32); } }
        else { const gr = g.createLinearGradient(0, 0, 0, Hh); gr.addColorStop(0, '#ff7a00'); gr.addColorStop(1, '#d81e00'); g.fillStyle = gr; g.fillRect(0, 0, W, Hh); }
        g.font = 'italic 900 96px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 12; g.strokeStyle = '#000'; g.strokeText(text, W / 2, Hh / 2 + 4); g.fillStyle = checker ? '#ffd800' : '#fff'; g.fillText(text, W / 2, Hh / 2 + 4);
      });
      const u = this.trailAt(s);
      const posts = new THREE.Mesh(merge([P(cyl(0.3, 0.38, 8.6, 10), 0x2a2a30, -gw, 4.3), P(cyl(0.3, 0.38, 8.6, 10), 0x2a2a30, gw, 4.3), P(box(gw * 2 + 0.6, 0.3, 0.5), 0x2a2a30, 0, 8.6), P(box(gw * 2 + 0.6, 0.3, 0.5), 0x2a2a30, 0, 5.8)]), M3.lit);
      const bm = new THREE.MeshBasicMaterial({ map: bt, side: THREE.DoubleSide }); this.mats.push(bm);
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(gw * 2, 2.5), bm); ban.position.y = 7.2;
      const grp = new THREE.Group(); grp.add(posts, ban);
      this.ground(s, u, grp.position); grp.rotation.y = yaw(s) + Math.PI;
      this.group.add(grp);
      this.addObstacle(s, u - gw, 0.5, 9); this.addObstacle(s, u + gw, 0.5, 9);
      taken.push([s, u - gw], [s, u + gw]);
    };
    banner('START', 44, false); banner('FINISH', this.finishS, true);

    // landmarks
    for (const pr of level.props) {
      const def = PROPS[pr.t], geo = def.g(level);
      for (let s = 200 + rnd() * pr.every * 0.6; s < L - 160; s += pr.every * (0.8 + rnd() * 0.4)) {
        const tu = this.trailAt(s), side = rnd() < 0.5 ? -1 : 1;
        const u = def.across ? tu : clamp(tu + side * (trailW + 7 + rnd() * 5), -edge + 4, edge - 4);
        if (def.across && this.jumps.some((j) => s > j.s - j.len - 6 && s < j.s + 30)) continue;
        if (!def.across && Math.abs(u - tu) < trailW + 5) continue;
        const m = new THREE.Mesh(geo, M3[def.mat || 'lit']);
        this.ground(s, u, m.position, -0.25);
        m.rotation.y = yaw(s) + (def.across ? 0 : side > 0 ? Math.PI / 2 : -Math.PI / 2);
        this.group.add(m);
        if (def.across) for (const d of def.posts) { this.addObstacle(s, u - d, def.postR || 0.5, 9); this.addObstacle(s, u + d, def.postR || 0.5, 9); taken.push([s, u - d], [s, u + d]); }
        else { this.addObstacle(s, u, def.r, 9); taken.push([s, u]); }
      }
    }

    // flora, instanced per 100 m chunk
    const total = Math.floor(L * 0.72 * level.density * (half / 88));
    const buckets = new Map(), dummy = new THREE.Object3D();
    for (let n = 0; n < total; n++) {
      const s = 70 + rnd() * (L - 130), t = s / L;
      const u = city ? (rnd() < 0.5 ? -1 : 1) * (trailW + 2.2 + rnd() * (edge - trailW - 3.6)) : (rnd() * 2 - 1) * (half - 6);
      let wsum = 0; for (const f of level.flora) if (t >= f.a && t <= f.b) wsum += f.w;
      let pick = rnd() * wsum, type = null;
      for (const f of level.flora) if (t >= f.a && t <= f.b) { pick -= f.w; if (pick <= 0) { type = f.t; break; } }
      if (!type) continue;
      const d = Math.abs(u - this.trailAt(s));
      if (!city && (d < trailW + 3.5 || (d < trailW + 9 && rnd() < 0.5))) continue;
      if (city && this.crossings.some((c) => Math.abs(c - s) < 10)) continue;
      if (this.level.route.side === 'ocean' && u > edge + 6) continue;
      if (taken.some(([ts, tuu]) => Math.abs(ts - s) < 6 && Math.abs(tuu - u) < 6)) continue;
      const def = FLORA[type], sc = def.rock ? 0.6 + rnd() * rnd() * 2.6 : 0.8 + rnd() * 0.6;
      const key = Math.floor(s / 100) + '|' + type;
      let arr = buckets.get(key); if (!arr) buckets.set(key, (arr = []));
      arr.push(s, u, sc, rnd() * 6.283);
      if (Math.abs(u) < edge + 8) this.addObstacle(s, u, def.r * sc, def.h * sc, def.soft);
    }
    const geos = {}, bmats = {};
    for (const [key, arr] of buckets) {
      const type = key.split('|')[1], def = FLORA[type];
      let geo = geos[type], mat;
      if (def.bill) {
        if (!geo) {
          geo = geos[type] = crossGeo(def.bill[0], def.bill[1], type === 'bush' ? 2 : 3);
          bmats[type] = new THREE.MeshLambertMaterial({ map: paintTree(type, mulberry32(level.seed + type.length * 31)), alphaTest: 0.42, side: THREE.DoubleSide });
          this.mats.push(bmats[type]);
        }
        mat = bmats[type];
      } else { if (!geo) geo = geos[type] = def.g(level); mat = M3[def.mat]; }
      const im = new THREE.InstancedMesh(geo, mat, arr.length / 4);
      for (let k = 0; k < arr.length; k += 4) {
        this.ground(arr[k], arr[k + 1], dummy.position, -0.15);
        dummy.rotation.set(0, arr[k + 3], 0); dummy.scale.setScalar(arr[k + 2]); dummy.updateMatrix();
        im.setMatrixAt(k / 4, dummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  // ---- city: rows of painted houses with gaps for cross streets ---------------
  _buildCity(rnd) {
    const L = this.length, { edge } = this;
    const paints = ['#f2c84a', '#4a90c8', '#e87a9a', '#3aa89a', '#f08a3a', '#f2ead8', '#c84a3a', '#8a6ac8', '#7ab85a'];
    const bases = ['plastered_wall_03', 'painted_plaster_wall', 'corrugated_iron', 'brick_wall_001', 'plastered_wall_03', 'corrugated_iron'];
    const fmats = bases.map((bn, vi) => {
      const t = canvasTex(256, 256, (g, W, H) => {
        g.drawImage(texImage(bn), 0, 0, W, H);
        if (bn !== 'brick_wall_001') { g.globalCompositeOperation = 'multiply'; g.fillStyle = paints[(rnd() * paints.length) | 0]; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; }
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, H - 8, W, 8); // floor line
        const wx = 84, wy = 50, ww = 88, wh = 132;
        g.fillStyle = '#f4f0e6'; g.fillRect(wx - 8, wy - 8, ww + 16, wh + 16);
        const gl = g.createLinearGradient(wx, wy, wx + ww, wy + wh); gl.addColorStop(0, '#22303e'); gl.addColorStop(0.5, '#4a6278'); gl.addColorStop(0.52, '#1a2430'); gl.addColorStop(1, '#2c3c4c');
        g.fillStyle = vi % 3 === 1 ? '#f6d27a' : gl; g.fillRect(wx, wy, ww, wh);
        g.fillStyle = '#f4f0e6'; g.fillRect(wx + ww / 2 - 3, wy, 6, wh); g.fillRect(wx, wy + wh * 0.42, ww, 5);
        const sh = ['#2a5a3a', '#7a3a2a', '#2a4a7a', '#3a3a3a'][vi % 4];
        g.fillStyle = sh; g.fillRect(wx - 40, wy - 4, 30, wh + 8); g.fillRect(wx + ww + 10, wy - 4, 30, wh + 8);
        g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2; for (let y = wy; y < wy + wh; y += 9) { g.beginPath(); g.moveTo(wx - 40, y); g.lineTo(wx - 10, y); g.moveTo(wx + ww + 10, y); g.lineTo(wx + ww + 40, y); g.stroke(); }
        if (vi % 2 === 0) { g.fillStyle = '#2a2a2e'; g.fillRect(wx - 44, wy + wh + 4, ww + 88, 6); for (let x = wx - 44; x < wx + ww + 44; x += 10) g.fillRect(x, wy + wh - 30, 3, 36); g.fillRect(wx - 44, wy + wh - 32, ww + 88, 4); }
      }, { repeat: true });
      const m = new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide }); this.mats.push(m); return m;
    });
    const roofMat = new THREE.MeshLambertMaterial({ map: tex('clay_roof_tiles_02'), side: THREE.DoubleSide }); this.mats.push(roofMat);
    const buckets = new Map();
    const bucket = (key) => { let b = buckets.get(key); if (!b) buckets.set(key, (b = { pos: [], uv: [] })); return b; };
    const A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3(), D = new THREE.Vector3();
    const quad = (b, p0, p1, y0, y1, ur, vr) => {
      b.pos.push(p0.x, y0, p0.z, p1.x, y0, p1.z, p1.x, y1, p1.z, p0.x, y0, p0.z, p1.x, y1, p1.z, p0.x, y1, p0.z);
      b.uv.push(0, 0, ur, 0, ur, vr, 0, 0, ur, vr, 0, vr);
    };
    for (const side of [-1, 1]) {
      let s = 62;
      while (s < L - 50) {
        const cr = this.crossings.find((c) => s + 18 > c - 8 && s < c + 8);
        if (cr !== undefined) { s = cr + 8; continue; }
        let w = 8 + rnd() * 9; const nextC = this.crossings.find((c) => c - 8 > s && c - 8 < s + w + 6); if (nextC !== undefined) w = nextC - 8 - s;
        const dep = 11 + rnd() * 5, h = 6.4 + Math.floor(rnd() * rnd() * 6) * 3.1, vi = (rnd() * fmats.length) | 0;
        const u0 = side * (edge + 0.6), u1 = side * (edge + 0.6 + dep), s0 = s, s1 = s + w;
        this.pos(s0, u0, 0, A); this.pos(s1, u0, 0, B); this.pos(s1, u1, 0, Cc); this.pos(s0, u1, 0, D);
        const g0 = this.heightAt(s0, u0), g1 = this.heightAt(s1, u0), yb = Math.min(g0, g1) - 3, yt = Math.max(g0, g1) + h;
        const b = bucket(Math.floor(s / 200) + '|' + vi), ur = Math.max(1, Math.round(w / 3.4)), vr = Math.max(2, Math.round((yt - yb) / 3.1));
        quad(b, A, B, yb, yt, ur, vr); quad(b, B, Cc, yb, yt, Math.max(1, Math.round(dep / 3.4)), vr); quad(b, D, A, yb, yt, Math.max(1, Math.round(dep / 3.4)), vr); quad(b, Cc, D, yb, yt, ur, vr);
        const rb = bucket(Math.floor(s / 200) + '|roof');
        rb.pos.push(A.x, yt, A.z, B.x, yt, B.z, Cc.x, yt, Cc.z, A.x, yt, A.z, Cc.x, yt, Cc.z, D.x, yt, D.z); rb.uv.push(0, 0, 2, 0, 2, 2, 0, 0, 2, 2, 0, 2);
        s = s1 + (rnd() < 0.15 ? 2.5 : 0.15);
      }
    }
    for (const [key, b] of buckets) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.computeVertexNormals(); g.computeBoundingSphere();
      const v = key.split('|')[1];
      this.group.add(new THREE.Mesh(g, v === 'roof' ? roofMat : fmats[+v]));
    }
  }

  // ---- sea for the coast road ---------------------------------------------------
  _buildOcean() {
    const wt = canvasTex(256, 256, (g, W, H) => {
      g.fillStyle = '#1f6f9c'; g.fillRect(0, 0, W, H);
      const r = mulberry32(5);
      for (let i = 0; i < 520; i++) {
        const x = r() * W, y = r() * H, l = 6 + r() * 26;
        g.strokeStyle = `rgba(${150 + r() * 105 | 0},${210 + r() * 45 | 0},255,${0.05 + r() * 0.2})`; g.lineWidth = 1 + r() * 2;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 3, x + l, y); g.stroke();
        if (x + l > W) { g.beginPath(); g.moveTo(x - W, y); g.quadraticCurveTo(x - W + l / 2, y - 3, x - W + l, y); g.stroke(); }
      }
    }, { repeat: true });
    wt.repeat.set(260, 260); this.seaTex = wt;
    const m = new THREE.MeshLambertMaterial({ map: wt, color: 0xbfe6ff }); this.mats.push(m);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), m);
    const mid = (this.N / 2) | 0; sea.position.set(this.cx[mid], this.seaY, this.cz[mid]);
    this.group.add(sea);
  }

  // ---- item boxes + boost pads ------------------------------------------------
  _buildPickups(level, rnd) {
    const L = this.length;
    const qTex = canvasTex(128, 128, (g, W, Hh) => {
      const gr = g.createLinearGradient(0, 0, W, Hh);
      ['#ff3e3e', '#ffb400', '#fff23e', '#3eff6a', '#3ec8ff', '#b03eff'].forEach((c, i) => gr.addColorStop(i / 5, c));
      g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
      g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(5, 5, W - 10, Hh - 10);
      g.font = '900 100px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 10; g.strokeStyle = '#000'; g.strokeText('?', W / 2, Hh / 2 + 6); g.fillStyle = '#fff'; g.fillText('?', W / 2, Hh / 2 + 6);
    });
    const boxGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5), boxMat = new THREE.MeshBasicMaterial({ map: qTex, transparent: true, opacity: 0.93 }); this.mats.push(boxMat);
    this.boxes = [];
    const gap = Math.min(3.6, (this.trailW * 2 + 2) / 4);
    for (let s = 230; s < L - 200; s += 280 + rnd() * 80) {
      if (this.crossings.some((c) => Math.abs(c - s) < 12)) s += 24;
      const tu = this.trailAt(s), n = 4;
      for (let k = 0; k < n; k++) {
        const u = tu + (k - (n - 1) / 2) * gap, mesh = new THREE.Mesh(boxGeo, boxMat);
        const b = { s, u, y: this.heightAt(s, u) + 1.5, mesh, t: 0, ph: rnd() * 6 };
        this.pos(s, u, b.y, mesh.position); this.group.add(mesh); this.boxes.push(b);
      }
    }
    const padTex = canvasTex(64, 128, (g, W, Hh) => {
      g.fillStyle = '#ff7a00'; g.fillRect(0, 0, W, Hh); g.fillStyle = '#fff23e';
      for (let k = 0; k < 4; k++) { const y = 8 + k * 32; g.beginPath(); g.moveTo(6, y); g.lineTo(W / 2, y + 16); g.lineTo(W - 6, y); g.lineTo(W - 6, y + 10); g.lineTo(W / 2, y + 26); g.lineTo(6, y + 10); g.fill(); }
    }, { repeat: true });
    this.padTex = padTex;
    const padMat = new THREE.MeshBasicMaterial({ map: padTex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide }); this.mats.push(padMat);
    this.pads = [];
    const v = new THREE.Vector3();
    for (let s = 380 + rnd() * 100; s < L - 260; s += 380 + rnd() * 200) {
      if (this.jumps.some((j) => s > j.s - j.len - 12 && s < j.s + 8) || this.drops.some((d) => Math.abs(d.s - s) < 14) || this.stair[Math.round(s / DS)]) continue;
      const u = this.trailAt(s) + (rnd() < 0.5 ? -1 : 1) * Math.min(3.2, this.trailW * 0.5);
      const posA = [], uvA = [], idx = [], Rn = 5;
      for (let r = 0; r <= Rn; r++) for (let c = 0; c < 2; c++) { this.ground(s - 4 + r * 1.6, u + (c ? 1.7 : -1.7), v, 0.12); posA.push(v.x, v.y, v.z); uvA.push(c ? 0 : 1, -r / Rn * 2); }
      for (let r = 0; r < Rn; r++) { const o = r * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2)); g.setIndex(idx);
      this.group.add(new THREE.Mesh(g, padMat)); this.pads.push({ s, u });
    }
  }

  update(dt, time) {
    for (const b of this.boxes) {
      if (b.t > 0) { b.t -= dt; b.mesh.visible = b.t <= 0; }
      b.mesh.rotation.y = time * 1.6 + b.ph; b.mesh.rotation.x = time * 0.9 + b.ph;
      b.mesh.position.y = b.y + Math.sin(time * 2.4 + b.ph) * 0.25;
    }
    this.padTex.offset.y = -time * 2.2;
    if (this.seaTex) this.seaTex.offset.set(time * 0.004, time * 0.007);
  }

  dispose() {
    // shared photo textures (assets.js cache) are kept; canvas textures are freed
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.mats) { if (m.map && m.map.isCanvasTexture) m.map.dispose(); m.dispose(); }
  }
}
