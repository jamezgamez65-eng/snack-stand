// ===== Snack Stand – service worker =====
// Bump VERSION whenever you upload a new build so every device fetches the new files.
const VERSION = '2.3.0';
const CACHE = `snack-stand-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './logic.js',
  './images.js',
  './pricing.js',
  './manifest.webmanifest',
  './fonts/baloo2.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// On localhost, always try the network first so edits show up immediately.
const DEV = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('snack-stand-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Data files like prices.csv change without a new app version: always try the network first.
  if (DEV || url.pathname.endsWith('.csv')) {
    event.respondWith(networkFirst(event));
    return;
  }
  event.respondWith(cacheFirst(event));
});

async function cacheFirst(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });

  // Refresh the cached copy in the background so the next launch gets any update.
  const refresh = fetch(request)
    .then((res) => { if (res && res.ok) cache.put(request, res.clone()); return res; })
    .catch(() => null);

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const res = await refresh;
  if (res) return res;
  return offlineFallback(request, cache);
}

async function networkFirst(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (_) {
    const cached = await cache.match(request, { ignoreSearch: true });
    return cached || offlineFallback(request, cache);
  }
}

async function offlineFallback(request, cache) {
  if (request.mode === 'navigate') {
    const page = await cache.match('./index.html');
    if (page) return page;
  }
  return new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain' } });
}
