# Somewhere — v1 playable build (NOT deployed)

A static, no-backend browser game. Open `index.html` (serve it over http, or open the
file directly) and play. Nothing here has been deployed anywhere — no .pages.dev site,
no repo push — pending Liam's approval and his pick of a site name.

## What works in v1 (run and seen in screenshots)
- Auth: email + password sign-up / sign-in (localStorage), username rules (unique,
  bad-word filter, max 15), pfp upload with preview, guest mode (solo, saves locally).
- Lobby: Fortnite-style menu over a slowly rotating 3D island panorama (a fixed seed,
  the same world for everyone). Character + nameplate (username, pfp on the right)
  in the middle, friends list on the right, worlds list below with + New world
  (name, keep-inventory OFF, friendly-fire ON, owner can change later, 30-world cap)
  and shared servers (+ New server with pre-invites, no cap). Invites tab
  (accept/decline). Settings: brightness, audio, voice mode, customizable keybinds,
  changeable username/pfp.
- Character customization (extra work went here): skin color, 8 hair styles, hair
  color, long/normal sleeves, shirt color, shorts/sweatpants, pants color, shoe
  color — live 3D preview in the lobby and the Customization tab.
- Island: procedural terrain with desert, snowy mountains, tall forest, plains and
  caved mountains; shoreline + sea (visual only — water mechanics are v2).
  Day/night: 30-minute days, night is just darker.
- Survival: health + hunger bars, health regens only at full hunger, no healing
  items, fall damage scales with height, death drops your stuff (10-minute despawn)
  and respawns you at the gold bench (unless keep-inventory is on).
- Gathering: wooden axe starter, chop trees for wood (apples drop by chance),
  ground-stone fallback (slower, breaks after one tree), pickaxe mining
  (stone / iron ore in caves), shovel sand bags (desert) and snow bags (snowy tops),
  loot chests (leather, seeds, iron, coins).
- Inventory: 10 normal slots + 7 hotbar slots (keys 1–7, mouse wheel), leather
  backpack raises normal slots to 40, buildable storage chests (fixed 40, lootable).
  Permanent slots next to the hotbar (keys 8, 9, 0, scroll past 7): not movable,
  contents can't change — car key appears here after your first car, house key
  after buying land.
- Building: workbench recipes (same at every bench) + the gold infinite bench near
  spawn (unbreakable, unmovable). LEGO Fortnite-style pieces — wood/brick/steel/
  window/door/ice walls, floors, roofs — placed with a green/red outline preview,
  paintable colors, ground-supported. Smashing returns a few materials, never more
  than the piece was made of.
- Vehicles: place a vehicle machine, build a car (6 iron, 4 wood) — car key lands in
  permanent slot 8, lock/unlock with the key (green unlocked / red locked window
  icon). Driving, fuel, gas pumps (unlimited), jerrycan quick craft, crash damage,
  car shop repair/trade-in, broken cars turning into parts.
- Farming: hoe tills a 3×3 grid, plant wheat/carrot seeds (shops, chests, harvest
  gives seeds back), ready after ~7 in-game days.
- Shops: NPC shop near spawn (buy seeds, sell wood/stone), land office (buy land
  for 100 coins → house key + red-line plot, House Kit places a house).
- Chat: Minecraft-style (T opens, history + senders, type; closed it still shows
  sender + message), whole-word cuss filter.

## Controls
WASD move · Mouse look · Space jump · E interact · Click chop/mine/place ·
1–7 hotbar · 8, 9, 0 permanent slots · Scroll switch slot · I backpack ·
B build mode · Q quick craft · T chat · F eat selected food · H help · Shift run/boost

## Known gaps vs the full design (not yet in v1)
- Real multiplayer: friends/parties/servers are lobby UI with placeholder data;
  actual play is solo. No real voice chat (setting only).
- Driving, mining, farming, land/house purchase, car shop, storage, backpack,
  tool breaking, death/respawn and fall damage are implemented in code but were
  NOT all visually verified headlessly — only chopping, building, car crafting,
  car key, crafting UI, inventory, pickup, chat and day/night were seen working.
- Walking/running via keys was not screenshot-verified (camera-follow was, via
  teleports). Cut trees and opened chests don't persist across reloads yet
  (inventory, placed pieces and crops do). No stove/cooking piece yet.
  No trucks, plane, boats, or water vehicles yet (car only).
- Test-only URL params remain in the code and are harmless: `?autoguest=1`,
  `?demo=1`, `?time=day|night`, `?shot=inventory|build`, `?screen=customize`.

## Polish pass (2026-10-27, Liam's orders — NOT deployed)
- Characters rebuilt smooth: capsules/spheres/tapered cylinders, no boxes on the
  body — rounded limbs, tapered torso, neck, nose/mouth/ears, soles on shoes,
  sleeve cuffs, flowing hair shapes. All 8 hairstyles + all color/style options
  still work; proportions slimmed after screenshot review.
- Realism: ACES tone mapping, 2048 soft shadows with bias tuning, gradient sky
  dome (with dusk-orange horizons and a sea-colored below-horizon blend),
  day/night sun color + hemisphere intensity shifts, terrain canvas speckle
  texture + per-vertex color variation (dirt/dry-grass patches, slope rock
  exposure, broken snowline), distinct wood/stone/metal roughness.
- Variety: 5 tree forms (pine, oak, palm, birch, dead snag) with randomized
  height, trunk thickness, canopy, lean, and tints; groves + clearings;
  slope-aware placement; craggy jittered rocks clustered on ridges/heights;
  instanced bushes, grass tufts, and flowers; chests vary in size/lid tint and
  sometimes get a crate; shop/kiosks/bench got crates, barrels, and lanterns.
- Terrain headline: island 380 wide (was 220), rolling hills, mountain masses,
  ridges, plateaus, desert dunes, carved valleys, noisy bay-and-peninsula
  coastline — plus a guaranteed mountain massif per island so no seed rolls
  flat. Verified numerically across 6 seeds: every seed now has mountains
  (max height 25–39), snow/caved areas, desert, tall forest, and a valid spawn.
- Lobby: Somewhere logo/title removed from the top-left header entirely
  (favicon kept; auth-screen logo untouched — the order named the lobby
  header). Tabs re-centered. UI design-system pass: consistent radii,
  shadows, transitions, hover lift, focus rings, styled scrollbars across
  lobby/customize/settings/inventory/build.
- Deliberately NOT varied: player-placed building pieces stay exact (varying
  them would break stacking/collision); pre-built structures vary instead.
- Screenshots: `screenshots/polish/` — before-*, after-*, fix-*, final-*,
  including terrain aerials from 3 angles and the lobby without branding.

## Polish round 3 (2026-10-27, Liam's orders, screenshot-verified)
- Logo: auth-screen logo image removed. No logo appears on screen in auth
  or lobby anymore; the compass-island logo remains ONLY as favicon.
- Characters: reverted from smooth capsules to polished blocky (boxes only,
  ~2.07 tall, slim proportions, boxy faces, 8 boxy hair styles, sleeve/cuff
  and shorts-vs-sweatpants variants). All customization still works in lobby
  and Customization previews; shopkeeper uses the same builder.
- Terrain blending: snow is now gated by a cold-region noise mask, not by
  altitude alone — a tall hill in the plains stays grassy/rocky, and only
  cold-region mountains whiten, with a gradual snowline. Pine snow tips are
  cold-gated the same way. Verified on seed 4242: the hill that used to
  render as a white dome in the plains is now fully green; a cold-region
  snowy mountain still shows blended snow + snow-tipped pines.
- First-person camera: gameplay is now FP (head height 1.65, mouse look,
  WASD/jump unchanged). Player body hidden in game; held-tool viewmodel
  (axe/pickaxe/shovel/hoe) shown bottom-right when a tool is selected.
  Driving uses a driver-seat view. Lobby/customization previews unchanged.
- Interaction = proximity AND aim: ray-sphere targeting from the eye (max
  5m, must pass within the object's radius). Prompt + green crosshair only
  on a valid target; interact/chop inputs ignored otherwise. Dropped-item
  walk-over pickup and hoe ground-tilling are ground actions, not object
  interactions, so they were left as-is.
- Workbenches: craftable workbench now has a pegboard backboard with peg
  holes and hanging hammer/axe/saw shapes (decoration only, crafting
  unchanged). Gold bench area got a gold-trimmed tool board behind it;
  the gold bench itself stays gold, unbreakable, unmovable. Gold material
  metalness lowered (no env map, so high metalness read as dark brown).
- Lobby worlds UI: Netflix-style rows — "Your Worlds" and "Shared Servers"
  rows of 230px cards with per-seed painted island art, name, seed/settings
  or member info, last-played, hover lift/glow, gold selected ring; + New
  world / + New server cards sit inside their rows. Character middle,
  friends right, top tabs, Play-below-character flow unchanged.
- HUD: health/hunger moved to a bottom-right panel; the in-game day display
  is removed from the top right entirely (money counter remains top-right).
- Terrain detail push: pebbles 520→620, grass 900→1020, with the first
  samples clustered near spawn so detail reads immediately; dirt discs now
  skip steep slopes and sit slightly higher; ground texture speckle
  strengthened (lighter + darker dots).
- Screenshots: `screenshots/polish3/` — 01-auth, 02-lobby, 02b-lobby-servers,
  03-customize, 04-fp-day, 05-fp-night, 06-prompt-near, 07-prompt-far,
  08-prompt-away, 09-workbench, 10-terrain-aerial, 11-terrain-plains,
  12-ground-detail, 13-snowy-mountain. All shots taken headlessly via
  file:// URLs (localhost was blocked by the browser's local-network
  checks); the temporary `_shot.html` harness used for terrain/prompt
  shots was deleted after use.
- NOT re-verified headlessly this round: actual click-to-chop, driving,
  mining, farming, car shop, death/respawn (same standing gap as v1/round 2
  — code unchanged in those paths except the targeting/camera changes
  above, which were verified for prompts only).

## Polish round 4 — Liam's round 3 review corrections (2026-10-27)
Every item below was a specific thing Liam said was WRONG in round 3.
All fixes screenshot-verified headlessly in `screenshots/polish4/`.
- Lobby worlds layout (was wrong, now matches his original design): the
  lobby page scrolls down Fortnite-style — character + party in a hero
  section up top (min-height 100vh, panorama fixed behind), friends panel
  on the right, worlds sections below the fold. "Your Worlds" AND "Shared
  Servers" are both present; each section head has its + button at the
  TOP RIGHT (+ New world / + New server, wired to the same creation
  flows, including the 30-world cap). The in-row + cards are deleted
  (function + CSS removed). Netflix card rows, hover glow, gold selected
  ring, Play-below-character flow, no on-screen logo, top tabs, and the
  invites tab are unchanged.
- Grass: was `ConeGeometry(0.10, 0.6)` scaled up to ~1m tall — read as
  mini trees. Now `ConeGeometry(0.035, 0.30)`, scaled 0.7–1.3 with z
  flattened to 0.45, tilted up to ±0.6 — thin blades ~0.21–0.39 tall
  hugging the ground.
- Buildable models rebuilt (workbench, gold bench, vehicle machine, gas
  pump, storage chest, house, wall trims): proper legs/aprons/braces/
  shelves, framed pegboard with peg holes, hanging tools, bench-top
  props, machine plinth/columns/gantry/glowing screen/control panel/
  vents/bay, pump plinth/body/cap/display/hose/nozzle, chest planks/
  bands/latch/hinges/domed lid. Two real defects found by looking at
  the shots and fixed: (1) pegboard tools and the machine's screen/
  panel only faced one way, so from the approach side both read as
  blank slabs — tools and screen/panel/light are now mirrored on both
  faces, vents on both sides, chest bands lightened to steel gray;
  (2) a leftover `let viewmodel` declaration was dropped in the
  viewmodel rewrite and threw at runtime — restored.
- Held items redone per tool (axe, pickaxe, shovel, hoe): proper hafts,
  butt caps, heads, grip hand blocks, held diagonally bottom-right.
  Shot review caught the shovel's blade hanging below the frame (model
  too long for first-person distance) — shovel now held farther out
  and higher so grip, haft, and spade all show; hoe blade widened so
  it reads as a hoe, not an axe head.
- HUD correction: health/hunger moved to the BOTTOM LEFT (round 3 put
  them right, which was wrong); chat box raised to sit above them.
  Day display stays removed from the top right; money counter remains.
- Caves + all biomes: up to 3 real walk-in caves per world (stone arch
  ~1.7 wide / ~2.3 tall, chamber with iron ore, entrance lantern, warm
  interior light). Two real defects found and fixed: (1) mound rocks
  overlapped the roof slab and spiked through the ceiling — ring moved
  out to radius 3.8 and raised so no rock reaches the chamber;
  (2) the terrain is NOT carved, so a flat chamber on a slope let the
  hillside surface slice through the floor (the "green floor" seen in
  the first interior shot) — the whole chamber now tilts with the
  hillside (rotation.x = atan(slopeAlong)), the floor plane tracks the
  terrain, and `groundY` returns the tilted floor inside the footprint,
  so walking in stays on the floor. Biome presence verified numerically
  on 9 seeds (all five biomes on every seed) and visually: plains
  (green), desert (tan dunes), snowy (white slope + snow-tipped
  pines), tall forest (deep green pines), caved (rocky flanks + cave
  mouths). Snow rendering fix along the way: the cold-region gate
  `sstep(0.48, 0.62, coldAt)` was so strict that seed 4242's snowy
  mountains showed no white ground at all — widened to
  `sstep(0.44, 0.58, coldAt)`; warm regions still get snowLine 28
  (no snow on plains hills — lobby panorama re-checked, still green).
- Test-only URL hooks added (same harmless family as `?demo=1`,
  `?shot=`, `?time=`): `?tools=1` puts all four tools in the hotbar,
  `?place=1` drops a workbench / vehicle machine / chest / gas pump /
  wall row near spawn, for model screenshots. The temporary
  `window.__dbg` harness hook used during this pass was REMOVED after
  screenshots (grep-verified, 0 matches) — it is not in the shipped
  code.
- Screenshots: `screenshots/polish4/` — 01-lobby-top, 02-lobby-worlds,
  02b-lobby-servers, 03-fp-day, 04-held-axe, 05-held-pickaxe,
  06-held-shovel, 07-held-hoe, 08-models-row, 08b-bench-spawnside,
  08c-machine-spawnside, 08d-chest, 08e-gaspump, 09-grass-closeup,
  10-cave-entrance, 11-cave-interior, 12-biome-{plains,desert,snowy,
  caved,tallforest}, 13-hud-bottom-left. Headless Chromium was the
  system build at /opt/meta-chromium/chrome (the Playwright download
  was blocked); file:// module scripts needed
  `--allow-file-access-from-files`, and localhost was blocked by the
  browser's local-network checks, so shots used file:// URLs.
  file:// localStorage is silently unavailable in this Chromium, which
  is why the `?tools=1` / `?place=1` hooks exist instead of seeded
  saves.
- NOT re-verified headlessly this round: actual click-to-chop, driving,
  mining, farming, car shop, death/respawn (same standing gap as
  before — code paths untouched except targeting-adjacent viewmodel
  code and the cave floor change); real mouse/keyboard play on Liam's
  machine is ground truth. No deployment, no GitHub push, no
  .pages.dev name — still blocked on Liam's choice of name.

## Tool progression fix + item/model visual pass (2026-10-27, Liam's orders, screenshot-verified)
- **Wooden pickaxe (the early-game path to stone):** costs only **3 wood**, craftable in **quick craft (Q, anywhere)** AND at any workbench/gold bench — no stone needed. Power 1 (stone pickaxe is power 2), durability 30 (stone pickaxe is 80), so it's slower and wears out faster, but it mines stone rocks (3 hits) and iron ore (4 hits). Once you have 3 stone + 2 wood you can upgrade to the stone pickaxe (renamed from "Pickaxe" to **Stone pickaxe** to tell the tiers apart). The no-pickaxe hint now points at quick-crafting a wooden pickaxe instead of the gold bench. Verified: fresh-player simulation (chop 2 trees worst-case → craft → mine stone → stone pickaxe within reach) plus a headless run where the quick-craft row showed enabled at 20/3 wood and clicking it consumed 3 wood.
- **Inventory icons:** every item now sits on a distinct colored tile (chip color per item in `data.js`) with a larger emoji, inset border, and shadow, so items read clearly at small size — wooden tools on brown tiles vs stone/iron tools on gray tiles, seeds on green tiles vs crops on gold/orange, etc. Chips also appear in craft rows and storage-chest contents. No item names, functions, or recipes changed.
- **Dropped items:** no more one generic gold box — each item drops as a small recognizable prop (log with end rings, gray rock, metal ingot, red apple, carrot, seed packet, leather sheet, sand/snow bags, glass pane, ice block, gold coin, mini tools, keys with rings, backpack, jerrycan, mini chest/workbench/walls). Pickup radius, spin, and 10-minute despawn unchanged; walk-over pickup seen working in screenshots ("Picked up 2× Carrot").
- **Placeable model quality (big jump, visuals only — footprints, stacking, and collision unchanged):** procedural textures added (wood grain with knots, brick coursing with per-brick tint, shingle rows, brushed steel) that respect the paint tint. Walls rebuilt: wood = five planks with grooves, rails, baseboard, end posts, nail heads; brick = coursing texture + concrete cap/footing + pilasters; steel = brushed panels + seams + rivets; window = cross mullion + protruding sill + header; door = recessed panels + hinges + gold knob + threshold; ice = frost cracks + frosted cap/base. Floor = grained planks with seams + edge trim. Roof = shingled cone + ridge cap + eave boards. Workbench = grained top + bench dogs + hand plane + shelf jars + spirit level (pegboard tools unchanged). Vehicle machine = hazard plinth strip + panel bolts + power cable. Gas pump = nozzle + grade buttons + drip rail. Chest = grained wood + corner protectors + rope handles. House = shingled roof + stone foundation + siding lines + shutters + porch railing. Screenshots in `screenshots/items/`: full inventory, quick-craft list (wooden pickaxe row), dropped items, wall row, built hut structure, workbench close-up, production load check. No deployment, no GitHub push, no .pages.dev name.

## Inventory names + held-item match fix (2026-10-27, Liam's orders, screenshot-verified)
- **No more truncated names:** hotbar slots widened (68px) and made taller (86px), backpack panel widened (740px), inventory slots given room for two-line labels. Labels now WRAP instead of using ellipsis — every name reads in full ("Wooden pickaxe", "Storage chest", "Vehicle machine", "Window wall") in the hotbar, backpack grid, and permanent slots. Counts moved to the slot's top-right corner so they no longer clip into labels, and every slot carries a `title` tooltip with the full name as a backstop. Craft rows and chest contents already showed full names and are unchanged.
- **Held items match their inventory design, at proper size:** first-person viewmodels rebuilt smaller (~0.40 long, farther out at z=-1.12, lower-right corner) with slim heads that can't read as slabs, and head colors tinted per item every frame — wooden axe = red head like its axe icon, stone tools = gray steel, wooden pickaxe = brown, shovel/hoe = gray steel. Root cause of the old gray slab found: high metalness with no env map shaded colors dark (the old gold-reading-brown bug), so head metalness was cut to 0.15 and the red head now reads red. Shovel was reworked twice — its spade hung below the frame at first, then raised so D-grip + haft + spade all show. The hoe's inventory icon was the seedling emoji (no hoe emoji exists); superseded by the drawn-icons pass — the hoe now has a proper drawn icon and a proper brown-haft, gray-blade held model. Screenshots in `screenshots/items2/`: full inventory (all 50 slots, every name readable), per-tool inventory-open shots, and clean first-person shots of axe, pickaxe, shovel, hoe with the matching hotbar icon selected below. Gameplay, recipes, and functions unchanged — visuals and labels only. No deployment, no GitHub push, no .pages.dev name.

## Drawn icons + no-hand held tools (2026-10-27, Liam's orders, screenshot-verified)
- **No more emoji icons:** all 38 item icons are now hand-drawn inline SVGs in a new `js/icons.js` (one consistent style: bold flat shapes, dark outline, readable at 27-38px) — axe/pickaxe/shovel/hoe, log, rock, ingot, leather, sand/snow bags, glass, ice, apple, wheat, carrot, both seed packets, coin, keys, backpack, jerrycan, workbench, all six wall types, floor, roof, chest, vehicle machine, gas pump, house kit. They appear in the inventory, hotbar, craft rows, and chest contents. Emoji stripped from every item-UI surface: target prompts, shop rows, vehicle/car-shop/storage panels, money display, and toasts. Lobby world/server cards use drawn globe/server pictograms. Zero pictographic emoji remain in `js/data.js`, `js/game.js`, `js/lobby.js`, or `index.html` item UI (the only glyphs left are typographic marks like checkmarks and the close X). Item names, functions, recipes, and counts are unchanged.
- **Hand removed from held tools:** the skin-tone grip/hand blocks are deleted from all four first-person viewmodels — axe, pickaxe, shovel, and hoe now float on their own in the bottom-right of the first-person view, no hand mesh, no grip block. (The shovel's own D-grip ring at the top of its haft is part of the tool and stays.) Tools keep their icon-matching colors: wooden axe red head, stone tools gray steel, wooden pickaxe brown.
- Screenshots in `screenshots/icons/`: lobby world/server cards, inventory with tools, full inventory with all drawn icons, and clean first-person axe/pickaxe/shovel/hoe shots with no hand visible. All JS passes `node --check` with zero console errors. Gameplay, recipes, and functions unchanged — visuals only. No deployment, no GitHub push, no .pages.dev name.

## Files
- `index.html`, `css/style.css`
- `js/character.js` (character builder), `js/world.js` (terrain/biomes/structures),
  `js/data.js` (items, recipes, filters), `js/lobby.js` (auth/lobby/customization),
  `js/game.js` (gameplay)
- `assets/three.module.js` (Three.js r160, vendored), `assets/logo.png` (favicon
  only since polish round 3 — the approved compass-island logo)
- `screenshots/` — phase screenshots taken during this build
