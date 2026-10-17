/* APP_VERSION / APP_FILES 由服务器按内容生成；控制 WebApp 根入口。 */
const PREFIX = 'md2pdf-webapp-editor-';
const CURRENT = PREFIX + APP_VERSION;
const META = 'md2pdf-webapp-editor-clients';
const key = id => new URL('/__client-version/' + id, self.location.origin).href;
async function pin(id, name = CURRENT) {
  if (id) await (await caches.open(META)).put(key(id), new Response(name));
}
async function pinned(id) {
  const response = id && await (await caches.open(META)).match(key(id));
  return response ? response.text() : CURRENT;
}
async function cleanup() {
  const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
  const live = new Set(clients.map(client => client.id));
  const keep = new Set([CURRENT, META]);
  const meta = await caches.open(META);
  for (const request of await meta.keys()) {
    const id = new URL(request.url).pathname.split('/').pop();
    if (live.has(id)) keep.add(await (await meta.match(request)).text());
    else await meta.delete(request);
  }
  for (const name of await caches.keys()) {
    if (name.startsWith(PREFIX) && name !== META && !keep.has(name)) await caches.delete(name);
  }
}
let preparing;
async function prepare() {
  if (preparing) return preparing;
  preparing = (async () => {
    const staging = CURRENT + '-download';
    await caches.delete(staging);
    const cache = await caches.open(staging);
    try {
      for (const entry of APP_FILES) {
        const response = await fetch(entry.url, { cache:'reload', credentials:'same-origin' });
        if (!response.ok || response.redirected) throw new Error('资源下载失败：' + entry.url);
        const bytes = await response.clone().arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
        if (hash !== entry.hash) throw new Error('资源版本发生变化，请稍后重试。');
        await cache.put(entry.url, response);
      }
      const target = await caches.open(CURRENT);
      for (const request of await cache.keys()) await target.put(request, await cache.match(request));
      await target.put('/__ready', new Response(APP_VERSION));
    } finally { await caches.delete(staging); }
  })().finally(() => { preparing = null; });
  return preparing;
}
self.addEventListener('install', event => event.waitUntil(prepare()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await cleanup();
  await self.clients.claim();
})()));
self.addEventListener('message', event => {
  if (!event.source?.url) return;
  const source = new URL(event.source.url);
  if (source.origin !== self.location.origin || source.pathname !== '/') return;
  if (event.data?.type === 'APP_ACTIVATE') event.waitUntil(self.skipWaiting());
  if (['APP_STATUS', 'APP_PREPARE'].includes(event.data?.type)) event.waitUntil((async () => {
    if (event.data.type === 'APP_PREPARE') {
      try { await prepare(); }
      catch { event.source.postMessage({ type:'APP_ERROR' }); return; }
    }
    const name = await pinned(event.source.id);
    await pin(event.source.id, name);
    const ready = Boolean(await (await caches.open(name)).match('/__ready'));
    event.source.postMessage({ type:'APP_STATUS', version:APP_VERSION, pinned:name, cache:CURRENT, ready });
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const navigation = request.mode === 'navigate' && url.pathname === '/';
  const target = navigation ? '/' : url.pathname + url.search;
  event.respondWith((async () => {
    // 新导航使用当前版本；既有窗口继续使用原版本，避免多窗口更新时混用脚本。
    const name = navigation ? CURRENT : await pinned(event.clientId);
    const response = await (await caches.open(name)).match(target);
    if (response) {
      if (navigation) await pin(event.resultingClientId);
      return response;
    }
    return fetch(request);
  })());
});
