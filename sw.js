/* Service worker de GesFrío: guarda la app en el dispositivo para que funcione sin conexión.
 * IMPORTANTE: al cambiar cualquier archivo de la app, sube el número de VERSION
 * para que los móviles descarguen la versión nueva la próxima vez que tengan internet. */
const VERSION = 'gesfrio-v2.0.1';
const ARCHIVOS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(ARCHIVOS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Primero la caché (instantáneo y sin cobertura); si no está, se intenta la red.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(r => r || fetch(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(VERSION).then(c => c.put(req, copia));
        }
        return res;
      });
    })
  );
});
