import * as THREE from 'three';
import { buildCharacter } from './character.js';
import { buildWorld, heightAt, biomeAt, makeSkyDome, hideTreeInstances, refreshTreeInstances } from './world.js';
import { ITEMS, RECIPES, QUICK_RECIPES, cleanText, load, save } from './data.js';
import { itemIcon } from './icons.js';
import { woodTex, brickTintedTex, shingleTintedTex, steelTex, goldLightTex, panelTex, pumpPanelTex, sidingTex, shadowTex, frostTex, soilTex, swirlTex, flakeTex, treadTex, appleTex, carrotTex, wheatTex, leatherTex, weaveTex, phoneTex, woodLightTex, stoneLightTex, leafLightTex } from './textures.js';

const $ = (id) => document.getElementById(id);
const S = window.Somewhere;

// ---------- State ----------
let scene, camera, renderer, clock, RAF = null;
let world, player, keys = {}, locked = false, started = false;
let W = null; // world def
let time = 600; // seconds into day cycle (30 min = 1800s); start 08:00
let placed = [], cars = [], crops = [], drops = [];
let chatOpen = false, buildMode = false, buildSel = null, paintColor = '#8a5a2b';
let selSlot = 0, driving = null, interacting = null;
let chatLog = [];
let saveTimer = 0;
let swingStart = 0; // timestamp of the last tool swing (item-use animation)
let swingDur = 350; // debug-overridable only; gameplay default is 350ms
let pauseOpen = false;
let lastForwardDown = 0, doubleTapSprint = false, forwardHeld = false;
let curEyeH = 1.65; // smoothed eye height: stand 1.65, crouch 1.05
// How each menu was opened: { by: 'key'|'mouse', key: code|null }.
// A menu closes on its open key ONLY if it was opened by the keyboard
// with that same key — mouse-opened menus ignore the key.
let invOpened = null, buildOpened = null, helpOpened = null, craftOpened = null, shopOpened = null;
let targetRing = null;
// ---------- The Flipped + phone (dimension system) ----------
let darkened = []; // active Darkened mobs (Flipped only)
let portal = null; // open portal {group, x, z, targetDim, machine, armedAt, prevD}
let travelFailed = false; // set if a dimension rebuild throws: saves stop so the pre-switch disk save survives until a refresh
let phoneOpenedAt = 0; // guards the right-click that opens the phone menu from closing it
let darkenedTimer = 90; // seconds until the next Darkened spawn check (Flipped only)

const P = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: -0.15,
  hp: 100, hunger: 100, money: 50, onGround: false, fallStart: 0,
  inv: [], hotbar: [], perm: [null, null, null], hasBackpack: false,
  day: 1, dead: false, carKey: false, houseKey: false, landOwned: false,
};

function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), ms);
}
function centerToast(msg, ms = 2000) {
  const el = $('center-toast');
  el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), ms);
}
function chatMsg(sender, text, sys = false) {
  // The bottom-left system activity feed is GONE: System narration
  // ("+3 Wood", "Chest opened!", "Picked up…") never reaches the chat
  // log and never pops a toast. Player chat is separate and stays.
  if (sys) return;
  const clean = cleanText(text);
  chatLog.push({ sender, text: clean, sys: false });
  if (chatLog.length > 60) chatLog.shift();
  renderChat();
  if (!chatOpen) toast(`${sender}: ${clean}`, 4000);
}
function renderChat() {
  $('chat-log').innerHTML = chatLog.slice(-6).map((m) =>
    `<div class="chat-msg ${m.sys ? 'sys' : ''}"><b>${m.sender}:</b> ${m.text}</div>`).join('');
}
// Chat reset: leaving a world and rejoining must never show the
// previous run's messages. Clears both the array and the DOM, called
// from backToLobby and at the top of startGame.
function clearChat() {
  chatLog.length = 0;
  const el = $('chat-log');
  if (el) el.innerHTML = '';
}

// ---------- Inventory ----------
function invCap() { return P.hasBackpack ? 40 : 13; }
function countOf(id) {
  let n = 0;
  for (const s of [...P.inv, ...P.hotbar]) if (s && s.id === id) n += s.n;
  return n;
}
const MAX_STACK = 70; // max items per slot for anything stackable
function addItem(id, n = 1) {
  if (id === 'money') { P.money += n; updateHUD(); return true; }
  const def = ITEMS[id];
  if (def && def.tool && !def.temp) { // tools don't stack — except temp stones, which do
    for (let i = 0; i < n; i++) {
      const slot = { id, n: 1, dur: def.maxDur };
      if (!pushToInv(slot)) return false;
    }
    updateHUD(); return true;
  }
  // Stackable: top existing slots up to 70, then new slots in chunks of 70.
  // All-or-nothing: if total room < n, add nothing and return false.
  let room = 0;
  for (const s of [...P.inv, ...P.hotbar]) if (s && s.id === id) room += MAX_STACK - s.n;
  room += ((7 - P.hotbar.filter(Boolean).length) + (invCap() - P.inv.filter(Boolean).length)) * MAX_STACK;
  if (room < n) return false;
  let left = n;
  for (const s of [...P.inv, ...P.hotbar]) {
    if (left <= 0) break;
    if (s && s.id === id && s.n < MAX_STACK) { const add = Math.min(left, MAX_STACK - s.n); s.n += add; left -= add; }
  }
  while (left > 0) {
    const chunk = Math.min(left, MAX_STACK);
    if (!pushToInv({ id, n: chunk })) return false; // unreachable after the room check
    left -= chunk;
  }
  updateHUD(); return true;
}
function pushToInv(slot) {
  // Slot arrays can hold holes: the inventory grid renders every slot
  // up to the cap, and dragging onto a rendered empty slot past the
  // array's end extends it with undefined entries. Raw .length then
  // lies about fullness — it reported "Inventory full" with visibly
  // empty slots, and atomic crafting refunded everything, so nothing
  // could be crafted. Fill the first empty slot in range instead;
  // only a fully-occupied range is really full. Filling holes (never
  // appending past them) also keeps new items inside the 7 visible
  // hotbar slots instead of landing on unreachable indices.
  for (let i = 0; i < 7; i++) if (!P.hotbar[i]) { P.hotbar[i] = slot; return true; }
  for (let i = 0; i < invCap(); i++) if (!P.inv[i]) { P.inv[i] = slot; return true; }
  toast('Inventory full!'); return false;
}
function removeCount(id, n) {
  let left = n;
  for (const arr of [P.hotbar, P.inv]) {
    for (let i = 0; i < arr.length && left > 0; i++) {
      if (arr[i] && arr[i].id === id) {
        const take = Math.min(left, arr[i].n);
        arr[i].n -= take; left -= take;
        if (arr[i].n <= 0) arr.splice(i, 1), i--;
      }
    }
  }
  return left === 0;
}
function selectedItem() {
  if (selSlot < 7) return P.hotbar[selSlot] || null;
  return P.perm[selSlot - 7] || null;
}
function damageTool(slot) {
  if (!slot || !slot.dur) return;
  // Temp ground stones never lose durability per swing — they break
  // only when the tree they are chopping is fully felled (see chopTree).
  if (ITEMS[slot.id].temp) return;
  slot.dur -= 1;
  if (slot.dur <= 0) {
    toast(`Your ${ITEMS[slot.id].name.toLowerCase()} broke!`);
    const arr = selSlot < 7 ? P.hotbar : P.perm;
    const idx = selSlot < 7 ? selSlot : selSlot - 7;
    arr[idx] = null;
    if (selSlot < 7) P.hotbar = P.hotbar.filter(Boolean);
    updateHUD();
  }
}

// ---------- Start ----------
// Async: the world build is async now, so callers MUST await this —
// the Play handler hides its loading overlay only after this resolves.
// onProgress (optional, from the Play path) is buildWorld's
// (phaseLabel, fraction) callback, passed straight through initScene.
window.startGame = async function (worldDef, onProgress) {
  // Fresh run, including a fresh chat: no previous messages carry over.
  clearChat();
  W = worldDef;
  started = true;
  try {
    // Fresh run state: re-entering a world (e.g. via pause → lobby →
    // Play) must not carry stale placed pieces, cars, crops, or drops.
    placed = []; cars = []; crops = []; drops = [];
    darkened = []; portal = null;
    $('phone-panel').classList.add('hidden');
    driving = null; buildMode = false; chatOpen = false; pauseOpen = false;
    $('pause-menu').classList.add('hidden');
    $('shop-panel').classList.add('hidden');
    $('inv-panel').classList.add('hidden');
    const params = new URLSearchParams(location.search);
    if (params.get('time') === 'night') time = 22 / 24 * 1800;
    if (params.get('time') === 'day') time = 10 / 24 * 1800;
    await initScene(onProgress);
    // Build done even if buildWorld never reported 100% itself: the
    // bar lands on full before the overlay hides.
    if (onProgress) onProgress('Entering world…', 1);
    loadSave();
    // Test-only URL hooks (same harmless family as ?demo=1, ?shot=, ?time=):
    // ?tools=1 gives all four tools (for screenshots); ?place=1 drops a row
    // of buildable models near spawn (workbench, vehicle machine, chest,
    // gas pump, wall) so their rebuilt models can be inspected.
    if (params.get('tools') === '1') {
      for (const id of ['pickaxe', 'shovel', 'hoe']) {
        if (!P.hotbar.some((s) => s.id === id)) P.hotbar.push({ id, n: 1, dur: ITEMS[id].maxDur });
      }
    }
    if (params.get('place') === '1') {
      const sp = world.spawn;
      for (const [itemId, dx, dz] of [['workbench', 0, 5], ['vehicle_machine', 4, 5], ['chest', -4, 5], ['gas_pump', 4, 9], ['wall_wood', -4, 9]]) {
        const x = sp.x + dx, z = sp.z + dz, y = groundY(x, z);
        const mesh = buildPieceMesh(itemId);
        mesh.position.set(x, y, z);
        scene.add(mesh);
        placed.push({ itemId, x, z, y, rotY: 0, color: (itemId.startsWith('wall_') ? PIECE_COLORS[itemId.slice(5)] : null) || paintColor, mesh, contents: itemId === 'chest' ? [] : undefined });
      }
    }
    buildHUDStatic();
    updateHUD();
    chatMsg('System', `Welcome to ${W.name}! Chop trees with your wooden axe. Press H for help.`, true);
    if (params.get('shot') === 'inventory') setTimeout(() => toggleInventory(true), 800);
    if (params.get('shot') === 'build') setTimeout(() => setBuildMode(true), 800);
    clock = new THREE.Clock();
    loop();
  } catch (err) {
    // Never leave a half-started game running: no loop is started on
    // this path (loop() is the last step), so just drop the started
    // flag and let the caller (Play handler) restore the lobby.
    started = false;
    throw err;
  }
};

async function initScene(onProgress) {
  const canvas = $('game-canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  scene = new THREE.Scene();
  scene.background = null; // gradient sky dome covers the background
  scene.fog = new THREE.Fog(0xcfe4f5, 120, 340);
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3d5a34, 0.9);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0xffffff, 0.12));
  const sky = makeSkyDome(700);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(0xfff2cc, 1.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
  sun.shadow.camera.far = 300;
  scene.add(sun); scene.add(sun.target);
  scene.userData.sun = sun;
  scene.userData.sky = sky;
  scene.userData.hemi = hemi;

  world = await buildWorld(scene, W.seed, onProgress, W.dim === 'flipped' ? { mirror: true } : {});
  const sp = world.spawn;
  P.pos.set(sp.x, sp.y, sp.z);
  P.vel.set(0, 0, 0);
  P.yaw = Math.PI;

  // Player character — built for lobby/customization previews, but HIDDEN
  // in-game: gameplay is first person, you see through the character's eyes.
  player = new THREE.Group();
  const body = buildCharacter(S.char);
  body.position.y = 0;
  player.add(body);
  player.userData.body = body;
  player.visible = false;
  scene.add(player);
  // Nameplate sprite above head
  const cnv = document.createElement('canvas');
  cnv.width = 512; cnv.height = 128;
  const ctx = cnv.getContext('2d');
  ctx.font = 'bold 52px system-ui'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(60, 14, 392, 84);
  ctx.fillStyle = '#fff';
  ctx.fillText(S.session.username, 256, 72);
  const tex = new THREE.CanvasTexture(cnv);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(2.6, 0.65, 1); spr.position.y = 2.35;
  player.add(spr);

  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 4500);
  scene.add(camera); // needed so the held-tool viewmodel (a camera child) renders
  buildViewmodel();
  bindInput();
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

// ---------- Input ----------
// Controls: LEFT click = attack / chop / mine / place. RIGHT click =
// interact (chests, benches, shops, cars); HOLD right click eats held
// food. E still interacts too. F = friends, P = pause (like Esc).
let inputBound = false;
function bindInput() {
  // Bound once: re-entering a world (pause → lobby → Play) must not
  // stack duplicate document listeners that would double-fire keys.
  if (inputBound) return;
  inputBound = true;
  const kb = S.keybinds;
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys[e.code] = true;
    if (chatOpen) {
      if (e.code === 'Enter') sendChat();
      if (e.code === 'Escape') closeChat();
      return;
    }
    // Typing in a panel text field (friends search/add) must not fire
    // game actions — 'f' in the search box must not close the panel,
    // 'p' must not open pause, and so on. (Chat input stops
    // propagation on its own, so it never reaches here.)
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Double-tap forward = sprint while forward stays held (released
    // forward clears it — see keyup below). forwardHeld tracks the
    // physical hold: keys[] is already true by this point in the
    // handler, so it cannot tell a fresh tap from a hold.
    if (e.code === kb.forward) {
      const now = performance.now();
      if (now - lastForwardDown < 300 && !forwardHeld) doubleTapSprint = true;
      forwardHeld = true;
      lastForwardDown = now;
    }
    // Esc opens/closes pause; P does exactly the same (Liam's key).
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (pauseSettingsOpen) { backToPauseMenu(); return; }
      if (pauseOpen) { closePause(); return; }
      if (document.body.classList.contains('friends-open')) { S.setFriendsOpen?.(false); return; }
      if (!$('inv-panel').classList.contains('hidden') || !$('shop-panel').classList.contains('hidden') ||
          !$('phone-panel').classList.contains('hidden') ||
          !$('help-panel').classList.contains('hidden')) {
        closePanels();
        return;
      }
      // Esc NEVER exits build mode: in build mode it opens the pause
      // menu like everywhere else, and Resume returns to build mode
      // unchanged (openPause/closePause leave buildMode alone).
      openPause();
      return;
    }
    if (e.code === kb.chat) { openChat(); return; }
    if (e.code === kb.inventory) {
      if (!$('inv-panel').classList.contains('hidden')) {
        // Same-key close ONLY if the keyboard opened it with this key.
        if (invOpened && invOpened.by === 'key' && invOpened.key === kb.inventory) toggleInventory(false);
      } else toggleInventory(true, { by: 'key', key: kb.inventory });
      return;
    }
    if (e.code === kb.build) {
      // B is a plain manual toggle, whatever opened build mode
      // (key, auto-enter on selection change, or debug) — pressing it
      // while in build mode always exits. The old by/key guard left
      // auto-entered build mode un-exitable by B.
      if (buildMode) setBuildMode(false);
      else setBuildMode(true, { by: 'key', key: kb.build });
      return;
    }
    if (e.code === kb.quickcraft) {
      const list = $('craft-list');
      if (list.innerHTML && craftOpened && craftOpened.by === 'key' && craftOpened.key === kb.quickcraft && craftOpened.quick) {
        closePanels();
      } else openCraft(true, { by: 'key', key: kb.quickcraft });
      return;
    }
    if (e.code === kb.help) {
      if (!$('help-panel').classList.contains('hidden')) {
        if (helpOpened && helpOpened.by === 'key' && helpOpened.key === kb.help) { $('help-panel').classList.add('hidden'); helpOpened = null; }
      } else {
        $('help-panel').classList.remove('hidden'); renderHelp();
        helpOpened = { by: 'key', key: kb.help };
      }
      return;
    }
    if (e.code === kb.interact) { doInteract('key'); return; }
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3' || e.code === 'Digit4' ||
        e.code === 'Digit5' || e.code === 'Digit6' || e.code === 'Digit7') {
      selSlot = +e.code.slice(-1) - 1; updateHUD();
    }
    if (e.code === 'Digit8') { selSlot = 7; updateHUD(); }
    if (e.code === 'Digit9') { selSlot = 8; updateHUD(); }
    if (e.code === 'Digit0') { selSlot = 9; updateHUD(); }
    // F is friends, everywhere: in the lobby the lobby handler owns it,
    // in game this branch toggles the same panel. Eating is NOT F —
    // eating is hold right-click (see startEatHold).
    if (e.code === 'KeyF') {
      if ($('game-screen').classList.contains('hidden')) return;
      S.setFriendsOpen?.(!document.body.classList.contains('friends-open'));
      return;
    }
  });
  document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === S.keybinds.forward) { doubleTapSprint = false; forwardHeld = false; }
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    P.yaw -= e.movementX * 0.0024;
    P.pitch = Math.max(-1.2, Math.min(0.9, P.pitch - e.movementY * 0.0024));
  });
  // No context menu ANYWHERE in the game screen: right-click is
  // Interact, not a browser menu. The old canvas-only listener missed
  // clicks over HUD/prompt/panel overlays, so right-clicking a
  // workbench could still pop the browser's white menu — suppressing
  // at the game-screen level (capture) covers canvas and overlays.
  $('game-screen').addEventListener('contextmenu', (e) => e.preventDefault(), true);
  $('game-canvas').addEventListener('contextmenu', (e) => e.preventDefault());
  $('game-canvas').addEventListener('mousedown', (e) => {
    // A mouse menu open means the cursor is out and look is stopped —
    // canvas clicks must not re-lock or act until the menu closes.
    if (!$('inv-panel').classList.contains('hidden') || !$('shop-panel').classList.contains('hidden') ||
        !$('phone-panel').classList.contains('hidden') ||
        !$('pause-menu').classList.contains('hidden') || document.body.classList.contains('friends-open')) return;
    if (!locked) {
      try { $('game-canvas').requestPointerLock(); } catch { /* ignore */ }
      return;
    }
    if (e.button === 0) {
      if (buildMode) { placeGhostPiece(); return; }
      // Chop/mine/dig/break need a HOLD, not a spam-click (see startHoldAction).
      if (target && (target.kind === 'tree' || target.kind === 'rock' || target.kind === 'ground' || target.kind === 'placed')) { startHoldAction(); return; }
      onPrimaryAction();
    } else if (e.button === 2) {
      // In build mode RIGHT-click PLACES, exactly like left-click —
      // it used to exit build mode, which is why Liam's
      // right-click-to-place cancelled instead of placing. Exiting
      // build mode is B or switching to a non-building item only —
      // Esc opens the pause menu instead (see setBuildMode toast).
      if (buildMode) { placeGhostPiece(); return; }
      if (driving) { doInteract('mouse'); return; }
      // HOLD right-click to eat: if the held item is food and the
      // crosshair is NOT on something right-click would use (chest,
      // bench, shop, car, drop, ...), holding eats one item instead
      // of interacting. Interactable targets keep their behavior.
      const sel = selectedItem();
      // Phone: when its permanent slot is selected, right-click opens
      // the phone menu instead of interacting with the world.
      if (sel && sel.id === 'phone') { openPhoneMenu(); return; }
      const edible = sel && (sel.id === 'apple' || sel.id === 'carrot' || sel.id === 'wheat');
      const interactable = target && (target.kind === 'chest' || target.kind === 'goldbench' ||
        (target.kind === 'placed' && target.ref.itemId === 'workbench') || target.kind === 'shop' ||
        target.kind === 'carshop' || target.kind === 'landoffice' || target.kind === 'car' ||
        target.kind === 'groundstone' || target.kind === 'drop');
      if (edible && !interactable) { rightHeld = true; startEatHold(); return; }
      doInteract('mouse');
    }
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === $('game-canvas');
  });
  // Releasing left click always ends a chop/mine hold, wherever the
  // release happens (including over a panel or outside the window).
  // Releasing right click ends an eat hold the same way.
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) stopHoldAction();
    if (e.button === 2) { rightHeld = false; stopEatHold(); }
  });
  window.addEventListener('blur', () => { stopHoldAction(); rightHeld = false; stopEatHold(); });
  // True when any in-game panel is open: inventory, workbench / chest /
  // shop (all share .shop-panel), help, or the pause menu (its Settings
  // submenu lives inside the same element). The wheel must scroll such
  // a panel natively and never move the hotbar selection while it is open.
  function anyPanelOpen() {
    return !$('inv-panel').classList.contains('hidden') ||
      !$('shop-panel').classList.contains('hidden') ||
      !$('phone-panel').classList.contains('hidden') ||
      !$('help-panel').classList.contains('hidden') ||
      !$('pause-menu').classList.contains('hidden') ||
      document.body.classList.contains('friends-open');
  }
  // The wheel changes the hotbar selection ONLY during pure gameplay.
  // The handler stays passive so native panel scrolling is untouched;
  // it simply returns early while a panel is open, so the selection
  // never moves under an open workbench, chest, shop, inventory,
  // help, or pause panel.
  document.addEventListener('wheel', (e) => {
    if (!started || chatOpen || anyPanelOpen()) return;
    selSlot = (selSlot + (e.deltaY > 0 ? 1 : 9)) % 10;
    updateHUD();
  }, { passive: true });
  $('chat-input').addEventListener('keydown', (e) => { e.stopPropagation(); });
  // Mouse-menu close buttons: hide the panel and re-capture pointer
  // lock from the click gesture, so play resumes immediately.
  document.addEventListener('click', (e) => {
    const closer = e.target.closest('.panel-close');
    if (!closer) return;
    const panel = closer.closest('.shop-panel, .inv-panel');
    if (panel) panel.classList.add('hidden');
    closeOpenChestLid();
    requestGameLock();
  });
  $('btn-pause').onclick = () => openPause();
  $('phone-recall').onclick = doPhoneRecall;
  $('phone-close').onclick = closePhoneMenu;
  // Right-click again while the phone menu is open closes it (the
  // canvas handler can't fire while a panel is open). The opening
  // click itself is ignored via the timestamp guard.
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    if ($('phone-panel').classList.contains('hidden')) return;
    if (performance.now() - phoneOpenedAt < 200) return;
    closePhoneMenu();
  });
  $('pause-resume').onclick = () => closePause();
  $('pause-settings-btn').onclick = () => openPauseSettings();
  $('pause-settings-back').onclick = () => backToPauseMenu();
  $('pause-savequit').onclick = () => saveAndQuit();
  $('pause-set-keepinv').onchange = () => savePauseSettings();
  $('pause-set-friendly').onchange = () => savePauseSettings();
  $('pause-set-brightness').oninput = (e) => {
    S.settings.brightness = +e.target.value; save('somewhere_settings', S.settings);
    $('pause-brightness-val').textContent = e.target.value + '%';
    document.querySelectorAll('canvas').forEach((c) => { c.style.filter = `brightness(${S.settings.brightness}%)`; });
  };
  $('pause-set-audio').oninput = (e) => {
    S.settings.audio = +e.target.value; save('somewhere_settings', S.settings);
    $('pause-audio-val').textContent = e.target.value + '%';
  };
}
function requestGameLock() {
  if (!started || $('game-screen').classList.contains('hidden')) return;
  try {
    const lk = $('game-canvas').requestPointerLock();
    if (lk && lk.catch) lk.catch(() => {});
  } catch { /* click-to-lock fallback */ }
}
// Lobby module re-locks through this bridge when the friends panel
// closes in game.
S.requestGameLock = requestGameLock;

function renderHelp() {
  $('help-panel').innerHTML = `<h3>How to play</h3>
  <p><b>WASD</b> move · <b>Double-tap W</b> sprint (hold W) · <b>Shift</b> sprint · <b>Hold Alt</b> crouch · <b>Mouse</b> look · <b>Space</b> jump<br>
  <b>Right-click</b> (or <b>E</b>) interact · <b>Hold right-click</b> eat · <b>Hold left-click</b> to chop / mine / dig · <b>Left- or right-click</b> place in build mode · <b>B</b> or switch to a non-building item exits build mode<br>
  <b>1–7</b> hotbar · <b>8, 9, 0</b> permanent slots (car key, house key, phone) · <b>Scroll</b> switch slot<br>
  <b>I</b> backpack · <b>B</b> build mode · <b>Q</b> quick craft · <b>T</b> chat · <b>F</b> friends · <b>Esc</b> or <b>P</b> menu · <b>H</b> this help</p>
  <p>Start: chop trees with your wooden axe. Use the gold bench near spawn to craft walls, tools and machines. Place a vehicle machine, craft a car, and your car key appears in a permanent slot. Watch hunger — eat apples to stay full and regen health.</p>
  <p><b>Phone</b> (craft it with iron at a workbench): select it and <b>right-click</b> to open it. <b>Portal command center</b> (workbench: 4 iron + 4 wood): place it, use its keypad, and walk into the portal to reach The Flipped — a mirrored world of fire and darkness. There, the Darkened hunt you; beat one to earn the Shadow Sword, which poisons enemies. In The Flipped, your phone's <b>Portal Recall</b> calls a portal back to your arrival spot — or drags you home if you're far away.</p>`;
}

// ---------- Pause menu (Minecraft Bedrock-style) ----------
// The Menu button opens a pause screen — Resume, Settings, and Save
// and Quit at the bottom. It does NOT jump straight into settings.
// Settings opens a submenu (world toggles + brightness/audio) with a
// Back button returning to the pause screen; Save and Quit saves the
// world, then returns to the lobby.
let pauseSettingsOpen = false;
function openPause() {
  if (!started || chatOpen) return;
  // The pause screen stands alone: opening it from the Menu button
  // while inventory/workbench is open must not stack dialogs.
  closePanels();
  stopHoldAction();
  pauseOpen = true; pauseSettingsOpen = false;
  $('pause-world-name').textContent = W ? ('World: ' + W.name) : '';
  $('pause-menu').classList.remove('hidden');
  $('pause-settings').classList.add('hidden');
  document.exitPointerLock?.();
}
function openPauseSettings() {
  if (!pauseOpen) return;
  pauseSettingsOpen = true;
  $('pause-set-keepinv').checked = !!(W && W.keepInv);
  $('pause-set-friendly').checked = W ? W.friendly !== false : true;
  $('pause-set-brightness').value = S.settings.brightness || 100;
  $('pause-brightness-val').textContent = (S.settings.brightness || 100) + '%';
  $('pause-set-audio').value = S.settings.audio ?? 80;
  $('pause-audio-val').textContent = (S.settings.audio ?? 80) + '%';
  $('pause-menu').classList.add('hidden');
  $('pause-settings').classList.remove('hidden');
}
function backToPauseMenu() {
  pauseSettingsOpen = false;
  $('pause-settings').classList.add('hidden');
  $('pause-menu').classList.remove('hidden');
}
function closePause() {
  pauseOpen = false; pauseSettingsOpen = false;
  $('pause-menu').classList.add('hidden');
  $('pause-settings').classList.add('hidden');
  requestGameLock();
}
function saveAndQuit() {
  saveGame();
  backToLobby();
}
function savePauseSettings() {
  if (!W) return;
  W.keepInv = $('pause-set-keepinv').checked;
  W.friendly = $('pause-set-friendly').checked;
  // Persist to the lobby's saved world/server entry for this world.
  const worlds = load('somewhere_worlds', []);
  const w = worlds.find((x) => x.id === W.id);
  if (w) { w.keepInv = W.keepInv; w.friendly = W.friendly; save('somewhere_worlds', worlds); return; }
  const servers = load('somewhere_servers', []);
  const s = servers.find((x) => x.id === W.id);
  if (s) { s.keepInv = W.keepInv; s.friendly = W.friendly; save('somewhere_servers', servers); }
}
async function backToLobby() {
  pauseOpen = false; pauseSettingsOpen = false;
  $('pause-menu').classList.add('hidden');
  $('pause-settings').classList.add('hidden');
  if (RAF) { cancelAnimationFrame(RAF); RAF = null; }
  started = false;
  darkened = []; portal = null;
  // Save-before-leave ordering unchanged: the save lands before the
  // game screen hides and before the lobby shows.
  saveGame();
  // Next Play always starts in the normal world — the dimension is
  // runtime-only and never persists across sessions.
  if (W) W.dim = 'normal';
  clearChat();
  $('game-screen').classList.add('hidden');
  // Loading overlay while the lobby becomes ready. The progress
  // readout is reset to a neutral state first — the Play path's last
  // 100% / "Entering world…" must not linger over a lobby wait.
  // (Callers ignore the returned promise; the try/finally below is
  // what guarantees the overlay hides.)
  const phase = $('loading-phase');
  if (phase) phase.textContent = 'Loading lobby…';
  const pct = $('loading-pct');
  if (pct) pct.textContent = '';
  const fill = $('loading-fill');
  if (fill) fill.style.width = '0%';
  $('loading-screen').classList.remove('hidden');
  // Minimum time on screen: the lobby is usually already ready when
  // quitting (its panorama built long ago), so awaiting lobbyReady
  // alone resolves in a microtask and no paint ever happens between
  // the show above and the hide in the finally — the overlay never
  // actually appeared. Hold it for at least a beat so leaving a world
  // always shows a loading screen.
  const minShow = new Promise((r) => setTimeout(r, 800));
  try {
    if (S.showLobby) S.showLobby();
    else $('lobby-screen').classList.remove('hidden');
    // When the panorama is still building, this waits for its first
    // frame. lobbyReady is also resolved (not left pending) if the
    // panorama build failed, so the overlay can never stick either.
    if (S.lobbyReady) await S.lobbyReady;
    await minShow;
  } finally {
    $('loading-screen').classList.add('hidden');
  }
}

// ---------- The Flipped + phone ----------
// Portal keypad: rendered into the shared shop panel, like the shop
// and vehicle-machine panels. The current dimension is not selectable.
function openPortalKeypad(machine, source) {
  openMousePanel(source);
  const panel = $('shop-panel');
  const dim = W?.dim || 'normal';
  panel.classList.remove('hidden');
  panel.innerHTML = `<h3>PORTAL CONTROL</h3><p class="fine">Select a dimension. A portal opens inside the claw frame — walk into it to travel. It closes behind you.</p>
    <div class="portal-dim${dim === 'normal' ? ' is-here' : ''}"><div><b>Normal World</b><span class="portal-flavor">Flourishing life, just as you left it.</span>${dim === 'normal' ? '<span class="portal-here">You are here</span>' : ''}</div><button class="btn small" ${dim === 'normal' ? 'disabled' : ''} data-dim="normal">Open portal</button></div>
    <div class="portal-dim${dim === 'flipped' ? ' is-here' : ''}"><div><b>The Flipped</b><span class="portal-flavor">Fire and darkness. The Darkened hunt there.</span>${dim === 'flipped' ? '<span class="portal-here">You are here</span>' : ''}</div><button class="btn small" ${dim === 'flipped' ? 'disabled' : ''} data-dim="flipped">Open portal</button></div>
    <button class="btn small ghost panel-close">Close</button>`;
  panel.querySelectorAll('[data-dim]').forEach((b) => b.onclick = () => {
    panel.classList.add('hidden');
    openPortal(b.dataset.dim, machine);
    requestGameLock();
  });
}
function openPortal(targetDim, machine) {
  // REDESIGNED 2026-10-29: the portal opens INSIDE the claw frame at
  // the machine's center (platform origin), not 2 units out from a
  // cabinet. Walk onto the platform and into the arch to travel.
  // Walk-in crossing logic (prevD > 1.4 into center < 1.0, armed gate)
  // is unchanged — it now measures from the frame center.
  spawnPortal(machine.x, machine.z, targetDim, machine);
  toast('Portal open — walk into it.');
}
function spawnPortal(x, z, targetDim, machine, facing) {
  closePortal();
  const group = new THREE.Group();
  const ringM = new THREE.MeshStandardMaterial({ color: 0x7a5cff, emissive: 0x7a5cff, emissiveIntensity: 1.6, roughness: 0.4 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.12, 10, 32), ringM);
  ring.position.y = 1.6; group.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.35, 32),
    new THREE.MeshStandardMaterial({ map: swirlTex(), transparent: true, opacity: 0.55, emissive: 0x7a5cff, emissiveIntensity: 0.8, side: THREE.DoubleSide }));
  disc.position.y = 1.6; group.add(disc);
  group.position.set(x, groundY(x, z), z);
  // FIXED 2026-10-29: the portal used to turn to face whoever opened
  // it, so it looked sideways. It now always faces straight out of
  // the machine's frame (the machine's own facing); a recalled portal
  // reuses the facing of the portal you came through.
  group.rotation.y = (typeof facing === 'number') ? facing : (machine && typeof machine.rotY === 'number' ? machine.rotY : 0);
  scene.add(group);
  // armedAt + prevD: walking in must be a real crossing, not standing
  // still where the portal happened to open — and not merely walking
  // near an open portal (the reported auto-teleport bug: the old
  // d<2.5 + moved>1 check fired for anyone passing within 2.5 units).
  portal = { group, x, z, targetDim, machine, armedAt: performance.now() + 1200, prevD: Math.hypot(P.pos.x - x, P.pos.z - z) };
}
function closePortal() {
  if (portal) { scene.remove(portal.group); portal = null; }
}
// Dimension travel reuses the proven Play path: save, cancel the loop,
// rebuild the world (mirrored for The Flipped), then land the player.
// Portals are never saved — the origin scene is discarded on switch,
// so a portal you walked through is closed behind you by construction.
async function switchDimension(dim, arrivePos) {
  if (!W || W.dim === dim) return;
  saveGame();
  if (RAF) { cancelAnimationFrame(RAF); RAF = null; }
  darkened = []; portal = null;
  $('phone-panel').classList.add('hidden');
  W.dim = dim;
  $('loading-screen').classList.remove('hidden');
  $('loading-phase').textContent = dim === 'flipped' ? 'Entering The Flipped…' : 'Returning home…';
  const fill = $('loading-fill'), pct = $('loading-pct');
  if (fill) fill.style.width = '0%';
  if (pct) pct.textContent = '0%';
  const onProgress = (label, frac) => {
    if (fill) fill.style.width = Math.round(frac * 100) + '%';
    if (pct) pct.textContent = Math.round(frac * 100) + '%';
    $('loading-phase').textContent = label;
  };
  try {
    await window.startGame(W, onProgress);
    if (arrivePos) P.pos.set(arrivePos.x, groundY(arrivePos.x, arrivePos.z) + 0.05, arrivePos.z);
    chatMsg('System', dim === 'flipped' ? 'You entered The Flipped.' : "You're home.", true);
  } catch (err) {
    // The pre-switch disk save is still intact; stop all further saves
    // so quitting from this broken state can't overwrite it. A refresh
    // restores a clean session and the intact save.
    console.error('Dimension travel failed:', err);
    travelFailed = true;
    toast('Travel failed — please refresh the page and try again.');
  } finally {
    $('loading-screen').classList.add('hidden');
  }
}
// Phone menu: opened by right-click while the phone's permanent slot
// is selected; right-click again while it is open closes it.
function openPhoneMenu() {
  document.exitPointerLock?.();
  const panel = $('phone-panel');
  const inFlipped = W?.dim === 'flipped';
  $('phone-status').textContent = inFlipped
    ? 'You are in The Flipped. Portal Recall calls a portal back to your arrival spot — or drags you home if you are far away.'
    : 'You are home. Use a portal command center to travel to The Flipped.';
  $('phone-recall').disabled = !inFlipped;
  panel.classList.remove('hidden');
  phoneOpenedAt = performance.now();
}
function closePhoneMenu() {
  $('phone-panel').classList.add('hidden');
  requestGameLock();
}
function doPhoneRecall() {
  if (W?.dim !== 'flipped') { toast('You are home — use a command center to travel.'); return; }
  const a = W.arrival;
  if (!a) { toast('No arrival point recorded — walk through a portal first.'); return; }
  const d = Math.hypot(P.pos.x - a.x, P.pos.z - a.z);
  closePhoneMenu();
  if (d > 20) {
    // Dragged through from anywhere, as Liam specified: no trek back.
    $('loading-screen').classList.remove('hidden');
    $('loading-phase').textContent = 'Called back…';
    // Guard: if the player quit to the lobby during the beat, the
    // recall must not resurrect the game.
    setTimeout(() => { if (started) switchDimension('normal', { x: W.home?.x ?? P.pos.x, z: (W.home?.z ?? P.pos.z) + 2 }); }, 700);
  } else {
    spawnPortal(a.x, a.z, 'normal', null, W.lastPortalFacing);
    toast('Portal reopened at your arrival spot — walk in.');
  }
}
// ---------- The Darkened ----------
// Shadow selves: the player's own character, every material near-black
// except the eyes, which glow white (eye meshes sit at y 1.90, z 0.215
// on the face — see character.js).
function spawnDarkened() {
  const ang = Math.random() * Math.PI * 2;
  const dist = 30 + Math.random() * 30;
  const x = P.pos.x + Math.cos(ang) * dist, z = P.pos.z + Math.sin(ang) * dist;
  const h = groundY(x, z);
  if (h < 0.8) return; // never in water
  const group = buildCharacter(S.char);
  const shadowM = new THREE.MeshStandardMaterial({ color: 0x0a0a14, roughness: 1 });
  const eyeM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 });
  group.traverse((m) => {
    if (!m.isMesh) return;
    if (Math.abs(m.position.y - 1.90) < 0.01 && Math.abs(m.position.z - 0.215) < 0.01) m.material = eyeM;
    else m.material = shadowM;
  });
  group.position.set(x, h, z);
  group.rotation.y = Math.atan2(P.pos.x - x, P.pos.z - z);
  scene.add(group);
  darkened.push({ group, hp: 12, lastHit: 0, poisonUntil: 0, poisonAcc: 0 });
  chatMsg('System', 'Something moves in the dark…', true);
}
function killDarkened(d) {
  scene.remove(d.group);
  darkened = darkened.filter((x) => x !== d);
  dropItem('shadow_sword', 1, d.group.position.x, d.group.position.z);
  chatMsg('System', 'The Darkened dropped a Shadow Sword! Right-click it to pick it up.', true);
}
function hitDarkened(d) {
  const sel = selectedItem();
  const power = sel ? (ITEMS[sel.id]?.power ?? 0.5) : 0.5;
  triggerSwing();
  d.hp -= power;
  if (sel && sel.id === 'shadow_sword') {
    if (d.poisonUntil < performance.now()) toast('The Darkened is poisoned!');
    d.poisonUntil = performance.now() + 5000;
  }
  if (sel) damageTool(sel);
  if (d.hp <= 0) killDarkened(d);
}
function updateDarkened(dt) {
  const now = performance.now();
  for (let i = darkened.length - 1; i >= 0; i--) {
    const d = darkened[i];
    // Shadow Sword poison: 1 damage per second for 5 seconds.
    if (d.poisonUntil > now) {
      d.poisonAcc += dt;
      if (d.poisonAcc >= 1) {
        d.poisonAcc = 0; d.hp -= 1;
        if (d.hp <= 0) { killDarkened(d); continue; }
      }
    }
    const dx = P.pos.x - d.group.position.x, dz = P.pos.z - d.group.position.z;
    const dist = Math.hypot(dx, dz);
    d.group.rotation.y = Math.atan2(dx, dz);
    // Chase within 50 units at speed 5 — slower than walk (6) and
    // sprint (10), so you can always escape.
    if (dist < 50 && !P.dead && dist > 0.01) {
      d.group.position.x += (dx / dist) * 5 * dt;
      d.group.position.z += (dz / dist) * 5 * dt;
      d.group.position.y = groundY(d.group.position.x, d.group.position.z);
    }
    if (dist < 2.5 && !P.dead && now - d.lastHit > 1200) {
      d.lastHit = now;
      hurt(8, 'Darkened');
    }
  }
}
// Per-frame Flipped work: rare Darkened spawns (max 2) and portal
// walk-ins, in either dimension. Paused games don't spawn or travel.
function updateFlipped(dt) {
  if (!started || pauseOpen) return;
  if (W?.dim === 'flipped') {
    darkenedTimer -= dt;
    if (darkenedTimer <= 0) {
      darkenedTimer = 90 + Math.random() * 60;
      if (darkened.length < 2) spawnDarkened();
    }
    updateDarkened(dt);
  }
  if (portal && !P.dead) {
    const d = Math.hypot(P.pos.x - portal.x, P.pos.z - portal.z);
    // Crossing check (armed-gated): travel only when the player steps
    // from OUTSIDE the ring (prevD > 1.4) INTO the disc center (d < 1.0).
    // Walking near an open portal, or standing in its neighborhood,
    // never triggers travel on its own.
    if (performance.now() > portal.armedAt && portal.prevD > 1.4 && d < 1.0) {
      const targetDim = portal.targetDim;
      if (targetDim === 'flipped') {
        W.arrival = { x: portal.x, z: portal.z };
        W.home = portal.machine ? { x: portal.machine.x, z: portal.machine.z } : W.home;
      }
      const arrive = targetDim === 'flipped'
        ? { x: P.pos.x, z: P.pos.z }
        : { x: W.home?.x ?? P.pos.x, z: (W.home?.z ?? P.pos.z) + 2 };
      // Remember this portal's facing so a phone recall reopens the
      // return portal facing the same straight way (not at the player).
      W.lastPortalFacing = portal.group.rotation.y;
      switchDimension(targetDim, arrive);
    }
    // Track the crossing every frame (even while arming), guarded in
    // case travel just cleared the portal.
    if (portal) portal.prevD = d;
  }
}

// ---------- Loop ----------
function loop() {
  RAF = requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  // The Flipped is frozen at night — its clock never advances.
  if (W?.dim !== 'flipped') time += dt;
  updateDayNight(dt);
  if (!P.dead) {
    if (driving) updateDriving(dt);
    else updatePlayer(dt);
  }
  updateCrops(dt);
  updateDrops(dt);
  updateCarsVisual(dt);
  updateLidAnims();
  updateFlipped(dt);
  updateHUDDynamic();
  // Sun follows player for shadows
  const sun = scene.userData.sun;
  sun.position.copy(P.pos).add(new THREE.Vector3(40, 70, 20));
  sun.target.position.copy(P.pos);
  // Sky dome follows the player (x/z): the island radius (~1075) now
  // exceeds the dome radius (700), so a static dome would leave a
  // player at the edge standing outside it. Centered on the player,
  // the dome always surrounds the camera, and the far plane below
  // covers island diameter (2150) + dome radius (700) with margin.
  const sky = scene.userData.sky;
  if (sky) sky.position.set(P.pos.x, 0, P.pos.z);
  renderer.render(scene, camera);
  saveTimer += dt;
  if (saveTimer > 10) { saveTimer = 0; saveGame(); }
}

// ---------- Day / night ----------
function updateDayNight() {
  const t = time % 1800;
  const hour = (t / 1800) * 24;
  P.day = Math.floor(time / 1800) + 1;
  let dayness = hour > 6 && hour < 19 ? 1 : hour >= 5 && hour <= 6 ? (hour - 5) : hour >= 19 && hour <= 20 ? (20 - hour) : 0;
  let dusk = (hour >= 5 && hour <= 7) ? 1 - Math.abs(hour - 6) : (hour >= 18 && hour <= 20) ? 1 - Math.abs(hour - 19) : 0;
  // The Flipped: frozen night, no dawn or dusk — fire and darkness.
  if (W?.dim === 'flipped') { dayness = 0; dusk = 0; }
  const sky = scene.userData.sky;
  if (sky) {
    sky.material.uniforms.topColor.value.set(0x050914).lerp(new THREE.Color(0x3d7ac8), dayness);
    sky.material.uniforms.horizonColor.value.set(0x0e1626).lerp(new THREE.Color(0xcfe4f5), dayness);
    if (dusk > 0) sky.material.uniforms.horizonColor.value.lerp(new THREE.Color(0xffb37a), dusk * 0.55);
    scene.fog.color.copy(sky.material.uniforms.horizonColor.value);
  }
  scene.userData.sun.intensity = 0.25 + dayness * 1.3;
  scene.userData.sun.color.set(0xfff2cc).lerp(new THREE.Color(0xff9a4d), dusk * 0.7);
  if (W?.dim === 'flipped') scene.userData.sun.color.set(0xff6a1a); // fire-orange sun
  if (scene.userData.hemi) scene.userData.hemi.intensity = 0.35 + dayness * 0.6;
  // No day display in the HUD — the top right stays clean by design.
  // Hunger drain + regen
  P.hunger = Math.max(0, P.hunger - 0.05 * (1 / 60) * 60 * 0.016); // ~1 per 20s, frame-rate independent-ish
}
// Mirror helper: in The Flipped the world is mirrored in X, so every
// terrain query must sample the unmirrored coordinate — the mirrored
// terrain's height/biome at (x, z) is the original's at (-x, z).
const mx = (x) => (W && W.dim === 'flipped') ? -x : x;
function groundY(x, z, yHint) {
  const h = heightAt(mx(x), z, W.seed);
  // Caves REMOVED (2026-10-28): mountains are solid, so ground is just
  // the heightmap. yHint is kept in the signature for callers that
  // still pass it, but no longer changes anything.
  return Math.max(h, -0.35); // wade in shallows; deep water just floors out in v1
}

// ---------- Player ----------
function updatePlayer(dt) {
  const kb = S.keybinds;
  // Crouch: hold Alt — lower eye, slower walk, beats sprint. Sprint:
  // Shift, or a double-tap of forward held down (see bindInput).
  const crouching = keys['AltLeft'] || keys['AltRight'];
  const sprinting = !crouching && (keys['ShiftLeft'] || keys['ShiftRight'] || (doubleTapSprint && keys[kb.forward]));
  const speed = crouching ? 4 : sprinting ? 10.0 : 6;
  // Smooth eye height + sprint FOV zoom-out (base 62, sprint 70) so both
  // transitions glide instead of snapping.
  curEyeH += ((crouching ? 1.05 : 1.65) - curEyeH) * Math.min(1, dt * 10);
  const fovTarget = sprinting ? 70 : 62;
  if (Math.abs(camera.fov - fovTarget) > 0.05) {
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 8);
    camera.updateProjectionMatrix();
  }
  let fx = 0, fz = 0;
  if (keys[kb.forward]) fz -= 1;
  if (keys[kb.back]) fz += 1;
  if (keys[kb.left]) fx -= 1;
  if (keys[kb.right]) fx += 1;
  const sin = Math.sin(P.yaw), cos = Math.cos(P.yaw);
  let mx = 0, mz = 0;
  if (fx || fz) {
    const len = Math.hypot(fx, fz);
    // facing = (-sin yaw, -cos yaw); right = (cos yaw, -sin yaw)
    mx = (fz * sin + fx * cos) / len * speed;
    mz = (fz * cos - fx * sin) / len * speed;
  }
  // Water does NOT slow walking anymore (swimming/drowning stay v2).
  P.pos.x += mx * dt;
  P.pos.z += mz * dt;
  collideWorld();
  // Vertical — grounded on the heightmap every frame, with the player's
  // own height as the cave hint, so no spot (slopes, cliffs, cave
  // mounds) lets the player fall or clip through the ground.
  const g = groundY(P.pos.x, P.pos.z, P.pos.y);
  if (!P.onGround) {
    P.vel.y -= 22 * dt;
    P.pos.y += P.vel.y * dt;
    if (P.pos.y <= g) {
      const fallH = P.fallStart - g;
      P.pos.y = g; P.vel.y = 0; P.onGround = true;
      if (fallH > 3.5) {
        const dmg = Math.round((fallH - 3.5) * 6);
        hurt(dmg, 'the fall');
      }
    }
  } else {
    P.pos.y = g;
    if (keys[kb.jump]) { P.vel.y = 8.5; P.onGround = false; P.fallStart = P.pos.y; }
  }
  if (P.pos.y > g + 0.1 && P.onGround) { P.onGround = false; P.fallStart = P.pos.y; }
  // Regen at full hunger
  if (P.hunger >= 95 && P.hp < 100) P.hp = Math.min(100, P.hp + dt * 0.8);
  if (P.hunger <= 0) P.hp = Math.max(1, P.hp - dt * 0.5);
  // Character mesh stays hidden (first person) — keep position synced for
  // anything that references the player group (sun follow uses P.pos)
  player.position.copy(P.pos);
  player.rotation.y = P.yaw + Math.PI;
  // Camera: FIRST PERSON — head height, mouse look, no third-person orbit
  camera.position.set(P.pos.x, P.pos.y + curEyeH, P.pos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(P.pitch, P.yaw, 0);
  updateViewmodel();
  updateTargetPrompt();
  updateGhost();
}
function collideWorld() {
  const r = 0.45;
  for (const t of world.trees) {
    const dx = P.pos.x - t.x, dz = P.pos.z - t.z;
    const d = Math.hypot(dx, dz);
    if (d < t.radius + r && d > 0.001) { P.pos.x = t.x + dx / d * (t.radius + r); P.pos.z = t.z + dz / d * (t.radius + r); }
  }
  for (const rk of world.rocks) {
    const dx = P.pos.x - rk.x, dz = P.pos.z - rk.z;
    const d = Math.hypot(dx, dz);
    if (d < rk.radius + r && d > 0.001) { P.pos.x = rk.x + dx / d * (rk.radius + r); P.pos.z = rk.z + dz / d * (rk.radius + r); }
  }
  for (const p of placed) {
    if (p.type === 'floor') continue;
    // Portal command center: its platform is a step you must stand on
    // to walk into the arch — the 2D box used to shove you off the
    // machine center no matter how high you jumped (2026-10-29).
    if (p.itemId === 'portal_command') continue;
    const dx = P.pos.x - p.x, dz = P.pos.z - p.z;
    const hw = p.type === 'wall' ? 1.6 : 1.1, hd = p.type === 'wall' ? 0.5 : 1.1;
    if (Math.abs(dx) < hw + r && Math.abs(dz) < hd + r) {
      if (Math.abs(dx) - hw < Math.abs(dz) - hd) P.pos.x = p.x + Math.sign(dx || 1) * (hw + r);
      else P.pos.z = p.z + Math.sign(dz || 1) * (hd + r);
    }
  }
}
function hurt(dmg, cause) {
  P.hp -= dmg;
  updateHUD();
  if (P.hp <= 0) die(cause);
}
function die(cause) {
  P.dead = true;
  chatMsg('System', `You died (${cause}). Respawning at the gold bench…`, true);
  if (!W.keepInv) {
    for (const s of [...P.inv, ...P.hotbar]) {
      if (s) dropItem(s.id, s.n, P.pos.x + (Math.random() - 0.5) * 3, P.pos.z + (Math.random() - 0.5) * 3);
    }
    P.inv = []; P.hotbar = [];
  }
  setTimeout(() => {
    const sp = world.spawn;
    P.pos.set(sp.x, sp.y, sp.z);
    P.hp = 100; P.hunger = Math.max(P.hunger, 60); P.dead = false;
    updateHUD();
    centerToast('Respawned at the gold bench');
  }, 1500);
}
function dropMeshFor(id) {
  // Dropped items used to be one generic gold box for everything. Each
  // item now drops as a small recognizable prop (visual only — pickup
  // radius, ttl, and spin behavior are unchanged).
  const g = new THREE.Group();
  const M = (c, r = 0.8, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const bx = (w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.castShadow = true; g.add(mesh); return mesh;
  };
  const cyl = (rt, rb, h, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 10) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.castShadow = true; g.add(mesh); return mesh;
  };
  const sph = (r, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat);
    mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.castShadow = true; g.add(mesh); return mesh;
  };
  // Shared textured materials (cached by dropTexMat): a held sword and
  // its dropped sword now match, and drops stop minting flat materials.
  const wood = dropTexMat(woodTex(), 0xffffff), woodDk = dropTexMat(woodTex(), 0x999999), steel = dropTexMat(steelTex(), 0xffffff, 0.35, 0.6), steelDk = dropTexMat(steelTex(), 0x777777, 0.45, 0.6);
  switch (id) {
    case 'wood': { // lying log with end rings
      cyl(0.13, 0.13, 0.55, wood, 0, 0, 0, 0, 0, Math.PI / 2, 12);
      cyl(0.135, 0.135, 0.02, dropTexMat(woodLightTex(), 0xc8a87e), -0.28, 0, 0, 0, 0, Math.PI / 2, 12);
      cyl(0.135, 0.135, 0.02, dropTexMat(woodLightTex(), 0xc8a87e), 0.28, 0, 0, 0, 0, Math.PI / 2, 12);
      break; }
    case 'stone': case 'ground_stone': {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22), dropTexMat(stoneLightTex(), 0x8d8f94, 1));
      rock.scale.y = 0.75; rock.castShadow = true; g.add(rock); break; }
    case 'iron': bx(0.34, 0.12, 0.2, dropTexMat(steelTex(), 0x9aa0a8, 0.3, 0.85)); bx(0.26, 0.06, 0.16, dropTexMat(steelTex(), 0xc8ccd2, 0.25, 0.9), 0, 0.09, 0); break;
    case 'apple': sph(0.17, dropTexMat(appleTex(), 0xffffff, 0.5), 0, 0.02, 0); cyl(0.015, 0.02, 0.12, woodDk, 0.03, 0.2, 0, 0, 0, 0.3); bx(0.12, 0.02, 0.07, M(0x46a758, 0.7), 0.09, 0.2, 0, 0, 0, 0.4); break;
    case 'wheat': for (const sx of [-0.07, 0, 0.07]) { cyl(0.012, 0.012, 0.42, dropTexMat(wheatTex(), 0xffffff, 0.8), sx, 0.1, 0, 0, 0, sx * 1.2); bx(0.05, 0.16, 0.05, dropTexMat(wheatTex(), 0xffffff, 0.8), sx, 0.32, 0); } break;
    case 'carrot': { const c = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 8), dropTexMat(carrotTex(), 0xffffff, 0.7)); c.rotation.x = Math.PI; c.position.y = -0.02; g.add(c); bx(0.03, 0.16, 0.03, M(0x46a758, 0.7), 0, 0.2, 0, 0.3, 0, 0); bx(0.03, 0.14, 0.03, M(0x46a758, 0.7), 0.04, 0.19, 0, 0.2, 0, -0.4); break; }
    case 'seed_wheat': case 'seed_carrot': bx(0.3, 0.22, 0.06, M(0xd8cbb8, 0.9)); bx(0.3, 0.07, 0.065, M(id === 'seed_wheat' ? 0xe8c95a : 0xe87a1a, 0.8), 0, 0.05, 0); break;
    case 'leather': bx(0.42, 0.05, 0.3, dropTexMat(leatherTex(), 0xffffff, 0.95)); bx(0.3, 0.055, 0.2, dropTexMat(leatherTex(), 0xcccccc, 0.95), 0, 0.01, 0); break;
    case 'sandbag': sph(0.22, dropTexMat(weaveTex(), 0xd8c08a, 1), 0, 0, 0, 1.2, 0.6, 0.8); break;
    case 'snowbag': sph(0.22, dropTexMat(weaveTex(), 0xffffff, 0.9), 0, 0, 0, 1.2, 0.6, 0.8); break;
    case 'dirtbag': sph(0.22, dropTexMat(weaveTex(), 0x6b4a2f, 1), 0, 0, 0, 1.2, 0.6, 0.8); break;
    case 'glass': bx(0.34, 0.3, 0.04, new THREE.MeshStandardMaterial({ map: frostTex(), transparent: true, opacity: 0.6, roughness: 0.1 })); break;
    case 'ice': bx(0.3, 0.3, 0.3, new THREE.MeshStandardMaterial({ map: frostTex(), transparent: true, opacity: 0.85, roughness: 0.2 })); break;
    case 'money': cyl(0.16, 0.16, 0.05, dropTexMat(goldLightTex(), 0xf5c542, 0.35, 0.8), 0, 0, 0, Math.PI / 2.4, 0, 0, 16); break;
    case 'axe_wood': case 'axe_stone': bx(0.05, 0.5, 0.05, wood, 0, 0, 0, 0, 0, 0.5); bx(0.16, 0.14, 0.04, id === 'axe_wood' ? woodDk : steelDk, 0.12, 0.22, 0, 0, 0, 0.5); break;
    case 'pickaxe_wood': case 'pickaxe': bx(0.05, 0.5, 0.05, wood, 0, 0, 0, 0, 0, 0.5); bx(0.3, 0.05, 0.05, id === 'pickaxe_wood' ? woodDk : steel, 0, 0.24, 0, 0, 0, 0.5); break;
    case 'shovel': bx(0.05, 0.5, 0.05, wood, 0, 0.05, 0, 0, 0, 0.5); bx(0.16, 0.22, 0.03, steel, 0.1, -0.22, 0, 0, 0, 0.5); break;
    case 'hoe': bx(0.05, 0.5, 0.05, wood, 0, 0, 0, 0, 0, 0.5); bx(0.2, 0.12, 0.03, steel, 0.1, 0.22, 0, 0, 0, 0.5); break;
    case 'car_key': { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 14), dropTexMat(goldLightTex(), 0xf5c542, 0.35, 0.8)); ring.position.set(-0.1, 0.05, 0); g.add(ring); bx(0.2, 0.07, 0.04, dropTexMat(goldLightTex(), 0xf5c542, 0.35, 0.8), 0.08, 0.05, 0); bx(0.05, 0.05, 0.04, dropTexMat(goldLightTex(), 0xf5c542, 0.35, 0.8), 0.19, -0.02, 0); break; }
    case 'house_key': { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 14), dropTexMat(goldLightTex(), 0xd8b25a, 0.4, 0.7)); ring.position.set(-0.1, 0.05, 0); g.add(ring); bx(0.2, 0.07, 0.04, dropTexMat(goldLightTex(), 0xd8b25a, 0.4, 0.7), 0.08, 0.05, 0); break; }
    case 'backpack': bx(0.34, 0.4, 0.2, dropTexMat(weaveTex(), 0x6e56cf, 0.85)); bx(0.36, 0.1, 0.22, dropTexMat(weaveTex(), 0x5a45b0, 0.85), 0, 0.18, 0); break;
    case 'shadow_sword': { // tapered dark blade + purple eye at the guard
      bx(0.05, 0.4, 0.05, M(0x1a1a24, 0.6), 0, -0.05, 0, 0, 0, 0.5);
      const bl = swordBladeMesh(
        new THREE.MeshStandardMaterial({ map: shadowTex(), roughness: 0.35, metalness: 0.5 }),
        new THREE.MeshStandardMaterial({ color: 0xb07aff, emissive: 0x7a5cff, emissiveIntensity: 0.9 }), 0.30, 0.06);
      bl.position.set(0, 0.10, 0); bl.rotation.z = 0.5; g.add(bl);
      sph(0.05, new THREE.MeshStandardMaterial({ color: 0xb07aff, emissive: 0xb07aff, emissiveIntensity: 1.4 }), 0.02, 0.16, 0.03); break; }
    case 'sword_wood': case 'sword_stone': case 'sword_iron': { // grip + tapered blade, matching the held look
      const bladeMat = id === 'sword_wood'
        ? new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.8 })
        : id === 'sword_stone'
          ? new THREE.MeshStandardMaterial({ map: stoneLightTex(), color: 0x9aa0a8, roughness: 0.9 })
          : new THREE.MeshStandardMaterial({ map: steelTex(), roughness: 0.35, metalness: 0.6 });
      const edgeMat = id === 'sword_wood'
        ? new THREE.MeshStandardMaterial({ color: 0xc8a87e, roughness: 0.8 })
        : new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.25, metalness: 0.7 });
      bx(0.05, 0.4, 0.05, M(0x1a1a24, 0.6), 0, -0.05, 0, 0, 0, 0.5);
      const bl = swordBladeMesh(bladeMat, edgeMat, 0.30, 0.06);
      bl.position.set(0, 0.10, 0); bl.rotation.z = 0.5; g.add(bl); break; }
    case 'jerrycan': bx(0.3, 0.36, 0.16, dropTexMat(flakeTex(), 0xffffff, 0.6)); bx(0.16, 0.05, 0.05, M(0x1a1a1a, 0.7), 0, 0.2, 0); break;
    case 'chest': bx(0.44, 0.24, 0.28, wood); bx(0.44, 0.1, 0.28, woodDk, 0, 0.16, 0); break;
    case 'workbench': bx(0.5, 0.06, 0.3, wood, 0, 0.12, 0); bx(0.05, 0.24, 0.05, woodDk, -0.2, 0, 0.1); bx(0.05, 0.24, 0.05, woodDk, 0.2, 0, 0.1); break;
    case 'wall_wood': case 'wall_brick': case 'wall_steel': case 'wall_window': case 'wall_door': case 'wall_ice':
      bx(0.44, 0.44, 0.06, id === 'wall_brick' ? dropTexMat(brickTintedTex(), 0xffffff, 0.9)
        : id === 'wall_steel' ? dropTexMat(steelTex(), 0xffffff, 0.4, 0.6)
        : id === 'wall_ice' ? dropTexMat(frostTex(), 0xffffff, 0.9)
        : dropTexMat(woodTex(), 0xffffff, 0.9)); break;
    case 'floor': bx(0.44, 0.05, 0.44, wood); break;
    case 'roof': { const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.2, 4), dropTexMat(shingleTintedTex(), 0xffffff, 0.9)); cone.rotation.y = Math.PI / 4; cone.castShadow = true; g.add(cone); break; }
    default: bx(0.32, 0.32, 0.32, dropTexMat(goldLightTex(), 0xd8b25a, 0.8));
  }
  return g;
}
function dropItem(id, n, x, z) {
  const y = groundY(x, z) + 0.3;
  const mesh = dropMeshFor(id);
  mesh.position.set(x, y, z); scene.add(mesh);
  drops.push({ id, n, x, z, mesh, ttl: 600 });
}
function updateDrops(dt) {
  for (let i = drops.length - 1; i >= 0; i--) {
    drops[i].ttl -= dt;
    drops[i].mesh.rotation.y += dt;
    if (drops[i].ttl <= 0) { scene.remove(drops[i].mesh); drops.splice(i, 1); continue; }
    // No walk-over pickup anymore — right-click is the only way to pick a drop up.
  }
}

// ---------- Held-tool viewmodels (first person) ----------
// Round 3's single tiny generic model looked miserable, so each tool is
// now its own properly-proportioned, recognizable model, floating
// at a diagonal in the bottom-right of the view with NO hand — the
// tool floats on its own, no grip block (Liam: the hand looked weird).
let viewmodels = {};
let viewmodel = null; // back-compat handle used by the driving code
function vmBox(g, w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz);
  g.add(mesh); return mesh;
}
function buildViewmodel() {
  viewmodels = {};
  const woodM = new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.85 });
  const woodDark = new THREE.MeshStandardMaterial({ map: woodTex(), color: 0x999999, roughness: 0.9 });
  const steelM = new THREE.MeshStandardMaterial({ map: steelTex(), roughness: 0.35, metalness: 0.6 });
  const steelDark = new THREE.MeshStandardMaterial({ map: steelTex(), color: 0x777777, roughness: 0.45, metalness: 0.6 });
  // Held tools sit small in the bottom-right corner of the view — the
  // old 0.72-long models at z=-0.80 filled half the screen and read as
  // a giant gray slab. These are ~0.40 long, farther out and lower, with
  // slim heads (never a deep block), and their heads are tinted per
  // item (see updateViewmodel) so what you hold matches what the
  // inventory icon shows: wooden axe = red head like the axe icon,
  // stone tools = gray steel, wooden pickaxe = brown. Head material
  // uses LOW metalness: with no env map, high metalness shades colors
  // dark (the old gold-reading-brown bug), which made the red axe head
  // render brown.
  const mk = (px = 0.44, py = -0.48, pz = -1.12, rx = 0.12, ry = 0.10, rz = -0.38) => {
    const g = new THREE.Group();
    g.position.set(px, py, pz);
    g.rotation.set(rx, ry, rz); // held diagonal, like a real grip
    g.visible = false;
    g.userData.heads = []; // head meshes, tinted per selected item
    g.traverse((m) => { if (m.isMesh) m.castShadow = false; });
    camera.add(g);
    return g;
  };
  // Brushed map under the tint: the head color still matches the
  // inventory icon, but the steel now reads as brushed metal.
  const headMat = () => new THREE.MeshStandardMaterial({ map: steelTex(), color: 0xb8bcc2, roughness: 0.5, metalness: 0.15 });
  const headBox = (g, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
    if (!g.userData.headMat) g.userData.headMat = headMat();
    const m = vmBox(g, w, h, d, g.userData.headMat, x, y, z, rx, ry, rz);
    g.userData.heads.push(m);
    return m;
  };
  // Axe: brown haft, slim wedge head + flared blade (thin in z, so
  // it never reads as a slab from the camera)
  const axe = mk();
  vmBox(axe, 0.045, 0.40, 0.045, woodM, 0, 0.02, 0);
  vmBox(axe, 0.045, 0.07, 0.045, woodDark, 0, -0.185, 0); // butt cap
  headBox(axe, 0.045, 0.10, 0.05, 0, 0.26, 0); // wedge
  headBox(axe, 0.11, 0.13, 0.025, 0.055, 0.25, 0); // blade face
  headBox(axe, 0.06, 0.08, 0.045, -0.045, 0.26, 0); // poll
  viewmodels.axe = axe;
  // Pickaxe: haft + double-point head (two angled spikes + center)
  const pick = mk();
  vmBox(pick, 0.045, 0.40, 0.045, woodM, 0, 0.02, 0);
  vmBox(pick, 0.045, 0.07, 0.045, woodDark, 0, -0.185, 0);
  headBox(pick, 0.10, 0.07, 0.07, 0, 0.24, 0); // center
  headBox(pick, 0.14, 0.04, 0.04, -0.095, 0.235, 0, 0, 0, 0.35);
  headBox(pick, 0.14, 0.04, 0.04, 0.095, 0.235, 0, 0, 0, -0.35);
  viewmodels.pickaxe = pick;
  // Shovel: haft, D-grip, socket, broad spade blade — group raised and
  // blade shifted up so the spade stays inside the frame (an earlier
  // version hung below the bottom edge and only grip + haft showed).
  const shovel = mk(0.44, -0.32, -1.12, 0.18, 0.10, -0.40);
  vmBox(shovel, 0.04, 0.38, 0.04, woodM, 0, 0.01, 0);
  const dgrip = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.013, 6, 12), woodDark);
  dgrip.position.set(0, 0.24, 0); shovel.add(dgrip);
  headBox(shovel, 0.055, 0.07, 0.055, 0, -0.12, 0); // socket
  headBox(shovel, 0.14, 0.18, 0.02, 0, -0.23, 0); // spade blade
  headBox(shovel, 0.10, 0.06, 0.022, 0, -0.34, 0); // blade tip
  viewmodels.shovel = shovel;
  // Hoe: haft + angled neck + wide flat cross blade (clearly a hoe,
  // not an axe head)
  const hoe = mk();
  vmBox(hoe, 0.04, 0.40, 0.04, woodM, 0, 0.02, 0);
  vmBox(hoe, 0.04, 0.07, 0.04, woodDark, 0, -0.185, 0);
  headBox(hoe, 0.04, 0.10, 0.04, 0, 0.225, 0.035, 0.5, 0, 0); // neck
  headBox(hoe, 0.22, 0.10, 0.022, 0, 0.25, 0.095, 0.5, 0, 0); // blade
  viewmodels.hoe = hoe;
  // Ground stone: a ROCK, not a pickaxe — a craggy gray dodecahedron
  // like the rocks on the ground, so the held fallback never reads as
  // a stone pickaxe.
  const rock = mk(0.44, -0.42, -1.05, 0.15, 0.25, -0.20);
  const rockMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16),
    new THREE.MeshStandardMaterial({ map: stoneLightTex(), color: 0x6e7073, roughness: 1 }));
  rockMesh.scale.y = 0.78;
  rock.add(rockMesh);
  viewmodels.rock = rock;
  // Foods: held food shows an actual food model — foods have no tool
  // type, so updateViewmodel used to show nothing at all when one was
  // held. Same bottom-right framing as the tools.
  const apple = mk(0.44, -0.42, -1.05, 0.15, 0.10, -0.15);
  const appleMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10),
    new THREE.MeshStandardMaterial({ map: appleTex(), roughness: 0.55 }));
  appleMesh.scale.y = 0.92; apple.add(appleMesh);
  vmBox(apple, 0.02, 0.08, 0.02, woodDark, 0, 0.13, 0); // stem
  viewmodels.apple = apple;
  // Carrot: orange point-down cone + green leafy top
  const carrot = mk(0.44, -0.42, -1.05, 0.15, 0.10, -0.15);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 8),
    new THREE.MeshStandardMaterial({ map: carrotTex(), roughness: 0.7 }));
  cone.rotation.x = Math.PI; carrot.add(cone);
  const leafM = new THREE.MeshStandardMaterial({ color: 0x3d7a32, roughness: 0.8 });
  vmBox(carrot, 0.025, 0.12, 0.025, leafM, 0, 0.17, 0);
  vmBox(carrot, 0.025, 0.10, 0.025, leafM, 0.04, 0.15, 0, 0, 0, 0.4);
  vmBox(carrot, 0.025, 0.10, 0.025, leafM, -0.04, 0.15, 0, 0, 0, -0.4);
  viewmodels.carrot = carrot;
  // Wheat: three golden stalks with grain heads
  const wheat = mk(0.44, -0.42, -1.05, 0.15, 0.10, -0.15);
  const stalkM = new THREE.MeshStandardMaterial({ map: wheatTex(), roughness: 0.8 });
  const grainM = new THREE.MeshStandardMaterial({ map: wheatTex(), roughness: 0.8 });
  for (const [x, h] of [[-0.05, 0.30], [0, 0.36], [0.05, 0.30]]) {
    vmBox(wheat, 0.02, h, 0.02, stalkM, x, 0, 0);
    vmBox(wheat, 0.05, 0.09, 0.05, grainM, x, h / 2 + 0.05, 0);
  }
  viewmodels.wheat = wheat;
  // Phone: small dark slab with a glowing purple screen.
  const phone = mk(0.44, -0.42, -1.05, 0.15, 0.10, -0.15);
  vmBox(phone, 0.16, 0.30, 0.03, new THREE.MeshStandardMaterial({ map: phoneTex(), roughness: 0.4 }), 0, 0, 0);
  vmBox(phone, 0.13, 0.20, 0.035, new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.3, emissive: 0x7a5cff, emissiveIntensity: 0.5 }), 0, 0.02, 0);
  viewmodels.phone = phone;
  // Shadow Sword: dark blade, dark grip, and a purple eye where the
  // handle meets the blade — exactly as Liam described it.
  const ss = mk();
  vmBox(ss, 0.045, 0.30, 0.045, woodDark, 0, -0.05, 0); // grip
  vmBox(ss, 0.16, 0.05, 0.05, new THREE.MeshStandardMaterial({ color: 0x3a3a4a, roughness: 0.5, metalness: 0.4 }), 0, 0.13, 0); // guard
  // Tapered blade + glowing edge ridge: no more flat rectangle.
  const ssBlade = swordBladeMesh(
    new THREE.MeshStandardMaterial({ map: shadowTex(), roughness: 0.35, metalness: 0.5 }),
    new THREE.MeshStandardMaterial({ color: 0xb07aff, emissive: 0x7a5cff, emissiveIntensity: 0.9 }));
  ssBlade.position.set(0, 0.15, 0); ss.add(ssBlade);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xb07aff, emissive: 0xb07aff, emissiveIntensity: 1.6 }));
  eye.position.set(0, 0.13, 0.035); ss.add(eye);
  viewmodels.shadow_sword = ss;
  // Crafted swords: same framing as the Shadow Sword, blade material
  // per tier so held wood/stone/iron read apart at a glance.
  const mkSword = (key, bladeMat, edgeMat) => {
    const s = mk();
    vmBox(s, 0.045, 0.30, 0.045, woodDark, 0, -0.05, 0); // grip
    vmBox(s, 0.16, 0.05, 0.05, steelDark, 0, 0.13, 0); // guard
    const b = swordBladeMesh(bladeMat, edgeMat);
    b.position.set(0, 0.15, 0); s.add(b);
    viewmodels[key] = s;
  };
  mkSword('sword_wood',
    new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0xc8a87e, roughness: 0.8 }));
  mkSword('sword_stone',
    new THREE.MeshStandardMaterial({ map: stoneLightTex(), color: 0x9aa0a8, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.4, metalness: 0.3 }));
  mkSword('sword_iron',
    new THREE.MeshStandardMaterial({ map: steelTex(), roughness: 0.35, metalness: 0.6 }),
    new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.25, metalness: 0.7 }));
  for (const g of Object.values(viewmodels)) g.traverse((m) => { if (m.isMesh) m.castShadow = false; });
  // Back-compat: old code references `viewmodel` for driving visibility
  viewmodel = { set visible(v) { for (const g of Object.values(viewmodels)) g.visible = v && g.userData.active; }, get visible() { return false; } };
}
function triggerSwing() {
  swingStart = performance.now();
}
function updateViewmodel() {
  const sel = selectedItem();
  // The ground stone's viewmodel is the rock, not the axe — its tool
  // type is 'axe' (it chops), but what you hold must look like a rock.
  // Foods have their own viewmodels keyed by item id (they have no
  // tool type, so without this nothing showed when one was held).
  const vmKey = sel ? (sel.id === 'ground_stone' ? 'rock' : (viewmodels[sel.id] ? sel.id : ITEMS[sel.id]?.tool)) : null;
  const show = !driving && !buildMode && !!vmKey && viewmodels[vmKey];
  // Head color matches the inventory identity: wooden axe = red head
  // like its axe icon, stone tools = gray steel, wooden pickaxe = brown.
  const HEAD_COLORS = { axe_wood: 0xc8452f, axe_stone: 0xb8bcc2, pickaxe_wood: 0x8a5a2b, pickaxe: 0xb8bcc2, shovel: 0xb8bcc2, hoe: 0xb8bcc2 };
  if (sel && viewmodels[vmKey] && viewmodels[vmKey].userData.headMat) {
    viewmodels[vmKey].userData.headMat.color.set(HEAD_COLORS[sel.id] ?? 0xb8bcc2);
  }
  // Item-use animation: a swing is a visible raise-and-strike over
  // ~0.35s, applied to whichever tool is held. Without this the tool
  // just sat static while chopping/mining.
  const swingP = swingStart ? Math.min(1, (performance.now() - swingStart) / swingDur) : 1;
  const swingCurve = swingP < 1 ? Math.sin(swingP * Math.PI) : 0;
  for (const [k, g] of Object.entries(viewmodels)) {
    g.userData.active = (k === vmKey);
    g.visible = !!show && k === vmKey;
    if (g.visible) {
      // Base pose is set at build time (mk rotation); the swing adds a
      // downward chop rotation and a small dip, then settles back.
      const base = g.userData.baseRot || (g.userData.baseRot = g.rotation.clone());
      const basePos = g.userData.basePos || (g.userData.basePos = g.position.clone());
      g.rotation.x = base.x - swingCurve * 0.85;
      g.rotation.z = base.z + swingCurve * 0.15;
      g.position.y = basePos.y - swingCurve * 0.07;
    }
  }
}

// ---------- Targeting ----------
let target = null;
function findTarget() {
  // Interaction rule: BOTH proximity AND aim. A target only counts when
  // you are close enough AND the crosshair ray actually passes through
  // the object's bounds — no interacting from across the room or while
  // facing away. Ray-sphere test: the eye ray must pass within the
  // object's radius, and the object must be within reach.
  const maxD = 5;
  const fx = -Math.sin(P.yaw) * Math.cos(P.pitch), fy = Math.sin(P.pitch), fz = -Math.cos(P.yaw) * Math.cos(P.pitch);
  const eye = new THREE.Vector3(P.pos.x, P.pos.y + curEyeH, P.pos.z);
  const dir = new THREE.Vector3(fx, fy, fz);
  let best = null, bestT = maxD;
  const consider = (cx, cy, cz, radius, data) => {
    const vx = cx - eye.x, vy = cy - eye.y, vz = cz - eye.z;
    const t = vx * dir.x + vy * dir.y + vz * dir.z;
    if (t < 0.3 || t > bestT) return; // behind you, or out of reach
    const px = eye.x + dir.x * t, py = eye.y + dir.y * t, pz = eye.z + dir.z * t;
    const pd = Math.hypot(cx - px, cy - py, cz - pz);
    if (pd > radius) return; // crosshair isn't on it
    bestT = t; best = { ...data, dist: t };
  };
  for (const t of world.trees) {
    // Whole-tree targeting (2026-10-29: one sphere at 0.6*trunkH meant
    // only the trunk middle registered — base and canopy were dead).
    // Spheres spaced along the trunk (never more than ~1.6 apart, so
    // no trunk point is farther than the radius from a center), plus
    // one canopy sphere over the foliage.
    const tr = Math.max(1.0, 1.1 * (t.scale || 1));
    const n = Math.max(2, Math.ceil(t.trunkH / 1.6));
    for (let i = 0; i < n; i++) consider(t.x, t.h + (i + 0.5) * t.trunkH / n, t.z, tr, { kind: 'tree', ref: t });
    consider(t.x, t.h + t.trunkH + 1.2 * (t.scale || 1), t.z, Math.max(1.5, 1.7 * (t.scale || 1)), { kind: 'tree', ref: t });
  }
  for (const r of world.rocks) consider(r.x, r.h + 0.6, r.z, (r.radius || 0.7) + 0.35, { kind: 'rock', ref: r });
  for (const s of world.groundStones) consider(s.x, s.h + 0.2, s.z, 0.55, { kind: 'groundstone', ref: s });
  // Loot chests stay targetable after opening, so you can reopen one
  // to take leftovers or put your own items back in.
  for (const c of world.chests) consider(c.x, c.h + 0.6, c.z, 1.0, { kind: 'chest', ref: c });
  for (const it of world.interactables) {
    const rad = it.type === 'goldbench' ? 1.7 : it.type === 'shop' ? 2.4 : 1.9;
    consider(it.x, groundY(it.x, it.z) + 1, it.z, rad, { kind: it.type, ref: it });
  }
  for (const p of placed) {
    consider(p.x, p.y + 1, p.z, 1.6, { kind: 'placed', ref: p });
    // Portal command center: the control pad sits 2.6 units to the
    // side, outside the 1.6 body sphere — aiming at it registered
    // nothing (2026-10-29). The pad gets its own target so pressing
    // the console opens the keypad, like the machine body does.
    if (p.itemId === 'portal_command') {
      const ry = p.rotY || 0, cx = Math.cos(ry), sx = Math.sin(ry);
      // Local pad offset (2.60, 0.30) rotated by the piece facing:
      // local +x -> (cos, -sin), local +z -> (sin, cos).
      consider(p.x + 2.60 * cx + 0.30 * sx, p.y + 0.8, p.z - 2.60 * sx + 0.30 * cx, 0.9, { kind: 'placed', ref: p });
    }
  }
  for (const d of darkened) consider(d.group.position.x, d.group.position.y + 1.1, d.group.position.z, 1.2, { kind: 'darkened', ref: d });
  for (const car of cars) if (!car.broken) consider(car.group.position.x, car.group.position.y + 0.8, car.group.position.z, 2.1, { kind: 'car', ref: car });
  for (const pl of crops) consider(pl.x, groundY(pl.x, pl.z) + 0.3, pl.z, 0.65, { kind: 'crop', ref: pl });
  for (const d of drops) consider(d.x, d.mesh.position.y + 0.2, d.z, 0.8, { kind: 'drop', ref: d });
  // Ground digging (shovel only): when no object target is closer and
  // the shovel is held, the terrain ground itself becomes the target.
  // Digging never alters the terrain mesh — it only grants a bag.
  if (!best) {
    const sel = selectedItem();
    if (sel && ITEMS[sel.id]?.tool === 'shovel') {
      const cell = groundDigCell();
      if (cell && isDiggableCell(cell.x, cell.z)) best = { kind: 'ground', x: cell.x, z: cell.z, y: cell.y };
    }
  }
  return best;
}
// ---------- Digging (shovel) ----------
// Yield by biome: desert sand, snowy-mountain tops snow, any other
// natural walkable dirt plain dirt. 'snowy' from biomeAt already means
// high elevation (h > 17), i.e. the mountain tops, not low snowy ground.
function digYield(x, z) {
  const b = biomeAt(mx(x), z, W.seed);
  if (b === 'desert') return 'sandbag';
  if (b === 'snowy') return 'snowbag';
  return 'dirtbag';
}
function digYieldLabel(id) { return id === 'sandbag' ? 'Sand' : id === 'snowbag' ? 'Snow' : 'Dirt'; }
// True only for natural walkable dirt: never water/shore, never ground
// under a generated-structure footprint (interactables) or a placed
// piece, never a planted crop plot.
function isDiggableCell(x, z) {
  if (heightAt(mx(x), z, W.seed) < 0.3) return false; // water, same convention as build placement
  for (const it of world.interactables) {
    const rad = (it.radius || 3) + 1;
    if (Math.hypot(it.x - x, it.z - z) < rad) return false;
  }
  for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < 1.6) return false;
  for (const c of crops) if (Math.hypot(c.x - x, c.z - z) < 1) return false;
  return true;
}
function groundDigCell() {
  // March the look ray to the ground (max 5, same reach as objects).
  const fx = -Math.sin(P.yaw) * Math.cos(P.pitch), fy = Math.sin(P.pitch), fz = -Math.cos(P.yaw) * Math.cos(P.pitch);
  const ex = P.pos.x, ey = P.pos.y + curEyeH, ez = P.pos.z;
  for (let d = 0.5; d <= 5; d += 0.25) {
    const x = ex + fx * d, y = ey + fy * d, z = ez + fz * d;
    if (y <= groundY(x, z) + 0.15) {
      const rx = Math.round(x), rz = Math.round(z);
      return { x: rx, z: rz, y: groundY(rx, rz) };
    }
  }
  return null;
}
function digGround(cell, toolSlot) {
  if (!isDiggableCell(cell.x, cell.z)) return; // never pay out on excluded ground
  const id = digYield(cell.x, cell.z);
  dropItem(id, 1, cell.x, cell.z); // drops never fail on a full inventory — the bag just sits there
  damageTool(toolSlot);
  updateHUD();
}
function targetBasePos(t) {
  // Ground position + radius for the highlight ring.
  switch (t.kind) {
    case 'tree': return { x: t.ref.x, z: t.ref.z, r: Math.max(0.9, (t.ref.radius || 0.6) + 0.5) };
    case 'rock': return { x: t.ref.x, z: t.ref.z, r: (t.ref.radius || 0.7) + 0.5 };
    case 'groundstone': return { x: t.ref.x, z: t.ref.z, r: 0.55 };
    case 'drop': return { x: t.ref.x, z: t.ref.z, r: 0.6 };
    case 'chest': return { x: t.ref.x, z: t.ref.z, r: 1.1 };
    case 'car': return { x: t.ref.group.position.x, z: t.ref.group.position.z, r: 2.4 };
    case 'darkened': return { x: t.ref.group.position.x, z: t.ref.group.position.z, r: 1.2 };
    case 'ground': return { x: t.x, z: t.z, r: 0.7 };
    case 'placed': return { x: t.ref.x, z: t.ref.z, r: 1.8 };
    case 'crop': return { x: t.ref.x, z: t.ref.z, r: 0.7 };
    default: return { x: t.ref.x, z: t.ref.z, r: 1.8 };
  }
}
function updateTargetPrompt() {
  if (buildMode || driving) {
    $('interact-prompt').classList.add('hidden');
    $('crosshair').classList.remove('target');
    if (targetRing) targetRing.visible = false;
    target = null; return;
  }
  target = findTarget();
  const el = $('interact-prompt');
  if (target) {
    // No text prompt: Liam asked to remove the little hint texts for
    // everything. The crosshair glow + ground ring still mark the
    // target; only the words are gone.
    el.classList.add('hidden');
    $('crosshair').classList.add('target'); // crosshair glows only on a valid target
    // Highlight ring on the ground around the target, so it is
    // unmistakable what you are aiming at.
    if (!targetRing) {
      targetRing = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1, 40),
        new THREE.MeshBasicMaterial({ color: 0x57e32e, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
      targetRing.rotation.x = -Math.PI / 2;
      scene.add(targetRing);
    }
    const bp = targetBasePos(target);
    targetRing.position.set(bp.x, groundY(bp.x, bp.z) + 0.08, bp.z);
    targetRing.scale.setScalar(bp.r);
    targetRing.visible = true;
  } else {
    el.classList.add('hidden');
    $('crosshair').classList.remove('target');
    if (targetRing) targetRing.visible = false;
  }
}

// ---------- Hold to chop / mine / dig / break ----------
// Chopping, mining, digging, and breaking placed pieces require
// HOLDING left click: hits repeat while held and stop on release. A
// lone click does NOTHING — the first hit only fires 260ms into a
// continuous hold, so spam-clicking can never chop a tree, mine a
// rock, or smash a wall. Harvest stays single-click.
let holdTimer = null, holdKind = null, holdRef = null, holdToolId = null;
function startHoldAction() {
  if (!target || (target.kind !== 'tree' && target.kind !== 'rock' && target.kind !== 'ground' && target.kind !== 'placed')) return;
  stopHoldAction();
  holdKind = target.kind; holdRef = target.kind === 'ground' ? { x: target.x, z: target.z } : target.ref;
  // Breaking a placed piece ends the hold if the held item changes
  // mid-hold (including the tool breaking) — captured here so the
  // tick can compare against the live selection.
  const _sel = selectedItem(); holdToolId = _sel ? _sel.id : null;
  const tick = () => {
    // Still holding the SAME tree/rock/ground cell/placed piece, still
    // in the world, with a valid tool? Anything else ends the hold
    // with no progress.
    if (holdKind === 'placed') {
      if (!target || target.kind !== 'placed' || target.ref !== holdRef || !placed.includes(holdRef)) { stopHoldAction(); return; }
      const sel = selectedItem();
      if ((sel ? sel.id : null) !== holdToolId) { stopHoldAction(); return; }
      // Fists work, slowly: the 0.5 baseline matches the ground-stone
      // fallback, half a wooden tool's power. Tools wear per hit, as
      // with chopping/mining (damageTool no-ops for fists and temp stones).
      const power = sel && ITEMS[sel.id]?.tool ? ITEMS[sel.id].power : 0.5;
      triggerSwing();
      if (sel && ITEMS[sel.id]?.tool) damageTool(sel);
      hitPlaced(holdRef, power);
    } else if (holdKind === 'ground') {
      if (!target || target.kind !== 'ground' || target.x !== holdRef.x || target.z !== holdRef.z) { stopHoldAction(); return; }
      const sel = selectedItem();
      if (!sel || ITEMS[sel.id]?.tool !== 'shovel') { stopHoldAction(); return; }
      triggerSwing(); digGround(holdRef, sel);
    } else {
      const list = holdKind === 'tree' ? world.trees : world.rocks;
      if (!target || target.kind !== holdKind || target.ref !== holdRef || !list.includes(holdRef)) { stopHoldAction(); return; }
      const sel = selectedItem();
      if (holdKind === 'tree') {
        if (!sel || ITEMS[sel.id]?.tool !== 'axe') { stopHoldAction(); return; }
        triggerSwing(); chopTree(target.ref, sel);
      } else {
        if (!sel || ITEMS[sel.id]?.tool !== 'pickaxe') { stopHoldAction(); return; }
        triggerSwing(); mineRock(target.ref, sel);
      }
    }
    holdTimer = setTimeout(tick, 420); // repeat swings while held
  };
  holdTimer = setTimeout(tick, 260);
}
function stopHoldAction() {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  holdKind = null; holdRef = null; holdToolId = null;
}
// ---------- Eat hold (RIGHT-click hold eats one food item) ----------
// Mirrors the chop/mine hold pattern: one item per hold, no repeat
// while still held, so a long hold can't eat a whole stack by accident.
let eatHoldTimer = null, rightHeld = false;
function startEatHold() {
  stopEatHold();
  eatHoldTimer = setTimeout(() => {
    eatHoldTimer = null;
    if (!rightHeld || buildMode || driving) return;
    if (document.body.classList.contains('friends-open')) return;
    if (!$('inv-panel').classList.contains('hidden') || !$('shop-panel').classList.contains('hidden') ||
        !$('phone-panel').classList.contains('hidden') ||
        !$('pause-menu').classList.contains('hidden')) return;
    eatSelected();
  }, 450);
}
function stopEatHold() {
  if (eatHoldTimer) { clearTimeout(eatHoldTimer); eatHoldTimer = null; }
}

// ---------- Primary action (LEFT click: attack / chop / mine) ----------
function onPrimaryAction() {
  if (buildMode) { placeGhostPiece(); return; }
  if (!target) return;
  if (target.kind === 'ground') return; // digging is hold-only, like chop/mine
  const sel = selectedItem();
  // Left click never interacts (no chests, benches, shops, cars) and
  // never triggers car-key/jerrycan use — that is all right-click.
  if (target.kind === 'tree') {
    if (!sel || ITEMS[sel.id]?.tool !== 'axe') { toast('You need an axe selected to chop. (Your wooden axe is in your hotbar.)'); return; }
    triggerSwing();
    chopTree(target.ref, sel);
  } else if (target.kind === 'rock') {
    if (!sel || ITEMS[sel.id]?.tool !== 'pickaxe') { toast('You need a pickaxe to mine. Quick-craft a wooden pickaxe (Q) — it only costs wood.'); return; }
    triggerSwing();
    mineRock(target.ref, sel);
  } else if (target.kind === 'placed') {
    // Breaking placed pieces is hold-only (see startHoldAction): a
    // lone click does NOTHING, same as digging. This branch is only
    // reachable via the debug hook now — the mouse path routes
    // 'placed' targets to startHoldAction before getting here.
    return;
  } else if (target.kind === 'crop') {
    harvestCrop(target.ref);
  } else if (target.kind === 'darkened') {
    hitDarkened(target.ref);
  }
}
// ---------- Interact (RIGHT click, or E) ----------
function doInteract(source) {
  if (driving) { exitCar(); return; }
  // A shop-type panel already open: E toggles it shut ONLY if the
  // keyboard opened it; a mouse-opened panel ignores the key.
  if (!$('shop-panel').classList.contains('hidden')) {
    if (source === 'key' && shopOpened && shopOpened.by === 'key') {
      $('shop-panel').classList.add('hidden');
      shopOpened = null;
      closeOpenChestLid();
      requestGameLock();
    }
    return;
  }
  if (!target) return;
  if (target.kind === 'chest') {
    openLootChest(target.ref, source);
  } else if (target.kind === 'goldbench' || (target.kind === 'placed' && target.ref.itemId === 'workbench')) {
    openCraft(false, source === 'mouse' ? { by: 'mouse', key: null } : { by: 'key', key: S.keybinds.interact });
  } else if (target.kind === 'shop') {
    openShop(source);
  } else if (target.kind === 'carshop') {
    openCarShop(source);
  } else if (target.kind === 'landoffice') {
    buyLand();
  } else if (target.kind === 'car') {
    enterCar(target.ref);
  } else if (target.kind === 'groundstone') {
    scene.remove(target.ref.mesh);
    world.groundStones = world.groundStones.filter((s) => s !== target.ref);
    addItem('ground_stone');
    toast('Picked up a stone. It can chop a tree in a pinch — slower, and it breaks after that tree is fully chopped.');
  } else if (target.kind === 'drop') {
    // Pickup is right-click ONLY — E on a drop does nothing.
    if (source !== 'mouse') return;
    const d = target.ref;
    if (addItem(d.id, d.n)) {
      scene.remove(d.mesh);
      drops.splice(drops.indexOf(d), 1);
      chatMsg('System', `Picked up ${d.n}× ${ITEMS[d.id].name}.`, true);
      updateHUD();
    } else {
      toast('Inventory full — make room first.');
    }
  } else if (target.kind === 'placed') {
    const p = target.ref;
    if (p.itemId === 'vehicle_machine') openVehiclePanel(p, source);
    else if (p.itemId === 'gas_pump') refuelNearCar(p);
    else if (p.itemId === 'chest') openStorage(p, source);
    else if (p.itemId === 'portal_command') openPortalKeypad(p, source);
    else if (p.itemId === 'workbench') openCraft(false, source === 'mouse' ? { by: 'mouse', key: null } : { by: 'key', key: S.keybinds.interact });
  }
  // Trees/rocks/crops on right-click do NOTHING — chopping and mining
  // are left-click only. (The old fallthrough to onPrimaryAction here
  // is deliberately gone.)
}
function chopTree(t, toolSlot) {
  if (!world.trees.includes(t)) return; // already felled — never pay out twice
  t.hp -= toolSlot ? ITEMS[toolSlot.id].power : 1;
  const isTempStone = toolSlot && ITEMS[toolSlot.id].temp;
  if (!isTempStone) damageTool(toolSlot);
  if (t.hp <= 0) {
    hideTreeInstances(t); // trees are instanced now — hide, don't remove a group
    world.trees = world.trees.filter((x) => x !== t);
    const wood = 2 + Math.floor(Math.random() * 3);
    dropItem('wood', wood, t.x, t.z);
    if (Math.random() < 0.3) { dropItem('apple', 1, t.x + 0.7, t.z + 0.4); }
    // The ground stone survives the whole tree (multiple hits) and
    // breaks ONLY now, when the tree is fully chopped — never after a
    // single swing.
    if (isTempStone) {
      const arr = selSlot < 7 ? P.hotbar : P.perm;
      const idx = selSlot < 7 ? selSlot : selSlot - 7;
      if (arr[idx] && arr[idx].id === 'ground_stone') {
        // Stacked stones lose one stone, not the whole stack.
        if (arr[idx].n > 1) arr[idx].n -= 1;
        else {
          arr[idx] = null;
          if (selSlot < 7) P.hotbar = P.hotbar.filter(Boolean);
        }
      }
      toast('Your stone broke apart.');
    }
  } else {
    t.group.scale.setScalar((t.scale || 1) * (1 - (3 - t.hp) * 0.06));
    t.group.rotation.z = (3 - t.hp) * 0.03;
    refreshTreeInstances(t); // proxy group is detached — push the shake into the instances
  }
  updateHUD();
}
function mineRock(r, toolSlot) {
  if (!world.rocks.includes(r)) return; // already mined — never pay out twice
  r.hp -= ITEMS[toolSlot.id].power;
  damageTool(toolSlot);
  if (r.hp <= 0) {
    scene.remove(r.mesh);
    world.rocks = world.rocks.filter((x) => x !== r);
    if (r.iron) { dropItem('iron', 2, r.x, r.z); }
    else { dropItem('stone', 3, r.x, r.z); }
  }
  updateHUD();
}
// Placed-piece HP by material, following the game's durability ladder
// wood < ice < brick < steel. Machines, furniture and chests sit
// mid-ladder; a whole house takes steel-tier effort. With fist power
// 0.5, wood tools 1, stone tools 2: a wood wall falls in 4 fist / 2
// wood-tool / 1 stone-tool hits; steel takes 12 / 6 / 3.
function pieceHP(itemId) {
  if (itemId === 'wall_steel' || itemId === 'house') return 6;
  if (itemId === 'wall_brick') return 4;
  if (itemId === 'wall_ice') return 3;
  if (itemId === 'wall_wood' || itemId === 'wall_window' || itemId === 'wall_door' || itemId === 'floor' || itemId === 'roof') return 2;
  return 3;
}
function hitPlaced(p, power) {
  if (p.hp === undefined || p.hp === null) p.hp = pieceHP(p.itemId);
  p.hp -= power;
  if (p.hp <= 0) { stopHoldAction(); smashPlaced(p); }
}
function smashPlaced(p) {
  scene.remove(p.mesh);
  placed = placed.filter((x) => x !== p);
  // Debris gives back a few materials, never more than the piece was made of
  const back = { wall_wood: ['wood', 1], wall_brick: ['stone', 1], wall_steel: ['iron', 1], wall_window: ['wood', 1], wall_door: ['wood', 1], wall_ice: ['ice', 1], floor: ['wood', 1], roof: ['wood', 1] };
  const b = back[p.itemId];
  if (b) { dropItem(b[0], b[1], p.x, p.z); chatMsg('System', `Smashed! Recovered ${b[1]}× ${ITEMS[b[0]].name} — right-click it to pick it up.`, true); }
  // Smashing the machine hosting an open portal closes that portal.
  if (portal && portal.machine === p) closePortal();
  // A smashed storage chest drops its contents too — nothing vanishes silently.
  if (p.itemId === 'chest' && p.contents) {
    p.contents.forEach((s, i) => { if (s) dropItem(s.id, s.n, p.x + (i % 3 - 1) * 0.7, p.z + (Math.floor(i / 3) - 1) * 0.7); });
  }
  updateHUD(); saveGame();
}

// ---------- Building ----------
let ghost = null;
const PIECE_COLORS = { wood: 0x8a5a2b, brick: 0x9a5a48, steel: 0xd8dde2, window: 0x8a5a2b, door: 0x8a5a2b, ice: 0xbfe8ff };
function paintMat(base, isSteel) {
  const pc = new THREE.Color(paintColor), bc = new THREE.Color(base);
  const c = isSteel ? pc : bc.lerp(pc, 0.45);
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
}
// ---------- Procedural textures (visual only) ----------
// Grain / coursing / shingle detail is drawn in light tones so the paint
// tint (material.color) still controls the final hue — the texture only
// adds surface detail, never the color itself.
const _texCache = {};
function canvasTex(key, draw) {
  if (_texCache[key]) return _texCache[key];
  const c = document.createElement('canvas'); c.width = c.height = 256;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  _texCache[key] = t; return t;
}
// Texture redo (2026-10-29): the old white-base canvases were multiplied
// by a color lerped 45% toward paint brown, which washed every wall,
// floor, and roof into mud. The shared textures.js canvases below are
// PRE-TINTED to their material hue, so matTex() now uses a white color
// and the map carries the hue. Call sites are unchanged.
// Shared textured-material cache for ground drops: one material per
// (texture, color, roughness, metalness), never one per drop.
const _dropMatCache = {};
function dropTexMat(tex, color, rough = 0.8, metal = 0) {
  const key = tex.uuid + '|' + color + '|' + rough + '|' + metal;
  if (!_dropMatCache[key]) _dropMatCache[key] = new THREE.MeshStandardMaterial({ map: tex, color, roughness: rough, metalness: metal });
  return _dropMatCache[key];
}
function grainTex() { return woodTex(); }
function brickTex() { return brickTintedTex(); }
function shingleTex() { return shingleTintedTex(); }
function brushedTex() { return steelTex(); }
// Tapered sword blade: a flat extruded silhouette (taper + point) with
// a center edge ridge, so swords never read as plain rectangles.
// Extrude UVs are raw shape coords, so they are remapped to 0..1 here
// or the blade map would sample one texel and read flat.
function swordBladeMesh(bladeMat, edgeMat, len = 0.34, wid = 0.07) {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-wid / 2, 0); shape.lineTo(wid / 2, 0);
  shape.lineTo(wid * 0.28, len * 0.82); shape.lineTo(0, len);
  shape.lineTo(-wid * 0.28, len * 0.82); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false });
  geo.translate(0, 0, -0.0125);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + wid / 2) / wid, uv.getY(i) / len);
  const blade = new THREE.Mesh(geo, bladeMat); blade.castShadow = true; g.add(blade);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.014, len * 0.86, 0.032), edgeMat);
  edge.position.set(0, len * 0.45, 0); g.add(edge);
  return g;
}

function buildPieceMesh(itemId, colorOverride) {
  const g = new THREE.Group();
  // No color selection for now (dye/paint items come later): walls use
  // their natural material color from PIECE_COLORS; other pieces keep
  // their existing default appearance.
  const pc = colorOverride || (itemId.startsWith('wall_') ? PIECE_COLORS[itemId.slice(5)] : null) || paintColor;
  const matFor = (base, steel) => {
    const pcc = new THREE.Color(pc), bc = new THREE.Color(base);
    // Stated colors win: the old 45% lerp toward paint brown turned
    // cream walls tan, green shutters muddy, and steel trims brown.
    return new THREE.MeshStandardMaterial({ color: steel ? pcc : bc, roughness: 0.9 });
  };
  const matTex = (base, steel, tex, rough = 0.9, metal = 0) => {
    // Pre-tinted maps carry the hue, so the color stays white — the
    // old lerp washed every textured piece toward paint brown.
    return new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: rough, metalness: metal });
  };
  const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh; };
  if (itemId.startsWith('wall_')) {
    const kind = itemId.slice(5);
    if (kind === 'window') {
      const frameM = matTex(0x8a5a2b, false, woodTex()), trimM = matTex(0x6b4226, false, woodTex());
      add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 3, 0.3), frameM), -1.15, 1.5, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 3, 0.3), frameM), 1.15, 1.5, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 0.3), frameM), 0, 2.65, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 0.3), frameM), 0, 0.35, 0);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 0.1),
        new THREE.MeshStandardMaterial({ map: frostTex(), transparent: true, opacity: 0.55, roughness: 0.1 }));
      add(glass, 0, 1.5, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.16), trimM), 0, 1.5, 0); // center mullion
      add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.16), trimM), 0, 1.5, 0); // cross mullion
      add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.10, 0.45), trimM), 0, 0.32, 0); // protruding sill
      add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.10, 0.36), trimM), 0, 2.72, 0); // header trim
    } else if (kind === 'door') {
      const frameM = matTex(0x8a5a2b, false, woodTex());
      const slabM = new THREE.MeshStandardMaterial({ map: woodLightTex(), color: 0x5a3a1a, roughness: 0.9 });
      const panelM = new THREE.MeshStandardMaterial({ map: woodLightTex(), color: 0x4a3220, roughness: 0.9 });
      add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 3, 0.3), frameM), -1.05, 1.5, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 3, 0.3), frameM), 1.05, 1.5, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.3), frameM), 0, 2.6, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.15), slabM), 0, 1.1, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.03), panelM), 0, 1.75, 0.09); // upper door panel
      add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.03), panelM), 0, 0.65, 0.09); // lower door panel
      add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.16, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a1e10 })), -0.52, 1.6, 0.10); // hinges
      add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.16, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a1e10 })), -0.52, 0.6, 0.10);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf5c542, metalness: 0.6, roughness: 0.35 }));
      add(knob, 0.42, 1.1, 0.12); // doorknob
      add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.10, 0.5), matFor(0x6b4226)), 0, 0.05, 0.05); // threshold step
    } else if (kind === 'ice') {
      add(new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.3),
        new THREE.MeshStandardMaterial({ map: frostTex(), transparent: true, opacity: 0.85, roughness: 0.2 })), 0, 1.5, 0);
      const crackM = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, roughness: 0.3 });
      const crack1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.2, 0.32), crackM); crack1.rotation.z = 0.4; add(crack1, -0.8, 1.9, 0); // frost cracks
      const crack2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.0, 0.32), crackM); crack2.rotation.z = -0.5; add(crack2, 0.6, 1.1, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 0.36), new THREE.MeshStandardMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.9, roughness: 0.2 })), 0, 2.94, 0); // frosted cap
      add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 0.36), new THREE.MeshStandardMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.9, roughness: 0.2 })), 0, 0.06, 0); // frosted base
    } else {
      const base = kind === 'brick' ? 0x9a5a48 : kind === 'steel' ? 0xd8dde2 : 0x8a5a2b;
      const tex = kind === 'brick' ? brickTex() : kind === 'steel' ? brushedTex() : grainTex();
      const main = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.3),
        kind === 'steel' ? matTex(base, true, tex, 0.4, 0.6) : matTex(base, false, tex));
      add(main, 0, 1.5, 0);
      // Trim so plain walls don't read as flat slabs: plank seams on wood,
      // mortar courses on brick, a frame on steel — plus real joints and
      // hardware so construction reads as believable.
      const seamM = new THREE.MeshStandardMaterial({ color: 0x2a1e10, roughness: 1 });
      if (kind === 'wood') {
        for (const sx of [-1.0, -0.5, 0, 0.5, 1.0]) // five vertical planks
          add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 3, 0.32), seamM), sx, 1.5, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 0.34), matFor(0x6b4226)), 0, 2.94, 0); // top rail
        add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 0.34), matFor(0x6b4226)), 0, 0.06, 0); // bottom rail
        add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.16, 0.36), matFor(0x6b4226)), 0, 0.20, 0); // baseboard
        for (const sx of [-1.25, 1.25]) // end posts
          add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 3, 0.36), matFor(0x6b4226)), sx, 1.5, 0);
        const nailM = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.5 });
        for (const sx of [-1.0, 0, 1.0]) for (const ny of [0.5, 2.5]) { // nail heads
          const nail = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), nailM);
          add(nail, sx, ny, 0.17);
        }
      } else if (kind === 'brick') {
        for (let by = 0.75; by < 3; by += 0.75)
          add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.05, 0.32), new THREE.MeshStandardMaterial({ color: 0xd8cbb8, roughness: 1 })), 0, by, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.14, 0.38), new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 1 })), 0, 2.96, 0); // concrete cap
        add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.14, 0.38), new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 1 })), 0, 0.07, 0); // footing
        for (const sx of [-1.42, 1.42]) // brick pilasters at the ends
          add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 3, 0.42), matTex(0x9a5a48, false, brickTex())), sx, 1.5, 0);
      } else if (kind === 'steel') {
        add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.10, 0.34), new THREE.MeshStandardMaterial({ color: 0x8d8f94, roughness: 0.5, metalness: 0.5 })), 0, 2.95, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.10, 0.34), new THREE.MeshStandardMaterial({ color: 0x8d8f94, roughness: 0.5, metalness: 0.5 })), 0, 0.05, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 3, 0.34), new THREE.MeshStandardMaterial({ color: 0x8d8f94, roughness: 0.5, metalness: 0.5 })), -1.45, 1.5, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 3, 0.34), new THREE.MeshStandardMaterial({ color: 0x8d8f94, roughness: 0.5, metalness: 0.5 })), 1.45, 1.5, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 3, 0.32), new THREE.MeshStandardMaterial({ color: 0x8d8f94, roughness: 0.5, metalness: 0.5 })), 0, 1.5, 0); // center panel seam
        const rivetM = new THREE.MeshStandardMaterial({ color: 0x5a5d62, roughness: 0.4, metalness: 0.7 });
        for (const rx of [-1.35, 1.35]) for (const ry of [0.3, 1.5, 2.7]) { // rivets
          const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), rivetM);
          add(rivet, rx, ry, 0.18);
        }
      }
    }
  } else if (itemId === 'floor') {
    add(new THREE.Mesh(new THREE.BoxGeometry(3, 0.25, 3), matTex(0x8a5a2b, false, grainTex())), 0, 0.12, 0);
    const seamM = new THREE.MeshStandardMaterial({ color: 0x2a1e10, roughness: 1 });
    for (const sx of [-1.0, -0.5, 0, 0.5, 1.0]) // plank seams across the floor
      add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 3), seamM), sx, 0.255, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(3.06, 0.08, 0.08), matFor(0x6b4226)), 0, 0.12, 1.5); // edge trim
    add(new THREE.Mesh(new THREE.BoxGeometry(3.06, 0.08, 0.08), matFor(0x6b4226)), 0, 0.12, -1.5);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 3.06), matFor(0x6b4226)), 1.5, 0.12, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 3.06), matFor(0x6b4226)), -1.5, 0.12, 0);
  } else if (itemId === 'roof') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.4, 4), matTex(0xa34a3a, false, shingleTex()));
    cone.rotation.y = Math.PI / 4; add(cone, 0, 0.7, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), matFor(0x7a3a2e)), 0, 1.45, 0); // ridge cap
    const eaveM = matFor(0x6b4226);
    for (const [ex, ez, ry] of [[0, 1.70, 0], [0, -1.70, 0], [1.70, 0, Math.PI / 2], [-1.70, 0, Math.PI / 2]]) { // eave boards
      const eave = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.10, 0.10), eaveM);
      eave.rotation.y = ry; add(eave, ex, 0.05, ez);
    }
  } else if (itemId === 'workbench') {
    // A proper workbench, rebuilt: thick slab top with edge trim, apron,
    // four sturdy legs with cross-braces, a lower shelf, and a framed
    // pegboard backboard with hanging tools (decoration only — crafting
    // still works exactly as before, via E).
    const topM = matTex(0x8a5a2b, false, grainTex()), legM = matTex(0x6b4226, false, woodTex()), darkM = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1 });
    add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 1.0), topM), 0, 0.92, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.05, 1.06), darkM), 0, 0.85, 0); // edge trim under the slab
    add(new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.14, 0.06), legM), 0, 0.74, 0.40); // front apron
    add(new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.14, 0.06), legM), 0, 0.74, -0.40); // back apron
    for (const sx of [-0.88, 0.88]) for (const sz of [-0.40, 0.40])
      add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.86, 0.14), legM), sx, 0.43, sz);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.08, 0.08), legM), 0, 0.22, 0.40); // front brace
    add(new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.08, 0.08), legM), 0, 0.22, -0.40); // back brace
    add(new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.06, 0.80), legM), 0, 0.16, 0); // lower shelf
    // Framed pegboard (grained board; the peg dots stay as geometry)
    const boardM = new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 1 });
    add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.25, 0.07), boardM), 0, 1.60, -0.48);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.10), legM), 0, 2.26, -0.48); // top frame rail
    add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.25, 0.10), legM), -0.98, 1.60, -0.48);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.25, 0.10), legM), 0.98, 1.60, -0.48);
    const pegM = new THREE.MeshStandardMaterial({ color: 0x2a1e10, roughness: 1 });
    for (let px = -4; px <= 4; px++) for (let py = 0; py < 4; py++) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.02), pegM), px * 0.20, 1.18 + py * 0.27, -0.435);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.02), pegM), px * 0.20, 1.18 + py * 0.27, -0.525);
    }
    const toolSteel = new THREE.MeshStandardMaterial({ map: steelTex(), roughness: 0.35, metalness: 0.65 });
    const toolWood = new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.9 });
    // Hanging hammer: handle + head + claw notch feel
    add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.40, 0.035), toolWood), -0.62, 1.55, -0.42);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.045), toolSteel), -0.62, 1.78, -0.42);
    // Hanging axe: handle + wedge head
    add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.44, 0.035), toolWood), 0, 1.55, -0.42);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.13, 0.035), toolSteel), 0.06, 1.76, -0.42);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.13, 0.02), toolSteel), 0.13, 1.74, -0.42);
    // Hanging saw: blade + grip
    add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.15, 0.02), toolSteel), 0.62, 1.58, -0.42);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.17, 0.045), toolWood), 0.38, 1.58, -0.42);
    // Hanging wrench: slim handle + open jaw block
    add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.03), toolSteel), -0.28, 1.55, -0.42);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.10, 0.035), toolSteel), -0.28, 1.76, -0.42);
    // Same tools mirrored on the back face (z -0.54): a bench approached
    // from the spawn side must not show a blank board back.
    add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.40, 0.035), toolWood), -0.62, 1.55, -0.54);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.045), toolSteel), -0.62, 1.78, -0.54);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.44, 0.035), toolWood), 0, 1.55, -0.54);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.13, 0.035), toolSteel), -0.06, 1.76, -0.54);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.13, 0.02), toolSteel), -0.13, 1.74, -0.54);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.15, 0.02), toolSteel), 0.62, 1.58, -0.54);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.17, 0.045), toolWood), 0.38, 1.58, -0.54);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.03), toolSteel), -0.28, 1.55, -0.54);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.10, 0.035), toolSteel), -0.28, 1.76, -0.54);
    // Bench-top props: a plank, a toolbox with a handle, a small vise block
    add(new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.05, 0.20), matFor(0x9a6a35)), -0.45, 1.01, 0.12);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.26, 0.26), new THREE.MeshStandardMaterial({ color: 0xe5484d, roughness: 0.7 })), 0.58, 1.11, -0.12);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.05, 0.05), darkM), 0.58, 1.27, -0.12);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.18), toolSteel), -0.78, 1.06, -0.18);
    for (const dx of [-0.6, -0.2, 0.2]) // bench dogs: small pegs on the top
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), darkM), dx, 1.02, 0.30);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.10, 0.14), toolWood), 0.15, 1.03, 0.25); // hand plane body
    add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.12), toolSteel), 0.15, 1.10, 0.25); // plane blade wedge
    for (const jx of [-0.5, -0.28, -0.06]) { // jars on the lower shelf
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 10), new THREE.MeshStandardMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.6, roughness: 0.2 })), jx, 0.28, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 10), darkM), jx, 0.38, 0);
    }
    add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.04), toolWood), 0.55, 1.95, -0.42); // spirit level on the board
    add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.03, 0.045), new THREE.MeshStandardMaterial({ color: 0x9fd4ff, emissive: 0x1a4a1a, emissiveIntensity: 0.8 })), 0.55, 1.95, -0.415); // level bubble
  } else if (itemId === 'vehicle_machine') {
    // A believable vehicle machine: plinth, frame columns, gantry beam,
    // cabinet body with panel seams, glowing build screen, control panel,
    // warning light, side vents, and an open build bay at the front.
    const bodyM = new THREE.MeshStandardMaterial({ map: panelTex(), roughness: 0.5, metalness: 0.4 });
    const darkM = new THREE.MeshStandardMaterial({ color: 0x1d2536, roughness: 0.6, metalness: 0.3 });
    const trimM = new THREE.MeshStandardMaterial({ color: 0xf5c542, roughness: 0.5 });
    add(new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.22, 2.1), darkM), 0, 0.11, 0); // plinth
    add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.7, 1.5), bodyM), 0, 1.07, 0); // cabinet
    add(new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.10, 1.56), trimM), 0, 1.95, 0); // top trim
    for (const sx of [-1.32, 1.32]) // side columns
      add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.0, 1.7), darkM), sx, 1.22, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.82, 0.18, 0.22), darkM), 0, 2.28, 0); // gantry beam
    add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.85, 0.06), new THREE.MeshStandardMaterial({ color: 0x57b6ff, emissive: 0x1a4a6a, emissiveIntensity: 1.2 })), -0.45, 1.35, 0.79); // build screen
    add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.08), darkM), -0.45, 0.86, 0.79); // screen sill
    add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.12), darkM), 0.85, 1.15, 0.80); // control panel
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10), new THREE.MeshStandardMaterial({ color: 0xe5484d, emissive: 0xe5484d, emissiveIntensity: 0.9 })), 0.85, 1.48, 0.82); // status light
    // Same face mirrored on the back: a machine approached from behind
    // must not read as a blank dark cabinet.
    add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.85, 0.06), new THREE.MeshStandardMaterial({ color: 0x57b6ff, emissive: 0x1a4a6a, emissiveIntensity: 1.2 })), -0.45, 1.35, -0.79); // rear screen
    add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.08), darkM), -0.45, 0.86, -0.79); // rear sill
    add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.12), darkM), 0.85, 1.15, -0.80); // rear panel
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10), new THREE.MeshStandardMaterial({ color: 0xe5484d, emissive: 0xe5484d, emissiveIntensity: 0.9 })), 0.85, 1.48, -0.82); // rear light
    for (let vy = 0; vy < 3; vy++) { // side vents, both sides
      add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.9), darkM), -1.42, 0.8 + vy * 0.28, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.9), darkM), 1.42, 0.8 + vy * 0.28, 0);
    }
    add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.08), trimM), 0, 0.30, 0.82); // bay threshold
    add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.15, 0.06), new THREE.MeshStandardMaterial({ color: 0x0e1420, roughness: 1 })), 0, 0.95, 0.76); // dark build bay recess
    for (const hx of [-1.2, -0.6, 0, 0.6, 1.2]) { // hazard strip on the plinth edge
      add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.10, 0.02), trimM), hx, 0.22, 1.06);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.10, 0.02), darkM), hx + 0.28, 0.22, 1.06);
    }
    const boltM = new THREE.MeshStandardMaterial({ color: 0x8d8f94, roughness: 0.4, metalness: 0.7 });
    for (const bx of [-1.15, 1.15]) for (const by of [0.45, 1.75]) { // panel bolts
      const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), boltM);
      add(bolt, bx, by, 0.79);
    }
    const cable = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }));
    cable.rotation.z = Math.PI; add(cable, 1.45, 0.35, 0.4); // power cable loop to the floor
  } else if (itemId === 'gas_pump') {
    // A proper pump: concrete plinth, body with side panels, red top cap,
    // display window, side hose loop + nozzle holster.
    const bodyM = new THREE.MeshStandardMaterial({ map: pumpPanelTex(), roughness: 0.55 });
    const redM = new THREE.MeshStandardMaterial({ color: 0xe5484d, roughness: 0.6 });
    const darkM = new THREE.MeshStandardMaterial({ color: 0x1d2536, roughness: 0.6 });
    add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 0.9), new THREE.MeshStandardMaterial({ color: 0x8d8f94, roughness: 1 })), 0, 0.07, 0); // plinth
    add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.65, 0.7), bodyM), 0, 0.96, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.12, 0.76), darkM), 0, 0.24, 0); // base band
    add(new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.30, 0.76), redM), 0, 1.86, 0); // top cap
    add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.04), new THREE.MeshStandardMaterial({ color: 0x0e1420, roughness: 0.4, emissive: 0x1a4a1a, emissiveIntensity: 0.6 })), 0, 1.35, 0.37); // display
    add(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.06, 0.05), darkM), 0, 1.10, 0.37); // display sill
    const hose = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.035, 6, 14, Math.PI), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }));
    hose.rotation.z = -Math.PI / 2;
    add(hose, 0.48, 1.05, 0); // hose loop on the side
    add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.28, 0.12), darkM), 0.48, 0.78, 0.10); // nozzle holster
    add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.22, 0.08), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 })), 0.48, 0.62, 0.22); // nozzle itself
    for (const [gx, gc] of [[-0.24, 0x46a758], [0, 0xf5c542], [0.24, 0xe5484d]]) // grade buttons
      add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.10, 0.04), new THREE.MeshStandardMaterial({ color: gc, roughness: 0.6 })), gx, 0.82, 0.37);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.06, 0.72), darkM), 0, 1.72, 0); // cap drip rail
  } else if (itemId === 'portal_command') {
    // REDESIGNED 2026-10-29 (Liam's design): a flat platform on the
    // ground, a claw-like frame rising from the floor that forms the
    // portal arch, and a small control-pad machine standing to the
    // RIGHT of the frame (local +x = the viewer's right from the
    // front, since pieces face the player with local +z). The portal
    // ring/disc sits INSIDE the arch at the piece origin — openPortal
    // now spawns it at the machine center, not 2 units out.
    // The arch clears the 2.8-wide ring: prong bases at |x| 1.95 lean
    // inward, the mid segment stays outside the disc (closest ~0.2
    // clear), tips curl inward above the ring.
    const steelDarkM = new THREE.MeshStandardMaterial({ map: steelTex(), color: 0x3a3f4a, roughness: 0.5, metalness: 0.6 });
    const glowM = new THREE.MeshStandardMaterial({ color: 0x7a5cff, emissive: 0x7a5cff, emissiveIntensity: 1.4 });
    const panelM = new THREE.MeshStandardMaterial({ map: panelTex(), roughness: 0.5, metalness: 0.4 });
    add(new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.18, 3.2), steelDarkM), 0, 0.09, 0); // platform
    add(new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.05, 0.08), glowM), 0, 0.20, 1.60); // front edge glow strip
    for (const [bx, bz] of [[-2.3, 1.5], [2.3, 1.5], [-2.3, -1.5], [2.3, -1.5]]) { // platform bolts
      const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), steelDarkM);
      add(bolt, bx, 0.20, bz);
    }
    // Claw prongs, left (-x) and right (+x): one connected chain per
    // side — knuckle, lower segment, mid segment, glowing tip — each
    // piece starting exactly where the last ends, leaning INWARD
    // (rotation.z = side * angle), with a joint sphere covering every
    // bend. FIXED 2026-10-29: the old segments were hand-placed with
    // flipped lean signs, so they splayed outward and floated apart.
    for (const side of [-1, 1]) {
      // Inward direction at lean angle a: local +y rotated by side*a.
      const dir = (a) => [-side * Math.sin(a), Math.cos(a)];
      const d1 = dir(0.18), d2 = dir(0.42), d3 = dir(1.05);
      const J0 = [side * 1.95, 0.38];
      const J1 = [J0[0] + d1[0] * 1.35, J0[1] + d1[1] * 1.35];
      const J2 = [J1[0] + d2[0] * 1.25, J1[1] + d2[1] * 1.25];
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), steelDarkM);
      add(knuckle, J0[0], J0[1], 0);
      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.35, 0.30), steelDarkM);
      lower.rotation.z = side * 0.18;
      add(lower, J0[0] + d1[0] * 0.675, J0[1] + d1[1] * 0.675, 0);
      const joint1 = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), steelDarkM);
      add(joint1, J1[0], J1[1], 0);
      const mid = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.25, 0.28), steelDarkM);
      mid.rotation.z = side * 0.42;
      add(mid, J1[0] + d2[0] * 0.625, J1[1] + d2[1] * 0.625, 0);
      const joint2 = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), steelDarkM);
      add(joint2, J2[0], J2[1], 0);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.85, 8), glowM);
      tip.rotation.z = side * 1.05;
      add(tip, J2[0] + d3[0] * 0.425, J2[1] + d3[1] * 0.425, 0);
    }
    // Control-pad machine, right of the frame: cabinet + tilted
    // glowing screen + 4 keypad buttons. This is where the player
    // selects the dimension (interact opens the keypad menu).
    add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.15, 0.55), panelM), 2.60, 0.58, 0.30);
    const padScreen = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.50, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x4a3a8a, emissive: 0x7a5cff, emissiveIntensity: 0.9 }));
    padScreen.rotation.x = -0.25; add(padScreen, 2.60, 1.05, 0.60);
    for (const [kx, ky] of [[-0.16, 0.16], [0.16, 0.16], [-0.16, -0.16], [0.16, -0.16]])
      add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.04), glowM), 2.60 + kx, 0.55 + ky, 0.60);
  } else if (itemId === 'chest') {
    // REDESIGNED 2026-10-28: deep-wood planked body with seam grooves,
    // a true arched lid (half-barrel top), steel bands, brass latch
    // with keyhole, corner protectors — same 1.1-wide footprint and
    // the same look as world loot chests.
    const woodM = matTex(0x9a6a35, false, grainTex());
    const darkM = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 1 });
    const bandM = new THREE.MeshStandardMaterial({ map: steelTex(), color: 0x2a2d33, roughness: 0.45, metalness: 0.7 });
    const brassM = new THREE.MeshStandardMaterial({ map: goldLightTex(), color: 0xd8a437, roughness: 0.35, metalness: 0.6 });
    add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.58, 0.7), woodM), 0, 0.32, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.08, 0.74), darkM), 0, 0.06, 0); // base plinth
    for (const sx of [-0.28, 0.28]) // plank seams on the front face
      add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.02), darkM), sx, 0.32, 0.36);
    for (const bx of [-0.38, 0.38])
      add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.58, 0.72), bandM), bx, 0.32, 0); // body bands
    // Hinged lid subgroup (same convention as loot chests): origin at
    // the back edge, children shifted +0.35 in z so closed geometry is
    // unchanged; latch + keyhole travel with the lid.
    const lid = new THREE.Group();
    lid.position.set(0, 0.61, -0.35);
    const lidSlab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.10, 0.7), woodM);
    lidSlab.position.set(0, 0.05, 0.35); lidSlab.castShadow = true; lid.add(lidSlab);
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.1, 12, 1, false, 0, Math.PI), woodM);
    arch.rotation.z = Math.PI / 2; arch.position.set(0, 0.10, 0.35); arch.castShadow = true; lid.add(arch);
    for (const bx of [-0.38, 0.38]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.72), bandM);
      band.position.set(bx, 0.09, 0.35); band.castShadow = true; lid.add(band);
    }
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.05), brassM);
    latch.position.set(0, 0.01, 0.72); lid.add(latch);
    const keyhole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.02), darkM);
    keyhole.position.set(0, -0.01, 0.75); lid.add(keyhole);
    g.add(lid);
    g.userData.lid = lid;
    for (const cx of [-0.52, 0.52]) for (const cy of [0.16, 0.52]) { // corner protectors
      add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.74), bandM), cx, cy, 0);
    }
  } else if (itemId === 'house') {
    add(new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), new THREE.MeshStandardMaterial({ map: sidingTex(), roughness: 0.9 })), 0, 1.5, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.18, 4.2), new THREE.MeshStandardMaterial({ map: stoneLightTex(), color: 0x8d8f94, roughness: 1 })), 0, 0.09, 0); // stone foundation skirt
    for (let fx = -2.2; fx <= 2.2; fx += 0.55) // foundation stones on the front face
      add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.04), new THREE.MeshStandardMaterial({ map: stoneLightTex(), color: 0x7a7d82, roughness: 1 })), fx, 0.09, 2.12);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.9, 1.6, 4), matTex(0xa34a3a, false, shingleTex()));
    roof.rotation.y = Math.PI / 4; add(roof, 0, 3.8, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.5), matFor(0x8a5a2b)), 1.8, 4.3, -1.0); // chimney
    add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.15, 0.12), new THREE.MeshStandardMaterial({ color: 0x5a3a1a })), 0, 1.08, 2.05); // door
    add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.16), matFor(0x8a5a2b)), 0, 2.22, 2.05); // door header
    add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.06), new THREE.MeshStandardMaterial({ color: 0xf5c542, metalness: 0.5 })), 0.38, 1.05, 2.12); // doorknob
    for (const wx of [-1.5, 1.5]) { // framed windows
      add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.08), matFor(0xe8e8e8)), wx, 1.6, 2.04);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.1), new THREE.MeshStandardMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.6 })), wx, 1.6, 2.06);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.12), matFor(0xe8e8e8)), wx, 1.6, 2.06);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.12), matFor(0xe8e8e8)), wx, 1.6, 2.06);
    }
    add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.10, 0.9), matFor(0x8a5a2b)), 0, 0.05, 2.45); // porch step
    for (const px of [-0.8, 0.8]) // porch posts
      add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), matFor(0x8a5a2b)), px, 0.5, 2.45);
    for (let sy = 0.6; sy <= 2.8; sy += 0.55) // horizontal siding lines, front face
      add(new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.04, 0.03), matFor(0xd8cdb8)), 0, sy, 2.02);
    for (const wx of [-1.5, 1.5]) for (const sx of [-0.75, 0.75]) // window shutters
      add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.2, 0.06), matFor(0x3a5a3a)), wx + sx, 1.6, 2.05);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.06, 0.06), matFor(0x8a5a2b)), 0, 1.05, 2.90); // porch railing
    for (const rx of [-0.8, -0.27, 0.27, 0.8])
      add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.06), matFor(0x8a5a2b)), rx, 0.78, 2.90);
  }
  return g;
}
function setBuildMode(on, opened, quiet) {
  buildMode = on;
  $('build-bar').classList.toggle('hidden', !on);
  if (on) {
    buildOpened = opened || { by: 'key', key: null };
    // Build selection follows the player: entering build mode picks
    // the ACTIVE hotbar item when it is placeable, so holding a wall
    // means placing that wall. Only fall back to the first placeable
    // item when the active slot holds nothing placeable.
    const active = selectedItem();
    if (active && ITEMS[active.id]?.placeable) buildSel = active.id;
    else if (!buildSel) {
      const first = [...P.hotbar, ...P.inv].find((s) => s && ITEMS[s.id]?.placeable);
      if (first) buildSel = first.id;
    }
    // Baseline for switch detection: entering with a non-placeable
    // item held must NOT instantly exit — only an actual SWITCH of
    // the held item does (see syncBuildSel).
    buildTrackSlot = selSlot; buildTrackId = active ? active.id : null;
    renderBuildBar();
    // Auto-entry (selection change to a placeable) enters quietly —
    // no toast spam every time the player switches to a wall. Manual
    // B entry still shows the hint.
    if (!quiet) toast('Build mode — left- or right-click to place, B or switch to a non-building item to exit. Pieces need ground beneath them.');
  } else {
    buildOpened = null;
    if (ghost) { scene.remove(ghost); ghost = null; }
  }
}
// Keep buildSel tracking the active hotbar slot while in build mode
// (number keys / scroll / panel clicks / drags all funnel through
// updateHUD). Minecraft-style switch rule: switching to a placeable
// item switches the ghost to it; switching to a NON-placeable item
// (or an empty hand) exits build mode outright. The tracked baseline
// means merely HOLDING a non-placeable item (e.g. entering build mode
// with an axe held while buildSel came from inventory) does not exit
// — only an actual change of the held item does.
let buildTrackSlot = -1, buildTrackId = null;
// Auto-enter tracking: the last selection syncBuildSel saw, whether
// or not build mode was open. Auto-enter fires ONLY on an actual
// CHANGE to a placeable — so a B-exit while still holding a placeable
// (no change since the last check) never re-enters, and only a real
// switch does. The first observation only sets the baseline.
let autoTrackSlot = -1, autoTrackId = null;
function syncBuildSel() {
  const sel = selectedItem();
  const id = sel ? sel.id : null;
  const first = autoTrackSlot === -1 && autoTrackId === null;
  const changed = !first && (selSlot !== autoTrackSlot || id !== autoTrackId);
  autoTrackSlot = selSlot; autoTrackId = id;
  if (!buildMode) {
    buildTrackSlot = -1; buildTrackId = null;
    // Auto-ghost: switching TO a placeable enters build mode on its
    // own — no B press needed. Quiet (no toast), pure gameplay only
    // (no panel open), and never mid-hold (a tool breaking mid-swing
    // can shift a placeable into the selected slot — that must not
    // pop build mode while the player is still holding click).
    // Panel check is inlined here (mirrors anyPanelOpen) because that
    // helper is scoped inside bindInput and unreachable from here.
    const panelOpen = !$('inv-panel').classList.contains('hidden') ||
      !$('shop-panel').classList.contains('hidden') ||
      !$('phone-panel').classList.contains('hidden') ||
      !$('help-panel').classList.contains('hidden') ||
      !$('pause-menu').classList.contains('hidden');
    if (changed && sel && ITEMS[sel.id]?.placeable && !panelOpen && !holdTimer) {
      setBuildMode(true, { by: 'auto', key: null }, true);
    }
    return;
  }
  if (selSlot === buildTrackSlot && id === buildTrackId) return;
  buildTrackSlot = selSlot; buildTrackId = id;
  if (sel && ITEMS[sel.id]?.placeable) {
    if (sel.id !== buildSel) { buildSel = sel.id; renderBuildBar(); }
  } else {
    setBuildMode(false);
  }
}
function renderBuildBar() {
  const bar = $('build-bar');
  bar.innerHTML = '';
  const seen = new Set();
  for (const s of [...P.hotbar, ...P.inv]) {
    if (!s || !ITEMS[s.id]?.placeable || seen.has(s.id)) continue;
    seen.add(s.id);
    const b = document.createElement('button');
    b.innerHTML = `${itemIcon(s.id)} ${ITEMS[s.id].name} (${s.n})`;
    b.className = buildSel === s.id ? 'sel' : '';
    b.onclick = () => { buildSel = s.id; renderBuildBar(); };
    bar.appendChild(b);
  }
  if (!seen.size) bar.innerHTML = '<span style="padding:7px">No building pieces — craft some at the gold bench first.</span>';
}
function ghostAim() {
  // Build placement follows the first-person crosshair ray: march along
  // the look ray until it hits the ground (max 7 units), and place there.
  // FREE placement: coordinates stay continuous — no grid snap — so
  // pieces can sit flush against each other. The earlier fix removed
  // the Math.round on x/z, but the 0.5-unit march steps still quantized
  // DEPTH: pulling a piece toward/away from you jumped in half-unit
  // hops. Now the crossing segment is bisected to the exact ray/ground
  // intersection, so depth moves smoothly too. ghostValid's rules
  // (range, water, tree clearance) are unchanged. (tillSoil's farming
  // grid is untouched — that grid is farming, not building.)
  const fx = -Math.sin(P.yaw) * Math.cos(P.pitch), fy = Math.sin(P.pitch), fz = -Math.cos(P.yaw) * Math.cos(P.pitch);
  const ex = P.pos.x, ey = P.pos.y + curEyeH, ez = P.pos.z;
  const clearance = (d) => (ey + fy * d) - (groundY(ex + fx * d, ez + fz * d) + 0.15);
  if (clearance(0) <= 0) { // eye somehow below ground: fall back to the first sample, as before
    const x = ex + fx * 0.5, z = ez + fz * 0.5;
    return { x, z, y: groundY(x, z) };
  }
  let prevD = 0;
  for (let d = 0.5; d <= 7; d += 0.5) {
    if (clearance(d) <= 0) {
      let lo = prevD, hi = d; // ray above ground at lo, below at hi: bisect to the crossing
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        if (clearance(mid) <= 0) hi = mid; else lo = mid;
      }
      const dd = (lo + hi) / 2;
      const x = ex + fx * dd, z = ez + fz * dd;
      return { x, z, y: groundY(x, z) };
    }
    prevD = d;
  }
  const x = ex + fx * 7, z = ez + fz * 7;
  return { x, z, y: groundY(x, z) };
}
function ghostValid(x, z) {
  const d = Math.hypot(x - P.pos.x, z - P.pos.z);
  if (d > 7) return false;
  if (heightAt(mx(x), z, W.seed) < 0.3) return false; // not in water
  for (const t of world.trees) if (Math.hypot(t.x - x, t.z - z) < 1.6) return false;
  return true;
}
function updateGhost() {
  if (!buildMode || !buildSel) { if (ghost) { scene.remove(ghost); ghost = null; } return; }
  const { x, z, y } = ghostAim();
  if (!ghost || ghost.userData.itemId !== buildSel) {
    if (ghost) scene.remove(ghost);
    ghost = buildPieceMesh(buildSel);
    ghost.userData.itemId = buildSel;
    ghost.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = 0.55; m.userData.origColor = m.material.color.clone(); } });
    scene.add(ghost);
  }
  ghost.position.set(x, y, z);
  // Pieces face the player: every piece model's front is its +z local
  // side (door knob/hinges, chest latch, workbench front apron, house
  // doorknob all sit at +z), and rotation.y = yaw maps local +z to
  // (sin yaw, 0, cos yaw) — exactly toward the player, since the player
  // looks along (-sin yaw, -cos yaw). So the ghost's front always
  // faces the player, tracking as they turn.
  ghost.rotation.y = P.yaw;
  const ok = ghostValid(x, z);
  // Ghost is see-through in the piece's own natural colors — no green
  // tint. Only an invalid spot tints red, so you can still tell at a
  // glance that it can't go there.
  ghost.traverse((m) => { if (m.isMesh) { if (ok) m.material.color.copy(m.userData.origColor); else m.material.color.set(0xff5a5a); } });
  ghost.userData.valid = ok;
}
function placeGhostPiece() {
  if (!ghost || !ghost.userData.valid) { toast('Can\'t place that here.'); return; }
  const { x, z, y } = ghostAim();
  if (!removeCount(buildSel, 1)) { toast('Out of that piece.'); return; }
  const mesh = buildPieceMesh(buildSel);
  mesh.position.set(x, y, z);
  mesh.rotation.y = P.yaw; // placed piece keeps the ghost's facing: front toward the player
  scene.add(mesh);
  const rec = { itemId: buildSel, x, z, y, rotY: P.yaw, color: (buildSel.startsWith('wall_') ? PIECE_COLORS[buildSel.slice(5)] : null) || paintColor, mesh, contents: buildSel === 'chest' ? [] : undefined };
  placed.push(rec);
  if (buildSel === 'house') chatMsg('System', 'House placed! Your land is home.', true);
  updateHUD(); renderBuildBar(); saveGame();
}

// ---------- Farming ----------
function tillSoil() {
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
  const cx = Math.round(P.pos.x + fx * 3), cz = Math.round(P.pos.z + fz * 3);
  let made = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const x = cx + dx, z = cz + dz;
    if (crops.some((c) => c.x === x && c.z === z)) continue;
    const y = groundY(x, z);
    const soil = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 0.95),
      new THREE.MeshStandardMaterial({ map: soilTex(), roughness: 1 }));
    soil.position.set(x, y + 0.06, z); soil.receiveShadow = true; scene.add(soil);
    crops.push({ x, z, y, seed: null, planted: 0, stage: 0, mesh: soil, sprout: null });
    made++;
  }
  if (made) chatMsg('System', `Tilled a 3×3 grid. Plant seeds by selecting them and clicking a plot.`, true);
  else toast('Already tilled here.');
}
function plantOrHarvest(plot) {
  const sel = selectedItem();
  if (plot.stage >= 3) { harvestCrop(plot); return; }
  if (!plot.seed && sel && (sel.id === 'seed_wheat' || sel.id === 'seed_carrot')) {
    plot.seed = sel.id; plot.planted = time; plot.stage = 0;
    removeCount(sel.id, 1);
    chatMsg('System', `Planted ${ITEMS[sel.id].name}. Ready in about 7 in-game days.`, true);
    updateHUD();
  } else if (!plot.seed) {
    toast('Select wheat or carrot seeds, then click a tilled plot.');
  }
}
function harvestCrop(plot) {
  if (plot.stage < 3) { toast('Not ready yet.'); return; }
  const cropId = plot.seed === 'seed_wheat' ? 'wheat' : 'carrot';
  const seeds = 1 + Math.floor(Math.random() * 2);
  dropItem(cropId, 2, plot.x, plot.z);
  dropItem(plot.seed, seeds, plot.x + 0.7, plot.z + 0.4);
  chatMsg('System', `Harvested ${ITEMS[cropId].name}! Right-click the drops to pick them up.`, true);
  plot.seed = null; plot.stage = 0; plot.planted = 0;
  if (plot.sprout) { scene.remove(plot.sprout); plot.sprout = null; }
  updateHUD();
}
function updateCrops() {
  for (const c of crops) {
    if (!c.seed) continue;
    const age = time - c.planted;
    const stage = age >= 7 * 1800 ? 3 : age >= 7 * 1800 * 2 / 3 ? 2 : age >= 7 * 1800 / 3 ? 1 : 0;
    if (stage !== c.stage) {
      c.stage = stage;
      if (c.sprout) scene.remove(c.sprout);
      // Leaf-streak map under the stage color: wheat still turns
      // green -> gold, carrots stay green — color, not texture, stages.
      const mat = c.seed === 'seed_wheat'
        ? new THREE.MeshStandardMaterial({ map: leafLightTex(), color: stage >= 3 ? 0xe8c547 : 0x5da24a })
        : new THREE.MeshStandardMaterial({ map: leafLightTex(), color: 0x3d7a32 });
      const h = 0.15 + stage * 0.25;
      const sprout = new THREE.Mesh(new THREE.ConeGeometry(0.16, h, 6), mat);
      sprout.position.set(c.x, c.y + 0.12 + h / 2, c.z);
      scene.add(sprout); c.sprout = sprout;
      if (stage === 3) chatMsg('System', `Your ${c.seed === 'seed_wheat' ? 'wheat' : 'carrots'} are ready to harvest!`, true);
    }
  }
}

// ---------- Vehicles ----------
// Mouse menus: opening one exits pointer lock (cursor appears, look
// stops); closing one re-captures it via the delegated .panel-close
// handler in bindInput.
function openMousePanel(source) {
  shopOpened = source === 'mouse' ? { by: 'mouse', key: null } : { by: 'key', key: S.keybinds.interact };
  document.exitPointerLock?.();
}
function openVehiclePanel(machine, source) {
  openMousePanel(source);
  const panel = $('shop-panel');
  panel.classList.remove('hidden');
  panel.innerHTML = `<h3>Vehicle machine</h3><p class="fine">Machines adapt anywhere — even on water for water vehicles (coming soon).</p>
    <div class="craft-row"><span>Car</span><span class="cost">6 iron · 4 wood</span><button id="mk-car" class="btn small" ${countOf('iron') >= 6 && countOf('wood') >= 4 ? '' : 'disabled'}>Build car</button></div>
    <button class="btn small ghost panel-close">Close</button>`;
  $('mk-car').onclick = () => {
    removeCount('iron', 6); removeCount('wood', 4);
    spawnCar(machine.x + 3, machine.z);
    panel.classList.add('hidden');
    updateHUD();
  };
}
function spawnCar(x, z) {
  const g = new THREE.Group();
  const bodyM = new THREE.MeshStandardMaterial({ map: flakeTex(), roughness: 0.4, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 4.2), bodyM);
  body.position.y = 0.55; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2), new THREE.MeshStandardMaterial({ color: 0x22304a, roughness: 0.3 }));
  cabin.position.set(0, 1.1, -0.2); cabin.castShadow = true; g.add(cabin);
  const wheelM = new THREE.MeshStandardMaterial({ map: treadTex(), roughness: 0.9 });
  const wheels = [];
  for (const [wx, wz] of [[-1, 1.3], [1, 1.3], [-1, -1.3], [1, -1.3]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.25, 12), wheelM);
    w.rotation.z = Math.PI / 2; w.position.set(wx, 0.38, wz); g.add(w); wheels.push(w);
  }
  const winMat = new THREE.MeshStandardMaterial({ color: 0x5ed07a, emissive: 0x1a4a1a });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), winMat);
  win.position.set(0.86, 1.1, 0.4); win.rotation.y = Math.PI / 2; g.add(win);
  const y = groundY(x, z);
  g.position.set(x, y, z);
  scene.add(g);
  const car = { group: g, wheels, winMat, yaw: 0, speed: 0, fuel: 100, hp: 100, locked: false, owned: true, broken: false, breakTimer: 0 };
  cars.push(car);
  if (!P.perm[0]) { P.perm[0] = { id: 'car_key', n: 1 }; P.carKey = true; }
  toast('Car built! Your Car Key is in a permanent slot (press 8, look at the car, right-click to lock/unlock).');
  updateHUD();
}
function enterCar(car) {
  if (car.locked) { toast('That car is locked.'); return; }
  if (car.fuel <= 0) { toast('Out of fuel — use a gas pump or jerrycan.'); return; }
  driving = car;
  $('fuel-wrap').classList.remove('hidden');
  toast('Driving! WASD to drive, E to get out, Shift for boost.');
}
function exitCar() {
  if (!driving) return;
  const car = driving; driving = null;
  // Player body stays hidden — first person on foot too
  P.pos.set(car.group.position.x + 2, groundY(car.group.position.x + 2, car.group.position.z + 1), car.group.position.z + 1);
  $('fuel-wrap').classList.add('hidden');
}
function updateDriving(dt) {
  const car = driving;
  const fwd = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
  const steer = (keys['KeyA'] ? 1 : 0) - (keys['KeyD'] ? 1 : 0);
  const boost = keys['ShiftLeft'] ? 1.5 : 1;
  if (car.fuel > 0) {
    car.speed += fwd * 14 * dt * boost;
    car.fuel = Math.max(0, car.fuel - Math.abs(car.speed) * dt * 0.12);
  }
  car.speed *= (1 - 0.8 * dt);
  if (Math.abs(car.speed) < 0.05) car.speed = 0;
  car.yaw += steer * Math.min(1, Math.abs(car.speed) / 8) * dt * 1.6 * Math.sign(car.speed || 1);
  const nx = car.group.position.x + -Math.sin(car.yaw) * car.speed * dt;
  const nz = car.group.position.z + -Math.cos(car.yaw) * car.speed * dt;
  // Collisions: trees/rocks damage the car at speed
  let hit = false;
  for (const t of world.trees) if (Math.hypot(t.x - nx, t.z - nz) < 1.4) hit = true;
  for (const r of world.rocks) if (Math.hypot(r.x - nx, r.z - nz) < 1.4) hit = true;
  if (hit) {
    if (Math.abs(car.speed) > 6) { car.hp -= 15; toast(`Crash! Car HP ${Math.max(0, Math.round(car.hp))}`); }
    car.speed *= 0.25;
  } else {
    car.group.position.x = nx; car.group.position.z = nz;
  }
  car.group.position.y = groundY(car.group.position.x, car.group.position.z, car.group.position.y);
  car.group.rotation.y = car.yaw;
  for (const w of car.wheels) w.rotation.x += car.speed * dt * 2;
  // Driver's view — first person even while driving
  camera.position.set(car.group.position.x, car.group.position.y + 1.6, car.group.position.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(P.pitch * 0.5, car.yaw, 0);
  if (viewmodel) viewmodel.visible = false;
  player.position.copy(car.group.position);
  if (car.hp <= 0 && !car.broken) {
    car.broken = true; car.breakTimer = 30;
    toast('Your car is fully broken. It will turn into parts in a while.');
  }
  if (car.hp < 100 && car.hp > 0) { /* damaged-but-drivable */ }
  updateTargetPrompt();
}
function updateCarsVisual(dt) {
  for (let i = cars.length - 1; i >= 0; i--) {
    const car = cars[i];
    if (car.broken) {
      car.breakTimer -= dt;
      car.group.position.y -= dt * 0.05;
      if (car.breakTimer <= 0) {
        scene.remove(car.group);
        cars.splice(i, 1);
        dropItem('iron', 2, car.group.position.x, car.group.position.z);
        chatMsg('System', 'Your broken car turned into parts.', true);
        if (driving === car) { driving = null; }
      }
    }
  }
}
function refuelNearCar() {
  const car = cars.find((c) => Math.hypot(c.group.position.x - P.pos.x, c.group.position.z - P.pos.z) < 9 && !c.broken);
  if (!car) { toast('No car nearby. Drive one over to the pump.'); return; }
  car.fuel = 100;
  toast('Tank filled — gas pumps are unlimited.');
  updateHUD();
}

// ---------- Shops, land, storage ----------
function openShop(source) {
  openMousePanel(source);
  const panel = $('shop-panel');
  panel.classList.remove('hidden');
  panel.innerHTML = `<h3>Shop</h3><p class="fine">The shopkeeper runs this shop. You set nothing here — prices are fixed for now.</p>
    <div class="craft-row"><span>${itemIcon('seed_wheat')} Wheat seeds</span><span class="cost">5 coins</span><button class="btn small" ${P.money >= 5 ? '' : 'disabled'} data-buy="seed_wheat">Buy</button></div>
    <div class="craft-row"><span>${itemIcon('seed_carrot')} Carrot seeds</span><span class="cost">5 coins</span><button class="btn small" ${P.money >= 5 ? '' : 'disabled'} data-buy="seed_carrot">Buy</button></div>
    <div class="craft-row"><span>${itemIcon('wood')} Sell 5 wood</span><span class="cost">+10 coins</span><button class="btn small" ${countOf('wood') >= 5 ? '' : 'disabled'} data-sell="wood">Sell</button></div>
    <div class="craft-row"><span>${itemIcon('stone')} Sell 5 stone</span><span class="cost">+5 coins</span><button class="btn small" ${countOf('stone') >= 5 ? '' : 'disabled'} data-sell="stone">Sell</button></div>
    <button class="btn small ghost panel-close">Close</button>`;
  panel.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => {
    P.money -= 5; addItem(b.dataset.buy, 2); openShop(source); updateHUD();
  });
  panel.querySelectorAll('[data-sell]').forEach((b) => b.onclick = () => {
    if (removeCount(b.dataset.sell, 5)) { P.money += b.dataset.sell === 'wood' ? 10 : 5; }
    openShop(source); updateHUD();
  });
}
function openCarShop(source) {
  openMousePanel(source);
  const car = cars.find((c) => Math.hypot(c.group.position.x - P.pos.x, c.group.position.z - P.pos.z) < 10 && !c.broken);
  const panel = $('shop-panel');
  panel.classList.remove('hidden');
  panel.innerHTML = `<h3>Car shop</h3>` +
    (car
      ? `<p>Your car: HP ${Math.round(car.hp)} · Fuel ${Math.round(car.fuel)}%</p>
      <div class="craft-row"><span>Repair car</span><span class="cost">20 coins</span><button class="btn small" ${P.money >= 20 ? '' : 'disabled'} id="repair">Repair</button></div>
      <div class="craft-row"><span>Trade in for parts</span><span class="cost">Never enough for a whole new car</span><button class="btn small" id="trade">Trade in</button></div>`
      : `<p class="fine">Drive a damaged car here to repair it or trade it in for parts.</p>`) +
    `<button class="btn small ghost panel-close">Close</button>`;
  const rep = $('repair');
  if (rep) rep.onclick = () => { P.money -= 20; car.hp = 100; toast('Car repaired!'); openCarShop(source); updateHUD(); };
  const tr = $('trade');
  if (tr) tr.onclick = () => {
    scene.remove(car.group); cars.splice(cars.indexOf(car), 1);
    addItem('iron', 2); addItem('wood', 1);
    toast('Traded in for parts: 2 iron, 1 wood.');
    panel.classList.add('hidden'); updateHUD();
  };
}
function buyLand() {
  if (P.landOwned) { toast('You already own land here.'); return; }
  if (P.money < 100) { toast('Land costs 100 coins.'); return; }
  P.money -= 100; P.landOwned = true;
  if (!P.perm[1]) P.perm[1] = { id: 'house_key', n: 1 };
  // Red-line plot near spawn
  const sp = world.spawn;
  const y = groundY(sp.x + 14, sp.z + 10) + 0.15;
  const lineMat = new THREE.LineBasicMaterial({ color: 0xff2222 });
  const pts = [[-6, -5], [6, -5], [6, 5], [-6, 5], [-6, -5]].map(([dx, dz]) => new THREE.Vector3(sp.x + 14 + dx, y, sp.z + 10 + dz));
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
  scene.add(line);
  chatMsg('System', 'Land bought! Your House Key is in a permanent slot (press 9). Place a House Kit inside the red line.', true);
  updateHUD(); saveGame();
}
// ---------- Chest container (Minecraft-style) ----------
// One grid UI for BOTH loot chests and player-built storage chests:
// a big open chest grid on top, your inventory below, and items move
// by DRAG AND DROP either way. Take All stays as a convenience button.
// Chest contents are a fixed 40-slot array (null = empty) so a stack
// keeps its grid position; old compact saves are padded on open.
// Loot is still generated from the chest's loot table on first open
// and persists per chest (by exact x/z) in the world save.
const CHEST_SLOTS = 40;
function normChest(contents) {
  const arr = (contents || []).slice(0, CHEST_SLOTS);
  while (arr.length < CHEST_SLOTS) arr.push(null);
  return arr;
}
// ---------- Chest lid hinge animation ----------
// Lids are hinged at their back edge (lid group origin). Opening swings
// the lid up and back around its local X axis (~-1.9 rad, just past
// vertical); closing swings it back flush. Both directions animate
// over ~0.35s eased — never a snap, never a lift, never a sideways tilt.
const LID_OPEN_ANGLE = -1.9;
let LID_ANIM_MS = 350;
const lidAnims = [];
function animateLid(lid, open) {
  if (!lid) return;
  for (let i = lidAnims.length - 1; i >= 0; i--) if (lidAnims[i].lid === lid) lidAnims.splice(i, 1);
  lidAnims.push({ lid, from: lid.rotation.x, to: open ? LID_OPEN_ANGLE : 0, start: performance.now() });
}
function updateLidAnims() {
  if (!lidAnims.length) return;
  const now = performance.now();
  for (let i = lidAnims.length - 1; i >= 0; i--) {
    const a = lidAnims[i];
    const p = Math.min(1, (now - a.start) / LID_ANIM_MS);
    const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
    a.lid.rotation.x = a.from + (a.to - a.from) * e;
    if (p >= 1) lidAnims.splice(i, 1);
  }
}
// The chest whose panel is currently open (for lid-close on any close
// path). Set on open, cleared on close.
let openChestLid = null;
function closeOpenChestLid() {
  if (openChestLid) { animateLid(openChestLid, false); openChestLid = null; }
}
function openLootChest(c, source) {
  if (!c.contents) {
    c.contents = c.loot.map((l) => ({ ...l }));
    c.opened = true;
    saveGame();
  }
  c.contents = normChest(c.contents);
  openChestLid = c.group.userData.lid || null;
  animateLid(openChestLid, true);
  openChestPanel('Loot Chest', c.contents, source);
}
function openStorage(piece, source) {
  piece.contents = normChest(piece.contents);
  openChestLid = (piece.mesh && piece.mesh.userData.lid) || null;
  animateLid(openChestLid, true);
  openChestPanel('Storage chest (40 slots)', piece.contents, source);
}
function openChestPanel(title, chest, source) {
  openMousePanel(source);
  $('inv-panel').classList.add('hidden'); // chest UI carries its own inventory grid
  const panel = $('shop-panel');
  panel.classList.remove('hidden');
  const arrOf = (where) => where === 'chest' ? chest : (where === 'hot' ? P.hotbar : P.inv);
  const mkSlotEl = (stack, where, idx) => {
    const d = document.createElement('div');
    d.className = 'slot' + ((where === 'hot' && selSlot === idx) ? ' sel' : '');
    if (stack) {
      const def = ITEMS[stack.id];
      d.title = def.name;
      d.innerHTML = `<span class="ic">${itemIcon(stack.id)}</span><span class="lbl">${def.name}</span>${stack.n > 1 ? `<span class="cnt">${stack.n}</span>` : ''}` +
        (stack.dur && def.maxDur ? `<span class="dur"><i style="width:${stack.dur / def.maxDur * 100}%"></i></span>` : '');
    } else {
      d.innerHTML = `<span class="lbl">Empty</span>`;
    }
    d.draggable = true;
    d.dataset.where = where; d.dataset.idx = idx;
    d.ondragstart = (e) => {
      dragSrc = { where, idx };
      try { e.dataTransfer.setData('text/plain', where + ':' + idx); } catch { /* ignore */ }
      e.dataTransfer.effectAllowed = 'move';
    };
    d.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; d.classList.add('drag-over'); };
    d.ondragleave = () => d.classList.remove('drag-over');
    d.ondrop = (e) => {
      e.preventDefault();
      d.classList.remove('drag-over');
      if (!dragSrc || (dragSrc.where === where && dragSrc.idx === idx)) { dragSrc = null; return; }
      const a = arrOf(dragSrc.where), b = arrOf(where);
      const s = a[dragSrc.idx];
      if (s) {
        const t = b[idx];
        // Coins are currency, not an inventory stack: dragging them to
        // your side converts them to money (same as Take does).
        if ((where === 'hot' || where === 'inv') && s.id === 'money') { P.money += s.n; a[dragSrc.idx] = null; }
        else if (!t) { b[idx] = s; a[dragSrc.idx] = null; }
        else if (t.id === s.id && !ITEMS[s.id].tool) { t.n += s.n; a[dragSrc.idx] = null; } // merge stacks
        else { a[dragSrc.idx] = t; b[idx] = s; } // swap
      }
      dragSrc = null;
      dragDroppedAt = performance.now();
      render(); updateHUD(); saveGame();
    };
    d.ondragend = () => { dragSrc = null; dragDroppedAt = performance.now(); d.classList.remove('dragging'); };
    return d;
  };
  const render = () => {
    panel.innerHTML = `<div class="chest-ui"><h3>${title}</h3>
      <div class="chest-grid" id="chest-grid"></div>
      <p class="fine">Drag items between the chest and your inventory.</p>
      <h4>Your inventory</h4>
      <div class="player-grid" id="chest-player-grid"></div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" id="chest-take-all">Take All</button><button class="btn small ghost panel-close">Close</button></div></div>`;
    const cg = $('chest-grid');
    for (let i = 0; i < CHEST_SLOTS; i++) cg.appendChild(mkSlotEl(chest[i] || null, 'chest', i));
    const pg = $('chest-player-grid');
    for (let i = 0; i < 7; i++) pg.appendChild(mkSlotEl(P.hotbar[i] || null, 'hot', i));
    for (let i = 0; i < invCap(); i++) pg.appendChild(mkSlotEl(P.inv[i] || null, 'inv', i));
    $('chest-take-all').onclick = () => {
      for (let i = 0; i < chest.length; i++) {
        const s = chest[i];
        if (!s) continue;
        if (addItem(s.id, s.n)) chest[i] = null;
        else break; // inventory full — leave the rest in the chest
      }
      render(); updateHUD(); saveGame();
    };
  };
  render();
}

// ---------- Crafting / inventory UI ----------
function toggleInventory(force, opened) {
  const panel = $('inv-panel');
  const show = force !== undefined ? force : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !show);
  $('craft-list').innerHTML = '';
  if (show) {
    // A mouse menu: cursor out, look-around stopped.
    invOpened = opened || { by: 'mouse', key: null };
    document.exitPointerLock?.();
    // Craft mode is re-added by openCraft after this call; clearing it
    // here means a stale mode (quit, chest UI, any path that hid the
    // panel directly) can never leak into a plain inventory view.
    panel.classList.remove('craft-mode');
    renderInvGrid();
  } else {
    invOpened = null;
    craftOpened = null;
    panel.classList.remove('craft-mode');
  }
}
// Drag-to-reorder state: which panel slot a drag started from, and a
// timestamp so the click that follows a drop never also fires a
// click-action on the drop target.
let dragSrc = null, dragDroppedAt = 0;
function invArr(kind) { return kind === 'hot' ? P.hotbar : P.inv; }
function renderInvGrid() {
  const grid = $('inv-grid');
  grid.innerHTML = '';
  const mkSlot = (slot, idx, kind) => {
    const d = document.createElement('div');
    d.className = 'slot' + (kind === 'perm' ? ' perm' : '') + ((kind === 'hot' && selSlot === idx) || (kind === 'perm' && selSlot === 7 + idx) ? ' sel' : '');
    if (slot) {
      const def = ITEMS[slot.id];
      d.title = def.name; // full name on hover, even if a future name needs 3 lines
      d.innerHTML = `<span class="ic">${slot ? itemIcon(slot.id) : ''}</span><span class="lbl">${def.name}</span>${slot.n > 1 ? `<span class="cnt">${slot.n}</span>` : ''}` +
        (slot.dur && def.maxDur ? `<span class="dur"><i style="width:${slot.dur / def.maxDur * 100}%"></i></span>` : '');
    } else {
      d.innerHTML = `<span class="lbl">${kind === 'perm' ? 'Permanent' : 'Empty'}</span>`;
    }
    // Rearrangeable: drag any hotbar/normal slot onto another to swap
    // their contents (positions preserved, no compacting). Permanent
    // slots never appear in this panel, so they can never be dragged.
    d.draggable = true;
    d.dataset.kind = kind; d.dataset.idx = idx;
    d.ondragstart = (e) => {
      dragSrc = { where: kind, idx };
      try { e.dataTransfer.setData('text/plain', kind + ':' + idx); } catch { /* ignore */ }
      e.dataTransfer.effectAllowed = 'move';
      // Lightweight drag image: just the item icon, no slot chrome,
      // shadows, or blur — the full slot snapshot stuttered on weak
      // hardware and looked muddy mid-drag. The source slot dims so
      // it's clear the item is picked up.
      if (slot) {
        const ghost = document.createElement('div');
        ghost.innerHTML = itemIcon(slot.id);
        ghost.style.cssText = 'position:fixed;top:-100px;left:-100px;width:56px;height:56px;display:flex;align-items:center;justify-content:center;pointer-events:none;';
        document.body.appendChild(ghost);
        try { e.dataTransfer.setDragImage(ghost, 28, 28); } catch { /* ignore */ }
        setTimeout(() => ghost.remove(), 0);
      }
      d.classList.add('dragging');
    };
    d.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; d.classList.add('drag-over'); };
    d.ondragleave = () => d.classList.remove('drag-over');
    d.ondrop = (e) => {
      e.preventDefault();
      d.classList.remove('drag-over');
      // Chest-panel drags never land here (the chest UI handles its own
      // drops); only inventory-internal drags reorder this grid.
      if (!dragSrc || dragSrc.where === 'chest' || (dragSrc.where === kind && dragSrc.idx === idx)) { dragSrc = null; return; }
      const a = invArr(dragSrc.where), b = invArr(kind);
      const tmp = a[dragSrc.idx];
      a[dragSrc.idx] = b[idx];
      b[idx] = tmp;
      dragSrc = null;
      dragDroppedAt = performance.now();
      renderInvGrid(); updateHUD(); saveGame();
    };
    d.ondragend = () => { dragSrc = null; dragDroppedAt = performance.now(); d.classList.remove('dragging'); };
    d.onclick = () => {
      if (performance.now() - dragDroppedAt < 200) return; // just dropped — not a click
      if (kind === 'hot') { selSlot = idx; }
      else if (kind === 'perm') { selSlot = 7 + idx; }
      else if (slot) {
        // move into hotbar if there's room, else swap with selected hotbar slot
        const empty = P.hotbar.findIndex((s) => !s);
        if (P.hotbar.length < 7) { P.hotbar.push(slot); P.inv.splice(P.inv.indexOf(slot), 1); }
        else if (empty >= 0) { P.hotbar[empty] = slot; P.inv.splice(P.inv.indexOf(slot), 1); }
        else { const t = P.hotbar[selSlot < 7 ? selSlot : 0]; P.hotbar[selSlot < 7 ? selSlot : 0] = slot; P.inv[P.inv.indexOf(slot)] = t; }
      }
      renderInvGrid(); updateHUD();
    };
    return d;
  };
  for (let i = 0; i < 7; i++) grid.appendChild(mkSlot(P.hotbar[i] || null, i, 'hot'));
  for (let i = 0; i < invCap(); i++) grid.appendChild(mkSlot(P.inv[i] || null, i, 'inv'));
  // Permanent slots are NOT duplicated here — they live in the top hotbar row (8, 9, 0) only.
  const titleEl = $('inv-title');
  // Title follows the view: craft mode keeps its Workbench / Quick
  // Craft title even when updateHUD re-renders the grid underneath.
  if (titleEl) {
    titleEl.textContent = $('inv-panel').classList.contains('craft-mode')
      ? (craftOpened && craftOpened.quick ? 'Quick Craft' : 'Workbench')
      : (P.hasBackpack ? 'Backpack' : 'Inventory');
  }
  const note = document.createElement('p');
  note.className = 'fine';
  note.style.gridColumn = '1 / -1';
  note.textContent = P.hasBackpack
    ? `Backpack: 40 normal slots. Drag items to rearrange them. Permanent slots (car key, house key) live in the top bar — press 8, 9, 0 to select them.`
    : `13 normal slots — craft a Backpack (4 leather) to expand to 40. Drag items to rearrange them. Permanent slots (car key, house key) live in the top bar — press 8, 9, 0 to select them.`;
  grid.appendChild(note);
}
$('inv-close').onclick = () => { toggleInventory(false); requestGameLock(); };
$('btn-quickcraft').onclick = () => openCraft(true, { by: 'mouse', key: null });
// No remote workbench button: the normal workbench menu opens ONLY by
// interacting with a workbench object in the world (right-click it).
// Quick craft (Q / the button above) stays as the limited anywhere set.
// Workbench categories, LEGO Fortnite-style: one flat list is hard to
// scan, so recipes sit under category tabs. Same recipes, same costs.
let craftCat = 'All';
const CRAFT_CATS = [
  ['Tools', ['axe_stone', 'pickaxe_wood', 'pickaxe', 'shovel', 'hoe', 'backpack', 'phone', 'sword_wood', 'sword_stone', 'sword_iron']],
  ['Building', ['wall_wood', 'wall_brick', 'wall_steel', 'wall_window', 'wall_door', 'wall_ice', 'floor', 'roof']],
  ['Furniture', ['chest', 'house_kit']],
  ['Machines', ['workbench', 'vehicle_machine', 'gas_pump', 'portal_command']],
  ['Materials', ['glass', 'ice']],
];
function openCraft(quick, opened) {
  // Mouse-opened craft ignores the Q key; keyboard-opened craft
  // toggles shut on Q. A button click is a mouse open.
  toggleInventory(true, opened || invOpened || { by: 'mouse', key: null });
  // Craft-only view: the inventory grid (and its Quick craft button)
  // leave the box, so the craft list gets the full panel height.
  $('inv-panel').classList.add('craft-mode');
  $('inv-title').textContent = quick ? 'Quick Craft' : 'Workbench';
  craftOpened = { ...(opened || invOpened || { by: 'mouse', key: null }), quick: !!quick };
  const list = $('craft-list');
  list.innerHTML = `<h4>${quick ? 'Quick Craft (Anywhere)' : 'Workbench — Same Stuff at Every Workbench'}</h4>`;
  if (!quick) {
    const tabs = document.createElement('div');
    tabs.className = 'craft-tabs';
    for (const [name] of [['All'], ...CRAFT_CATS]) {
      const b = document.createElement('button');
      b.className = 'chip' + (craftCat === name ? ' sel' : '');
      b.textContent = name;
      b.onclick = () => { craftCat = name; openCraft(false, craftOpened); };
      tabs.appendChild(b);
    }
    list.appendChild(tabs);
  }
  renderCraftRows(quick);
}
// Rows live apart from the header/tabs so inventory changes refresh
// them: updateHUD re-renders rows whenever the craft panel is open,
// so the have/need counts can never go stale and show materials you
// already picked up as missing. This only rebuilds .craft-row nodes —
// the header and category tabs set above are left alone.
function renderCraftRows(quick) {
  const list = $('craft-list');
  list.querySelectorAll('.craft-row').forEach((r) => r.remove());
  let recipes = quick ? QUICK_RECIPES : RECIPES;
  if (!quick && craftCat !== 'All') {
    const ids = CRAFT_CATS.find(([n]) => n === craftCat)[1];
    recipes = recipes.filter(([id]) => ids.includes(id));
  }
  for (const [id, cost, label] of recipes) {
    const can = Object.entries(cost).every(([c, n]) => countOf(c) >= n);
    const row = document.createElement('div');
    row.className = 'craft-row';
    row.innerHTML = `<span><span class="ic sm">${itemIcon(id)}</span> ${label}</span><span class="cost">${Object.entries(cost).map(([c, n]) => `${countOf(c)}/${n} ${ITEMS[c].name}`).join(' · ')}</span><button class="btn small" ${can ? '' : 'disabled'}>Craft</button>`;
    row.querySelector('button').onclick = () => {
      // Atomic craft: never eat materials without giving the item.
      // addItem can fail on a full inventory, so snapshot what was
      // taken and refund it if the output doesn't land. (Costs are
      // all stackables, so the removal itself always frees the room
      // the refund needs.)
      const taken = [];
      for (const [c, n] of Object.entries(cost)) {
        const before = countOf(c);
        removeCount(c, n);
        taken.push([c, before - countOf(c)]);
      }
      if (id === 'backpack') {
        P.hasBackpack = true;
        toast('Backpack equipped! Normal inventory is now 40 slots.');
      } else if (id === 'phone') {
        // The phone is a permanent item: it goes to the third permanent
        // slot (key 0), never the inventory, and crafting a second one
        // refunds instead of consuming iron.
        if (P.perm[2]) {
          for (const [c, n] of taken) if (n > 0) addItem(c, n);
          toast('You already have a phone.');
        } else {
          P.perm[2] = { id: 'phone', n: 1 };
          toast('Phone equipped! Select it and right-click to open it.');
        }
      } else if (!addItem(id, 1)) {
        for (const [c, n] of taken) if (n > 0) addItem(c, n);
        if (!ITEMS[id]?.tool) toast('Inventory full — make room first.'); // tool outputs already toasted by pushToInv
      }
      openCraft(quick, craftOpened); updateHUD();
    };
    list.appendChild(row);
  }
}
function closePanels() {
  stopHoldAction();
  closeOpenChestLid();
  $('inv-panel').classList.add('hidden');
  $('inv-panel').classList.remove('craft-mode');
  $('shop-panel').classList.add('hidden');
  $('phone-panel').classList.add('hidden');
  $('help-panel').classList.add('hidden');
  $('craft-list').innerHTML = '';
  invOpened = null; craftOpened = null; helpOpened = null; shopOpened = null;
}

// ---------- HUD ----------
function buildHUDStatic() {
  const bar = $('hotbar');
  bar.innerHTML = '';
  for (let i = 0; i < 10; i++) {
    // A small dash separator between the normal hotbar slots (0–6)
    // and the permanent slots (7–9), so the two groups read apart.
    if (i === 7) {
      const sep = document.createElement('span');
      sep.className = 'hotbar-sep';
      sep.textContent = '-';
      bar.appendChild(sep);
    }
    const d = document.createElement('div');
    d.className = 'slot' + (i >= 7 ? ' perm' : '');
    d.dataset.slot = i;
    bar.appendChild(d);
  }
}
function updateHUD() {
  document.querySelectorAll('#hotbar .slot').forEach((d) => {
    const i = +d.dataset.slot;
    const slot = i < 7 ? P.hotbar[i] : P.perm[i - 7];
    d.classList.toggle('sel', selSlot === i);
    const keyLabel = i < 7 ? String(i + 1) : i === 7 ? '8' : i === 8 ? '9' : '0';
    if (slot) {
      const def = ITEMS[slot.id];
      d.title = def.name; // full name on hover
      d.innerHTML = `<span class="key">${keyLabel}</span><span class="ic">${slot ? itemIcon(slot.id) : ''}</span><span class="lbl">${def.name}</span>${slot.n > 1 ? `<span class="cnt">${slot.n}</span>` : ''}` +
        (slot.dur && def.maxDur ? `<span class="dur"><i style="width:${slot.dur / def.maxDur * 100}%"></i></span>` : '');
    } else {
      // Empty permanent slots show NOTHING but their key — no 'perm'
      // word, no label at all.
      d.title = '';
      d.innerHTML = `<span class="key">${keyLabel}</span><span class="lbl"></span>`;
    }
  });
  updateHUDDynamic();
  // Never rebuild the grid mid-drag: replacing the slot nodes under a
  // drag kills the drag image and flickers the panel. The drop handler
  // rebuilds right after the drop lands.
  if (!dragSrc && !$('inv-panel').classList.contains('hidden')) renderInvGrid();
  if (craftOpened && !$('inv-panel').classList.contains('hidden')) renderCraftRows(craftOpened.quick);
  syncBuildSel();
}
function updateHUDDynamic() {
  $('health-fill').style.width = Math.max(0, P.hp) + '%';
  $('health-num').textContent = Math.round(Math.max(0, P.hp));
  $('hunger-fill').style.width = Math.max(0, P.hunger) + '%';
  $('hunger-num').textContent = Math.round(Math.max(0, P.hunger));
  $('money').innerHTML = itemIcon('money') + ' ' + P.money;
  if (driving) $('fuel-fill').style.width = Math.max(0, driving.fuel) + '%';
}

// ---------- Chat / eat ----------
function openChat() {
  chatOpen = true;
  document.exitPointerLock?.();
  $('chat-input').classList.remove('hidden');
  $('chat-input').focus();
  renderChat();
}
function closeChat() {
  chatOpen = false;
  $('chat-input').classList.add('hidden');
  $('chat-input').value = '';
  requestGameLock();
}
function sendChat() {
  const v = $('chat-input').value.trim();
  if (v) chatMsg(S.session.username, v);
  closeChat();
}
$('chat-input').addEventListener('keydown', (e) => {
  if (e.code === 'Enter') sendChat();
  if (e.code === 'Escape') closeChat();
});
function eatSelected() {
  const sel = selectedItem();
  if (!sel) return;
  const food = { apple: 15, carrot: 10, wheat: 5 };
  if (!food[sel.id]) return;
  // No eating at full hunger — the item stays in your inventory.
  if (P.hunger >= 100) { toast('Hunger is already full!'); return; }
  P.hunger = Math.min(100, P.hunger + food[sel.id]);
  removeCount(sel.id, 1);
  chatMsg('System', `Ate ${ITEMS[sel.id].name} (+${food[sel.id]} hunger).`, true);
  updateHUD();
}

// ---------- Save / load ----------
function saveGame() {
  if (!W || travelFailed) return;
  // Player fields live on the base key so inventory, money, and health
  // carry BOTH ways between dimensions. World state (placed pieces,
  // crops, loot chests) is per-dimension: the normal world's state stays
  // on the base key, The Flipped's on a separate key — building in one
  // world never wipes the other. Old single-key saves load as the
  // normal world's state, unchanged.
  const player = { inv: P.inv, hotbar: P.hotbar, perm: P.perm, money: P.money, hp: P.hp, hunger: P.hunger, hasBackpack: P.hasBackpack, landOwned: P.landOwned };
  const worldState = {
    placed: placed.map((p) => ({ itemId: p.itemId, x: p.x, z: p.z, y: p.y, rotY: p.rotY || 0, color: p.color, contents: p.contents, hp: p.hp })),
    crops: crops.filter((c) => c.seed).map((c) => ({ x: c.x, z: c.z, seed: c.seed, planted: c.planted })),
    // Loot chest states, matched back by position on load (chest
    // placement is deterministic per seed, so positions are stable).
    chests: world ? world.chests.map((c) => ({ x: c.x, z: c.z, opened: !!c.opened, contents: c.contents || null })) : [],
  };
  if ((W.dim || 'normal') === 'normal') {
    save('somewhere_save_' + W.id, { ...player, ...worldState });
  } else {
    save('somewhere_save_' + W.id, { ...(load('somewhere_save_' + W.id, null) || {}), ...player });
    save('somewhere_save_' + W.id + '_flipped', { ...player, ...worldState });
  }
}
function loadSave() {
  const s = load('somewhere_save_' + W.id, null);
  // Starter kit: wooden axe, the weakest axe, just so you can chop wood
  P.hotbar = [{ id: 'axe_wood', n: 1, dur: ITEMS.axe_wood.maxDur }];
  P.inv = []; P.perm = [null, null, null]; P.money = 50; P.hp = 100; P.hunger = 100;
  if (!s) return;
  P.inv = s.inv || []; P.hotbar = s.hotbar?.length ? s.hotbar : P.hotbar;
  P.perm = s.perm || [null, null, null];
  P.money = s.money ?? 50; P.hp = s.hp ?? 100; P.hunger = s.hunger ?? 100;
  P.hasBackpack = !!s.hasBackpack; P.landOwned = !!s.landOwned;
  // Dimension world state: normal reads the base save; The Flipped
  // reads its own key, and a missing one means a fresh Flipped world.
  const ws = (W.dim || 'normal') === 'normal' ? s : load('somewhere_save_' + W.id + '_flipped', null);
  for (const p of (ws?.placed || [])) {
    const mesh = buildPieceMesh(p.itemId, p.color);
    mesh.position.set(p.x, p.y, p.z);
    mesh.rotation.y = p.rotY || 0; // saves from before facing shipped default to 0, as before
    scene.add(mesh);
    placed.push({ ...p, mesh, contents: p.contents || (p.itemId === 'chest' ? [] : undefined) });
  }
  for (const c of (ws?.crops || [])) {
    const y = groundY(c.x, c.z);
    const soil = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 0.95),
      new THREE.MeshStandardMaterial({ map: soilTex(), roughness: 1 }));
    soil.position.set(c.x, y + 0.06, c.z); scene.add(soil);
    crops.push({ x: c.x, z: c.z, y, seed: c.seed, planted: c.planted, stage: -1, mesh: soil, sprout: null });
  }
  // Restore loot chest contents/open state (unopened chests keep
  // their loot table and generate contents on first open).
  for (const sc of (ws?.chests || [])) {
    const c = world.chests.find((x) => x.x === sc.x && x.z === sc.z);
    if (!c) continue;
    c.opened = !!sc.opened;
    c.contents = sc.contents || null;
    // Lids start closed on load; opening the chest animates the hinge.
  }
}

// Car key / jerrycan work via the INTERACT path only (right-click / E) —
// never via left-click attack.
const _origInteract = doInteract;
doInteract = function (source) {
  const sel = selectedItem();
  if (target && target.kind === 'car' && sel && sel.id === 'car_key') {
    const car = target.ref;
    car.locked = !car.locked;
    car.winMat.color.set(car.locked ? 0xff5a5a : 0x5ed07a);
    car.winMat.emissive.set(car.locked ? 0x4a1010 : 0x1a4a1a);
    toast(car.locked ? 'Car locked — nobody gets in.' : 'Car unlocked — green window icon.');
    return;
  }
  if (target && target.kind === 'car' && sel && sel.id === 'jerrycan') {
    removeCount('jerrycan', 1);
    target.ref.fuel = 100;
    toast('Jerrycan used — tank max-filled.');
    updateHUD();
    return;
  }
  _origInteract(source);
};

// Left-click with no target and a hoe selected tills soil (with a swing).
const _origPrimary = onPrimaryAction;
onPrimaryAction = function () {
  if (buildMode) { placeGhostPiece(); return; }
  const sel = selectedItem();
  if (!target) {
    if (sel && ITEMS[sel.id]?.tool === 'hoe') { triggerSwing(); tillSoil(); return; }
    return;
  }
  _origPrimary();
};

// Debug hook for headless verification (no UI, no gameplay effect)
window.__debug = {
  get P() { return P; },
  get world() { return world; },
  get placed() { return placed; },
  get ghostRot() { return ghost ? ghost.rotation.y : null; },
  get ghostValid() { return ghost ? !!ghost.userData.valid : null; },
  get cars() { return cars; },
  get target() { return target; },
  addItem, countOf, selectedItem,
  get selSlot() { return selSlot; },
  doPrimary: () => onPrimaryAction(),
  doInteract: () => doInteract(),
  save: () => saveGame(),
  hold: () => startHoldAction(),
  holding: () => holdTimer !== null,
  openLoot: (c) => openLootChest(c, 'key'),
  openStore: (p) => openStorage(p, 'key'),
  place: () => placeGhostPiece(),
  setBuild: (on) => setBuildMode(on),
  vehiclePanel: (m) => openVehiclePanel(m),
  heightAt, biomeAt, groundY,
  swing: () => triggerSwing(),
  swingProgress: () => (swingStart ? Math.min(1, (performance.now() - swingStart) / swingDur) : 1),
  setSwingDur: (v) => { swingDur = v; },
  swingAt: (msAgo) => { swingStart = performance.now() - msAgo; },
  closePause: () => closePause(),
  // Debug-only lid-animation speed (headless verification: the live
  // 350ms window is too short to catch mid-flight when software
  // rendering makes frames sparse). No UI or gameplay effect.
  setLidMs: (v) => { LID_ANIM_MS = v; },
  get sprinting() { return doubleTapSprint; },
  openPause: () => openPause(),
  openPauseSettings: () => openPauseSettings(),
  get pauseOpen() { return pauseOpen; },
  get pauseSettingsOpen() { return pauseSettingsOpen; },
  get targetRing() { return targetRing; },
};
