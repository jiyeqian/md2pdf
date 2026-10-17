const base = new URL('./', self.location.href);
const prefix = 'md2pdf-static-' + base.pathname + '-';
const current = prefix + VERSION;
const metadata = 'md2pdf-static-versions@' + base.pathname;
const clientKey = id => new URL('.__client-version/' + id, base);
const inScope = client => client.url.startsWith(base.href);
async function pinned(id) {
  const response = id && await (await caches.open(metadata)).match(clientKey(id));
  return response ? response.text() : null;
}
async function pin(id, name = current) {
  if (id) await (await caches.open(metadata)).put(clientKey(id), new Response(name));
}
async function status(client) {
  const name = await pinned(client.id) || current;
  await pin(client.id, name);
  const ready = Boolean(await (await caches.open(name)).match(new URL('index.html', base)));
  client.postMessage({ type:'APP_CACHE_STATUS', current, pinned:name, ready });
}
self.addEventListener('install', event => event.waitUntil((async () => {
  // 旧协议激活时会删除前代缓存，所以创建顺序最早的现存版本是旧活动版本。
  // 此兼容分支只为尚未记录版本的旧窗口保留资源；新窗口由导航明确记录版本。
  const legacy = (await caches.keys()).find(name => name.startsWith(prefix) && name !== current);
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
    for (const client of await self.clients.matchAll({ type:'window', includeUncontrolled:true })) {
      if (inScope(client) && !await pinned(client.id)) await pin(client.id, legacy || current);
    }
  } catch (error) { await caches.delete(current); throw error; }
  // 已打开的窗口继续读取其原版本；只有新导航切换新版，不强制刷新或丢弃编辑。
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const clients = (await self.clients.matchAll({ type:'window', includeUncontrolled:true })).filter(inScope);
  const live = new Set(clients.map(client => client.id)), keep = new Set([current]);
  const meta = await caches.open(metadata);
  for (const request of await meta.keys()) {
    const id = new URL(request.url).pathname.split('/').pop();
    if (live.has(id)) keep.add(await (await meta.match(request)).text());
    else await meta.delete(request);
  }
  for (const name of await caches.keys()) if (name.startsWith(prefix) && !keep.has(name)) await caches.delete(name);
  await self.clients.claim();
  for (const client of clients) await status(client);
})()));
self.addEventListener('message', event => {
  if (event.data?.type === 'APP_CACHE_STATUS' && event.source?.url && inScope(event.source)) event.waitUntil(status(event.source));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  event.respondWith((async () => {
    const navigation = event.request.mode === 'navigate';
    const name = navigation ? current : await pinned(event.clientId) || current;
    const cached = await (await caches.open(name)).match(event.request, { ignoreSearch:navigation });
    if (cached) {
      if (navigation) await pin(event.resultingClientId);
      return cached;
    }
    return fetch(event.request);
  })());
});
