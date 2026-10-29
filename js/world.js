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
function collectTreeParts(group, bucketMap, tree) {
  group.updateMatrixWorld(true);
  tree.parts = [];
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    const { key, geo, scale } = canonicalFor(obj);
    let bucket = bucketMap.get(key);
    if (!bucket) {
      bucket = { geo, roughness: obj.material.roughness, metalness: obj.material.metalness, items: [] };
      bucketMap.set(key, bucket);
    }
    const scaleMatrix = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z);
    const part = { bucketKey: key, proxyMesh: obj, scaleMatrix, mesh: null, index: -1 };
    const matrix = new THREE.Matrix4().multiplyMatrices(obj.matrixWorld, scaleMatrix);
    bucket.items.push({ matrix, color: obj.material.color.clone(), part });
    tree.parts.push(part);
  });
}

// Allocate one InstancedMesh per bucket and wire each tree part to
// its (mesh, index). Called once, after the tree loop.
function buildTreeInstancedMeshes(scene, bucketMap) {
  for (const bucket of bucketMap.values()) {
    const inst = new THREE.InstancedMesh(
      bucket.geo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: bucket.roughness, metalness: bucket.metalness }),
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

export async function buildWorld(scene, seed, onProgress) {
  // Progress fractions below are overall (0..1) estimates per phase,
  // so a loading screen can show a single monotonic bar. onProgress
  // is optional; omitting it changes nothing about the build.
  // 6× land area vs the 760 island: linear × sqrt(6) ≈ 2.45, so 1862
  // across (1862² / 760² = 6.0× area) at the same vertex density
  // (1862/979 ≈ 760/400 ≈ 1.9 units per vertex).
  const SIZE = 1862, SEG = 979;
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
  // Tree parts are collected into shared instancing buckets here and
  // allocated once after the loop (see buildTreeInstancedMeshes).
  // Nothing in this collection consumes rand().
  const treeBuckets = new Map();

  // ---- Trees: groves + clearings, slope-aware, coastal palms ----
  reportProgress(onProgress, 'Trees', 0.55);
  for (let i = 0; i < 6600; i++) {
    // Yield at the top so early `continue`s can't push the gap
    // between yields past the target spacing.
    if (i > 0 && i % 200 === 0) {
      reportProgress(onProgress, 'Trees', 0.55 + 0.15 * i / 6600);
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
    group.position.set(x, h - 0.1, z);
    group.rotation.y = rand() * Math.PI * 2;
    // NOT scene.add(group): the group stays a detached proxy (see the
    // instancing note above) and its parts go into treeBuckets.
    // The tree record keeps `group` as that proxy, plus `parts`
    // (per-part {mesh, index} into the instanced buckets); every
    // other field is unchanged, so findTarget/collideWorld work
    // untouched.
    const tree = { group, x, z, h, hp: 3, kind: form, trunkH: trunkH * s, radius: 0.6 * s, scale: s, parts: [] };
    collectTreeParts(group, treeBuckets, tree);
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
  reportProgress(onProgress, 'Rocks', 0.70);
  for (let i = 0; i < 2100; i++) {
    if (i > 0 && i % 200 === 0) {
      reportProgress(onProgress, 'Rocks', 0.70 + 0.05 * i / 2100);
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
  // Left individual like rocks: same per-vertex jitter argument, and
  // game.js removes them with scene.remove(mesh), which still works.
  const groundStones = [];
  reportProgress(onProgress, 'Ground stones', 0.75);
  for (let i = 0; i < 240; i++) {
    const x = spawn.x + (rand() - 0.5) * 44, z = spawn.z + (rand() - 0.5) * 44;
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
    const s = 0.20 + rand() * 0.16;
    const st = new THREE.Mesh(jitteredRockGeo(s, rand), pick(MATS.stone, rand));
    st.position.set(x, h + 0.15, z); st.castShadow = true; scene.add(st);
    groundStones.push({ mesh: st, x, z, h });
    if ((i + 1) % 200 === 0) await yieldToBrowser();
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
  for (let i = 0; i < 60; i++) {
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
    grp.position.set(x, h, z); grp.rotation.y = rand() * Math.PI * 2;
    scene.add(grp);
    chests.push({ group: grp, x, z, h, loot: LOOT[i % LOOT.length], opened: false });
  }
  await yieldToBrowser();
  // ---- Bushes, grass tufts, flowers (instanced — cheap, varied) ----
  const dummy = new THREE.Object3D();
  const bushGeo = new THREE.SphereGeometry(0.7, 7, 5);
  const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, 2280);
  const bushCol = new THREE.Color();
  let bi = 0;
  reportProgress(onProgress, 'Bushes', 0.79);
  for (let i = 0; i < 5400 && bi < 2280; i++) {
    if (i > 0 && i % 1000 === 0) {
      reportProgress(onProgress, 'Bushes', 0.79 + 0.04 * i / 5400);
      await yieldToBrowser();
    }
    const x = (rand() - 0.5) * (SIZE - 20), z = (rand() - 0.5) * (SIZE - 20);
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
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
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, 9000);
  let gi = 0;
  const grassCol = new THREE.Color();
  reportProgress(onProgress, 'Grass', 0.83);
  for (let i = 0; i < 20400 && gi < 9000; i++) {
    if (i > 0 && i % 1000 === 0) {
      reportProgress(onProgress, 'Grass', 0.83 + 0.07 * i / 20400);
      await yieldToBrowser();
    }
    let x, z;
    if (i < 130) { x = spawn.x + (rand() - 0.5) * 36; z = spawn.z + (rand() - 0.5) * 36; }
    else { x = (rand() - 0.5) * (SIZE - 20); z = (rand() - 0.5) * (SIZE - 20); }
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
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
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, 840);
  const flowerCols = [0xe86a92, 0xf5c542, 0xffffff, 0xc07ae0];
  let fi = 0;
  reportProgress(onProgress, 'Flowers', 0.90);
  for (let i = 0; i < 2700 && fi < 840; i++) {
    if (i > 0 && i % 1000 === 0) {
      reportProgress(onProgress, 'Flowers', 0.90 + 0.02 * i / 2700);
      await yieldToBrowser();
    }
    const x = (rand() - 0.5) * (SIZE - 20), z = (rand() - 0.5) * (SIZE - 20);
    const h = heightAt(x, z, seed);
    if (h < 0.8) continue;
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
  const pebbles = new THREE.InstancedMesh(pebGeo, pebMat, 5400);
  const pebCol = new THREE.Color();
  let pi = 0;
  reportProgress(onProgress, 'Pebbles', 0.92);
  for (let i = 0; i < 12000 && pi < 5400; i++) {
    if (i > 0 && i % 1000 === 0) {
      reportProgress(onProgress, 'Pebbles', 0.92 + 0.05 * i / 12000);
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
  // Instanced like trees: one CircleGeometry(1, 12) + instanceColor,
  // instead of ~hundreds of individual CircleGeometry meshes with
  // cloned materials. rand() order is preserved exactly: s, then the
  // lightness-offset rand (consumed even for desert discs, as before),
  // then the rotation rand. frustumCulled=false for the same
  // whole-island reason as the tree buckets.
  const dirtItems = [];
  reportProgress(onProgress, 'Dirt patches', 0.97);
  for (let i = 0; i < 1200; i++) {
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
    dummy.position.set(x, h + 0.05, z);
    dummy.rotation.set(-Math.PI / 2, 0, rand() * Math.PI);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    dirtItems.push({ matrix: dummy.matrix.clone(), color: discCol });
  }
  if (dirtItems.length) {
    const dirt = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
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

  reportProgress(onProgress, 'Done', 1);
  return { spawn, trees, rocks, groundStones, chests, interactables, size: SIZE };
}
