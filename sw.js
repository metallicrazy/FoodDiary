/* FoodDiary service worker — offline app shell + cached libraries/images. Bump VERSION when you change the app. */
const VERSION = 'fooddiary-v1.3.0';
const SHELL = [
  './', 'index.html', 'css/styles.css',
  'js/nutrition.js', 'js/store.js', 'js/sources.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];
const RUNTIME = VERSION + '-runtime';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Live API calls: network only (the app caches results itself).
  if (/openfoodfacts\.org$/.test(url.hostname) && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cgi/'))) return;

  // Same-origin app shell: network first (so updates show straight away), cached copy when offline.
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
    return;
  }

  // CDN libraries (Chart.js, scanner, OCR + language data) and product images: cache first.
  if (/cdn\.jsdelivr\.net|cdn\.sheetjs\.com|unpkg\.com|tessdata|openfoodfacts\.org/.test(url.hostname + url.pathname)) {
    e.respondWith(caches.open(RUNTIME).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      } catch (err) {
        return hit || Response.error();
      }
    }));
  }
});
