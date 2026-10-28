// Shared catalog, recipes, filters, storage for Somewhere.
export const BAD_WORDS = ['fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'cunt', 'bastard', 'whore', 'slut', 'damn', 'hell'];

export function cleanText(s) {
  // Whole words only — "hello" must not trip the filter for "hell"
  let out = s;
  for (const w of BAD_WORDS) {
    const re = new RegExp(`\\b${w}\\b`, 'gi');
    out = out.replace(re, '#'.repeat(w.length));
  }
  return out;
}
export function hasBadWord(s) {
  const low = s.toLowerCase();
  return BAD_WORDS.some((w) => low.includes(w));
}

export const ITEMS = {
  // chip = the icon tile color in inventory/craft lists (visual only).
  // Duplicates that shared one emoji now read apart by tile color:
  // wooden tools = brown tiles, stone/iron tools = gray tiles.
  wood: { name: 'Wood', chip: '#7a5230' },
  stone: { name: 'Stone', chip: '#7d7f85' },
  iron: { name: 'Iron', chip: '#9aa0a8' },
  leather: { name: 'Leather', chip: '#7a4a22' },
  sandbag: { name: 'Sand bag', chip: '#d8c08a' },
  snowbag: { name: 'Snow bag', chip: '#dfe9f2' },
  dirtbag: { name: 'Dirt bag', chip: '#6b4a2f' },
  glass: { name: 'Glass', chip: '#9fd4ff' },
  ice: { name: 'Ice block', chip: '#bfe8ff' },
  apple: { name: 'Apple', chip: '#e5484d' },
  wheat: { name: 'Wheat', chip: '#e8c95a' },
  carrot: { name: 'Carrot', chip: '#e87a1a' },
  seed_wheat: { name: 'Wheat seeds', chip: '#6fae4e' },
  seed_carrot: { name: 'Carrot seeds', chip: '#5a8a3a' },
  money: { name: 'Coins', chip: '#f5c542' },
  axe_wood: { name: 'Wooden axe', tool: 'axe', power: 1, maxDur: 30, chip: '#8a5a2b' },
  axe_stone: { name: 'Stone axe', tool: 'axe', power: 2, maxDur: 60, chip: '#6e7278' },
  pickaxe_wood: { name: 'Wooden pickaxe', tool: 'pickaxe', power: 1, maxDur: 30, chip: '#8a5a2b' },
  pickaxe: { name: 'Stone pickaxe', tool: 'pickaxe', power: 2, maxDur: 80, chip: '#6e7278' },
  shovel: { name: 'Shovel', tool: 'shovel', power: 1, maxDur: 60, chip: '#7a5a30' },
  hoe: { name: 'Hoe', tool: 'hoe', power: 1, maxDur: 60, chip: '#5a7a3a' },
  // Temp fallback stone: 6 hits at power 0.5 fells a 3-HP tree, and the
  // break rule is per-tree (see chopTree) — it never dies mid-tree.
  ground_stone: { name: 'Stone', tool: 'axe', power: 0.5, maxDur: 6, temp: true, chip: '#55575c' },
  workbench: { name: 'Workbench', placeable: 'workbench', chip: '#8a5a2b' },
  wall_wood: { name: 'Wood wall', placeable: 'wall', mat: 'wood', chip: '#6b4226' },
  wall_brick: { name: 'Brick wall', placeable: 'wall', mat: 'brick', chip: '#9a5a48' },
  wall_steel: { name: 'Steel wall', placeable: 'wall', mat: 'steel', chip: '#c8ccd2' },
  wall_window: { name: 'Window wall', placeable: 'wall', mat: 'window', chip: '#7ab8e8' },
  wall_door: { name: 'Door wall', placeable: 'wall', mat: 'door', chip: '#5a3a1a' },
  wall_ice: { name: 'Ice wall', placeable: 'wall', mat: 'ice', chip: '#bfe8ff' },
  floor: { name: 'Floor', placeable: 'floor', chip: '#8a5a2b' },
  roof: { name: 'Roof', placeable: 'roof', chip: '#a34a3a' },
  chest: { name: 'Storage chest', placeable: 'chest', chip: '#9a6a35' },
  vehicle_machine: { name: 'Vehicle machine', placeable: 'vehicle_machine', chip: '#3a4a63' },
  gas_pump: { name: 'Gas pump', placeable: 'gas_pump', chip: '#e5484d' },
  house_kit: { name: 'House kit', placeable: 'house', chip: '#e8ddc8' },
  backpack: { name: 'Backpack', chip: '#6e56cf' },
  jerrycan: { name: 'Jerrycan', chip: '#c23b3b' },
  car_key: { name: 'Car key', permanent: true, chip: '#f5c542' },
  house_key: { name: 'House key', permanent: true, chip: '#d8b25a' },
};

// Workbench recipes: [itemId, {costs}, label]
export const RECIPES = [
  ['wall_wood', { wood: 2 }, 'Wood wall'],
  ['wall_brick', { stone: 2 }, 'Brick wall'],
  ['wall_steel', { iron: 2 }, 'Steel wall'],
  ['wall_window', { wood: 2, glass: 1 }, 'Window wall'],
  ['wall_door', { wood: 3 }, 'Door wall'],
  ['wall_ice', { ice: 3 }, 'Ice wall'],
  ['floor', { wood: 2 }, 'Floor'],
  ['roof', { wood: 3 }, 'Roof'],
  ['workbench', { wood: 4 }, 'Workbench'],
  ['vehicle_machine', { iron: 4, wood: 2 }, 'Vehicle machine'],
  ['gas_pump', { iron: 2 }, 'Gas pump'],
  ['chest', { wood: 3 }, 'Storage chest'],
  ['house_kit', { wood: 10, stone: 4 }, 'House kit'],
  ['axe_stone', { stone: 2, wood: 1 }, 'Stone axe'],
  ['pickaxe_wood', { wood: 3 }, 'Wooden pickaxe'],
  ['pickaxe', { stone: 3, wood: 2 }, 'Stone pickaxe'],
  ['shovel', { wood: 2, iron: 1 }, 'Shovel'],
  ['hoe', { wood: 2, iron: 1 }, 'Hoe'],
  ['backpack', { leather: 4 }, 'Backpack'],
  ['glass', { sandbag: 1 }, 'Glass'],
  ['ice', { snowbag: 1 }, 'Ice block'],
];
export const QUICK_RECIPES = [
  ['pickaxe_wood', { wood: 3 }, 'Wooden pickaxe (mines stone)'],
  ['jerrycan', { iron: 1 }, 'Jerrycan (max-fills a car)'],
  ['wall_wood', { wood: 2 }, 'Wood wall'],
  ['floor', { wood: 2 }, 'Floor'],
];

export function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
export function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* private mode */ }
}
export function uid() {
  return Math.random().toString(36).slice(2, 10);
}
export function initialAvatar(name) {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const ctx = c.getContext('2d');
  const colors = ['#57b6ff', '#46a758', '#e5484d', '#6e56cf', '#f5c542'];
  ctx.fillStyle = colors[(name || 'G').charCodeAt(0) % colors.length];
  ctx.beginPath(); ctx.arc(48, 48, 48, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 44px system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText((name || 'G').slice(0, 1).toUpperCase(), 48, 50);
  return c.toDataURL();
}
