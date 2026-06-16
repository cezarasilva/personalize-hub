const CACHE = 'ph-v1';
const SHELL = [
    '/assets/css/base.css',
    '/assets/css/app.css',
    '/assets/js/core.js',
    '/assets/js/theme.js',
    '/dashboard.html',
    '/index.html'
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    // Deixa requisições de API sempre ir para a rede
    if (e.request.url.includes('/api/')) return;
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});
