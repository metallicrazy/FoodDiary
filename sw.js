/* FoodDiary service worker — offline app shell + kept-between-updates libraries, UK food list and product pictures.
   Bump VERSION when you change the app. */
const VERSION = 'fooddiary-v1.25.0';
const SHELL = [
  './', 'index.html', 'css/styles.css',
  'js/nutrition.js', 'js/portions.js', 'js/names.js', 'js/ranking.js', 'js/share.js', 'js/scanner.js', 'js/store.js', 'js/sources.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];
// The UK food list (544 KB) lives in its own cache that survives app updates (1.21.0).
// Bump DATA only when data/cofid.json itself changes — that is what makes phones download it again.
const DATA = 'fooddiary-data-2';
const DATA_FILES = ['data/cofid.json'];
// Libraries from the CDN (charts, scanner, label reading). All their addresses are pinned to exact versions,
// so they can be kept across app updates. Bump LIBS if you change a library version in app.js / scanner.js / sources.js.
const LIBS = 'fooddiary-libraries-1';
// Product pictures from Open Food Facts (1.20.0): their own cache, capped, and only stored when fetched with CORS.
// A picture loaded the normal way is an "opaque" response, which Chrome counts as ~7 MB of storage each; caching
// hundreds of those could make Android clear the app's storage (diary included) when the phone runs low on space.
const IMAGES = 'fooddiary-product-images';
const IMAGE_LIMIT = 150;
const KEEP = [VERSION, DATA, LIBS, IMAGES];

// Fresh copies straight from the server (not the browser's short-term cache), so a new version never
// installs with a stale file from the previous one.
const fresh = (u) => new Request(u, { cache: 'reload' });

self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all([
    caches.open(VERSION).then((c) => c.addAll(SHELL.map(fresh))),
    caches.open(DATA).then(async (c) => { for (const u of DATA_FILES) if (!(await c.match(u))) await c.add(fresh(u)); })
  ]).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  // Removes old app versions and the old per-version library caches (which also held uncapped picture copies).
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
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

  // Same-origin app files: served from the phone INSTANTLY (cache-first). Since 1.21.0 there is no background
  // refresh: every file of a version is installed together when VERSION changes, so a phone can never end up
  // with a mix of old and new files (e.g. if it opened the app while an upload was half-way through).
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      // Not cached (a file outside the list above): go to the network, but don't hang forever.
      return fetchWithTimeout(req, 8000).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    }));
    return;
  }

  // Product pictures: capped cache of real (non-opaque) responses only.
  if (/(^|\.)openfoodfacts\.(org|net)$/.test(url.hostname) && (req.destination === 'image' || /\.(jpe?g|png|webp)$/i.test(url.pathname))) {
    e.respondWith(productImage(req));
    return;
  }

  // CDN libraries (Chart.js, scanner, OCR + language data): cache-first, kept across updates.
  if (/jsdelivr\.net|cdn\.sheetjs\.com|unpkg\.com|tessdata/.test(url.hostname + url.pathname)) {
    e.respondWith(library(req));
  }
});

async function library(req) {
  const c = await caches.open(LIBS);
  const hit = await c.match(req.url);
  if (hit) return hit;
  try {
    // Ask with CORS first so the stored copy counts at its real size; fall back to a normal request.
    let res;
    try { res = await fetchWithTimeout(new Request(req.url, { mode: 'cors', credentials: 'omit' }), 15000); }
    catch (err) { res = await fetchWithTimeout(req, 15000); }
    if (res.ok || res.type === 'opaque') await c.put(req.url, res.clone()); // a handful of files, so opaque copies are acceptable here
    return res;
  } catch (err) {
    return Response.error();
  }
}

async function productImage(req) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    // Ask for the picture with CORS so the stored copy counts at its real size (a few KB).
    const res = await fetchWithTimeout(new Request(req.url, { mode: 'cors', credentials: 'omit' }), 15000);
    if (res.ok && res.type !== 'opaque') {
      await cache.put(req.url, res.clone());
      const keys = await cache.keys();
      if (keys.length > IMAGE_LIMIT) await Promise.all(keys.slice(0, keys.length - IMAGE_LIMIT).map((k) => cache.delete(k))); // oldest first
    }
    return res;
  } catch (err) {
    // CORS not available (or offline): show the picture normally, but don't store it.
    try { return await fetch(req); } catch (e) { return Response.error(); }
  }
}
