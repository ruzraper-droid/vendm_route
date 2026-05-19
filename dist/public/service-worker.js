const APP_CACHE_NAME = 'fcalendar-app-v4';
const MAP_TILE_CACHE_NAME = 'fcalendar-map-tiles-v1';
const MAP_TILE_CACHE_LIMIT = 1200;
const MAP_TILE_TRIM_INTERVAL = 40;

let mapTileWriteCount = 0;
let mapTileTrimInFlight = false;

// Only cache truly immutable assets (icons/manifest that don't change between deploys)
const PRECACHE_URLS = [
  '/manifest.json',
  '/FamilyMart.png',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((name) => {
          if (name !== APP_CACHE_NAME && name !== MAP_TILE_CACHE_NAME) return caches.delete(name);
        })
      )
    )
  );
  self.clients.claim();
});

function isMapTileRequest(requestUrl) {
  // Keep SW tile cache for OSM only. Google tile endpoints can be slower when
  // proxied through custom SW caching logic on some networks/devices.
  return /(^|\.)tile\.openstreetmap\.org$/i.test(requestUrl.hostname);
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;

  const deleteCount = keys.length - maxEntries;
  for (let i = 0; i < deleteCount; i += 1) {
    await cache.delete(keys[i]);
  }
}

async function maybeTrimMapTileCache() {
  if (mapTileTrimInFlight) return;
  if (mapTileWriteCount % MAP_TILE_TRIM_INTERVAL !== 0) return;

  mapTileTrimInFlight = true;
  try {
    await trimCache(MAP_TILE_CACHE_NAME, MAP_TILE_CACHE_LIMIT);
  } finally {
    mapTileTrimInFlight = false;
  }
}

async function cacheMapTile(request, responseForCache) {
  const cache = await caches.open(MAP_TILE_CACHE_NAME);
  await cache.put(request, responseForCache);
  mapTileWriteCount += 1;
  await maybeTrimMapTileCache();
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // OSM tiles - stale-while-revalidate for faster repeat loads.
  if (event.request.method === 'GET' && isMapTileRequest(url)) {
    event.respondWith(
      caches.open(MAP_TILE_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);

        const networkPromise = fetch(event.request)
          .then(async (response) => {
            // Don't block tile paint with cache writes; cache in background.
            const canCache = response && (response.ok || response.type === 'opaque');
            if (canCache) {
              event.waitUntil(cacheMapTile(event.request, response.clone()));
            }
            return response;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkPromise);
          return cached;
        }

        const networkResponse = await networkPromise;
        if (networkResponse) return networkResponse;

        return new Response('', { status: 504, statusText: 'Map tile unavailable' });
      })
    );
    return;
  }

  // 1. API calls — always network, never cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. HTML navigation requests — network first so new deploys are always picked up
  //    Falls back to cached /index.html only when fully offline
  if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 3. Hashed JS/CSS assets (/assets/...) — cache first (they are content-hashed, safe to cache)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(APP_CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 4. Everything else — network first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(APP_CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
