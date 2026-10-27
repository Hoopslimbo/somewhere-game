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
};

// Polished BLOCKY character (~2.07 units tall). Clean boxy silhouette with
// good proportions (slimmer than a cube, longer legs, smaller head than a
// straight voxel clone), detailed boxy face, and shaped blocky hair and
// clothing — distinct from a plain Minecraft copy through proportion, color
// and detail. Front face is +Z. cfg: { skin, hair, hairColor, sleeve, shirt,
// pants, pantsColor, shoes }

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

  // ---- Shoes: dark sole + boxy upper ----
  for (const side of [-1, 1]) {
    const x = side * 0.14;
    box(0.22, 0.06, 0.34, soleM, x, 0.03, 0.03, g);
    box(0.20, 0.12, 0.30, shoeM, x, 0.12, 0.03, g);
  }
  // ---- Legs ----
  for (const side of [-1, 1]) {
    const x = side * 0.14;
    if (shorts) {
      box(0.20, 0.26, 0.22, pantsM, x, 0.75, 0, g); // shorts leg
      box(0.17, 0.46, 0.19, skin, x, 0.39, 0, g);   // bare lower leg
    } else {
      box(0.20, 0.72, 0.22, pantsM, x, 0.52, 0, g); // full sweatpants leg
      box(0.21, 0.09, 0.23, pantsM, x, 0.20, 0, g); // ankle cuff
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
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    // Arms overlap the torso by a solid 0.015 (was a 0.005 hairline touch
    // that shimmered along the shoulder seam as the preview swayed).
    arm.position.set(side * 0.325, 1.52, 0);
    arm.rotation.z = side * -0.05;
    g.add(arm);
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

  // ---- Hair (all boxy shapes) ----
  const hy = 2.07; // top of head
  function topBox(h, yOff = 0) {
    return box(0.46, h, 0.44, hairM, 0, hy + h / 2 + yOff, 0, g);
  }
  if (c.hair === 'short') {
    topBox(0.10);
    box(0.44, 0.08, 0.06, hairM, 0, 2.02, 0.20, g); // fringe
    box(0.06, 0.14, 0.30, hairM, -0.23, 1.98, -0.02, g);
    box(0.06, 0.14, 0.30, hairM, 0.23, 1.98, -0.02, g);
  } else if (c.hair === 'buzz') {
    topBox(0.04);
  } else if (c.hair === 'spiky') {
    topBox(0.06);
    for (let i = -2; i <= 2; i++) {
      box(0.07, 0.17, 0.07, hairM, i * 0.09, 2.20, 0, g, 0, 0, -i * 0.22);
    }
    box(0.07, 0.14, 0.07, hairM, 0, 2.12, 0.20, g, 0.5, 0, 0);
  } else if (c.hair === 'curly') {
    topBox(0.08);
    const spots = [[-0.15, 0.12, 0.05], [0.15, 0.12, 0.05], [0, 0.16, -0.10], [-0.10, 0.13, 0.15], [0.10, 0.13, 0.15], [-0.20, 0.04, -0.02], [0.20, 0.04, -0.02], [0, 0.10, 0]];
    for (const [x, y, z] of spots) box(0.15, 0.15, 0.15, hairM, x, hy + y, z, g);
  } else if (c.hair === 'long') {
    topBox(0.10);
    box(0.40, 0.52, 0.08, hairM, 0, 1.72, -0.24, g); // back panel
    box(0.07, 0.42, 0.10, hairM, -0.23, 1.75, -0.05, g);
    box(0.07, 0.42, 0.10, hairM, 0.23, 1.75, -0.05, g);
  } else if (c.hair === 'ponytail') {
    topBox(0.10);
    box(0.12, 0.46, 0.10, hairM, 0, 1.86, -0.30, g, 0.35, 0, 0);
    box(0.14, 0.06, 0.12, hairM, 0, 2.08, -0.22, g); // tie
  } else if (c.hair === 'bun') {
    topBox(0.10);
    box(0.22, 0.22, 0.22, hairM, 0, 2.20, -0.10, g);
  } else if (c.hair === 'afro') {
    box(0.60, 0.32, 0.58, hairM, 0, 2.20, 0, g);
    for (const [x, z] of [[-0.24, 0.20], [0.24, 0.20], [-0.24, -0.20], [0.24, -0.20]]) {
      box(0.16, 0.16, 0.16, hairM, x, 2.10, z, g);
    }
  }
  g.userData.height = 2.07;
  return g;
}
