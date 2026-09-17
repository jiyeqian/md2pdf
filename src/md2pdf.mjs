#!/usr/bin/env node
/**
 * md2pdf —— 把 Markdown 排成优雅的 A4 PDF（无头 Chrome + CDP）
 *
 * 用法：md2pdf <file.md> [file2.md ...] [选项]
 *
 * 选项：
 *   -o, --output <path>   输出 PDF（单文件时可用；多文件时忽略）
 *       --theme <name>    elegant（默认）| minimal
 *       --title <text>    覆盖标题（默认取正文首个 H1，其次 frontmatter.title，其次文件名）
 *       --kicker <text>   报头小标题（如"专利实务 · 技能文档"）
 *       --no-meta         不生成元信息条
 *       --no-lead         首段不作为导语放大
 *   -t, --toc             生成目录（取自 H2）
 *       --link-urls       正文链接后附 URL
 *       --landscape       横向页面
 *       --font-size <pt>  正文字号，默认 10.5
 *       --margin <mm>     页边距，默认 20（上下同为 18/20，左右同值）；可写 "20,18"
 *       --no-footer       不输出页脚页码
 *       --footer-left  <text>   页脚左文字（默认空）
 *       --footer-right <text>   页脚右文字（默认空）
 *       --colophon <text> 文末落款（默认：来源文件名）
 *       --keep-html       保留中间 HTML，便于调样式
 *       --open            完成后打开 PDF
 *   -h, --help
 *
 * 环境变量：
 *   MD2PDF_CHROME  指定 Chrome/Edge/Chromium 可执行文件路径
 *   MD2PDF_WS=mini 强制使用内置 WebSocket 实现（Node < 22 时自动启用）
 */

import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');

const VERSION = '1.2.1';

// 联网安装时 install.sh 会写入 .install-meta（记录来源），--upgrade 依赖它
const INSTALL_META = '.install-meta';
const DEFAULT_REPO = 'https://cnb.cool/jiyeqian/md2pdf';

// Node ≥ 22 有全局 WebSocket；更老的版本退回到内置的极简实现
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

const HELP = `
md2pdf ${VERSION} —— Markdown → 优雅 PDF

  md2pdf <file.md> [file2.md ...] [选项]

选项：
  -o, --output <path>      输出路径（默认与输入同目录同名 .pdf）
      --theme <name>       elegant（默认，墨蓝+古铜）| minimal（黑白公文）
      --title <text>       覆盖标题
      --kicker <text>      报头小标题
      --no-meta            不生成元信息条
      --no-lead            首段不作为导语
  -t, --toc                生成目录（取自二级标题）
      --link-urls          正文链接后附 URL
      --landscape          横向
      --font-size <pt>     正文字号（默认 10.5）
      --margin <mm>        页边距（默认 20；可写 "20,18" = 上下,左右）
      --no-footer          不要页脚页码
      --footer-left/--footer-right <text>
      --colophon <text>    文末落款
      --keep-html          保留中间 HTML
      --html-only          只生成 HTML，不启动浏览器（调试样式 / CI 校验用）
      --open               完成后打开 PDF
      --upgrade            从安装来源拉取最新版并覆盖本机安装
  -h, --help

示例：
  md2pdf SKILL.md
  md2pdf notes.md --theme minimal --toc --open
  md2pdf a.md b.md -o /tmp/   # 多文件时 -o 视为输出目录
`;

/* ---------------- 参数 ---------------- */

// 展开 --flag=value / --flag=false 写法
function expandArgs(argv) {
  const out = [];
  for (const a of argv) {
    const m = /^(--[a-z][a-z-]*)=(.*)$/i.exec(a);
    if (m && !['--output', '--footer-left', '--footer-right'].includes(m[1])) {
      const falsey = /^(false|0|no)$/i.test(m[2]);
      out.push(falsey ? `--no-${m[1].slice(2)}` : m[1]);
      if (!falsey && m[2] !== '') out.push(m[2]);
    } else out.push(a);
  }
  return out;
}

function parseArgs(argv) {
  const o = {
    inputs: [], theme: 'elegant', fontSize: 10.5,
    marginTop: 20, marginSide: 18, marginBottom: 18,
    footer: true, footerLeft: '', footerRight: '',
    meta: true, lead: true, toc: false, linkUrls: false,
    landscape: false, keepHtml: false, htmlOnly: false, open: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '-o': case '--output': o.output = next(); break;
      case '--theme': o.theme = next(); break;
      case '--title': o.title = next(); break;
      case '--kicker': o.kicker = next(); break;
      case '--no-meta': o.meta = false; break;
      case '--no-lead': o.lead = false; break;
      case '-t': case '--toc': o.toc = true; break;
      case '--link-urls': o.linkUrls = true; break;
      case '--landscape': o.landscape = true; break;
      case '--font-size': o.fontSize = parseFloat(next()); break;
      case '--margin': {
        const v = next(); const m = String(v).split(',').map(s => parseFloat(s.trim()));
        o.marginTop = m[0]; o.marginBottom = m[0]; o.marginSide = m[1] ?? m[0];
        break;
      }
      case '--no-footer': o.footer = false; break;
      case '--footer-left': o.footerLeft = next(); break;
      case '--footer-right': o.footerRight = next(); break;
      case '--colophon': o.colophon = next(); break;
      case '--keep-html': o.keepHtml = true; break;
      case '--html-only': o.htmlOnly = true; break;
      case '--no-html-only': o.htmlOnly = false; break;
      case '--open': o.open = true; break;
      case '--upgrade': o.upgrade = true; break;
      case '--no-open': o.open = false; break;
      case '--no-toc': o.toc = false; break;
      case '--no-landscape': o.landscape = false; break;
      case '--no-link-urls': o.linkUrls = false; break;
      case '--no-keep-html': o.keepHtml = false; break;
      case '--version': o.version = true; break;
      default:
        if (a.startsWith('-')) { console.warn(`md2pdf: 忽略未知选项 ${a}`); }
        else o.inputs.push(a);
    }
  }
  return o;
}

/* ---------------- 工具 ---------------- */

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripTags = s => String(s).replace(/<[^>]+>/g, '').trim();

function splitFrontmatter(src) {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { fm: {}, body: src };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)[ \t]*:[ \t]*(.*)$/.exec(line);
    if (kv) {
      let v = kv[2].trim().replace(/^["']|["']$/g, '');
      fm[kv[1]] = v;
    } else if (/^\s+/.test(line) && Object.keys(fm).length) {
      const k = Object.keys(fm).at(-1);
      fm[k] = (fm[k] + ' ' + line.trim()).trim();
    }
  }
  return { fm, body: src.slice(m[0].length) };
}

function buildMeta(fm, isSkill) {
  if (!fm.name && !fm.description) return '';
  const items = [];
  if (fm.name) {
    items.push([isSkill ? 'SKILL NAME' : 'NAME', `<code>${esc(fm.name)}</code>`]);
  }
  if (fm.description) {
    const d = fm.description;
    const suit = /适用于([^；。]+)/.exec(d);
    const notsuit = /不用于([^；。]+)/.exec(d);
    if (suit || notsuit) {
      if (suit) items.push(['适用', esc(suit[1].trim())]);
      if (notsuit) items.push(['不适用', esc(notsuit[1].trim())]);
    } else if (fm.name) {
      items.push(['说明', esc(d)]);
    } else {
      items.push(['DESCRIPTION', esc(d)]);
    }
  }
  if (!items.length) return '';
  const html = items.map(([l, v]) =>
    `<div class="meta-item"><span class="meta-label">${esc(l)}</span><span class="meta-value">${v}</span></div>`
  ).join('\n  ');
  return `<div class="meta">\n  ${html}\n</div>`;
}

function sectionize(html) {
  return html.split(/(?=<h2[\s>])/)
    .map(p => (p.trim().startsWith('<h2') ? `<section>\n${p}\n</section>` : p))
    .join('\n');
}

/* ---------------- Chrome ---------------- */

function findChrome() {
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

class Chrome {
  constructor(bin, tmpRoot) { this.bin = bin; this.tmpRoot = tmpRoot; }
  async start() {
    this.userDataDir = await mkdtemp(path.join(this.tmpRoot, 'chrome-'));
    const port = 9200 + Math.floor(Math.random() * 700);
    this.port = port;
    this.proc = spawn(this.bin, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-extensions',
      '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
      '--disable-features=Translate,OptimizationHints',
      `--user-data-dir=${this.userDataDir}`,
      `--remote-debugging-port=${port}`,
      'about:blank',
    ], { stdio: 'ignore' });
    this.proc.on('error', () => {});
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
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
    };
    await this.send('Page.enable');
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, m => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async print(htmlPath, opts) {
    const loaded = new Promise(res => {
      const h = ev => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Page.loadEventFired') { this.ws.removeEventListener('message', h); res(); }
      };
      this.ws.addEventListener('message', h);
    });
    await this.send('Page.navigate', { url: pathToFileURL(htmlPath).href });
    await loaded;
    await new Promise(r => setTimeout(r, 250));
    const res = await this.send('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      landscape: !!opts.landscape,
      displayHeaderFooter: !!opts.footer,
      headerTemplate: '<span></span>',
      footerTemplate: opts.footerTemplate || '<span></span>',
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    });
    return Buffer.from(res.data, 'base64');
  }
  async stop() {
    try { this.ws && this.ws.close(); } catch {}
    try { this.proc && this.proc.kill('SIGKILL'); } catch {}
    try { this.userDataDir && await rm(this.userDataDir, { recursive: true, force: true }); } catch {}
  }
}

/* ---------------- 渲染 ---------------- */

async function renderOne(mdPath, opts, chrome, marked, tmpRoot) {
  const src = await readFile(mdPath, 'utf8');
  const { fm, body } = splitFrontmatter(src);
  const isSkill = path.basename(mdPath) === 'SKILL.md' || !!fm.name;

  let html = marked.parse(body, { gfm: true, breaks: false, async: false });

  // 标题：正文首个 H1 → 报头
  let title = opts.title || fm.title || '';
  const h1 = /<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/.exec(html);
  if (h1) {
    const t = stripTags(h1[1]);
    if (!title) title = t;
    html = html.replace(h1[0], '');
  }
  if (!title) title = path.basename(mdPath, path.extname(mdPath));

  // 导语：移除 H1 后的第一段
  let lead = '';
  if (opts.lead) {
    const p = /<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/.exec(html);
    if (p && stripTags(p[1]).length > 12 && p.index < 2000) {
      lead = p[1];
      html = html.replace(p[0], '');
    }
  }

  // 链接 / 图片
  html = html.replace(/<a\s+href="([^"]*)"([^>]*)>/g, (m, href, rest) =>
    `<a href="${href}" class="ref"${rest}>`);
  if (opts.linkUrls) {
    html = html.replace(/<a\s+href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
      (m, href, text) => `${m} <span class="link-url">(${esc(href)})</span>`);
  }
  const dir = path.dirname(path.resolve(mdPath));
  html = html.replace(/<img\s+([^>]*?)src="([^"]+)"([^>]*)>/g, (m, pre, src, post) => {
    if (/^(https?:|data:|file:)/.test(src)) return m;
    const abs = path.resolve(dir, src);
    return `<img ${pre}src="${pathToFileURL(abs).href}"${post}>`;
  });

  // 目录
  let toc = '';
  if (opts.toc) {
    const heads = [...html.matchAll(/<h2(?:\s[^>]*)?>([\s\S]*?)<\/h2>/g)].map(m => stripTags(m[1]));
    if (heads.length > 1) {
      toc = `<div class="toc"><div class="toc-title">目 录</div><ol>` +
        heads.map(h => `<li>${esc(h)}</li>`).join('') + `</ol></div>`;
    }
  }

  html = sectionize(html);

  // CSS
  const themeFile = path.join(ASSETS, `theme-${opts.theme}.css`);
  if (!existsSync(themeFile)) throw new Error(`未知主题：${opts.theme}（可用：elegant, minimal）`);
  const base = await readFile(path.join(ASSETS, 'base.css'), 'utf8');
  const theme = await readFile(themeFile, 'utf8');
  const css = (base + '\n' + theme)
    .replace(/\{\{PAGE_SIZE\}\}/g, opts.landscape ? 'A4 landscape' : 'A4')
    .replace(/\{\{MARGIN_TOP\}\}/g, `${opts.marginTop}mm`)
    .replace(/\{\{MARGIN_BOTTOM\}\}/g, `${opts.marginBottom}mm`)
    .replace(/\{\{MARGIN_SIDE\}\}/g, `${opts.marginSide}mm`)
    .replace(/\{\{FONT_SIZE\}\}/g, `${opts.fontSize}pt`);

  const kicker = opts.kicker || fm.kicker || fm.category || (isSkill ? '技能文档' : '');
  const colophonLeft = opts.colophon ?? (isSkill && fm.name ? `SKILL · ${fm.name}` : path.basename(mdPath));
  const colophonRight = opts.colophon ? '' : title;

  // 用函数形式替换：既支持多处占位符，也避免用户文本里的 $& 被当作替换模式
  const fill = (tpl, map) => Object.entries(map).reduce(
    (s, [k, v]) => s.split(k).join(v), tpl);

  const shell = await readFile(path.join(ASSETS, 'shell.html'), 'utf8');
  const out = fill(shell, {
    '{{TITLE}}': esc(title),
    '{{CSS}}': css,
    '{{KICKER}}': esc(kicker),
    '{{LEAD}}': lead,
    '{{META}}': opts.meta ? buildMeta(fm, isSkill) : '',
    '{{TOC}}': toc,
    '{{BODY}}': html,
    '{{COLOPHON_LEFT}}': esc(colophonLeft),
    '{{COLOPHON_RIGHT}}': esc(colophonRight),
  });

  if (opts.htmlOnly) return { title, html: out };

  const tmpDir = await mkdtemp(path.join(tmpRoot, 'doc-'));
  const htmlPath = path.join(tmpDir, 'index.html');
  await writeFile(htmlPath, out, 'utf8');

  const footerTemplate = `<div style="width:100%;font-size:8px;color:#8a8578;font-family:-apple-system,'PingFang SC',sans-serif;letter-spacing:.5px;display:flex;justify-content:space-between;padding:0 12mm;">
      <span style="flex:1;text-align:left;">${opts.footerLeft || ''}</span>
      <span style="flex:1;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></span>
      <span style="flex:1;text-align:right;">${opts.footerRight || ''}</span>
    </div>`;

  const buf = await chrome.print(htmlPath, { footer: opts.footer, footerTemplate, landscape: opts.landscape });

  if (opts.keepHtml) {
    await writeFile(mdPath.replace(/\.md$/i, '.html'), out, 'utf8');
  } else {
    await rm(tmpDir, { recursive: true, force: true });
  }
  return { title, buf };
}

/* ---------------- 升级 ---------------- */

// 从安装来源（install.sh 写下的 .install-meta）重新拉取并覆盖安装。
// 目标进程正在运行的就是被覆盖的目录 —— 这不是问题：node 启动时已把模块读进内存。
async function doUpgrade() {
  const metaPath = path.join(ROOT, INSTALL_META);
  if (!existsSync(metaPath)) {
    console.log(`当前是 git 工作副本：${ROOT}`);
    console.log('升级： git -C "' + ROOT + '" pull');
    console.log(`或重新联网安装：curl -fsSL ${DEFAULT_REPO}/-/git/raw/main/install.sh | sh`);
    return;
  }

  const meta = {};
  for (const line of (await readFile(metaPath, 'utf8')).split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const repo = meta.repo || DEFAULT_REPO;
  const ref = meta.ref || 'main';
  const url = `${repo}/-/git/raw/${encodeURIComponent(ref)}/install.sh`;

  console.log(`从 ${url} 更新…（当前 ${VERSION}）`);
  const env = { ...process.env, MD2PDF_HOME: ROOT, MD2PDF_REF: ref, MD2PDF_SRC: repo };
  // 命令落点与技能目录都记在 .install-meta 里。升级时环境里通常没有 PREFIX /
  // MD2PDF_SKILL_DIR，不显式传回去，命令会漂到默认目录（旧位置留下悬空软链）、
  // 技能说明书也会装错地方或停在旧版。
  if (meta.bin) env.PREFIX = meta.bin;
  if (meta.skill) env.MD2PDF_SKILL_DIR = meta.skill;
  const r = spawnSync('sh', ['-c', 'curl -fsSL "$1" | sh', 'sh', url], {
    stdio: 'inherit',
    env,
  });
  if (r.status !== 0) {
    console.error(`md2pdf: 更新失败（退出码 ${r.status}）`);
    process.exitCode = 1;
    return;
  }

  const after = spawnSync(path.join(ROOT, 'bin', 'md2pdf'), ['--version'], { encoding: 'utf8' });
  const now = (after.stdout || '').trim();
  if (now && now !== VERSION) console.log(`\n已更新： ${VERSION} → ${now}`);
  else if (now) console.log(`\n已是最新：${now}`);
}

/* ---------------- main ---------------- */

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function resolveOutput(mdPath, opts) {
  const ext = opts.htmlOnly ? '.html' : '.pdf';
  if (!opts.output) return mdPath.replace(/\.md$/i, ext);
  const o = path.resolve(opts.output);
  if (opts.inputs.length > 1 || isDir(o) || o.endsWith(path.sep)) {
    return path.join(o, path.basename(mdPath, path.extname(mdPath)) + ext);
  }
  return o;
}

async function main() {
  const opts = parseArgs(expandArgs(process.argv.slice(2)));
  if (opts.help) { console.log(HELP); return; }
  if (opts.version) { console.log(VERSION); return; }
  if (opts.upgrade) { await doUpgrade(); return; }
  if (!opts.inputs.length) { console.log(HELP); process.exitCode = 1; return; }

  const { Marked } = await import(pathToFileURL(path.join(ROOT, 'vendor', 'marked.esm.js')).href);
  const marked = new Marked({ gfm: true });

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-'));
  // --html-only 不需要浏览器（CI / 调样式时用）
  const chrome = opts.htmlOnly ? null : new Chrome(findChrome(), tmpRoot);
  let failed = false;
  try {
    if (chrome) await chrome.start();
    for (const input of opts.inputs) {
      const mdPath = path.resolve(input);
      if (!existsSync(mdPath)) { console.error(`✗ 找不到文件：${input}`); failed = true; continue; }
      try {
        const res = await renderOne(mdPath, opts, chrome, marked, tmpRoot);
        const out = resolveOutput(mdPath, opts);
        await mkdir(path.dirname(out), { recursive: true });
        if (opts.htmlOnly) {
          await writeFile(out, res.html, 'utf8');
          console.log(`✓ ${path.basename(out)}  (HTML ${(res.html.length / 1024).toFixed(0)} KB)`);
          continue;
        }
        const buf = res.buf;
        await writeFile(out, buf);
        let pages = '';
        const info = spawnSync('pdfinfo', [out], { encoding: 'utf8' });
        if (info.status === 0) {
          const m = /Pages:\s+(\d+)/.exec(info.stdout);
          if (m) pages = `，${m[1]} 页`;
        }
        console.log(`✓ ${path.basename(out)}  (${(buf.length / 1024).toFixed(0)} KB${pages})`);
        if (opts.open) {
          const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
          spawn(cmd, [out], { stdio: 'ignore' });
        }
      } catch (e) {
        console.error(`✗ ${input}：${e.message}`);
        failed = true;
      }
    }
  } finally {
    if (chrome) await chrome.stop();
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('md2pdf 失败：', e.message); process.exit(1); });
