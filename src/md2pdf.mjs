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
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');

const VERSION = '1.7.14';

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
  -t, --toc                在文首插入目录页（取自二级标题，可点击跳转）
      --no-outline         不生成 PDF 书签（默认生成，阅读器侧边栏按标题成树）
      --bibliography [footnote|bib]  将脚注收集为「参考文献」章节（默认 footnote；bib 为未来支持）
      --numbering <mode>    章节编号：auto（默认，识别到已有编号则不动）| force（强制）| none（不加）
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
    meta: true, lead: true, toc: false, linkUrls: false, outline: true, bibliography: 'footnote',
    numbering: 'auto',
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
      case '--no-open': o.open = false; break;
      case '--no-toc': o.toc = false; break;
      case '--outline': o.outline = true; break;
      case '--no-outline': o.outline = false; break;
      case '--bibliography': {
        const n = argv[i + 1];
        if (n && ['footnote', 'bib'].includes(n)) { o.bibliography = n; i++; }
        else o.bibliography = 'footnote';
        break;
      }
      case '--numbering': o.numbering = next(); break;
      case '--no-bibliography': o.bibliography = false; break;
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

/* ---------------- 代码高亮 ---------------- */

// 反转 marked 输出的 HTML 实体（highlight.js 需要原始代码再自行转义）
function decodeEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// 对 <pre><code> 块调用 highlight.js；带语言标记用对应语法，否则自动识别
function highlightCode(html, hljs) {
  if (!hljs) return html;
  return html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, (m, attrs, code) => {
    const lm = /(?:language|lang)-([\w-]+)/.exec(attrs);
    const lang = lm ? lm[1] : '';
    const text = decodeEntities(code);
    let out;
    try {
      out = (lang && hljs.getLanguage(lang))
        ? hljs.highlight(text, { language: lang }).value
        : hljs.highlightAuto(text).value;
    } catch { return m; }
    const cls = 'hljs' + (lang ? ' language-' + lang : '');
    return '<pre><code class="' + cls + '">' + out + '</code></pre>';
  });
}

/* ---------------- 图表编号 ---------------- */

// 图：<p><img></p> → <figure> + 题注「图 N：…」；表格前的「表：…」段 → <caption>「表 N：…」
// 题注里可带 {#fig:x} / {#tab:x} 标签，供 \ref{} 引用
function numberFloats(html) {
  const refs = new Map();
  let figN = 0, tabN = 0;

  html = html.replace(/<p>\s*(<img\b[^>]*>)\s*<\/p>/g, (m, tag) => {
    const altM = /\balt="([^"]*)"/.exec(tag);
    let alt = altM ? altM[1] : '';
    let label = '';
    const labM = /\s*\{#(fig:[\w.-]+)\}\s*/.exec(alt);
    if (labM) {
      label = labM[1];
      alt = alt.replace(labM[0], ' ').replace(/\s+/g, ' ').trim();
      tag = tag.replace(/\balt="[^"]*"/, 'alt="' + alt + '"');
    }
    figN++;
    if (label) refs.set(label, { num: figN, id: 'fig-' + figN });
    return '<figure class="fig" id="fig-' + figN + '">' + tag +
      '<figcaption>图 ' + figN + '：' + alt + '</figcaption></figure>';
  });

  html = html.replace(/<p>\s*表\s*[：:]\s*([\s\S]*?)<\/p>\s*<table>/g, (m, cap) => {
    let label = '';
    const labM = /\s*\{#(tab:[\w.-]+)\}\s*/.exec(cap);
    if (labM) { label = labM[1]; cap = cap.replace(labM[0], ' ').trim(); }
    tabN++;
    if (label) refs.set(label, { num: tabN, id: 'tab-' + tabN });
    return '<table class="tbl" id="tab-' + tabN + '">\n<caption>表 ' + tabN + '：' + cap + '</caption>';
  });

  return { html, refs };
}

/* ---------------- 章节编号 ---------------- */

// 标题编号前缀识别（阿拉伯/中文/罗马数字、第X章、括号编号等）
const HEADING_NUM_RE = /^\s*(?:\d+(?:\.\d+)*[、．.)]\s?|[一二三四五六七八九十百]+[、．.]|第[一二三四五六七八九十百\d]+[章节篇]|\([一二三四五六七八九十\d]+\)|[IVX]+[.、])\s*/;

// 章节编号：mode 为 auto（默认，识别到已有编号则不动）/ force（强制编号）/ none（不动）
function numberHeadings(html, mode) {
  if (mode === 'none') return html;
  const re = /<h([2-6])([^>]*)>([\s\S]*?)<\/h\1>/g;
  const all = [...html.matchAll(re)];
  if (!all.length) return html;
  if (mode !== 'force' && all.some(m => HEADING_NUM_RE.test(stripTags(m[3])))) return html;
  const counters = [0, 0, 0, 0, 0];
  return html.replace(re, (m, level, attrs, inner) => {
    const lvl = parseInt(level, 10) - 2;
    counters[lvl]++;
    for (let k = lvl + 1; k < 5; k++) counters[k] = 0;
    const num = counters.slice(0, lvl + 1).join('.');
    return '<h' + level + attrs + '>' + num + ' ' + inner.replace(HEADING_NUM_RE, '') + '</h' + level + '>';
  });
}

/* ---------------- 脚注与参考文献 ---------------- */

// 解析 markdown 脚注：[^id]: 定义（后续缩进行为内容）与正文 [^id] 引用
function parseFootnotes(body) {
  const footnotes = [];
  const lines = body.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\[\^([^\]]+)\]:[ \t]*(.*)$/.exec(lines[i]);
    if (!m) { out.push(lines[i]); continue; }
    const id = m[1];
    let content = m[2];
    while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1])) {
      content += '\n' + lines[i + 1].trim();
      i++;
    }
    footnotes.push({ id, content });
  }
  return { body: out.join('\n'), footnotes };
}

// 脚注内容是否为 BibTeX（@type{...}）
function isBibTeX(content) {
  return /^\s*@[A-Za-z]+\s*\{/.test(content);
}

// 解析 BibTeX 条目（支持嵌套花括号、双引号与无引号数值）
function parseBibTeX(content) {
  const t = content.trim();
  const m = /^@([A-Za-z]+)\s*\{\s*([^,]*),\s*([\s\S]*)\}\s*$/.exec(t);
  if (!m) return null;
  const type = m[1].toLowerCase();
  const key = m[2].trim();
  const body = m[3];
  const fields = {};
  let i = 0;
  const n = body.length;
  while (i < n) {
    while (i < n && /[\s,]/.test(body[i])) i++;
    const nm = /^[A-Za-z][A-Za-z0-9_-]*/.exec(body.slice(i));
    if (!nm) break;
    const name = nm[0].toLowerCase();
    i += nm[0].length;
    while (i < n && /\s/.test(body[i])) i++;
    if (body[i] !== '=') break;
    i++;
    while (i < n && /\s/.test(body[i])) i++;
    let value = '';
    if (body[i] === '{') {
      let depth = 0, j = i;
      while (j < n) {
        if (body[j] === '{') depth++;
        else if (body[j] === '}') { depth--; if (depth === 0) { j++; break; } }
        j++;
      }
      value = body.slice(i + 1, j - 1);
      i = j;
    } else if (body[i] === '"') {
      const j = body.indexOf('"', i + 1);
      if (j < 0) break;
      value = body.slice(i + 1, j);
      i = j + 1;
    } else {
      const vm = /^[^,\s}]+/.exec(body.slice(i));
      value = vm ? vm[0] : '';
      i += value.length;
    }
    fields[name] = value.trim();
  }
  return { type, key, fields };
}

// 单个作者 → GB/T 7714 姓名格式（中文照写，西文「姓 名缩写.」）
function formatOneAuthor(a) {
  const name = a.trim();
  if (!name) return '';
  if (/[\u4e00-\u9fa5]/.test(name)) return name;
  const initials = g => g.split(/\s+/).map(w => (w[0] ? w[0].toUpperCase() + '.' : '')).join('');
  if (name.includes(',')) {
    const parts = name.split(',').map(s => s.trim());
    return parts[1] ? parts[0].toUpperCase() + ' ' + initials(parts[1]) : parts[0].toUpperCase();
  }
  const words = name.split(/\s+/);
  const last = words.pop();
  return last.toUpperCase() + ' ' + initials(words.join(' '));
}

// 作者列表 → GB/T 7714（≤3 全列，>3 前 3 + 等/et al.）
function formatAuthors(authorStr) {
  if (!authorStr) return '';
  const authors = authorStr.split(/\s+and\s+/i).map(s => s.trim()).filter(Boolean);
  if (!authors.length) return '';
  const isCjk = /[\u4e00-\u9fa5]/.test(authors[0]);
  if (authors.length <= 3) return authors.map(formatOneAuthor).join(', ');
  return authors.slice(0, 3).map(formatOneAuthor).join(', ') + (isCjk ? ', 等' : ', et al.');
}

// BibTeX 条目 → GB/T 7714-2025 著录字符串
function formatGB7714(entry) {
  const f = entry.fields;
  const authors = formatAuthors(f.author);
  // 作者与题名之间用「. 」分隔：西文末位缩写已带句点则只留空格，中文作者需补句点
  const ap = authors ? (authors.endsWith('.') ? authors + ' ' : authors + '. ') : '';
  const title = f.title || '';
  const year = f.year || '';
  switch (entry.type) {
    case 'article': {
      const vol = f.volume || '';
      const num = f.number || '';
      const volIssue = vol ? (num ? vol + '(' + num + ')' : vol) : (num ? '(' + num + ')' : '');
      const pages = f.pages ? ': ' + f.pages : '';
      let s = ap + title + '[J]. ' + (f.journal || '') + ', ' + year + (volIssue ? ', ' + volIssue : '') + pages;
      if (f.doi) s += '. DOI: ' + f.doi;
      s += '.';
      return s;
    }
    case 'inproceedings':
    case 'conference': {
      const pages = f.pages ? ': ' + f.pages : '';
      return ap + title + '[C]//' + (f.booktitle || '') + '. ' + (f.address || '') + ', ' + year + pages + '.';
    }
    case 'phdthesis':
    case 'mastersthesis': {
      return ap + title + '[D]. ' + (f.address || '') + ': ' + (f.school || '') + ', ' + year + '.';
    }
    case 'book': {
      let s = ap + title + '[M]. ';
      if (f.edition) s += f.edition + '. ';
      const pub = f.address && f.publisher ? f.address + ': ' + f.publisher : (f.address || f.publisher || '');
      s += pub + (pub ? ', ' : '') + year + '.';
      return s;
    }
    case 'techreport': {
      return ap + title + '[R]. ' + (f.institution || '') + ', ' + year + '.';
    }
    default: {
      let s = ap + title + '[EB/OL]. ';
      if (f.urldate) s += '(' + f.urldate + ')';
      if (f.url) s += f.url;
      s += '.';
      return s;
    }
  }
}

// 渲染脚注列表；bibliography=true 时作为「参考文献」章节
function renderFootnotes(footnotes, bibliography, marked) {
  if (!footnotes.length) return '';
  const items = footnotes.map((fn, i) => {
    const num = i + 1;
    let content;
    if (isBibTeX(fn.content)) {
      const entry = parseBibTeX(fn.content);
      content = entry ? esc(formatGB7714(entry)) : esc(fn.content);
    } else {
      content = marked.parseInline(fn.content, { gfm: true });
    }
    return '<li id="fn-' + num + '"><a href="#fnref-' + num + '" class="fnref-back">[' + num + ']</a> ' + content + '</li>';
  }).join('\n');
  const cls = bibliography ? 'references' : 'footnotes';
  const list = '<ol class="' + cls + '">\n' + items + '\n</ol>';
  return '<h2>' + (bibliography ? '参考文献' : '脚注') + '</h2>\n' + list;
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
    // MathJax 排版：正文含公式时，轮询等待 typeset 完成再打印（否则公式是空白）
    if (opts.waitMath) {
      const t0 = Date.now();
      while (Date.now() - t0 < 10000) {
        let done = false;
        try {
          const r = await this.send('Runtime.evaluate', { expression: 'window.__md2pdfMathReady === true', returnByValue: true });
          done = !!(r && r.result && r.result.value);
        } catch { /* 忽略运行时异常，继续等待 */ }
        if (done) break;
        await new Promise(r => setTimeout(r, 100));
      }
    }
    const base = {
      printBackground: true,
      preferCSSPageSize: true,
      landscape: !!opts.landscape,
      displayHeaderFooter: !!opts.footer,
      headerTemplate: '<span></span>',
      footerTemplate: opts.footerTemplate || '<span></span>',
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    };
    // PDF 书签：Chrome 按 h1–h6 结构写成 /Outlines 树，阅读器侧边栏可点击跳转。
    // 老版本 Chrome 不认这个参数，出错就退回不带书签的渲染（页脚页码仍保留）。
    let res;
    if (opts.outline) {
      res = await this.send('Page.printToPDF', { ...base, generateDocumentOutline: true });
      if (res.error) res = await this.send('Page.printToPDF', base);
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

/* ---------------- 渲染 ---------------- */

async function renderOne(mdPath, opts, chrome, marked, hljs, tmpRoot) {
  const src = await readFile(mdPath, 'utf8');
  const { fm, body: rawBody } = splitFrontmatter(src);
  const isSkill = path.basename(mdPath) === 'SKILL.md' || !!fm.name;

  // 数学公式：检测 $...$ 或 $...$，命中则注入 MathJax（SVG 输出，零字体依赖）
  const hasMath = /\$\$|\$[^$\n]+\$/.test(rawBody);

  // 脚注：提取 [^id]: 定义，正文 [^id] 引用替换为编号上标
  const { body, footnotes } = parseFootnotes(rawBody);
  // 编号按正文「首次引用顺序」自动排序（类 LaTeX）；md 里的定义顺序保持不变
  const defIds = new Set(footnotes.map(fn => fn.id));
  const fnIndex = new Map();
  const fnRefCount = new Map();
  const bodyWithRefs = body.replace(/\[\^([^\]]+)\]/g, (m, id) => {
    if (!defIds.has(id)) return m;
    if (!fnIndex.has(id)) fnIndex.set(id, fnIndex.size + 1);
    const n = fnIndex.get(id);
    const c = (fnRefCount.get(id) || 0) + 1;
    fnRefCount.set(id, c);
    const refId = c === 1 ? 'fnref-' + n : 'fnref-' + n + '-' + c;
    return '<sup class="fnref" id="' + refId + '"><a href="#fn-' + n + '">[' + n + ']</a></sup>';
  });
  // 未被正文引用的脚注：按定义顺序补到末尾
  footnotes.forEach(fn => { if (!fnIndex.has(fn.id)) fnIndex.set(fn.id, fnIndex.size + 1); });
  const orderedFootnotes = footnotes.slice().sort((a, b) => fnIndex.get(a.id) - fnIndex.get(b.id));

  // 保护数学公式与图表引用：markdown 的转义处理会破坏 \, \\ 与 \ref（多行公式塌行、引用失效）
  const mathStore = [];
  const refStore = [];
  const bodyProtected = bodyWithRefs
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, (m) => {
      const i = mathStore.length;
      mathStore.push(m);
      return '\u0001MATH' + i + '\u0001';
    })
    .replace(/\\ref\{([\w:.-]+)\}/g, (m, label) => {
      const i = refStore.length;
      refStore.push(label);
      return '\u0002REF' + i + '\u0002';
    });

  let html = marked.parse(bodyProtected, { gfm: true, breaks: false, async: false });

  // 图/表自动编号与题注（收集标签）
  const floats = numberFloats(html);
  html = floats.html;

  // 还原 \ref{} 为对应编号
  html = html.replace(/\u0002REF(\d+)\u0002/g, (m, i) => {
    const info = floats.refs.get(refStore[+i]);
    return info ? '<a href="#' + info.id + '" class="ref">' + info.num + '</a>' : '?';
  });

  // 还原数学公式（原样交回 MathJax 渲染）
  html = html.replace(/\u0001MATH(\d+)\u0001/g, (m, i) => mathStore[+i] ?? m);

  // 代码高亮：对带语言标记的代码块做 highlight.js 着色
  html = highlightCode(html, hljs);

  // 脚注/参考文献：先追加到正文末尾，再编号，使参考文献章节纳入编号体系
  html += renderFootnotes(orderedFootnotes, opts.bibliography, marked);

  // 章节编号：H2 起编号，H1 作为文档标题不动
  html = numberHeadings(html, opts.numbering);

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
  html = html.replace(/<a\s+href="([^"]*)"([^>]*)>/g, (m, href, rest) => {
    const cls = /\sclass=/.test(rest) ? '' : ' class="ref"';
    return `<a href="${href}"${cls}${rest}>`;
  });
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

  // 章节锚点：给二级标题补 id，供目录内链与（Chrome 生成的）PDF 书签定位
  const secIds = [];
  html = html.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/g, (m, attrs = '', inner = '') => {
    const has = /\sid="/.test(attrs);
    if (has) {
      secIds.push({ id: /\sid="([^"]+)"/.exec(attrs)[1], text: stripTags(inner) });
      return m;
    }
    const id = `sec-${secIds.length + 1}`;
    secIds.push({ id, text: stripTags(inner) });
    return `<h2${attrs} id="${id}">${inner}</h2>`;
  });

  // 目录：文首一张可点击的目录页（仅当二级标题多于一个才值得排）
  let toc = '';
  if (opts.toc && secIds.length > 1) {
    toc = `<div class="toc"><div class="toc-title">目 录</div><ol>` +
      secIds.map(s => `<li><a href="#${s.id}">${esc(s.text)}</a></li>`).join('') + `</ol></div>`;
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

  const mathUrl = pathToFileURL(path.join(ROOT, 'vendor', 'mathjax', 'tex-svg.js')).href;
  const mathScript = hasMath ? [
    '<script>',
    'window.__md2pdfMathReady = false;',
    'window.MathJax = {',
    '  tex: { inlineMath: [["$", "$"]], tags: "all" },',
    '  svg: { fontCache: "none" },',
    '  startup: {',
    '    ready: function () {',
    '      MathJax.startup.defaultReady();',
    '      MathJax.startup.promise.then(function () { window.__md2pdfMathReady = true; });',
    '    }',
    '  }',
    '};',
    '</script>',
    '<script src="' + mathUrl + '" id="MathJax-script"></script>',
  ].join('\n') : '';

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
    '{{MATHJAX}}': mathScript,
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

  const buf = await chrome.print(htmlPath, { footer: opts.footer, footerTemplate, landscape: opts.landscape, outline: opts.outline, waitMath: hasMath });

  if (opts.keepHtml) {
    await writeFile(mdPath.replace(/\.md$/i, '.html'), out, 'utf8');
  } else {
    await rm(tmpDir, { recursive: true, force: true });
  }
  return { title, buf };
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
  if (!opts.inputs.length) { console.log(HELP); process.exitCode = 1; return; }

  const { Marked } = await import(pathToFileURL(path.join(ROOT, 'vendor', 'marked.esm.js')).href);
  const marked = new Marked({ gfm: true });
  const require = createRequire(import.meta.url);
  const hljs = require(path.join(ROOT, 'vendor', 'highlight', 'highlight.cjs'));

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
        const res = await renderOne(mdPath, opts, chrome, marked, hljs, tmpRoot);
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
