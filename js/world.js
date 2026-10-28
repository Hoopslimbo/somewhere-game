import * as THREE from 'three';
import { buildCharacter } from './character.js';

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
// Islands are WAY larger than the original 380-wide build: the landmass
// radius roughly doubles (edge ~310–460) for ~4× the playable land area.
// Cave carves (see below) are cut into the terrain itself, so heightAt
// = base height + carve depression, keyed per seed.
const caveCarvesBySeed = new Map();
function carveDelta(x, z, seed) {
  const carves = caveCarvesBySeed.get(seed >>> 0);
  if (!carves) return 0;
  let delta = 0;
  for (const c of carves) {
    const px = x - c.mx, pz = z - c.mz;
    const u = px * c.dx + pz * c.dz; // 0 at mouth, + into the hill
    const v = -px * c.dz + pz * c.dx; // sideways distance from tunnel axis
    if (u < -1.5 || u > c.len + 1.5 || Math.abs(v) > c.halfW + 1.5) continue;
    const along = sstep(-1.5, 1.0, u) * (1 - sstep(c.len - 2, c.len + 1.5, u));
    const across = 1 - sstep(c.halfW, c.halfW + 1.5, Math.abs(v));
    const shape = along * across;
    if (!shape) continue;
    // The tunnel floor sits near the mouth height and descends gently
    // into the hill; the deeper the hillside rises above it, the deeper
    // the cut — so the opening reads as a notch carved into the slope.
    const floorH = c.mouthH - 0.12 * u;
    const surface = baseHeightAt(x, z, seed);
    delta -= Math.max(0, surface - floorH) * shape;
  }
  return delta;
}
export function heightAt(x, z, seed) {
  return baseHeightAt(x, z, seed) + carveDelta(x, z, seed);
}
// True if (x, z) falls inside a cave carve (plus margin) — placements
// (trees, rocks, chests, ground stones) skip carve ground so nothing
// floats or sinks inside a tunnel mouth.
export function inCaveCarve(x, z, seed, margin = 0) {
  const carves = caveCarvesBySeed.get(seed >>> 0);
  if (!carves) return false;
  for (const c of carves) {
    const px = x - c.mx, pz = z - c.mz;
    const u = px * c.dx + pz * c.dz;
    const v = -px * c.dz + pz * c.dx;
    if (u >= -1.5 - margin && u <= c.len + 1.5 + margin && Math.abs(v) <= c.halfW + 1.5 + margin) return true;
  }
  return false;
}
function baseHeightAt(x, z, seed) {
  const r = Math.hypot(x, z);
  const edgeN = fbm(x * 0.004 + 300, z * 0.004, seed + 21);
  const edgeR = 877 + (edgeN - 0.5) * 424;
  const edge = 1 - sstep(edgeR - 68, edgeR + 170, r);
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
  const mx = Math.sin(seed * 12.9898) * 509, mz = Math.cos(seed * 78.233) * 509;
  const md = Math.hypot(x - mx, z - mz);
  h += 30 * Math.exp(-(md * md) / (2 * 311 * 311)) * (0.7 + 0.3 * fbm(x * 0.01, z * 0.01, seed + 31));
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
// Without this, some seeds (e.g. the demo seed 4242) roll zero caved
// terrain at all, so no cave could ever spawn there.
export function cavedHotspot(x, z, seed, h) {
  if (h <= 14) return false;
  const mx = Math.sin(seed * 12.9898) * 509, mz = Math.cos(seed * 78.233) * 509;
  // Flanks only (141–311 from the massif center): the peak itself stays
  // snowy, so a seed never loses the snowy biome to the hotspot.
  const md = Math.hypot(x - mx, z - mz);
  return md >= 141 && md < 311;
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
  gold: std(0xf5c542, 0.35, 0.35, { emissive: 0x442200 }), // low metalness: no env map, so high metalness read as dark brown
  wood: [0x8a5a2b, 0x7a4e24, 0x96682f].map((c) => std(c, 1)),
  chest: std(0x9a6a35, 0.9),
  chestLid: [std(0xf5c542, 0.3, 0.8, { emissive: 0x442200 }), std(0x6b4a26, 0.9), std(0x8a5a2b, 0.9)],
  snow: std(0xf2f6fa, 0.9),
  lantern: std(0xffc766, 0.4, 0, { emissive: 0xff9a2a, emissiveIntensity: 1.6 }),
};
const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];

function groundTexture() {
  // Reworked ground detail: the old texture was a flat white canvas
  // with harsh 1.6px speckle tiled 110× — up close it read as noisy
  // plastic, and the tiling showed. The new one is multi-scale and
  // soft: large low-contrast mottled blobs (patchy grass/dirt/sand
  // variation), a mid layer of soft grain, and only a whisper of fine
  // speckle — all in neutral gray so the per-vertex biome colors still
  // drive the actual hue. Tiled 48× instead of 110× so the repeat is
  // far less visible at walking eye level.
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#cfcfcf'; ctx.fillRect(0, 0, 512, 512);
  // Large soft mottling: overlapping radial blobs, ±10% brightness.
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 18 + Math.random() * 70;
    const light = Math.random() < 0.5;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, light ? 'rgba(255,255,255,0.10)' : 'rgba(60,60,60,0.10)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Mid grain: soft 2–4px dots, low alpha — texture without noise.
  for (let i = 0; i < 5200; i++) {
    const g = 150 + Math.floor(Math.random() * 90);
    ctx.fillStyle = `rgba(${g},${g},${g},0.16)`;
    ctx.beginPath(); ctx.arc(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 1.6, 0, Math.PI * 2); ctx.fill();
  }
  // Sparse tiny pebble dots for close-up richness.
  for (let i = 0; i < 900; i++) {
    const g = 90 + Math.floor(Math.random() * 90);
    ctx.fillStyle = `rgba(${g},${g},${g},0.20)`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1.4, 1.4);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(96, 96); // same texel density as 48 over the old 380-size island
  tex.anisotropy = 4;
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

export function buildWorld(scene, seed) {
  // 8× land area vs the 760 island: linear × sqrt(8) ≈ 2.83, so 2150
  // across (2150² / 760² = 8.0× area) at the same vertex density
  // (2150/1130 ≈ 760/400 ≈ 1.9 units per vertex).
  const SIZE = 2150, SEG = 1130;
  // Cave carves are computed FIRST (own RNG stream, so the main rand
  // stream — and therefore tree/rock/chest placement — is untouched)
  // and registered before any heightAt call, so the terrain mesh itself
  // carries the carved tunnel notches.
  caveCarvesBySeed.set(seed >>> 0, planCaveCarves(seed));
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  pos.count; // positions filled below
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z, seed));
  }
  geo.computeVertexNormals();
  // Per-vertex colors: blended per biome, never hard patches or misplaced
  // snow. Base grass/sand/forest colors blend smoothly by region noise;
  // snow appears ONLY above a proper snowline that varies by biome (low in
  // snowy mountains, lower still in caved mountains, very high everywhere
  // else — so plains hills stay grassy), with a noise-broken edge, and
  // steep slopes shed snow to exposed rock.
  const normals = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color(), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
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
    // A low-frequency noise jitter varies smoothly instead, so terrain
    // shades blend instead of stepping cell to cell.
    const j = (fbm(x * 0.35, z * 0.35, seed + 51) - 0.5) * 0.06;
    colors[i * 3] = Math.min(1, Math.max(0, col.r + j));
    colors[i * 3 + 1] = Math.min(1, Math.max(0, col.g + j));
    colors[i * 3 + 2] = Math.min(1, Math.max(0, col.b + j));
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96, map: groundTexture(),
  }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Sea (visual only in v1 — water mechanics are v2). A single flat,
  // slightly deeper-tinted plane: water reads as water, never as a
  // colored grid — the grid look came from per-cell terrain jitter,
  // fixed above with smooth shading noise.
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE * 3, SIZE * 3),
    new THREE.MeshStandardMaterial({ color: 0x2f7fc4, transparent: true, opacity: 0.85, roughness: 0.15, metalness: 0.1 })
  );
  sea.rotation.x = -Math.PI / 2; sea.position.y = SEA; scene.add(sea);

  const rand = mulberry(seed * 7919 + 13);
  const trees = [], rocks = [], chests = [], interactables = [];
  const spawn = findSpawn(seed);

  // ---- Trees: groves + clearings, slope-aware, coastal palms ----
  for (let i = 0; i < 8800; i++) {
    const x = (rand() - 0.5) * (SIZE - 20), z = (rand() - 0.5) * (SIZE - 20);
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    if (inCaveCarve(x, z, seed, 1)) continue;
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
    group.position.set(x, h - 0.1, z);
    group.rotation.y = rand() * Math.PI * 2;
    scene.add(group);
    trees.push({ group, x, z, h, hp: 3, kind: form, trunkH: trunkH * s, radius: 0.6 * s, scale: s });
  }
  // ---- Rocks: craggy, tinted, clustered on ridges + high ground ----
  for (let i = 0; i < 2800; i++) {
    const x = (rand() - 0.5) * (SIZE - 20), z = (rand() - 0.5) * (SIZE - 20);
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    if (inCaveCarve(x, z, seed, 1)) continue;
    const sl = slopeAt(x, z, seed);
    if (sl < 0.7 && h < 14 && rand() < 0.45) continue; // rocks favor steeps + heights
    const iron = biomeAt(x, z, seed) === 'caved' ? rand() < 0.45 : rand() < 0.12;
    const s = 0.5 + rand() * 0.9;
    const rock = new THREE.Mesh(jitteredRockGeo(s, rand), iron ? MATS.iron : pick(MATS.stone, rand));
    rock.position.set(x, h + s * 0.4, z); rock.castShadow = true;
    rock.rotation.set(rand() * 0.6, rand() * 3, rand() * 0.6);
    scene.add(rock);
    if (iron) {
      const fleck = new THREE.Mesh(new THREE.BoxGeometry(s * 0.5, s * 0.3, s * 0.2), MATS.rust);
      fleck.position.set(x, h + s * 0.9, z + s * 0.4); scene.add(fleck);
    }
    rocks.push({ mesh: rock, x, z, h, hp: iron ? 4 : 3, iron, radius: s });
  }
  // Ground stones (pickup fallback for chopping)
  const groundStones = [];
  for (let i = 0; i < 320; i++) {
    const x = spawn.x + (rand() - 0.5) * 44, z = spawn.z + (rand() - 0.5) * 44;
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    if (inCaveCarve(x, z, seed, 1)) continue;
    const s = 0.20 + rand() * 0.16;
    const st = new THREE.Mesh(jitteredRockGeo(s, rand), pick(MATS.stone, rand));
    st.position.set(x, h + 0.15, z); st.castShadow = true; scene.add(st);
    groundStones.push({ mesh: st, x, z, h });
  }
  // Loot chests: varied size + lid tint, occasional crate beside
  const LOOT = [
    [{ id: 'leather', n: 2 }, { id: 'money', n: 25 }],
    [{ id: 'iron', n: 3 }, { id: 'seed_wheat', n: 4 }],
    [{ id: 'leather', n: 3 }, { id: 'apple', n: 2 }],
    [{ id: 'seed_carrot', n: 4 }, { id: 'money', n: 20 }],
    [{ id: 'iron', n: 2 }, { id: 'leather', n: 2 }, { id: 'seed_wheat', n: 3 }],
  ];
  for (let i = 0; i < 240; i++) {
    const x = (rand() - 0.5) * (SIZE - 40), z = (rand() - 0.5) * (SIZE - 40);
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    if (inCaveCarve(x, z, seed, 1)) continue;
    const grp = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.7), MATS.chest);
    base.position.y = 0.3; base.castShadow = true; grp.add(base);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 0.7), pick(MATS.chestLid, rand));
    lid.position.y = 0.72; lid.castShadow = true; grp.add(lid);
    // Metal bands + latch AFTER the lid: opening code uses children[1]
    // as the lid, so nothing may be inserted before it.
    const bandM = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.45, metalness: 0.7 });
    for (const bx of [-0.38, 0.38]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.58, 0.72), bandM);
      band.position.set(bx, 0.3, 0); grp.add(band);
    }
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.05), MATS.gold);
    latch.position.set(0, 0.62, 0.37); grp.add(latch);
    if (rand() < 0.35) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), pick(MATS.wood, rand));
      crate.position.set(0.95, 0.28, 0.3); crate.rotation.y = rand() * 1.2; crate.castShadow = true; grp.add(crate);
    }
    grp.scale.setScalar(0.9 + rand() * 0.3);
    grp.position.set(x, h, z); grp.rotation.y = rand() * Math.PI * 2;
    scene.add(grp);
    chests.push({ group: grp, x, z, h, loot: LOOT[i % LOOT.length], opened: false });
  }
  // ---- Bushes, grass tufts, flowers (instanced — cheap, varied) ----
  const dummy = new THREE.Object3D();
  const bushGeo = new THREE.SphereGeometry(0.7, 7, 5);
  const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, 3040);
  const bushCol = new THREE.Color();
  let bi = 0;
  for (let i = 0; i < 7200 && bi < 3040; i++) {
    const x = (rand() - 0.5) * (SIZE - 20), z = (rand() - 0.5) * (SIZE - 20);
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    if (inCaveCarve(x, z, seed, 1)) continue;
    const b = biomeAt(x, z, seed);
    if (b === 'desert' || b === 'snowy') continue;
    dummy.position.set(x, h + 0.2, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(0.45 + rand() * 0.55, 0.35 + rand() * 0.3, 0.45 + rand() * 0.55);
    dummy.updateMatrix();
    bushes.setMatrixAt(bi, dummy.matrix);
    bushes.setColorAt(bi, bushCol.setHSL(0.29 + rand() * 0.06, 0.45, 0.24 + rand() * 0.10));
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
  const grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, 12000);
  let gi = 0;
  const grassCol = new THREE.Color();
  for (let i = 0; i < 27200 && gi < 12000; i++) {
    let x, z;
    if (i < 130) { x = spawn.x + (rand() - 0.5) * 36; z = spawn.z + (rand() - 0.5) * 36; }
    else { x = (rand() - 0.5) * (SIZE - 20); z = (rand() - 0.5) * (SIZE - 20); }
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    if (inCaveCarve(x, z, seed, 1)) continue;
    const b = biomeAt(x, z, seed);
    if (b === 'snowy' || b === 'caved') continue;
    dummy.position.set(x, h + 0.12, z);
    dummy.rotation.set((rand() - 0.5) * 0.6, rand() * Math.PI * 2, (rand() - 0.5) * 0.6);
    const gs = 0.7 + rand() * 0.6;
    dummy.scale.set(gs, gs, gs * 0.45); // flattened: a blade, not a cone tree
    dummy.updateMatrix();
    grass.setMatrixAt(gi, dummy.matrix);
    if (b === 'desert') grassCol.setHSL(0.13, 0.45, 0.42 + rand() * 0.12);
    else grassCol.setHSL(0.28 + rand() * 0.05, 0.5, 0.30 + rand() * 0.15);
    grass.setColorAt(gi, grassCol);
    gi++;
  }
  grass.count = gi;
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  scene.add(grass);
  const flowerGeo = new THREE.SphereGeometry(0.07, 6, 5);
  const flowerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, 1120);
  const flowerCols = [0xe86a92, 0xf5c542, 0xffffff, 0xc07ae0];
  let fi = 0;
  for (let i = 0; i < 3600 && fi < 1120; i++) {
    const x = (rand() - 0.5) * (SIZE - 20), z = (rand() - 0.5) * (SIZE - 20);
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    if (inCaveCarve(x, z, seed, 1)) continue;
    if (biomeAt(x, z, seed) !== 'plains') continue;
    dummy.position.set(x, h + 0.32, z);
    dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(0.8 + rand() * 0.6);
    dummy.updateMatrix();
    flowers.setMatrixAt(fi, dummy.matrix);
    flowers.setColorAt(fi, tmp.set(flowerCols[Math.floor(rand() * flowerCols.length)]));
    fi++;
  }
  flowers.count = fi;
  flowers.instanceMatrix.needsUpdate = true;
  if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
  scene.add(flowers);

  // ---- Fine ground detail: pebbles, small rocks, dirt patches ----
  // Close-up richness: the ground is never a bare flat color up close.
  const pebGeo = new THREE.DodecahedronGeometry(1, 0);
  const pebMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const pebbles = new THREE.InstancedMesh(pebGeo, pebMat, 7200);
  const pebCol = new THREE.Color();
  let pi = 0;
  for (let i = 0; i < 16000 && pi < 7200; i++) {
    // First samples cluster near spawn so the ground reads detailed
    // the moment you step out, not just far away
    let x, z;
    if (i < 100) { x = spawn.x + (rand() - 0.5) * 36; z = spawn.z + (rand() - 0.5) * 36; }
    else { x = (rand() - 0.5) * (SIZE - 20); z = (rand() - 0.5) * (SIZE - 20); }
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    if (inCaveCarve(x, z, seed, 1)) continue;
    const b = biomeAt(x, z, seed);
    dummy.position.set(x, h + 0.05, z);
    dummy.rotation.set(rand() * 0.8, rand() * Math.PI * 2, rand() * 0.8);
    const ps = 0.06 + rand() * 0.16;
    dummy.scale.set(ps, ps * (0.6 + rand() * 0.4), ps);
    dummy.updateMatrix();
    pebbles.setMatrixAt(pi, dummy.matrix);
    if (b === 'desert') pebCol.setHSL(0.11, 0.4, 0.45 + rand() * 0.15);
    else if (b === 'snowy' || b === 'caved') pebCol.setHSL(0.6, 0.05, 0.55 + rand() * 0.25);
    else pebCol.setHSL(0.08, 0.12, 0.35 + rand() * 0.2);
    pebbles.setColorAt(pi, pebCol);
    pi++;
  }
  pebbles.count = pi;
  pebbles.instanceMatrix.needsUpdate = true;
  if (pebbles.instanceColor) pebbles.instanceColor.needsUpdate = true;
  pebbles.castShadow = true;
  scene.add(pebbles);
  // Dirt patch discs hugging the ground (plains / forest / desert)
  const dirtMat = new THREE.MeshStandardMaterial({ color: 0x6b4e2e, roughness: 1 });
  for (let i = 0; i < 1600; i++) {
    const x = (rand() - 0.5) * (SIZE - 20), z = (rand() - 0.5) * (SIZE - 20);
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    if (inCaveCarve(x, z, seed, 1)) continue;
    const b = biomeAt(x, z, seed);
    if (b === 'snowy' || b === 'caved') continue;
    if (slopeAt(x, z, seed) > 0.35) continue; // flat ground only, so discs don't clip into slopes
    const s = 0.8 + rand() * 1.8;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(s, 12), dirtMat.clone());
    disc.material.color.offsetHSL(0, 0, (rand() - 0.5) * 0.08);
    if (b === 'desert') disc.material.color.set(0xc99a5e);
    disc.rotation.x = -Math.PI / 2;
    disc.rotation.z = rand() * Math.PI;
    disc.position.set(x, h + 0.05, z);
    disc.receiveShadow = true;
    scene.add(disc);
  }

  // ---- Caves: entrances CARVED into the hillside (Minecraft-like) ----
  // The terrain itself is notched by planCaveCarves + carveDelta (see
  // heightAt): a tunnel-shaped depression cut into a caved-mountain
  // slope, deepest inside the hill and fading to nothing at the mouth.
  // What you see is NOT a freestanding box: the slope opens into a
  // notch, irregular rocks rim the mouth and line the tunnel, flat rock
  // slabs bridge overhead, and the tunnel floor IS the carved ground —
  // so walking in follows the terrain instead of a box floor.
  // Cave sites are planned on their own RNG stream (deterministic per
  // seed) so tree/rock/chest placement never shifts.
  function planCaveCarves(seed) {
    const crand = mulberry((seed ^ 0x9E3779B9) >>> 0);
    const spawn = findSpawn(seed);
    const carves = [];
    const trySite = (x, z) => {
      if (carves.length >= 4) return false;
      const mh = baseHeightAt(x, z, seed);
      if (mh < 12) return false;
      const r = regionAt(x, z, seed);
      const caveN = fbm(x * 0.006 + 300, z * 0.006, seed);
      const b = cavedHotspot(x, z, seed, mh) ? 'caved' : biomeFrom(mh, r, caveN);
      if (b !== 'caved') return false;
      if (Math.hypot(x - spawn.x, z - spawn.z) < 170) return false;
      if (carves.some((c) => Math.hypot(c.mx - x, c.mz - z) < 311)) return false;
      // Uphill direction = into the hill; the mouth faces downhill.
      const gx = baseHeightAt(x + 2, z, seed) - baseHeightAt(x - 2, z, seed);
      const gz = baseHeightAt(x, z + 2, seed) - baseHeightAt(x, z - 2, seed);
      const gl = Math.hypot(gx, gz) || 1;
      const dx = gx / gl, dz = gz / gl;
      const frontH = baseHeightAt(x - dx * 3, z - dz * 3, seed);
      const backH = baseHeightAt(x + dx * 8, z + dz * 8, seed);
      const slopeAlong = (backH - frontH) / 11;
      if (slopeAlong < 0.22 || slopeAlong > 0.95) return false;
      carves.push({ mx: x, mz: z, dx, dz, len: 8, halfW: 2.0, mouthH: mh });
      return true;
    };
    for (let i = 0; i < 500 && carves.length < 4; i++) {
      trySite((crand() - 0.5) * 1980, (crand() - 0.5) * 1980);
    }
    if (carves.length < 4) {
      const scored = [];
      for (let x = -960; x <= 960; x += 57) for (let z = -960; z <= 960; z += 57) {
        const h = baseHeightAt(x, z, seed);
        const caveN = fbm(x * 0.006 + 300, z * 0.006, seed);
        if (h > 12 && caveN > 0.50) scored.push({ x, z, s: caveN + h / 100 });
      }
      scored.sort((a, b) => b.s - a.s);
      for (const c of scored) {
        if (carves.length >= 4) break;
        trySite(c.x, c.z);
      }
    }
    return carves;
  }
  const caves = [];
  const caveDark = new THREE.MeshStandardMaterial({ color: 0x1a1712, roughness: 1, side: THREE.DoubleSide });
  const caveRock = new THREE.MeshStandardMaterial({ color: 0x6e6a60, roughness: 1, side: THREE.DoubleSide });
  {
    const carves = caveCarvesBySeed.get(seed >>> 0) || [];
    carves.forEach((c, ci) => {
      const crand = mulberry((seed ^ ((ci + 1) * 2654435761)) >>> 0);
      // Group origin at the mouth, local +z pointing INTO the hill.
      const g = new THREE.Group();
      g.position.set(c.mx, c.mouthH, c.mz);
      g.rotation.y = Math.atan2(c.dx, c.dz);
      // Dark tunnel floor, tilted to follow the carved descent.
      const floor = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.12, c.len + 1.5), caveDark);
      floor.position.set(0, -0.12 * (c.len / 2) + 0.06, c.len / 2);
      floor.rotation.x = Math.atan(0.12);
      floor.receiveShadow = true; g.add(floor);
      // Irregular rock walls lining the tunnel (tilted slabs, not boxes).
      for (let u = 1; u <= c.len; u += 1.6) {
        for (const sx of [-1.9, 1.9]) {
          const wall = new THREE.Mesh(jitteredRockGeo(0.9 + crand() * 0.4, crand), pick(MATS.stone, crand));
          wall.scale.set(0.55, 1.5, 1.3);
          wall.position.set(sx, -0.12 * u + 1.0, u);
          wall.rotation.set((crand() - 0.5) * 0.5, crand() * 3, (crand() - 0.5) * 0.5);
          wall.castShadow = true; g.add(wall);
        }
      }
      // Flat rock slabs bridging overhead — ends buried in the carve
      // walls, so they read as natural overhang, not a roof slab.
      for (const u of [2.5, 4.5, 6.5]) {
        const slab = new THREE.Mesh(jitteredRockGeo(1.4, crand), pick(MATS.stone, crand));
        slab.scale.set(2.4, 0.35, 1.3);
        slab.position.set(0, -0.12 * u + 2.7, u);
        slab.rotation.set((crand() - 0.5) * 0.2, crand() * 0.4, (crand() - 0.5) * 0.2);
        slab.castShadow = true; g.add(slab);
      }
      // Back of the tunnel: dark wall + rock cluster.
      const back = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.8, 0.4), new THREE.MeshStandardMaterial({ color: 0x0a0908, roughness: 1, side: THREE.DoubleSide }));
      back.position.set(0, -0.12 * c.len + 1.4, c.len + 0.2); g.add(back);
      for (let i = 0; i < 3; i++) {
        const rock = new THREE.Mesh(jitteredRockGeo(0.7 + crand() * 0.4, crand), pick(MATS.stone, crand));
        rock.position.set((crand() - 0.5) * 2.4, -0.12 * c.len + 0.4, c.len + 0.4);
        rock.castShadow = true; g.add(rock);
      }
      // Mouth rim: a ragged arch of rocks following the carved surface.
      for (let v = -2.4; v <= 2.41; v += 0.8) {
        const wx = c.mx - c.dz * v - c.dx * 0.3, wz = c.mz + c.dx * v - c.dz * 0.3;
        const rim = new THREE.Mesh(jitteredRockGeo(0.55 + crand() * 0.35, crand), pick(MATS.stone, crand));
        // Local coords: local x = -v, local z = u = -0.3; y from the
        // carved surface so the rim hugs the slope, not floats over it.
        rim.position.set(-v, heightAt(wx, wz, seed) - c.mouthH + 0.25, -0.3);
        rim.rotation.set(crand() * 0.6, crand() * 3, crand() * 0.6);
        rim.castShadow = true; g.add(rim);
      }
      // Dim warm light + iron ore inside, the reason to go in.
      const lamp = new THREE.PointLight(0xffb37a, 30, 16, 1.8);
      lamp.position.set(0, -0.12 * 4 + 2.0, 4); g.add(lamp);
      for (let i = 0; i < 3; i++) {
        const ore = new THREE.Mesh(jitteredRockGeo(0.4 + crand() * 0.2, crand), MATS.iron);
        const u = 3.5 + crand() * 3;
        ore.position.set((crand() - 0.5) * 1.6, -0.12 * u + 0.3, u);
        ore.castShadow = true; g.add(ore);
      }
      scene.add(g);
      // Facing = mouth-outward (downhill), matching game.js groundY
      // local axes: local +z points out of the mouth, -z into the hill.
      const facing = Math.atan2(-c.dx, -c.dz);
      caves.push({ x: c.mx, z: c.mz, h: c.mouthH, group: g, facing, floorY: c.mouthH, slope: -0.12, len: c.len });
      lantern(scene, c.mx - c.dx * 3, c.mz - c.dz * 3, seed);
    });
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
  const goldDark = new THREE.MeshStandardMaterial({ color: 0x9a7a1a, roughness: 0.5, metalness: 0.35, emissive: 0x332200 });
  for (const sz of [-0.28, 0, 0.28]) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.22), goldDark);
    slat.position.set(0, 0.90, sz); bench.add(slat);
  }
  const brace = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.10, 0.10), goldDark);
  brace.position.set(0, 0.22, 0); bench.add(brace);
  bench.position.set(spawn.x - 4, heightAt(spawn.x - 4, spawn.z + 3, seed), spawn.z + 3);
  // Gold-trimmed tool board behind the gold bench (decorative, like the
  // workbench pegboard — keeps the gold bench distinct and unmistakable)
  const gBoard = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.5, 0.08), MATS.gold);
  gBoard.position.set(0, 1.55, -0.62); gBoard.castShadow = true; bench.add(gBoard);
  const gInner = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x6b5410, roughness: 0.7, metalness: 0.4 }));
  gInner.position.set(0, 1.55, -0.57); bench.add(gInner);
  const gTool = new THREE.MeshStandardMaterial({ color: 0xf5c542, roughness: 0.35, metalness: 0.35, emissive: 0x442200 });
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
  lantern(scene, spawn.x - 6, spawn.z + 4, seed);
  clutterAround(scene, bench.position.x, bench.position.z, seed, rand, 2);

  // Fresh worlds start CLEAN: terrain, trees, rocks, loot chests, and
  // the gold spawn bench only. No pre-stocked NPC shop, car shop, land
  // office, or machines — those appear only when the player builds
  // them (vehicle machines and gas pumps are workbench recipes; the
  // shop/car-shop/land-office have no build path yet, so removing them
  // also removes those interactions until Liam asks for one).
  // A lantern by the gold bench stays: it marks spawn, not a shop.

  return { spawn, trees, rocks, groundStones, chests, interactables, caves, size: SIZE };
}
