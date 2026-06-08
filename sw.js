/* Service Worker — cache applicatif pour fonctionnement hors-ligne */
const CACHE = 'batidevis-v5';
const FICHIERS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stratégie « cache d'abord » : l'app reste utilisable sans connexion.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((rep) => rep || fetch(e.request).then((net) => {
      const copie = net.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copie)).catch(() => {});
      return net;
    }).catch(() => caches.match('./index.html')))
  );
});
