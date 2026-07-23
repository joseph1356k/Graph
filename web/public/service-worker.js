// Miracle EMR service worker: makes the EMR shell installable and usable offline.
// HTML and same-origin static assets are network-first (fresh code on every online
// load) with cache fallback so the shell still works offline.
// API calls and cross-origin requests (OpenAI, CDN) are never cached.
const CACHE = 'miracle-shell-v15';
const SHELL = [
    '/emr-workspace.html',
    '/manifest.webmanifest',
    '/page-state.js',
    '/auth-gate.js',
    '/demo-auth.js',
    '/admin-workspace.js',
    '/clinical-review.js',
    '/recorder.js',
    '/assistant-runtime.js',
    '/shared/deepgram-dictation.js',
    '/trainer-plugin.js',
    '/plugin/plugin-events.js',
    '/plugin/plugin-host.js',
    '/plugin/plugin-adapters.js',
    '/plugin/plugin-context.js',
    '/plugin/plugin-api.js',
    '/plugin/plugin-learning-bridge.js',
    '/plugin/plugin-learning-client.js',
    '/plugin/plugin-trainer-shell.js',
    '/plugin/plugin-surface-profile-client.js',
    '/plugin/plugin-execution-client.js',
    '/plugin/plugin-workflow-overlay-bridge.js'
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
