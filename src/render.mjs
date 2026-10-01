import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { detectProfile } from './profiles.mjs';
import { resolveNumberScheme } from './numbering.mjs';
import { defaultOptions } from './options.mjs';
export { defaultOptions } from './options.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');
const listThemes = () => readdirSync(ASSETS).filter(f => /^theme-.+\.css$/.test(f)).map(f => f.slice(6, -4)).sort();
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripTags = s => String(s).replace(/<[^>]+>/g, '').trim();
// 给标签属性串追加 class（属性串可能已有 class="…"，也可能为空）
const addClass = (attrs, cls) => /\sclass="/.test(attrs)
  ? attrs.replace(/\sclass="([^"]*)"/, (m, c) => ` class="${c} ${cls}"`)
  : `${attrs} class="${cls}"`;

function splitFrontmatter(src) {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { fm: {}, body: src };
  const fm = {};
  // 值的形态：标量字符串，或 YAML 块式数组 / 行内 [a, b] 数组（Obsidian 风格）。
  // 约定：留空的键不解析（等同未写）；# 注释行与 <!-- --> 说明行忽略。
  const toValue = (raw) => {
    let v = raw.trim().replace(/^["']|["']$/g, '');
    if (/^\[.*\]$/.test(v)) {
      const items = v.slice(1, -1).split(/[,，]/).map(s => s.trim()).filter(Boolean);
      return items.length ? items : undefined;
    }
    return v === '' ? undefined : v;
  };
  for (const line of m[1].split(/\r?\n/)) {
    if (/^\s*(#|<)/.test(line)) continue;  // 注释/说明行
    // 列表项：上级键的块式数组（- 项）
    const li = /^\s+-\s+(.*)$/.exec(line);
    if (li) {
      const k = Object.keys(fm).at(-1);
      if (k != null && !li[1].trim()) continue;
      if (k != null) {
        if (!Array.isArray(fm[k])) fm[k] = fm[k] ? [fm[k]] : [];
        fm[k].push(li[1].trim());
      }
      continue;
    }
    // 键名允许中文（GB 用「标准号/全部代替标准」等中文键）
    const kv = /^([A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff-]*)[ \t]*:[ \t]*(.*)$/.exec(line);
    if (kv) {
      const v = toValue(kv[2]);
      if (v !== undefined) fm[kv[1]] = v;
      else if (kv[2].trim() === '') fm[kv[1]] = '';  // 显式留空：占位但不计内容（消费方按空值跳过）
    } else if (/^\s+/.test(line) && Object.keys(fm).length) {
      const k = Object.keys(fm).at(-1);
      if (typeof fm[k] === 'string' && fm[k] !== '') fm[k] = (fm[k] + ' ' + line.trim()).trim();
    }
  }
  return { fm, body: src.slice(m[0].length) };
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
const BADGE_HOSTS = ['shields.io', 'badgen.net', 'badge.fury.io', 'travis-ci.org', 'travis-ci.com', 'codecov.io', 'coveralls.io', 'appveyor.com', 'codacy.com', 'sonarcloud.io', 'buildkite.com', 'badge.svg'];
const isBadgeUrl = (src) => BADGE_HOSTS.some(h => src.includes(h));

function numberFloats(html, o = {}) {
  const refs = new Map();
  let figN = 0, tabN = 0;

  // 图：(a) 图片/SVG（alt 里带 {#fig:x}）或 (b) 「图：题注」+ mermaid 代码块；统一编号
  const figRe = /(<p>\s*<img\b[^>]*>\s*<\/p>)|(<p>\s*图\s*[：:]\s*[\s\S]*?<\/p>\s*<pre><code class="language-mermaid">[\s\S]*?<\/code><\/pre>)/g;
  html = html.replace(figRe, (m) => {
    let caption = '', label = '', body = '';
    if (m.indexOf('<img') >= 0) {
      let tag = /<img\b[^>]*>/.exec(m)[0];
      const srcM = /\bsrc="([^"]*)"/.exec(tag);
      // 徽章图（shields.io 等）不编号、不包 figure（README 顶部常见）
      if (o.skipBadges && srcM && isBadgeUrl(srcM[1])) return m;
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
    if (label) refs.set(label, { num: figN, id: 'fig-' + figN });
    return '<figure class="fig" id="fig-' + figN + '">' + body +
      '<figcaption>图 ' + figN + '：' + caption + '</figcaption></figure>';
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
    return '<h' + level + outAttrs + '>' + (num == null ? clean : num + clean) + '</h' + level + '>';
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
// 版式实测自正式发布版（GB 2811—2019 / GB/T 48051—2026，A4 595×842pt，坐标换算 mm）：
//   ICS/CCS 左上 ≈10mm；「中华人民共和国国家标准」≈41mm 撑满两边距；标准号 ≈60mm 右对齐
//   （代替标准紧随其下）；中文名 ≈115mm、英文名 ≈134mm 居中；日期行 ≈250mm
//   （发布靠左、实施靠右）；机构三行块（名称/发布/名称）≈263–276mm。
function buildCover(fm, title) {
  const stdno = fm['标准号'] || fm.standard || '';
  const cn = fm['中文名称'] || title || fm.title || '';
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
  // 自适应脚注间距：中/英文名称与采标行的行数多于基线（中文名称 1 行、英文名称 2 行、采标 2 行）时，
  // 按多出的行高压缩 foot 的 margin-top，避免封面拆页。估宽：CJK 1em、其他 0.55em。
  const emW = (s) => [...s].reduce((n, ch) => n + (/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 1 : 0.55), 0);
  const nLines = (text, pt, maxMm) => text ? Math.max(1, Math.ceil(emW(text) * (pt / 72 * 25.4) / maxMm)) : 0;
  const cnLines = Math.max(1, nLines(cn, 28, 166));
  const enLines = en ? Math.max(1, nLines(en, 15, 136)) : 0;
  const isoLines = iso ? Math.max(1, nLines('(' + iso + ', ' + isoCn + ', ' + isoDeg + ')', 11, 136)) : 0;
  const extraMm = Math.max(0, cnLines - 1) * 15.3
    + Math.max(0, enLines - 2) * 8.5
    + Math.max(0, isoLines - 2) * 6.2;
  const footTop = Math.round(Math.max(40, 93 - extraMm));
  const ics = fmStr(fm['国际标准分类号'] || fm.ICS || fm.ics);
  const ccs = fmStr(fm['中国标准分类号'] || fm.CCS || fm.ccs);
  const issued = fm['发布日期'] || fm.date || '';
  const impl = fm['实施日期'] || '';
  const sup = fmStr(fm['全部代替标准'] || fm['代替标准']);
  // 机构两行 + 居间「发布」；发布机构可覆盖第一行
  // 发布单位：封面机构块各行（数组或标量）；旧键 发布机构/发布机构2 仍兼容
  const orgSrc = fm['发布单位'] ?? fm['发布机构'];
  const orgs = Array.isArray(orgSrc) ? orgSrc : (orgSrc ? [fmStr(orgSrc)] : []);
  const orgA = orgs[0] || '国家市场监督管理总局';
  const orgB = orgs[1] || (Array.isArray(orgSrc) ? '国家标准化管理委员会' : (fm['发布机构2'] || '国家标准化管理委员会'));
  // 「中华人民共和国国家标准」按字均分撑满两边距，短语间留一个双倍空位
  const head = (fm['文件类别'] || '中华人民共和国国家标准')
    .split('').map(c => '<span>' + esc(c) + '</span>').join('<i class="cover-head-gap"></i>');
  const icsHtml = (ics || ccs)
    ? '<div class="cover-ics">' + (ics ? 'ICS ' + esc(ics) : '') + (ccs ? '<br>CCS ' + esc(ccs) : '') + '</div>'
    : '';
  const datesHtml = (issued || impl)
    ? '<div class="cover-dates">' +
      (issued ? '<span>' + esc(issued) + ' 发布</span>' : '<span></span>') +
      (impl ? '<span>' + esc(impl) + ' 实施</span>' : '<span></span>') +
      '</div>'
    : '';
  const supHtml = sup ? '<div class="cover-sup">代替 ' + esc(sup) + '</div>' : '';
  const logoUrl = pathToFileURL(path.join(ASSETS, 'gb-logo.svg')).href;
  return [
    '<section class="cover">',
    icsHtml,
    '<img class="cover-logo" src="' + logoUrl + '" alt="GB">',
    '  <div class="cover-head">' + head + '</div>',
    '  <div class="cover-stdno">' + esc(stdno) + '</div>',
    supHtml,
    '  <div class="cover-rule"></div>',
    '  <div class="cover-main"><div class="cover-cn">' + esc(cn) + '</div>' +
      (en ? '<div class="cover-en">' + esc(en) + '</div>' : '') +
      isoHtml + '</div>',
    '  <div class="cover-foot" style="margin-top:' + footTop + 'mm;">',
    datesHtml,
    '  <div class="cover-org"><div class="cover-org-name">' + esc(orgA) + '</div>' +
      '<div class="cover-org-pub">发 布</div>' +
      '<div class="cover-org-name">' + esc(orgB) + '</div></div>',
    '  </div>',
    '</section>',
  ].filter(Boolean).join('\n');
}

export async function render(src, options = {}, context = {}) {
  const opts = { ...defaultOptions(), ...options };
  const mdPath = context.filename || 'document.md';
  const { Marked } = await import(pathToFileURL(path.join(ROOT, 'vendor', 'marked.esm.js')).href);
  const marked = new Marked({ gfm: true });
  const require = createRequire(import.meta.url);
  const hljs = require(path.join(ROOT, 'vendor', 'highlight', 'highlight.cjs'));
  if (context.webSafe) marked.use({ renderer: {
    html(token) { return esc(token.text); },
    image(token) { return /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(token.href) ? `<img src="${esc(token.href)}" alt="${esc(token.text)}">` : esc(token.text); },
    link(token) { const label = this.parser.parseInline(token.tokens); return /^(https?:|mailto:|#)/i.test(token.href) ? `<a href="${esc(token.href)}">${label}</a>` : label; },
  } });
  const { fm, body: rawBody } = splitFrontmatter(src);
  const profile = detectProfile({ basename: path.basename(mdPath), fm, explicit: opts.type });
  // 生效选项：CLI 显式 > profile 默认 > 内置兜底（三态，见 parseArgs）
  const effTheme = opts.theme ?? profile.defaults.theme ?? 'elegant';
  const effLead = opts.lead ?? profile.defaults.lead ?? true;
  const effNumbering = opts.numbering ?? profile.defaults.numbering ?? 'auto';
  const effScheme = opts.numberScheme ?? profile.defaults.numberScheme ?? 'arabic';
  const useToc = opts.toc ?? profile.defaults.toc ?? false;
  // 页边距：CLI 显式 > profile 默认 > 内置兜底（左右各自取值，gb 为左宽右窄）
  const effMarginTop = opts.marginTop ?? profile.defaults.marginTop ?? 20;
  const effMarginBottom = opts.marginBottom ?? profile.defaults.marginBottom ?? 18;
  const effMarginLeft = opts.marginLeft ?? profile.defaults.marginLeft
    ?? opts.marginSide ?? profile.defaults.marginSide ?? 18;
  const effMarginRight = opts.marginRight ?? profile.defaults.marginRight
    ?? opts.marginSide ?? profile.defaults.marginSide ?? 18;

  // 数学公式：检测 $...$ 或 $...$，命中则注入 MathJax（SVG 输出，零字体依赖）
  const hasMath = /\$\$|\$[^$\n]+\$/.test(rawBody);
  // Mermaid 图：检测 \`\`\`mermaid 代码块，命中则注入 Mermaid 浏览器端渲染
  const hasMermaid = /^[ \t]*\`\`\`mermaid\b/m.test(rawBody);

  // 脚注：提取 [^id]: 定义，正文 [^id] 引用替换为编号上标
  const { body, footnotes } = parseFootnotes(rawBody);
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

  let html = marked.parse(bodyProtected, { gfm: true, breaks: false, async: false });

  if (context.webSafe) html = html.replace(/\u0003FOOTNOTE(\d+)\u0003/g, (m, i) => fnMarkup[+i] ?? m);

  // 图/表自动编号与题注（收集标签）
  const floats = numberFloats(html, { skipBadges: profile.skipBadges });
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

  // 脚注/参考文献：先追加到正文末尾，再编号，使参考文献章节纳入编号体系
  html += renderFootnotes(orderedFootnotes, opts.bibliography, marked);

  // 章节编号：H2 起编号，H1 作为文档标题不动
  html = numberHeadings(html, effNumbering, effScheme);

  // 标题：正文首个 H1 → 报头
  let title = opts.title || fm['中文名称'] || fm.title || '';
  const h1 = /<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/.exec(html);
  if (h1) {
    const t = stripTags(h1[1]);
    if (!title) title = t;
    html = html.replace(h1[0], '');
  }
  if (!title) title = path.basename(mdPath, path.extname(mdPath));

  // 导语：移除 H1 后的第一段
  let lead = '';
  if (effLead) {
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
  const dir = context.resourceBase || path.dirname(path.resolve(mdPath));
  html = html.replace(/<img\s+([^>]*?)src="([^"]+)"([^>]*)>/g, (m, pre, src, post) => {
    if (/^(https?:|data:|file:)/.test(src)) return m;
    const abs = path.resolve(dir, src);
    return `<img ${pre}src="${pathToFileURL(abs).href}"${post}>`;
  });

  // 章节锚点：给二级标题补 id，供目录内链与（Chrome 生成的）PDF 书签定位
  const secIds = [];
  html = html.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/g, (m, attrs = '', inner = '') => {
    // front：GB 前置部分（前言/引言），目次里显示罗马页码
    const front = /\bclass="[^"]*\bfront\b/.test(attrs);
    const has = /\sid="/.test(attrs);
    if (has) {
      secIds.push({ id: /\sid="([^"]+)"/.exec(attrs)[1], text: stripTags(inner), front });
      return m;
    }
    const id = `sec-${secIds.length + 1}`;
    secIds.push({ id, text: stripTags(inner), front });
    return `<h2${attrs} id="${id}">${inner}</h2>`;
  });

  // 目录：文首一张可点击的目录页（仅当二级标题多于一个才值得排）
  // toc 为三态：CLI 显式指定优先，否则用 profile 默认（readme 默认开），最后兜底 false
  let toc = '';
  if (useToc && secIds.length > 1) {
    // GB 目次：条目「标题 + 点线 + 右对齐页码」。页码由 Paged.js 的
    // target-counter(attr(href), page) 在分页后填入，所以这里只放结构。
    const tocItem = profile.gbDoc
      ? s => `<li><a href="#${s.id}"${s.front ? ' class="toc-front"' : ''}><span class="toc-text">${esc(s.text)}</span><span class="toc-dots"></span></a></li>`
      : s => `<li><a href="#${s.id}">${esc(s.text)}</a></li>`;
    toc = `<div class="toc"><div class="toc-title">${profile.tocTitle || '目 录'}</div><ol>` +
      secIds.map(tocItem).join('') + `</ol></div>`;
  }

  html = sectionize(html);

  // CSS
  const themeFile = path.join(ASSETS, `theme-${effTheme}.css`);
  if (!existsSync(themeFile)) throw new Error(`未知主题：${effTheme}（可用：${listThemes().join(', ')}）`);
  const base = await readFile(path.join(ASSETS, 'base.css'), 'utf8');
  const theme = await readFile(themeFile, 'utf8');
  const css = (base + '\n' + theme)
    .replace(/\{\{PAGE_SIZE\}\}/g, opts.landscape ? 'A4 landscape' : 'A4')
    .replace(/\{\{MARGIN_TOP\}\}/g, `${effMarginTop}mm`)
    .replace(/\{\{MARGIN_BOTTOM\}\}/g, `${effMarginBottom}mm`)
    .replace(/\{\{MARGIN_LEFT\}\}/g, `${effMarginLeft}mm`)
    .replace(/\{\{MARGIN_RIGHT\}\}/g, `${effMarginRight}mm`)
    .replace(/\{\{FONT_SIZE\}\}/g, `${opts.fontSize}pt`);

  // GB 页眉标准号：奇数页靠右、偶数页靠左。Chrome 原生 headerTemplate 只有单一模板，
  // 做不到奇偶差异，改由 Paged.js 的命名页 margin box 绘制（故标准号在这里动态成 CSS）。
  const stdno = fm['标准号'] || fm.standard || '';
  const pageCss = profile.gbDoc ? gbHeaderCss(stdno) : '';
  const finalCss = pageCss ? css + '\n' + pageCss : css;

  const kicker = opts.kicker || fm.kicker || fm.category || (profile.kicker ?? '');

  // 学术论文：报头三件套（作者行 + 「摘要」块 + 「关键词」行）
  const authorsHtml = profile.paperHeader && (fm.author || fm.affiliation)
    ? '<p class="authors">' +
      (fm.author ? '<span class="author">' + esc(fm.author) + '</span>' : '') +
      (fm.affiliation ? '<span class="affil">' + esc(fm.affiliation) + '</span>' : '') +
      '</p>'
    : '';
  const coverHtml = profile.gbDoc ? buildCover(fm, title) : '';
  const paperHtml = profile.paperHeader
    ? [
        fm.abstract ? '<div class="abstract"><span class="paper-label">摘要</span><span>' + esc(fm.abstract) + '</span></div>' : '',
        fm.keywords ? '<div class="keywords"><span class="paper-label">关键词</span><span>' + esc(fm.keywords) + '</span></div>' : '',
      ].filter(Boolean).join('\n')
    : '';
  const colophonLeft = opts.colophon ?? (profile.skillMeta && fm.name ? `SKILL · ${fm.name}` : path.basename(mdPath));
  const colophonRight = opts.colophon ? '' : title;
  // GB 标准没有文末落款；且落款元素会干扰 Paged.js 的命名页分页（多出空白页），故整体不输出
  const colophonHtml = profile.gbDoc ? '' :
    `<div class="colophon">\n  <span>${esc(colophonLeft)}</span>\n  <span>${esc(colophonRight)}</span>\n</div>`;

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

  // Paged.js：PDF 渲染路径仅 GB 类型启用（@page 命名页 / 奇偶页眉 / target-counter，
  // 见 docs/gb-template.md）。--paged-html 时脚本改注入 paged-html 产物（见下方 pagedOut），
  // 两份 HTML 必须分离 —— 否则非 gb 的 PDF 会被 Paged.js 二次分页。
  // 时序：必须等 MathJax / Mermaid 渲染完成再分页，否则按错误尺寸切页。
  const pagedUrl = pathToFileURL(path.join(ROOT, 'vendor', 'pagedjs', 'paged.polyfill.min.js')).href;
  const pagedScriptsBlock = () => [
    '<script>window.PagedConfig = { auto: false };</script>',
    '<script src="' + pagedUrl + '"></script>',
    '<script>',
    'window.__md2pdfPagedReady = false;',
    '(function () {',
    '  function depsReady() {',
    '    return window.__md2pdfMathReady !== false && window.__md2pdfMermaidReady !== false;',
    '  }',
    '  function run() {',
    '    if (!depsReady()) { setTimeout(run, 50); return; }',
    '    try {',
    '      window.PagedPolyfill.preview()',
    '        .then(function () { window.__md2pdfPagedReady = true; })',
    '        .catch(function () { window.__md2pdfPagedReady = true; });',
    '    } catch (e) { window.__md2pdfPagedReady = true; }',
    '  }',
    '  if (document.readyState === "complete") run(); else window.addEventListener("load", run);',
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
  const headMeta = profile.gbDoc
    ? Object.entries(fm)
        .filter(([k, v]) => fmStr(v).trim() && !GB_COVER_KEYS.has(k))
        .map(([k, v]) => '<meta name="gb:' + esc(k) + '" content="' + esc(fmStr(v)) + '">')
        .join('\n')
    : '';

  const shell = await readFile(path.join(ASSETS, 'shell.html'), 'utf8');
  const out = fill(shell, {
    '{{TITLE}}': esc(title),
    '{{CSS}}': finalCss,
    '{{KICKER}}': esc(kicker),
    '{{LEAD}}': lead,
    '{{META}}': opts.meta ? buildMeta(fm, profile.skillMeta) : '',
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
  // 这些 CSS 只追加进 paged-html 产物，不影响 PDF 渲染路径。
  let pagedOut = null;
  if (opts.pagedHtml) {
    const footFont = 'font: 8pt/1 -apple-system, "PingFang SC", sans-serif; color: #8a8578; letter-spacing: .5px;';
    const pageBoxes = profile.gbDoc ? '' : [
      '@page {',
      '  @bottom-center { content: counter(page) " / " counter(pages); ' + footFont + ' }',
      opts.footerLeft ? '  @bottom-left { content: ' + JSON.stringify(opts.footerLeft) + '; ' + footFont + ' }' : '',
      opts.footerRight ? '  @bottom-right { content: ' + JSON.stringify(opts.footerRight) + '; ' + footFont + ' }' : '',
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


  const footerTemplate = `<div style="width:100%;font-size:8px;color:#8a8578;font-family:-apple-system,'PingFang SC',sans-serif;letter-spacing:.5px;display:flex;justify-content:space-between;padding:0 12mm;">
      <span style="flex:1;text-align:left;">${esc(opts.footerLeft || '')}</span>
      <span style="flex:1;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></span>
      <span style="flex:1;text-align:right;">${esc(opts.footerRight || '')}</span>
    </div>`;

  // GB：页眉/页码改由 Paged.js 的 @page margin box 绘制（奇偶页位置不同、前置罗马/正文阿拉伯），
  // 必须关掉 Chrome 原生的 headerTemplate/footerTemplate，否则同页会出现两套页码。
  const usePaged = !!profile.gbDoc;
  const headerTemplate = '<span></span>';

  const assetHtml = value => context.assetBase ? value.replaceAll(pathToFileURL(ROOT + path.sep).href, context.assetBase.replace(/\/$/, '') + '/') : value;
  return { title, html: assetHtml(out), pagedHtml: pagedOut && assetHtml(pagedOut), type: profile.name,
    printOptions: { footer: usePaged ? false : opts.footer, footerTemplate, header: false, headerTemplate,
      landscape: opts.landscape, outline: opts.outline, waitMath: hasMath, waitMermaid: hasMermaid, waitPaged: usePaged } };
}
