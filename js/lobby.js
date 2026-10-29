import * as THREE from 'three';
import { buildCharacter, SKIN_TONES, HAIR_COLORS, HAIR_STYLES, SHIRT_COLORS, PANTS_COLORS, SHOE_COLORS, DEFAULT_CHAR } from './character.js';
import { buildWorld, makeSkyDome, heightAt } from './world.js';
import { load, save, uid, hasBadWord, initialAvatar } from './data.js';
import { uiIcon } from './icons.js';

const $ = (id) => document.getElementById(id);
const S = window.Somewhere = window.Somewhere || {};
S.session = load('somewhere_session', null);
S.char = { ...DEFAULT_CHAR, ...load('somewhere_char', {}) };
S.worlds = load('somewhere_worlds', null);
S.servers = load('somewhere_servers', null);
S.friends = load('somewhere_friends', null);
S.keybinds = { ...{ forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', interact: 'KeyE', chat: 'KeyT', inventory: 'KeyI', build: 'KeyB', quickcraft: 'KeyQ', help: 'KeyH' }, ...load('somewhere_keybinds', {}) };
S.settings = { brightness: 100, audio: 80, voice: 'party', ...load('somewhere_settings', {}) };
// NO seeded world: new accounts start with zero worlds and create their
// own. Migration: drop any leftover seeded "First Island" (the old seed
// had no userCreated flag; worlds the user actually created via the
// dialog carry userCreated: true and are always kept).
if (!S.worlds) { S.worlds = []; save('somewhere_worlds', S.worlds); }
else {
  const seeded = S.worlds.filter((w) => w.name === 'First Island' && !w.userCreated);
  if (seeded.length) {
    S.worlds = S.worlds.filter((w) => !(w.name === 'First Island' && !w.userCreated));
    save('somewhere_worlds', S.worlds);
  }
}
// No seeded friends, servers, or invites — everything starts EMPTY and only
// real, user-created entries appear. Returning players get migrated: any
// previously saved entries matching the old fake seeds are dropped.
const FAKE_FRIEND_NAMES = ['Maya', 'Jace', 'Riley', 'Noah'];
if (!S.servers) { S.servers = []; save('somewhere_servers', S.servers); }
if (!S.friends) { S.friends = []; save('somewhere_friends', S.friends); }
(function migrateFakeSeeds() {
  const cleanFriends = S.friends.filter((f) => !FAKE_FRIEND_NAMES.includes(f.name));
  if (cleanFriends.length !== S.friends.length) { S.friends = cleanFriends; save('somewhere_friends', S.friends); }
  const cleanServers = S.servers.filter((s) => s.name !== 'The Crew Server');
  if (cleanServers.length !== S.servers.length) { S.servers = cleanServers; save('somewhere_servers', S.servers); }
  const oldInvites = load('somewhere_invites', null);
  if (oldInvites) {
    const cleanInvites = oldInvites.filter((inv) =>
      inv.from !== 'Maya' && inv.from !== 'System' && !(inv.text || '').includes('The Crew Server'));
    if (cleanInvites.length !== oldInvites.length) save('somewhere_invites', cleanInvites);
  }
})();
S.selectedWorld = null;
S.selectedServer = null;

const KEY_LABELS = { forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right', jump: 'Jump', interact: 'Interact', chat: 'Chat', inventory: 'Inventory', build: 'Build mode', quickcraft: 'Quick craft', help: 'Help' };
function keyName(code) {
  return code.replace('Key', '').replace('Digit', '').replace('Space', 'Space');
}

// ---------- Auth ----------
let mode = 'signin';
function showAuthError(msg) {
  const el = $('auth-error');
  el.textContent = msg; el.classList.remove('hidden');
}
$('tab-signin').onclick = () => {
  mode = 'signin';
  $('tab-signin').classList.add('active'); $('tab-create').classList.remove('active');
  $('create-fields').classList.add('hidden'); $('auth-submit').textContent = 'Sign in';
};
$('tab-create').onclick = () => {
  mode = 'create';
  $('tab-create').classList.add('active'); $('tab-signin').classList.remove('active');
  $('create-fields').classList.remove('hidden'); $('auth-submit').textContent = 'Create account';
};
$('auth-pfp').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { $('pfp-preview').src = r.result; $('pfp-preview').classList.remove('hidden'); };
  r.readAsDataURL(f);
};
$('auth-submit').onclick = () => {
  const email = $('auth-email').value.trim().toLowerCase();
  const pass = $('auth-pass').value;
  if (!email.includes('@') || pass.length < 4) { showAuthError('Enter a valid email and a password (4+ characters).'); return; }
  const users = load('somewhere_users', {});
  if (mode === 'create') {
    const username = $('auth-user').value.trim();
    if (!username) { showAuthError('Pick a username.'); return; }
    if (username.length > 15) { showAuthError('Usernames are max 15 characters.'); return; }
    if (hasBadWord(username)) { showAuthError('That username contains a blocked word. Pick another.'); return; }
    if (Object.values(users).some((u) => u.username.toLowerCase() === username.toLowerCase())) { showAuthError('That username is taken.'); return; }
    if (users[email]) { showAuthError('That email already has an account — sign in instead.'); return; }
    users[email] = { pass, username, pfp: $('pfp-preview').src || '' };
    save('somewhere_users', users);
    S.session = { email, username, pfp: users[email].pfp, guest: false };
  } else {
    const u = users[email];
    if (!u || u.pass !== pass) { showAuthError('Wrong email or password.'); return; }
    S.session = { email, username: u.username, pfp: u.pfp, guest: false };
  }
  save('somewhere_session', S.session);
  showLobby();
};
$('auth-guest').onclick = () => {
  S.session = { guest: true, username: 'Guest' + Math.floor(1000 + Math.random() * 9000), pfp: '' };
  save('somewhere_session', S.session);
  showLobby();
};
$('btn-signout').onclick = () => {
  S.session = null; save('somewhere_session', null);
  $('lobby-screen').classList.add('hidden'); $('auth-screen').classList.remove('hidden');
  stopLobbyLoop();
};

// ---------- Lobby 3D ----------
let lobbyRenderer, panoRenderer, charRenderer, panoScene, panoCam, charScene, charCam, charGroup, custRenderer, custScene, custCam, custGroup, lobbyRAF = null, lobbyClock = new THREE.Clock();
// Quit-path readiness: S.lobbyReady resolves once the panorama scene is
// built AND its first frame has rendered (see lobbyLoop). game.js
// backToLobby awaits it while the loading overlay is up; awaiting an
// already-resolved promise yields only a microtask, so when the lobby
// is already ready no paint happens between overlay show and hide —
// no visible flash. A failed build resolves it anyway (see below) so
// a waiter can never hang on a promise that never settles.
let lobbyReadyResolve = null;
let lobbyIslandReady = false; // true once the panorama build settles (built or failed)
S.lobbyReady = null;
S.lobbyBuilt = null; // background panorama-build promise (resolves when the island is in the scene)
// Progress note for the lobby island build: while the panorama is
// still building after the lobby appears, a small note shows the
// percentage so the wait never looks like a stuck blue screen.
function lobbyBuildProgress(label, frac) {
  const el = $('lobby-island-note');
  if (el && !lobbyIslandReady) el.textContent = `Building island… ${Math.round(frac * 100)}%`;
  // While the boot overlay is still up, the same progress drives its
  // bar + percent. Post-boot, only the note above keeps updating.
  const boot = $('boot-loading');
  if (boot && !boot.classList.contains('hidden')) {
    const fill = $('boot-fill'), pct = $('boot-pct');
    if (fill) fill.style.width = Math.round(frac * 100) + '%';
    if (pct) pct.textContent = Math.round(frac * 100) + '%';
  }
}
// Boot gate (2026-10-29, Liam: loading screen first, Play only once
// loading is confirmed): the boot overlay hides ONLY from this settle
// callback — never from showLobby or the no-session branch. The
// panorama's finally sets lobbyIslandReady on built OR failed, so a
// failed build still settles and can never trap the player here.
// Hiding is idempotent: adding .hidden twice is a no-op.
function onLobbyBuiltSettled() {
  $('boot-loading')?.classList.add('hidden');
  // A world/server selected while the boot overlay was up (e.g. via
  // a restored selection path) gets its Play button only now.
  if (lobbyIslandReady && (S.selectedWorld || S.selectedServer)) $('btn-play')?.classList.remove('hidden');
}
let lobbySetupDone = false;
async function initLobby3D() {
  // Fast setup ONLY — renderers, scenes, cameras, character — so the
  // lobby loop can start rendering sky + character immediately. The
  // island panorama builds in the background (S.lobbyBuilt) and pops
  // into panoScene when done; the loop renders whatever is there.
  // Previously the character AND the loop waited on the full island
  // build, so the lobby sat blue + DOM-only for the whole build — on
  // a slow machine that looked broken, and anything the player did
  // around the time the build finished (like clicking a tab) looked
  // like the thing that fixed it. It wasn't; the build just finished.
  // lobbyReady still resolves on the loop's first rendered frame, so
  // the quit path's overlay wait is unchanged.
  if (lobbySetupDone) return;
  lobbySetupDone = true;
  S.lobbyReady = new Promise((resolve) => { lobbyReadyResolve = resolve; });
  try {
    initLobby3DSetup();
  } catch (err) {
    // Setup itself failed (e.g. no WebGL): the panorama build can
    // never run, so settle the boot gate here instead of trapping
    // the player on the boot screen. The lobby UI still works;
    // only the 3D panorama is missing.
    console.error('Lobby 3D setup failed:', err);
    lobbyIslandReady = true;
    lobbyReadyResolve?.();
    S.lobbyBuilt = Promise.resolve();
    S.lobbyBuilt.then(onLobbyBuiltSettled, onLobbyBuiltSettled);
    return;
  }
  S.lobbyBuilt = (async () => {
    try {
      // Light build: same terrain and prop density near the camera,
      // ~4x faster — and it starts at page load (see the boot section),
      // so by sign-in it is usually already done.
      const panoWorld = await buildWorld(panoScene, 20261027, lobbyBuildProgress, { light: true }); // the set lobby world, same for everyone
      panoScene.userData.center = panoWorld.spawn;
    } catch (err) {
      // Sky + character still render; only the island is missing.
      console.error('Lobby panorama failed to build:', err);
    } finally {
      // Ready either way: the note must never stick on a failed build.
      lobbyIslandReady = true;
      $('lobby-island-note')?.classList.add('hidden');
    }
  })();
  // The boot overlay and Play gating both hang off this settle — the
  // promise never rejects (the try/catch above swallows build errors),
  // so the second handler is belt-and-braces only.
  S.lobbyBuilt.then(onLobbyBuiltSettled, onLobbyBuiltSettled);
}
function initLobby3DSetup() {
  const bgCanvas = $('lobby-bg');
  panoRenderer = new THREE.WebGLRenderer({ canvas: bgCanvas, antialias: true });
  panoRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  panoRenderer.setSize(innerWidth, innerHeight);
  panoRenderer.shadowMap.enabled = true;
  panoRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  panoRenderer.toneMappingExposure = 1.05;
  panoScene = new THREE.Scene();
  panoScene.background = null;
  panoScene.add(makeSkyDome(500));
  panoScene.fog = new THREE.Fog(0xcfe4f5, 130, 380);
  panoScene.add(new THREE.HemisphereLight(0xcfe8ff, 0x3d5a34, 0.95));
  const sun = new THREE.DirectionalLight(0xfff2cc, 1.5);
  sun.position.set(60, 90, 30); sun.castShadow = true; panoScene.add(sun);
  panoScene.userData.seed = 20261027; // set panorama world seed, same for everyone
  panoScene.userData.camH = null; // smoothed orbit height, set on first frame
  // Center defaults to the origin until the background build sets the
  // real spawn — the loop's fallback covers it either way, so the sky
  // orbits cleanly while the island is still building.
  panoCam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);

  charRenderer = new THREE.WebGLRenderer({ canvas: $('char-canvas'), antialias: true, alpha: true });
  charRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  charRenderer.setSize(312, 390);
  charScene = new THREE.Scene();
  charScene.add(new THREE.HemisphereLight(0xffffff, 0x3a4a5a, 0.9));
  const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(2, 4, 3); charScene.add(dl);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 0.8); rim.position.set(-3, 2, -3); charScene.add(rim);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.12, 24),
    new THREE.MeshStandardMaterial({ color: 0x22304a, roughness: 0.9 }));
  pedestal.position.y = -0.06; pedestal.receiveShadow = true; charScene.add(pedestal);
  charCam = new THREE.PerspectiveCamera(30, 280 / 350, 0.1, 50);
  charCam.position.set(0, 1.25, 5.2);
  charCam.lookAt(0, 1.0, 0);
  // Customize-panel preview: its own renderer/scene, because the hero
  // preview is hidden while a full menu tab (like Customization) is open.
  custRenderer = new THREE.WebGLRenderer({ canvas: $('cust-canvas'), antialias: true, alpha: true });
  custRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  custRenderer.setSize(280, 350);
  custScene = new THREE.Scene();
  custScene.add(new THREE.HemisphereLight(0xffffff, 0x3a4a5a, 0.9));
  const cdl = new THREE.DirectionalLight(0xffffff, 1.6); cdl.position.set(2, 4, 3); custScene.add(cdl);
  const crim = new THREE.DirectionalLight(0x9fc4ff, 0.8); crim.position.set(-3, 2, -3); custScene.add(crim);
  const cped = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.12, 24),
    new THREE.MeshStandardMaterial({ color: 0x22304a, roughness: 0.9 }));
  cped.position.y = -0.06; custScene.add(cped);
  custCam = new THREE.PerspectiveCamera(30, 280 / 350, 0.1, 50);
  // 3/4 angle (not straight front) so back-hair styles (ponytail, long)
  // actually read in the preview instead of hiding behind the head.
  custCam.position.set(2.8, 1.35, 4.3);
  custCam.lookAt(0, 1.0, 0);
  window.__custPreview = { get rot() { return custGroup ? custGroup.rotation.y : 0; } };
  refreshCharacter();
}
function refreshCharacter() {
  if (!charScene) return;
  if (charGroup) charScene.remove(charGroup);
  charGroup = buildCharacter(S.char);
  charGroup.position.y = 0;
  charScene.add(charGroup);
  if (custScene) {
    if (custGroup) custScene.remove(custGroup);
    custGroup = buildCharacter(S.char);
    custGroup.position.y = 0;
    custScene.add(custGroup);
  }
}
function lobbyLoop() {
  if (!$('lobby-screen') || $('lobby-screen').classList.contains('hidden')) { lobbyRAF = null; return; }
  if (!panoScene || !panoRenderer) { lobbyRAF = null; return; } // failed panorama build: no scene to render
  const dt = Math.min(lobbyClock.getDelta(), 0.05);
  const t = lobbyClock.elapsedTime;
  const ang = t * 0.045; // slow panorama rotation, Minecraft-style (speed unchanged)
  const ctr = panoScene.userData.center || { x: 0, y: 6, z: 0 };
  const seed = panoScene.userData.seed || 20261027;
  const R = 48; // orbit radius unchanged, so the island still fills the frame
  // Terrain-aware orbit height: the old fixed height (ctr.y + 20, ~25) put
  // the camera INSIDE mountains for ~37% of each rotation — terrain on the
  // orbit path around the panorama center reaches ~36. Sample the terrain
  // under the camera and ahead along its path, and keep the camera above
  // the highest of those samples by a safe margin.
  let target = ctr.y + 20; // unchanged framing wherever the terrain is low
  for (const ahead of [0, 0.1, 0.2, 0.35]) {
    const a = ang + ahead;
    const h = heightAt(ctr.x + Math.cos(a) * R, ctr.z + Math.sin(a) * R, seed);
    target = Math.max(target, h + 8);
  }
  let camH = panoScene.userData.camH;
  if (camH === null || camH === undefined) camH = target; // first frame: start clear
  const rate = target > camH ? 6 : 1.8; // rise fast so we never clip, descend gently
  camH += (target - camH) * Math.min(1, dt * rate);
  panoScene.userData.camH = camH;
  panoCam.position.set(ctr.x + Math.cos(ang) * R, camH, ctr.z + Math.sin(ang) * R);
  panoCam.lookAt(ctr.x, ctr.y + 2, ctr.z);
  panoRenderer.render(panoScene, panoCam);
  // First panorama frame rendered: the quit path may now hide its
  // loading overlay. Resolved once; later frames are no-ops.
  if (lobbyReadyResolve) { lobbyReadyResolve(); lobbyReadyResolve = null; }
  if (charGroup) charGroup.rotation.y = Math.sin(t * 0.35) * 0.35;
  charRenderer.render(charScene, charCam);
  if (custScene && !$('panel-customize').classList.contains('hidden')) {
    if (custGroup) custGroup.rotation.y = Math.sin(t * 0.35) * 0.35;
    custRenderer.render(custScene, custCam);
  }
  lobbyRAF = requestAnimationFrame(lobbyLoop);
}
async function startLobbyLoop() {
  try {
    // initLobby3D is fast setup only now — the island builds in the
    // background and can no longer block (or fail) loop startup. A
    // setup failure (e.g. no WebGL) still means no loop, but the lobby
    // UI (worlds, Play) still works.
    await initLobby3D();
  } catch (err) {
    console.error('Lobby 3D setup failed:', err);
    return;
  }
  lobbyClock.start();
  if (!lobbyRAF) lobbyRAF = requestAnimationFrame(lobbyLoop);
}
function stopLobbyLoop() { /* loop self-stops when lobby hidden */ }

// ---------- Lobby UI ----------
function setPfp(img, name) {
  img.src = S.session.pfp || initialAvatar(name);
  img.onerror = () => { img.src = initialAvatar(name); };
}
function showLobby() {
  // NOTE: the boot overlay is NOT hidden here — it hides only from
  // onLobbyBuiltSettled (panorama build settled). It covers the lobby
  // (z-200) until then.
  $('auth-screen').classList.add('hidden');
  $('lobby-screen').classList.remove('hidden');
  // Island still building (e.g. fast login right after page load)?
  // Say so — a blue background with no word looks broken.
  if (!lobbyIslandReady) $('lobby-island-note')?.classList.remove('hidden');
  $('header-username').textContent = S.session.username;
  setPfp($('header-pfp'), S.session.username);
  $('np-name').textContent = S.session.username;
  setPfp($('np-pfp'), S.session.username);
  $('set-username').value = S.session.username;
  // No fake party members — the party row stays empty until real party
  // members exist.
  $('party-row').innerHTML = '';
  renderWorlds(); renderServers(); renderFriends(); renderInvites(); renderKeybinds(); applySettings();
  switchTab('play');
  startLobbyLoop();
}
S.showLobby = showLobby; // pause menu's "Back to lobby" uses this
// Top tabs open a NEW MENU: a full menu screen of its own that covers the
// lobby (hero + friends hidden), with a Back button returning to Play.
let currentTab = 'play';
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.lobby-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  for (const p of ['play', 'customize', 'invites', 'settings']) {
    $('panel-' + p).classList.toggle('hidden', p !== tab);
  }
  // Leaving Play closes the slide-up worlds panel (its handle is hidden
  // in menu mode anyway); returning to Play starts with it closed.
  if (tab !== 'play') {
    $('lobby-screen').classList.add('menu-open');
    setWorldsOpen(false);
  } else {
    // Worlds-flash fix: in menu mode the sheet sits in normal flow, so
    // removing menu-open would otherwise ANIMATE it from in-flow down
    // through the viewport (the split-second worlds flash). Suppress
    // the transition around the toggle so the sheet snaps instantly
    // below the viewport; later open/close animations still animate.
    const scr = $('lobby-screen');
    scr.classList.add('sheet-no-anim');
    scr.classList.remove('menu-open');
    void scr.offsetHeight; // force reflow while transitions are off
    scr.classList.remove('sheet-no-anim');
  }
}
// Worlds panel access, Fortnite-style: a small tab sits at the bottom
// of the lobby screen. Tapping it OR scrolling down slides the panel
// UP so it covers the whole lobby screen. While open, the tab sits at
// the TOP of the panel — tap it again to slide back down. Scrolling
// back up while the panel's own list is at its top also closes it.
let worldsOpen = false;
function setWorldsOpen(open) {
  worldsOpen = open;
  $('lobby-screen').classList.toggle('worlds-open', open);
  $('worlds-tab').textContent = open ? '▾ Worlds' : '▴ Worlds';
}
$('worlds-tab').onclick = () => setWorldsOpen(!worldsOpen);
$('lobby-screen').addEventListener('wheel', (e) => {
  if (currentTab !== 'play') return;
  if (worldsOpen) {
    if (e.deltaY < 0 && $('lobby-bottom').scrollTop <= 0) setWorldsOpen(false);
  } else if (e.deltaY > 0) {
    setWorldsOpen(true);
  }
}, { passive: true });
// Worlds/Servers tabs at the TOP of the worlds panel (styled like the
// lobby menu tabs) — no more worlds section with servers stacked below.
let worldsView = 'worlds';
function renderWorldsPanel() {
  $('tab-worlds').classList.toggle('active', worldsView === 'worlds');
  $('tab-servers').classList.toggle('active', worldsView === 'servers');
  $('worlds-list').classList.toggle('hidden', worldsView !== 'worlds');
  $('servers-list').classList.toggle('hidden', worldsView !== 'servers');
  $('worlds-panel-title').textContent = worldsView === 'worlds' ? 'Your Worlds' : 'Shared Servers';
  $('btn-new-world').classList.toggle('hidden', worldsView !== 'worlds');
  $('btn-new-server').classList.toggle('hidden', worldsView !== 'servers');
}
$('tab-worlds').onclick = () => { worldsView = 'worlds'; renderWorldsPanel(); };
$('tab-servers').onclick = () => { worldsView = 'servers'; renderWorldsPanel(); };
document.querySelectorAll('.lobby-tab').forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });
document.querySelectorAll('.menu-back').forEach((b) => { b.onclick = () => switchTab('play'); });

// Netflix-style card art: a tiny deterministic island scene per world seed
function seedRand(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function drawCardArt(canvas, seed) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const r = seedRand(seed * 2654435761 + 7);
  const hue = Math.floor(r() * 40) + 195; // sky blues
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, `hsl(${hue}, 70%, 62%)`);
  sky.addColorStop(0.6, `hsl(${hue}, 65%, 82%)`);
  sky.addColorStop(1, `hsl(${hue}, 60%, 88%)`);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255, 236, 170, 0.95)';
  ctx.beginPath(); ctx.arc(W - 30, 24, 14, 0, Math.PI * 2); ctx.fill();
  // Distant mountains
  ctx.fillStyle = `hsl(215, 25%, ${42 + Math.floor(r() * 10)}%)`;
  ctx.beginPath(); ctx.moveTo(0, 92);
  for (let x = 0; x <= W; x += 26) ctx.lineTo(x, 62 + r() * 30);
  ctx.lineTo(W, 110); ctx.lineTo(0, 110); ctx.closePath(); ctx.fill();
  // Island hill + trees
  const grassHue = 95 + Math.floor(r() * 25);
  ctx.fillStyle = `hsl(${grassHue}, 45%, 38%)`;
  ctx.beginPath(); ctx.ellipse(W / 2, 118, 110, 26, 0, Math.PI, 0); ctx.fill();
  for (let i = 0; i < 7; i++) {
    const tx = 24 + r() * (W - 48), ty = 96 + r() * 14;
    ctx.fillStyle = `hsl(${grassHue + 10}, 50%, 26%)`;
    ctx.fillRect(tx - 2, ty, 4, 12);
    ctx.fillStyle = `hsl(${grassHue}, 55%, 30%)`;
    ctx.beginPath(); ctx.moveTo(tx, ty - 14); ctx.lineTo(tx - 9, ty + 2); ctx.lineTo(tx + 9, ty + 2); ctx.closePath(); ctx.fill();
  }
  // Sea strip
  ctx.fillStyle = `hsl(${hue}, 75%, 45%)`;
  ctx.fillRect(0, H - 10, W, 10);
}
function fmtLastPlayed(ts) {
  if (!ts) return 'Never played';
  const d = new Date(ts), now = Date.now();
  const days = Math.floor((now - ts) / 86400000);
  if (days <= 0) return 'Played today';
  if (days === 1) return 'Played yesterday';
  if (days < 30) return `Played ${days}d ago`;
  return 'Played ' + d.toLocaleDateString();
}
function makeWorldCard({ title, icon, lines, artSeed, selected, onSelect, menuItems }) {
  // A div, not a button: the card carries its own "…" menu button, and
  // buttons may not nest inside buttons.
  const card = document.createElement('div');
  card.className = 'world-card' + (selected ? ' selected' : '');
  card.tabIndex = 0;
  const art = document.createElement('canvas');
  art.className = 'card-art'; art.width = 240; art.height = 128;
  drawCardArt(art, artSeed);
  card.appendChild(art);
  const info = document.createElement('div');
  info.className = 'card-info';
  info.innerHTML = `<b>${icon} ${title}</b>` + lines.map((l) => `<span>${l}</span>`).join('');
  if (selected) info.innerHTML += '<span class="card-selected">✓ Selected — hit Play below</span>';
  card.appendChild(info);
  card.onclick = onSelect;
  if (menuItems && menuItems.length) {
    const wrap = document.createElement('div');
    wrap.className = 'card-menu';
    const btn = document.createElement('button');
    btn.className = 'card-menu-btn';
    btn.textContent = '⋯';
    btn.title = 'More options';
    btn.onclick = (e) => { e.stopPropagation(); openCardMenu(btn, menuItems); };
    wrap.appendChild(btn);
    card.appendChild(wrap);
  }
  return card;
}
// ---------- Shared card "…" popover (position:fixed at body level, so no
// panel/row overflow clipping can cut it off; flips up near the viewport bottom)
function openCardMenu(btn, menuItems) {
  const pop = $('card-menu-popover');
  pop.innerHTML = '';
  for (const item of menuItems) {
    const mi = document.createElement('button');
    mi.className = 'card-menu-item' + (item.danger ? ' danger' : '');
    mi.textContent = item.label;
    mi.onclick = (e) => { e.stopPropagation(); pop.classList.remove('open'); item.action(); };
    pop.appendChild(mi);
  }
  pop.classList.add('open');
  const r = btn.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.right - 170, window.innerWidth - 180)) + 'px';
  pop.style.top = (r.bottom + 4) + 'px';
  const pr = pop.getBoundingClientRect();
  if (pr.bottom > window.innerHeight - 8) pop.style.top = Math.max(8, r.top - pr.height - 4) + 'px';
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.card-menu') && !e.target.closest('#card-menu-popover')) {
    $('card-menu-popover').classList.remove('open');
  }
});
// ---------- Card "…" menus: delete (with confirm), rename, settings, leave ----------
function clearSelectionIf(id) {
  if (S.selectedWorld === id || S.selectedServer === id) {
    S.selectedWorld = null; S.selectedServer = null;
    $('btn-play').classList.add('hidden');
    $('selected-world-label').textContent = '';
  }
}
let confirmCb = null;
function askConfirm(title, text, okLabel, cb) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = okLabel;
  confirmCb = cb;
  $('confirm-dialog').classList.remove('hidden');
}
$('confirm-cancel').onclick = () => { $('confirm-dialog').classList.add('hidden'); confirmCb = null; };
$('confirm-ok').onclick = () => {
  $('confirm-dialog').classList.add('hidden');
  const cb = confirmCb; confirmCb = null;
  if (cb) cb();
};
let renameTarget = null; // { kind: 'world'|'server', entry }
function openRename(entry, kind) {
  renameTarget = { entry, kind };
  $('rename-title').textContent = kind === 'world' ? 'Rename World' : 'Rename Server';
  $('rename-input').value = entry.name;
  $('rename-dialog').classList.remove('hidden');
  $('rename-input').focus();
}
$('rename-cancel').onclick = () => { $('rename-dialog').classList.add('hidden'); renameTarget = null; };
$('rename-save').onclick = () => {
  const v = $('rename-input').value.trim();
  if (!v || !renameTarget) return;
  if (hasBadWord(v)) { alert('That name contains a blocked word.'); return; }
  renameTarget.entry.name = v;
  if (renameTarget.kind === 'world') save('somewhere_worlds', S.worlds);
  else save('somewhere_servers', S.servers);
  $('rename-dialog').classList.add('hidden');
  renameTarget = null;
  renderWorlds(); renderServers();
};
let settingsTarget = null; // { kind, entry }
function openCardSettings(entry, kind) {
  settingsTarget = { entry, kind };
  $('card-settings-title').textContent = kind === 'world' ? 'World Settings' : 'Server Settings';
  $('card-keepinv').checked = !!entry.keepInv;
  $('card-friendly').checked = entry.friendly !== false;
  $('card-settings-dialog').classList.remove('hidden');
}
$('card-settings-cancel').onclick = () => { $('card-settings-dialog').classList.add('hidden'); settingsTarget = null; };
$('card-settings-save').onclick = () => {
  if (!settingsTarget) return;
  settingsTarget.entry.keepInv = $('card-keepinv').checked;
  settingsTarget.entry.friendly = $('card-friendly').checked;
  if (settingsTarget.kind === 'world') save('somewhere_worlds', S.worlds);
  else save('somewhere_servers', S.servers);
  $('card-settings-dialog').classList.add('hidden');
  settingsTarget = null;
  renderWorlds(); renderServers();
};
function selectWorld(w) {
  S.selectedWorld = w.id; S.selectedServer = null;
  renderWorlds(); renderServers();
  // Play gating: no Play button until the panorama build has settled
  // (lobbyIslandReady). If it hasn't, onLobbyBuiltSettled reveals Play
  // for the already-selected world when the build settles.
  if (lobbyIslandReady) $('btn-play').classList.remove('hidden');
  $('selected-world-label').textContent = 'Selected: ' + w.name;
  // Close the sheet so the hero character + Play button are visible —
  // the sheet otherwise keeps covering them after a tap.
  setWorldsOpen(false);
}
function selectServer(s) {
  S.selectedServer = s.id; S.selectedWorld = null;
  renderWorlds(); renderServers();
  // Play gating, same as selectWorld: reveal only once the build
  // has settled; onLobbyBuiltSettled covers the already-selected case.
  if (lobbyIslandReady) $('btn-play').classList.remove('hidden');
  $('selected-world-label').textContent = 'Selected server: ' + s.name;
  // Same as selectWorld: close the sheet to reveal hero + Play.
  setWorldsOpen(false);
}
function renderWorlds() {
  const list = $('worlds-list');
  list.innerHTML = '';
  for (const w of S.worlds) {
    list.appendChild(makeWorldCard({
      title: w.name, icon: uiIcon('globe'), artSeed: w.seed,
      selected: S.selectedWorld === w.id,
      lines: [
        `Private · Solo · Seed ${w.seed}`,
        `${w.keepInv ? 'Keep inventory' : 'Drop on death'} · Friendly fire ${w.friendly ? 'on' : 'off'}`,
        fmtLastPlayed(w.lastPlayed),
      ],
      onSelect: () => selectWorld(w),
      menuItems: [
        { label: 'Rename World', action: () => openRename(w, 'world') },
        { label: 'World Settings', action: () => openCardSettings(w, 'world') },
        {
          label: 'Delete World', danger: true,
          action: () => askConfirm('Delete World?', `"${w.name}" will be gone for good.`, 'Delete', () => {
            S.worlds = S.worlds.filter((x) => x.id !== w.id);
            save('somewhere_worlds', S.worlds);
            clearSelectionIf(w.id);
            renderWorlds();
          }),
        },
      ],
    }));
  }
  if (!S.worlds.length) {
    const empty = document.createElement('p');
    empty.className = 'world-empty';
    empty.textContent = 'No worlds yet — hit + New world up top to create your first island.';
    list.appendChild(empty);
  }
  renderWorldsPanel();
}
function renderServers() {
  const list = $('servers-list');
  list.innerHTML = '';
  for (const s of S.servers) {
    // Ownership: servers created in the dialog carry owner = creator.
    // Old saves predate the flag — those servers were created by the
    // current user (invites never produced real servers before), so
    // default them to the current user.
    const mine = !s.owner || (S.session && s.owner === S.session.username);
    const members = s.members || (1 + (s.invited ? s.invited.length : 0));
    // Online now: you, plus invited friends flagged online. The total
    // is the whole server (owner + invited) — the stored count can lag
    // behind invites, so take the larger of the two.
    const invited = s.invited || [];
    const total = Math.max(members, 1 + invited.length);
    const online = 1 + invited.filter((n) => (S.friends || []).some((f) => f.name === n && f.online)).length;
    const menuItems = [];
    if (mine) {
      menuItems.push(
        { label: 'Rename Server', action: () => openRename(s, 'server') },
        { label: 'Server Settings', action: () => openCardSettings(s, 'server') },
        {
          label: 'Delete Server', danger: true,
          action: () => askConfirm('Delete Server?', `"${s.name}" will be gone for good.`, 'Delete', () => {
            S.servers = S.servers.filter((x) => x.id !== s.id);
            save('somewhere_servers', S.servers);
            clearSelectionIf(s.id);
            renderServers();
          }),
        },
      );
    }
    // Leave is always available on servers, owner or not.
    menuItems.push({
      label: 'Leave Server',
      action: () => askConfirm('Leave Server?', `You will leave "${s.name}".`, 'Leave', () => {
        S.servers = S.servers.filter((x) => x.id !== s.id);
        save('somewhere_servers', S.servers);
        clearSelectionIf(s.id);
        renderServers();
      }),
    });
    list.appendChild(makeWorldCard({
      title: s.name, icon: uiIcon('server'), artSeed: s.seed || 777,
      selected: S.selectedServer === s.id,
      lines: [
        `Private server`,
        `${online} online of ${total} invited`,
        ...(invited.length ? [`Invited: ${invited.join(', ')}`] : []),
      ],
      onSelect: () => selectServer(s),
      menuItems,
    }));
  }
  if (!S.servers.length) {
    const empty = document.createElement('p');
    empty.className = 'world-empty';
    empty.textContent = 'No servers yet — hit + New server up top.';
    list.appendChild(empty);
  }
  renderWorldsPanel();
}
// The + buttons live at the TOP RIGHT of each section (Liam's design) —
// NOT as cards inside the rows.
$('btn-new-world').onclick = () => {
  if (S.worlds.length >= 30) { alert('You already have 30 worlds — delete one to make room.'); return; }
  openWorldDialog(false);
};
$('btn-new-server').onclick = () => openWorldDialog(true);
let dialogIsServer = false;
function randomSeed() { return Math.floor(Math.random() * 2147483647); }
// Seed from the create dialog: blank = roll a fresh random one; a plain
// number is used as-is; any other text (words, etc.) is hashed to a
// full-range number, so anything typed works as a seed.
function parseSeed(text) {
  const t = (text || '').trim();
  if (!t) return randomSeed();
  if (/^-?\d+$/.test(t)) {
    const n = parseInt(t, 10);
    return ((n % 2147483647) + 2147483647) % 2147483647;
  }
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 2147483647;
}
function openWorldDialog(isServer) {
  dialogIsServer = isServer;
  $('world-dialog-title').textContent = isServer ? 'Create a Server' : 'Create a World';
  $('server-invite-row').classList.toggle('hidden', !isServer);
  if (isServer) {
    // Pre-invites are picked from a scrollable friends list — no
    // username typing. Empty state when there are no friends yet.
    const box = $('server-invite-list');
    box.innerHTML = '';
    if (!S.friends.length) {
      const empty = document.createElement('p');
      empty.className = 'fine';
      empty.textContent = 'No friends yet — add friends first, or create the server and invite people later.';
      box.appendChild(empty);
    }
    for (const f of S.friends) {
      const label = document.createElement('label');
      label.className = 'invite-pick';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = f.name;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + f.name));
      box.appendChild(label);
    }
  }
  $('world-name').value = '';
  $('world-keepinv').checked = false;
  $('world-friendly').checked = true;
  // Show the seed that will be used, so it can be kept or replaced.
  $('world-seed').value = String(randomSeed());

  $('world-dialog').classList.remove('hidden');
  $('world-name').focus();
}
$('world-cancel').onclick = () => $('world-dialog').classList.add('hidden');
$('world-create').onclick = () => {
  const name = $('world-name').value.trim() || (dialogIsServer ? 'New server' : 'New world');
  if (hasBadWord(name)) { alert('That name contains a blocked word.'); return; }
  // Seed comes from the dialog: the prefilled roll, a typed number, a
  // hashed word, or a fresh roll when left blank. Same-length names
  // (or any two worlds) must never silently share a seed — that was
  // one way islands came out identical.
  const seed = parseSeed($('world-seed').value);
  if (dialogIsServer) {
    const invited = [...document.querySelectorAll('#server-invite-list input:checked')].map((cb) => cb.value);
    S.servers.push({ id: uid(), name, seed, members: 1, invited, owner: S.session ? S.session.username : '', keepInv: false, friendly: true });
    save('somewhere_servers', S.servers); renderServers();
  } else {
    S.worlds.push({ id: uid(), name, seed, keepInv: $('world-keepinv').checked, friendly: $('world-friendly').checked, created: Date.now(), userCreated: true });
    save('somewhere_worlds', S.worlds); renderWorlds();
  }
  $('world-dialog').classList.add('hidden');
};
// Loading-overlay progress readout (Play path): percent + phase label,
// fed by buildWorld's onProgress via startGame. Guards keep a missing
// element from breaking the Play path.
function setLoadingProgress(frac, label) {
  const f = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0;
  const pct = $('loading-pct');
  if (pct) pct.textContent = Math.round(f * 100) + '%';
  const fill = $('loading-fill');
  if (fill) fill.style.width = (f * 100) + '%';
  const phase = $('loading-phase');
  if (phase && label) phase.textContent = label;
}
$('btn-play').onclick = () => {
  const w = S.worlds.find((x) => x.id === S.selectedWorld);
  const s = S.servers.find((x) => x.id === S.selectedServer);
  if (w) { w.lastPlayed = Date.now(); save('somewhere_worlds', S.worlds); }
  const world = w || { id: s.id, name: s.name, seed: s.seed ?? 777, keepInv: s.keepInv ?? false, friendly: s.friendly ?? true };
  stopLobbyLoop();
  $('lobby-screen').classList.add('hidden');
  $('game-screen').classList.remove('hidden');
  // Pointer lock straight from the Play click: no dead state where the
  // player can't move or look until they click again. This MUST stay
  // synchronous in the click handler, before any await below — a lock
  // request after an await is no longer a user gesture and browsers
  // reject it. Nothing on the Play path after this point drops it
  // (see the pointer-lock audit: only pause/menus/chat exit the lock).
  try {
    const lk = $('game-canvas').requestPointerLock();
    if (lk && lk.catch) lk.catch(() => {});
  } catch { /* click-to-lock fallback still works */ }
  // Loading screen FIRST: without a painted loading frame first the
  // world build just looks like the game froze. Yield two frames + a
  // beat so the overlay actually paints, then build; hide it ONLY in
  // the finally after the awaited startGame completes (its loop is
  // already running by then) — the old sync finally hid it at once,
  // before the async build finished.
  $('loading-screen').classList.remove('hidden');
  setLoadingProgress(0, 'Building your island…');
  const onProgress = (label, frac) => setLoadingProgress(frac, label);
  const go = async () => {
    try {
      if (!window.startGame) {
        await new Promise((resolve) => {
          const iv = setInterval(() => {
            if (window.startGame) { clearInterval(iv); resolve(); }
          }, 100);
        });
      }
      await window.startGame(world, onProgress);
    } catch (err) {
      // Half-started game must not linger: the overlay hides in the
      // finally below, and the player lands back in the lobby to retry
      // Play from. startGame already reset its own started flag.
      console.error('Failed to start game:', err);
      $('game-screen').classList.add('hidden');
      showLobby();
    } finally {
      $('loading-screen').classList.add('hidden');
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(go, 30)));
};

// Friends slide-in panel: hidden by default; the Friends button (top
// right) or F slides it in from the right edge, full height. X, the
// button again, or F again closes it. F is lobby-only here — in-game,
// F still eats (game.js owns that binding and is out of scope for
// this batch), and F never fires while typing in an input.
let friendsOpen = false;
// Two views inside the same panel: 'normal' (search your own friends +
// square + button) and 'add' (search by username to add). Opening the
// panel always lands on the normal view; closing resets to it too.
let friendsView = 'normal';
let friendSearchQuery = '';
function setFriendsView(view) {
  friendsView = view;
  $('friends-view').classList.toggle('hidden', view !== 'normal');
  $('friends-add-view').classList.toggle('hidden', view !== 'add');
  if (view === 'normal') renderFriends();
}
function setFriendsOpen(open) {
  friendsOpen = open;
  // Body-level class: the panel lives outside the lobby screen so it
  // can slide in over the game screen too (F works in game as well).
  document.body.classList.toggle('friends-open', open);
  if (open) {
    friendSearchQuery = ''; if ($('friend-search')) $('friend-search').value = ''; setFriendsView('normal');
    // In game, opening the panel frees the cursor like any other menu.
    if (!$('game-screen').classList.contains('hidden')) document.exitPointerLock?.();
  } else if (!$('game-screen').classList.contains('hidden')) {
    // Closing in game re-locks only when no other menu is open.
    const otherOpen = !$('inv-panel').classList.contains('hidden') || !$('shop-panel').classList.contains('hidden') ||
      !$('help-panel').classList.contains('hidden') || !$('pause-menu').classList.contains('hidden');
    if (!otherOpen) S.requestGameLock?.();
  }
}
// The game module runs in a separate scope, so it toggles the panel
// through this bridge (F in game).
S.setFriendsOpen = setFriendsOpen;
$('btn-friends').onclick = () => setFriendsOpen(!friendsOpen);
$('btn-close-friends').onclick = () => setFriendsOpen(false);
document.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyF') return;
  if ($('lobby-screen').classList.contains('hidden')) return;
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  setFriendsOpen(!friendsOpen);
});
function renderFriends() {
  $('friends-list').innerHTML = '';
  // Normal-view search filters your OWN friends only (case-insensitive
  // substring on username); it never adds anyone.
  const q = friendSearchQuery.trim().toLowerCase();
  const shown = q ? S.friends.filter((f) => f.name.toLowerCase().includes(q)) : S.friends;
  if (!S.friends.length) {
    const empty = document.createElement('p');
    empty.className = 'fine';
    empty.textContent = 'No friends yet — tap + to add someone by username.';
    $('friends-list').appendChild(empty);
    return;
  }
  if (!shown.length) {
    const none = document.createElement('p');
    none.className = 'fine';
    none.textContent = 'No friends match that search.';
    $('friends-list').appendChild(none);
    return;
  }
  for (const f of shown) {
    const row = document.createElement('div');
    row.className = 'friend-row';
    row.innerHTML = `<span class="dot ${f.online ? '' : 'off'}"></span><span class="f-name">${f.name}</span>` +
      (f.online ? '<button class="btn small">Invite</button>' : '<span class="fine">Offline</span>');
    row.querySelector('button')?.addEventListener('click', (e) => {
      e.target.textContent = 'Invited ✓'; e.target.disabled = true;
    });
    $('friends-list').appendChild(row);
  }
}
$('friend-search').addEventListener('input', (e) => {
  friendSearchQuery = e.target.value;
  renderFriends();
});
$('btn-add-view').onclick = () => setFriendsView('add');
$('btn-back-friends').onclick = () => setFriendsView('normal');
$('btn-add-friend').onclick = () => {
  const name = $('friend-name').value.trim();
  if (!name) return;
  S.friends.push({ name, online: false });
  save('somewhere_friends', S.friends);
  $('friend-name').value = '';
  // Back to the normal view so the new friend is visible in the list.
  setFriendsView('normal');
};
function renderInvites() {
  const list = $('invites-list');
  // Invites start EMPTY — no seeded invites. Real invites (if any) carry
  // their own server name; accepting one adds that server, never a fake.
  const invites = load('somewhere_invites', null) || [];
  list.innerHTML = '';
  if (!invites.length) {
    const empty = document.createElement('p');
    empty.className = 'fine';
    empty.textContent = 'No invites yet.';
    list.appendChild(empty);
  }
  for (const inv of invites) {
    const row = document.createElement('div');
    row.className = 'invite-row';
    row.innerHTML = `<span><b>${inv.from}</b> ${inv.text}</span><span>` +
      (inv.type === 'server'
        ? '<button class="btn small accept">Accept</button> <button class="btn small ghost decline">Decline</button>'
        : '') + '</span>';
    row.querySelector('.accept')?.addEventListener('click', () => {
      save('somewhere_invites', invites.filter((x) => x.id !== inv.id));
      if (inv.server && !S.servers.some((s) => s.name === inv.server)) {
        S.servers.push({ id: uid(), name: inv.server, seed: Math.floor(Math.random() * 2147483647), members: 1, invited: [], owner: inv.from || '', keepInv: false, friendly: true });
        save('somewhere_servers', S.servers); renderServers();
      }
      renderInvites();
    });
    row.querySelector('.decline')?.addEventListener('click', () => {
      save('somewhere_invites', invites.filter((x) => x.id !== inv.id));
      renderInvites();
    });
    list.appendChild(row);
  }
  $('invite-badge').textContent = invites.length;
  $('invite-badge').style.display = invites.length ? '' : 'none';
}

// ---------- Customization ----------
function swatchRow(el, colors, current, onPick) {
  el.innerHTML = '';
  for (const c of colors) {
    const b = document.createElement('button');
    b.className = 'swatch' + (c === current ? ' sel' : '');
    b.style.background = c; b.title = c;
    b.onclick = () => { onPick(c); swatchRow(el, colors, c, onPick); };
    el.appendChild(b);
  }
}
// Chip labels are display-capitalized: stored values stay lowercase
// ('short', 'sweatpants') but the player never sees a lowercase label.
// Labels are per-row: 'long' means Long hair in the hair row but Long
// Sleeve in the shirt row, so a shared map would mislabel one of them.
const chipLabel = (o, labels) => (labels && labels[o]) || (o.charAt(0).toUpperCase() + o.slice(1));
function chipRow(el, options, current, onPick, labels) {
  el.innerHTML = '';
  for (const o of options) {
    const b = document.createElement('button');
    b.className = 'chip' + (o === current ? ' sel' : '');
    b.textContent = chipLabel(o, labels);
    b.onclick = () => { onPick(o); chipRow(el, options, o, onPick); };
    el.appendChild(b);
  }
}
function renderCustomize() {
  swatchRow($('cust-skin'), SKIN_TONES, S.char.skin, (c) => { S.char.skin = c; saveChar(); });
  chipRow($('cust-hair'), HAIR_STYLES, S.char.hair, (v) => { S.char.hair = v; saveChar(); });
  swatchRow($('cust-haircolor'), HAIR_COLORS, S.char.hairColor, (c) => { S.char.hairColor = c; saveChar(); });
  chipRow($('cust-sleeve'), ['normal', 'long'], S.char.sleeve, (v) => { S.char.sleeve = v; saveChar(); }, { normal: 'Normal', long: 'Long Sleeve' });
  swatchRow($('cust-shirt'), SHIRT_COLORS, S.char.shirt, (c) => { S.char.shirt = c; saveChar(); });
  chipRow($('cust-pants'), ['shorts', 'sweatpants'], S.char.pants, (v) => { S.char.pants = v; saveChar(); }, { shorts: 'Shorts', sweatpants: 'Sweatpants' });
  swatchRow($('cust-pantscolor'), PANTS_COLORS, S.char.pantsColor, (c) => { S.char.pantsColor = c; saveChar(); });
  swatchRow($('cust-shoes'), SHOE_COLORS, S.char.shoes, (c) => { S.char.shoes = c; saveChar(); });
}
function saveChar() { save('somewhere_char', S.char); refreshCharacter(); }
$('btn-randomize').onclick = () => {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  S.char = {
    skin: pick(SKIN_TONES), hair: pick(HAIR_STYLES), hairColor: pick(HAIR_COLORS),
    sleeve: pick(['normal', 'long']), shirt: pick(SHIRT_COLORS),
    pants: pick(['shorts', 'sweatpants']), pantsColor: pick(PANTS_COLORS), shoes: pick(SHOE_COLORS),
  };
  saveChar(); renderCustomize();
};

// ---------- Settings ----------
function renderKeybinds() {
  const wrap = $('keybinds'); wrap.innerHTML = '';
  for (const [action, code] of Object.entries(S.keybinds)) {
    const d = document.createElement('div');
    d.className = 'keybind';
    d.innerHTML = `<span>${KEY_LABELS[action] || action}</span><b>${keyName(code)}</b>`;
    d.onclick = () => {
      d.classList.add('listening');
      d.querySelector('b').textContent = '…';
      const handler = (e) => {
        e.preventDefault(); e.stopPropagation();
        S.keybinds[action] = e.code;
        save('somewhere_keybinds', S.keybinds);
        document.removeEventListener('keydown', handler, true);
        renderKeybinds();
      };
      document.addEventListener('keydown', handler, true);
    };
    wrap.appendChild(d);
  }
}
function applySettings() {
  const b = S.settings.brightness || 100;
  document.querySelectorAll('canvas').forEach((c) => { c.style.filter = `brightness(${b}%)`; });
  $('set-brightness').value = b; $('brightness-val').textContent = b + '%';
  $('set-audio').value = S.settings.audio; $('audio-val').textContent = S.settings.audio + '%';
  renderCustomize();
}
$('set-brightness').oninput = (e) => { S.settings.brightness = +e.target.value; save('somewhere_settings', S.settings); applySettings(); };
$('set-audio').oninput = (e) => { S.settings.audio = +e.target.value; $('audio-val').textContent = e.target.value + '%'; save('somewhere_settings', S.settings); };
$('set-username').onchange = (e) => {
  const v = e.target.value.trim();
  if (!v || v.length > 15 || hasBadWord(v)) { alert('Invalid username (max 15 characters, no blocked words).'); e.target.value = S.session.username; return; }
  const users = load('somewhere_users', {});
  if (Object.values(users).some((u) => u.username.toLowerCase() === v.toLowerCase() && v.toLowerCase() !== S.session.username.toLowerCase())) {
    alert('That username is taken.'); e.target.value = S.session.username; return;
  }
  S.session.username = v; save('somewhere_session', S.session);
  if (S.session.email && users[S.session.email]) { users[S.session.email].username = v; save('somewhere_users', users); }
  $('header-username').textContent = v; $('np-name').textContent = v;
  setPfp($('header-pfp'), v); setPfp($('np-pfp'), v);
};
$('set-pfp').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    S.session.pfp = r.result; save('somewhere_session', S.session);
    const users = load('somewhere_users', {});
    if (S.session.email && users[S.session.email]) { users[S.session.email].pfp = r.result; save('somewhere_users', users); }
    setPfp($('header-pfp'), S.session.username); setPfp($('np-pfp'), S.session.username);
  };
  r.readAsDataURL(f);
};
addEventListener('resize', () => {
  if (panoRenderer) { panoRenderer.setSize(innerWidth, innerHeight); panoCam.aspect = innerWidth / innerHeight; panoCam.updateProjectionMatrix(); }
});

// ---------- Boot ----------
window.addEventListener('error', (e) => {
  const el = $('error-overlay');
  el.textContent = 'Error: ' + (e.message || e.error);
  el.classList.remove('hidden');
});
// Start the lobby panorama build NOW, behind the login screen, so by
// sign-in the island is already built or nearly done. A failure here
// is logged only — login and lobby UI never depend on this; the lobby
// loop reuses the same guarded setup when it appears.
initLobby3D().catch((err) => console.error('Early lobby 3D start failed:', err));
const params = new URLSearchParams(location.search);
if (params.get('autoguest') === '1') {
  S.session = { guest: true, username: 'DemoPlayer', pfp: '' };
  save('somewhere_session', S.session);
  showLobby();
  if (params.get('screen') === 'customize') switchTab('customize');
} else if (params.get('demo') === '1') {
  S.session = { guest: true, username: 'DemoPlayer', pfp: '' };
  save('somewhere_session', S.session);
  showLobby();
  setTimeout(async () => {
    const world = { id: 'demo', name: 'Demo Island', seed: 4242, keepInv: false, friendly: true };
    $('lobby-screen').classList.add('hidden');
    $('game-screen').classList.remove('hidden');
    // Async-safe like the Play path: await the build instead of firing
    // it sync, and surface a failure on the error overlay rather than
    // leaving an unhandled rejection.
    try {
      if (!window.startGame) {
        await new Promise((resolve) => {
          const iv = setInterval(() => {
            if (window.startGame) { clearInterval(iv); resolve(); }
          }, 100);
        });
      }
      await window.startGame(world);
    } catch (err) {
      console.error('Demo startGame failed:', err);
      const el = $('error-overlay');
      el.textContent = 'Error: ' + (err && err.message ? err.message : err);
      el.classList.remove('hidden');
    }
  }, 600);
} else if (S.session) {
  showLobby();
  if (params.get('screen') === 'customize') switchTab('customize');
} else {
  // No session: show auth UNDER the boot overlay (z-200 covers it) —
  // the overlay hides only from onLobbyBuiltSettled once the panorama
  // build settles, never here. Auth is usable the moment it lifts.
  $('auth-screen').classList.remove('hidden');
}
