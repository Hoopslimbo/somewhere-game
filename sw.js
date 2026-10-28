// Somewhere service worker — network-first, cache fallback.
//
// Deliberately network-first: the game updates by pushing to the same site,
// so a cache-first worker could serve a stale game after an update. The cache
// is only a fallback for when the network is unavailable.
const CACHE = 'somewhere-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/character.js',
  './js/data.js',
  './js/game.js',
  './js/icons.js',
  './js/lobby.js',
  './js/world.js',
  './assets/three.module.js',
  './assets/logo.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache a copy of same-origin, successful responses for offline use.
        if (res.ok && new URL(req.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        // Navigation fallback: serve the cached app shell when offline.
        if (req.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        throw new Error('offline and no cached copy');
      })
  );
});
