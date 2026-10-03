/* FoodDiary service worker — offline app shell + cached libraries/images. Bump VERSION when you change the app. */
const VERSION = 'fooddiary-v1.10.4';
const SHELL = [
  './', 'index.html', 'css/styles.css',
  'js/nutrition.js', 'js/store.js', 'js/sources.js', 'js/app.js',
  'data/cofid.json', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];
const RUNTIME = VERSION + '-runtime';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Fetch with a short timeout so an offline/flaky connection never leaves the screen blank.
function fetchWithTimeout(req, ms, init) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req, init).then((r) => { clearTimeout(t); resolve(r); }, (err) => { clearTimeout(t); reject(err); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Live API calls: network only (the app caches results itself).
  if (/openfoodfacts\.org$/.test(url.hostname) && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cgi/'))) return;

  // Same-origin app shell: serve the cached copy INSTANTLY, then refresh the cache in the background
  // when online. New releases are picked up by the VERSION change in this file (the app checks for
  // that on every launch and reloads itself), so the user still gets updates promptly.
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
      const refresh = () => fetchWithTimeout(req, 8000, { cache: 'no-cache' }).then((res) => {
        if (res && res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
        return res;
      });
      if (hit) {
        if (navigator.onLine) e.waitUntil(refresh().catch(() => {}));
        return hit;
      }
      // Not cached yet (first visit or a brand-new file): go to the network, but don't hang forever.
      return refresh().catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    }));
    return;
  }

  // CDN libraries (Chart.js, scanner, OCR + language data) and product images: cache first.
  if (/cdn\.jsdelivr\.net|cdn\.sheetjs\.com|unpkg\.com|tessdata|openfoodfacts\.org/.test(url.hostname + url.pathname)) {
    e.respondWith(caches.open(RUNTIME).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetchWithTimeout(req, 15000);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      } catch (err) {
        return Response.error();
      }
    }));
  }
});
