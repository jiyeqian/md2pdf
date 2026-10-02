import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { render } from './render.mjs';
import { Chrome, findChrome } from './chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 1024 * 1024;
const DOC_CSP = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
// srcdoc inherits the parent policy, so trusted in-document scripts/styles must also be allowed here.
const PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' data:; style-src 'self' 'unsafe-inline'; frame-src 'self' about:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const assetFiles = ['vendor/mathjax/tex-svg.js', 'vendor/mermaid/mermaid.min.js', 'vendor/pagedjs/paged.polyfill.min.js'];
let assetCache;
const error = (status, message) => Object.assign(new Error(message), { status });

export function validateInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['md', 'opts'].includes(k))) throw error(400, '请求必须包含 md 和可选 opts');
  if (typeof body.md !== 'string' || !body.md.trim()) throw error(400, '请输入 Markdown 正文');
  if (body.md.length > 200000 || body.md.split('\n').length > 5000 || (body.md.match(/^#{1,6}\s/gm) || []).length > 300 || (body.md.match(/^\s*```mermaid\b/gm) || []).length > 50) throw error(413, '文档过大或过于复杂');
  // TeX-generated URLs bypass the Markdown link renderer; omit resource/link macros in the web version.
  if (/\\(?:href|url|includegraphics|require|def|gdef|edef|xdef|newcommand|renewcommand|let|csname)\b/i.test(body.md)) throw error(400, '在线版本不支持公式中的链接、外部资源或自定义宏');
  const opts = body.opts ?? {};
  if (typeof opts !== 'object' || !opts || Array.isArray(opts)) throw error(400, 'opts 必须是对象');
  const enums = { type: ['general', 'skill', 'readme', 'paper', 'gb'], theme: ['elegant', 'minimal', 'gb'], numbering: ['auto', 'force', 'none'], numberScheme: ['arabic', 'gb', 'cjk', 'chapter'] };
  const booleans = ['toc', 'landscape'];
  const numbers = { fontSize: [8, 24], marginTop: [10, 40], marginBottom: [10, 40], marginSide: [10, 40], marginLeft: [10, 40], marginRight: [10, 40] };
  for (const [key, value] of Object.entries(opts)) {
    if (Object.hasOwn(enums, key)) { if (!enums[key].includes(value)) throw error(400, `无效选项：${key}`); }
    else if (booleans.includes(key)) { if (typeof value !== 'boolean') throw error(400, `无效选项：${key}`); }
    else if (Object.hasOwn(numbers, key)) { if (typeof value !== 'number' || !Number.isFinite(value) || value < numbers[key][0] || value > numbers[key][1]) throw error(400, `无效选项：${key}`); }
    else throw error(400, `不支持的选项：${key}`);
  }
  return { md: body.md, opts: { ...opts, pagedHtml: true } };
}

async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw error(415, '仅支持 application/json');
  if (Number(req.headers['content-length']) > LIMIT) throw error(413, '请求体超过 1 MB');
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > LIMIT) throw error(413, '请求体超过 1 MB');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw error(400, 'JSON 格式错误'); }
}

export async function webDocument(html, preview = false, type = 'general') {
  if (!assetCache) assetCache = Promise.all(assetFiles.map(async file => [file, await readFile(path.join(ROOT, file), 'utf8')])).then(entries => new Map(entries));
  const assets = await assetCache;
  for (const [file, js] of assets) {
    const url = pathToFileURL(path.join(ROOT, file)).href;
    html = html.replaceAll(`<script src="${url}"></script>`, () => `<script src="data:text/javascript;base64,${Buffer.from(js).toString('base64')}"></script>`);
    html = html.replaceAll(`<script src="${url}" id="MathJax-script"></script>`, () => `<script id="MathJax-script" src="data:text/javascript;base64,${Buffer.from(js).toString('base64')}"></script>`);
  }
  const logo = await readFile(path.join(ROOT, 'assets/gb-logo.svg'));
  html = html.replaceAll(pathToFileURL(path.join(ROOT, 'assets/gb-logo.svg')).href, 'data:image/svg+xml;base64,' + logo.toString('base64'));
  // Report library failures instead of treating a caught error as successful pagination.
  html = html.replace(/\.catch\(function \(\) \{ window\.__md2pdf(Mermaid|Paged)Ready = true; \}\)/g, (_, name) => `.catch(function (e) { window.__md2pdf${name}Error = String(e); window.__md2pdf${name}Ready = true; })`);
  html = html.replace(/catch \(e\) \{ window\.__md2pdf(Mermaid|Paged)Ready = true; \}/g, (_, name) => `catch (e) { window.__md2pdf${name}Error = String(e); window.__md2pdf${name}Ready = true; }`);
  html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${DOC_CSP}"><meta name="referrer" content="no-referrer">`);
  if (preview) {
    // Paged.js can lose generated CSS counters; keep preview TOC markers explicit.
    html = html.replace(/(<div class="toc">[\s\S]*?<ol>)([\s\S]*?)(<\/ol>)/, (_, start, entries, end) => {
      let index = 0;
      return start + entries.replace(/<li>/g, () => `<li data-preview-index="${String(++index).padStart(2, '0')}">`) + end;
    }).replace('</style>', '.toc li[data-preview-index]::before { content: attr(data-preview-index); counter-increment: none; } .web-page-number::before, .web-page-number::after { content: none !important; }\n</style>');
  }
  if (preview) html = html.replace('</body>', `<script>(function(){var started=Date.now();function check(){var failed=window.__md2pdfMermaidError||window.__md2pdfPagedError; if(failed){parent.postMessage({type:'md2pdf-error',error:'公式、图表或分页失败'},'*');return;}if(window.__md2pdfMathReady!==false&&window.__md2pdfMermaidReady!==false&&window.__md2pdfPagedReady!==false){document.fonts.ready.then(function(){var pages=document.querySelectorAll('.pagedjs_page');if(${JSON.stringify(type)}!=='gb')pages.forEach(function(page,index){var footer=page.querySelector('.pagedjs_margin-bottom-center .pagedjs_margin-content');if(footer){footer.classList.add('web-page-number');footer.textContent=(index+1)+' / '+pages.length;footer.style.fontSize='8pt';footer.style.color='#8a8578';}});function fit(){var page=document.querySelector('.pagedjs_page'),pages=document.querySelector('.pagedjs_pages');if(page&&pages)pages.style.zoom=Math.min(1,(document.documentElement.clientWidth-24)/page.offsetWidth);}fit();addEventListener('resize',fit);parent.postMessage({type:'md2pdf-ready'},'*');});return;}if(Date.now()-started>30000){parent.postMessage({type:'md2pdf-error',error:'排版超时，请缩短文档或检查公式与图表'},'*');return;}setTimeout(check,100);}addEventListener('load',check);})();</script></body>`);
  return html;
}

export function createApp({ chromeFactory = (bin, dir) => new Chrome(bin, dir, { incognito: true }), taskTimeout = 60000, queueLimit = 3, chromeBinary, publicHost = process.env.MD2PDF_PUBLIC_HOST || '' } = {}) {
  let browser, tmpRoot, closed = false, queued = 0, tail = Promise.resolve();
  // 公网部署时由反向代理转发，Host 为公网域名；本地开发保持仅本机可访问。
  // 来源校验始终开启：未配置 publicHost 时只信任回环地址，配置后额外信任该域名（HTTPS）。
  const allowedHosts = publicHost ? [publicHost] : [];
  const allowedOrigins = publicHost ? [`https://${publicHost}`, `http://${publicHost}`] : [];
  async function resetBrowser() { const old = browser; browser = undefined; if (old) await old.stop(); }
  async function pdfTask(html, opts) {
    if (closed) throw error(503, '服务正在关闭');
    if (queued >= queueLimit) throw error(429, 'PDF 队列已满，请稍后重试');
    queued++;
    const submitted = Date.now();
    const task = tail.catch(() => {}).then(async () => {
      if (closed) throw error(503, '服务正在关闭');
      if (Date.now() - submitted > taskTimeout) throw error(504, '排队超时，请重试');
      let timer;
      try {
        return await Promise.race([
          (async () => {
            if (!browser) {
              tmpRoot ||= await mkdtemp(path.join(os.tmpdir(), 'md2pdf-web-'));
              browser = chromeFactory(chromeBinary || findChrome(), tmpRoot);
              await browser.start();
            }
            const pdf = await browser.printHtml(html, { ...opts, webSafe: true });
            await browser.send?.('Page.navigate', { url: 'about:blank' });
            return pdf;
          })(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(error(504, 'PDF 渲染超时，请重试')), taskTimeout); }),
        ]);
      } catch (e) { await resetBrowser(); throw e; }
      finally { clearTimeout(timer); }
    });
    // The queue tail must not retain the last document's PDF buffer.
    tail = task.then(() => {}, () => {});
    try { return await task; } finally { queued--; }
  }
  const staticRoutes = new Map([['/', ['web/index.html', 'text/html']], ['/app.js', ['web/app.js', 'text/javascript']], ['/app.css', ['web/app.css', 'text/css']]]);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', PAGE_CSP);
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    try {
      const port = server.address()?.port;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...allowedHosts.map(h => h.includes(':') ? h : `${h}:${port}`), ...allowedHosts];
      if (!hosts.includes(req.headers.host)) throw error(403, '仅允许受信来源访问');
      const origin = req.headers.origin;
      if (origin && ![...hosts.map(host => 'http://' + host), ...allowedOrigins].includes(origin)) throw error(403, '不允许跨站请求');
      if (closed) throw error(503, '服务正在关闭');
      if (req.method === 'GET' && staticRoutes.has(req.url)) {
        const [file, type] = staticRoutes.get(req.url);
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(await readFile(path.join(ROOT, file))); return;
      }
      if (req.method === 'GET' && req.url === '/api/example') { json(200, { md: await readFile(path.join(ROOT, 'examples/general.md'), 'utf8') }); return; }
      if (!['/api/render', '/api/pdf'].includes(req.url)) { json(404, { error: '页面不存在' }); return; }
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(405, { error: '请使用 POST' }); return; }
      const { md, opts } = validateInput(await readBody(req));
      const rendered = await render(md, opts, { webSafe: true });
      if (req.url === '/api/render') { json(200, { html: await webDocument(rendered.pagedHtml, true, rendered.type), type: rendered.type }); return; }
      const pdf = await pdfTask(await webDocument(rendered.html), rendered.printOptions);
      const name = Array.from(Buffer.from(rendered.title.replace(/[\x00-\x1f\x7f\/\\]/g, '_')).toString('utf8')).slice(0, 100).join('') || 'document';
      const encodedName = encodeURIComponent(name).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="document.pdf"; filename*=UTF-8''${encodedName}.pdf` }); res.end(pdf);
    } catch (e) {
      if (!res.headersSent && !res.destroyed) json(e.status || 500, { error: e.status ? e.message : '渲染失败，请检查文档或 Chrome 配置后重试' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, async close() {
    closed = true;
    const stopped = new Promise(resolve => server.listening ? server.close(resolve) : resolve());
    server.closeIdleConnections?.();
    await resetBrowser();
    await tail.catch(() => {});
    await resetBrowser();
    server.closeAllConnections?.();
    await stopped;
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须在 1–65535 之间');
  const publicHost = process.env.MD2PDF_PUBLIC_HOST || '';
  const host = publicHost ? '0.0.0.0' : '127.0.0.1';
  const app = createApp({ publicHost });
  app.server.on('error', e => { console.error('md2pdf 服务启动失败：', e.message); process.exitCode = 1; });
  app.server.listen(port, host, () => console.log(`md2pdf 工作台：http://${host}:${port}${publicHost ? `（公网域名 ${publicHost}）` : ''}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().catch(e => { console.error(e.message); process.exitCode = 1; }); });
}
