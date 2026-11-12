// Loads the CC0 photo textures (Poly Haven) and sky panoramas, with a cache.
import * as THREE from 'three';

const cache = new Map(), imgs = new Map();
const loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('missing ' + url)); i.src = url; });

export async function loadAssets(texNames, skyName) {
  const jobs = [];
  for (const n of new Set(texNames)) if (!imgs.has('t:' + n)) jobs.push(loadImg(`assets/tex/${n}.jpg`).then((i) => imgs.set('t:' + n, i)));
  if (skyName && !imgs.has('s:' + skyName)) jobs.push(loadImg(`assets/sky/${skyName}.jpg`).then((i) => imgs.set('s:' + skyName, i)));
  await Promise.all(jobs);
}
export const texImage = (n) => imgs.get('t:' + n);
export const skyImage = (n) => imgs.get('s:' + n);

// Tiling photo texture, PS2-style: 512px, bilinear + mipmaps.
export function tex(name) {
  let t = cache.get(name);
  if (!t) {
    t = new THREE.Texture(imgs.get('t:' + name));
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.needsUpdate = true;
    cache.set(name, t);
  }
  return t;
}
export const COMMON_TEX = ['bark_brown_02', 'bark_willow', 'rock_face', 'plastered_wall_03', 'painted_plaster_wall', 'brick_wall_001', 'clay_roof_tiles_02', 'corrugated_iron', 'red_sandstone_wall', 'concrete_tile_facade', 'dark_rock_02'];
export const levelTex = (lv) => [lv.tex.a, lv.tex.b, lv.tex.trail, lv.tex.rock, ...COMMON_TEX];
