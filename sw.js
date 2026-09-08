/* ECHObound — service worker versionné et autonome. */
const CACHE_PREFIX = 'echobound-';
const CACHE_VERSION = '2.0.0-pwa.4';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

const PRECACHE_PATHS = Object.freeze([
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon.svg',
  './src/styles.css',
  './src/platform.js',
  './src/game.js',
  './src/expedition-atlas.js',
  './src/audio-director.js',
  './src/combat-rules.js',
  './src/progression-rules.js',
  './src/save-schema.js',
  './src/save-system.js',
  './src/world-layouts.js',
]);

const toScopedUrl = (path) => new URL(path, self.registration.scope).href;
const offlineDocumentUrl = toScopedUrl('./index.html');
const runtimeUrls = new Set(PRECACHE_PATHS.map(toScopedUrl));

const canonicalRuntimeRequest = (request) => {
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  if (!runtimeUrls.has(url.href)) return null;
  return new Request(url.href, { credentials: 'same-origin' });
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const requests = PRECACHE_PATHS.map((path) => new Request(toScopedUrl(path), {
      cache: 'reload',
      credentials: 'same-origin',
    }));

    await cache.addAll(requests);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
      .map((cacheName) => caches.delete(cacheName)));

    if ('navigationPreload' in self.registration) {
      await self.registration.navigationPreload.enable();
    }

    await self.clients.claim();
  })());
});

const cacheResponse = async (request, response) => {
  if (!response || !response.ok || response.type === 'opaque') return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
};

const offlineFallback = async () => {
  const cache = await caches.open(CACHE_NAME);
  const cachedDocument = await cache.match(offlineDocumentUrl)
    || await cache.match(toScopedUrl('./'));

  return cachedDocument || new Response(
    '<!doctype html><html lang="fr"><meta charset="utf-8"><title>ECHObound hors ligne</title><body><h1>ECHObound est hors ligne</h1><p>Reconnectez-vous une fois pour préparer le jeu hors ligne.</p></body></html>',
    {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    },
  );
};

const handleNavigation = async (event, cacheKey) => {
  try {
    const preloadedResponse = await event.preloadResponse;
    const response = preloadedResponse || await fetch(event.request);
    await cacheResponse(cacheKey, response);
    return response;
  } catch {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(cacheKey) || await offlineFallback();
  }
};

const handleStaticAsset = async (event, cacheKey) => {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(cacheKey);
  const networkResponse = fetch(event.request)
    .then(async (response) => {
      await cacheResponse(cacheKey, response);
      return response;
    })
    .catch(() => null);

  if (cachedResponse) {
    event.waitUntil(networkResponse);
    return cachedResponse;
  }

  return await networkResponse || new Response('', { status: 504, statusText: 'ECHObound offline' });
};

const handleRuntimeRequest = async (request, cacheKey) => {
  try {
    const response = await fetch(request);
    await cacheResponse(cacheKey, response);
    return response;
  } catch {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(cacheKey)
      || new Response('', { status: 504, statusText: 'ECHObound offline' });
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;
  const cacheKey = canonicalRuntimeRequest(request);
  if (!cacheKey) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event, cacheKey));
    return;
  }

  if (['style', 'script', 'image', 'font', 'audio'].includes(request.destination)) {
    event.respondWith(handleStaticAsset(event, cacheKey));
    return;
  }

  event.respondWith(handleRuntimeRequest(request, cacheKey));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
    return;
  }

  if (event.data?.type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'ECHObound_SW_VERSION', version: CACHE_VERSION });
  }
});
