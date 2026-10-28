const CACHE = 'dziennik-robot-shell-v4';
const cacheable = response => response.ok && response.type !== 'opaque';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      const shell = await fetch('/', { cache: 'reload' });
      if (cacheable(shell)) {
        const html = await shell.clone().text();
        await cache.put('/', shell);
        const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+\.(?:js|css))"/g)].map(match => match[1]))];
        await Promise.all(assets.map(async url => { const response = await fetch(url); if (cacheable(response)) await cache.put(url, response); }));
      }
    } catch { /* A later successful navigation warms the cache. */ }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('dziennik-robot-shell-') && key !== CACHE).map(key => caches.delete(key)));
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (request.mode === 'navigate') {
      try {
        const response = await fetch(request);
        if (response.status === 401 || response.status === 403) return response;
        if (!cacheable(response)) throw new Error('Server unavailable');
        await cache.put(request, response.clone());
        return response;
      } catch {
        return await cache.match(request) || await cache.match('/') || new Response('Otwórz aplikację raz z internetem, aby przygotować tryb offline.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
    }
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (cacheable(response)) await cache.put(request, response.clone());
    return response;
  })());
});
