import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
let _WS;
async function getWSClass() {
  if (_WS) return _WS;
  if (process.env.MD2PDF_WS === 'mini' || typeof WebSocket === 'undefined') {
    _WS = (await import('./ws.mjs')).MiniWebSocket;
  } else {
    _WS = WebSocket;
  }
  return _WS;
}

export function findChrome() {
  if (process.env.MD2PDF_CHROME && existsSync(process.env.MD2PDF_CHROME)) return process.env.MD2PDF_CHROME;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const w = spawnSync('which', [name], { encoding: 'utf8' });
    if (w.status === 0 && w.stdout.trim()) return w.stdout.trim();
  }
  throw new Error('未找到 Chrome/Edge/Chromium，请用环境变量 MD2PDF_CHROME 指定路径');
}

const getJson = (port, p) => new Promise((res, rej) => {
  const req = http.get({ host: '127.0.0.1', port, path: p }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  });
  req.on('error', rej);
  req.setTimeout(2000, () => req.destroy(new Error('timeout')));
});

async function waitDevTools(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await getJson(port, '/json/version'); return true; } catch { await new Promise(r => setTimeout(r, 200)); }
  }
  throw new Error('Chrome DevTools 启动超时');
}

export class Chrome {
  constructor(bin, tmpRoot, { incognito = false } = {}) { this.bin = bin; this.tmpRoot = tmpRoot; this.incognito = incognito; }
  async start() {
    this.userDataDir = await mkdtemp(path.join(this.tmpRoot, 'chrome-'));
    this.proc = spawn(this.bin, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-extensions',
      ...(this.incognito ? ['--incognito'] : []),
      '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
      '--disable-features=Translate,OptimizationHints',
      `--user-data-dir=${this.userDataDir}`,
      '--remote-debugging-port=0',
      'about:blank',
    ], { stdio: 'ignore' });
    let launchError;
    this.proc.on('error', e => { launchError = e; });
    const started = Date.now();
    while (!this.port) {
      if (launchError) throw launchError;
      if (this.proc.exitCode !== null || this.proc.signalCode !== null) throw new Error('Chrome exited before startup');
      try { this.port = Number((await readFile(path.join(this.userDataDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch {}
      if (Date.now() - started > 20000) throw new Error('Chrome DevTools 启动超时');
      if (!this.port) await new Promise(r => setTimeout(r, 100));
    }
    const port = this.port;
    await waitDevTools(port, 20000);
    const list = await getJson(port, '/json/list');
    const page = list.find(t => t.type === 'page');
    if (!page) throw new Error('未找到可打印的页面目标');
    const WS = await getWSClass();
    this.ws = new WS(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.id = 0; this.pending = new Map();
    this.ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id).resolve(m); this.pending.delete(m.id); }
    };
    const disconnected = () => { for (const entry of this.pending.values()) entry.reject(new Error('Chrome connection closed')); this.pending.clear(); };
    this.ws.onclose = disconnected;
    this.ws.onerror = disconnected;
    await this.send('Page.enable');
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(`Chrome command timeout: ${method}`)); }, 30000);
      this.pending.set(id, {
        resolve: m => { clearTimeout(timer); m.error ? rej(new Error(m.error.message)) : res(m.result); },
        reject: e => { clearTimeout(timer); rej(e); },
      });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); rej(e); }
    });
  }
  async print(htmlPath, opts) {
    return this.printURL(pathToFileURL(htmlPath).href, opts);
  }
  async printHtml(html, opts) {
    return this.printURL('about:blank', opts, html);
  }
  async printURL(url, opts, html) {
    await this.send('Network.enable');
    await this.send('Network.setBlockedURLs', { urls: opts.webSafe ? ['http://*', 'https://*', 'file://*', 'ftp://*', 'ws://*', 'wss://*'] : [] });
    let marker;
    if (html !== undefined) {
      await this.send('Page.navigate', { url: 'about:blank' });
      // setDocumentContent avoids Chromium's size limit for data URL navigation.
      marker = randomUUID();
      html = html.replace('<html ', '<html data-md2pdf-id="' + marker + '" ');
    }
    let loadTimer, loadedHandler;
    const loaded = new Promise((resolve, reject) => {
      loadedHandler = ev => { if (JSON.parse(ev.data).method === 'Page.loadEventFired') resolve(); };
      this.ws.addEventListener('message', loadedHandler);
      loadTimer = setTimeout(() => reject(new Error('Chrome document load timeout')), 20000);
    });
    // The navigation promise can fail before the event waiter; observe both failures.
    loaded.catch(() => {});
    try {
      if (html !== undefined) {
        const tree = await this.send('Page.getFrameTree');
        await this.send('Page.setDocumentContent', { frameId: tree.frameTree.frame.id, html });
      } else {
        const navigation = await this.send('Page.navigate', { url });
        if (navigation.errorText) throw new Error(navigation.errorText);
      }
      await loaded;
    } finally { clearTimeout(loadTimer); this.ws.removeEventListener('message', loadedHandler); }
    const loadStart = Date.now();
    while (true) {
      const state = await this.send('Runtime.evaluate', { expression: marker ? `document.documentElement.getAttribute('data-md2pdf-id') === ${JSON.stringify(marker)} && document.readyState` : 'document.readyState', returnByValue: true });
      if (state.result?.value === 'complete') break;
      if (Date.now() - loadStart > 20000) throw new Error('Chrome document load timeout');
      await new Promise(r => setTimeout(r, 100));
    }
    await new Promise(r => setTimeout(r, 250));
    // MathJax / Mermaid 异步渲染：轮询等待完成再打印（否则公式/图表是空白）
    const waits = [];
    if (opts.waitMath) waits.push('window.__md2pdfMathReady === true');
    if (opts.waitMermaid) waits.push('window.__md2pdfMermaidReady === true');
    // Paged.js 分页完成（GB 专用）：必须在公式/图表之后，否则页框尺寸不对
    if (opts.waitPaged) waits.push('window.__md2pdfPagedReady === true');
    if (waits.length) {
      const expr = waits.join(' && ');
      const t0 = Date.now();
      let ready = false;
      while (Date.now() - t0 < 20000) {
        let done = false;
        try {
          const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true });
          done = !!(r && r.result && r.result.value);
        } catch { /* 忽略运行时异常，继续等待 */ }
        if (done) { ready = true; break; }
        await new Promise(r => setTimeout(r, 100));
      }
      if (!ready) throw new Error('Chrome asynchronous rendering timeout');
    }
    if (opts.webSafe) {
      const failure = await this.send('Runtime.evaluate', { expression: 'window.__md2pdfMermaidError || window.__md2pdfPagedError || null', returnByValue: true });
      if (failure.result?.value) throw new Error('Document rendering failed');
    }
    await this.send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true, returnByValue: true });
    const base = {
      printBackground: true,
      preferCSSPageSize: true,
      landscape: !!opts.landscape,
      displayHeaderFooter: !!(opts.footer || opts.header),
      headerTemplate: opts.headerTemplate || '<span></span>',
      footerTemplate: opts.footerTemplate || '<span></span>',
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    };
    // PDF 书签：Chrome 按 h1–h6 结构写成 /Outlines 树，阅读器侧边栏可点击跳转。
    // 老版本 Chrome 不认这个参数，出错就退回不带书签的渲染（页脚页码仍保留）。
    let res;
    if (opts.outline) {
      try { res = await this.send('Page.printToPDF', { ...base, generateDocumentOutline: true }); }
      catch (e) {
        if (!/generateDocumentOutline|invalid parameters|unknown parameter/i.test(e.message)) throw e;
        res = await this.send('Page.printToPDF', base);
      }
    } else {
      res = await this.send('Page.printToPDF', base);
    }
    if (res.error) throw new Error(`渲染失败：${res.error.message}`);
    return Buffer.from(res.data, 'base64');
  }
  async stop() {
    try { this.ws && this.ws.close(); } catch {}
    try { this.proc && this.proc.kill('SIGKILL'); } catch {}
    try { this.userDataDir && await rm(this.userDataDir, { recursive: true, force: true }); } catch {}
  }
}

