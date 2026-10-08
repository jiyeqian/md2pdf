import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { render } from './render.mjs';
import { enhancePreview } from './preview.mjs';
import { Chrome, findChrome } from './chrome.mjs';
import { webPolicyDocument, policyForType, effectiveOptions, assertOptionsAllowed, resolveWebType } from './web-options.mjs';
import { exampleCatalog, findExample, defaultExampleSource } from './web-examples.mjs';

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
  if (preview) html = enhancePreview(html, type);
  return html;
}

export function createApp({ chromeFactory = (bin, dir) => new Chrome(bin, dir, { incognito: true }), taskTimeout = 60000, queueLimit = 3, chromeBinary, publicHost = process.env.MD2PDF_PUBLIC_HOST || '' } = {}) {
  let browser, tmpRoot, closed = false, queued = 0, tail = Promise.resolve();
  // 公网部署时由反向代理转发，Host 为沙箱内部域名；本地开发保持仅本机可访问。
  // 来源校验始终开启：未配置 publicHost 时只信任回环地址；配置后保留 Origin 白名单（防跨站）。
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
  const staticRoutes = new Map([['/', ['web/index.html', 'text/html']], ['/app.js', ['web/app.js', 'text/javascript']], ['/app.css', ['web/app.css', 'text/css']], ['/examples.js', ['web/examples.js', 'text/javascript']], ['/examples.css', ['web/examples.css', 'text/css']]]);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', PAGE_CSP);
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    try {
      const port = server.address()?.port;
      if (!publicHost) {
        // 本地模式：仅信任回环地址，Host 与 Origin 都必须匹配本机。
        const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
        if (!hosts.includes(req.headers.host)) throw error(403, '仅允许本机访问');
        const origin = req.headers.origin;
        if (origin && !hosts.map(host => 'http://' + host).includes(origin)) throw error(403, '不允许跨站请求');
      } else {
        // 公网模式：反向代理已完成「公网域名 → 沙箱」的路由，node 只见内部沙箱域名，
        // 因此不再硬比 Host；但保留 Origin 白名单（防跨站），并拒绝畸形 Host（含绝对 URL / 空值）。
        const host = req.headers.host || '';
        if (!host || /^(?:https?:)?\/\//i.test(host) || host.includes('@')) throw error(403, '非法的 Host');
        const origin = req.headers.origin;
        if (origin && !allowedOrigins.includes(origin)) throw error(403, '不允许跨站请求');
      }
      if (closed) throw error(503, '服务正在关闭');
      if (req.method === 'GET' && staticRoutes.has(req.url)) {
        const [file, type] = staticRoutes.get(req.url);
        const target = path.join(ROOT, file);
        if (!existsSync(target)) { json(404, { error: '页面不存在' }); return; }
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(await readFile(target)); return;
      }
      // UI 页面由前端工作流后续补齐：仅在文件已存在时提供，缺失时按 404 处理而非 500。
      if (req.method === 'GET' && req.url === '/examples' && existsSync(path.join(ROOT, 'web/examples.html'))) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(await readFile(path.join(ROOT, 'web/examples.html'))); return;
      }
      // 在线示例：只服务白名单里的 .md（id 必须命中固定目录），请求参数不参与路径拼接。
      if (req.method === 'GET' && req.url.startsWith('/examples/')) {
        const example = await findExample(decodeURIComponent(req.url.slice('/examples/'.length)).replace(/\.md$/i, ''));
        if (!example) { json(404, { error: '示例不存在' }); return; }
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' }); res.end(example.md); return;
      }
      if (req.method === 'GET' && req.url === '/api/policy') { json(200, webPolicyDocument()); return; }
      if (req.method === 'GET' && req.url === '/api/examples') {
        const examples = (await exampleCatalog()).map(({ id, type, title, summary }) => ({ id, type, title, description: summary }));
        json(200, { examples }); return;
      }
      if (req.method === 'GET' && (req.url === '/api/example' || req.url.startsWith('/api/example?'))) {
        const id = new URL(req.url, 'http://localhost').searchParams.get('id');
        if (!id) { json(200, { md: await defaultExampleSource() }); return; }
        const example = await findExample(id);
        if (!example) { json(404, { error: '示例不存在' }); return; }
        json(200, { md: example.md, type: example.type, title: example.title }); return;
      }
      if (!['/api/render', '/api/pdf', '/api/resolve'].includes(req.url)) { json(404, { error: '页面不存在' }); return; }
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(405, { error: '请使用 POST' }); return; }
      const { md, opts } = validateInput(await readBody(req));
      // 先由原文判定生效类型，再按类型策略强制校验，最后才渲染（不把默认编号方案塞进 opts）。
      const type = resolveWebType(md, opts.type);
      if (req.url === '/api/resolve') { json(200, { type, policy: policyForType(type) }); return; }
      assertOptionsAllowed(opts, type);
      const rendered = await render(md, opts, { webSafe: true });
      if (req.url === '/api/render') {
        json(200, {
          html: await webDocument(rendered.pagedHtml, true, rendered.type),
          type: rendered.type,
          policy: policyForType(rendered.type),
          effective: effectiveOptions(opts, rendered.type),
        });
        return;
      }
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
