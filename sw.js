const CACHE_NAME = 'siap-tool-v3.1'; // Update versi buat paksa refresh
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './photo_utils.js',
  './manifest.json',
  './icons/logo.png'
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
  // Biar ga cache request API/External
  if (event.request.url.includes('workers.dev') || event.request.url.includes('googleusercontent.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});