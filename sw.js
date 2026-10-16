/* AI Cycling Coach - service worker (relative paths only) */
const CACHE_NAME = 'ai-cycling-coach-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './pwa-manifest.json',
    './css/style.css',
    './js/config.js',
    './js/storage.js',
    './js/settings.js',
    './js/blocks.js',
    './js/catalog.js',
    './js/context.js',
    './js/memory.js',
    './js/prompt.js',
    './js/api.js',
    './js/ui.js',
    './js/chat.js',
    './js/app.js',
    './assets/icons/icon-72.png',
    './assets/icons/icon-96.png',
    './assets/icons/icon-128.png',
    './assets/icons/icon-144.png',
    './assets/icons/icon-152.png',
    './assets/icons/icon-192.png',
    './assets/icons/icon-384.png',
    './assets/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    // Only cache same-origin app shell; never cache API calls (GitHub, Intervals, OpenRouter).
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req).then((res) => {
                if (res && res.status === 200 && res.type === 'basic') {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
                }
                return res;
            }).catch(() => caches.match('./index.html'));
        })
    );
});
