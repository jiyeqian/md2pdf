import { render } from './src/render.mjs';
import { resolveWebInput } from './src/web-input.mjs';
import { frontmatterValueCatalog } from './src/config.mjs';
import { webPolicyDocument } from './src/web-options.mjs';
import { prepareWebDocument } from './src/web-document.mjs';
import { attachSourcePositions } from './src/editor-position.mjs';
import { createDoiResolver } from './src/doi.mjs';
import catalog from './offline-catalog.mjs';
const base = new URL('./', import.meta.url);
const doi = createDoiResolver();
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers:{'Content-Type':'application/json'} });
const resource = file => new URL(file, base).href;
function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i=0;i<bytes.length;i+=32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(binary);
}
let assets;
async function documentAssets() {
  return assets ||= (async () => {
    const scripts = await Promise.all(['vendor/mathjax/tex-svg.js','vendor/mermaid/mermaid.min.js','vendor/pagedjs/paged.polyfill.min.js'].map(async file => {
      const response = await fetch(resource(file));
      if (!response.ok) throw new Error('离线排版资源缺失，请联网更新。');
      return [resource(file), 'data:text/javascript;base64,' + base64(await response.text())];
    }));
    const logo = await fetch(resource('assets/gb-logo.svg'));
    if (!logo.ok) throw new Error('离线标志资源缺失，请联网更新。');
    return { scripts, logoUrl:resource('assets/gb-logo.svg'), logoData:'data:image/svg+xml;base64,' + base64(await logo.text()) };
  })();
}
export async function renderDocument(body, preview = true) {
  const resolved = resolveWebInput(body);
  const rendered = await render(resolved.md, resolved.opts, {webSafe:true});
  const html = rendered.pagedHtml || rendered.html;
  return { html:prepareWebDocument(preview ? attachSourcePositions(html, resolved.md) : html, {...await documentAssets(),preview,type:rendered.type}), type:rendered.type, effective:resolved.effective, policy:resolved.policy, outline:rendered.printOptions.outline };
}
export async function appFetch(input, init = {}) {
  const url = new URL(input, base);
  try {
    if (url.pathname === '/api/policy') return json(webPolicyDocument());
    if (url.pathname === '/api/frontmatter-values') return json(frontmatterValueCatalog());
    if (url.pathname === '/api/examples') return json({examples:catalog.examples});
    if (url.pathname === '/api/example') {
      const entry = catalog.sources[url.searchParams.get('id') || 'general'];
      return entry ? json(url.searchParams.has('id') ? entry : {md:entry.md}) : json({error:'示例不存在'},404);
    }
    if (url.pathname === '/api/doi') {
      if (!navigator.onLine) return json({error:'DOI 查询需要联网；可手动粘贴 BibTeX。'},503);
      return json(await doi.resolve(JSON.parse(init.body).doi));
    }
    const body = JSON.parse(init.body || '{}');
    if (url.pathname === '/api/resolve') { const {type,policy} = resolveWebInput(body); return json({type,policy}); }
    if (url.pathname === '/api/render') return json(await renderDocument(body));
    return json({error:'静态版本不提供此服务。'},404);
  } catch (error) { return json({error:error.message, ...(error.configErrors ? {configErrors:error.configErrors} : {})}, error.status || 500); }
}
