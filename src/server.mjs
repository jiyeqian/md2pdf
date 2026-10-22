import http from 'node:http';
import { versionInfo } from './version.mjs';
import { analyticsConfig } from './analytics-config.mjs';
import { appCacheScript } from './app-cache.mjs';
import { isIP } from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { render } from './render.mjs';
import { prepareWebDocument } from './web-document.mjs';
import { attachSourcePositions } from './editor-position.mjs';
import { Chrome, findChrome } from './chrome.mjs';
import { webPolicyDocument, policyForType } from './web-options.mjs';
import { frontmatterValueCatalog } from './config.mjs';
import { exampleCatalog, findExample, defaultExampleSource } from './web-examples.mjs';
import { createDoiResolver } from './doi.mjs';
import { documentDownloadName } from '../web/editor-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 24 * 1024 * 1024;
// srcdoc inherits the parent policy, so trusted in-document scripts/styles must also be allowed here.
const PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' data:; style-src 'self' 'unsafe-inline'; frame-src 'self' about:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const assetFiles = ['vendor/mathjax/tex-svg.js', 'vendor/mermaid/mermaid.min.js', 'vendor/pagedjs/paged.polyfill.min.js'];
let assetCache;
const error = (status, message) => Object.assign(new Error(message), { status });

export { imageBudget, validateInput } from './web-input.mjs';
import { resolveWebInput } from './web-input.mjs';

async function readBody(req, limit = LIMIT) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw error(415, '仅支持 application/json');
  if (Number(req.headers['content-length']) > limit) throw error(413, limit === LIMIT ? '请求体超过 24 MiB' : 'DOI 请求体超过 4 KiB');
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw error(413, limit === LIMIT ? '请求体超过 24 MiB' : 'DOI 请求体超过 4 KiB');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw error(400, 'JSON 格式错误'); }
}

export async function webDocument(html, preview = false, type = 'general') {
  if (!assetCache) assetCache = Promise.all(assetFiles.map(async file => [file, await readFile(path.join(ROOT, file), 'utf8')])).then(entries => new Map(entries));
  const assets = await assetCache;
  const scripts = [...assets].map(([file, js]) => [pathToFileURL(path.join(ROOT, file)).href, 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')]);
  const logo = await readFile(path.join(ROOT, 'assets/gb-logo.svg'));
  return prepareWebDocument(html, { scripts, logoUrl:pathToFileURL(path.join(ROOT, 'assets/gb-logo.svg')).href, logoData:'data:image/svg+xml;base64,' + logo.toString('base64'), preview, type });
}

function validateLanHost(lanHost, publicHost) {
  if (!lanHost) return;
  const [a, b] = lanHost.split('.').map(Number);
  if (isIP(lanHost) !== 4 || !(a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31)) {
    throw new Error('MD2PDF_LAN_HOST 必须是本机的私有 IPv4 地址');
  }
  if (publicHost) throw new Error('局域网模式与公网模式不能同时启用');
}

export function createApp({ chromeFactory = (bin, dir) => new Chrome(bin, dir, { incognito: true }), taskTimeout = 60000, queueLimit = 3, chromeBinary, publicHost = process.env.MD2PDF_PUBLIC_HOST || '', lanHost = process.env.MD2PDF_LAN_HOST || '', doiResolver = createDoiResolver().resolve } = {}) {
  validateLanHost(lanHost, publicHost);
  const productInfo = versionInfo('node');
  const analytics = analyticsConfig();
  const pageCsp = analytics.enabled ? PAGE_CSP.replace("connect-src 'self'", "connect-src 'self' " + new URL(analytics.endpoint).origin) : PAGE_CSP;
  let browser, tmpRoot, closed = false, queued = 0, tail = Promise.resolve();
  let doiRequests = 0;
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
  for (const file of ['editor-gutter.js', 'editor-gutter.css', 'panel-sidebars.js', 'panel-sidebars.css', 'template-confirm.js', 'editor-vendor.js', 'editor-vendor.LICENSE.txt', 'editor-core.js', 'editor-images.js', 'editor-pro.js', 'editor-workspace.js', 'editor-analysis.mjs', 'editor-quick-actions.mjs', 'editor-files.mjs', 'workspace-navigation.mjs', 'draft-store.mjs', 'local-drafts.mjs', 'document-create.mjs', 'app-shell.js', 'footer-status.js', 'app-shell.css', 'local-drafts.css', 'editor-core.css', 'editor-images.css', 'editor-pro.css', 'editor-workspace.css', 'editor-doi.js', 'editor-doi-helpers.mjs', 'editor-doi.css']) {
    staticRoutes.set('/' + file, ['web/' + file, file.endsWith('.css') ? 'text/css' : file.endsWith('.txt') ? 'text/plain' : 'text/javascript']);
  }
  staticRoutes.set('/manifest.webmanifest', ['web/manifest.webmanifest', 'application/manifest+json']);
  staticRoutes.set('/icons/app-icon.svg', ['web/icons/app-icon.svg', 'image/svg+xml']);
  for (const size of [180, 192, 512]) staticRoutes.set('/icons/app-' + size + '.png', ['web/icons/app-' + size + '.png', 'image/png']);
  for (const id of ['general', 'paper', 'gb', 'skill']) staticRoutes.set('/template-previews/' + id + '.png', ['web/template-previews/' + id + '.png', 'image/png']);
  staticRoutes.set('/src/frontmatter-fields.mjs', ['src/frontmatter-fields.mjs', 'text/javascript']);
  staticRoutes.set('/version.mjs', ['web/version.mjs', 'text/javascript']);
  for (const file of ['analytics.mjs', 'analytics-schema.mjs', 'analytics-bootstrap.mjs', 'analytics.css', 'privacy.html']) {
    staticRoutes.set('/' + file, ['web/' + file, file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'text/javascript']);
  }
  staticRoutes.set('/runtime-request.mjs', ['web/runtime-request.mjs', 'text/javascript']);
  for (const name of ['doi', 'bibtex']) staticRoutes.set('/icons/' + name + '.svg', ['web/icons/' + name + '.svg', 'image/svg+xml']);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', pageCsp);
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    try {
      const port = server.address()?.port;
      if (!publicHost) {
        // 本地模式：仅信任回环地址，Host 与 Origin 都必须匹配本机。
        const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
        if (lanHost) hosts.push(`${lanHost}:${port}`);
        if (!hosts.includes(req.headers.host)) throw error(403, '仅允许已配置的本机或局域网地址访问');
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
      if (req.method === 'GET' && req.url === '/service-worker.js') {
        const catalog = await exampleCatalog();
        const bootstrap = [
          ['/api/version', productInfo],
          ['/analytics-config.json', analytics],
          ['/api/policy', webPolicyDocument()],
          ['/api/frontmatter-values', frontmatterValueCatalog()],
          ['/api/examples', { examples: catalog.map(({ id, type, title, summary }) => ({ id, type, title, description: summary })) }],
          ['/api/example', { md: await defaultExampleSource() }],
        ];
        for (const { id } of catalog) {
          const example = await findExample(id);
          bootstrap.push(['/api/example?id=' + encodeURIComponent(id), { md: example.md, type: example.type, title: example.title }]);
        }
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        res.end(await appCacheScript(ROOT, staticRoutes, bootstrap)); return;
      }
      // 推广参数只用于来源分类，不改变静态资源路由。
      const staticPath = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && staticRoutes.has(staticPath)) {
        const [file, type] = staticRoutes.get(staticPath);
        const target = path.join(ROOT, file);
        if (!existsSync(target)) { json(404, { error: '页面不存在' }); return; }
        res.writeHead(200, { 'Content-Type': type.startsWith('image/') ? type : `${type}; charset=utf-8` }); res.end(await readFile(target)); return;
      }
      // UI 页面由前端工作流后续补齐：仅在文件已存在时提供，缺失时按 404 处理而非 500。
      if (req.method === 'GET' && (req.url === '/examples' || req.url === '/examples/')) {
        const page = (await readFile(path.join(ROOT, 'web/index.html'), 'utf8')).replace('<head>', '<head>\n  <script>window.__MD2PDF_INITIAL_VIEW__="templates";</script>');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page); return;
      }
      // 在线示例：只服务白名单里的 .md（id 必须命中固定目录），请求参数不参与路径拼接。
      if (req.method === 'GET' && req.url.startsWith('/examples/')) {
        const example = await findExample(decodeURIComponent(req.url.slice('/examples/'.length)).replace(/\.md$/i, ''));
        if (!example) { json(404, { error: '示例不存在' }); return; }
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' }); res.end(example.md); return;
      }
      if (req.method === 'GET' && req.url === '/api/version') { json(200, productInfo); return; }
      if (req.method === 'GET' && req.url === '/analytics-config.json') { json(200, analytics); return; }
      if (req.method === 'GET' && req.url === '/api/frontmatter-values') { json(200, frontmatterValueCatalog()); return; }
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
      if (req.url === '/api/doi') {
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(405, { error: '请使用 POST' }); return; }
        const input = await readBody(req, 4096);
        if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.doi !== 'string' || Object.keys(input).some(key => key !== 'doi')) throw error(400, '请提供 DOI 字符串');
        if (closed) throw error(503, '服务正在关闭');
        if (doiRequests >= 4) throw error(429, 'DOI 查询繁忙，请稍后重试');
        doiRequests++;
        try { json(200, await doiResolver(input.doi)); }
        finally { doiRequests--; }
        return;
      }
      if (!['/api/render', '/api/pdf', '/api/resolve'].includes(req.url)) { json(404, { error: '页面不存在' }); return; }
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(405, { error: '请使用 POST' }); return; }
      const { md, opts, filename, type, effective, policy } = resolveWebInput(await readBody(req));
      if (req.url === '/api/resolve') { json(200, { type, policy }); return; }
      const rendered = await render(md, opts, { webSafe: true });
      if (req.url === '/api/render') {
        json(200, {
          html: await webDocument(attachSourcePositions(rendered.pagedHtml, md), true, rendered.type),
          type: rendered.type,
          policy: policyForType(rendered.type, effective),
          effective,
        });
        return;
      }
      const pdf = await pdfTask(await webDocument(rendered.html), rendered.printOptions);
      // 与 Markdown 下载共用同一命名：客户端提交的 filename 优先（共享浏览器时间戳），
      // 否则服务端按同一 helper 从正文推导，保证直接调用 API 的命名同样合理。
      const name = filename || documentDownloadName(md, new Date(), 'pdf');
      const encodedName = encodeURIComponent(name).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="document.pdf"; filename*=UTF-8''${encodedName}` }); res.end(pdf);
    } catch (e) {
      if (!res.headersSent && !res.destroyed) {
        const payload = { error: e.status ? e.message : req.url === '/api/doi' ? 'DOI 查询失败，请稍后重试' : '渲染失败，请检查文档或 Chrome 配置后重试' };
        // 配置错误（ConfigError / 文档配置校验）保留逐条行号定位信息，供 Web 端展示与跳转。
        if (Array.isArray(e.configErrors) && e.configErrors.length) payload.configErrors = e.configErrors;
        json(e.status || 500, payload);
      }
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

export function startServer({ port = Number(process.env.PORT || 3000), publicHost = process.env.MD2PDF_PUBLIC_HOST || '', lanHost = process.env.MD2PDF_LAN_HOST || '' } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须在 1–65535 之间');
  validateLanHost(lanHost, publicHost);
  const productInfo = versionInfo('node');
  const host = publicHost || lanHost ? '0.0.0.0' : '127.0.0.1';
  const app = createApp({ publicHost, lanHost });
  app.server.on('error', e => { console.error('md2pdf 服务启动失败：', e.message); process.exitCode = 1; });
  app.server.listen(port, host, () => console.log(`md2pdf 工作台：http://${lanHost || host}:${port}${publicHost ? `（公网域名 ${publicHost}）` : ''}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().catch(e => { console.error(e.message); process.exitCode = 1; }); });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}
