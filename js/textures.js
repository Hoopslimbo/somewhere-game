// ---------- Procedural canvas textures (shared by game.js + world.js) ----------
// One cached CanvasTexture per material family — never one per instance.
// Two families:
//  * PRE-TINTED: the canvas carries the hue; use with a white material
//    color. This is the wash-out fix for buildPieceMesh's matTex().
//  * LIGHT-BASE: a pale canvas whose detail lives in luminance; use
//    with a tinted material color (or instanceColor / vertex colors),
//    because map x color multiplies in Three.js.
// All drawing uses only fillRect / arc / radial gradients so the
// headless document stub can build them too. 256px everywhere
// (ground stays 512px in world.js). Stylized AND realistic: detailed,
// believable material cues, still in the game's stylized palette —
// not photoreal, not Fortnite-perfect.
import * as THREE from 'three';

const _cache = {};
function mk(key, size, draw) {
  if (_cache[key]) return _cache[key];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  // Kept so a matching normal map can be derived from the same canvas
  // (redo slice 1) — the color pattern must not be re-rolled.
  t.userData.sourceCanvas = c;
  _cache[key] = t;
  return t;
}
// Small drawing helpers (stub-safe: no strokes, no paths beyond arcs).
function dots(x, s, n, shades, aMin, aMax, rMin, rMax) {
  for (let i = 0; i < n; i++) {
    x.fillStyle = shades[Math.floor(Math.random() * shades.length)];
    x.globalAlpha = aMin + Math.random() * (aMax - aMin);
    x.beginPath();
    x.arc(Math.random() * s, Math.random() * s, rMin + Math.random() * (rMax - rMin), 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
}
function streaks(x, s, n, vertical, shades, aMin, aMax, wMax) {
  for (let i = 0; i < n; i++) {
    x.fillStyle = shades[Math.floor(Math.random() * shades.length)];
    x.globalAlpha = aMin + Math.random() * (aMax - aMin);
    if (vertical) x.fillRect(Math.random() * s, 0, 1 + Math.random() * wMax, s);
    else x.fillRect(0, Math.random() * s, s, 1 + Math.random() * wMax);
  }
  x.globalAlpha = 1;
}
function blobs(x, s, n, rMin, rMax, light, dark) {
  for (let i = 0; i < n; i++) {
    const px = Math.random() * s, py = Math.random() * s, r = rMin + Math.random() * (rMax - rMin);
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    const col = Math.random() < 0.5 ? light : dark;
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
  }
}
function knots(x, s, n, col) {
  for (let i = 0; i < n; i++) {
    const px = 30 + Math.random() * (s - 60), py = 30 + Math.random() * (s - 60);
    for (let r = 9; r > 0; r -= 3) {
      x.fillStyle = col;
      x.globalAlpha = 0.20;
      x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    }
    x.globalAlpha = 1;
  }
}
function rows(x, s, rowH, off, bw, base, vary, mortar) {
  x.fillStyle = mortar; x.fillRect(0, 0, s, s);
  for (let r = 0; r < s / rowH; r++) {
    const o = (r % 2) * off;
    for (let cx = -1; cx < s / bw + 1; cx++) {
      const v = Math.floor(Math.random() * vary);
      x.fillStyle = base(v);
      x.fillRect(cx * bw + o + 2, r * rowH + 2, bw - 4, rowH - 4);
      x.fillStyle = 'rgba(0,0,0,0.16)';
      x.fillRect(cx * bw + o + 2, r * rowH + rowH - 6, bw - 4, 4);
    }
  }
}

// ---------- Environment map (redo slice 1) ----------
// Tiny procedural equirectangular environment: sky gradient on top, a
// warm horizon band, dark ground below, soft sun glow. Assigned as
// scene.environment so metals (gold, iron, steel) have something to
// reflect — before this there was no env map at all, so high metalness
// read as dark plastic. One-time cost; shared by every scene.
let _env = null;
export function envTex() {
  if (_env) return _env;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, 128);
  sky.addColorStop(0, '#7ab8e8');
  sky.addColorStop(0.45, '#cfe4f5');
  sky.addColorStop(0.5, '#f5d9a8'); // warm horizon band
  sky.addColorStop(0.55, '#5a5a52');
  sky.addColorStop(1, '#2a2a26');
  x.fillStyle = sky; x.fillRect(0, 0, 256, 128);
  // Soft sun glow, upper sky.
  const g = x.createRadialGradient(128, 34, 0, 128, 34, 60);
  g.addColorStop(0, 'rgba(255,246,214,0.95)');
  g.addColorStop(1, 'rgba(255,246,214,0)');
  x.fillStyle = g;
  x.beginPath(); x.arc(128, 34, 60, 0, Math.PI * 2); x.fill();
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  _env = t;
  return t;
}

// ---------- Normal maps (redo slice 1) ----------
// Sobel-filter normal maps derived from the existing color canvases,
// so the relief matches the painted grain exactly. Sampling wraps, so
// the normal map tiles seamlessly like its color map. Strength stays
// modest (0.6) — stylized-smooth relief, not bumpy photoreal. One-time
// CPU at load. Returns null (callers then skip the normal map) if the
// canvas pixel APIs are unavailable — e.g. the headless stub — and
// never throws.
export function normalMapFromCanvas(src, strength = 0.6) {
  try {
    const s = src.width, h = src.height;
    const sctx = src.getContext('2d');
    if (typeof sctx.getImageData !== 'function') return null;
    const data = sctx.getImageData(0, 0, s, h).data;
    const lum = (px, py) => {
      const i = (((py + h) % h) * s + ((px + s) % s)) * 4;
      return (data[i] + data[i + 1] + data[i + 2]) / 3 / 255;
    };
    const out = document.createElement('canvas');
    out.width = s; out.height = h;
    const octx = out.getContext('2d');
    const img = octx.createImageData(s, h);
    for (let y = 0; y < h; y++) {
      for (let px = 0; px < s; px++) {
        const gx = (lum(px + 1, y - 1) + 2 * lum(px + 1, y) + lum(px + 1, y + 1))
          - (lum(px - 1, y - 1) + 2 * lum(px - 1, y) + lum(px - 1, y + 1));
        const gy = (lum(px - 1, y + 1) + 2 * lum(px, y + 1) + lum(px + 1, y + 1))
          - (lum(px - 1, y - 1) + 2 * lum(px, y - 1) + lum(px + 1, y - 1));
        let nx = -gx * strength, ny = -gy * strength, nz = 1;
        const il = 1 / Math.hypot(nx, ny, nz);
        nx *= il; ny *= il; nz *= il;
        const o = (y * s + px) * 4;
        img.data[o] = (nx * 0.5 + 0.5) * 255;
        img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[o + 2] = (nz * 0.5 + 0.5) * 255;
        img.data[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(out);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  } catch (e) { return null; }
}
export function normalMapFor(colorTex, strength = 0.6) {
  if (!colorTex || !colorTex.userData || !colorTex.userData.sourceCanvas) return null;
  if (colorTex.userData.normalTex) return colorTex.userData.normalTex;
  const n = normalMapFromCanvas(colorTex.userData.sourceCanvas, strength);
  if (n) colorTex.userData.normalTex = n;
  return n;
}

// ---------- Pre-tinted (use with white) ----------
export function woodTex() {
  return mk('wood', 256, (x, s) => {
    x.fillStyle = '#8a5a2b'; x.fillRect(0, 0, s, s);
    streaks(x, s, 60, false, ['#6b4226', '#5a3a1a', '#9a6a35', '#7a4e24'], 0.15, 0.4, 3);
    streaks(x, s, 20, false, ['#a8793f'], 0.10, 0.2, 2);
    knots(x, s, 3, '#5a3a1a');
  });
}
export function brickTintedTex() {
  return mk('brickTint', 256, (x, s) => {
    rows(x, s, 32, -32, 64, (v) => `rgb(${154 + v},${90 + v},${72 + v})`, 30, '#cbbfa8');
  });
}
export function shingleTintedTex() {
  return mk('shingleTint', 256, (x, s) => {
    rows(x, s, 32, -21, 42, (v) => `rgb(${163 + v},${74 + v},${58 + v})`, 30, '#7a3a2e');
  });
}
export function steelTex() {
  return mk('steel', 256, (x, s) => {
    x.fillStyle = '#d8dde2'; x.fillRect(0, 0, s, s);
    streaks(x, s, 140, true, ['#a8adb4', '#c8ccd2', '#9aa0a8'], 0.10, 0.25, 1);
  });
}
export function goldTex() {
  return mk('gold', 256, (x, s) => {
    x.fillStyle = '#d8a437'; x.fillRect(0, 0, s, s);
    streaks(x, s, 70, false, ['#b8862a', '#f5c542', '#a8761e'], 0.15, 0.35, 2);
  });
}
export function panelTex() {
  return mk('panel', 256, (x, s) => {
    x.fillStyle = '#3a4a63'; x.fillRect(0, 0, s, s);
    // Panel seams.
    x.fillStyle = 'rgba(10,14,24,0.55)';
    x.fillRect(0, 84, s, 3); x.fillRect(0, 170, s, 3); x.fillRect(84, 0, 3, s); x.fillRect(170, 0, 3, s);
    // Vent slits.
    for (let i = 0; i < 5; i++) x.fillRect(20, 30 + i * 12, 46, 4);
    for (let i = 0; i < 5; i++) x.fillRect(190, 190 + i * 10, 40, 3);
    // Bolt dots.
    dots(x, s, 8, ['#8d8f94'], 0.8, 0.9, 2.5, 3.5);
    // Subtle brushed variation.
    streaks(x, s, 40, true, ['#2a3648', '#46586f'], 0.10, 0.2, 2);
  });
}
export function pumpPanelTex() {
  return mk('pumpPanel', 256, (x, s) => {
    x.fillStyle = '#d8dde2'; x.fillRect(0, 0, s, s);
    x.fillStyle = 'rgba(90,95,105,0.5)';
    x.fillRect(0, 84, s, 2); x.fillRect(0, 170, s, 2); x.fillRect(84, 0, 2, s); x.fillRect(170, 0, 2, s);
    streaks(x, s, 50, true, ['#a8adb4', '#e8eaec'], 0.10, 0.2, 1);
  });
}
export function sidingTex() {
  return mk('siding', 256, (x, s) => {
    x.fillStyle = '#e8ddc8'; x.fillRect(0, 0, s, s);
    streaks(x, s, 30, false, ['#d8cdb8', '#c9bfa4'], 0.15, 0.3, 2);
    for (let y = 0; y < s; y += 32) { x.fillStyle = 'rgba(90,75,55,0.45)'; x.fillRect(0, y, s, 2); }
  });
}
export function shadowTex() {
  return mk('shadow', 256, (x, s) => {
    x.fillStyle = '#232338'; x.fillRect(0, 0, s, s);
    // Purple ember veins running along the blade.
    streaks(x, s, 26, true, ['#7a5cff', '#b07aff', '#4a3a8a'], 0.25, 0.55, 2);
    dots(x, s, 40, ['#b07aff', '#7a5cff'], 0.3, 0.6, 1, 2.5);
    streaks(x, s, 30, true, ['#101018'], 0.2, 0.4, 3);
  });
}
export function frostTex() {
  return mk('frost', 256, (x, s) => {
    x.fillStyle = '#cfeaff'; x.fillRect(0, 0, s, s);
    blobs(x, s, 40, 14, 50, 'rgba(255,255,255,0.25)', 'rgba(140,190,230,0.25)');
    // Jagged frost cracks: stepped short rects.
    for (let i = 0; i < 14; i++) {
      let px = Math.random() * s, py = Math.random() * s;
      x.fillStyle = 'rgba(255,255,255,0.75)';
      for (let j = 0; j < 8; j++) { x.fillRect(px, py, 2, 2 + Math.random() * 6); px += (Math.random() - 0.5) * 14; py += 6 + Math.random() * 8; }
    }
  });
}
export function soilTex() {
  return mk('soil', 256, (x, s) => {
    x.fillStyle = '#4a3220'; x.fillRect(0, 0, s, s);
    for (let px = 0; px < s; px += 18) { x.fillStyle = 'rgba(20,12,6,0.55)'; x.fillRect(px, 0, 6, s); }
    dots(x, s, 900, ['#6b4e2e', '#5a3a1a', '#3a2a1a'], 0.3, 0.6, 1, 2.5);
  });
}
export function swirlTex() {
  return mk('swirl', 256, (x, s) => {
    x.fillStyle = '#7a5cff'; x.fillRect(0, 0, s, s);
    // Spiral of glowing dots, denser toward the center.
    for (let i = 0; i < 220; i++) {
      const t = i / 220, a = t * Math.PI * 7, r = 8 + t * 112;
      const px = 128 + Math.cos(a) * r, py = 128 + Math.sin(a) * r;
      x.fillStyle = i % 3 ? '#b07aff' : '#e0d4ff';
      x.globalAlpha = 0.35 + t * 0.4;
      x.beginPath(); x.arc(px, py, 1.5 + t * 2.5, 0, Math.PI * 2); x.fill();
    }
    x.globalAlpha = 1;
    blobs(x, s, 20, 20, 60, 'rgba(224,212,255,0.20)', 'rgba(40,20,90,0.30)');
  });
}
export function flakeTex() {
  return mk('flake', 256, (x, s) => {
    x.fillStyle = '#e5484d'; x.fillRect(0, 0, s, s);
    dots(x, s, 1200, ['#f5a0a3', '#c22f34', '#ff7a7e'], 0.2, 0.45, 1, 2.5);
  });
}
export function treadTex() {
  return mk('tread', 256, (x, s) => {
    x.fillStyle = '#1a1a1a'; x.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 24) for (let px = 0; px < s; px += 24) {
      x.fillStyle = 'rgba(90,90,90,0.55)';
      x.fillRect(px + ((y / 24) % 2) * 12, y + 4, 14, 14);
    }
  });
}
export function plankTex() {
  return mk('plank', 256, (x, s) => {
    x.fillStyle = '#8a5a2b'; x.fillRect(0, 0, s, s);
    streaks(x, s, 40, false, ['#6b4226', '#9a6a35'], 0.15, 0.35, 2);
    for (let y = 0; y < s; y += 64) { x.fillStyle = 'rgba(30,20,10,0.6)'; x.fillRect(0, y, s, 3); }
  });
}
export function staveTex() {
  return mk('stave', 256, (x, s) => {
    x.fillStyle = '#7a4e24'; x.fillRect(0, 0, s, s);
    streaks(x, s, 40, true, ['#5a3a1a', '#96682f'], 0.15, 0.35, 2);
    for (let px = 0; px < s; px += 42) { x.fillStyle = 'rgba(30,20,10,0.6)'; x.fillRect(px, 0, 3, s); }
  });
}
export function appleTex() {
  return mk('apple', 256, (x, s) => {
    x.fillStyle = '#d63a2f'; x.fillRect(0, 0, s, s);
    dots(x, s, 500, ['#f07870', '#b02a20', '#e5484d'], 0.25, 0.5, 1, 2.5);
    blobs(x, s, 12, 20, 50, 'rgba(255,180,170,0.25)', 'rgba(120,20,15,0.20)');
  });
}
export function carrotTex() {
  return mk('carrot', 256, (x, s) => {
    x.fillStyle = '#e87a1a'; x.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 22) { x.fillStyle = 'rgba(160,80,10,0.45)'; x.fillRect(0, y, s, 3); }
    dots(x, s, 300, ['#f5a050', '#c25e10'], 0.25, 0.45, 1, 2);
  });
}
export function wheatTex() {
  return mk('wheat', 256, (x, s) => {
    x.fillStyle = '#e8c95a'; x.fillRect(0, 0, s, s);
    streaks(x, s, 60, true, ['#c9a227', '#f5d878'], 0.25, 0.45, 2);
  });
}
export function leatherTex() {
  return mk('leather', 256, (x, s) => {
    x.fillStyle = '#7a4a22'; x.fillRect(0, 0, s, s);
    // Creases: short offset rect segments wandering down.
    for (let i = 0; i < 22; i++) {
      let px = Math.random() * s, py = Math.random() * s;
      x.fillStyle = 'rgba(40,24,10,0.5)';
      for (let j = 0; j < 6; j++) { x.fillRect(px, py, 3, 8); px += (Math.random() - 0.5) * 8; py += 9; }
    }
    dots(x, s, 700, ['#8a5a2b', '#5a3a1a'], 0.25, 0.45, 1, 2);
  });
}
export function weaveTex() {
  return mk('weave', 256, (x, s) => {
    x.fillStyle = '#ddd2b8'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 6) {
      x.fillStyle = 'rgba(120,100,70,0.18)'; x.fillRect(0, i, s, 1); x.fillRect(i, 0, 1, s);
    }
  });
}
export function phoneTex() {
  return mk('phone', 256, (x, s) => {
    x.fillStyle = '#1a1a24'; x.fillRect(0, 0, s, s);
    streaks(x, s, 30, true, ['#2a2a3a', '#101018'], 0.2, 0.35, 2);
  });
}

// ---------- Light-base luminance (use with a tint color) ----------
export function woodLightTex() {
  return mk('woodLight', 256, (x, s) => {
    x.fillStyle = '#e6d9c2'; x.fillRect(0, 0, s, s);
    streaks(x, s, 60, false, ['#b89a72', '#c9b28a'], 0.25, 0.5, 3);
    knots(x, s, 2, '#a88a62');
  });
}
export function barkLightTex() {
  return mk('barkLight', 256, (x, s) => {
    x.fillStyle = '#ddd5c8'; x.fillRect(0, 0, s, s);
    streaks(x, s, 90, true, ['#a89880', '#b8ac98', '#8f8272'], 0.25, 0.55, 4);
    knots(x, s, 2, '#8f8272');
  });
}
export function leafLightTex() {
  return mk('leafLight', 256, (x, s) => {
    x.fillStyle = '#cfd8c4'; x.fillRect(0, 0, s, s);
    blobs(x, s, 90, 10, 34, 'rgba(160,180,140,0.45)', 'rgba(90,120,80,0.45)');
    dots(x, s, 500, ['#a8b89a', '#8fa082'], 0.3, 0.5, 1, 3);
  });
}
export function leafNoiseTex() {
  return mk('leafNoise', 256, (x, s) => {
    x.fillStyle = '#e2e6da'; x.fillRect(0, 0, s, s);
    dots(x, s, 1600, ['#c2ccb2', '#b0bfa0', '#d2d8c8'], 0.3, 0.55, 1, 2.5);
    streaks(x, s, 40, true, ['#b8c4a8'], 0.2, 0.35, 1);
  });
}
export function stoneLightTex() {
  return mk('stoneLight', 256, (x, s) => {
    x.fillStyle = '#d9d9d9'; x.fillRect(0, 0, s, s);
    dots(x, s, 1400, ['#a8a8a8', '#b8b8b8', '#909090'], 0.25, 0.5, 1, 3);
    for (let i = 0; i < 10; i++) {
      let px = Math.random() * s, py = Math.random() * s;
      x.fillStyle = 'rgba(90,90,90,0.55)';
      for (let j = 0; j < 7; j++) { x.fillRect(px, py, 2, 2 + Math.random() * 5); px += (Math.random() - 0.5) * 12; py += 5 + Math.random() * 7; }
    }
  });
}
export function steelDarkTex() {
  return mk('steelDark', 256, (x, s) => {
    x.fillStyle = '#b9bdc4'; x.fillRect(0, 0, s, s);
    streaks(x, s, 120, true, ['#8f949c', '#c8ccd2'], 0.15, 0.3, 1);
  });
}
export function rustLightTex() {
  return mk('rustLight', 256, (x, s) => {
    x.fillStyle = '#e8c9a8'; x.fillRect(0, 0, s, s);
    blobs(x, s, 70, 12, 44, 'rgba(220,130,70,0.45)', 'rgba(150,70,30,0.45)');
    dots(x, s, 500, ['#c97a3a', '#a85a24'], 0.3, 0.5, 1, 3);
  });
}
export function goldLightTex() {
  return mk('goldLight', 256, (x, s) => {
    x.fillStyle = '#f0dfa8'; x.fillRect(0, 0, s, s);
    streaks(x, s, 60, false, ['#d8b25a', '#f5e2a8'], 0.25, 0.45, 2);
  });
}
export function pebbleLightTex() {
  return mk('pebbleLight', 256, (x, s) => {
    x.fillStyle = '#e0e0e0'; x.fillRect(0, 0, s, s);
    dots(x, s, 1500, ['#b8b8b8', '#c8c8c8', '#a0a0a0'], 0.25, 0.5, 1, 2.5);
  });
}
export function dirtLightTex() {
  return mk('dirtLight', 256, (x, s) => {
    x.fillStyle = '#e0d0b0'; x.fillRect(0, 0, s, s);
    dots(x, s, 1400, ['#c0a880', '#b09868', '#d0c098'], 0.3, 0.55, 1, 3);
  });
}
export function flowerTex() {
  return mk('flower', 256, (x, s) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, s, s);
    blobs(x, s, 10, 30, 60, 'rgba(200,200,200,0.35)', 'rgba(160,160,160,0.35)');
  });
}
