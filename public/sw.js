// Keeps the app shell on the phone so it opens without internet.
// API data is cached and queued by js/api.js.
const CACHE = 'teknons-shell-v6';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/api.js', '/js/ui.js', '/js/accounting.js', '/js/core-pages.js', '/js/shop.js', '/js/pos.js', '/js/shop-pricing.js', '/js/barcode.js', '/js/hotel.js', '/js/hotel-ops.js', '/js/resto.js', '/js/resto-ops.js', '/icon.svg', '/manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/print/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  // Stale-while-revalidate for static files
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
