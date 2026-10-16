const base = new URL('./', self.location.href);
const prefix = 'md2pdf-static-' + base.pathname + '-';
const current = prefix + VERSION;
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(current);
  try {
    for (const entry of FILES) {
      const url = new URL(entry.url, base);
      const response = await fetch(url, { cache:'reload' });
      if (!response.ok || response.redirected) throw new Error('下载失败');
      const bytes = await response.clone().arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2,'0')).join('');
      if (hash !== entry.hash) throw new Error('资源版本不一致');
      await cache.put(url, response);
    }
    await cache.put(base, await cache.match(new URL('index.html', base)));
  } catch (error) { await caches.delete(current); throw error; }
})()));
// 原型不强制接管已有页面；退出所有原型窗口后才切换新版。
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith(prefix) && name !== current) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  event.respondWith((async () => {
    const cached = await (await caches.open(current)).match(event.request, { ignoreSearch:event.request.mode === 'navigate' });
    return cached || fetch(event.request);
  })());
});
