// giggerlay service worker.
// - App shell: served from cache (works with no signal), refreshed in the
//   background on every use so the next launch has the latest files.
// - Bump VERSION on each deploy: the new worker re-downloads the whole shell,
//   takes over at once, and the page reloads itself when it is safe.
// - OCR / barcode libraries and language data from the CDNs are cached on
//   first use (their URLs are pinned, so cache-first is safe).
const VERSION = 'v3';
const SHELL_CACHE = `giggerlay-shell-${VERSION}`;
const RUNTIME_CACHE = 'giggerlay-runtime';
const CDN_CACHE = 'giggerlay-cdn-v1';

// Paths relative to this file. Missing files are skipped, not fatal.
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'src/app.js',
  'src/contracts.js',
  'src/storage.js',
  'src/ui/dom.js',
  'src/ui/route.js',
  'src/ui/import.js',
  'src/ui/review.js',
  'src/ui/settings.js',
  'src/street.js',
  'src/matcher.js',
  'src/itinerary.js',
  'src/review.js',
  'src/ocr.js',
  'src/import/importer.js',
  'src/import/slice.js',
  'src/import/sharpness.js',
  'src/import/fingerprint.js',
  'src/import/frames.js',
  'src/load/session.js',
  'src/load/screen.js',
  'src/load/camera.js',
  'src/load/barcode.js',
  'src/load/voice.js',
  'src/load/load.css',
];

const CDN_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'unpkg.com',
  'tessdata.projectnaptha.com',
]);

const shellURLs = new Set(SHELL.map((p) => new URL(p, self.registration.scope).href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(
        SHELL.map((p) =>
          fetch(new Request(p, { cache: 'reload' })).then((res) => {
            if (res.ok) return cache.put(p, res);
          }),
        ),
      ),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('giggerlay-shell-') && k !== SHELL_CACHE)
          .map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(staleWhileRevalidate(event, new URL('./', self.registration.scope).href, req));
      return;
    }
    const clean = url.origin + url.pathname;
    if (shellURLs.has(clean)) {
      event.respondWith(staleWhileRevalidate(event, clean, req));
      return;
    }
    event.respondWith(networkFirst(req));
    return;
  }

  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(req));
  }
});

async function staleWhileRevalidate(event, key, req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(key, { ignoreSearch: true });
  const network = fetch(req.mode === 'navigate' ? key : req, { cache: 'no-cache' })
    .then((res) => {
      if (res.ok) {
        const copy = res.clone();
        event.waitUntil(cache.put(key, copy));
      }
      return res;
    });
  if (cached) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  return network.catch(async () => (await cache.match('index.html')) || Response.error());
}

async function networkFirst(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  // Opaque (no-cors) responses have status 0 but are still usable.
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
  return res;
}
