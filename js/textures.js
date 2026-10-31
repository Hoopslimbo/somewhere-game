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
    // Long grain bands, light and dark, plus fine pore speckle.
    streaks(x, s, 90, false, ['#6b4226', '#5a3a1a', '#9a6a35', '#7a4e24', '#4a3015'], 0.15, 0.45, 3);
    streaks(x, s, 40, false, ['#a8793f', '#b98a4e'], 0.10, 0.25, 2);
    streaks(x, s, 24, false, ['#3a2410'], 0.20, 0.4, 1);
    knots(x, s, 5, '#5a3a1a');
    dots(x, s, 500, ['#5a3a1a', '#7a4e24'], 0.15, 0.3, 1, 1.5);
    // A few darker grain checks (short cross-grain cracks).
    for (let i = 0; i < 10; i++) { x.fillStyle = 'rgba(40,24,10,0.5)'; x.fillRect(Math.random() * s, Math.random() * s, 8 + Math.random() * 18, 1.5); }
  });
}
export function brickTintedTex() {
  return mk('brickTint', 256, (x, s) => {
    rows(x, s, 32, -32, 64, (v) => `rgb(${154 + v},${90 + v},${72 + v})`, 30, '#cbbfa8');
    // Per-brick speckle, a few darker fired bricks, and mortar shading.
    dots(x, s, 700, ['#7a4034', '#b87a5e', '#5a2e22'], 0.15, 0.35, 1, 2.5);
    for (let i = 0; i < 4; i++) { x.fillStyle = 'rgba(70,35,25,0.35)'; x.fillRect(Math.floor(Math.random() * 4) * 64 + 2, Math.floor(Math.random() * 8) * 32 + 2, 60, 28); }
    streaks(x, s, 20, false, ['#a8957a'], 0.10, 0.2, 2);
  });
}
export function shingleTintedTex() {
  return mk('shingleTint', 256, (x, s) => {
    rows(x, s, 32, -21, 42, (v) => `rgb(${163 + v},${74 + v},${58 + v})`, 30, '#7a3a2e');
    // Shingle butt shadows + granule speckle + weathered streaks.
    for (let r = 0; r < s / 32; r++) { x.fillStyle = 'rgba(40,15,10,0.4)'; x.fillRect(0, r * 32 + 28, s, 4); }
    dots(x, s, 800, ['#7a3226', '#c07a5e', '#5a2418'], 0.15, 0.35, 1, 2);
    streaks(x, s, 16, true, ['#8a4a3a'], 0.10, 0.2, 2);
  });
}
export function steelTex() {
  return mk('steel', 256, (x, s) => {
    x.fillStyle = '#d8dde2'; x.fillRect(0, 0, s, s);
    // Fine vertical brushing + faint horizontal machining lines.
    streaks(x, s, 200, true, ['#a8adb4', '#c8ccd2', '#9aa0a8', '#e8eaec'], 0.10, 0.25, 1);
    streaks(x, s, 40, false, ['#b8bcc2', '#c8ccd2'], 0.08, 0.15, 1);
    // Edge wear: bright nicks + dark scuffs.
    dots(x, s, 120, ['#f2f4f6', '#8f949c'], 0.25, 0.5, 1, 2);
    for (let i = 0; i < 12; i++) { x.fillStyle = 'rgba(90,95,105,0.35)'; x.fillRect(Math.random() * s, Math.random() * s, 10 + Math.random() * 22, 1); }
  });
}
export function goldTex() {
  return mk('gold', 256, (x, s) => {
    x.fillStyle = '#d8a437'; x.fillRect(0, 0, s, s);
    streaks(x, s, 110, false, ['#b8862a', '#f5c542', '#a8761e', '#e8b84a'], 0.15, 0.4, 2);
    streaks(x, s, 30, true, ['#c89a30', '#f5d76e'], 0.10, 0.2, 1);
    dots(x, s, 150, ['#fff3c4', '#f5d76e', '#9a7a1a'], 0.25, 0.5, 1, 2);
  });
}
export function panelTex() {
  return mk('panel', 256, (x, s) => {
    x.fillStyle = '#3a4a63'; x.fillRect(0, 0, s, s);
    // Panel seams with edge highlight on the lower side.
    x.fillStyle = 'rgba(10,14,24,0.55)';
    x.fillRect(0, 84, s, 3); x.fillRect(0, 170, s, 3); x.fillRect(84, 0, 3, s); x.fillRect(170, 0, 3, s);
    x.fillStyle = 'rgba(140,170,210,0.20)';
    x.fillRect(0, 87, s, 1); x.fillRect(0, 173, s, 1); x.fillRect(87, 0, 1, s); x.fillRect(173, 0, 1, s);
    // Vent slits + second vent bank.
    for (let i = 0; i < 5; i++) x.fillRect(20, 30 + i * 12, 46, 4);
    for (let i = 0; i < 5; i++) x.fillRect(190, 190 + i * 10, 40, 3);
    for (let i = 0; i < 4; i++) x.fillRect(100, 30 + i * 12, 40, 4);
    // Bolt dots with highlight + wear speckle.
    dots(x, s, 8, ['#8d8f94'], 0.8, 0.9, 2.5, 3.5);
    dots(x, s, 200, ['#2a3648', '#54647e', '#1d2536'], 0.15, 0.3, 1, 2);
    streaks(x, s, 60, true, ['#2a3648', '#46586f'], 0.10, 0.2, 2);
    // Paint chips: tiny dark nicks.
    dots(x, s, 60, ['#141a26'], 0.4, 0.6, 1, 1.5);
  });
}
export function pumpPanelTex() {
  return mk('pumpPanel', 256, (x, s) => {
    x.fillStyle = '#d8dde2'; x.fillRect(0, 0, s, s);
    x.fillStyle = 'rgba(90,95,105,0.5)';
    x.fillRect(0, 84, s, 2); x.fillRect(0, 170, s, 2); x.fillRect(84, 0, 2, s); x.fillRect(170, 0, 2, s);
    streaks(x, s, 90, true, ['#a8adb4', '#e8eaec', '#c0c4ca'], 0.10, 0.25, 1);
    dots(x, s, 150, ['#f2f4f6', '#9aa0a8'], 0.2, 0.4, 1, 2);
    // Rivets at panel corners.
    dots(x, s, 8, ['#7d8288'], 0.8, 0.9, 2, 3);
  });
}
export function sidingTex() {
  return mk('siding', 256, (x, s) => {
    x.fillStyle = '#e8ddc8'; x.fillRect(0, 0, s, s);
    streaks(x, s, 50, false, ['#d8cdb8', '#c9bfa4', '#f2ead6'], 0.15, 0.3, 2);
    for (let y = 0; y < s; y += 32) {
      x.fillStyle = 'rgba(90,75,55,0.45)'; x.fillRect(0, y, s, 2);
      x.fillStyle = 'rgba(255,252,240,0.35)'; x.fillRect(0, y + 2, s, 1);
    }
    // Nail heads + wood-knot hints per board.
    dots(x, s, 24, ['#8a7a5e'], 0.5, 0.7, 1.5, 2);
    knots(x, s, 2, '#a8957a');
  });
}
export function shadowTex() {
  return mk('shadow', 256, (x, s) => {
    x.fillStyle = '#232338'; x.fillRect(0, 0, s, s);
    // Smoky depth: dark wisps first, then purple ember veins.
    blobs(x, s, 24, 20, 60, 'rgba(10,10,24,0.5)', 'rgba(50,40,90,0.4)');
    streaks(x, s, 40, true, ['#7a5cff', '#b07aff', '#4a3a8a', '#e0d4ff'], 0.25, 0.6, 2);
    dots(x, s, 90, ['#b07aff', '#7a5cff', '#e0d4ff'], 0.3, 0.7, 1, 2.5);
    streaks(x, s, 30, true, ['#101018'], 0.2, 0.4, 3);
    // A bright ember core line down the middle.
    x.fillStyle = 'rgba(224,212,255,0.5)'; x.fillRect(s / 2 - 1, 0, 2, s);
  });
}
export function frostTex() {
  return mk('frost', 256, (x, s) => {
    x.fillStyle = '#cfeaff'; x.fillRect(0, 0, s, s);
    blobs(x, s, 60, 14, 50, 'rgba(255,255,255,0.3)', 'rgba(140,190,230,0.3)');
    // Jagged frost cracks: stepped short rects, plus fine cracklets.
    for (let i = 0; i < 22; i++) {
      let px = Math.random() * s, py = Math.random() * s;
      x.fillStyle = 'rgba(255,255,255,0.75)';
      for (let j = 0; j < 8; j++) { x.fillRect(px, py, 2, 2 + Math.random() * 6); px += (Math.random() - 0.5) * 14; py += 6 + Math.random() * 8; }
    }
    // Ice sparkle.
    dots(x, s, 250, ['#ffffff', '#a8d4f0'], 0.4, 0.7, 1, 2);
  });
}
export function soilTex() {
  return mk('soil', 256, (x, s) => {
    x.fillStyle = '#4a3220'; x.fillRect(0, 0, s, s);
    for (let px = 0; px < s; px += 18) { x.fillStyle = 'rgba(20,12,6,0.55)'; x.fillRect(px, 0, 6, s); }
    dots(x, s, 1200, ['#6b4e2e', '#5a3a1a', '#3a2a1a', '#7a5a38'], 0.3, 0.6, 1, 2.5);
    // Soil clods + tiny stones + root fibers.
    blobs(x, s, 40, 4, 10, 'rgba(30,20,10,0.5)', 'rgba(120,90,55,0.4)');
    dots(x, s, 120, ['#9a8a72', '#8a7a62'], 0.4, 0.6, 1, 2);
    streaks(x, s, 20, true, ['#3a2a1a'], 0.2, 0.35, 1);
  });
}
export function swirlTex() {
  return mk('swirl', 256, (x, s) => {
    x.fillStyle = '#7a5cff'; x.fillRect(0, 0, s, s);
    // Deep violet base variation, then a denser glowing spiral.
    blobs(x, s, 30, 20, 70, 'rgba(40,20,90,0.45)', 'rgba(150,110,255,0.30)');
    for (let i = 0; i < 340; i++) {
      const t = i / 340, a = t * Math.PI * 7, r = 8 + t * 112;
      const px = 128 + Math.cos(a) * r, py = 128 + Math.sin(a) * r;
      x.fillStyle = i % 3 ? '#b07aff' : '#e0d4ff';
      x.globalAlpha = 0.35 + t * 0.45;
      x.beginPath(); x.arc(px, py, 1.5 + t * 2.5, 0, Math.PI * 2); x.fill();
    }
    x.globalAlpha = 1;
    blobs(x, s, 20, 20, 60, 'rgba(224,212,255,0.20)', 'rgba(40,20,90,0.30)');
    // Bright core glow at the center.
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 46);
    g.addColorStop(0, 'rgba(240,230,255,0.85)');
    g.addColorStop(1, 'rgba(240,230,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(128, 128, 46, 0, Math.PI * 2); x.fill();
  });
}
export function flakeTex() {
  return mk('flake', 256, (x, s) => {
    x.fillStyle = '#e5484d'; x.fillRect(0, 0, s, s);
    // Metallic flake: two speckle sizes + clearcoat highlight blobs.
    dots(x, s, 1600, ['#f5a0a3', '#c22f34', '#ff7a7e', '#ff9a9e'], 0.2, 0.5, 1, 2.5);
    dots(x, s, 250, ['#ffd0d2', '#ffffff'], 0.3, 0.55, 1.5, 3);
    blobs(x, s, 14, 20, 55, 'rgba(255,200,200,0.18)', 'rgba(120,20,25,0.20)');
  });
}
export function treadTex() {
  return mk('tread', 256, (x, s) => {
    x.fillStyle = '#1a1a1a'; x.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 24) for (let px = 0; px < s; px += 24) {
      x.fillStyle = 'rgba(90,90,90,0.55)';
      x.fillRect(px + ((y / 24) % 2) * 12, y + 4, 14, 14);
      // Tread block groove + wear highlight.
      x.fillStyle = 'rgba(0,0,0,0.5)';
      x.fillRect(px + ((y / 24) % 2) * 12, y + 10, 14, 2);
      x.fillStyle = 'rgba(140,140,140,0.30)';
      x.fillRect(px + ((y / 24) % 2) * 12, y + 4, 14, 1.5);
    }
    dots(x, s, 300, ['#3a3a3a', '#555555'], 0.2, 0.4, 1, 2);
  });
}
export function plankTex() {
  return mk('plank', 256, (x, s) => {
    x.fillStyle = '#8a5a2b'; x.fillRect(0, 0, s, s);
    streaks(x, s, 70, false, ['#6b4226', '#9a6a35', '#5a3a1a'], 0.15, 0.4, 2);
    for (let y = 0; y < s; y += 64) {
      x.fillStyle = 'rgba(30,20,10,0.6)'; x.fillRect(0, y, s, 3);
      x.fillStyle = 'rgba(200,160,110,0.25)'; x.fillRect(0, y + 3, s, 1);
    }
    // Plank end joints + nail heads.
    for (let y = 0; y < s; y += 64) { x.fillStyle = 'rgba(30,20,10,0.5)'; x.fillRect(60 + (y % 128), y, 2, 64); }
    dots(x, s, 20, ['#2a1e10'], 0.6, 0.8, 1.5, 2);
    knots(x, s, 2, '#5a3a1a');
  });
}
export function staveTex() {
  return mk('stave', 256, (x, s) => {
    x.fillStyle = '#7a4e24'; x.fillRect(0, 0, s, s);
    streaks(x, s, 70, true, ['#5a3a1a', '#96682f', '#4a3015'], 0.15, 0.4, 2);
    for (let px = 0; px < s; px += 42) {
      x.fillStyle = 'rgba(30,20,10,0.6)'; x.fillRect(px, 0, 3, s);
      x.fillStyle = 'rgba(200,160,110,0.25)'; x.fillRect(px + 3, 0, 1, s);
    }
    dots(x, s, 300, ['#5a3a1a', '#96682f'], 0.15, 0.3, 1, 1.5);
  });
}
export function appleTex() {
  return mk('apple', 256, (x, s) => {
    x.fillStyle = '#d63a2f'; x.fillRect(0, 0, s, s);
    // Blush shading: warm highlight side, deeper red shadow side.
    blobs(x, s, 16, 30, 70, 'rgba(255,180,170,0.35)', 'rgba(120,20,15,0.30)');
    const g = x.createRadialGradient(80, 80, 10, 128, 128, 180);
    g.addColorStop(0, 'rgba(255,200,190,0.45)');
    g.addColorStop(1, 'rgba(120,20,15,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    dots(x, s, 700, ['#f07870', '#b02a20', '#e5484d', '#f5a0a3'], 0.25, 0.5, 1, 2.5);
    // Lenticel dots (tiny pale skin speckles).
    dots(x, s, 200, ['#ffd0c8'], 0.4, 0.6, 1, 1.5);
  });
}
export function carrotTex() {
  return mk('carrot', 256, (x, s) => {
    x.fillStyle = '#e87a1a'; x.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 22) { x.fillStyle = 'rgba(160,80,10,0.45)'; x.fillRect(0, y, s, 3); }
    // Ridge shading: light crest above each groove + root hairs.
    for (let y = 0; y < s; y += 22) { x.fillStyle = 'rgba(255,190,120,0.35)'; x.fillRect(0, y + 3, s, 2); }
    dots(x, s, 500, ['#f5a050', '#c25e10', '#ffb070'], 0.25, 0.5, 1, 2);
    streaks(x, s, 30, true, ['#c25e10'], 0.15, 0.3, 1);
  });
}
export function wheatTex() {
  return mk('wheat', 256, (x, s) => {
    x.fillStyle = '#e8c95a'; x.fillRect(0, 0, s, s);
    streaks(x, s, 90, true, ['#c9a227', '#f5d878', '#b8941a'], 0.25, 0.5, 2);
    // Grain kernels: small pale ovals scattered down the stalk.
    for (let i = 0; i < 60; i++) {
      const px = Math.random() * s, py = Math.random() * s;
      x.fillStyle = i % 2 ? 'rgba(245,216,120,0.7)' : 'rgba(180,150,40,0.6)';
      x.beginPath(); x.arc(px, py, 2 + Math.random() * 2.5, 0, Math.PI * 2); x.fill();
    }
    dots(x, s, 200, ['#a8851a'], 0.2, 0.35, 1, 1.5);
  });
}
export function leatherTex() {
  return mk('leather', 256, (x, s) => {
    x.fillStyle = '#7a4a22'; x.fillRect(0, 0, s, s);
    // Creases: short offset rect segments wandering down.
    for (let i = 0; i < 30; i++) {
      let px = Math.random() * s, py = Math.random() * s;
      x.fillStyle = 'rgba(40,24,10,0.5)';
      for (let j = 0; j < 6; j++) { x.fillRect(px, py, 3, 8); px += (Math.random() - 0.5) * 8; py += 9; }
    }
    dots(x, s, 1000, ['#8a5a2b', '#5a3a1a', '#96682f'], 0.25, 0.5, 1, 2);
    // Pores + edge stitching dashes.
    dots(x, s, 400, ['#4a3015'], 0.3, 0.5, 1, 1.5);
    x.fillStyle = 'rgba(230,200,150,0.6)';
    for (let i = 0; i < s; i += 12) { x.fillRect(i, 4, 6, 2); x.fillRect(i, s - 6, 6, 2); }
  });
}
export function weaveTex() {
  return mk('weave', 256, (x, s) => {
    x.fillStyle = '#ddd2b8'; x.fillRect(0, 0, s, s);
    // True over/under weave: alternating shaded thread blocks.
    for (let y = 0; y < s; y += 8) for (let px = 0; px < s; px += 8) {
      const over = ((px + y) / 8) % 2 === 0;
      x.fillStyle = over ? 'rgba(120,100,70,0.28)' : 'rgba(240,235,215,0.30)';
      x.fillRect(px, y, 8, 8);
      x.fillStyle = 'rgba(120,100,70,0.18)';
      x.fillRect(px, y + (over ? 6 : 0), 8, 1.5);
    }
    dots(x, s, 300, ['#b8a888', '#c9bfa4'], 0.2, 0.35, 1, 1.5);
  });
}
export function phoneTex() {
  return mk('phone', 256, (x, s) => {
    x.fillStyle = '#1a1a24'; x.fillRect(0, 0, s, s);
    streaks(x, s, 30, true, ['#2a2a3a', '#101018'], 0.2, 0.35, 2);
    // Edge highlight, camera dot, side button.
    x.fillStyle = 'rgba(140,140,180,0.35)'; x.fillRect(0, 0, 2, s); x.fillRect(0, 0, s, 2);
    x.fillStyle = '#0a0a12';
    x.beginPath(); x.arc(128, 26, 7, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(120,120,160,0.6)'; x.fillRect(s - 4, 70, 4, 26);
  });
}
// Phone home screen (texture pass): dark wallpaper, purple app tiles,
// status bar — used as the held phone's screen (map + emissiveMap).
export function phoneScreenTex() {
  return mk('phoneScreen', 256, (x, s) => {
    x.fillStyle = '#12081f'; x.fillRect(0, 0, s, s);
    blobs(x, s, 10, 30, 70, 'rgba(122,92,255,0.35)', 'rgba(40,20,90,0.35)');
    // Status bar.
    x.fillStyle = 'rgba(224,212,255,0.85)'; x.fillRect(16, 14, 60, 6); x.fillRect(200, 14, 40, 6);
    // App tiles: portal recall (big purple) + placeholders.
    x.fillStyle = '#7a5cff'; x.fillRect(28, 44, 88, 88);
    x.fillStyle = '#b07aff'; x.fillRect(52, 68, 40, 40);
    const tiles = ['#3a3a4a', '#2a2a3a', '#3a3a4a', '#2a2a3a', '#3a3a4a'];
    tiles.forEach((c, i) => {
      const px = 140 + (i % 2) * 56, py = 44 + Math.floor(i / 2) * 56;
      if (py + 48 > s - 20) return;
      x.fillStyle = c; x.fillRect(px, py, 48, 48);
      x.fillStyle = 'rgba(224,212,255,0.4)'; x.fillRect(px + 12, py + 12, 24, 24);
    });
    // Home indicator.
    x.fillStyle = 'rgba(224,212,255,0.7)'; x.fillRect(88, s - 16, 80, 5);
  });
}

// ---------- Light-base luminance (use with a tint color) ----------
export function woodLightTex() {
  return mk('woodLight', 256, (x, s) => {
    x.fillStyle = '#e6d9c2'; x.fillRect(0, 0, s, s);
    streaks(x, s, 90, false, ['#b89a72', '#c9b28a', '#a88a62'], 0.25, 0.5, 3);
    streaks(x, s, 24, false, ['#8a7048'], 0.2, 0.35, 1);
    knots(x, s, 4, '#a88a62');
    dots(x, s, 400, ['#a88a62', '#c9b28a'], 0.2, 0.35, 1, 1.5);
  });
}
export function barkLightTex() {
  return mk('barkLight', 256, (x, s) => {
    x.fillStyle = '#ddd5c8'; x.fillRect(0, 0, s, s);
    // Deep vertical fissures: dark grooves + light ridges.
    streaks(x, s, 130, true, ['#a89880', '#b8ac98', '#8f8272', '#7a6e5e'], 0.25, 0.6, 4);
    for (let i = 0; i < 14; i++) {
      const px = Math.random() * s;
      x.fillStyle = 'rgba(60,50,40,0.55)'; x.fillRect(px, 0, 3 + Math.random() * 4, s);
      x.fillStyle = 'rgba(230,225,210,0.30)'; x.fillRect(px + 5, 0, 2, s);
    }
    knots(x, s, 3, '#8f8272');
    dots(x, s, 300, ['#8f8272', '#c8bfb0'], 0.2, 0.35, 1, 2);
  });
}
export function leafLightTex() {
  return mk('leafLight', 256, (x, s) => {
    x.fillStyle = '#cfd8c4'; x.fillRect(0, 0, s, s);
    blobs(x, s, 130, 10, 34, 'rgba(160,180,140,0.5)', 'rgba(90,120,80,0.5)');
    dots(x, s, 800, ['#a8b89a', '#8fa082', '#c0ccb2'], 0.3, 0.55, 1, 3);
    // Leaf veins: short pale strokes.
    streaks(x, s, 50, true, ['#d8e0cc'], 0.2, 0.35, 1);
    streaks(x, s, 30, false, ['#a8b89a'], 0.2, 0.3, 1);
  });
}
export function leafNoiseTex() {
  return mk('leafNoise', 256, (x, s) => {
    x.fillStyle = '#e2e6da'; x.fillRect(0, 0, s, s);
    dots(x, s, 2200, ['#c2ccb2', '#b0bfa0', '#d2d8c8', '#98a888'], 0.3, 0.6, 1, 2.5);
    blobs(x, s, 40, 8, 22, 'rgba(150,170,130,0.35)', 'rgba(200,210,190,0.35)');
    streaks(x, s, 60, true, ['#b8c4a8'], 0.2, 0.35, 1);
  });
}
export function stoneLightTex() {
  return mk('stoneLight', 256, (x, s) => {
    x.fillStyle = '#d9d9d9'; x.fillRect(0, 0, s, s);
    dots(x, s, 1900, ['#a8a8a8', '#b8b8b8', '#909090', '#c8c8c8'], 0.25, 0.55, 1, 3);
    // Cracks + crystalline glints.
    for (let i = 0; i < 16; i++) {
      let px = Math.random() * s, py = Math.random() * s;
      x.fillStyle = 'rgba(90,90,90,0.55)';
      for (let j = 0; j < 7; j++) { x.fillRect(px, py, 2, 2 + Math.random() * 5); px += (Math.random() - 0.5) * 12; py += 5 + Math.random() * 7; }
    }
    dots(x, s, 150, ['#f0f0f0', '#e8e8e8'], 0.4, 0.6, 1, 1.5);
    blobs(x, s, 20, 10, 30, 'rgba(140,140,140,0.25)', 'rgba(200,200,200,0.25)');
  });
}
export function steelDarkTex() {
  return mk('steelDark', 256, (x, s) => {
    x.fillStyle = '#b9bdc4'; x.fillRect(0, 0, s, s);
    streaks(x, s, 180, true, ['#8f949c', '#c8ccd2', '#a8adb4'], 0.15, 0.35, 1);
    streaks(x, s, 30, false, ['#9aa0a8'], 0.10, 0.2, 1);
    dots(x, s, 120, ['#e8eaec', '#7d8288'], 0.25, 0.45, 1, 2);
  });
}
export function rustLightTex() {
  return mk('rustLight', 256, (x, s) => {
    x.fillStyle = '#e8c9a8'; x.fillRect(0, 0, s, s);
    blobs(x, s, 110, 12, 44, 'rgba(220,130,70,0.5)', 'rgba(150,70,30,0.5)');
    blobs(x, s, 40, 6, 18, 'rgba(90,40,15,0.5)', 'rgba(240,160,90,0.4)');
    dots(x, s, 700, ['#c97a3a', '#a85a24', '#e09a5a'], 0.3, 0.55, 1, 3);
  });
}
export function goldLightTex() {
  return mk('goldLight', 256, (x, s) => {
    x.fillStyle = '#f0dfa8'; x.fillRect(0, 0, s, s);
    streaks(x, s, 100, false, ['#d8b25a', '#f5e2a8', '#c8a24a'], 0.25, 0.5, 2);
    dots(x, s, 150, ['#fff3c4', '#f5d76e'], 0.3, 0.5, 1, 2);
  });
}
export function pebbleLightTex() {
  return mk('pebbleLight', 256, (x, s) => {
    x.fillStyle = '#e0e0e0'; x.fillRect(0, 0, s, s);
    dots(x, s, 2000, ['#b8b8b8', '#c8c8c8', '#a0a0a0', '#d0d0d0'], 0.25, 0.55, 1, 2.5);
    // Facet glints.
    dots(x, s, 200, ['#f5f5f5', '#ffffff'], 0.4, 0.6, 1, 1.5);
  });
}
export function dirtLightTex() {
  return mk('dirtLight', 256, (x, s) => {
    x.fillStyle = '#e0d0b0'; x.fillRect(0, 0, s, s);
    dots(x, s, 1900, ['#c0a880', '#b09868', '#d0c098', '#a8885a'], 0.3, 0.6, 1, 3);
    blobs(x, s, 50, 4, 12, 'rgba(90,70,45,0.45)', 'rgba(220,200,160,0.4)');
    dots(x, s, 150, ['#8a7a62', '#9a8a72'], 0.4, 0.6, 1, 2);
    streaks(x, s, 20, true, ['#8a7048'], 0.15, 0.3, 1);
  });
}
export function flowerTex() {
  return mk('flower', 256, (x, s) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, s, s);
    blobs(x, s, 20, 30, 60, 'rgba(200,200,200,0.35)', 'rgba(160,160,160,0.35)');
    // Petal shading: soft radial petals + center dot.
    for (let i = 0; i < 12; i++) {
      const px = 40 + Math.random() * (s - 80), py = 40 + Math.random() * (s - 80);
      const g = x.createRadialGradient(px, py, 0, px, py, 26);
      g.addColorStop(0, 'rgba(220,220,220,0.5)');
      g.addColorStop(1, 'rgba(220,220,220,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(px, py, 26, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(180,180,180,0.6)';
      x.beginPath(); x.arc(px, py, 4, 0, Math.PI * 2); x.fill();
    }
  });
}
