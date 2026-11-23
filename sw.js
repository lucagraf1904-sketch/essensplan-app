// Offline-Cache für die App-Dateien (Network-first, damit Updates sofort ankommen).
const CACHE = 'speisekammer-v61';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'store.js', 'categories.js', 'receipt.js', 'balance.js', 'config.js', 'store-supabase.js', 'barcode.js', 'offers.js', 'settings.js', 'tips.js', 'conditions.js', 'health.js', 'shared.js', 'weight.js', 'plan.js', 'recipes.js', 'shifts.js', 'meds.js', 'onboarding.js', 'suggestions.js', 'eaten.js', 'ai.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      if (r.ok && new URL(e.request.url).origin === location.origin) {
        const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});
// Push vom Server (Edge Function „reminders“)
self.addEventListener('push', e => {
  let d = {}; try { d = e.data?.json() ?? {}; } catch { d = { title: 'Speisekammer', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Speisekammer', { body: d.body || '', icon: 'icon.svg', tag: d.tag }));
});
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.openWindow('./')); });
