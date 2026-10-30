import * as THREE from 'three';
import { buildCharacter } from './character.js';
import { woodTex, barkLightTex, leafLightTex, stoneLightTex, steelDarkTex, rustLightTex, goldLightTex, woodLightTex, leafNoiseTex, pebbleLightTex, dirtLightTex, flowerTex, normalMapFor, normalMapFromCanvas } from './textures.js';

// ---- Deterministic noise ----
function hash2(x, y, seed) {
  let h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function smooth(t) { return t * t * (3 - 2 * t); }
function sstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, seed, oct = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * freq, y * freq, seed + i * 13.7);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm; // 0..1
}
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEA = 0;

// ---- Terrain: elevation is a headline feature, never flat ----
// Rolling hills everywhere, mountain masses, sharp ridges, plateaus in the
// high country, dunes in the desert, carved valleys, and a noisy island edge
// so the coastline has bays and peninsulas instead of a straight shore.
// Islands are WAY larger than the original 380-wide build: the 6x island
// has land out to edge ~760 (vs 310 on the old 760 island), ~6x the
// playable land area of the original 760-wide build.
// Caves REMOVED (2026-10-28, Liam): caves should come back as chance
// parts of biomes, NOT as generated structures — so there is no carve
// system at all now. heightAt is just the base terrain; mountains are
// solid. The 'caved' biome (less snow, rockier) stays as terrain.
export function heightAt(x, z, seed) {
  return baseHeightAt(x, z, seed);
}
function baseHeightAt(x, z, seed) {
  const r = Math.hypot(x, z);
  const edgeN = fbm(x * 0.004 + 300, z * 0.004, seed + 21);
  const edgeR = 760 + (edgeN - 0.5) * 367;
  const edge = 1 - sstep(edgeR - 59, edgeR + 147, r);
  const hills = (fbm(x * 0.006, z * 0.006, seed) - 0.5) * 2; // -1..1
  let h = hills * 7.5;
  const mMask = sstep(0.46, 0.68, fbm(x * 0.0035 + 40, z * 0.0035, seed + 7));
  h += mMask * (14 + fbm(x * 0.008 + 9, z * 0.008, seed + 3) * 30);
  const rn = 1 - Math.abs(2 * fbm(x * 0.006 + 77, z * 0.006, seed + 11) - 1);
  h += sstep(0.68, 0.92, rn) * 12 * (0.4 + mMask);
  const pMask = sstep(0.62, 0.8, fbm(x * 0.005 + 150, z * 0.005, seed + 17));
  if (mMask > 0.3) h = h * (1 - 0.45 * pMask) + 18 * 0.45 * pMask;
  const reg = regionAt(x, z, seed);
  if (reg > 0.22) {
    h += fbm(x * 0.02, z * 0.02, seed + 5) * 2.4
      + Math.sin(x * 0.35 + fbm(x * 0.01, z * 0.01, seed) * 4) * 0.7;
  }
  const vMask = sstep(0.60, 0.80, fbm(x * 0.004 + 220, z * 0.004, seed + 23));
  h -= vMask * 5;
  // Guaranteed massif: one real mountain range on EVERY island, so no seed
  // can roll an all-flat world. Seeded position, kept off the spawn area.
  const mx = Math.sin(seed * 12.9898) * 441, mz = Math.cos(seed * 78.233) * 441;
  const md = Math.hypot(x - mx, z - mz);
  h += 30 * Math.exp(-(md * md) / (2 * 269 * 269)) * (0.7 + 0.3 * fbm(x * 0.01, z * 0.01, seed + 31));
  return h * edge - 3.2;
}
export function slopeAt(x, z, seed) {
  const e = 2;
  const dx = heightAt(x + e, z, seed) - heightAt(x - e, z, seed);
  const dz = heightAt(x, z + e, seed) - heightAt(x, z - e, seed);
  return Math.hypot(dx, dz) / (2 * e);
}
export function regionAt(x, z, seed) {
  // Scaled + faster-varying so every seed gets several biome regions per island
  return (fbm(x * 0.008 + 50, z * 0.008, seed) - 0.5) * 1.6; // -0.8..0.8
}
// Cold-region mask: slow-varying noise that decides where true snowy
// mountains live. Snow is gated by this, NOT by altitude alone — otherwise
// every tall hill in the plains whites out into a "snow island".
export function coldAt(x, z, seed) {
  return fbm(x * 0.004 + 900, z * 0.004, seed + 41);
}
function biomeFrom(h, r, caveN) {
  if (h > 17) {
    if (caveN > 0.58) return 'caved';
    return 'snowy';
  }
  if (r > 0.22) return 'desert';
  if (r < -0.22) return 'tallforest';
  return 'plains';
}
// Guaranteed caved hotspot: the same seeded massif that guarantees every
// island has mountains also guarantees a caved region on its flanks.
// (Cave structures are removed for now; 'caved' is terrain only until
// caves return as chance biome features.)
export function cavedHotspot(x, z, seed, h) {
  if (h <= 14) return false;
  const mx = Math.sin(seed * 12.9898) * 441, mz = Math.cos(seed * 78.233) * 441;
  // Flanks only (122–269 from the massif center): the peak itself stays
  // snowy, so a seed never loses the snowy biome to the hotspot.
  const md = Math.hypot(x - mx, z - mz);
  return md >= 122 && md < 269;
}
export function biomeAt(x, z, seed) {
  const h = heightAt(x, z, seed);
  const r = regionAt(x, z, seed);
  const caveN = fbm(x * 0.006 + 300, z * 0.006, seed);
  if (cavedHotspot(x, z, seed, h)) return 'caved';
  return biomeFrom(h, r, caveN);
}
export function findSpawn(seed) {
  let best = null;
  for (let r = 0; r < 140; r += 4) {
    for (let a = 0; a < 16; a++) {
      const x = Math.cos(a / 16 * Math.PI * 2) * r;
      const z = Math.sin(a / 16 * Math.PI * 2) * r;
      const h = heightAt(x, z, seed);
      if (biomeAt(x, z, seed) !== 'plains') continue;
      const sl = slopeAt(x, z, seed);
      if (h > 1.5 && h < 6 && sl < 0.4) return { x, z, y: h };
      if (h > 1 && h < 8 && sl < 0.6 && (!best || sl < best.sl)) best = { x, z, y: h, sl };
    }
  }
  if (best) return { x: best.x, z: best.z, y: best.y };
  return { x: 0, z: 0, y: Math.max(1.5, heightAt(0, 0, seed)) };
}

// ---- Sky dome (gradient, updated by day/night) ----
export function makeSkyDome(radius = 700) {
  const geo = new THREE.SphereGeometry(radius, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x3d7ac8) },
      horizonColor: { value: new THREE.Color(0xcfe4f5) },
      offset: { value: 20 }, exponent: { value: 0.7 },
    },
    vertexShader: `varying vec3 vWorldPosition;
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 topColor; uniform vec3 horizonColor; uniform float offset; uniform float exponent;
      varying vec3 vWorldPosition;
      void main() { float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        vec3 col = h >= 0.0 ? mix(horizonColor, topColor, pow(h, exponent))
          : mix(horizonColor, vec3(0.16, 0.42, 0.70), min(1.0, -h * 4.0));
        gl_FragColor = vec4(col, 1.0); }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1; mesh.frustumCulled = false;
  return mesh;
}

// ---- Materials ----
function std(color, rough = 1, metal = 0, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
}
const MATS = {
  trunk: [0x6b4226, 0x7a4a28, 0x5a3a22, 0x8a5a2b].map((c) => std(c)),
  birch: std(0xd8d2c4, 0.9),
  snag: std(0x6e6258, 1),
  leaf: [0x3d7a32, 0x4c8a3a, 0x2f6b28, 0x5a9a44, 0x35702e].map((c) => std(c, 1)),
  pine: [0x2a5d3a, 0x356b42, 0x245232].map((c) => std(c, 1)),
  palmLeaf: [0x3f8a44, 0x4da154, 0x35803c].map((c) => std(c, 1)),
  stone: [0x7d7f83, 0x8d8f94, 0x6e7073, 0x8a7f70].map((c) => std(c, 1)),
  iron: std(0x5a5a60, 0.55, 0.6),
  rust: std(0xb85c2a, 0.9),
  gold: std(0xf5c542, 0.35, 0.7, { emissive: 0x442200 }), // metalness raised (redo slice 1): a procedural env map now exists, so gold reads as gold instead of dark brown
  wood: [0x8a5a2b, 0x7a4e24, 0x96682f].map((c) => std(c, 1)),
  // Loot-chest body reuses the placed chest's pre-tinted grain body.
  chest: std(0xffffff, 0.9, 0, { map: woodTex() }),
  chestLid: [std(0xf5c542, 0.3, 0.8, { emissive: 0x442200 }), std(0x6b4a26, 0.9), std(0x8a5a2b, 0.9)],
  snow: std(0xf2f6fa, 0.9),
  lantern: std(0xffc766, 0.4, 0, { emissive: 0xff9a2a, emissiveIntensity: 1.6 }),
};
const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];
// Texture redo (2026-10-29): light-base luminance maps on the shared
// materials, so each material's color still drives its hue while the
// map adds grain, speckle, and bark detail. The tex tag splits tree
// instancing buckets by texture family (bark vs leaf) in
// collectTreeParts — never one texture per tree.
MATS.trunk.forEach((m) => { m.map = barkLightTex(); m.userData.tex = 'bark'; });
MATS.birch.map = barkLightTex(); MATS.birch.userData.tex = 'bark';
MATS.snag.map = barkLightTex(); MATS.snag.userData.tex = 'bark';
MATS.leaf.forEach((m) => { m.map = leafLightTex(); m.userData.tex = 'leaf'; });
MATS.pine.forEach((m) => { m.map = leafLightTex(); m.userData.tex = 'leaf'; });
MATS.palmLeaf.forEach((m) => { m.map = leafLightTex(); m.userData.tex = 'leaf'; });
MATS.stone.forEach((m) => { m.map = stoneLightTex(); });
MATS.iron.map = steelDarkTex();
MATS.rust.map = rustLightTex();
MATS.gold.map = goldLightTex();
MATS.wood.forEach((m) => { m.map = woodLightTex(); });
// Redo slice 1: Sobel normal maps on the main shared materials —
// bark, stone, wood, and the chest's plank grain — at a modest 0.6
// scale, so the relief stays stylized-smooth. Leaf skipped deliberately:
// the biggest instanced meshes gain the least from it. Guarded: if the
// canvas pixel APIs are unavailable (headless stub), normalMapFor
// returns null and the material simply has no normal map.
function addNormal(mat, tex) {
  const n = normalMapFor(tex);
  if (n) { mat.normalMap = n; mat.normalScale.set(0.6, 0.6); }
}
MATS.trunk.forEach((m) => addNormal(m, barkLightTex()));
addNormal(MATS.birch, barkLightTex());
addNormal(MATS.snag, barkLightTex());
MATS.stone.forEach((m) => addNormal(m, stoneLightTex()));
MATS.wood.forEach((m) => addNormal(m, woodLightTex()));
addNormal(MATS.chest, woodTex());

// First ground canvas wins for the cached normal map below: the color
// canvas is re-rolled per build, but the map is near-white noise, so a
// single cached normal is visually identical and saves a 1024px Sobel
// on every world entry.
let _groundCanvas = null, _groundNormal = null;
function groundNormalTex() {
  if (_groundNormal) return _groundNormal;
  if (!_groundCanvas) groundTexture();
  const n = normalMapFromCanvas(_groundCanvas, 0.6);
  if (n) { n.repeat.set(128, 128); _groundNormal = n; }
  return _groundNormal;
}
function groundTexture() {
  // Texture redo (2026-10-29) made colors LESS vibrant on Liam's screen:
  // 9000 dense gray speckles at double the old tiling (repeat 192) laid
  // a gray veil over the vertex colors. Vibrancy fix (2026-10-29): a
  // near-white base with much lighter, sparser speckle, and a coarser
  // repeat (tile ~14.5 units) so the map adds texture without graying
  // the biome hues — vertex colors still drive the hue. Anisotropy 8
  // kept so the grain survives glancing angles. The 979-segment mesh
  // is untouched. SEAMLESS (2026-10-29, second grid fix): the old map
  // was NOT tileable — random blotches/speckle cut off at the tile
  // edges, so every tile boundary drew a seam line and the ground read
  // as a blocky grid of tiles. Every mark is now drawn at all 9 wrapped
  // offsets, so the left edge matches the right and the top matches
  // the bottom exactly — no seam grid at any repeat.
  // Redo slice 1: canvas 512px → 1024px with layered close-up detail
  // (grass-blade speckle, dirt clods, small stones). All marks are
  // scaled ×2 from the 512 layout so their world size is unchanged —
  // only sharper — and all alphas stay light so the vibrancy fix holds.
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1024;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f2f2f2'; ctx.fillRect(0, 0, 1024, 1024);
  // Draw at (x, y) plus all wrapped copies, so marks crossing an edge
  // continue on the opposite edge and the tile wraps seamlessly.
  const wrap = (x, y, fn) => {
    for (const dx of [-1024, 0, 1024]) for (const dy of [-1024, 0, 1024]) fn(x + dx, y + dy);
  };
  // Large soft blotches: irregular, low-contrast, no straight edges.
  for (let i = 0; i < 130; i++) {
    const x = Math.random() * 1024, y = Math.random() * 1024, r = 110 + Math.random() * 170;
    const light = Math.random() < 0.5;
    wrap(x, y, (wx, wy) => {
      const grad = ctx.createRadialGradient(wx, wy, 0, wx, wy, r);
      grad.addColorStop(0, light ? 'rgba(255,255,255,0.05)' : 'rgba(70,70,70,0.05)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(wx, wy, r, 0, Math.PI * 2); ctx.fill();
    });
  }
  // Mid mottling: overlapping soft blobs, patchy ground variation.
  for (let i = 0; i < 300; i++) {
    const x = Math.random() * 1024, y = Math.random() * 1024, r = 24 + Math.random() * 96;
    const light = Math.random() < 0.5;
    wrap(x, y, (wx, wy) => {
      const grad = ctx.createRadialGradient(wx, wy, 0, wx, wy, r);
      grad.addColorStop(0, light ? 'rgba(255,255,255,0.08)' : 'rgba(60,60,60,0.08)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(wx, wy, r, 0, Math.PI * 2); ctx.fill();
    });
  }
  // Light sparse speckle: close-up detail without a gray veil.
  for (let i = 0; i < 4000; i++) {
    const g = 200 + Math.floor(Math.random() * 50);
    ctx.fillStyle = `rgba(${g},${g},${g},0.15)`;
    const sx = Math.random() * 1024, sy = Math.random() * 1024, sr = 1.6 + Math.random() * 2.8;
    wrap(sx, sy, (wx, wy) => {
      ctx.beginPath(); ctx.arc(wx, wy, sr, 0, Math.PI * 2); ctx.fill();
    });
  }
  // Sparse tiny pebble dots for close-up richness.
  for (let i = 0; i < 500; i++) {
    const g = 170 + Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgba(${g},${g},${g},0.18)`;
    const px = Math.random() * 1024, py = Math.random() * 1024;
    wrap(px, py, (wx, wy) => { ctx.fillRect(wx, wy, 2.8, 2.8); });
  }
  // Grass-blade speckle: short thin strokes, faint green-gray.
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = `rgba(${130 + Math.floor(Math.random() * 40)},${140 + Math.floor(Math.random() * 30)},${110 + Math.floor(Math.random() * 30)},0.12)`;
    const bx = Math.random() * 1024, by = Math.random() * 1024, bl = 4 + Math.random() * 8;
    wrap(bx, by, (wx, wy) => { ctx.fillRect(wx, wy, 2, bl); });
  }
  // Dirt clods: small soft brown-gray blobs.
  for (let i = 0; i < 400; i++) {
    const g = 110 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgba(${g},${g - 20},${g - 45},0.14)`;
    const cx = Math.random() * 1024, cy = Math.random() * 1024, cr = 3 + Math.random() * 6;
    wrap(cx, cy, (wx, wy) => {
      ctx.beginPath(); ctx.arc(wx, wy, cr, 0, Math.PI * 2); ctx.fill();
    });
  }
  // Small stones: tiny light-gray squares.
  for (let i = 0; i < 800; i++) {
    const g = 175 + Math.floor(Math.random() * 50);
    ctx.fillStyle = `rgba(${g},${g},${g},0.20)`;
    const px = Math.random() * 1024, py = Math.random() * 1024, ps = 2 + Math.random() * 2;
    wrap(px, py, (wx, wy) => { ctx.fillRect(wx, wy, ps, ps); });
  }
  if (!_groundCanvas) _groundCanvas = cv;
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(128, 128); // tile ~14.5 world units on the 1862 island
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- Trees: 5 distinct forms, every tree randomized ----
function makeTree(form, rand, snowy) {
  const g = new THREE.Group();
  const lean = (rand() - 0.5) * 0.14;
  g.rotation.z = lean; g.rotation.x = (rand() - 0.5) * 0.10;
  let trunkH = 3;
  if (form === 'pine') {
    trunkH = 3.6 + rand() * 2.4;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.34, trunkH, 7), pick(MATS.trunk, rand));
    trunk.position.y = trunkH / 2; trunk.castShadow = true; g.add(trunk);
    const cones = 3 + Math.floor(rand() * 2);
    for (let i = 0; i < cones; i++) {
      const isTop = i === cones - 1;
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1.55 - i * 0.34 + rand() * 0.2, 1.9, 8),
        snowy && isTop ? MATS.snow : pick(MATS.pine, rand));
      cone.position.y = trunkH - 0.7 + i * 1.05; cone.castShadow = true; g.add(cone);
    }
  } else if (form === 'oak') {
    trunkH = 2.6 + rand() * 1.6;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, trunkH, 7), pick(MATS.trunk, rand));
    trunk.position.y = trunkH / 2; trunk.castShadow = true; g.add(trunk);
    const blobs = 3 + Math.floor(rand() * 3);
    const leafM = pick(MATS.leaf, rand);
    for (let i = 0; i < blobs; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1.05 + rand() * 0.65, 9, 7), leafM);
      s.position.set((rand() - 0.5) * 1.7, trunkH + (i - 1) * 0.65 + rand() * 0.3, (rand() - 0.5) * 1.7);
      s.scale.y = 0.8 + rand() * 0.3; s.castShadow = true; g.add(s);
    }
  } else if (form === 'palm') {
    trunkH = 4.2 + rand() * 1.8;
    const trunkM = pick(MATS.trunk, rand);
    const low = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.23, trunkH * 0.55, 7), trunkM);
    low.position.y = trunkH * 0.275; low.castShadow = true; g.add(low);
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, trunkH * 0.55, 7), trunkM);
    up.position.set(0.35, trunkH * 0.78, 0); up.rotation.z = -0.28; up.castShadow = true; g.add(up);
    const topX = 0.35 + Math.sin(0.28) * trunkH * 0.275, topY = trunkH * 0.78 + Math.cos(0.28) * trunkH * 0.275;
    const fan = new THREE.Group(); fan.position.set(topX, topY, 0); g.add(fan);
    const fronds = 6 + Math.floor(rand() * 3);
    const leafM = pick(MATS.palmLeaf, rand);
    for (let i = 0; i < fronds; i++) {
      const geo = new THREE.ConeGeometry(0.16, 1.9, 4);
      geo.translate(0, 0.95, 0);
      const f = new THREE.Mesh(geo, leafM);
      f.scale.set(1, 1, 0.16);
      f.rotation.x = 1.80 + rand() * 0.35;
      const holder = new THREE.Group();
      holder.rotation.y = (i / fronds) * Math.PI * 2 + rand() * 0.3;
      holder.add(f); f.castShadow = true; fan.add(holder);
    }
    for (let i = 0; i < 2; i++) {
      const nut = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), pick(MATS.trunk, rand));
      nut.position.set(topX + (rand() - 0.5) * 0.3, topY - 0.15, (rand() - 0.5) * 0.3);
      nut.castShadow = true; g.add(nut);
    }
  } else if (form === 'birch') {
    trunkH = 4.2 + rand() * 2.2;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, trunkH, 7), MATS.birch);
    trunk.position.y = trunkH / 2; trunk.castShadow = true; g.add(trunk);
    const leafM = pick([0x7fae4e, 0x9abb52, 0x6fae4e], rand);
    const leafMat = std(leafM, 1);
    leafMat.map = leafLightTex(); leafMat.userData.tex = 'leaf';
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.9 + rand() * 0.4, 8, 6), leafMat);
      s.position.set((rand() - 0.5) * 1.1, trunkH + (i - 1) * 0.6, (rand() - 0.5) * 1.1);
      s.scale.y = 0.75 + rand() * 0.3; s.castShadow = true; g.add(s);
    }
  } else { // snag: dead tree, bare branches
    trunkH = 3.0 + rand() * 2.0;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, trunkH, 7), MATS.snag);
    trunk.position.y = trunkH / 2; trunk.castShadow = true; g.add(trunk);
    const branches = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < branches; i++) {
      const len = 0.8 + rand() * 0.7;
      const geo = new THREE.CylinderGeometry(0.03, 0.06, len, 5);
      geo.translate(0, len / 2, 0);
      const br = new THREE.Mesh(geo, MATS.snag);
      br.position.y = trunkH * (0.55 + rand() * 0.4);
      br.rotation.z = 0.7 + rand() * 0.6; br.rotation.y = rand() * Math.PI * 2;
      br.castShadow = true; g.add(br);
    }
  }
  return { group: g, trunkH };
}

// ---- Async chunking + tree/dirt instancing ----
// buildWorld is async: it awaits a zero-timeout yield between phases
// and inside every big loop, so the page never hangs while a ~960k-
// vertex terrain and thousands of scatter attempts are built. Yields
// never consume rand() and never reorder iterations, so the world
// layout per seed is identical to the old sync build.
// Trees are instanced: each tree is still built by makeTree() exactly
// as before (same form, same rand() sequence), but its Group is kept
// as a DETACHED proxy — never added to the scene — and decomposed
// into canonical-geometry buckets (unit cone / sphere / cylinder,
// scaled per instance). Per-instance color comes from each part's
// material color. The proxy is what hit-shake math still mutates
// (group.scale / group.rotation.z); refreshTreeInstances() then
// rewrites that tree's instance matrices from the proxy's updated
// matrixWorld, and hideTreeInstances() hides a felled tree with
// zero-scale matrices. Instanced meshes get frustumCulled=false:
// their instances span the whole island, and the default geometry
// bounds would wrongly cull them.
const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0));
const reportProgress = (onProgress, label, frac) => {
  if (typeof onProgress === 'function') onProgress(label, frac);
};

// Canonical geometry + per-instance scale for one tree part mesh, so
// that (instanceMatrix * canonicalGeometry) reproduces the original
// part exactly. Size is factored out of the geometry and into the
// scale matrix; shape ratios and segment counts stay in the bucket
// key, so e.g. a pine cone (ConeGeometry, 8 segments) never shares a
// bucket with a palm frond (ConeGeometry, 4 segments, translated).
// Translated geometries (palm fronds, snag branches) are detected
// from the geometry's bounding-box center: normalized translate =
// center.y / height, so the canonical geometry is translated by the
// same fraction and the scale matrix restores the original offset.
function canonicalFor(mesh) {
  const geo = mesh.geometry, p = geo.parameters;
  if (!p) return { key: 'raw|' + geo.uuid, geo, scale: new THREE.Vector3(1, 1, 1) };
  geo.computeBoundingBox();
  const centerY = geo.boundingBox ? geo.boundingBox.getCenter(new THREE.Vector3()).y : 0;
  const rough = mesh.material.roughness, metal = mesh.material.metalness;
  const suffix = '|r' + rough + '|m' + metal;
  if (geo.type === 'SphereGeometry') {
    return {
      key: 'sph|' + p.widthSegments + '|' + p.heightSegments + suffix,
      geo: new THREE.SphereGeometry(1, p.widthSegments, p.heightSegments),
      scale: new THREE.Vector3(p.radius, p.radius, p.radius),
    };
  }
  if (geo.type === 'ConeGeometry') {
    const normTy = centerY / p.height;
    const cg = new THREE.ConeGeometry(1, 1, p.radialSegments);
    if (normTy !== 0) cg.translate(0, normTy, 0);
    return {
      key: 'cone|' + p.radialSegments + '|t' + normTy.toFixed(3) + suffix,
      geo: cg, scale: new THREE.Vector3(p.radius, p.height, p.radius),
    };
  }
  if (geo.type === 'CylinderGeometry') {
    const ratio = p.radiusTop / p.radiusBottom, normTy = centerY / p.height;
    const cg = new THREE.CylinderGeometry(ratio, 1, 1, p.radialSegments);
    if (normTy !== 0) cg.translate(0, normTy, 0);
    return {
      key: 'cyl|' + p.radialSegments + '|' + ratio.toFixed(6) + '|t' + normTy.toFixed(3) + suffix,
      geo: cg, scale: new THREE.Vector3(p.radiusBottom, p.height, p.radiusBottom),
    };
  }
  // Unknown part geometry (no makeTree form produces one today):
  // keep the geometry itself as its own bucket so it still renders
  // correctly, just without sharing.
  return { key: 'raw|' + geo.uuid, geo, scale: new THREE.Vector3(1, 1, 1) };
}

// Collect one detached tree proxy's parts into shared buckets.
// No rand() is consumed here; call order and counts are unchanged.
function collectTreeParts(group, bucketMap, tree, mirror = false) {
  group.updateMatrixWorld(true);
  tree.parts = [];
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    const { key, geo, scale } = canonicalFor(obj);
    // Split buckets by texture family too: a bark trunk and a leaf
    // canopy must never share one material, or one map would tint both.
    const texTag = obj.material.userData.tex || 'none';
    const bkey = key + '|tx:' + texTag;
    let bucket = bucketMap.get(bkey);
    if (!bucket) {
      // Instanced buckets rebuild materials from scratch, so the bark
      // normal map must ride along here or instanced trunks lose it.
      bucket = { geo, roughness: obj.material.roughness, metalness: obj.material.metalness, tex: texTag, normal: obj.material.normalMap || null, items: [] };
      bucketMap.set(bkey, bucket);
    }
    const scaleMatrix = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z);
    const part = { bucketKey: bkey, proxyMesh: obj, scaleMatrix, mesh: null, index: -1 };
    const matrix = new THREE.Matrix4().multiplyMatrices(obj.matrixWorld, scaleMatrix);
    const partCol = obj.material.color.clone();
    if (mirror) invertColor(partCol);
    bucket.items.push({ matrix, color: partCol, part });
    tree.parts.push(part);
  });
}

// Allocate one InstancedMesh per bucket and wire each tree part to
// its (mesh, index). Called once, after the tree loop.
function buildTreeInstancedMeshes(scene, bucketMap) {
  for (const bucket of bucketMap.values()) {
    // Light-base map under the white material: instanceColor still
    // drives each part's hue, the map only adds bark/leaf detail.
    const texMap = bucket.tex === 'bark' ? barkLightTex() : bucket.tex === 'leaf' ? leafLightTex() : null;
    const inst = new THREE.InstancedMesh(
      bucket.geo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: bucket.roughness, metalness: bucket.metalness, ...(texMap ? { map: texMap } : {}), ...(bucket.normal ? { normalMap: bucket.normal, normalScale: new THREE.Vector2(0.6, 0.6) } : {}) }),
      bucket.items.length);
    bucket.items.forEach((item, idx) => {
      inst.setMatrixAt(idx, item.matrix);
      inst.setColorAt(idx, item.color);
      item.part.mesh = inst; item.part.index = idx;
    });
    inst.castShadow = true; inst.frustumCulled = false;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scene.add(inst);
  }
}

// Recompute one tree's instance matrices from its detached proxy
// after game code mutated proxy scale/rotation (hit shake).
// Call this after changing tree.group.scale / tree.group.rotation.
export function refreshTreeInstances(tree) {
  if (!tree.parts) return;
  tree.group.updateMatrixWorld(true);
  const touched = new Set();
  for (const part of tree.parts) {
    if (!part.mesh) continue;
    part.mesh.setMatrixAt(part.index,
      new THREE.Matrix4().multiplyMatrices(part.proxyMesh.matrixWorld, part.scaleMatrix));
    touched.add(part.mesh);
  }
  for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
}

// Hide a felled tree: zero-scale matrices collapse its instances to
// a point (invisible), without removing anything from the scene.
export function hideTreeInstances(tree) {
  if (!tree.parts) return;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const touched = new Set();
  for (const part of tree.parts) {
    if (!part.mesh) continue;
    part.mesh.setMatrixAt(part.index, zero);
    touched.add(part.mesh);
  }
  for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
}

function jitteredRockGeo(s, rand) {
  // DodecahedronGeometry is NON-indexed: the same corner appears as
  // several separate vertices, one per face. Jittering each vertex
  // independently used to tear faces apart, leaving cracks and holes
  // in every rock — the "buggy rock texture". Jitter is now keyed by
  // rounded position, so shared corners move together and faces stay
  // sealed.
  const geo = new THREE.DodecahedronGeometry(s, 0);
  const pos = geo.attributes.position;
  const byKey = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = pos.getX(i).toFixed(4) + ',' + pos.getY(i).toFixed(4) + ',' + pos.getZ(i).toFixed(4);
    let j = byKey.get(key);
    if (!j) {
      j = [(1 + (rand() - 0.5) * 0.35), (1 + (rand() - 0.5) * 0.35), (1 + (rand() - 0.5) * 0.35)];
      byKey.set(key, j);
    }
    pos.setXYZ(i, pos.getX(i) * j[0], pos.getY(i) * j[1], pos.getZ(i) * j[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

function clutterAround(scene, cx, cz, seed, rand, items) {
  for (let i = 0; i < items; i++) {
    const a = rand() * Math.PI * 2, d = 1.6 + rand() * 2.0;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    const h = heightAt(x, z, seed);
    if (rand() < 0.5) {
      const s = 0.5 + rand() * 0.35;
      const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), pick(MATS.wood, rand));
      crate.position.set(x, h + s / 2, z); crate.rotation.y = rand() * Math.PI;
      crate.castShadow = true; crate.receiveShadow = true; scene.add(crate);
    } else {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.75, 10), pick(MATS.wood, rand));
      barrel.position.set(x, h + 0.38, z); barrel.rotation.y = rand() * Math.PI;
      barrel.castShadow = true; barrel.receiveShadow = true; scene.add(barrel);
    }
  }
}
function lantern(scene, x, z, seed) {
  const h = heightAt(x, z, seed);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.7, 6), MATS.snag);
  post.position.set(x, h + 0.85, z); post.castShadow = true; scene.add(post);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), MATS.lantern);
  bulb.position.set(x, h + 1.8, z); scene.add(bulb);
}

// Flipped colors (2026-10-30): in The Flipped every terrain color is
// replaced by its opposite (RGB invert) — green grass reads magenta,
// sand reads dark blue, snow reads near-black — instead of the world
// just looking darker under the frozen night. Pure transform, zero
// rand() consumed, so generation and saves are untouched.
function invertColor(c) { c.r = 1 - c.r; c.g = 1 - c.g; c.b = 1 - c.b; return c; }

export async function buildWorld(scene, seed, onProgress, opts = {}) {
  // Progress fractions below are overall (0..1) estimates per phase,
  // so a loading screen can show a single monotonic bar. onProgress
  // is optional; omitting it changes nothing about the build.
  // 6× land area vs the 760 island: linear × sqrt(6) ≈ 2.45, so 1862
  // across (1862² / 760² = 6.0× area) at the same vertex density
  // (1862/979 ≈ 760/400 ≈ 1.9 units per vertex).
  // Light build (lobby panorama only): same terrain shape and prop
  // density near the camera, but a smaller plane (~23% of the area)
  // at the same vertex density, scaled-down prop counts, and no
  // gameplay objects (loot chests, ground stones). The lobby camera
  // orbits 48 units from spawn under fog that hides everything past
  // ~380 units, so the smaller extent is invisible — but the build
  // runs ~4x faster, which is the whole lobby wait on a slow machine.
  const light = !!opts.light;
  // Mirror build (The Flipped): the SAME generation runs unchanged,
  // but every placement lands at -x, and the terrain mesh itself is
  // mirrored after the color pass. Mirroring at placement keeps rand()
  // consumption identical, so the mirrored world is a true replica.
  const mirror = !!opts.mirror;
  const mx = (x) => mirror ? -x : x;
  const SIZE = light ? 900 : 1862, SEG = light ? 480 : 979;
  const TREE_N = light ? 1550 : 6600, ROCK_N = light ? 490 : 2100,
    BUSH_N = light ? 1260 : 5400, BUSH_CAP = light ? 532 : 2280,
    GRASS_N = light ? 4770 : 20400, GRASS_CAP = light ? 2100 : 9000,
    FLOWER_N = light ? 630 : 2700, FLOWER_CAP = light ? 196 : 840,
    PEB_N = light ? 2800 : 12000, PEB_CAP = light ? 1260 : 5400,
    DIRT_N = light ? 280 : 1200;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  pos.count; // positions filled below
  reportProgress(onProgress, 'Terrain', 0);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z, seed));
    if ((i + 1) % 20000 === 0) {
      reportProgress(onProgress, 'Terrain', 0.30 * (i + 1) / pos.count);
      await yieldToBrowser();
    }
  }
  geo.computeVertexNormals(); // single call, kept sync (well under the hung-page threshold)
  // Per-vertex colors: blended per biome, never hard patches or misplaced
  // snow. Base grass/sand/forest colors blend smoothly by region noise;
  // snow appears ONLY above a proper snowline that varies by biome (low in
  // snowy mountains, lower still in caved mountains, very high everywhere
  // else — so plains hills stay grassy), with a noise-broken edge, and
  // steep slopes shed snow to exposed rock.
  const normals = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color(), tmp = new THREE.Color();
  reportProgress(onProgress, 'Terrain colors', 0.30);
  for (let i = 0; i < pos.count; i++) {
    if ((i + 1) % 20000 === 0) {
      reportProgress(onProgress, 'Terrain colors', 0.30 + 0.25 * (i + 1) / pos.count);
      await yieldToBrowser();
    }
    const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
    const r = regionAt(x, z, seed);
    const caveN = fbm(x * 0.006 + 300, z * 0.006, seed);
    const b = cavedHotspot(x, z, seed, h) ? 'caved' : biomeFrom(h, r, caveN);
    const n = fbm(x * 0.05, z * 0.05, seed);
    const n2 = fbm(x * 0.013 + 77, z * 0.013, seed + 9);
    const n3 = fbm(x * 0.03 + 200, z * 0.03, seed + 15);
    // Soft biome blend weights — no hard borders
    const desertW = sstep(0.08, 0.36, r);
    const forestW = sstep(-0.08, -0.36, r);
    if (h < 1.3) col.set(h < 0 ? 0x9a8f6a : 0xe0c98a); // shore / seabed sand
    else {
      // Plains grass base with patch variation
      col.set(n > 0.55 ? 0x6fae50 : 0x5da24a);
      if (n2 > 0.68) col.lerp(tmp.set(0x8a7a4e), 0.55); // dirt patches
      else if (n2 < 0.30) col.lerp(tmp.set(0x9aa854), 0.35); // dry grass
      if (n3 > 0.62) col.lerp(tmp.set(0x4e8a3e), 0.4); // lush patches
      // Blend toward desert sand / tall-forest deep green by region
      if (desertW > 0) {
        tmp.set(n > 0.62 ? 0xd9bc72 : 0xe6cf92);
        if (n2 > 0.66) tmp.lerp(new THREE.Color(0xc99a5e), 0.5);
        col.lerp(tmp, desertW);
      }
      if (forestW > 0) col.lerp(tmp.set(0x3a7a2e), forestW * 0.8);
      // Snowline: gated by the cold region. In cold regions, snowy
      // mountains whiten from ~14 and caved mountains get less snow from
      // ~17; in warm regions the snowline rises sharply, so a tall hill
      // in the plains stays grassy/rocky and only the very tallest peaks
      // get a light dusting. No more snow islands on grass plains.
      const coldW = sstep(0.44, 0.58, coldAt(x, z, seed));
      let snowLine, snowMax;
      if (b === 'caved') { snowLine = 17; snowMax = 0.55; }
      else if (b === 'snowy') { snowLine = 14; snowMax = 1; }
      else { snowLine = 30; snowMax = 0.7; }
      snowLine = snowLine + (1 - coldW) * 14;
      if (b === 'caved') col.lerp(tmp.set(0x8a857c), sstep(14, 20, h) * 0.35); // caved rock tint
      const snowAmt = sstep(snowLine, snowLine + 7, h + (n2 - 0.5) * 4) * snowMax * (0.25 + 0.75 * coldW);
      if (snowAmt > 0) col.lerp(tmp.set(0xf2f6fa), snowAmt);
    }
    const slope = 1 - normals.getY(i);
    if (slope > 0.28 && h > 1.3) col.lerp(tmp.set(0x7a756e), Math.min(0.85, (slope - 0.28) * 1.6)); // exposed rock on steeps
    if (slope > 0.45 && h > 1.3) col.lerp(tmp.set(0x7a756e), Math.min(0.5, (slope - 0.45) * 1.2)); // cliffs shed snow
    // Smooth shading detail: the old per-integer-cell hash jitter changed
    // abruptly between neighbouring vertices and read as a blocky grid.
    // The 2026-10-29 redo kept that grid alive a different way: its
    // fbm(x*0.35) jitter still changes almost randomly across 1.9-unit
    // vertices, so every triangle shades slightly differently and the
    // triangle edges read as a diamond grid on Liam's screen. A truly
    // low-frequency jitter (wavelength ~20 units) varies smoothly
    // instead, so terrain shades blend instead of stepping cell to cell.
    const j = (fbm(x * 0.05, z * 0.05, seed + 51) - 0.5) * 0.06;
    colors[i * 3] = Math.min(1, Math.max(0, col.r + j));
    colors[i * 3 + 1] = Math.min(1, Math.max(0, col.g + j));
    colors[i * 3 + 2] = Math.min(1, Math.max(0, col.b + j));
  }
  if (mirror) for (let i = 0; i < colors.length; i++) colors[i] = 1 - colors[i];
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (mirror) {
    // Mirror the terrain in X: negate every vertex, flip the winding
    // (otherwise faces point down), and recompute normals. Colors ride
    // along with their vertices, which is exactly right — the mirrored
    // terrain's color at (-x, z) is the original color at (x, z).
    for (let i = 0; i < pos.count; i++) pos.setX(i, -pos.getX(i));
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    geo.index.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96, map: groundTexture(),
    normalMap: groundNormalTex(), normalScale: new THREE.Vector2(0.6, 0.6),
  }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Sea (redo slice 2 — visual only, water mechanics stay v2): one
  // shader plane instead of a flat color — scrolling ripple normal,
  // fresnel sky reflection, sun glint, and a shore foam band driven by
  // a baked heightmap. The bake calls heightAt only (zero rand()),
  // so generation — and every chest save matched by exact x/z — is
  // untouched. Byte-encoded heights (0.25 steps) + linear filtering
  // keep the foam band smooth without float-texture requirements.
  const HM = light ? 256 : 512;
  const hmData = new Uint8Array(HM * HM);
  reportProgress(onProgress, 'Sea', 0.50);
  for (let hy = 0; hy < HM; hy++) {
    const z = (hy / (HM - 1) - 0.5) * SIZE;
    for (let hx = 0; hx < HM; hx++) {
      const x = (hx / (HM - 1) - 0.5) * SIZE;
      hmData[hy * HM + hx] = Math.max(0, Math.min(255, Math.round((heightAt(x, z, seed) + 4) / 64 * 255)));
    }
    if (hy % 32 === 31) await yieldToBrowser();
  }
  const heightTex = new THREE.DataTexture(hmData, HM, HM, THREE.RedFormat, THREE.UnsignedByteType);
  heightTex.magFilter = THREE.LinearFilter; heightTex.minFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping; heightTex.needsUpdate = true;
  const seaUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uHeightTex: { value: null },
    uMirror: { value: mirror ? -1 : 1 },
    uSize: { value: SIZE },
    uDeep: { value: new THREE.Color(mirror ? 0x7a3a10 : 0x25628f) },
    uShallow: { value: new THREE.Color(mirror ? 0xd0803b : 0x4fa8b8) },
    uSky: { value: new THREE.Color(mirror ? 0x1a2438 : 0xcfe4f5) },
    uFoam: { value: new THREE.Color(mirror ? 0xffd9b0 : 0xffffff) },
    uSunDir: { value: new THREE.Vector3(40, 70, 20).normalize() },
    uBright: { value: mirror ? 0.55 : 1.0 },
  }]);
  seaUniforms.uHeightTex.value = heightTex;
  const seaMat = new THREE.ShaderMaterial({
    transparent: true, fog: true, uniforms: seaUniforms,
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec3 vWorldPosition;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform float uTime, uMirror, uSize, uBright;
      uniform vec3 uDeep, uShallow, uSky, uFoam, uSunDir;
      uniform sampler2D uHeightTex;
      varying vec3 vWorldPosition;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        vec2 xz = vWorldPosition.xz;
        float t = uTime;
        // Ripple normal: two scrolling noise layers, finite-difference gradient.
        float e = 0.6;
        float n0 = vnoise(xz * 0.14 + vec2(t * 0.05, t * 0.03)) * 0.7 + vnoise(xz * 0.5 + vec2(-t * 0.08, t * 0.06)) * 0.3;
        float nx = vnoise((xz + vec2(e, 0.0)) * 0.14 + vec2(t * 0.05, t * 0.03)) * 0.7 + vnoise((xz + vec2(e, 0.0)) * 0.5 + vec2(-t * 0.08, t * 0.06)) * 0.3;
        float nz = vnoise((xz + vec2(0.0, e)) * 0.14 + vec2(t * 0.05, t * 0.03)) * 0.7 + vnoise((xz + vec2(0.0, e)) * 0.5 + vec2(-t * 0.08, t * 0.06)) * 0.3;
        vec3 n = normalize(vec3((n0 - nx) * 1.4, 1.0, (n0 - nz) * 1.4));
        // Shore height from the baked map (X mirrored in The Flipped).
        vec2 huv = vec2((xz.x * uMirror + uSize * 0.5) / uSize, (xz.y + uSize * 0.5) / uSize);
        float h = texture2D(uHeightTex, huv).r * 64.0 - 4.0;
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
        float shallow = 1.0 - smoothstep(-6.0, 0.5, h);
        vec3 col = mix(uDeep, uShallow, shallow * 0.85);
        col = mix(col, uSky, fres * 0.65);
        // Sun glint.
        vec3 hv = normalize(viewDir + uSunDir);
        col += pow(max(dot(n, hv), 0.0), 90.0) * 0.7;
        // Shore foam: band where land meets sea + an animated waterline edge.
        float band = smoothstep(-1.8, -0.7, h) * (1.0 - smoothstep(0.05, 0.45, h));
        float fn = vnoise(xz * 0.45 + vec2(-t * 0.35, t * 0.12));
        float foam = band * smoothstep(0.52, 0.72, fn);
        float edge = (1.0 - smoothstep(0.0, 0.4, abs(h))) * smoothstep(0.45, 0.6, vnoise(xz * 0.9 + vec2(t * 0.2)));
        foam = max(foam, edge * 0.8);
        col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.9);
        col *= uBright;
        gl_FragColor = vec4(col, 0.9);
        #include <fog_fragment>
      }`,
  });
  seaMat.userData.heightTex = heightTex; // disposed with preview scenes (see disposePreviewScene)
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 3, SIZE * 3), seaMat);
  sea.rotation.x = -Math.PI / 2; sea.position.y = SEA; scene.add(sea);

  const rand = mulberry(seed * 7919 + 13);
  const trees = [], rocks = [], chests = [], interactables = [];
  const spawn = findSpawn(seed);
  // Tree parts are collected into shared instancing buckets here and
  // allocated once after the loop (see buildTreeInstancedMeshes).
  // Nothing in this collection consumes rand().
  const treeBuckets = new Map();

  // ---- Trees: groves + clearings, slope-aware, coastal palms ----
  reportProgress(onProgress, 'Trees', 0.55);
  for (let i = 0; i < TREE_N; i++) {
    // Yield at the top so early `continue`s can't push the gap
    // between yields past the target spacing.
    if (i > 0 && i % 200 === 0) {
      reportProgress(onProgress, 'Trees', 0.55 + 0.15 * i / TREE_N);
      await yieldToBrowser();
    }
    const x = (rand() - 0.5) * (SIZE - 20), z = (rand() - 0.5) * (SIZE - 20);
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    const b = biomeAt(x, z, seed);
    const sl = slopeAt(x, z, seed);
    const grove = fbm(x * 0.01 + 500, z * 0.01, seed);
    if (b === 'desert') continue;
    if (b === 'plains' && grove < 0.52) continue; // clearings between groves
    if ((b === 'snowy' || b === 'caved') && sl > 1.1) continue;
    if (b !== 'snowy' && b !== 'caved' && sl > 0.85) continue;
    const dx = x - spawn.x, dz = z - spawn.z;
    if (dx * dx + dz * dz < 144) continue; // keep spawn clearing
    let form;
    if (h < 3.2 && b !== 'snowy' && b !== 'caved' && rand() < 0.30) form = 'palm';
    else if (b === 'snowy' || b === 'caved') form = rand() < 0.85 ? 'pine' : 'snag';
    else if (b === 'tallforest') form = rand() < 0.55 ? 'oak' : rand() < 0.75 ? 'pine' : 'birch';
    else if (b === 'plains') form = rand() < 0.6 ? 'oak' : rand() < 0.8 ? 'birch' : 'snag';
    else form = 'pine';
    const { group, trunkH } = makeTree(form, rand, (b === 'snowy' || b === 'caved') && coldAt(x, z, seed) > 0.55);
    let s = 0.8 + rand() * 0.7;
    if (b === 'tallforest') s *= 1.35;
    group.scale.setScalar(s);
    group.position.set(mx(x), h - 0.1, z);
    group.rotation.y = rand() * Math.PI * 2;
    // NOT scene.add(group): the group stays a detached proxy (see the
    // instancing note above) and its parts go into treeBuckets.
    // The tree record keeps `group` as that proxy, plus `parts`
    // (per-part {mesh, index} into the instanced buckets); every
    // other field is unchanged, so findTarget/collideWorld work
    // untouched.
    const tree = { group, x: mx(x), z, h, hp: 3, kind: form, trunkH: trunkH * s, radius: 0.6 * s, scale: s, parts: [] };
    collectTreeParts(group, treeBuckets, tree, mirror);
    trees.push(tree);
  }
  buildTreeInstancedMeshes(scene, treeBuckets);
  await yieldToBrowser();
  // ---- Rocks: craggy, tinted, clustered on ridges + high ground ----
  // Left as individual meshes on purpose (see report): jitteredRockGeo
  // gives every rock unique per-vertex jitter, which a shared canonical
  // geometry would erase. Its rand() cost is a constant 60 calls/rock
  // (verified in node), so instancing them later would be RNG-safe
  // if that visual trade-off is ever accepted.
  // Shared iron-ore nugget geometry/material (one of each per build;
  // nuggets themselves are cheap child meshes, no per-nugget geometry).
  const oreGeo = new THREE.BoxGeometry(1, 1, 1);
  const oreMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.9, roughness: 0.35 });
  reportProgress(onProgress, 'Rocks', 0.70);
  for (let i = 0; i < ROCK_N; i++) {
    if (i > 0 && i % 200 === 0) {
      reportProgress(onProgress, 'Rocks', 0.70 + 0.05 * i / ROCK_N);
      await yieldToBrowser();
    }
    const x = (rand() - 0.5) * (SIZE - 20), z = (rand() - 0.5) * (SIZE - 20);
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    const sl = slopeAt(x, z, seed);
    if (sl < 0.7 && h < 14 && rand() < 0.45) continue; // rocks favor steeps + heights
    const iron = biomeAt(x, z, seed) === 'caved' ? rand() < 0.45 : rand() < 0.12;
    const s = 0.5 + rand() * 0.9;
    const rock = new THREE.Mesh(jitteredRockGeo(s, rand), iron ? MATS.iron : pick(MATS.stone, rand));
    rock.position.set(mx(x), h + s * 0.4, z); rock.castShadow = true;
    rock.rotation.set(rand() * 0.6, rand() * 3, rand() * 0.6);
    scene.add(rock);
    // Visible iron ore (Liam 2026-10-29: iron rocks must read as iron).
    // The old rust fleck was a bug twice over: it sat buried INSIDE the
    // rock (rock surface reaches ~1.175s, fleck spanned 0.35–0.65s above
    // center), so it never showed — and it was an orphan scene mesh, so
    // mineRock (which removes only the rock mesh) left it floating after
    // mining. Replaced by 3 bright metallic nuggets stuck OUT of the
    // rock as children of the rock mesh: they rotate with the rock, sit
    // proud of the surface from any side, and vanish with the rock when
    // it breaks. Directions/rotations are fixed per nugget (rock rotation
    // still varies them per rock) so NO rand() is consumed here — the
    // main rand stream, and therefore ground stones + chests after this
    // loop, stays exactly where it was. Skipped in light (panorama) mode.
    if (iron && !light) {
      const dirs = [[1, 0.45, 0.25], [-0.75, 0.55, 0.6], [0.15, 0.35, -1]];
      for (let k = 0; k < dirs.length; k++) {
        const d = dirs[k], dl = Math.hypot(d[0], d[1], d[2]);
        const nug = new THREE.Mesh(oreGeo, oreMat);
        nug.position.set(d[0] / dl * s * 1.1, d[1] / dl * s * 1.1, d[2] / dl * s * 1.1);
        nug.scale.set(s * 0.42, s * 0.3, s * 0.3);
        nug.rotation.set(0.4 * (k + 1), 0.9 * (k + 1), 0.2 * (k + 1));
        rock.add(nug);
      }
    }
    rocks.push({ mesh: rock, x: mx(x), z, h, hp: iron ? 4 : 3, iron, radius: s });
  }
  // Ground stones (pickup fallback for chopping)
  // Left individual like rocks: same per-vertex jitter argument, and
  // game.js removes them with scene.remove(mesh), which still works.
  // Spread island-wide like trees/rocks — NOT clustered in a pile
  // around spawn (and the gold bench), per Liam 2026-10-29.
  const groundStones = [];
  reportProgress(onProgress, 'Ground stones', 0.75);
  for (let i = 0; i < (light ? 0 : 240); i++) {
    const x = (rand() - 0.5) * (SIZE - 20), z = (rand() - 0.5) * (SIZE - 20);
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    const s = 0.20 + rand() * 0.16;
    const st = new THREE.Mesh(jitteredRockGeo(s, rand), pick(MATS.stone, rand));
    st.position.set(mx(x), h + 0.15, z); st.castShadow = true; scene.add(st);
    groundStones.push({ mesh: st, x: mx(x), z, h });
    if ((i + 1) % 200 === 0) await yieldToBrowser();
  }
  // Top-up (Liam 2026-10-29: keep all 240 stones, just spread out):
  // water skips in the main loop land fewer than 240, so fill the gap
  // from a SEPARATE rand stream. Drawing the top-up from the main rand
  // would shift every rand call after this loop — and loot-chest save
  // states are matched back by exact x/z, so chests in existing worlds
  // would stop matching their saved states. The separate stream leaves
  // the main stream (and everything built after it) untouched.
  if (!light) {
    const randFill = mulberry(seed * 104729 + 17);
    let fillAttempts = 0;
    while (groundStones.length < 240 && fillAttempts < 2400) {
      fillAttempts++;
      const x = (randFill() - 0.5) * (SIZE - 20), z = (randFill() - 0.5) * (SIZE - 20);
      const h = heightAt(x, z, seed);
      if (h < 0.8) continue;
      const s = 0.20 + randFill() * 0.16;
      const st = new THREE.Mesh(jitteredRockGeo(s, randFill), pick(MATS.stone, randFill));
      st.position.set(mx(x), h + 0.15, z); st.castShadow = true; scene.add(st);
      groundStones.push({ mesh: st, x: mx(x), z, h });
      if (fillAttempts % 200 === 0) await yieldToBrowser();
    }
  }
  await yieldToBrowser();
  // Loot chests (REDESIGNED 2026-10-28, same look as the placed
  // storage chest): deep-wood planked body with seam grooves, an
  // arched lid, steel bands, brass latch, corner protectors — reads
  // as a chest at a distance. The lid is a GROUP hinged at its back
  // edge (origin at 0, 0.61, -0.35); opening rotates it around its
  // local X axis so it swings up and back, never lifting off.
  // Frequency cut ~3x (240 -> 80 attempts at 8x, now 60 at 6x): loot
  // chests are rarer now. Loot tables unchanged.
  const LOOT = [
    [{ id: 'leather', n: 2 }, { id: 'money', n: 25 }],
    [{ id: 'iron', n: 3 }, { id: 'seed_wheat', n: 4 }],
    [{ id: 'leather', n: 3 }, { id: 'apple', n: 2 }],
    [{ id: 'seed_carrot', n: 4 }, { id: 'money', n: 20 }],
    [{ id: 'iron', n: 2 }, { id: 'leather', n: 2 }, { id: 'seed_wheat', n: 3 }],
  ];
  reportProgress(onProgress, 'Chests', 0.77);
  for (let i = 0; i < (light ? 0 : 60); i++) {
    const x = (rand() - 0.5) * (SIZE - 40), z = (rand() - 0.5) * (SIZE - 40);
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    const grp = new THREE.Group();
    const woodM = MATS.chest;
    const darkM = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 1 });
    const bandM = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.45, metalness: 0.7 });
    const brassM = new THREE.MeshStandardMaterial({ color: 0xd8a437, roughness: 0.35, metalness: 0.6 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.58, 0.7), woodM);
    base.position.y = 0.32; base.castShadow = true; grp.add(base);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.08, 0.74), darkM);
    plinth.position.y = 0.06; grp.add(plinth);
    for (const sx of [-0.28, 0.28]) { // plank seams on the front face
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.02), darkM);
      seam.position.set(sx, 0.32, 0.36); grp.add(seam);
    }
    // Hinged lid group: origin at the BACK edge (0, 0.61, -0.35),
    // children shifted +0.35 in z so closed geometry is unchanged.
    // The brass latch + keyhole live in the lid group at the front
    // edge, so they travel with the lid when it swings open.
    const lid = new THREE.Group();
    lid.position.set(0, 0.61, -0.35);
    const lidSlab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.10, 0.7), woodM);
    lidSlab.position.set(0, 0.05, 0.35); lidSlab.castShadow = true; lid.add(lidSlab);
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.1, 12, 1, false, 0, Math.PI), woodM);
    arch.rotation.z = Math.PI / 2; arch.position.set(0, 0.10, 0.35); arch.castShadow = true; lid.add(arch);
    for (const bx of [-0.38, 0.38]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.72), bandM);
      band.position.set(bx, 0.10, 0.35); lid.add(band);
    }
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.05), brassM);
    latch.position.set(0, 0.01, 0.72); lid.add(latch);
    const keyhole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.02), darkM);
    keyhole.position.set(0, -0.01, 0.75); lid.add(keyhole);
    grp.add(lid);
    grp.userData.lid = lid;
    for (const bx of [-0.38, 0.38]) { // body bands
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.58, 0.72), bandM);
      band.position.set(bx, 0.32, 0); grp.add(band);
    }
    for (const cx of [-0.52, 0.52]) for (const cy of [0.16, 0.52]) { // corner protectors
      const corner = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.74), bandM);
      corner.position.set(cx, cy, 0); grp.add(corner);
    }
    if (rand() < 0.35) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), pick(MATS.wood, rand));
      crate.position.set(0.95, 0.28, 0.3); crate.rotation.y = rand() * 1.2; crate.castShadow = true; grp.add(crate);
    }
    grp.scale.setScalar(0.9 + rand() * 0.3);
    grp.position.set(mx(x), h, z); grp.rotation.y = rand() * Math.PI * 2;
    scene.add(grp);
    chests.push({ group: grp, x: mx(x), z, h, loot: LOOT[i % LOOT.length], opened: false });
  }
  await yieldToBrowser();
  // ---- Bushes, grass tufts, flowers (instanced — cheap, varied) ----
  const dummy = new THREE.Object3D();
  const bushGeo = new THREE.SphereGeometry(0.7, 7, 5);
  const bushMat = new THREE.MeshStandardMaterial({ map: leafNoiseTex(), color: 0xffffff, roughness: 1 });
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, BUSH_CAP);
  const bushCol = new THREE.Color();
  const bushCols = [];
  let bi = 0;
  reportProgress(onProgress, 'Bushes', 0.79);
  for (let i = 0; i < BUSH_N && bi < BUSH_CAP; i++) {
    if (i > 0 && i % 1000 === 0) {
      reportProgress(onProgress, 'Bushes', 0.79 + 0.04 * i / BUSH_N);
      await yieldToBrowser();
    }
    const x = (rand() - 0.5) * (SIZE - 20), z = (rand() - 0.5) * (SIZE - 20);
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    const b = biomeAt(x, z, seed);
    if (b === 'desert' || b === 'snowy') continue;
    dummy.position.set(mx(x), h + 0.2, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    const bsx = 0.45 + rand() * 0.55, bsy = 0.35 + rand() * 0.3, bsz = 0.45 + rand() * 0.55;
    dummy.scale.set(bsx, bsy, bsz);
    dummy.updateMatrix();
    bushes.setMatrixAt(bi, dummy.matrix);
    bushCol.setHSL(0.29 + rand() * 0.06, 0.45, 0.24 + rand() * 0.10);
    if (mirror) invertColor(bushCol);
    bushes.setColorAt(bi, bushCol);
    // Collision record (2026-10-29: bushes looked like solid lumps but
    // had no collision, so you could phase straight through them).
    // Same rand() calls, same order — generation is untouched.
    bushCols.push({ x: mx(x), z, r: 0.7 * Math.max(bsx, bsz) });
    bi++;
  }
  bushes.count = bi; bushes.castShadow = true;
  bushes.instanceMatrix.needsUpdate = true;
  if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
  scene.add(bushes);
  // Grass: SMALL, thin, ground-level blades hugging the terrain — NOT tall
  // chunky cones. The old 0.6-tall cones scaled up to ~1m read as mini
  // trees, which Liam called out. New blades are ~0.2–0.3 tall, paper-thin,
  // slightly flattened and tilted, so they read as lawn, not saplings.
  const grassGeo = new THREE.ConeGeometry(0.035, 0.30, 4);
  const grassMat = new THREE.MeshStandardMaterial({ map: leafNoiseTex(), color: 0xffffff, roughness: 1 });
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_CAP);
  let gi = 0;
  const grassCol = new THREE.Color();
  reportProgress(onProgress, 'Grass', 0.83);
  for (let i = 0; i < GRASS_N && gi < GRASS_CAP; i++) {
    if (i > 0 && i % 1000 === 0) {
      reportProgress(onProgress, 'Grass', 0.83 + 0.07 * i / GRASS_N);
      await yieldToBrowser();
    }
    let x, z;
    if (i < 130) { x = spawn.x + (rand() - 0.5) * 36; z = spawn.z + (rand() - 0.5) * 36; }
    else { x = (rand() - 0.5) * (SIZE - 20); z = (rand() - 0.5) * (SIZE - 20); }
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    const b = biomeAt(x, z, seed);
    if (b === 'snowy' || b === 'caved') continue;
    dummy.position.set(mx(x), h + 0.12, z);
    dummy.rotation.set((rand() - 0.5) * 0.6, rand() * Math.PI * 2, (rand() - 0.5) * 0.6);
    const gs = 0.7 + rand() * 0.6;
    dummy.scale.set(gs, gs, gs * 0.45); // flattened: a blade, not a cone tree
    dummy.updateMatrix();
    grass.setMatrixAt(gi, dummy.matrix);
    if (b === 'desert') grassCol.setHSL(0.13, 0.45, 0.42 + rand() * 0.12);
    else grassCol.setHSL(0.28 + rand() * 0.05, 0.5, 0.30 + rand() * 0.15);
    if (mirror) invertColor(grassCol);
    grass.setColorAt(gi, grassCol);
    gi++;
  }
  grass.count = gi;
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  scene.add(grass);
  const flowerGeo = new THREE.SphereGeometry(0.07, 6, 5);
  const flowerMat = new THREE.MeshStandardMaterial({ map: flowerTex(), color: 0xffffff, roughness: 0.8 });
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, FLOWER_CAP);
  const flowerCols = [0xe86a92, 0xf5c542, 0xffffff, 0xc07ae0];
  let fi = 0;
  reportProgress(onProgress, 'Flowers', 0.90);
  for (let i = 0; i < FLOWER_N && fi < FLOWER_CAP; i++) {
    if (i > 0 && i % 1000 === 0) {
      reportProgress(onProgress, 'Flowers', 0.90 + 0.02 * i / FLOWER_N);
      await yieldToBrowser();
    }
    const x = (rand() - 0.5) * (SIZE - 20), z = (rand() - 0.5) * (SIZE - 20);
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    if (biomeAt(x, z, seed) !== 'plains') continue;
    dummy.position.set(mx(x), h + 0.32, z);
    dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(0.8 + rand() * 0.6);
    dummy.updateMatrix();
    flowers.setMatrixAt(fi, dummy.matrix);
    tmp.set(flowerCols[Math.floor(rand() * flowerCols.length)]);
    if (mirror) invertColor(tmp);
    flowers.setColorAt(fi, tmp);
    fi++;
  }
  flowers.count = fi;
  flowers.instanceMatrix.needsUpdate = true;
  if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
  scene.add(flowers);

  // ---- Fine ground detail: pebbles, small rocks, dirt patches ----
  // Close-up richness: the ground is never a bare flat color up close.
  const pebGeo = new THREE.DodecahedronGeometry(1, 0);
  const pebMat = new THREE.MeshStandardMaterial({ map: pebbleLightTex(), color: 0xffffff, roughness: 1 });
  const pebbles = new THREE.InstancedMesh(pebGeo, pebMat, PEB_CAP);
  const pebCol = new THREE.Color();
  let pi = 0;
  reportProgress(onProgress, 'Pebbles', 0.92);
  for (let i = 0; i < PEB_N && pi < PEB_CAP; i++) {
    if (i > 0 && i % 1000 === 0) {
      reportProgress(onProgress, 'Pebbles', 0.92 + 0.05 * i / PEB_N);
      await yieldToBrowser();
    }
    // First samples cluster near spawn so the ground reads detailed
    // the moment you step out, not just far away
    let x, z;
    if (i < 100) { x = spawn.x + (rand() - 0.5) * 36; z = spawn.z + (rand() - 0.5) * 36; }
    else { x = (rand() - 0.5) * (SIZE - 20); z = (rand() - 0.5) * (SIZE - 20); }
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    const b = biomeAt(x, z, seed);
    dummy.position.set(mx(x), h + 0.05, z);
    dummy.rotation.set(rand() * 0.8, rand() * Math.PI * 2, rand() * 0.8);
    const ps = 0.06 + rand() * 0.16;
    dummy.scale.set(ps, ps * (0.6 + rand() * 0.4), ps);
    dummy.updateMatrix();
    pebbles.setMatrixAt(pi, dummy.matrix);
    if (b === 'desert') pebCol.setHSL(0.11, 0.4, 0.45 + rand() * 0.15);
    else if (b === 'snowy' || b === 'caved') pebCol.setHSL(0.6, 0.05, 0.55 + rand() * 0.25);
    else pebCol.setHSL(0.08, 0.12, 0.35 + rand() * 0.2);
    if (mirror) invertColor(pebCol);
    pebbles.setColorAt(pi, pebCol);
    pi++;
  }
  pebbles.count = pi;
  pebbles.instanceMatrix.needsUpdate = true;
  if (pebbles.instanceColor) pebbles.instanceColor.needsUpdate = true;
  // Lobby perf (redo slice 6): pebble shadows are invisible at that size
  // — pure waste in the 2048 shadow pass. Trees/bushes still cast.
  pebbles.castShadow = false;
  scene.add(pebbles);
  // Dirt patch discs hugging the ground (plains / forest / desert)
  // Instanced like trees: one CircleGeometry(1, 12) + instanceColor,
  // instead of ~hundreds of individual CircleGeometry meshes with
  // cloned materials. rand() order is preserved exactly: s, then the
  // lightness-offset rand (consumed even for desert discs, as before),
  // then the rotation rand. frustumCulled=false for the same
  // whole-island reason as the tree buckets.
  const dirtItems = [];
  reportProgress(onProgress, 'Dirt patches', 0.97);
  for (let i = 0; i < DIRT_N; i++) {
    if (i > 0 && i % 1000 === 0) await yieldToBrowser();
    const x = (rand() - 0.5) * (SIZE - 20), z = (rand() - 0.5) * (SIZE - 20);
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    const b = biomeAt(x, z, seed);
    if (b === 'snowy' || b === 'caved') continue;
    if (slopeAt(x, z, seed) > 0.35) continue; // flat ground only, so discs don't clip into slopes
    const s = 0.8 + rand() * 1.8;
    const discCol = new THREE.Color(0x6b4e2e);
    discCol.offsetHSL(0, 0, (rand() - 0.5) * 0.08);
    if (b === 'desert') discCol.set(0xc99a5e);
    dummy.position.set(mx(x), h + 0.05, z);
    dummy.rotation.set(-Math.PI / 2, 0, rand() * Math.PI);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    if (mirror) invertColor(discCol);
    dirtItems.push({ matrix: dummy.matrix.clone(), color: discCol });
  }
  if (dirtItems.length) {
    const dirt = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 12),
      new THREE.MeshStandardMaterial({ map: dirtLightTex(), color: 0xffffff, roughness: 1 }),
      dirtItems.length);
    dirtItems.forEach((item, idx) => {
      dirt.setMatrixAt(idx, item.matrix);
      dirt.setColorAt(idx, item.color);
    });
    dirt.receiveShadow = true; dirt.frustumCulled = false;
    dirt.instanceMatrix.needsUpdate = true;
    if (dirt.instanceColor) dirt.instanceColor.needsUpdate = true;
    scene.add(dirt);
  }

  // Gold infinite bench (unbreakable, unmovable) near spawn
  const bench = new THREE.Group();
  const bTop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 0.9), MATS.gold);
  bTop.position.y = 0.75; bTop.castShadow = true; bench.add(bTop);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.7, 0.8), MATS.gold);
    leg.position.set(sx * 1.0, 0.35, 0); bench.add(leg);
  }
  // Slatted top + leg braces so the gold bench reads as a built bench,
  // not a floating slab on two blocks.
  const goldDark = new THREE.MeshStandardMaterial({ map: goldLightTex(), color: 0x9a7a1a, roughness: 0.5, metalness: 0.35, emissive: 0x332200 });
  for (const sz of [-0.28, 0, 0.28]) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.22), goldDark);
    slat.position.set(0, 0.90, sz); bench.add(slat);
  }
  const brace = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.10, 0.10), goldDark);
  brace.position.set(0, 0.22, 0); bench.add(brace);
  // Mirror: the bench's height comes from the UNmirrored coordinate
  // (mirrored terrain height at -x equals original height at x), while
  // its x lands mirrored. Spawn itself is negated just below.
  bench.position.set(mx(spawn.x - 4), heightAt(spawn.x - 4, spawn.z + 3, seed), spawn.z + 3);
  // Gold-trimmed tool board behind the gold bench (decorative, like the
  // workbench pegboard — keeps the gold bench distinct and unmistakable)
  const gBoard = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.5, 0.08), MATS.gold);
  gBoard.position.set(0, 1.55, -0.62); gBoard.castShadow = true; bench.add(gBoard);
  const gInner = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 0.02),
    new THREE.MeshStandardMaterial({ map: goldLightTex(), color: 0x6b5410, roughness: 0.7, metalness: 0.4 }));
  gInner.position.set(0, 1.55, -0.57); bench.add(gInner);
  const gTool = new THREE.MeshStandardMaterial({ map: goldLightTex(), color: 0xf5c542, roughness: 0.35, metalness: 0.35, emissive: 0x442200 });
  const gHammer = new THREE.Group();
  const ghHandle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.03), gTool); ghHandle.position.y = -0.1; gHammer.add(ghHandle);
  const ghHead = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.08, 0.04), gTool); ghHead.position.y = 0.14; gHammer.add(ghHead);
  gHammer.position.set(-0.8, 1.60, -0.54); bench.add(gHammer);
  const gAxe = new THREE.Group();
  const gaHandle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.46, 0.03), gTool); gAxe.add(gaHandle);
  const gaHead = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.03), gTool); gaHead.position.set(0.09, 0.18, 0); gAxe.add(gaHead);
  gAxe.position.set(0.1, 1.60, -0.54); bench.add(gAxe);
  const gSaw = new THREE.Group();
  const gsBlade = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.02), gTool); gSaw.add(gsBlade);
  const gsGrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.04), gTool); gsGrip.position.set(-0.26, 0, 0); gSaw.add(gsGrip);
  gSaw.position.set(0.95, 1.60, -0.54); bench.add(gSaw);
  scene.add(bench);
  interactables.push({ type: 'goldbench', x: bench.position.x, z: bench.position.z, radius: 2.5, mesh: bench });
  // Mirror: the lantern + clutter read terrain height at their own
  // coordinates, which would float or sink on mirrored ground, so the
  // Flipped skips those decorations — the gold bench marks spawn.
  if (!mirror) {
    lantern(scene, spawn.x - 6, spawn.z + 4, seed);
    clutterAround(scene, bench.position.x, bench.position.z, seed, rand, 2);
  }
  if (mirror) spawn.x = -spawn.x;

  // Fresh worlds start CLEAN: terrain, trees, rocks, loot chests, and
  // the gold spawn bench only. No pre-stocked NPC shop, car shop, land
  // office, or machines — those appear only when the player builds
  // them (vehicle machines and gas pumps are workbench recipes; the
  // shop/car-shop/land-office have no build path yet, so removing them
  // also removes those interactions until Liam asks for one).
  // A lantern by the gold bench stays: it marks spawn, not a shop.

  reportProgress(onProgress, 'Done', 1);
  return { spawn, trees, rocks, groundStones, chests, interactables, bushes: bushCols, size: SIZE, seaMat };
}
