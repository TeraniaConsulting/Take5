const CACHE_NAME = 'terania-take5-cache-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './index.css',
  './app.js',
  './auth.js',
  './manifest.json',
  './assets/jspdf.umd.min.js',
  './assets/_Terania_Horizonal_Green.png',
  './assets/_Terania_Horizonal_Reversed.png',
  './assets/_Terania_Icon_Green.png',
  './assets/_Terania_Icon_Reversed.png',
  './assets/_Terania_Stacked_Green.png',
  './assets/_Terania_Stacked_Reversed.png',
  './assets/_Terania_Horizontal_Tagline_Green.png',
  './assets/_Terania_Horizontal_Tagline_Mono.png',
  './assets/_Terania_Horizontal_Tagline_Reversed.png',
  './assets/_Terania_Stacked_Tagline_Green.png',
  './assets/_Terania_Stacked_Tagline_Mono.png',
  './assets/_Terania_Stacked_Tagline_Reversed.png',
  './assets/_Terania_Stacked_Mono.png',
  './assets/_Terania_Horizonal_Mono.png',
  './assets/_Terania_Icon_Mono.png'
];

// Install Event - cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching app shell and core assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - network first, fallback to cache
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // If a valid response was fetched, cache it dynamically
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache if network fails
        console.log('[Service Worker] Fetch failed, loading from cache:', event.request.url);
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If the resource is not in cache and network fails, return a basic offline error response
          if (event.request.headers.get('accept').includes('text/html')) {
            return caches.match('./index.html');
          }
        });
      })
  );
});
