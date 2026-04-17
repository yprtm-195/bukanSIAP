const CACHE_NAME = 'siap-tool-v3.2'; // Update versi buat paksa refresh
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './photo_utils.js',
  './pricetag.js',
  './store_master.js',
  './manifest.json',
  './icons/logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install: Cache Assets
self.addEventListener('install', event => {
  self.skipWaiting(); // Paksa SW baru aktif langsung
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// Activate: Bersihin cache lama
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

// Fetch: Strategi Network First biar ga stale
self.addEventListener('fetch', event => {
  // Skip non-GET request
  if (event.request.method !== 'GET') return;
  
  // Skip request API/External
  if (event.request.url.includes('workers.dev') || event.request.url.includes('googleusercontent.com')) {
    return;
  }

  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .catch(() => {
        return caches.match(event.request).then(cached => {
          // Kalau ada di cache, return. Kalau ngga ada, return 404 yang proper biar ga error
          return cached || new Response('Not Found', { status: 404, statusText: 'Not Found' });
        });
      })
  );
});