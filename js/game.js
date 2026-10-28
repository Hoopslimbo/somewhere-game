import * as THREE from 'three';
import { buildCharacter } from './character.js';
import { buildWorld, heightAt, biomeAt, makeSkyDome } from './world.js';
import { ITEMS, RECIPES, QUICK_RECIPES, cleanText, load, save } from './data.js';
import { itemIcon } from './icons.js';

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
// How each menu was opened: { by: 'key'|'mouse', key: code|null }.
// A menu closes on its open key ONLY if it was opened by the keyboard
// with that same key — mouse-opened menus ignore the key.
let invOpened = null, buildOpened = null, helpOpened = null, craftOpened = null, shopOpened = null;
let targetRing = null;

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

// ---------- Inventory ----------
function invCap() { return P.hasBackpack ? 40 : 10; }
function countOf(id) {
  let n = 0;
  for (const s of [...P.inv, ...P.hotbar]) if (s && s.id === id) n += s.n;
  return n;
}
function addItem(id, n = 1) {
  if (id === 'money') { P.money += n; updateHUD(); return true; }
  const def = ITEMS[id];
  if (def && def.tool) { // tools don't stack
    for (let i = 0; i < n; i++) {
      const slot = { id, n: 1, dur: def.maxDur };
      if (!pushToInv(slot)) return false;
    }
    updateHUD(); return true;
  }
  for (const s of [...P.inv, ...P.hotbar]) {
    if (s && s.id === id) { s.n += n; updateHUD(); return true; }
  }
  if (!pushToInv({ id, n })) return false;
  updateHUD(); return true;
}
function pushToInv(slot) {
  if (P.hotbar.length < 7) { P.hotbar.push(slot); return true; }
  if (P.inv.length < invCap()) { P.inv.push(slot); return true; }
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
window.startGame = function (worldDef) {
  W = worldDef;
  started = true;
  // Fresh run state: re-entering a world (e.g. via pause → lobby →
  // Play) must not carry stale placed pieces, cars, crops, or drops.
  placed = []; cars = []; crops = []; drops = [];
  driving = null; buildMode = false; chatOpen = false; pauseOpen = false;
  $('pause-menu').classList.add('hidden');
  $('shop-panel').classList.add('hidden');
  $('inv-panel').classList.add('hidden');
  const params = new URLSearchParams(location.search);
  if (params.get('time') === 'night') time = 22 / 24 * 1800;
  if (params.get('time') === 'day') time = 10 / 24 * 1800;
  initScene();
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
      placed.push({ itemId, x, z, y, rotY: 0, color: paintColor, mesh, contents: itemId === 'chest' ? [] : undefined });
    }
  }
  buildHUDStatic();
  updateHUD();
  chatMsg('System', `Welcome to ${W.name}! Chop trees with your wooden axe. Press H for help.`, true);
  if (params.get('shot') === 'inventory') setTimeout(() => toggleInventory(true), 800);
  if (params.get('shot') === 'build') setTimeout(() => setBuildMode(true), 800);
  clock = new THREE.Clock();
  loop();
};

function initScene() {
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

  world = buildWorld(scene, W.seed);
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
// interact (chests, benches, shops, cars). E still interacts too.
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
    if (e.code === 'Escape') {
      if (pauseSettingsOpen) { backToPauseMenu(); return; }
      if (pauseOpen) { closePause(); return; }
      if (!$('inv-panel').classList.contains('hidden') || !$('shop-panel').classList.contains('hidden') ||
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
    if (e.code === kb.chat || e.code === 'KeyC') { openChat(); return; }
    if (e.code === kb.inventory) {
      if (!$('inv-panel').classList.contains('hidden')) {
        // Same-key close ONLY if the keyboard opened it with this key.
        if (invOpened && invOpened.by === 'key' && invOpened.key === kb.inventory) toggleInventory(false);
      } else toggleInventory(true, { by: 'key', key: kb.inventory });
      return;
    }
    if (e.code === kb.build) {
      if (buildMode) {
        if (buildOpened && buildOpened.by === 'key' && buildOpened.key === kb.build) setBuildMode(false);
      } else setBuildMode(true, { by: 'key', key: kb.build });
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
    if (e.code === 'KeyF') { eatSelected(); }
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
        !$('pause-menu').classList.contains('hidden')) return;
    if (!locked) {
      try { $('game-canvas').requestPointerLock(); } catch { /* ignore */ }
      return;
    }
    if (e.button === 0) {
      if (buildMode) { placeGhostPiece(); return; }
      // Chop/mine need a HOLD, not a spam-click (see startHoldAction).
      if (target && (target.kind === 'tree' || target.kind === 'rock')) { startHoldAction(); return; }
      onPrimaryAction();
    } else if (e.button === 2) {
      // In build mode RIGHT-click PLACES, exactly like left-click —
      // it used to exit build mode, which is why Liam's
      // right-click-to-place cancelled instead of placing. Exiting
      // build mode is B or switching to a non-building item only —
      // Esc opens the pause menu instead (see setBuildMode toast).
      if (buildMode) { placeGhostPiece(); return; }
      doInteract('mouse');
    }
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === $('game-canvas');
  });
  // Releasing left click always ends a chop/mine hold, wherever the
  // release happens (including over a panel or outside the window).
  document.addEventListener('mouseup', (e) => { if (e.button === 0) stopHoldAction(); });
  window.addEventListener('blur', stopHoldAction);
  document.addEventListener('wheel', (e) => {
    if (!started || chatOpen) return;
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
    requestGameLock();
  });
  $('btn-pause').onclick = () => openPause();
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

function renderHelp() {
  $('help-panel').innerHTML = `<h3>How to play</h3>
  <p><b>WASD</b> move · <b>Double-tap W</b> sprint (hold W) · <b>Mouse</b> look · <b>Space</b> jump<br>
  <b>Right-click</b> (or <b>E</b>) interact · <b>Hold left-click</b> to chop / mine · <b>Left- or right-click</b> place in build mode · <b>B</b> or switch to a non-building item exits build mode<br>
  <b>1–7</b> hotbar · <b>8, 9, 0</b> permanent slots (car key, house key) · <b>Scroll</b> switch slot<br>
  <b>I</b> backpack · <b>B</b> build mode · <b>Q</b> quick craft · <b>C</b> or <b>T</b> chat · <b>F</b> eat selected food · <b>Esc</b> menu · <b>H</b> this help</p>
  <p>Start: chop trees with your wooden axe. Use the gold bench near spawn to craft walls, tools and machines. Place a vehicle machine, craft a car, and your car key appears in a permanent slot. Watch hunger — eat apples to stay full and regen health.</p>`;
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
function backToLobby() {
  pauseOpen = false; pauseSettingsOpen = false;
  $('pause-menu').classList.add('hidden');
  $('pause-settings').classList.add('hidden');
  if (RAF) { cancelAnimationFrame(RAF); RAF = null; }
  started = false;
  saveGame();
  $('game-screen').classList.add('hidden');
  if (S.showLobby) S.showLobby();
  else $('lobby-screen').classList.remove('hidden');
}

// ---------- Loop ----------
function loop() {
  RAF = requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  updateDayNight(dt);
  if (!P.dead) {
    if (driving) updateDriving(dt);
    else updatePlayer(dt);
  }
  updateCrops(dt);
  updateDrops(dt);
  updateCarsVisual(dt);
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
  const dayness = hour > 6 && hour < 19 ? 1 : hour >= 5 && hour <= 6 ? (hour - 5) : hour >= 19 && hour <= 20 ? (20 - hour) : 0;
  const dusk = (hour >= 5 && hour <= 7) ? 1 - Math.abs(hour - 6) : (hour >= 18 && hour <= 20) ? 1 - Math.abs(hour - 19) : 0;
  const sky = scene.userData.sky;
  if (sky) {
    sky.material.uniforms.topColor.value.set(0x050914).lerp(new THREE.Color(0x3d7ac8), dayness);
    sky.material.uniforms.horizonColor.value.set(0x0e1626).lerp(new THREE.Color(0xcfe4f5), dayness);
    if (dusk > 0) sky.material.uniforms.horizonColor.value.lerp(new THREE.Color(0xffb37a), dusk * 0.55);
    scene.fog.color.copy(sky.material.uniforms.horizonColor.value);
  }
  scene.userData.sun.intensity = 0.25 + dayness * 1.3;
  scene.userData.sun.color.set(0xfff2cc).lerp(new THREE.Color(0xff9a4d), dusk * 0.7);
  if (scene.userData.hemi) scene.userData.hemi.intensity = 0.35 + dayness * 0.6;
  // No day display in the HUD — the top right stays clean by design.
  // Hunger drain + regen
  P.hunger = Math.max(0, P.hunger - 0.05 * (1 / 60) * 60 * 0.016); // ~1 per 20s, frame-rate independent-ish
}
function groundY(x, z, yHint) {
  const h = heightAt(x, z, W.seed);
  // Cave floors: the terrain IS carved now (a tunnel notch in the
  // hillside), so heightAt already returns the tunnel floor inside a
  // cave. This branch is a safety net for the chamber: it must only
  // apply when the caller is actually below the hillside surface
  // (walking inside) — otherwise a player walking on TOP of the tunnel
  // roof would snap down through it (the phase-through bug). Callers
  // at ground level (drops, placement) pass no hint and get the old
  // floor behavior; the player/car pass their current height.
  // Local axes: +z points OUT of the mouth, -z runs into the hill for
  // c.len units; the floor descends 0.12 per unit into the hill.
  if (world && world.caves) {
    for (const c of world.caves) {
      const dx = x - c.x, dz = z - c.z;
      const lx = dx * Math.cos(c.facing) - dz * Math.sin(c.facing);
      const lz = dx * Math.sin(c.facing) + dz * Math.cos(c.facing);
      if (Math.abs(lx) < 2.1 && lz > -(c.len || 2.8) && lz < 2.9) {
        if (yHint === undefined || yHint < h - 1.2) {
          return Math.max(c.floorY - lz * (c.slope || 0), -0.35);
        }
      }
    }
  }
  return Math.max(h, -0.35); // wade in shallows; deep water just floors out in v1
}

// ---------- Player ----------
function updatePlayer(dt) {
  const kb = S.keybinds;
  // Sprint: Shift, or a double-tap of forward held down (see bindInput).
  const speed = (keys['ShiftLeft'] || keys['ShiftRight'] || (doubleTapSprint && keys[kb.forward])) ? 9 : 6;
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
  camera.position.set(P.pos.x, P.pos.y + 1.65, P.pos.z);
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
  const wood = M(0x8a5a2b), woodDk = M(0x5a3a1a), steel = M(0xb8bcc2, 0.35, 0.6), steelDk = M(0x6e7278, 0.45, 0.6);
  switch (id) {
    case 'wood': { // lying log with end rings
      cyl(0.13, 0.13, 0.55, wood, 0, 0, 0, 0, 0, Math.PI / 2, 12);
      cyl(0.135, 0.135, 0.02, M(0xc8a87e), -0.28, 0, 0, 0, 0, Math.PI / 2, 12);
      cyl(0.135, 0.135, 0.02, M(0xc8a87e), 0.28, 0, 0, 0, 0, Math.PI / 2, 12);
      break; }
    case 'stone': case 'ground_stone': {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22), M(0x8d8f94, 1));
      rock.scale.y = 0.75; rock.castShadow = true; g.add(rock); break; }
    case 'iron': bx(0.34, 0.12, 0.2, M(0x9aa0a8, 0.3, 0.85)); bx(0.26, 0.06, 0.16, M(0xc8ccd2, 0.25, 0.9), 0, 0.09, 0); break;
    case 'apple': sph(0.17, M(0xe5484d, 0.5), 0, 0.02, 0); cyl(0.015, 0.02, 0.12, woodDk, 0.03, 0.2, 0, 0, 0, 0.3); bx(0.12, 0.02, 0.07, M(0x46a758, 0.7), 0.09, 0.2, 0, 0, 0, 0.4); break;
    case 'wheat': for (const sx of [-0.07, 0, 0.07]) { cyl(0.012, 0.012, 0.42, M(0xe8c95a, 0.8), sx, 0.1, 0, 0, 0, sx * 1.2); bx(0.05, 0.16, 0.05, M(0xf5c542, 0.8), sx, 0.32, 0); } break;
    case 'carrot': { const c = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 8), M(0xe87a1a, 0.7)); c.rotation.x = Math.PI; c.position.y = -0.02; g.add(c); bx(0.03, 0.16, 0.03, M(0x46a758, 0.7), 0, 0.2, 0, 0.3, 0, 0); bx(0.03, 0.14, 0.03, M(0x46a758, 0.7), 0.04, 0.19, 0, 0.2, 0, -0.4); break; }
    case 'seed_wheat': case 'seed_carrot': bx(0.3, 0.22, 0.06, M(0xd8cbb8, 0.9)); bx(0.3, 0.07, 0.065, M(id === 'seed_wheat' ? 0xe8c95a : 0xe87a1a, 0.8), 0, 0.05, 0); break;
    case 'leather': bx(0.42, 0.05, 0.3, M(0x7a4a22, 0.95)); bx(0.3, 0.055, 0.2, M(0x8a5a2b, 0.95), 0, 0.01, 0); break;
    case 'sandbag': sph(0.22, M(0xd8c08a, 1), 0, 0, 0, 1.2, 0.6, 0.8); break;
    case 'snowbag': sph(0.22, M(0xffffff, 0.9), 0, 0, 0, 1.2, 0.6, 0.8); break;
    case 'glass': bx(0.34, 0.3, 0.04, new THREE.MeshStandardMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.6, roughness: 0.1 })); break;
    case 'ice': bx(0.3, 0.3, 0.3, new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.85, roughness: 0.2 })); break;
    case 'money': cyl(0.16, 0.16, 0.05, M(0xf5c542, 0.35, 0.8), 0, 0, 0, Math.PI / 2.4, 0, 0, 16); break;
    case 'axe_wood': case 'axe_stone': bx(0.05, 0.5, 0.05, wood, 0, 0, 0, 0, 0, 0.5); bx(0.16, 0.14, 0.04, id === 'axe_wood' ? woodDk : steelDk, 0.12, 0.22, 0, 0, 0, 0.5); break;
    case 'pickaxe_wood': case 'pickaxe': bx(0.05, 0.5, 0.05, wood, 0, 0, 0, 0, 0, 0.5); bx(0.3, 0.05, 0.05, id === 'pickaxe_wood' ? woodDk : steel, 0, 0.24, 0, 0, 0, 0.5); break;
    case 'shovel': bx(0.05, 0.5, 0.05, wood, 0, 0.05, 0, 0, 0, 0.5); bx(0.16, 0.22, 0.03, steel, 0.1, -0.22, 0, 0, 0, 0.5); break;
    case 'hoe': bx(0.05, 0.5, 0.05, wood, 0, 0, 0, 0, 0, 0.5); bx(0.2, 0.12, 0.03, steel, 0.1, 0.22, 0, 0, 0, 0.5); break;
    case 'car_key': { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 14), M(0xf5c542, 0.35, 0.8)); ring.position.set(-0.1, 0.05, 0); g.add(ring); bx(0.2, 0.07, 0.04, M(0xf5c542, 0.35, 0.8), 0.08, 0.05, 0); bx(0.05, 0.05, 0.04, M(0xf5c542, 0.35, 0.8), 0.19, -0.02, 0); break; }
    case 'house_key': { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 14), M(0xd8b25a, 0.4, 0.7)); ring.position.set(-0.1, 0.05, 0); g.add(ring); bx(0.2, 0.07, 0.04, M(0xd8b25a, 0.4, 0.7), 0.08, 0.05, 0); break; }
    case 'backpack': bx(0.34, 0.4, 0.2, M(0x6e56cf, 0.85)); bx(0.36, 0.1, 0.22, M(0x5a45b0, 0.85), 0, 0.18, 0); break;
    case 'jerrycan': bx(0.3, 0.36, 0.16, M(0xe5484d, 0.6)); bx(0.16, 0.05, 0.05, M(0x1a1a1a, 0.7), 0, 0.2, 0); break;
    case 'chest': bx(0.44, 0.24, 0.28, wood); bx(0.44, 0.1, 0.28, woodDk, 0, 0.16, 0); break;
    case 'workbench': bx(0.5, 0.06, 0.3, wood, 0, 0.12, 0); bx(0.05, 0.24, 0.05, woodDk, -0.2, 0, 0.1); bx(0.05, 0.24, 0.05, woodDk, 0.2, 0, 0.1); break;
    case 'wall_wood': case 'wall_brick': case 'wall_steel': case 'wall_window': case 'wall_door': case 'wall_ice':
      bx(0.44, 0.44, 0.06, M(id === 'wall_brick' ? 0x9a5a48 : id === 'wall_steel' ? 0xd8dde2 : id === 'wall_ice' ? 0xbfe8ff : 0x8a5a2b, 0.9)); break;
    case 'floor': bx(0.44, 0.05, 0.44, wood); break;
    case 'roof': { const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.2, 4), M(0xa34a3a, 0.9)); cone.rotation.y = Math.PI / 4; cone.castShadow = true; g.add(cone); break; }
    default: bx(0.32, 0.32, 0.32, M(0xd8b25a, 0.8));
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
    const d = Math.hypot(P.pos.x - drops[i].x, P.pos.z - drops[i].z);
    if (d < 1.2 && Math.abs(P.pos.y - drops[i].mesh.position.y) < 2) {
      if (addItem(drops[i].id, drops[i].n)) {
        chatMsg('System', `Picked up ${drops[i].n}× ${ITEMS[drops[i].id].name}.`, true);
        scene.remove(drops[i].mesh); drops.splice(i, 1);
      }
    }
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
  const woodM = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.85 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.9 });
  const steelM = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.6 });
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x6e7278, roughness: 0.45, metalness: 0.6 });
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
  const headMat = () => new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.5, metalness: 0.15 });
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
    new THREE.MeshStandardMaterial({ color: 0x6e7073, roughness: 1 }));
  rockMesh.scale.y = 0.78;
  rock.add(rockMesh);
  viewmodels.rock = rock;
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
  const tool = sel ? (sel.id === 'ground_stone' ? 'rock' : ITEMS[sel.id]?.tool) : null;
  const show = !driving && !buildMode && !!tool && viewmodels[tool];
  // Head color matches the inventory identity: wooden axe = red head
  // like its axe icon, stone tools = gray steel, wooden pickaxe = brown.
  const HEAD_COLORS = { axe_wood: 0xc8452f, axe_stone: 0xb8bcc2, pickaxe_wood: 0x8a5a2b, pickaxe: 0xb8bcc2, shovel: 0xb8bcc2, hoe: 0xb8bcc2 };
  if (sel && viewmodels[tool] && viewmodels[tool].userData.headMat) {
    viewmodels[tool].userData.headMat.color.set(HEAD_COLORS[sel.id] ?? 0xb8bcc2);
  }
  // Item-use animation: a swing is a visible raise-and-strike over
  // ~0.35s, applied to whichever tool is held. Without this the tool
  // just sat static while chopping/mining.
  const swingP = swingStart ? Math.min(1, (performance.now() - swingStart) / swingDur) : 1;
  const swingCurve = swingP < 1 ? Math.sin(swingP * Math.PI) : 0;
  for (const [k, g] of Object.entries(viewmodels)) {
    g.userData.active = (k === tool);
    g.visible = !!show && k === tool;
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
  const eye = new THREE.Vector3(P.pos.x, P.pos.y + 1.65, P.pos.z);
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
  for (const t of world.trees) consider(t.x, t.h + t.trunkH * 0.6, t.z, Math.max(1.0, 1.1 * (t.scale || 1)), { kind: 'tree', ref: t });
  for (const r of world.rocks) consider(r.x, r.h + 0.6, r.z, (r.radius || 0.7) + 0.35, { kind: 'rock', ref: r });
  for (const s of world.groundStones) consider(s.x, s.h + 0.2, s.z, 0.55, { kind: 'groundstone', ref: s });
  // Loot chests stay targetable after opening, so you can reopen one
  // to take leftovers or put your own items back in.
  for (const c of world.chests) consider(c.x, c.h + 0.6, c.z, 1.0, { kind: 'chest', ref: c });
  for (const it of world.interactables) {
    const rad = it.type === 'goldbench' ? 1.7 : it.type === 'shop' ? 2.4 : 1.9;
    consider(it.x, groundY(it.x, it.z) + 1, it.z, rad, { kind: it.type, ref: it });
  }
  for (const p of placed) consider(p.x, p.y + 1, p.z, 1.6, { kind: 'placed', ref: p });
  for (const car of cars) if (!car.broken) consider(car.group.position.x, car.group.position.y + 0.8, car.group.position.z, 2.1, { kind: 'car', ref: car });
  for (const pl of crops) consider(pl.x, groundY(pl.x, pl.z) + 0.3, pl.z, 0.65, { kind: 'crop', ref: pl });
  return best;
}
function targetLabel(t) {
  // Unmistakable affordance: the verb AND the button, per target.
  // LEFT = attack/chop/mine, RIGHT = interact — never just "click".
  switch (t.kind) {
    case 'tree': return 'Tree — Hold left click to chop';
    case 'rock': return t.ref.iron ? 'Iron ore — Hold left click to mine (needs pickaxe)' : 'Stone — Hold left click to mine (needs pickaxe)';
    case 'groundstone': return 'Stone — Right click to pick up';
    case 'chest': return (t.ref.contents && t.ref.contents.length === 0) ? 'Empty loot chest — Right click to open' : 'Loot chest — Right click to open';
    case 'goldbench': return 'Gold bench — Right click to craft (unbreakable)';
    case 'shop': return 'Shop — Right click to buy & sell';
    case 'carshop': return 'Car shop — Right click to repair or trade in';
    case 'landoffice': return P.landOwned ? 'Your land office' : 'Land office — Right click to buy land (100 coins)';
    case 'placed': {
      const use = { vehicle_machine: 'Vehicle machine — Right click to build a car', gas_pump: 'Gas pump — Right click to refuel', chest: 'Storage chest — Right click to open', workbench: 'Workbench — Right click to craft' };
      return use[t.ref.itemId] || `${ITEMS[t.ref.itemId]?.name || 'Structure'} — Left click to smash`;
    }
    case 'car': return t.ref.locked ? 'Locked car' : 'Car — Right click to drive';
    case 'crop': return t.ref.stage >= 3 ? `${t.ref.seed === 'seed_wheat' ? 'Wheat' : 'Carrot'} ready — Left click to harvest` : 'Growing crop';
    default: return '';
  }
}
function targetBasePos(t) {
  // Ground position + radius for the highlight ring.
  switch (t.kind) {
    case 'tree': return { x: t.ref.x, z: t.ref.z, r: Math.max(0.9, (t.ref.radius || 0.6) + 0.5) };
    case 'rock': return { x: t.ref.x, z: t.ref.z, r: (t.ref.radius || 0.7) + 0.5 };
    case 'groundstone': return { x: t.ref.x, z: t.ref.z, r: 0.55 };
    case 'chest': return { x: t.ref.x, z: t.ref.z, r: 1.1 };
    case 'car': return { x: t.ref.group.position.x, z: t.ref.group.position.z, r: 2.4 };
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
    el.textContent = targetLabel(target);
    el.classList.remove('hidden');
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

// ---------- Hold to chop / mine ----------
// Chopping and mining require HOLDING left click: hits repeat while
// held and stop on release. A lone click does NOTHING — the first hit
// only fires 260ms into a continuous hold, so spam-clicking can never
// chop a tree or mine a rock. Smash/harvest/hoe stay single-click.
let holdTimer = null, holdKind = null, holdRef = null;
function startHoldAction() {
  if (!target || (target.kind !== 'tree' && target.kind !== 'rock')) return;
  stopHoldAction();
  holdKind = target.kind; holdRef = target.ref;
  const tick = () => {
    // Still holding the SAME tree/rock, still in the world, with a
    // valid tool? Anything else ends the hold with no progress.
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
    holdTimer = setTimeout(tick, 420); // repeat swings while held
  };
  holdTimer = setTimeout(tick, 260);
}
function stopHoldAction() {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  holdKind = null; holdRef = null;
}

// ---------- Primary action (LEFT click: attack / chop / mine) ----------
function onPrimaryAction() {
  if (buildMode) { placeGhostPiece(); return; }
  if (!target) return;
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
    triggerSwing();
    smashPlaced(target.ref);
  } else if (target.kind === 'crop') {
    harvestCrop(target.ref);
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
  } else if (target.kind === 'placed') {
    const p = target.ref;
    if (p.itemId === 'vehicle_machine') openVehiclePanel(p, source);
    else if (p.itemId === 'gas_pump') refuelNearCar(p);
    else if (p.itemId === 'chest') openStorage(p, source);
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
    scene.remove(t.group);
    world.trees = world.trees.filter((x) => x !== t);
    const wood = 2 + Math.floor(Math.random() * 3);
    addItem('wood', wood);
    if (Math.random() < 0.3) { addItem('apple', 1); }
    // The ground stone survives the whole tree (multiple hits) and
    // breaks ONLY now, when the tree is fully chopped — never after a
    // single swing.
    if (isTempStone) {
      const arr = selSlot < 7 ? P.hotbar : P.perm;
      const idx = selSlot < 7 ? selSlot : selSlot - 7;
      if (arr[idx] && arr[idx].id === 'ground_stone') {
        arr[idx] = null;
        if (selSlot < 7) P.hotbar = P.hotbar.filter(Boolean);
      }
      toast('Your stone broke apart.');
    }
  } else {
    t.group.scale.setScalar((t.scale || 1) * (1 - (3 - t.hp) * 0.06));
    t.group.rotation.z = (3 - t.hp) * 0.03;
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
    if (r.iron) { addItem('iron', 2); }
    else { addItem('stone', 3); }
  }
  updateHUD();
}
function smashPlaced(p) {
  scene.remove(p.mesh);
  placed = placed.filter((x) => x !== p);
  // Debris gives back a few materials, never more than the piece was made of
  const back = { wall_wood: ['wood', 1], wall_brick: ['stone', 1], wall_steel: ['iron', 1], wall_window: ['wood', 1], wall_door: ['wood', 1], wall_ice: ['ice', 1], floor: ['wood', 1], roof: ['wood', 1] };
  const b = back[p.itemId];
  if (b) { addItem(b[0], b[1]); chatMsg('System', `Smashed! Recovered ${b[1]}× ${ITEMS[b[0]].name}.`, true); }
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
function grainTex() {
  return canvasTex('grain', (x) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 46; i++) {
      x.fillStyle = `rgba(90,60,30,${0.05 + Math.random() * 0.10})`;
      x.fillRect(0, Math.random() * 256, 256, 1 + Math.random() * 3);
    }
    for (let i = 0; i < 3; i++) {
      const kx = 30 + Math.random() * 196, ky = 30 + Math.random() * 196;
      x.strokeStyle = 'rgba(90,60,30,0.25)'; x.lineWidth = 2;
      x.beginPath(); x.ellipse(kx, ky, 8, 5, 0, 0, Math.PI * 2); x.stroke();
      x.beginPath(); x.ellipse(kx, ky, 3.5, 2, 0, 0, Math.PI * 2); x.stroke();
    }
  });
}
function brickTex() {
  return canvasTex('brick', (x) => {
    x.fillStyle = '#e8e0d0'; x.fillRect(0, 0, 256, 256); // mortar
    for (let r = 0; r < 8; r++) {
      const off = (r % 2) * -32;
      for (let cx = -1; cx < 5; cx++) {
        const v = 200 + Math.floor(Math.random() * 40);
        x.fillStyle = `rgb(${v},${v - 18},${v - 28})`;
        x.fillRect(cx * 64 + off + 2, r * 32 + 2, 60, 28);
        x.fillStyle = 'rgba(0,0,0,0.08)';
        x.fillRect(cx * 64 + off + 2, r * 32 + 24, 60, 6);
      }
    }
  });
}
function shingleTex() {
  return canvasTex('shingle', (x) => {
    x.fillStyle = '#d8d8d8'; x.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 8; r++) {
      const off = (r % 2) * -21;
      for (let cx = -1; cx < 7; cx++) {
        const v = 175 + Math.floor(Math.random() * 45);
        x.fillStyle = `rgb(${v},${v},${v + 5})`;
        x.fillRect(cx * 42 + off + 1, r * 32 + 1, 40, 30);
        x.fillStyle = 'rgba(0,0,0,0.18)';
        x.fillRect(cx * 42 + off + 1, r * 32 + 27, 40, 4);
      }
    }
  });
}
function brushedTex() {
  return canvasTex('brushed', (x) => {
    x.fillStyle = '#f0f0f0'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 120; i++) {
      x.fillStyle = `rgba(120,125,135,${0.04 + Math.random() * 0.06})`;
      x.fillRect(Math.random() * 256, 0, 1, 256);
    }
  });
}

function buildPieceMesh(itemId, colorOverride) {
  const g = new THREE.Group();
  const pc = colorOverride || paintColor;
  const matFor = (base, steel) => {
    const pcc = new THREE.Color(pc), bc = new THREE.Color(base);
    return new THREE.MeshStandardMaterial({ color: steel ? pcc : bc.lerp(pcc, 0.45), roughness: 0.9 });
  };
  const matTex = (base, steel, tex, rough = 0.9, metal = 0) => {
    const pcc = new THREE.Color(pc), bc = new THREE.Color(base);
    return new THREE.MeshStandardMaterial({ map: tex, color: steel ? pcc : bc.lerp(pcc, 0.45), roughness: rough, metalness: metal });
  };
  const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh; };
  if (itemId.startsWith('wall_')) {
    const kind = itemId.slice(5);
    if (kind === 'window') {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 3, 0.3), matFor(0x8a5a2b)), -1.15, 1.5, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 3, 0.3), matFor(0x8a5a2b)), 1.15, 1.5, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 0.3), matFor(0x8a5a2b)), 0, 2.65, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 0.3), matFor(0x8a5a2b)), 0, 0.35, 0);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.55, roughness: 0.1 }));
      add(glass, 0, 1.5, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.16), matFor(0x6b4226)), 0, 1.5, 0); // center mullion
      add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.16), matFor(0x6b4226)), 0, 1.5, 0); // cross mullion
      add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.10, 0.45), matFor(0x6b4226)), 0, 0.32, 0); // protruding sill
      add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.10, 0.36), matFor(0x6b4226)), 0, 2.72, 0); // header trim
    } else if (kind === 'door') {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 3, 0.3), matFor(0x8a5a2b)), -1.05, 1.5, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 3, 0.3), matFor(0x8a5a2b)), 1.05, 1.5, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.3), matFor(0x8a5a2b)), 0, 2.6, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.15), new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.9 })), 0, 1.1, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.03), matFor(0x4a3220)), 0, 1.75, 0.09); // upper door panel
      add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.03), matFor(0x4a3220)), 0, 0.65, 0.09); // lower door panel
      add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.16, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a1e10 })), -0.52, 1.6, 0.10); // hinges
      add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.16, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a1e10 })), -0.52, 0.6, 0.10);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf5c542, metalness: 0.6, roughness: 0.35 }));
      add(knob, 0.42, 1.1, 0.12); // doorknob
      add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.10, 0.5), matFor(0x6b4226)), 0, 0.05, 0.05); // threshold step
    } else if (kind === 'ice') {
      add(new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.3),
        new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.85, roughness: 0.2 })), 0, 1.5, 0);
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
    const topM = matTex(0x8a5a2b, false, grainTex()), legM = matFor(0x6b4226), darkM = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1 });
    add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 1.0), topM), 0, 0.92, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.05, 1.06), darkM), 0, 0.85, 0); // edge trim under the slab
    add(new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.14, 0.06), legM), 0, 0.74, 0.40); // front apron
    add(new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.14, 0.06), legM), 0, 0.74, -0.40); // back apron
    for (const sx of [-0.88, 0.88]) for (const sz of [-0.40, 0.40])
      add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.86, 0.14), legM), sx, 0.43, sz);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.08, 0.08), legM), 0, 0.22, 0.40); // front brace
    add(new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.08, 0.08), legM), 0, 0.22, -0.40); // back brace
    add(new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.06, 0.80), legM), 0, 0.16, 0); // lower shelf
    // Framed pegboard
    const boardM = new THREE.MeshStandardMaterial({ color: 0x7a5a30, roughness: 1 });
    add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.25, 0.07), boardM), 0, 1.60, -0.48);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.10), legM), 0, 2.26, -0.48); // top frame rail
    add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.25, 0.10), legM), -0.98, 1.60, -0.48);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.25, 0.10), legM), 0.98, 1.60, -0.48);
    const pegM = new THREE.MeshStandardMaterial({ color: 0x2a1e10, roughness: 1 });
    for (let px = -4; px <= 4; px++) for (let py = 0; py < 4; py++) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.02), pegM), px * 0.20, 1.18 + py * 0.27, -0.435);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.02), pegM), px * 0.20, 1.18 + py * 0.27, -0.525);
    }
    const toolSteel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.65 });
    const toolWood = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.9 });
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
    const bodyM = new THREE.MeshStandardMaterial({ color: 0x3a4a63, roughness: 0.5, metalness: 0.4 });
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
    const bodyM = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.55 });
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
  } else if (itemId === 'chest') {
    // A proper storage chest: planked body, metal bands, hinges, latch,
    // and a slightly domed lid — same 1.1-wide footprint as before.
    const woodM = matTex(0x9a6a35, false, grainTex());
    const bandM = new THREE.MeshStandardMaterial({ color: 0x6a707a, roughness: 0.45, metalness: 0.7 });
    const lidM = matFor(0x8a5a2b);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.58, 0.7), woodM), 0, 0.32, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.08, 0.74), woodM), 0, 0.06, 0); // base plinth
    add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.58, 0.72), bandM), -0.38, 0.32, 0); // bands
    add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.58, 0.72), bandM), 0.38, 0.32, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.10, 0.7), lidM), 0, 0.66, 0); // lid base
    add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.14, 0.6), lidM), 0, 0.76, 0); // domed lid top
    add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.72), bandM), -0.38, 0.70, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.72), bandM), 0.38, 0.70, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.05), new THREE.MeshStandardMaterial({ color: 0xf5c542, metalness: 0.5, roughness: 0.4 })), 0, 0.62, 0.37); // latch
    add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.04), bandM), -0.30, 0.62, -0.37); // hinges
    add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.04), bandM), 0.30, 0.62, -0.37);
    for (const cx of [-0.52, 0.52]) for (const cy of [0.14, 0.74]) { // corner protectors
      add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.74), bandM), cx, cy, 0);
    }
    for (const sx of [-0.57, 0.57]) { // rope handles on the sides
      const rope = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: 0xc8b490, roughness: 1 }));
      rope.rotation.z = sx < 0 ? -Math.PI / 2 : Math.PI / 2; add(rope, sx, 0.32, 0);
    }
  } else if (itemId === 'house') {
    add(new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), matFor(0xe8ddc8)), 0, 1.5, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.18, 4.2), new THREE.MeshStandardMaterial({ color: 0x8d8f94, roughness: 1 })), 0, 0.09, 0); // stone foundation skirt
    for (let fx = -2.2; fx <= 2.2; fx += 0.55) // foundation stones on the front face
      add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.04), new THREE.MeshStandardMaterial({ color: 0x7a7d82, roughness: 1 })), fx, 0.09, 2.12);
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
function setBuildMode(on, opened) {
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
    toast('Build mode — left- or right-click to place, B or switch to a non-building item to exit. Pieces need ground beneath them.');
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
function syncBuildSel() {
  if (!buildMode) { buildTrackSlot = -1; buildTrackId = null; return; }
  const sel = selectedItem();
  const id = sel ? sel.id : null;
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
  const paints = ['#8a5a2b', '#e5484d', '#57b6ff', '#46a758', '#f5c542', '#e8e8e8', '#1d1a16', '#d6409f'];
  for (const c of paints) {
    const b = document.createElement('button');
    b.style.background = c; b.style.width = '26px'; b.style.padding = '7px 0';
    b.title = 'Paint ' + c;
    if (c === paintColor) b.style.boxShadow = '0 0 0 2px #fff';
    b.onclick = () => { paintColor = c; renderBuildBar(); };
    bar.appendChild(b);
  }
  if (!seen.size) bar.innerHTML = '<span style="padding:7px">No building pieces — craft some at the gold bench first.</span>';
}
function ghostAim() {
  // Build placement follows the first-person crosshair ray: march along
  // the look ray until it hits the ground (max 7 units), and place there.
  const fx = -Math.sin(P.yaw) * Math.cos(P.pitch), fy = Math.sin(P.pitch), fz = -Math.cos(P.yaw) * Math.cos(P.pitch);
  const ex = P.pos.x, ey = P.pos.y + 1.65, ez = P.pos.z;
  for (let d = 0.5; d <= 7; d += 0.5) {
    const x = ex + fx * d, y = ey + fy * d, z = ez + fz * d;
    if (y <= groundY(x, z) + 0.15) {
      const rx = Math.round(x), rz = Math.round(z);
      return { x: rx, z: rz, y: groundY(rx, rz) };
    }
  }
  const x = Math.round(ex + fx * 7), z = Math.round(ez + fz * 7);
  return { x, z, y: groundY(x, z) };
}
function ghostValid(x, z) {
  const d = Math.hypot(x - P.pos.x, z - P.pos.z);
  if (d > 7) return false;
  if (heightAt(x, z, W.seed) < 0.3) return false; // not in water
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
    ghost.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = 0.55; } });
    scene.add(ghost);
  }
  ghost.position.set(x, y, z);
  const ok = ghostValid(x, z);
  ghost.traverse((m) => { if (m.isMesh) m.material.color.set(ok ? 0x5ed07a : 0xff5a5a); });
  ghost.userData.valid = ok;
}
function placeGhostPiece() {
  if (!ghost || !ghost.userData.valid) { toast('Can\'t place that here.'); return; }
  const { x, z, y } = ghostAim();
  if (!removeCount(buildSel, 1)) { toast('Out of that piece.'); return; }
  const mesh = buildPieceMesh(buildSel);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  const rec = { itemId: buildSel, x, z, y, rotY: 0, color: paintColor, mesh, contents: buildSel === 'chest' ? [] : undefined };
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
      new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 1 }));
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
  addItem(cropId, 2);
  addItem(plot.seed, 1 + Math.floor(Math.random() * 2));
  chatMsg('System', `Harvested ${ITEMS[cropId].name}! Seeds returned.`, true);
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
      const mat = c.seed === 'seed_wheat' ? new THREE.MeshStandardMaterial({ color: stage >= 3 ? 0xe8c547 : 0x5da24a }) : new THREE.MeshStandardMaterial({ color: 0x3d7a32 });
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
  const bodyM = new THREE.MeshStandardMaterial({ color: 0xe5484d, roughness: 0.4, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 4.2), bodyM);
  body.position.y = 0.55; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2), new THREE.MeshStandardMaterial({ color: 0x22304a, roughness: 0.3 }));
  cabin.position.set(0, 1.1, -0.2); cabin.castShadow = true; g.add(cabin);
  const wheelM = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
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
// ---------- Loot chest container ----------
// A found chest opens a real container UI: look through its contents,
// take stacks into your inventory (Take / Take All), or put your own
// items back in. Contents are generated from the chest's loot table on
// first open and persist per chest in the world save.
function openLootChest(c, source) {
  openMousePanel(source);
  if (!c.contents) {
    c.contents = c.loot.map((l) => ({ ...l }));
    c.opened = true;
    c.group.children[1].position.y = 1.1; c.group.children[1].rotation.z = -0.7;
    saveGame();
  }
  const panel = $('shop-panel');
  panel.classList.remove('hidden');
  const render = () => {
    panel.innerHTML = `<h3>Loot Chest</h3>
      <div>${c.contents.length ? c.contents.map((s, i) => `<div class="craft-row"><span><span class="ic sm">${itemIcon(s.id)}</span> ${ITEMS[s.id].name} ×${s.n}</span><button class="btn small" data-take="${i}">Take</button></div>`).join('') : '<p class="fine">Empty. You can put items back in here.</p>'}</div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" id="take-all">Take All</button><button class="btn small" id="deposit-loot">Deposit Selected Item</button><button class="btn small ghost panel-close">Close</button></div>`;
    panel.querySelectorAll('[data-take]').forEach((b) => b.onclick = () => {
      const s = c.contents[+b.dataset.take];
      if (addItem(s.id, s.n)) { c.contents.splice(+b.dataset.take, 1); render(); updateHUD(); saveGame(); }
    });
    $('take-all').onclick = () => {
      for (let i = c.contents.length - 1; i >= 0; i--) {
        if (addItem(c.contents[i].id, c.contents[i].n)) c.contents.splice(i, 1);
        else break; // inventory full — leave the rest in the chest
      }
      render(); updateHUD(); saveGame();
    };
    $('deposit-loot').onclick = () => {
      const sel = selectedItem();
      if (!sel || selSlot >= 7) { toast('Select a hotbar item to deposit.'); return; }
      if (c.contents.length >= 40) { toast('Chest is full (40 slots).'); return; }
      c.contents.push({ ...sel });
      P.hotbar[selSlot] = null; P.hotbar = P.hotbar.filter(Boolean);
      render(); updateHUD(); saveGame();
    };
  };
  render();
}

function openStorage(piece, source) {
  openMousePanel(source);
  const panel = $('shop-panel');
  panel.classList.remove('hidden');
  const render = () => {
    panel.innerHTML = `<h3>Storage chest (40 slots)</h3>
      <div>${piece.contents.length ? piece.contents.map((s, i) => `<div class="craft-row"><span><span class="ic sm">${itemIcon(s.id)}</span> ${ITEMS[s.id].name} ×${s.n}</span><button class="btn small" data-take="${i}">Take</button></div>`).join('') : '<p class="fine">Empty. Deposit your selected hotbar item.</p>'}</div>
      <div style="margin-top:10px"><button class="btn small" id="deposit">Deposit selected item</button> <button class="btn small ghost panel-close">Close</button></div>`;
    panel.querySelectorAll('[data-take]').forEach((b) => b.onclick = () => {
      const s = piece.contents[+b.dataset.take];
      if (addItem(s.id, s.n)) { piece.contents.splice(+b.dataset.take, 1); render(); updateHUD(); }
    });
    $('deposit').onclick = () => {
      const sel = selectedItem();
      if (!sel || selSlot >= 7) { toast('Select a hotbar item to deposit.'); return; }
      if (piece.contents.length >= 40) { toast('Chest is full (40 slots).'); return; }
      piece.contents.push({ ...sel });
      P.hotbar[selSlot] = null; P.hotbar = P.hotbar.filter(Boolean);
      render(); updateHUD();
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
    renderInvGrid();
  } else {
    invOpened = null;
    craftOpened = null;
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
      dragSrc = { kind, idx };
      try { e.dataTransfer.setData('text/plain', kind + ':' + idx); } catch { /* ignore */ }
      e.dataTransfer.effectAllowed = 'move';
    };
    d.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; d.classList.add('drag-over'); };
    d.ondragleave = () => d.classList.remove('drag-over');
    d.ondrop = (e) => {
      e.preventDefault();
      d.classList.remove('drag-over');
      if (!dragSrc || (dragSrc.kind === kind && dragSrc.idx === idx)) { dragSrc = null; return; }
      const a = invArr(dragSrc.kind), b = invArr(kind);
      const tmp = a[dragSrc.idx];
      a[dragSrc.idx] = b[idx];
      b[idx] = tmp;
      dragSrc = null;
      dragDroppedAt = performance.now();
      renderInvGrid(); updateHUD(); saveGame();
    };
    d.ondragend = () => { dragSrc = null; dragDroppedAt = performance.now(); };
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
  if (titleEl) titleEl.textContent = P.hasBackpack ? 'Backpack' : 'Inventory';
  const note = document.createElement('p');
  note.className = 'fine';
  note.style.gridColumn = '1 / -1';
  note.textContent = P.hasBackpack
    ? `Backpack: 40 normal slots. Drag items to rearrange them. Permanent slots (car key, house key) live in the top bar — press 8, 9, 0 to select them.`
    : `10 normal slots — craft a Backpack (4 leather) to expand to 40. Drag items to rearrange them. Permanent slots (car key, house key) live in the top bar — press 8, 9, 0 to select them.`;
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
  ['Tools', ['axe_stone', 'pickaxe_wood', 'pickaxe', 'shovel', 'hoe', 'backpack']],
  ['Building', ['wall_wood', 'wall_brick', 'wall_steel', 'wall_window', 'wall_door', 'wall_ice', 'floor', 'roof']],
  ['Furniture', ['chest', 'house_kit']],
  ['Machines', ['workbench', 'vehicle_machine', 'gas_pump']],
  ['Materials', ['glass', 'ice']],
];
function openCraft(quick, opened) {
  // Mouse-opened craft ignores the Q key; keyboard-opened craft
  // toggles shut on Q. A button click is a mouse open.
  toggleInventory(true, opened || invOpened || { by: 'mouse', key: null });
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
      for (const [c, n] of Object.entries(cost)) removeCount(c, n);
      if (id === 'backpack') {
        P.hasBackpack = true;
        toast('Backpack equipped! Normal inventory is now 40 slots.');
      } else addItem(id, 1);
      openCraft(quick, craftOpened); updateHUD();
    };
    list.appendChild(row);
  }
}
function closePanels() {
  stopHoldAction();
  $('inv-panel').classList.add('hidden');
  $('shop-panel').classList.add('hidden');
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
  if (!$('inv-panel').classList.contains('hidden')) renderInvGrid();
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
  if (food[sel.id]) {
    P.hunger = Math.min(100, P.hunger + food[sel.id]);
    removeCount(sel.id, 1);
    chatMsg('System', `Ate ${ITEMS[sel.id].name} (+${food[sel.id]} hunger).`, true);
    updateHUD();
  }
}

// ---------- Save / load ----------
function saveGame() {
  if (!W) return;
  save('somewhere_save_' + W.id, {
    inv: P.inv, hotbar: P.hotbar, perm: P.perm, money: P.money, hp: P.hp, hunger: P.hunger,
    hasBackpack: P.hasBackpack, landOwned: P.landOwned,
    placed: placed.map((p) => ({ itemId: p.itemId, x: p.x, z: p.z, y: p.y, color: p.color, contents: p.contents })),
    crops: crops.filter((c) => c.seed).map((c) => ({ x: c.x, z: c.z, seed: c.seed, planted: c.planted })),
    // Loot chest states, matched back by position on load (chest
    // placement is deterministic per seed, so positions are stable).
    chests: world ? world.chests.map((c) => ({ x: c.x, z: c.z, opened: !!c.opened, contents: c.contents || null })) : [],
  });
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
  for (const p of s.placed || []) {
    const mesh = buildPieceMesh(p.itemId, p.color);
    mesh.position.set(p.x, p.y, p.z);
    scene.add(mesh);
    placed.push({ ...p, mesh, contents: p.contents || (p.itemId === 'chest' ? [] : undefined) });
  }
  for (const c of s.crops || []) {
    const y = groundY(c.x, c.z);
    const soil = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 0.95),
      new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 1 }));
    soil.position.set(c.x, y + 0.06, c.z); scene.add(soil);
    crops.push({ x: c.x, z: c.z, y, seed: c.seed, planted: c.planted, stage: -1, mesh: soil, sprout: null });
  }
  // Restore loot chest contents/open state (unopened chests keep
  // their loot table and generate contents on first open).
  for (const sc of s.chests || []) {
    const c = world.chests.find((x) => x.x === sc.x && x.z === sc.z);
    if (!c) continue;
    c.opened = !!sc.opened;
    c.contents = sc.contents || null;
    if (c.opened) { c.group.children[1].position.y = 1.1; c.group.children[1].rotation.z = -0.7; }
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
  get cars() { return cars; },
  get target() { return target; },
  addItem, countOf, selectedItem,
  get selSlot() { return selSlot; },
  doPrimary: () => onPrimaryAction(),
  doInteract: () => doInteract(),
  place: () => placeGhostPiece(),
  setBuild: (on) => setBuildMode(on),
  vehiclePanel: (m) => openVehiclePanel(m),
  heightAt, biomeAt, groundY,
  swing: () => triggerSwing(),
  swingProgress: () => (swingStart ? Math.min(1, (performance.now() - swingStart) / swingDur) : 1),
  setSwingDur: (v) => { swingDur = v; },
  swingAt: (msAgo) => { swingStart = performance.now() - msAgo; },
  closePause: () => closePause(),
  get sprinting() { return doubleTapSprint; },
  openPause: () => openPause(),
  openPauseSettings: () => openPauseSettings(),
  get pauseOpen() { return pauseOpen; },
  get pauseSettingsOpen() { return pauseSettingsOpen; },
  get targetRing() { return targetRing; },
};
