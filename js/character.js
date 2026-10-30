import * as THREE from 'three';

export const SKIN_TONES = ['#ffe0bd', '#f5cfa0', '#e8b07d', '#c68850', '#8d5524', '#5e3a1e', '#f2c9c4', '#d99a86'];
export const HAIR_COLORS = ['#1d1a16', '#3b2a1a', '#6b4226', '#a0522d', '#c98a2b', '#e8c547', '#b5522a', '#7a7a7a', '#e8e8e8', '#2a4d8f', '#c23b6e', '#3fae6a'];
export const SHIRT_COLORS = ['#e5484d', '#f76b15', '#f5c542', '#46a758', '#30a46c', '#57b6ff', '#0091ff', '#6e56cf', '#d6409f', '#e8e8e8', '#1d1a16', '#8a5a2b'];
export const PANTS_COLORS = ['#2b4a6f', '#1d1a16', '#5a5a5a', '#8a5a2b', '#6e56cf', '#46a758', '#e8e8e8', '#c23b6e', '#3b2a1a'];
export const SHOE_COLORS = ['#1d1a16', '#e8e8e8', '#e5484d', '#0091ff', '#f5c542', '#46a758', '#6e56cf', '#8a5a2b'];
export const HAIR_STYLES = ['short', 'spiky', 'curly', 'long', 'ponytail', 'bun', 'buzz', 'afro'];

export const DEFAULT_CHAR = {
  skin: '#f5cfa0', hair: 'short', hairColor: '#3b2a1a',
  sleeve: 'normal', shirt: '#57b6ff',
  pants: 'sweatpants', pantsColor: '#2b4a6f', shoes: '#1d1a16',
  hat: 'none', // redo slice 10: 'none' | 'cap' | 'beanie' | 'headphones'
};

// Polished BLOCKY character (~2.07 units tall). Clean boxy silhouette with
// good proportions (slimmer than a cube, longer legs, smaller head than a
// straight voxel clone), detailed boxy face, and shaped blocky hair and
// clothing — distinct from a plain Minecraft copy through proportion, color
// and detail. Front face is +Z. cfg: { skin, hair, hairColor, sleeve, shirt,
// pants, pantsColor, shoes, hat }

function mat(color, rough = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
}
// Darken a hex color by a factor, for detail pieces that must read as
// separate from the base piece instead of a same-color bump.
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}
function box(w, h, d, material, x, y, z, parent, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function buildCharacter(cfg = {}) {
  const c = { ...DEFAULT_CHAR, ...cfg };
  const g = new THREE.Group();
  const skin = mat(c.skin, 0.6), shirtM = mat(c.shirt, 0.9), pantsM = mat(c.pantsColor, 0.92),
        shoeM = mat(c.shoes, 0.5), hairM = mat(c.hairColor, 0.95),
        dark = mat('#1d1a16', 0.6), soleM = mat('#20242a', 0.9),
        mouthM = mat('#8a4a3a', 0.7), beltM = mat('#3a2a1a', 0.8);

  const shorts = c.pants === 'shorts';

  // ---- Legs + shoes (redo slice 5): each leg is a group pivoting at
  // the hip so walk animation can swing it; shoes ride with the leg,
  // plus a darker toe cap for detail. Static pose is unchanged —
  // every box sits exactly where it did before.
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.14, 0.88, 0);
    g.add(leg);
    legs.push(leg);
    box(0.22, 0.06, 0.34, soleM, 0, -0.85, 0.03, leg);
    box(0.20, 0.12, 0.30, shoeM, 0, -0.76, 0.03, leg);
    box(0.20, 0.07, 0.03, mat(shade(c.shoes, 0.75), 0.5), 0, -0.76, 0.19, leg); // toe cap
    if (shorts) {
      box(0.20, 0.26, 0.22, pantsM, 0, -0.13, 0, leg); // shorts leg
      box(0.17, 0.46, 0.19, skin, 0, -0.49, 0, leg);   // bare lower leg
    } else {
      box(0.20, 0.72, 0.22, pantsM, 0, -0.36, 0, leg); // full sweatpants leg
      box(0.21, 0.09, 0.23, pantsM, 0, -0.68, 0, leg); // ankle cuff
    }
  }
  // ---- Hips + belt ----
  box(0.48, 0.12, 0.26, pantsM, 0, 0.93, 0, g);
  // Belt is 0.02 proud of the torso on all sides: its faces must NOT sit
  // exactly coplanar with the torso faces (that z-fights and flickers).
  box(0.50, 0.06, 0.32, beltM, 0, 1.01, 0, g);
  // ---- Torso: slim boxy shirt, collar, chest pocket ----
  box(0.52, 0.58, 0.28, shirtM, 0, 1.28, 0, g);
  // Collar stands 0.03 proud of the torso (was 0.01 — a hairline lip that
  // aliased and shimmered as the preview swayed).
  box(0.30, 0.07, 0.34, shirtM, 0, 1.59, 0, g); // collar
  // Pocket in a darker shade of the shirt so it reads as a pocket instead
  // of a same-color bump on the shirt front.
  box(0.14, 0.12, 0.02, mat(shade(c.shirt, 0.82), 0.9), -0.14, 1.38, 0.15, g); // chest pocket
  // ---- Arms: hang straight, slightly out from the body ----
  const longSleeve = c.sleeve === 'long';
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    // Arms overlap the torso by a solid 0.015 (was a 0.005 hairline touch
    // that shimmered along the shoulder seam as the preview swayed).
    arm.position.set(side * 0.325, 1.52, 0);
    arm.rotation.z = side * -0.05;
    g.add(arm);
    arms.push(arm);
    if (longSleeve) {
      box(0.16, 0.40, 0.18, shirtM, 0, -0.20, 0, arm);
      box(0.17, 0.08, 0.19, shirtM, 0, -0.43, 0, arm); // cuff
      box(0.15, 0.16, 0.17, skin, 0, -0.55, 0, arm);   // hand
    } else {
      box(0.16, 0.20, 0.18, shirtM, 0, -0.10, 0, arm);
      box(0.15, 0.34, 0.16, skin, 0, -0.36, 0, arm);
      box(0.15, 0.16, 0.17, skin, 0, -0.58, 0, arm);
    }
  }
  // ---- Neck + head ----
  box(0.14, 0.08, 0.14, skin, 0, 1.61, 0, g);
  box(0.44, 0.42, 0.42, skin, 0, 1.86, 0, g);
  // Ears
  box(0.05, 0.10, 0.08, skin, -0.245, 1.86, 0, g);
  box(0.05, 0.10, 0.08, skin, 0.245, 1.86, 0, g);
  // Face: eyes, brows, nose, mouth (front face is +Z, face plane z = 0.21)
  box(0.06, 0.08, 0.02, dark, -0.10, 1.90, 0.215, g);
  box(0.06, 0.08, 0.02, dark, 0.10, 1.90, 0.215, g);
  box(0.10, 0.03, 0.02, hairM, -0.10, 2.00, 0.215, g);
  box(0.10, 0.03, 0.02, hairM, 0.10, 2.00, 0.215, g);
  box(0.07, 0.09, 0.05, skin, 0, 1.83, 0.225, g); // nose
  box(0.12, 0.03, 0.02, mouthM, 0, 1.73, 0.215, g);

  // ---- Hair: reworked for clean silhouettes on the blocky head ----
  // Rules every style follows: the cap hugs the head (top slab flush
  // on the crown, side/back slabs overlapping the head faces by a
  // visible margin, never a hairline touch), every added piece overlaps
  // the piece below it (no floating bits, no gaps), and proportions
  // stay close to the head instead of ballooning outward. Head top is
  // 2.07, head faces at x ±0.22, z ±0.21.
  const hy = 2.07; // top of head
  // Full cap: crown slab + forehead fringe + sideburn slabs + back
  // slab, all overlapping the head and each other.
  function cap(fringe = true) {
    box(0.46, 0.09, 0.44, hairM, 0, hy + 0.045, 0, g); // crown, flush on top
    if (fringe) box(0.44, 0.07, 0.05, hairM, 0, 2.03, 0.205, g); // forehead fringe
    box(0.05, 0.16, 0.34, hairM, -0.225, 1.99, 0, g); // left side
    box(0.05, 0.16, 0.34, hairM, 0.225, 1.99, 0, g); // right side
    box(0.44, 0.16, 0.05, hairM, 0, 1.99, -0.205, g); // back
  }
  if (c.hair === 'short') {
    cap();
    // Neat side part: a slightly raised sweep across the crown front.
    box(0.30, 0.04, 0.30, hairM, -0.03, hy + 0.10, 0.03, g);
  } else if (c.hair === 'buzz') {
    // Close crop: a thin shell hugging the whole top of the head.
    box(0.45, 0.035, 0.43, hairM, 0, hy + 0.018, 0, g);
    box(0.03, 0.08, 0.32, hairM, -0.225, 2.02, 0, g);
    box(0.03, 0.08, 0.32, hairM, 0.225, 2.02, 0, g);
    box(0.43, 0.08, 0.03, hairM, 0, 2.02, -0.205, g);
  } else if (c.hair === 'spiky') {
    cap(false);
    // Spikes rooted IN the cap: each base sits below the cap's top
    // surface, so no spike floats. A swept row plus two front spikes.
    box(0.44, 0.07, 0.05, hairM, 0, 2.04, 0.205, g); // short fringe base
    for (let i = -2; i <= 2; i++) {
      box(0.075, 0.16, 0.075, hairM, i * 0.09, 2.18, -0.02, g, 0, 0, -i * 0.18);
    }
    box(0.07, 0.15, 0.07, hairM, -0.14, 2.16, 0.14, g, 0.35, 0, -0.15);
    box(0.07, 0.15, 0.07, hairM, 0.14, 2.16, 0.14, g, 0.35, 0, 0.15);
  } else if (c.hair === 'curly') {
    cap(false);
    // A tight dome of overlapping curls: rows step inward as they
    // rise, every cube overlapping its neighbors — no scattered cubes.
    const curls = [
      [-0.16, 2.12, 0.10, 0.15], [0, 2.12, 0.12, 0.16], [0.16, 2.12, 0.10, 0.15],
      [-0.16, 2.12, -0.10, 0.15], [0, 2.12, -0.10, 0.16], [0.16, 2.12, -0.10, 0.15],
      [-0.11, 2.24, 0.02, 0.15], [0.11, 2.24, 0.02, 0.15], [0, 2.24, -0.08, 0.15],
      [0, 2.33, 0.02, 0.14],
      [-0.21, 2.02, 0.08, 0.12], [0.21, 2.02, 0.08, 0.12],
    ];
    for (const [x, y, z, s] of curls) box(s, s, s, hairM, x, y, z, g);
    box(0.44, 0.06, 0.05, hairM, 0, 2.03, 0.205, g); // fringe line
  } else if (c.hair === 'long') {
    cap();
    // Back fall: one wide slab from crown to mid-back, overlapping the
    // head's back face, plus face-framing strands that touch the cheeks.
    box(0.42, 0.62, 0.07, hairM, 0, 1.76, -0.235, g);
    box(0.07, 0.50, 0.07, hairM, -0.20, 1.86, 0.14, g); // left face strand
    box(0.07, 0.50, 0.07, hairM, 0.20, 1.86, 0.14, g); // right face strand
    box(0.44, 0.06, 0.44, hairM, 0, hy + 0.10, 0, g); // crown volume
  } else if (c.hair === 'ponytail') {
    cap();
    // Gathered tail: five overlapping segments stepping down and back
    // from the crown to mid-back, so the tail reads as its own shape
    // from the side instead of ending inside the head silhouette.
    box(0.16, 0.05, 0.16, dark, 0, 2.13, -0.14, g); // tie band
    box(0.15, 0.24, 0.14, hairM, 0, 2.05, -0.26, g, 0.25, 0, 0);
    box(0.14, 0.24, 0.13, hairM, 0, 1.88, -0.31, g, 0.25, 0, 0);
    box(0.13, 0.24, 0.12, hairM, 0, 1.71, -0.36, g, 0.25, 0, 0);
    box(0.12, 0.22, 0.11, hairM, 0, 1.55, -0.40, g, 0.25, 0, 0);
    box(0.10, 0.18, 0.10, hairM, 0, 1.42, -0.43, g, 0.25, 0, 0);
  } else if (c.hair === 'bun') {
    cap();
    // Bun seated on the crown-back, overlapping the cap — a rounded
    // block with a slightly smaller top block for a tied look.
    box(0.24, 0.18, 0.22, hairM, 0, 2.19, -0.08, g);
    box(0.18, 0.10, 0.17, hairM, 0, 2.31, -0.08, g);
  } else if (c.hair === 'afro') {
    // Stepped dome: three layers narrowing as they rise, each layer
    // overlapping the one below, plus side puffs touching the head.
    box(0.58, 0.12, 0.56, hairM, 0, 2.10, 0, g);
    box(0.52, 0.12, 0.50, hairM, 0, 2.20, 0, g);
    box(0.40, 0.11, 0.38, hairM, 0, 2.30, 0, g);
    box(0.26, 0.09, 0.24, hairM, 0, 2.38, 0, g);
    box(0.12, 0.14, 0.30, hairM, -0.27, 2.00, 0, g);
    box(0.12, 0.14, 0.30, hairM, 0.27, 2.00, 0, g);
  }
  g.userData.arms = arms;
  g.userData.legs = legs;
  g.userData.height = 2.07;
  // ---- Hats (redo slice 10): exactly three blocky accessories, fixed
  // colors, rendered after hair so they sit on top of it. Every piece
  // overlaps the piece below it — no floating bits. Head top is 2.07,
  // faces x ±0.22, ears at x ±0.245 (outer ±0.27). No new faces.
  if (c.hat === 'cap') {
    const capM = mat('#c23b2e', 0.8), brimM = mat(shade('#c23b2e', 0.75), 0.8);
    box(0.48, 0.14, 0.46, capM, 0, 2.12, 0, g); // dome, overlaps crown
    box(0.46, 0.05, 0.18, brimM, 0, 2.06, 0.30, g); // brim, front
    box(0.10, 0.05, 0.05, capM, 0, 2.20, 0, g); // button
  } else if (c.hat === 'beanie') {
    const beaM = mat('#37414f', 0.95);
    box(0.48, 0.14, 0.46, beaM, 0, 2.12, 0, g); // dome
    box(0.50, 0.08, 0.48, mat(shade('#37414f', 0.8), 0.95), 0, 2.05, 0, g); // folded cuff
    box(0.16, 0.08, 0.16, beaM, 0, 2.22, 0, g); // pom
  } else if (c.hat === 'headphones') {
    const hpM = mat('#1c1e24', 0.6), padM = mat('#3a3f4a', 0.8);
    box(0.56, 0.05, 0.10, hpM, 0, 2.18, 0, g); // band over the crown
    box(0.05, 0.30, 0.10, hpM, -0.27, 2.03, 0, g); // left connector
    box(0.05, 0.30, 0.10, hpM, 0.27, 2.03, 0, g); // right connector
    box(0.06, 0.20, 0.14, padM, -0.27, 1.88, 0, g); // left cup over the ear
    box(0.06, 0.20, 0.14, padM, 0.27, 1.88, 0, g); // right cup
  }
  return g;
}

// Procedural animation (redo slice 5): arm/leg swing from the joints
// buildCharacter exposes, plus a subtle breathing scale pulse. walk:
// 0 = idle (breathing only), 1 = full walk swing. Only rotation.x is
// touched, so the arms' resting outward lean (rotation.z) survives.
export function animateCharacter(g, t, walk) {
  const u = g.userData;
  if (!u.arms || !u.legs) return;
  if (u.baseScale === undefined) u.baseScale = g.scale.x;
  const s = Math.sin(t * 8) * walk;
  u.arms[0].rotation.x = s * 0.7;
  u.arms[1].rotation.x = -s * 0.7;
  u.legs[0].rotation.x = -s * 0.7;
  u.legs[1].rotation.x = s * 0.7;
  g.scale.setScalar(u.baseScale * (1 + Math.sin(t * 1.8) * 0.008));
}

// Worn-armor overlay (redo slice 5): blocky plates over the character —
// helmet, chestplate, shoulder pads, leg plates. Colors match the armor
// icons (stone gray, iron silver). Every plate sits proud of the body
// so nothing z-fights. Lobby/customize only — first person never sees
// the body, and Darkened never wear it.
export function buildArmorOverlay(armorId) {
  const plate = armorId === 'armor_iron' ? 0xc8ccd2 : 0x8a8d92;
  const line = armorId === 'armor_iron' ? 0x7d8288 : 0x5c5f64;
  const g = new THREE.Group();
  const pm = mat(plate, 0.5), lm = mat(line, 0.6);
  // Helmet: crown + sides + back, sized to cover most hair; the face
  // stays open so the character keeps its identity.
  box(0.50, 0.14, 0.48, pm, 0, 2.17, 0, g);
  box(0.05, 0.34, 0.46, pm, -0.245, 2.06, 0, g);
  box(0.05, 0.34, 0.46, pm, 0.245, 2.06, 0, g);
  box(0.48, 0.34, 0.05, pm, 0, 2.06, -0.225, g);
  // Chestplate: 0.02 proud of the torso on all sides, trim at the waist.
  box(0.56, 0.60, 0.32, pm, 0, 1.28, 0, g);
  box(0.56, 0.08, 0.34, lm, 0, 1.02, 0, g);
  // Shoulder pads: static caps over the arm pivots (arms swing beneath).
  box(0.20, 0.10, 0.22, pm, -0.325, 1.57, 0, g);
  box(0.20, 0.10, 0.22, pm, 0.325, 1.57, 0, g);
  // Leg plates over the upper legs.
  box(0.22, 0.40, 0.24, pm, -0.14, 0.55, 0, g);
  box(0.22, 0.40, 0.24, pm, 0.14, 0.55, 0, g);
  return g;
}
