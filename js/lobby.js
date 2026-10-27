import * as THREE from 'three';
import { buildCharacter, SKIN_TONES, HAIR_COLORS, HAIR_STYLES, SHIRT_COLORS, PANTS_COLORS, SHOE_COLORS, DEFAULT_CHAR } from './character.js';
import { buildWorld, makeSkyDome } from './world.js';
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
if (!S.worlds) {
  S.worlds = [{ id: uid(), name: 'First Island', seed: Math.floor(Math.random() * 100000), keepInv: false, friendly: true, created: Date.now() }];
  save('somewhere_worlds', S.worlds);
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
let lobbyRenderer, panoRenderer, charRenderer, panoScene, panoCam, charScene, charCam, charGroup, lobbyRAF = null, lobbyClock = new THREE.Clock();
function initLobby3D() {
  if (lobbyRenderer) return;
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
  const panoWorld = buildWorld(panoScene, 20261027); // the set lobby world, same for everyone
  panoScene.userData.center = panoWorld.spawn;
  panoCam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);

  charRenderer = new THREE.WebGLRenderer({ canvas: $('char-canvas'), antialias: true, alpha: true });
  charRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  charRenderer.setSize(280, 350);
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
  refreshCharacter();
}
function refreshCharacter() {
  if (!charScene) return;
  if (charGroup) charScene.remove(charGroup);
  charGroup = buildCharacter(S.char);
  charGroup.position.y = 0;
  charScene.add(charGroup);
}
function lobbyLoop() {
  if (!$('lobby-screen') || $('lobby-screen').classList.contains('hidden')) { lobbyRAF = null; return; }
  const dt = Math.min(lobbyClock.getDelta(), 0.05);
  const t = lobbyClock.elapsedTime;
  const ang = t * 0.045; // slow panorama rotation, Minecraft-style
  const ctr = panoScene.userData.center || { x: 0, y: 6, z: 0 };
  panoCam.position.set(ctr.x + Math.cos(ang) * 48, ctr.y + 20, ctr.z + Math.sin(ang) * 48);
  panoCam.lookAt(ctr.x, ctr.y + 2, ctr.z);
  panoRenderer.render(panoScene, panoCam);
  if (charGroup) charGroup.rotation.y = Math.sin(t * 0.35) * 0.35;
  charRenderer.render(charScene, charCam);
  lobbyRAF = requestAnimationFrame(lobbyLoop);
}
function startLobbyLoop() {
  initLobby3D();
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
  $('auth-screen').classList.add('hidden');
  $('lobby-screen').classList.remove('hidden');
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
// Top tabs open a NEW MENU: a full menu screen of its own that covers the
// lobby (hero + friends hidden), with a Back button returning to Play.
function switchTab(tab) {
  document.querySelectorAll('.lobby-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  for (const p of ['play', 'customize', 'invites', 'settings']) {
    $('panel-' + p).classList.toggle('hidden', p !== tab);
  }
  $('lobby-screen').classList.toggle('menu-open', tab !== 'play');
}
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
function makeWorldCard({ title, icon, lines, artSeed, selected, onSelect }) {
  const card = document.createElement('button');
  card.className = 'world-card' + (selected ? ' selected' : '');
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
  return card;
}
function selectWorld(w) {
  S.selectedWorld = w.id; S.selectedServer = null;
  renderWorlds(); renderServers();
  $('btn-play').classList.remove('hidden');
  $('selected-world-label').textContent = 'Selected: ' + w.name;
}
function selectServer(s) {
  S.selectedServer = s.id; S.selectedWorld = null;
  renderWorlds(); renderServers();
  $('btn-play').classList.remove('hidden');
  $('selected-world-label').textContent = 'Selected server: ' + s.name;
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
    }));
  }
  if (!S.worlds.length) {
    const empty = document.createElement('p');
    empty.className = 'world-empty';
    empty.textContent = 'No worlds yet — hit + New world up top.';
    list.appendChild(empty);
  }
}
function renderServers() {
  const list = $('servers-list');
  list.innerHTML = '';
  for (const s of S.servers) {
    const members = s.members || (1 + (s.invited ? s.invited.length : 0));
    list.appendChild(makeWorldCard({
      title: s.name, icon: uiIcon('server'), artSeed: 777 + s.name.length * 131,
      selected: S.selectedServer === s.id,
      lines: [
        `Private server · Up to 20 members`,
        `${members} member${members === 1 ? '' : 's'} · Freezes when empty`,
        s.invited && s.invited.length ? `Invited: ${s.invited.join(', ')}` : 'Hop in anytime',
      ],
      onSelect: () => selectServer(s),
    }));
  }
  if (!S.servers.length) {
    const empty = document.createElement('p');
    empty.className = 'world-empty';
    empty.textContent = 'No servers yet — hit + New server up top.';
    list.appendChild(empty);
  }
}
// The + buttons live at the TOP RIGHT of each section (Liam's design) —
// NOT as cards inside the rows.
$('btn-new-world').onclick = () => {
  if (S.worlds.length >= 30) { alert('You already have 30 worlds — delete one to make room.'); return; }
  openWorldDialog(false);
};
$('btn-new-server').onclick = () => openWorldDialog(true);
let dialogIsServer = false;
function openWorldDialog(isServer) {
  dialogIsServer = isServer;
  $('world-dialog-title').textContent = isServer ? 'Create a server' : 'Create a world';
  $('server-invite-row').classList.toggle('hidden', !isServer);
  $('world-name').value = '';
  $('world-keepinv').checked = false;
  $('world-friendly').checked = true;
  $('world-dialog').classList.remove('hidden');
  $('world-name').focus();
}
$('world-cancel').onclick = () => $('world-dialog').classList.add('hidden');
$('world-create').onclick = () => {
  const name = $('world-name').value.trim() || (dialogIsServer ? 'New server' : 'New world');
  if (hasBadWord(name)) { alert('That name contains a blocked word.'); return; }
  const seed = Math.floor(Math.random() * 100000);
  if (dialogIsServer) {
    S.servers.push({ id: uid(), name, members: 1, invited: $('server-invites').value.split(',').map((s) => s.trim()).filter(Boolean) });
    save('somewhere_servers', S.servers); renderServers();
  } else {
    S.worlds.push({ id: uid(), name, seed, keepInv: $('world-keepinv').checked, friendly: $('world-friendly').checked, created: Date.now() });
    save('somewhere_worlds', S.worlds); renderWorlds();
  }
  $('world-dialog').classList.add('hidden');
};
$('btn-play').onclick = () => {
  const w = S.worlds.find((x) => x.id === S.selectedWorld);
  const s = S.servers.find((x) => x.id === S.selectedServer);
  if (w) { w.lastPlayed = Date.now(); save('somewhere_worlds', S.worlds); }
  const world = w || { id: s.id, name: s.name, seed: 777 + s.name.length * 131, keepInv: false, friendly: true };
  stopLobbyLoop();
  $('lobby-screen').classList.add('hidden');
  $('game-screen').classList.remove('hidden');
  if (window.startGame) window.startGame(world);
  else { const iv = setInterval(() => { if (window.startGame) { clearInterval(iv); window.startGame(world); } }, 100); }
};

function renderFriends() {
  $('friends-list').innerHTML = '';
  if (!S.friends.length) {
    const empty = document.createElement('p');
    empty.className = 'fine';
    empty.textContent = 'No friends yet — add someone by username below.';
    $('friends-list').appendChild(empty);
  }
  for (const f of S.friends) {
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
$('btn-add-friend').onclick = () => {
  const name = $('friend-name').value.trim();
  if (!name) return;
  S.friends.push({ name, online: false });
  save('somewhere_friends', S.friends);
  $('friend-name').value = '';
  renderFriends();
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
        S.servers.push({ id: uid(), name: inv.server, members: 1, invited: [] });
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
function chipRow(el, options, current, onPick) {
  el.innerHTML = '';
  for (const o of options) {
    const b = document.createElement('button');
    b.className = 'chip' + (o === current ? ' sel' : '');
    b.textContent = o;
    b.onclick = () => { onPick(o); chipRow(el, options, o, onPick); };
    el.appendChild(b);
  }
}
function renderCustomize() {
  swatchRow($('cust-skin'), SKIN_TONES, S.char.skin, (c) => { S.char.skin = c; saveChar(); });
  chipRow($('cust-hair'), HAIR_STYLES, S.char.hair, (v) => { S.char.hair = v; saveChar(); });
  swatchRow($('cust-haircolor'), HAIR_COLORS, S.char.hairColor, (c) => { S.char.hairColor = c; saveChar(); });
  chipRow($('cust-sleeve'), ['normal', 'long'], S.char.sleeve, (v) => { S.char.sleeve = v; saveChar(); });
  swatchRow($('cust-shirt'), SHIRT_COLORS, S.char.shirt, (c) => { S.char.shirt = c; saveChar(); });
  chipRow($('cust-pants'), ['shorts', 'sweatpants'], S.char.pants, (v) => { S.char.pants = v; saveChar(); });
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
  $('set-voice').value = S.settings.voice;
  renderCustomize();
}
$('set-brightness').oninput = (e) => { S.settings.brightness = +e.target.value; save('somewhere_settings', S.settings); applySettings(); };
$('set-audio').oninput = (e) => { S.settings.audio = +e.target.value; $('audio-val').textContent = e.target.value + '%'; save('somewhere_settings', S.settings); };
$('set-voice').onchange = (e) => { S.settings.voice = e.target.value; save('somewhere_settings', S.settings); };
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
  setTimeout(() => {
    const world = { id: 'demo', name: 'Demo Island', seed: 4242, keepInv: false, friendly: true };
    $('lobby-screen').classList.add('hidden');
    $('game-screen').classList.remove('hidden');
    if (window.startGame) window.startGame(world);
    else { const iv = setInterval(() => { if (window.startGame) { clearInterval(iv); window.startGame(world); } }, 100); }
  }, 600);
} else if (S.session) {
  showLobby();
  if (params.get('screen') === 'customize') switchTab('customize');
} else {
  $('auth-screen').classList.remove('hidden');
}
