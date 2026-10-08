// 预览位置关联（按章节粗定位）
//
// attachSourcePositions(html, md)：在「已渲染的预览 HTML」上，为与 Markdown 标题
// 顺序对应的 h2–h6 标题写入 data-md2pdf-source-line="<源行号>"，供预览点击标题 →
// 编辑器跳转、以及编辑器光标 → 预览滚动（均由前端桥接）使用。
//
// 设计边界：
//   * 只改写标题的开始标签，不触碰标题内部（可能含被转义的用户内容），不改变版式；
//   * 仅在「层级相同且纯文本匹配」时写入；不匹配的标题保持原样，不臆造行号；
//   * 编号前缀剥离只识别 md2pdf 渲染器已知的编号格式（阿拉伯 / 第X章 / 中文 / 括号 /
//     GB 附录字母），不做泛化猜测；
//   * Markdown 侧只统计 frontmatter 与代码围栏之外的 ATX（可选 setext）标题。
//
// 这是预览专用映射，不追求逐行或逐像素同步。

// 渲染后的 h2–h6 标题（渲染器只输出这些层级；h1 已提升为文档标题）。
const HEADING_RE = /<h([2-6])([^>]*)>([\s\S]*?)<\/h\1>/g;

// md2pdf 渲染期注入的自动编号前缀（见 src/numbering.mjs / render.mjs numberHeadings）。
const RENDER_NUMBER_PREFIX = new RegExp(
  '^\\s*(?:' +
    '\\d+(?:\\.\\d+)*\\s+' +          // 1 / 1.1 / 1.1.1
    '|[A-Z]\\.\\d+(?:\\.\\d+)*\\s+' + // 附录 A.1 / A.1.2
    '|第\\s*\\d+\\s*[章节篇]\\s*' +      // 第 1 章
    '|[一二三四五六七八九十百千]+[、.．]\\s*' + // 一、/ 一.
    '|（\\s*[一二三四五六七八九十百千\\d]+\\s*）\\s*' + // （一）/（1）
    '|\\d+\\s*[、.．]\\s*' +                 // 1、/ 1.
  ')'
);

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

function codePoint(n) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
}

export function decodeEntities(text) {
  return text.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z][a-zA-Z0-9]*));/g, (match, hex, dec, name) => {
    if (hex != null) return codePoint(parseInt(hex, 16));
    if (dec != null) return codePoint(parseInt(dec, 10));
    const named = NAMED_ENTITIES[name];
    return named == null ? match : named;
  });
}

function stripTags(inner) { return inner.replace(/<[^>]*>/g, ''); }

function normalize(text) { return decodeEntities(stripTags(text)).replace(/\s+/g, ' ').trim().normalize('NFC'); }

// 把标题里的行内 Markdown 还原为纯文本，便于与渲染后的标题文本比较。
function markdownHeadingText(raw) {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\\([\\`*_{}\[\]()#+\-.!~])/g, '$1');
}

/**
 * 解析 Markdown 中 frontmatter 与代码围栏之外的标题。
 * 返回 [{ line: 1-based 行号, level, text }]，text 为原始标题文本。
 */
export function parseMarkdownHeadings(md) {
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let i = 0;
  // 跳过起始 frontmatter（与 render.mjs splitFrontmatter 一致的闭合方式）。
  if (lines[0] != null && /^---[ \t]*$/.test(lines[0])) {
    for (let j = 1; j < lines.length; j++) {
      if (/^---[ \t]*$/.test(lines[j])) { i = j + 1; break; }
    }
  }
  let fence = null; // { char, len }
  for (; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.len && /^\s*$/.test(fenceMatch[2])) fence = null;
      continue;
    }
    if (fenceMatch) { fence = { char: fenceMatch[1][0], len: fenceMatch[1].length }; continue; }
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (atx) {
      const text = (atx[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
      out.push({ line: i + 1, level: atx[1].length, text });
      continue;
    }
    // setext：非空行 + 紧随的下划线行（仅当上一行是普通正文行）。
    const next = lines[i + 1];
    if (next && line.trim() && !/^ {0,3}(#{1,6}|>|[-*+] |\d+[.)] |\|)/.test(line)) {
      const su = /^ {0,3}(=+|-+)[ \t]*$/.exec(next);
      if (su) { out.push({ line: i + 1, level: su[1][0] === '=' ? 1 : 2, text: line.trim() }); i++; }
    }
  }
  return out;
}

/**
 * 为预览 HTML 的渲染标题写入源行号。
 * @param {string} html 渲染后的完整预览 HTML
 * @param {string} md   原始 Markdown
 * @returns {string} 带 data-md2pdf-source-line 的 HTML（幂等）
 */
export function attachSourcePositions(html, md) {
  if (typeof html !== 'string') throw new TypeError('attachSourcePositions 需要 HTML 字符串');
  if (typeof md !== 'string') throw new TypeError('attachSourcePositions 需要 Markdown 字符串');
  if (!/<h[2-6][\s>]/.test(html)) return html;
  const targets = parseMarkdownHeadings(md)
    .filter(h => h.level >= 2 && h.level <= 6)
    .map(h => ({ line: h.line, level: h.level, norm: normalize(markdownHeadingText(h.text)) }));
  if (!targets.length) return html;
  let pointer = 0;
  return html.replace(HEADING_RE, (match, level, attrs, inner) => {
    if (/(?:^|\s)data-md2pdf-source-line\s*=/.test(attrs)) return match; // 幂等：已标注不再重复
    const lvl = Number(level);
    const rawNorm = normalize(inner);
    const strippedNorm = normalize(inner.replace(RENDER_NUMBER_PREFIX, ''));
    let found = -1;
    for (let k = pointer; k < targets.length && k < pointer + 6; k++) {
      const target = targets[k];
      if (target.level !== lvl) continue;
      if (target.norm === rawNorm || target.norm === strippedNorm) { found = k; break; }
    }
    if (found < 0) return match;
    pointer = found + 1;
    return '<h' + level + attrs + ' data-md2pdf-source-line="' + targets[found].line + '">' + inner + '</h' + level + '>';
  });
}
