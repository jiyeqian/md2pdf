import { createDocumentAssetCache } from './document-asset-cache.mjs';
import { createLatestRenderScheduler } from './latest-render-scheduler.mjs';
const base = new URL('./', import.meta.url);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers:{'Content-Type':'application/json'} });
const resource = file => new URL(file, base).href;
function lazy(importer) {
  let pending;
  return async () => {
    if (!pending) pending = importer();
    try { return await pending; }
    catch (error) { pending = null; throw error; }
  };
}
const getRenderModules = lazy(() => Promise.all([
    import('./src/render.mjs'), import('./src/web-input.mjs'), import('./src/web-document.mjs'), import('./src/editor-position.mjs'),
  ]).then(([renderModule, inputModule, documentModule, positionModule]) => ({
    render:renderModule.render, resolveWebInput:inputModule.resolveWebInput,
    prepareWebDocument:documentModule.prepareWebDocument, attachSourcePositions:positionModule.attachSourcePositions,
  })));
const getConfig = lazy(() => import('./src/config.mjs'));
const getOptions = lazy(() => import('./src/web-options.mjs'));
const getCatalog = lazy(() => import('./catalog.mjs').then(module => module.default));
let doiResolver;
function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i=0;i<bytes.length;i+=32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(binary);
}
const assetDataUrls = createDocumentAssetCache(4);
const scheduleRender = createLatestRenderScheduler();
let assetBoundaryPromise;
async function assetBoundary() {
  if (!assetBoundaryPromise) {
    const pending = fetch(resource('version-data.json')).then(async response => {
      if (!response.ok) throw new Error('当前版本资源信息不可用。');
      const info = await response.json();
      return `${info.version || ''}:${info.commit || ''}:${info.deployment || 'static'}:${base.href}`;
    });
    const wrapped = pending.catch(error => {
      if (assetBoundaryPromise === wrapped) assetBoundaryPromise = null;
      throw error;
    });
    assetBoundaryPromise = wrapped;
  }
  return assetBoundaryPromise;
}
async function dataUrl(url, mime, boundary, signal) {
  signal?.throwIfAborted();
  const resolved = new URL(url, base).href;
  const result = await assetDataUrls(`${boundary}|${resolved}`, async () => {
    const response = await fetch(resolved);
    if (!response.ok) throw new Error('离线排版资源缺失，请联网更新。');
    return `data:${mime};base64,${base64(await response.text())}`;
  });
  signal?.throwIfAborted();
  return result;
}
async function documentAssets(html, signal) {
  const files = ['vendor/mathjax/tex-svg.js','vendor/mermaid/mermaid.min.js','vendor/pagedjs/paged.polyfill.min.js'];
  const referenced = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(match => match[1]);
  const needed = files.map(file => referenced.find(src => src.endsWith('/' + file))).filter(Boolean);
  const boundary = await assetBoundary();
  signal?.throwIfAborted();
  const scripts = await Promise.all(needed.map(async src => [src, await dataUrl(src, 'text/javascript', boundary, signal)]));
  signal?.throwIfAborted();
  return { scripts };
}
export async function renderDocument(body, preview = true, signal, autoPreview = false) {
  const { render, resolveWebInput, prepareWebDocument, attachSourcePositions } = await getRenderModules();
  signal?.throwIfAborted();
  const resolved = resolveWebInput(body, { autoPreview });
  signal?.throwIfAborted();
  const rendered = await render(resolved.md, resolved.opts, {webSafe:true,signal,parsedFrontmatter:resolved.parsedFrontmatter});
  signal?.throwIfAborted();
  const html = rendered.pagedHtml || rendered.html;
  const scripts = await documentAssets(html, signal);
  signal?.throwIfAborted();
  const logoUrl = resource('assets/gb-logo.svg');
  const logo = rendered.type === 'gb' ? { logoUrl, logoData:await dataUrl(logoUrl, 'image/svg+xml', await assetBoundary(), signal) } : {};
  signal?.throwIfAborted();
  const prepared = prepareWebDocument(preview ? attachSourcePositions(html, resolved.md) : html, {...scripts,...logo,preview,type:rendered.type});
  return { html:prepared, type:rendered.type, effective:resolved.effective, policy:resolved.policy, resetOptions:resolved.resetOptions, authorDiagnostics:resolved.authorDiagnostics, outline:rendered.printOptions.outline };
}
export async function appFetch(input, init = {}) {
  const url = new URL(input, base);
  try {
    if (url.pathname === '/api/version') return fetch(resource('version-data.json'));
    if (url.pathname === '/api/policy') return json((await getOptions()).webPolicyDocument());
    if (url.pathname === '/api/frontmatter-values') return json((await getConfig()).frontmatterValueCatalog());
    if (url.pathname === '/api/examples') return json({examples:(await getCatalog()).examples});
    if (url.pathname === '/api/example') {
      const catalog = await getCatalog();
      const entry = catalog.sources[url.searchParams.get('id') || 'general'];
      return entry ? json(url.searchParams.has('id') ? entry : {md:entry.md}) : json({error:'示例不存在'},404);
    }
    if (url.pathname === '/api/doi') {
      if (!navigator.onLine) return json({error:'DOI 查询需要联网；可手动粘贴 BibTeX。'},503);
      const { createDoiResolver } = await import('./src/doi.mjs');
      doiResolver ||= createDoiResolver();
      return json(await doiResolver.resolve(JSON.parse(init.body).doi));
    }
    const body = JSON.parse(init.body || '{}');
    if (url.pathname === '/api/resolve') { const { resolveWebInput } = await getRenderModules(); const {type,policy,authorDiagnostics} = resolveWebInput(body); return json({type,policy,authorDiagnostics}); }
    if (url.pathname === '/api/render' || url.pathname === '/api/preview') {
      return json(await scheduleRender(init.md2pdfConsumer, signal => renderDocument(body, true, signal, url.pathname === '/api/preview'), init.signal));
    }
    return json({error:'静态版本不提供此服务。'},404);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return json({error:error.message, ...(error.configErrors ? {configErrors:error.configErrors} : {})}, error.status || 500);
  }
}
