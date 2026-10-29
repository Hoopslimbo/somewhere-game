// Hand-drawn vector icons for every Somewhere item — no emoji anywhere
// in item UI. One consistent style: bold flat shapes, dark outline,
// viewBox 0 0 48 48, readable at 30-42px. Icons sit directly in their slot
// box with no inner tile behind them; icons themselves carry their own
// recognizable colors so wooden vs stone tools read apart.
const G = (inner) => `<svg class="di" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g fill="none" stroke="#222222" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`;

const axe = (head) => G(`<g transform="rotate(28 24 24)"><rect x="21" y="8" width="6" height="32" rx="2" fill="#8a5a2b"/><path d="M27 10 L40 14 L40 26 L27 24 Z" fill="${head}"/><rect x="21" y="8" width="6" height="32" rx="2"/></g>`);
const pick = (head) => G(`<g transform="rotate(28 24 24)"><rect x="21" y="8" width="6" height="32" rx="2" fill="#8a5a2b"/><path d="M24 8 L10 14 L12 19 L24 14 Z" fill="${head}"/><path d="M24 8 L38 14 L36 19 L24 14 Z" fill="${head}"/></g>`);
const sword = (blade) => G(`<g transform="rotate(28 24 24)"><rect x="21" y="30" width="6" height="12" rx="2" fill="#1a1a24"/><rect x="14" y="28" width="20" height="4" rx="2" fill="#3a3a4a"/><path d="M21 28 L24 6 L27 28 Z" fill="${blade}"/></g>`);
const sack = (body, knot) => G(`<path d="M14 18 Q14 12 24 12 Q34 12 34 18 L36 34 Q36 40 30 40 L18 40 Q12 40 12 34 Z" fill="${body}"/><path d="M20 12 Q24 7 28 12" fill="${knot}"/><line x1="16" y1="26" x2="32" y2="26"/><line x1="17" y1="32" x2="31" y2="32"/>`);
const wallBase = (inner) => G(`<rect x="7" y="8" width="34" height="32" rx="2" fill="#e8ddc8"/>${inner}`);

export const ICONS = {
  wood: G(`<rect x="5" y="17" width="38" height="14" rx="7" fill="#8a5a2b"/><ellipse cx="9" cy="24" rx="3.5" ry="6" fill="#c89a5e"/><line x1="18" y1="19" x2="18" y2="29"/><line x1="26" y1="19" x2="26" y2="29"/><line x1="34" y1="19" x2="34" y2="29"/>`),
  stone: G(`<path d="M10 35 L14 17 L25 10 L38 20 L40 35 Z" fill="#8a8d92"/><path d="M16 35 L20 22 L27 30" stroke="#5c5f64" fill="none"/><path d="M28 35 L30 24" stroke="#5c5f64" fill="none"/>`),
  ground_stone: G(`<path d="M12 34 L16 19 L26 13 L37 21 L38 34 Z" fill="#55575c"/><path d="M20 34 L23 23" stroke="#333" fill="none"/>`),
  iron: G(`<path d="M10 31 L14 18 L34 18 L38 31 Z" fill="#b8bcc2"/><line x1="14" y1="23" x2="34" y2="23" stroke="#7d8288"/><line x1="18" y1="31" x2="20" y2="18" stroke="#dfe3e8"/>`),
  leather: G(`<path d="M10 12 L38 12 L40 30 Q40 38 32 38 L16 38 Q8 38 8 30 Z" fill="#b07a3e"/><path d="M13 17 L35 17 M13 24 L35 24 M13 31 L35 31" stroke="#7a4a22" stroke-dasharray="4 3"/>`),
  sandbag: sack('#d8c08a', '#b89a5e'),
  dirtbag: sack('#8a5a33', '#5a3a1a'),
  snowbag: G(`<path d="M14 18 Q14 12 24 12 Q34 12 34 18 L36 34 Q36 40 30 40 L18 40 Q12 40 12 34 Z" fill="#e8f1f8"/><g stroke="#57b6ff"><line x1="24" y1="20" x2="24" y2="34"/><line x1="18" y1="24" x2="30" y2="30"/><line x1="30" y1="24" x2="18" y2="30"/></g>`),
  glass: G(`<rect x="10" y="10" width="28" height="28" rx="2" fill="#bfe6ff"/><line x1="10" y1="10" x2="38" y2="38" stroke="#ffffff" stroke-width="3"/><line x1="24" y1="10" x2="24" y2="38" stroke="#7ab8e8"/><line x1="10" y1="24" x2="38" y2="24" stroke="#7ab8e8"/>`),
  ice: G(`<rect x="10" y="12" width="28" height="26" rx="2" fill="#bfe8ff"/><path d="M10 12 L20 6 L38 6 L38 12" fill="#e2f5ff"/><path d="M14 20 L22 28 M28 16 L24 26" stroke="#7ab8e8"/>`),
  apple: G(`<circle cx="24" cy="27" r="13" fill="#e5484d"/><path d="M24 14 Q25 9 30 8" stroke="#6b4226"/><ellipse cx="31" cy="12" rx="5" ry="3" fill="#46a758" transform="rotate(-25 31 12)"/>`),
  wheat: G(`<line x1="24" y1="40" x2="24" y2="10"/><ellipse cx="17" cy="16" rx="3.5" ry="6" fill="#e8c95a" transform="rotate(-30 17 16)"/><ellipse cx="31" cy="16" rx="3.5" ry="6" fill="#e8c95a" transform="rotate(30 31 16)"/><ellipse cx="17" cy="26" rx="3.5" ry="6" fill="#e8c95a" transform="rotate(-30 17 26)"/><ellipse cx="31" cy="26" rx="3.5" ry="6" fill="#e8c95a" transform="rotate(30 31 26)"/><ellipse cx="24" cy="11" rx="3" ry="6" fill="#f5d76e"/>`),
  carrot: G(`<path d="M14 16 L34 16 L25 40 Z" fill="#e87a1a"/><g stroke="#46a758" stroke-width="3"><path d="M20 16 Q18 8 14 7"/><path d="M24 16 Q24 8 24 6"/><path d="M28 16 Q30 8 34 7"/></g><line x1="18" y1="24" x2="30" y2="24" stroke="#c25e10"/><line x1="20" y1="31" x2="28" y2="31" stroke="#c25e10"/>`),
  seed_wheat: G(`<rect x="13" y="9" width="22" height="30" rx="3" fill="#6fae4e"/><rect x="13" y="9" width="22" height="8" rx="3" fill="#5a8a3a"/><line x1="24" y1="34" x2="24" y2="22"/><ellipse cx="20" cy="25" rx="2.5" ry="4" fill="#e8c95a" transform="rotate(-25 20 25)"/><ellipse cx="28" cy="25" rx="2.5" ry="4" fill="#e8c95a" transform="rotate(25 28 25)"/>`),
  seed_carrot: G(`<rect x="13" y="9" width="22" height="30" rx="3" fill="#8a5a2b"/><rect x="13" y="9" width="22" height="8" rx="3" fill="#6b4226"/><path d="M19 24 L29 24 L24 34 Z" fill="#e87a1a"/><g stroke="#46a758" stroke-width="2"><path d="M22 24 Q21 20 19 19"/><path d="M26 24 Q27 20 29 19"/></g>`),
  money: G(`<circle cx="24" cy="24" r="14" fill="#f5c542"/><circle cx="24" cy="24" r="8" fill="#e0a91c"/><path d="M24 17 L26.5 22 L32 22.5 L27.5 26 L29 31.5 L24 28.5 L19 31.5 L20.5 26 L16 22.5 L21.5 22 Z" fill="#fff3c4"/>`),
  axe_wood: axe('#c8452f'),
  axe_stone: axe('#9aa0a8'),
  pickaxe_wood: pick('#8a5a2b'),
  pickaxe: pick('#9aa0a8'),
  shovel: G(`<g transform="rotate(24 24 24)"><rect x="21" y="8" width="6" height="26" rx="2" fill="#8a5a2b"/><circle cx="24" cy="9" r="4" fill="none"/><path d="M17 34 L31 34 L29 42 L19 42 Z" fill="#9aa0a8"/></g>`),
  hoe: G(`<g transform="rotate(24 24 24)"><rect x="21" y="8" width="6" height="28" rx="2" fill="#8a5a2b"/><rect x="12" y="34" width="24" height="7" rx="2" fill="#9aa0a8"/><rect x="21" y="30" width="6" height="6" fill="#6e7278"/></g>`),
  workbench: G(`<rect x="7" y="14" width="34" height="7" rx="2" fill="#8a5a2b"/><rect x="11" y="21" width="4" height="17" fill="#6b4226"/><rect x="33" y="21" width="4" height="17" fill="#6b4226"/><rect x="11" y="30" width="26" height="4" fill="#6b4226"/><rect x="27" y="8" width="8" height="5" rx="1" fill="#9aa0a8"/>`),
  wall_wood: wallBase(`<line x1="15" y1="8" x2="15" y2="40" stroke="#6b4226"/><line x1="24" y1="8" x2="24" y2="40" stroke="#6b4226"/><line x1="33" y1="8" x2="33" y2="40" stroke="#6b4226"/><rect x="7" y="8" width="34" height="32" rx="2" fill="none"/>`),
  wall_brick: wallBase(`<rect x="7" y="8" width="34" height="32" fill="#9a5a48"/><g stroke="#7a4034"><line x1="7" y1="18" x2="41" y2="18"/><line x1="7" y1="28" x2="41" y2="28"/><line x1="18" y1="8" x2="18" y2="18"/><line x1="30" y1="8" x2="30" y2="18"/><line x1="12" y1="18" x2="12" y2="28"/><line x1="24" y1="18" x2="24" y2="28"/><line x1="36" y1="18" x2="36" y2="28"/><line x1="18" y1="28" x2="18" y2="40"/><line x1="30" y1="28" x2="30" y2="40"/></g>`),
  wall_steel: wallBase(`<rect x="7" y="8" width="34" height="32" fill="#c8ccd2"/><line x1="18" y1="8" x2="18" y2="40" stroke="#9aa0a8"/><line x1="29" y1="8" x2="29" y2="40" stroke="#9aa0a8"/><circle cx="12" cy="13" r="1.6" fill="#7d8288"/><circle cx="12" cy="35" r="1.6" fill="#7d8288"/><circle cx="36" cy="13" r="1.6" fill="#7d8288"/><circle cx="36" cy="35" r="1.6" fill="#7d8288"/>`),
  wall_window: wallBase(`<rect x="13" y="13" width="22" height="22" fill="#bfe6ff"/><line x1="24" y1="13" x2="24" y2="35" stroke="#5a7a9a"/><line x1="13" y1="24" x2="35" y2="24" stroke="#5a7a9a"/>`),
  wall_door: wallBase(`<rect x="15" y="11" width="18" height="29" fill="#6b4226"/><circle cx="30" cy="26" r="2" fill="#f5c542"/>`),
  wall_ice: wallBase(`<rect x="7" y="8" width="34" height="32" fill="#bfe8ff"/><path d="M12 12 L20 24 L14 36 M30 10 L26 22 L34 32" stroke="#7ab8e8"/>`),
  floor: G(`<rect x="7" y="10" width="34" height="28" rx="2" fill="#8a5a2b"/><line x1="7" y1="19" x2="41" y2="19" stroke="#6b4226"/><line x1="7" y1="28" x2="41" y2="28" stroke="#6b4226"/><line x1="20" y1="10" x2="20" y2="19" stroke="#6b4226"/><line x1="30" y1="19" x2="30" y2="28" stroke="#6b4226"/><line x1="16" y1="28" x2="16" y2="38" stroke="#6b4226"/>`),
  roof: G(`<path d="M8 34 L24 10 L40 34 Z" fill="#a34a3a"/><path d="M8 34 L24 10 L40 34" fill="none"/><line x1="14" y1="26" x2="34" y2="26" stroke="#7a3226"/><line x1="18" y1="20" x2="30" y2="20" stroke="#7a3226"/>`),
  chest: G(`<rect x="8" y="20" width="32" height="18" rx="2" fill="#7a4d22"/><path d="M8 22 Q8 10 24 10 Q40 10 40 22 Z" fill="#9a6a35"/><rect x="8" y="20" width="32" height="3" fill="#4a3220"/><line x1="16" y1="22" x2="16" y2="38" stroke="#4a3220" stroke-width="1.6"/><line x1="32" y1="22" x2="32" y2="38" stroke="#4a3220" stroke-width="1.6"/><line x1="14" y1="20" x2="14" y2="38" stroke="#2a2d33" stroke-width="2.6"/><line x1="34" y1="20" x2="34" y2="38" stroke="#2a2d33" stroke-width="2.6"/><rect x="21" y="20" width="6" height="8" rx="1" fill="#d8a437"/><rect x="23" y="22" width="2" height="3" fill="#4a3220"/>`),
  vehicle_machine: G(`<rect x="9" y="12" width="30" height="26" rx="3" fill="#3a4a63"/><rect x="15" y="18" width="18" height="10" rx="2" fill="#57b6ff"/><circle cx="36" cy="34" r="1.8" fill="#f5c542"/><circle cx="13" cy="34" r="1.8" fill="#f5c542"/><line x1="9" y1="12" x2="39" y2="12" stroke="#f5c542" stroke-dasharray="4 3"/>`),
  gas_pump: G(`<rect x="14" y="8" width="20" height="32" rx="3" fill="#c23b3b"/><rect x="18" y="13" width="12" height="9" rx="1" fill="#e8e8e8"/><path d="M34 18 Q40 18 40 26 L40 32" stroke="#222" fill="none"/><rect x="38" y="30" width="5" height="8" rx="1" fill="#222"/>`),
  house_kit: G(`<path d="M10 24 L24 10 L38 24 Z" fill="#a34a3a"/><rect x="13" y="24" width="22" height="16" fill="#e8ddc8"/><rect x="21" y="29" width="6" height="11" fill="#6b4226"/><rect x="16" y="27" width="5" height="5" fill="#7ab8e8"/>`),
  backpack: G(`<rect x="12" y="10" width="24" height="28" rx="8" fill="#6e56cf"/><rect x="18" y="22" width="12" height="10" rx="3" fill="#5844a8"/><path d="M16 12 Q16 6 24 6 Q32 6 32 12" stroke="#5844a8" fill="none"/><line x1="12" y1="18" x2="12" y2="32" stroke="#5844a8"/><line x1="36" y1="18" x2="36" y2="32" stroke="#5844a8"/>`),
  jerrycan: G(`<rect x="11" y="12" width="26" height="28" rx="3" fill="#c23b3b"/><path d="M18 12 Q18 7 24 7 Q30 7 30 12" fill="none"/><path d="M17 18 L31 34 M31 18 L17 34" stroke="#8e2a2a"/><rect x="35" y="14" width="5" height="8" rx="1" fill="#8e2a2a"/>`),
  car_key: G(`<circle cx="17" cy="17" r="8" fill="#f5c542"/><circle cx="17" cy="17" r="3.5" fill="#e8ddc8"/><line x1="23" y1="23" x2="40" y2="40"/><line x1="34" y1="34" x2="34" y2="40"/><line x1="39" y1="39" x2="39" y2="43" transform="translate(0 -2)"/>`),
  house_key: G(`<circle cx="16" cy="16" r="9" fill="#d8b25a"/><circle cx="16" cy="16" r="4" fill="#e8ddc8"/><line x1="22" y1="22" x2="40" y2="40"/><path d="M32 32 L32 38 M38 38 L38 42" stroke="#a8823a"/>`),
  phone: G(`<rect x="15" y="7" width="18" height="34" rx="4" fill="#1a1a24"/><rect x="18" y="11" width="12" height="20" rx="1" fill="#2a2a3a"/><circle cx="24" cy="35" r="2.5" fill="#7a5cff"/>`),
  shadow_sword: G(`<g transform="rotate(28 24 24)"><rect x="21" y="30" width="6" height="12" rx="2" fill="#1a1a24"/><rect x="14" y="28" width="20" height="4" rx="2" fill="#3a3a4a"/><path d="M21 28 L24 6 L27 28 Z" fill="#232338"/><circle cx="24" cy="28" r="3" fill="#b07aff"/></g>`),
  sword_wood: sword('#8a5a2b'),
  sword_stone: sword('#9aa0a8'),
  sword_iron: sword('#c8ccd2'),
  portal_command: G(`<rect x="9" y="12" width="30" height="26" rx="3" fill="#3a3a4a"/><rect x="15" y="18" width="10" height="10" rx="2" fill="#7a5cff"/><g fill="#b07aff"><circle cx="30" cy="20" r="1.6"/><circle cx="34" cy="20" r="1.6"/><circle cx="30" cy="24" r="1.6"/><circle cx="34" cy="24" r="1.6"/></g><circle cx="36" cy="34" r="1.8" fill="#b07aff"/>`),
};

// Small UI pictograms (not items): world/server cards in the lobby.
const UI = {
  globe: G(`<circle cx="24" cy="24" r="15" fill="#7ab8e8"/><ellipse cx="24" cy="24" rx="7" ry="15" fill="none"/><line x1="9" y1="24" x2="39" y2="24"/><path d="M12 14 Q24 20 36 14 M12 34 Q24 28 36 34" fill="none"/>`),
  server: G(`<rect x="10" y="8" width="28" height="10" rx="2" fill="#3a4a63"/><rect x="10" y="20" width="28" height="10" rx="2" fill="#3a4a63"/><rect x="10" y="32" width="28" height="10" rx="2" fill="#3a4a63"/><circle cx="16" cy="13" r="1.8" fill="#57b6ff"/><circle cx="16" cy="25" r="1.8" fill="#57b6ff"/><circle cx="16" cy="37" r="1.8" fill="#57b6ff"/>`),
};

export function itemIcon(id) { return ICONS[id] || ICONS.stone; }
export function uiIcon(kind) { return UI[kind] || UI.globe; }
