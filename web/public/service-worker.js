// Miracle EMR service worker: makes the EMR shell installable and usable offline.
// HTML and same-origin static assets are network-first (fresh code on every online
// load) with cache fallback so the shell still works offline.
// API calls and cross-origin requests (OpenAI, CDN) are never cached.
// v16: el shell pasó de 20 archivos JS sueltos a los bundles de /dist (ver
// docs/PLAN-BUILD-FRONTEND.md). Bump obligatorio, o un cliente con la caché
// vieja seguiría sirviendo los archivos individuales que ya nadie pide.
const CACHE = 'miracle-shell-v16';
// Los bundles que carga emr-workspace.html. Esta lista es corta a propósito y
// `scripts/verify-frontend-bundles.js` falla si se desincroniza del manifiesto
// (scripts/lib/frontend-bundles.manifest.json), que es la fuente de verdad.
// Un service worker es un archivo estático: no puede leer el manifiesto, así
// que la consistencia la garantiza el test, no un require.
const SHELL = [
    '/emr-workspace.html',
    '/manifest.webmanifest',
    '/dist/emr-workspace.classic.1.js',
    '/dist/emr-workspace.classic.2.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(SHELL).catch(() => undefined))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return; // leave OpenAI/CDN alone
    if (url.pathname.startsWith('/api/')) return;     // never cache API responses

    if (req.mode === 'navigate' || req.destination === 'document') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE).then((cache) => cache.put(req, copy));
                    return res;
                })
                .catch(() => caches.match(req).then((cached) => cached || caches.match('/emr-workspace.html')))
        );
        return;
    }

    // Network-first for same-origin static assets: always pick up fresh code when
    // online (stale-while-revalidate made every deploy take two reloads to show),
    // fall back to cache offline.
    event.respondWith(
        fetch(req)
            .then((res) => {
                const copy = res.clone();
                caches.open(CACHE).then((cache) => cache.put(req, copy));
                return res;
            })
            .catch(() => caches.match(req))
    );
});
