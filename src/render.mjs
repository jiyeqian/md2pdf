import { prepareGbContent, transformGbContent } from './gb-content.mjs';
import { finalizeGbLayout, prepareGbLayout } from './gb-layout.mjs';
import { finalizeGbIndexLayout } from './gb-index-layout.mjs';
import { finalizeGbTableRules } from './gb-table-rules.mjs';
import { prepareGbBodyLayout, finalizeGbBodyLayout } from './gb-body-layout.mjs';
import { prepareGbBodyAudit, finalizeGbBodyAudit } from './gb-body-audit.mjs';
import { applyGbEquations, finalizeGbEquations, GB_EQUATION_CSS } from './gb-equations.mjs';
import { prepareGbFootnotes } from './gb-footnotes.mjs';
import { installPagedLayout } from './paged-layout.mjs';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { paperAuthorsHtml } from './paper-authors.mjs';
import { detectProfile } from './profiles.mjs';
import { resolveNumberScheme } from './numbering.mjs';
import { parseFrontmatter, resolveDocumentOptions } from './config.mjs';
import { stampPagedLists, finalizePagedCounters } from './paged-counters.mjs';
// 对外仍导出 defaultOptions（运行选项的空壳），方便旧调用方继续引用。
export { defaultOptions } from './options.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Web 落款占位文件名（document.md）指向的官方仓库。预览点击时按同一常量精确校验 href。
export const REPO_URL = 'https://github.com/jiyeqian/md2pdf';
const ASSETS = path.join(ROOT, 'assets');
const THEMES = path.join(ASSETS, 'themes');
const listThemes = () => readdirSync(THEMES).filter(f => /\.css$/.test(f)).map(f => f.replace(/\.css$/, '')).sort();
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripTags = s => String(s).replace(/<[^>]+>/g, '').trim();
// 给标签属性串追加 class（属性串可能已有 class="…"，也可能为空）
const addClass = (attrs, cls) => /\sclass="/.test(attrs)
  ? attrs.replace(/\sclass="([^"]*)"/, (m, c) => ` class="${c} ${cls}"`)
  : `${attrs} class="${cls}"`;

// 文末落款右侧：本次渲染的生成时间（本机时区，带 ±HH:mm 偏移；整篇只取一次）。
function formatStamp(d) {
  const p = n => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = p(Math.floor(Math.abs(off) / 60));
  const mm = p(Math.abs(off) % 60);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${sign}${hh}:${mm}`;
}

// 导语识别：取正文里第一个「顶层普通段落」。用标签栈扫描，而不是正则硬抓 <p>，
// 以免把 blockquote / 列表项里的段落误当导语。
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// 出现在这些容器内部的 <p> 不算顶层（含引用块、列表项、表格单元等）。
const LEAD_CONTAINERS = new Set(['blockquote', 'li', 'td', 'th', 'figure', 'figcaption', 'div', 'section', 'table', 'thead', 'tbody', 'tr', 'ul', 'ol', 'pre', 'main', 'article', 'aside', 'details', 'summary', 'nav', 'header', 'footer', 'p']);
function isOrdinaryParagraph(inner) {
  const raw = inner.trim();
  if (!raw) return false;
  if (/^\$\$[\s\S]*\$\$$/.test(raw)) return false;          // 块级公式段
  if (/^\$[^$]+\$$/.test(raw)) return false;                    // 纯行内公式段
  if (/^<img\b[^>]*>\s*$/.test(raw)) return false;              // 仅图片段
  if (!stripTags(raw).trim()) return false;                      // 只剩标签（如仅图标）
  return true;
}
function extractLead(html) {
  const tagRe = /<\/?([a-zA-Z][\w-]*)(?:\s[^>]*?)?\/?>/g;
  const stack = [];
  let m;
  while ((m = tagRe.exec(html))) {
    const name = m[1].toLowerCase();
    if (html[m.index + 1] === '/') {                 // 闭合标签：弹出到匹配处
      const at = stack.lastIndexOf(name);
      if (at >= 0) stack.length = at;
      continue;
    }
    const selfClose = /\/>$/.test(m[0]) || VOID_TAGS.has(name);
    if (name === 'p') {
      const end = html.indexOf('</p>', tagRe.lastIndex);
      const inner = end < 0 ? html.slice(tagRe.lastIndex) : html.slice(tagRe.lastIndex, end);
      const topLevel = !stack.some(t => LEAD_CONTAINERS.has(t));
      if (topLevel && isOrdinaryParagraph(inner)) {
        const full = end < 0 ? html.slice(m.index) : html.slice(m.index, end + 4);
        return { lead: inner, html: html.slice(0, m.index) + html.slice(m.index + full.length) };
      }
      if (end >= 0) tagRe.lastIndex = end + 4;       // 跳过整段，继续找下一个顶层段
      continue;
    }
    if (!selfClose) stack.push(name);
  }
  return null;
}

export function splitFrontmatter(src) {
  // 兼容旧调用方：对外只暴露 { fm, body }；配置解析与校验统一交给 config.parseFrontmatter。
  const { fm, body } = parseFrontmatter(src);
  return { fm, body };
}

// frontmatter 值统一成字符串（数组以顿号连接），供渲染/meta 使用
const fmStr = (v) => Array.isArray(v) ? v.join('、') : (v == null ? '' : String(v));

function buildMeta(fm, skillMeta) {
  if (!fm.name && !fm.description) return '';
  const items = [];
  if (fm.name) {
    items.push([skillMeta ? 'SKILL NAME' : 'NAME', `<code>${esc(fm.name)}</code>`]);
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

function numberFloats(html, gb = false) {
  const sequence = new Map();
  const floatNumber = (kind, offset, source, fallback) => {
    if (!gb) return fallback;
    const heading = [...source.slice(0, offset).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].at(-1);
    const appendix = heading && /^附录\s*([A-Z])/i.exec(stripTags(heading[1]));
    const prefix = appendix?.[1].toUpperCase() || '';
    const key = kind + prefix, n = (sequence.get(key) || 0) + 1;
    sequence.set(key, n);
    return prefix ? prefix + '.' + n : n;
  };
  const refs = new Map();
  let figN = 0, tabN = 0;

  // 图：(a) 图片/SVG（alt 里带 {#fig:x}）或 (b) 「图：题注」+ mermaid 代码块；统一编号
  const figRe = /(<p>\s*<img\b[^>]*>\s*<\/p>)|(<p>\s*图\s*[：:]\s*[\s\S]*?<\/p>\s*<pre><code class="language-mermaid">[\s\S]*?<\/code><\/pre>)/g;
  html = html.replace(figRe, (m, image, diagram, offset, source) => {
    let caption = '', label = '', body = '';
    if (m.indexOf('<img') >= 0) {
      let tag = /<img\b[^>]*>/.exec(m)[0];
      const altM = /\balt="([^"]*)"/.exec(tag);
      caption = altM ? altM[1] : '';
      const labM = /\s*\{#(fig:[\w.-]+)\}\s*/.exec(caption);
      if (labM) {
        label = labM[1];
        caption = caption.replace(labM[0], ' ').replace(/\s+/g, ' ').trim();
        tag = tag.replace(/\balt="[^"]*"/, 'alt="' + caption + '"');
      }
      body = tag;
    } else {
      const capM = /<p>\s*图\s*[：:]\s*([\s\S]*?)<\/p>/.exec(m);
      caption = capM ? capM[1] : '';
      const labM = /\s*\{#(fig:[\w.-]+)\}\s*/.exec(caption);
      if (labM) { label = labM[1]; caption = caption.replace(labM[0], ' ').trim(); }
      const codeM = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/.exec(m);
      body = '<pre class="mermaid">' + (codeM ? codeM[1] : '') + '</pre>';
    }
    figN++;
    const display = floatNumber('fig', offset, source, figN);
    if (label) refs.set(label, { num: display, id: 'fig-' + figN });
    return '<figure class="fig" id="fig-' + figN + '">' + body +
      '<figcaption>图 ' + display + (gb ? '　' : '：') + caption + '</figcaption></figure>';
  });

  html = html.replace(/<p>\s*表\s*[：:]\s*([\s\S]*?)<\/p>\s*<table>/g, (m, cap, offset, source) => {
    let label = '';
    const labM = /\s*\{#(tab:[\w.-]+)\}\s*/.exec(cap);
    if (labM) { label = labM[1]; cap = cap.replace(labM[0], ' ').trim(); }
    tabN++;
    const display = floatNumber('tab', offset, source, tabN);
    if (label) refs.set(label, { num: display, id: 'tab-' + tabN });
    return '<table class="tbl" id="tab-' + tabN + '">\n<caption>表 ' + display + (gb ? '　' : '：') + cap + '</caption>';
  });

  return { html, refs };
}

/* ---------------- 章节编号 ---------------- */

// 标题编号前缀识别（阿拉伯/中文/罗马数字、第X章、括号编号等）
const HEADING_NUM_RE = /^\s*(?:\d+(?:\.\d+)*[、．.)]\s?|[一二三四五六七八九十百]+[、．.]|第[一二三四五六七八九十百\d]+[章节篇]|\([一二三四五六七八九十\d]+\)|[IVX]+[.、])\s*/;

// 章节编号：mode 为 auto（默认，识别到已有编号则不动）/ force（强制编号）/ none（不动）
function numberHeadings(html, mode, scheme) {
  if (mode === 'none') return html;
  const re = /<h([2-6])([^>]*)>([\s\S]*?)<\/h\1>/g;
  const all = [...html.matchAll(re)];
  if (!all.length) return html;
  if (mode !== 'force' && all.some(m => HEADING_NUM_RE.test(stripTags(m[3])))) return html;
  const raw = resolveNumberScheme(scheme || 'arabic');
  // scheme 既可为函数，也可为 { skip, fmt } 对象（GB 需要 skip 与有状态 fmt）
  const skipFn = typeof raw === 'function' ? null : raw.skip;
  const fmt = typeof raw === 'function' ? raw : raw.fmt;
  // 对象型 scheme（gb）额外产出语义 class，供主题做版式（命名页 / 前置部分）。
  // 其他 scheme 输出与旧版逐字节一致，避免回归。
  const isGb = typeof raw !== 'function';
  const counters = [0, 0, 0, 0, 0];
  const state = {};   // 单次渲染的可变状态（如 GB 的当前附录字母）
  let markedBodyStart = false;
  return html.replace(re, (m, level, attrs, inner) => {
    const lvl = parseInt(level, 10) - 2;
    const text = stripTags(inner);
    const clean = inner.replace(HEADING_NUM_RE, '');
    // 跳过：不编号、且不占号（如 GB 的前言/引言/目次/参考文献）
    if (skipFn && skipFn(text)) {
      if (!isGb) return '<h' + level + attrs + '>' + clean + '</h' + level + '>';
      // 前言/引言属「前置部分」（罗马页码、各自起新页）；参考文献只在版式上独立起页
      const cls = /^(前言|引言)\s*$/.test(text.trim()) ? 'front' : 'back';
      return '<h' + level + addClass(attrs, 'unnumbered ' + cls) + '>' + clean + '</h' + level + '>';
    }
    counters[lvl]++;
    for (let k = lvl + 1; k < 5; k++) counters[k] = 0;
    const num = fmt({ counters, lvl, text, state });
    let extra = '';
    if (isGb) {
      if (num == null && /^附录/.test(text.trim())) extra = 'appendix';
      // 正文（阿拉伯页码）从第一个带号的章开始，页码计数器在此归零
      else if (num != null && !markedBodyStart && lvl === 0) { extra = 'body-start'; markedBodyStart = true; }
    }
    const outAttrs = extra ? addClass(attrs, extra) : attrs;
    return '<h' + level + outAttrs + '>' + (num == null ? clean : (isGb ? num.replace(/ $/, '　') : num) + clean) + '</h' + level + '>';
  });
}

/* ---------------- 脚注与参考文献 ---------------- */

// 解析 markdown 脚注：[^id]: 定义（后续缩进行为内容）与正文 [^id] 引用
function parseFootnotes(body, gb = false) {
  const footnotes = [];
  const lines = body.split('\n');
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const boundary = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (gb && boundary) {
      if (!fence) fence = boundary[1];
      else if (boundary[1][0] === fence[0] && boundary[1].length >= fence.length) fence = null;
      out.push(lines[i]); continue;
    }
    if (gb && fence) { out.push(lines[i]); continue; }
    const m = /^\[\^([^\]]+)\]:[ \t]*(.*)$/.exec(lines[i]);
    if (!m || (gb && m[1].startsWith('@'))) { out.push(lines[i]); continue; }
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
        if (body[j] === '\\') { j += 2; continue; }
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
    fields[name] = value.trim().replace(/\\([&%#_{}])/g, '$1');
  }
  return { type, key, fields };
}

// 单个作者 → GB/T 7714 姓名格式（中文照写，西文「姓 名缩写.」）
function formatOneAuthor(a) {
  const name = a.trim();
  if (!name) return '';
  if (name.startsWith('{') && name.endsWith('}')) return name.slice(1, -1);
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
  const withDoi = text => f.doi ? text.replace(/\.$/, '') + '. DOI: ' + f.doi + '.' : text;
  switch (entry.type) {
    case 'article': {
      const vol = f.volume || '';
      const num = f.number || '';
      const volIssue = vol ? (num ? vol + '(' + num + ')' : vol) : (num ? '(' + num + ')' : '');
      const pages = f.pages ? ': ' + f.pages : '';
      let s = ap + title + '[J]. ' + (f.journal || '') + ', ' + year + (volIssue ? ', ' + volIssue : '') + pages;
      s += '.';
      return withDoi(s);
    }
    case 'inproceedings':
    case 'conference': {
      const pages = f.pages ? ': ' + f.pages : '';
      const publisher = f.address && f.publisher ? f.address + ': ' + f.publisher : (f.address || f.publisher || '');
      return withDoi(ap + title + '[C]//' + (f.booktitle || '') + '. ' + [publisher, year].filter(Boolean).join(', ') + pages + '.');
    }
    case 'phdthesis':
    case 'mastersthesis': {
      return withDoi(ap + title + '[D]. ' + (f.address || '') + ': ' + (f.school || '') + ', ' + year + '.');
    }
    case 'book': {
      let s = ap + title + '[M]. ';
      if (f.edition) s += f.edition + '. ';
      const pub = f.address && f.publisher ? f.address + ': ' + f.publisher : (f.address || f.publisher || '');
      s += pub + (pub ? ', ' : '') + year + '.';
      return withDoi(s);
    }
    case 'techreport': {
      return withDoi(ap + title + '[R]. ' + (f.institution || '') + ', ' + year + '.');
    }
    default: {
      let s = ap + title + '[EB/OL]. ';
      if (f.urldate) s += '(' + f.urldate + ')';
      if (f.url) s += f.url;
      s += '.';
      return withDoi(s);
    }
  }
}

// 渲染脚注列表，统一作为「参考文献」章节；title 为空串时只去标题、保留条目与链接。
function renderFootnotes(footnotes, title, marked, gb = false) {
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
    return '<li id="fn-' + num + '"><a href="#fnref-' + num + '" class="fnref-back">[' + num + ']</a>' + (gb ? '　' : ' ') + content + '</li>';
  }).join('\n');
  const list = '<ol class="references">\n' + items + '\n</ol>';
  return (title ? '<h2>' + title + '</h2>\n' : '') + list;
}

/* ---------------- Chrome ---------------- */

// CSS 字符串字面量转义（标准号里可能有引号）
const cssString = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\3c ') + '"';

// GB 页眉：命名页 gb-front / gb-body 的 margin box 里放标准号，
// 奇数页（:right）靠右、偶数页（:left）靠左。空标准号则不生成（页面无页眉）。
function gbHeaderCss(stdno) {
  if (!stdno) return '';
  const t = cssString(stdno);
  const tr = '@top-right { content: ' + t + '; }';
  const tl = '@top-left { content: ' + t + '; }';
  const trNone = '@top-right { content: none; }';
  return [
    // 奇数页（右页）：标准号靠右
    '@page gb-front { ' + tr + ' }',
    '@page gb-body { ' + tr + ' }',
    // 偶数页（左页）：标准号靠左
    '@page gb-front:left { ' + trNone + ' ' + tl + ' }',
    '@page gb-body:left { ' + trNone + ' ' + tl + ' }',
  ].join('\n');
}

// GB 封面（仅 gb profile）：标准号 / 中英文名称 / ICS·CCS / 发布·实施日期 / 发布机构
// 尺寸与字号见 GB/T 1.1—2020 图 E.5、表 F.1；封面专用字仍须发布部门确认。
function buildCover(fm, title, useDefaults = true, bannerSvg = '', issuerAssets = {groups:[]}) {
  const stdno = fm['标准号'] || fm.standard || '';
  const cn = fm['中文名称'] || (useDefaults ? (title || fm.title || '') : '');
  const en = fm['英文名称'] || fm.title_en || '';
  // 采标信息：仿官方封面排在英文名称下方，格式 (国际标准号, 采标英文名称, 程度)。
  // 数据一致性：括号内全部取 frontmatter 原值、原样显示；如需封面用拉丁码（IDT/MOD/NEQ），
  // frontmatter 的 采标程度 直接存码 —— 不做任何存储值到显示值的转换。
  const iso = fmStr(fm['采标国际标准']);
  const isoEn = fmStr(fm['采标英文名称']);
  const isoCn = fmStr(fm['采标中文名称']);
  const isoDeg = fmStr(fm['采标程度']);
  const isoHtml = iso
    ? '<div class="cover-iso">(' + esc(iso) +
      (isoEn ? ', ' + esc(isoEn) : '') +
      (isoDeg ? ', ' + esc(isoDeg) : '') + ')</div>'
    : '';
  const ics = fmStr(fm['国际标准分类号'] || fm.ICS || fm.ics);
  const ccs = fmStr(fm['中国标准分类号'] || fm.CCS || fm.ccs);
  const issued = fm['发布日期'] || fm.date || '';
  const impl = fm['实施日期'] || '';
  const sup = fmStr(fm['全部代替标准'] || fm['代替标准']);
  // 机构两行 + 居间「发布」；发布机构可覆盖第一行
  // 发布单位：封面机构块各行（数组或标量）；旧键 发布机构/发布机构2 仍兼容
  const orgSrc = fm['发布单位'] ?? fm['发布机构'];
  const orgs = Array.isArray(orgSrc) ? orgSrc : (orgSrc ? [fmStr(orgSrc)] : []);
  const orgA = orgs[0] || (useDefaults ? '国家市场监督管理总局' : '');
  const orgB = orgs[1] || fm['发布机构2'] || (useDefaults && !orgSrc ? '国家标准化管理委员会' : '');
  const normalizedIssuers = [orgA,orgB].map(name => String(name).trim().replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu,''));
  const issuerProfile = issuerAssets.groups.find(group => group.names.every((name,index) => name === normalizedIssuers[index]));
  const issuerRow = (name,index) => {
    if (!issuerProfile) return '<div class="cover-org-name">'+esc(name)+'</div>';
    const row = issuerProfile.rows[index];
    return '<div class="cover-org-name cover-org-vector" role="img" aria-label="'+esc(row.name)+'" style="width:'+(row.inkBoundsMm.x+row.inkBoundsMm.width)+'mm">'+row.svg+
      '<span class="gb-issuer-text" aria-hidden="true">'+esc(row.name)+'</span></div>';
  };
  // 「中华人民共和国国家标准」按字均分撑满两边距，短语间留一个双倍空位
  const bannerText = fm['文件类别'] || (useDefaults ? '中华人民共和国国家标准' : '');
  const fixedBanner = bannerText === '中华人民共和国国家标准';
  const head = fixedBanner ? bannerSvg + '<span class="gb-cover-banner-text" aria-hidden="true">' + bannerText + '</span>'
    : bannerText.split('').map(c => '<span>' + esc(c) + '</span>').join('<i class="cover-head-gap"></i>');
  const icsHtml = (ics || ccs)
    ? '<div class="cover-ics">' + (ics ? 'ICS ' + esc(ics) : '') + (ccs ? '<br>CCS ' + esc(ccs) : '') + '</div>'
    : '';
  const datesHtml = (issued || impl)
    ? '<div class="cover-dates">' +
      (issued ? '<span>' + esc(issued) + ' 发布</span>' : '<span></span>') +
      (impl ? '<span>' + esc(impl) + ' 实施</span>' : '<span></span>') +
      '</div>'
    : '';
  const coverNumber = value => esc(value).replace(/\b(GB(?:\/[TZ])?)\s+(?=\d)/g, '$1<span class="gb-number-gap"> </span>');
  const supHtml = sup ? '<div class="cover-sup">代替 ' + coverNumber(sup) + '</div>' : '';
  const logoUrl = pathToFileURL(path.join(ASSETS, 'gb-logo.svg')).href;
  return [
    '<section class="cover">',
    icsHtml,
    '<img class="cover-logo" src="' + logoUrl + '" alt="GB">',
    '  <div class="cover-head' + (fixedBanner ? ' cover-head-vector' : '') + '"' + (fixedBanner ? ' role="img" aria-label="中华人民共和国国家标准"' : '') + '>' + head + '</div>',
    '  <div class="cover-numbers"><div class="cover-stdno">' + coverNumber(stdno) + '</div>' + supHtml + '</div>',
    '  <div class="cover-rule"></div>',
    '  <div class="cover-main"><div class="cover-cn">' + esc(cn) + '</div>' +
      (en ? '<div class="cover-en">' + esc(en) + '</div>' : '') +
      isoHtml + '</div>',
    '  <div class="cover-foot">',
    datesHtml,
    (datesHtml ? '<div class="cover-date-rule"></div>' : ''),
    '  <div class="cover-org"><div class="cover-org-names">' + issuerRow(orgA,0) + issuerRow(orgB,1) + '</div>' +
      ((orgA || orgB) ? '<div class="cover-org-pub"><span>发</span><span>布</span></div>' : '') + '</div>',
    '  </div>',
    '</section>',
  ].filter(Boolean).join('\n');
}

export async function render(src, options = {}, context = {}) {
  const throwIfAborted = () => context.signal?.throwIfAborted();
  throwIfAborted();
  const mdPath = context.filename || 'document.md';
  const { Marked } = await import(pathToFileURL(path.join(ROOT, 'vendor', 'marked.esm.js')).href);
  throwIfAborted();
  const marked = new Marked({ gfm: true });
  const require = createRequire(import.meta.url);
  const hljs = require(path.join(ROOT, 'vendor', 'highlight', 'highlight.cjs'));
  marked.use({
    extensions: [{
      name: 'md2pdfPagebreak', level: 'block',
      start(src) {
        const match = /(?:^|\n) {0,3}<!-- pagebreak -->[ \t]*(?=\n|$)/.exec(src);
        return match ? match.index + (match[0].startsWith('\n') ? 1 : 0) : undefined;
      },
      tokenizer(src) {
        const match = /^ {0,3}<!-- pagebreak -->[ \t]*(?:\n|$)/.exec(src);
        if (match) return { type: 'md2pdfPagebreak', raw: match[0] };
      },
      renderer() { return '<div class="md2pdf-pagebreak" aria-hidden="true"></div>\n'; },
    }],
    renderer: { html(token) { return context.webSafe ? esc(token.text) : token.text; } },
  });
  if (context.webSafe) marked.use({ renderer: {
    image(token) {
      const embedded = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(token.href);
      // Preserve figure labels while making unsupported resources visible to the author.
      const placeholder = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==';
      return `<img src="${embedded ? esc(token.href) : placeholder}" alt="${esc(token.text)}${embedded ? '' : '（图片未加载：不支持本机或远程资源）'}">`;
    },
    link(token) { const label = this.parser.parseInline(token.tokens); return /^(https?:|mailto:|#)/i.test(token.href) ? `<a href="${esc(token.href)}">${label}</a>` : label; },
  } });
  // 配置解析与校验统一走 config 模块：YAML 语法/重复键/类型冲突在此抛 ConfigError。
  const reusableParse = context.parsedFrontmatter?.source === src ? context.parsedFrontmatter.parsed : undefined;
  const { fm, body: rawBody, positions, warnings = [] } = reusableParse || parseFrontmatter(src);
  const profile = detectProfile({ basename: path.basename(mdPath), fm, explicit: options.type || fm.type });
  // 有效配置：explicit(CLI/Web) > FM > profile.defaults > 全局默认，统一由 config.resolveDocumentOptions 合并。
  const eff = resolveDocumentOptions(options, fm, profile, { ...context, positions });
  const effTheme = eff.theme ?? profile.defaults.theme ?? 'elegant';
  // GB 强制版式：国家标准不用导语，enable/disable 与 FM 都不能绕过。
  const effLead = profile.gbDoc ? false : (eff.lead ?? profile.defaults.lead ?? false);
  const effNumbering = eff.numbering ?? profile.defaults.numbering ?? 'auto';
  const effScheme = eff.numberScheme ?? profile.defaults.numberScheme ?? 'arabic';
  const useToc = eff.toc ?? profile.defaults.toc ?? false;
  // 页边距：explicit > FM > profile 默认 > 内置兜底（左右各自取值，gb 为左宽右窄）
  const effMarginTop = eff.marginTop ?? profile.defaults.marginTop ?? 20;
  const effMarginBottom = eff.marginBottom ?? profile.defaults.marginBottom ?? 18;
  const effMarginLeft = eff.marginLeft ?? profile.defaults.marginLeft
    ?? eff.marginSide ?? profile.defaults.marginSide ?? 18;
  const effMarginRight = eff.marginRight ?? profile.defaults.marginRight
    ?? eff.marginSide ?? profile.defaults.marginSide ?? 18;

  // 数学公式：检测 $...$ 或 $...$，命中则注入 MathJax（SVG 输出，零字体依赖）
  const hasMath = /\$\$|\$[^$\n]+\$/.test(rawBody);
  // Mermaid 图：检测 \`\`\`mermaid 代码块，命中则注入 Mermaid 浏览器端渲染
  const hasMermaid = /^[ \t]*\`\`\`mermaid\b/m.test(rawBody);

  // 脚注：提取 [^id]: 定义，正文 [^id] 引用替换为编号上标
  const gbNotes = profile.gbDoc ? prepareGbFootnotes(rawBody) : null;
  const { body, footnotes } = parseFootnotes(gbNotes ? gbNotes.body : rawBody, profile.gbDoc);
  // 编号按正文「首次引用顺序」自动排序（类 LaTeX）；md 里的定义顺序保持不变
  const defIds = new Set(footnotes.map(fn => fn.id));
  const fnIndex = new Map();
  const fnRefCount = new Map();
  const fnMarkup = [];
  const bodyWithRefs = body.replace(/\[\^([^\]]+)\]/g, (m, id) => {
    if (!defIds.has(id)) return m;
    if (!fnIndex.has(id)) fnIndex.set(id, fnIndex.size + 1);
    const n = fnIndex.get(id);
    const c = (fnRefCount.get(id) || 0) + 1;
    fnRefCount.set(id, c);
    const refId = c === 1 ? 'fnref-' + n : 'fnref-' + n + '-' + c;
    const markup = '<sup class="fnref" id="' + refId + '"><a href="#fn-' + n + '">[' + n + ']</a></sup>';
    if (!context.webSafe) return markup;
    fnMarkup.push(markup);
    return '\u0003FOOTNOTE' + (fnMarkup.length - 1) + '\u0003';
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

  if (gbNotes) marked.use({extensions:[gbNotes.extension]});
  const gbBlocks = profile.gbDoc ? prepareGbContent(bodyProtected) : null;
  let html = marked.parse(gbBlocks ? gbBlocks.body : bodyProtected, { gfm: true, breaks: false, async: false });
  if (gbBlocks) html = gbBlocks.restore(html, marked);

  if (context.webSafe) html = html.replace(/\u0003FOOTNOTE(\d+)\u0003/g, (m, i) => fnMarkup[+i] ?? m);

  // 图/表自动编号与题注（收集标签）
  const floats = eff.floatNumbering === false
    ? { html, refs: new Map() }
    : numberFloats(html, profile.gbDoc);
  html = floats.html;
  // The editor accepts ordinary Mermaid fences without requiring a CLI figure caption.
  if (context.webSafe) html = html.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, '<pre class="mermaid">$1</pre>');

  // 还原 \ref{} 为对应编号
  html = html.replace(/\u0002REF(\d+)\u0002/g, (m, i) => {
    const info = floats.refs.get(refStore[+i]);
    return info ? '<a href="#' + info.id + '" class="ref">' + info.num + '</a>' : '?';
  });

  // 还原数学公式（原样交回 MathJax 渲染）
  html = html.replace(/\u0001MATH(\d+)\u0001/g, (m, i) => context.webSafe ? esc(mathStore[+i] ?? m) : (mathStore[+i] ?? m));

  // 代码高亮：对带语言标记的代码块做 highlight.js 着色
  html = highlightCode(html, hljs);

  // 脚注/参考文献：先追加到正文末尾，再编号，使参考文献章节纳入编号体系。
  // bibliographyTitle 默认「参考文献」；显式空串时只去掉标题，条目与链接保留；无引用则不生成。
  const bibTitle = eff.bibliographyTitle !== undefined ? eff.bibliographyTitle : '参考文献';
  const referencesHtml = renderFootnotes(orderedFootnotes, bibTitle, marked, profile.gbDoc);
  const indexHeading = /<h2[^>]*>\s*索引\s*<\/h2>/;
  if (profile.gbDoc && indexHeading.test(html)) html = html.replace(indexHeading, heading => referencesHtml + heading);
  else html += referencesHtml;
  html = html.replace(/<h2(?=[\s>])/g, '<h2 data-chapter');

  // 章节编号：H2 起编号，H1 作为文档标题不动
  html = numberHeadings(html, effNumbering, effScheme);

  // 标题：显式 title（含显式空串）优先，空串即隐藏文档标题、不再回退 H1/文件名；否则取首个 H1 → GB 中文名称 → 文件名/网页提示。
  const h1 = /<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/.exec(html);
  let title;
  if (eff.title !== undefined) {
    title = eff.title;                                  // 显式（含显式空串）：空串即隐藏，不再回退
  } else if (h1) {
    title = fmStr(fm['中文名称']) || stripTags(h1[1]);  // 有 H1：GB 中文名称优先，其次 H1（空 H1 保持空 = 隐藏）
  } else {
    title = fmStr(fm['中文名称']) || (context.webSafe ? '设置一级标题为文档标题' : path.basename(mdPath, path.extname(mdPath)));
  }
  if (h1) html = html.replace(h1[0], '');

  // 导语：正文里第一个顶层普通段落（可位于章节下），跳过标题/代码/列表/引用/表格/块公式/仅图片段/参考文献定义。
  let lead = '';
  if (effLead) {
    const r = extractLead(html);
    if (r) { lead = r.lead; html = r.html; }
  }

  // 链接 / 图片
  html = html.replace(/<a\s+href="([^"]*)"([^>]*)>/g, (m, href, rest) => {
    const cls = /\sclass=/.test(rest) ? '' : ' class="ref"';
    return `<a href="${href}"${cls}${rest}>`;
  });
  if (eff.linkUrls) {
    html = html.replace(/<a\s+href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
      (m, href, text) => `${m} <span class="link-url">(${esc(href)})</span>`);
  }
  const dir = context.resourceBase || path.dirname(path.resolve(mdPath));
  html = html.replace(/<img\s+([^>]*?)src="([^"]+)"([^>]*)>/g, (m, pre, src, post) => {
    if (/^(https?:|data:|file:)/.test(src)) return m;
    const abs = path.resolve(dir, src);
    return `<img ${pre}src="${pathToFileURL(abs).href}"${post}>`;
  });

  // 目录从 H2–H6 中实际存在的最高层级开始，H1 不进入目录。
  const secIds = [];
  html = html.replace(/<h([2-6])(\s[^>]*)?>([\s\S]*?)<\/h\1>/g, (m, level, attrs = '', inner = '') => {
    const front = /\bclass="[^"]*\bfront\b/.test(attrs);
    const existing = /\sid="([^"]+)"/.exec(attrs);
    const id = existing ? existing[1] : `sec-${secIds.length + 1}`;
    secIds.push({ id, text: stripTags(inner), front, level: +level });
    return existing ? m : `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
  });
  let toc = '';
  if (useToc && secIds.length) {
    const levels = [...new Set(secIds.map(s => s.level))].sort((a, b) => a - b);
    const included = levels.slice(0, eff.tocDepth === 2 ? 2 : 1);
    const items = secIds.filter(s => included.includes(s.level));
    const tocItem = s => profile.gbDoc
      ? `<li class="toc-level-${included.indexOf(s.level)}${s.float ? ' toc-float' : ''}"><a href="#${s.id}"${s.front ? ' class="toc-front"' : ''}><span class="toc-text">${esc(s.text)}</span><span class="toc-dots"></span></a></li>`
      : `<li class="toc-level-${included.indexOf(s.level)}${s.float ? ' toc-float' : ''}"><a href="#${s.id}"><span class="toc-text">${esc(s.text)}</span><span class="toc-dots"></span></a></li>`;
    const floatLists = profile.gbDoc ? ['fig', 'tab'].map(kind => {
      const entries = [...html.matchAll(kind === 'fig' ? /<figure class="fig" id="([^"]+)">[\s\S]*?<figcaption>([\s\S]*?)<\/figcaption>/g : /<table class="tbl" id="([^"]+)">\s*<caption>([\s\S]*?)<\/caption>/g)];
      return entries.length ? '<ol class="gb-float-toc">' + entries.map(m => tocItem({id:m[1],text:stripTags(m[2]),level:2,float:true})).join('') + '</ol>' : '';
    }).join('') : '';
    toc = `<div class="toc"><div class="toc-title">${profile.tocTitle || '目  录'}</div><ol>` + items.map(tocItem).join('') + '</ol>' + floatLists + '</div>';
  }

  if (profile.gbDoc) html = applyGbEquations(transformGbContent(html, title));
  if (gbNotes) html = gbNotes.finalize(html);
  html = sectionize(html);
  if (profile.gbDoc && !(fm.gb_source_cover === true || fm.gb_source_cover === 'true') && /class="[^"]*body-start/.test(html)) {
    html = html.replace(/<\/section>\s*$/, '<div class="gb-end-line" aria-label="文件终结线"></div></section>');
  }

  // CSS
  const themeFile = path.join(THEMES, `${effTheme}.css`);
  if (!existsSync(themeFile)) throw new Error(`未知主题：${effTheme}（可用：${listThemes().join(', ')}）`);
  const base = await readFile(path.join(ASSETS, 'base.css'), 'utf8');
  throwIfAborted();
  const theme = await readFile(themeFile, 'utf8');
  throwIfAborted();
  // 正文行距：webapp 选项 opts.lineHeight（有限数字 1.0–2.5，server 已校验范围）。
  // 省略 / 非有限数字回落到 1.9 —— 与旧硬编码一致。GB 固定值由 themes/gb.css 的
  // body{line-height:1.62} 直接覆盖，且 server 拒绝为 gb 传入 lineHeight。
  const effLineHeight = Number.isFinite(eff.lineHeight) ? eff.lineHeight : 1.9;
  const css = (base + '\n' + theme + (profile.gbDoc ? '\n' + GB_EQUATION_CSS : ''))
    .replace(/\{\{PAGE_SIZE\}\}/g, eff.landscape ? 'A4 landscape' : 'A4')
    .replace(/\{\{MARGIN_TOP\}\}/g, `${effMarginTop}mm`)
    .replace(/\{\{MARGIN_BOTTOM\}\}/g, `${effMarginBottom}mm`)
    .replace(/\{\{MARGIN_LEFT\}\}/g, `${effMarginLeft}mm`)
    .replace(/\{\{MARGIN_RIGHT\}\}/g, `${effMarginRight}mm`)
    .replace(/\{\{FONT_SIZE\}\}/g, `${eff.fontSize ?? 10.5}pt`)
    .replace(/\{\{LINE_HEIGHT\}\}/g, `${effLineHeight}`);

  // GB 页眉标准号：奇数页靠右、偶数页靠左。Chrome 原生 headerTemplate 只有单一模板，
  // 做不到奇偶差异，改由 Paged.js 的命名页 margin box 绘制（故标准号在这里动态成 CSS）。
  const stdno = fm['标准号'] || fm.standard || '';
  const pageCss = profile.gbDoc ? gbHeaderCss(stdno) : '';
  let finalCss = (pageCss ? css + '\n' + pageCss : css) + (gbNotes ? '\n' + gbNotes.css : '');

  const chapterStart = eff.chapterStart;
  if (chapterStart !== 'continuous') {
    finalCss += '\nmain > section:not([data-first-chapter]):has(> h2[data-chapter]) { break-before: ' + (chapterStart === 'odd-page' ? 'right' : 'page') + '; }';
  }
  // Intentional parity pages stay entirely blank, including custom margin boxes.
  if (chapterStart === 'odd-page') finalCss += '\n@page :blank { @top-left { content: none; } @top-center { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; } }\n.pagedjs_blank_page .pagedjs_margin-content { visibility: hidden !important; }';

  const kicker = eff.kicker !== undefined ? eff.kicker
    : (fmStr(fm.kicker) || fmStr(fm.category) || (profile.kicker ?? ''));

  // 学术论文：报头三件套（作者行 + 「摘要」块 + 「关键词」行）
  const authorsHtml = profile.paperHeader ? paperAuthorsHtml(fm, esc) : '';
  const sourceCover = fm.gb_source_cover === true || fm.gb_source_cover === 'true';
  const coverHtml = profile.gbDoc && eff.gbCover !== false && !sourceCover ? buildCover(fm, title, eff.gbDefaults !== false, await readFile(path.join(ASSETS, 'gb-cover-banner.svg'), 'utf8'), JSON.parse(await readFile(path.join(ASSETS, 'gb-issuer-outlines.json'), 'utf8'))) : '';
  if (profile.gbDoc && sourceCover) {
    // Unsectioned source evidence uses the body page without a generated cover.
    const header = stdno ? '@top-right { content: ' + cssString(stdno) + '; font: 10.5pt/1 var(--font-head); }' : '';
    finalCss += '\nbody, main { page: gb-body; }\nmain > section:first-child { break-before: auto; }\nmain img { max-height: 230mm; object-fit: contain; }\n@page { ' + header + ' @bottom-right { content: counter(page); } }';
  }

  const paperHtml = profile.paperHeader
    ? [
        fm.abstract ? '<div class="abstract"><span class="paper-label">摘要</span><span>' + esc(fm.abstract) + '</span></div>' : '',
        fm.keywords?.length ? '<div class="keywords"><span class="paper-label">关键词</span><span>' + esc(fm.keywords.join('；')) + '</span></div>' : '',
      ].filter(Boolean).join('\n')
    : '';
  // 文末落款：CLI 与 Web 默认一致 —— 左侧官方仓库口号，右侧本次渲染生成时间（本机时区，带偏移）。
  // 文字与整栏开关分别解析；关闭整栏不影响保存的文字。
  const stamp = formatStamp(context.generatedAt instanceof Date ? context.generatedAt : new Date());
  const colophonLeftDefault = `make <a href="${REPO_URL}" data-md2pdf-open-repo="1">md2pdf</a> great`;
  const colophonParts = [eff.colophonLeft === undefined ? colophonLeftDefault : esc(eff.colophonLeft),
    esc(eff.colophonCenter || ''), esc(eff.colophonRight === undefined ? stamp : eff.colophonRight)];
  const colophonHtml = profile.gbDoc || eff.colophonEnabled === false || !colophonParts.some(Boolean) ? '' :
    `<div class="colophon">${colophonParts.map(part => `<span>${part}</span>`).join('')}</div>`;

  // 用函数形式替换：既支持多处占位符，也避免用户文本里的 $& 被当作替换模式
  const fill = (tpl, map) => Object.entries(map).reduce(
    (s, [k, v]) => s.split(k).join(v), tpl);

  const mermaidUrl = pathToFileURL(path.join(ROOT, 'vendor', 'mermaid', 'mermaid.min.js')).href;
  const mermaidScript = hasMermaid ? [
    '<script src="' + mermaidUrl + '"></script>',
    '<script>',
    'window.__md2pdfMermaidReady = false;',
    'try {',
    // 用文档主题的 CSS 变量驱动 mermaid 配色/字体（elegant / minimal 自动适配）
    '  var cs = getComputedStyle(document.documentElement);',
    '  var v = function (n) { return (cs.getPropertyValue(n) || "").trim(); };',
    '  mermaid.initialize({',
    '    startOnLoad: false,',
    '    theme: "base",',
    // 确定性 id：避免每次渲染因随机 id 产生无意义字节差异
    '    deterministicIds: true,',
    '    deterministicIDSeed: "md2pdf",',
    '    themeVariables: {',
    '      fontFamily: v("--font-body") || "sans-serif",',
    '      fontSize: "15px",',
    '      primaryColor: v("--tint"),',
    '      primaryBorderColor: v("--accent"),',
    '      primaryTextColor: v("--ink"),',
    '      lineColor: v("--accent"),',
    '      textColor: v("--ink"),',
    '      clusterBkg: v("--tint"),',
    '      clusterBorder: v("--rule"),',
    '      edgeLabelBackground: v("--paper")',
    '    }',
    '  });',
    '  mermaid.run().then(function () { window.__md2pdfMermaidReady = true; })',
    '    .catch(function () { window.__md2pdfMermaidReady = true; });',
    '} catch (e) { window.__md2pdfMermaidReady = true; }',
    '</script>',
  ].join('\n') : '';

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

  // Paged.js：GB、目录、章分页及表格 PDF 共用分页引擎（@page / target-counter，
  // 见 docs/gb-template.md）。--paged-html 时脚本改注入 paged-html 产物（见下方 pagedOut），
  // 两份 HTML 必须分离 —— 否则非 gb 的 PDF 会被 Paged.js 二次分页。
  // 时序：必须等 MathJax / Mermaid 渲染完成再分页，否则按错误尺寸切页。
  const pagedUrl = pathToFileURL(path.join(ROOT, 'vendor', 'pagedjs', 'paged.polyfill.min.js')).href;
  const pagedScriptsBlock = () => [
    '<script>window.PagedConfig = { auto: false };</script>',
    '<script src="' + pagedUrl + '"></script>',
    '<script>',
    'window.__md2pdfPagedReady = false;',
    installPagedLayout.toString(),
    profile.gbDoc ? '' : stampPagedLists.toString(),
    profile.gbDoc ? [prepareGbLayout, finalizeGbLayout, prepareGbBodyLayout, finalizeGbBodyLayout, finalizeGbTableRules, finalizeGbIndexLayout, finalizeGbEquations, prepareGbBodyAudit, finalizeGbBodyAudit].map(fn=>fn.toString()).join('\n') : finalizePagedCounters.toString(),
    '(function () {',
    '  function depsReady() {',
    '    return window.__md2pdfMathReady !== false && window.__md2pdfMermaidReady !== false;',
    '  }',
    '  function run() {',
    '    if (!depsReady()) { setTimeout(run, 50); return; }',
    '    try {',
    (profile.gbDoc ? '      prepareGbLayout(); prepareGbBodyLayout(' + JSON.stringify(stdno).replace(/</g, '\\u003c') + '); prepareGbBodyAudit();\n' : '') + '      installPagedLayout(' + (profile.gbDoc ? '(' + (297-effMarginBottom)*96/25.4 + ' - window.__gbContentTop)' : ((eff.landscape ? 210 : 297) - effMarginTop - effMarginBottom) * 96 / 25.4) + ', ' + JSON.stringify(chapterStart) + ', ' + (!profile.gbDoc && !useToc) + ', ' + ((eff.landscape ? 297 : 210) - effMarginLeft - effMarginRight) * 96 / 25.4 + ', ' + profile.gbDoc + ');',
    profile.gbDoc ? '' : '      stampPagedLists();',
    '      window.PagedPolyfill.preview()',
    '        .then(function () { ' + (profile.gbDoc ? 'finalizeGbLayout(' + JSON.stringify(stdno).replace(/</g, '\\u003c') + '); finalizeGbBodyLayout(); finalizeGbTableRules(); finalizeGbIndexLayout(); finalizeGbEquations(); finalizeGbBodyAudit(); ' : 'finalizePagedCounters(' + (eff.footer !== false && eff.footerCenter === undefined) + '); ') + 'window.__md2pdfPagedReady = true; })',
    '        .catch(function (error) { window.__md2pdfPagedError = String(error.stack || error); window.__md2pdfPagedReady = true; });',
    '    } catch (e) { window.__md2pdfPagedError = String(e.stack || e); window.__md2pdfPagedReady = true; }',
    '  }',
    profile.gbDoc ? '  function start() { Promise.all([document.fonts.load(\'10.5pt \"GB Song\"\'), document.fonts.load(\'10.5pt \"GB Hei\"\'), document.fonts.load(\'17pt \"GB Cover\"\'), document.fonts.load(\'14pt \"GB Cover Latin\"\', \'ABCabc-\'), document.fonts.load(\'10.5pt \"GB Hei Latin\"\', \'ABCabc\'), document.fonts.load(\'10.5pt \"GB Symbols\"\', \'−•\')]).then(function (faces) { if (faces.some(function (list) { return !list.length; })) throw new Error(\'国家标准所需本机字体未加载，请安装方正书宋_GBK、方正黑体_GBK、方正小标宋_GBK及 Times New Roman 普通／粗体\'); return document.fonts.ready; }).then(run).catch(function (error) { window.__md2pdfPagedError = String(error); window.__md2pdfPagedReady = true; }); }' : '  function start() { document.fonts.ready.then(run); }',
    '  if (document.readyState === "complete") start(); else window.addEventListener("load", start);',
    '})();',
    '</script>',
  ].join('\n');
  const pagedScript = profile.gbDoc ? pagedScriptsBlock() : '';

  // GB 结构化元数据透传：封面渲染键以外的 frontmatter 以 <meta name="gb:键"> 进 <head>，
  // 使 gb 文档的结构化信息可被其他项目直接消费（--html-only / keep-html 同样包含）。
  const GB_COVER_KEYS = new Set(['标准号', 'standard', 'title', '中文名称', '标准名称', '英文名称', 'title_en',
    '国际标准分类号', 'ICS', 'ics', '中国标准分类号', 'CCS', 'ccs',
    '发布日期', 'date', '实施日期', '全部代替标准', '代替标准',
    '采标国际标准', '采标英文名称', '采标中文名称', '采标程度',
    '发布单位', '发布机构', '发布机构2', '文件类别', 'kicker', 'category', 'author']);
  const gbMeta = profile.gbDoc
    ? Object.entries(fm)
        .filter(([k, v]) => fmStr(v).trim() && !GB_COVER_KEYS.has(k))
        .map(([k, v]) => '<meta name="gb:' + esc(k) + '" content="' + esc(fmStr(v)) + '">')
        .join('\n')
    : '';
  // 预览的页码修正也必须尊重自定义/隐藏的中间页脚。
  const headMeta = gbMeta + (profile.gbDoc ? '\n<meta name="md2pdf-gb-cover-glyphs" content="local-test-candidate-unverified">\n<meta name="md2pdf-gb-cover-latin" content="FZXBSK-GBK-outline-compared-approximation">' : '') + '\n<meta name="md2pdf-page-count" content="' +
    (!profile.gbDoc && eff.footer !== false && eff.footerCenter === undefined ? 'auto' : 'off') + '">';

  let shell = await readFile(path.join(ASSETS, 'shell.html'), 'utf8');
  throwIfAborted();
  if (profile.gbDoc && !coverHtml) {
    // Paged.js still assigns a page to the hidden masthead before named main.
    shell = shell.replace(/<header class="masthead[^"]*">[\s\S]*?<\/header>/, '');
  }
  if ((chapterStart !== 'continuous' || html.includes('class="md2pdf-pagebreak"')) && !title && !kicker && !lead && !authorsHtml) {
    shell = shell.replace(/<header class="masthead[^"]*">[\s\S]*?<\/header>/, '');
  }
  if (profile.gbDoc && coverHtml && stdno) shell = shell.replace('</main>', '</main><section class="gb-back-cover"><div class="gb-back-standard">' + esc(stdno) + '</div></section>');
  const out = fill(shell, {
    '{{TITLE}}': esc(title),
    '{{MASTHEAD_CLASS}}': h1 && !title ? ' title-omitted' : '',
    '{{CSS}}': finalCss,
    '{{KICKER}}': esc(kicker),
    '{{LEAD}}': lead,
    '{{META}}': eff.meta !== false ? buildMeta(fm, profile.skillMeta) : '',
    '{{TOC}}': toc,
    '{{BODY}}': html,
    '{{COLOPHON}}': colophonHtml,
    '{{COVER}}': coverHtml,
    '{{AUTHORS}}': authorsHtml,
    '{{PAPER}}': paperHtml,
    '{{MATHJAX}}': mathScript,
    '{{MERMAID}}': mermaidScript,
    '{{PAGEDJS}}': pagedScript,
    '{{HEAD_META}}': headMeta,
  });

  // 分页 HTML（--paged-html）：浏览器打开与 PDF 同款分页/页码。
  // gb 的 out 已含 Paged.js 与分侧页码规则；其他类型在此注入页码/页脚 margin box 与观感样式。
  // 目录、章分页和表格 PDF 同样使用分页产物，确保页码与表头和预览一致。
  const usePaged = !!profile.gbDoc || !!toc || chapterStart !== 'continuous' || html.includes('class="md2pdf-pagebreak"') || /<table[\s>]/.test(html);
  let pagedOut = null;
  if (options.pagedHtml || usePaged) {
    const footFont = 'font: 8pt/1 -apple-system, "PingFang SC", sans-serif; color: #8a8578; letter-spacing: .5px;';
    // 页脚三栏：footer=false 关整栏；center 未指定=当前页/总页数，显式字符串替换，空串清空；左右独立。
    const showFooter = eff.footer !== false;
    const centerCustom = eff.footerCenter !== undefined;
    const centerCss = !showFooter ? ''
      : centerCustom
        ? (eff.footerCenter === '' ? '' : '  @bottom-center { content: ' + JSON.stringify(eff.footerCenter) + '; ' + footFont + ' }')
        : '  @bottom-center { content: counter(page) " / " counter(pages); ' + footFont + ' }';
    const pageBoxes = profile.gbDoc ? '' : [
      '@page {',
      ...['Left', 'Center', 'Right'].map(side => eff.header !== false && eff['header' + side] ? '  @top-' + side.toLowerCase() + ' { content: ' + cssString(eff['header' + side]) + '; ' + footFont + ' }' : ''),
      centerCss,
      showFooter && eff.footerLeft ? '  @bottom-left { content: ' + JSON.stringify(eff.footerLeft) + '; ' + footFont + ' }' : '',
      showFooter && eff.footerRight ? '  @bottom-right { content: ' + JSON.stringify(eff.footerRight) + '; ' + footFont + ' }' : '',
      '}',
    ].filter(Boolean).join('\n');
    const screenCss = [
      '@media screen {',
      '  body { background: #f0f0f0; padding: 8mm 0; }',
      '  .pagedjs_pages { display: flex; flex-direction: column; align-items: center; gap: 8mm; }',
      '  .pagedjs_page { background: var(--paper); box-shadow: 0 2px 8px rgba(0, 0, 0, .15); }',
      '}',
    ].join('\n');
    const inject = [pageBoxes, screenCss].filter(Boolean).join('\n');
    const scripts = profile.gbDoc ? '' : pagedScriptsBlock();
    pagedOut = out
      .replace('</style>', inject + '\n</style>')
      .replace('</body>', scripts + '\n</body>');
  }


  // Chrome 打印路径的页脚：与 Paged 路径保持同一套 center 语义。
  let footerCenterHtml;
  if (eff.footer === false) footerCenterHtml = '';
  else if (eff.footerCenter !== undefined) footerCenterHtml = esc(eff.footerCenter);
  else footerCenterHtml = '<span class="pageNumber"></span> / <span class="totalPages"></span>';
  const footerTemplate = `<div style="width:100%;font-size:8px;color:#8a8578;font-family:-apple-system,'PingFang SC',sans-serif;letter-spacing:.5px;display:flex;justify-content:space-between;padding:0 12mm;">
      <span style="flex:1;text-align:left;">${esc(eff.footerLeft || '')}</span>
      <span style="flex:1;text-align:center;">${footerCenterHtml}</span>
      <span style="flex:1;text-align:right;">${esc(eff.footerRight || '')}</span>
    </div>`;

  // Paged 路径使用 margin box，关闭 Chrome 原生页眉页脚以免出现两套页码。
  const showHeader = !profile.gbDoc && eff.header !== false && ['Left', 'Center', 'Right'].some(side => eff['header' + side]);
  const headerTemplate = showHeader ? `<div style="width:100%;font-size:8px;color:#8a8578;display:flex;padding:0 12mm;">${['Left', 'Center', 'Right'].map(side => `<span style="flex:1;min-width:0;overflow-wrap:anywhere;text-align:${side.toLowerCase()};">${esc(eff['header' + side] || '')}</span>`).join('')}</div>` : '<span></span>';

  const assetHtml = value => context.assetBase ? value.replaceAll(pathToFileURL(ROOT + path.sep).href, context.assetBase.replace(/\/$/, '') + '/') : value;
  return { title, warnings, html: assetHtml(usePaged && !profile.gbDoc ? pagedOut : out), pagedHtml: pagedOut && assetHtml(pagedOut), type: profile.name,
    printOptions: { ...(profile.gbDoc ? {requireGbFonts:true} : {}), footer: usePaged ? false : eff.footer !== false, footerTemplate, header: usePaged ? false : !!showHeader, headerTemplate,
      landscape: eff.landscape, outline: eff.outline !== false, waitMath: hasMath, waitMermaid: hasMermaid, waitPaged: usePaged } };
}
