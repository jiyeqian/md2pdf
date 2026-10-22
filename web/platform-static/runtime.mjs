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
const assets = new Map();
async function documentAssets(html) {
  const files = ['vendor/mathjax/tex-svg.js','vendor/mermaid/mermaid.min.js','vendor/pagedjs/paged.polyfill.min.js'];
  const referenced = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(match => match[1]);
  const needed = files.map(file => referenced.find(src => src.endsWith('/' + file))).filter(Boolean);
  const key = needed.join('|');
  if (!assets.has(key)) assets.set(key, (async () => {
    const scripts = await Promise.all(needed.map(async src => {
      const response = await fetch(src);
      if (!response.ok) throw new Error('离线排版资源缺失，请联网更新。');
      return [src, 'data:text/javascript;base64,' + base64(await response.text())];
    }));
    return { scripts };
  })());
  try { return await assets.get(key); }
  catch (error) { assets.delete(key); throw error; }
}
export async function renderDocument(body, preview = true) {
  const { render, resolveWebInput, prepareWebDocument, attachSourcePositions } = await getRenderModules();
  const resolved = resolveWebInput(body);
  const rendered = await render(resolved.md, resolved.opts, {webSafe:true});
  const html = rendered.pagedHtml || rendered.html;
  const scripts = await documentAssets(html);
  const logo = rendered.type === 'gb' ? await fetch(resource('assets/gb-logo.svg')).then(async response => {
    if (!response.ok) throw new Error('离线标志资源缺失，请联网更新。');
    return { logoUrl:resource('assets/gb-logo.svg'), logoData:'data:image/svg+xml;base64,' + base64(await response.text()) };
  }) : {};
  const prepared = prepareWebDocument(preview ? attachSourcePositions(html, resolved.md) : html, {...scripts,...logo,preview,type:rendered.type});
  return { html:prepared, type:rendered.type, effective:resolved.effective, policy:resolved.policy, outline:rendered.printOptions.outline };
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
    if (url.pathname === '/api/render') return json(await renderDocument(body));
    return json({error:'静态版本不提供此服务。'},404);
  } catch (error) { return json({error:error.message, ...(error.configErrors ? {configErrors:error.configErrors} : {})}, error.status || 500); }
}
