// Haushaltskasse: Offline-Cache (Network-first, damit Updates sofort ankommen; ohne Netz kommt der letzte Stand).
// Die Supabase-Bibliothek (esm.sh) wird mit zwischengespeichert, damit die App auch ohne Netz startet.
const CACHE = 'haushaltskasse-v6-1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'store.js', 'logic.js', 'categories.js', 'charts.js', 'policies.js', 'retrieval.js', '../config.js',
  'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png', 'icon-512.png', 'vendor/fonts/atkinson-hyperlegible-next-latin-400-normal.woff2', 'vendor/fonts/atkinson-hyperlegible-next-latin-700-normal.woff2'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('haushaltskasse-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const mine = url.origin === location.origin, lib = url.hostname === 'esm.sh';
  if (!mine && !lib) return; // Supabase-Anfragen (Daten, Anmeldung) nie zwischenspeichern
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request))
  );
});
