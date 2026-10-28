const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const OPEN = /^ {0,3}:::gb-(note|example|term|source|unit|subfigure|table-note|important|figure-note|figure-footnote|table-footnote|index|equation)(?:[ \t]+(.*))?[ \t]*$/;
const CLOSE = /^ {0,3}:::[ \t]*$/;

// Structured GB blocks are opt-in: ordinary prose beginning with 注/示例 is unchanged.
// Keep Markdown code fences opaque, including directives used as source examples.
export function prepareGbContent(source, depth = 0) {
  const lines = String(source).split('\n');
  const blocks = [];
  let marker = 'MD2PDFGBBLOCK';
  while (source.includes(marker)) marker += 'X';
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (boundary) {
      if (!fence) fence = boundary[1];
      else if (boundary[1][0] === fence[0] && boundary[1].length >= fence.length && !boundary[2].trim()) fence = null;
      out.push(lines[i]);
      continue;
    }
    const open = !fence && OPEN.exec(lines[i]);
    if (!open) { out.push(lines[i]); continue; }
    let depth = 1, end = i + 1, innerFence = null;
    for (; end < lines.length; end++) {
      const code = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[end]);
      if (code) {
        if (!innerFence) innerFence = code[1];
        else if (code[1][0] === innerFence[0] && code[1].length >= innerFence.length && !code[2].trim()) innerFence = null;
        continue;
      }
      if (innerFence) continue;
      if (OPEN.test(lines[end])) depth++;
      else if (CLOSE.test(lines[end]) && --depth === 0) break;
    }
    if (depth) { out.push(lines[i]); continue; }
    if (open[1] === 'term' && !/^\d+(?:\.\d+)+$/.test((open[2] || '').trim())) {
      out.push(...lines.slice(i, end + 1)); i = end; continue;
    }
    const key = marker + blocks.length + 'END';
    blocks.push({ key, role: open[1], label: (open[2] || '').trim(), text: lines.slice(i + 1, end).join('\n') });
    out.push('', key, '');
    i = end;
  }
  return {
    body: out.join('\n'),
    restore(html, marked) {
      for (const block of blocks) {
        const output = renderBlock(block, marked, depth);
        html = html.replace('<p>' + block.key + '</p>', () => output);
      }
      return html;
    },
  };
}

function markdown(text, marked, depth = 0) {
  // Raw HTML cannot add attributes or active content, even in the CLI renderer.
  // Nested semantic blocks are restored only after parsing this escaped source.
  const prepared = depth < 16 ? prepareGbContent(text, depth + 1) : null;
  let html = marked.parse((prepared ? prepared.body : text).replace(/</g, '&lt;').replace(/>/g, '&gt;'), { gfm: true, async: false });
  if (prepared) html = prepared.restore(html, marked);
  return html.replace(/<(a|img)\b[^>]*>/g, tag => tag.replace(/\b(href|src)="([^"]*)"/g, (attribute, name, raw) => {
    const url = raw.replace(/&#(?:x([\da-f]+)|(\d+));?/gi, (_, hex, dec) => String.fromCodePoint(Math.min(parseInt(hex || dec, hex ? 16 : 10), 0x10ffff)))
      .replace(/&colon;/g, ':').replace(/&Tab;|&NewLine;/g, '').replace(/[\u0000-\u0020]/g, '');
    const safe = name === 'href' ? /^(?:https?:|mailto:|#)/i.test(url) : /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(url);
    return safe ? attribute : name + '="' + (name === 'href' ? '#' : '') + '"';
  }));
}

function renderBlock({ role, label, text }, marked, depth) {
  if (role === 'index') {
    const rows = text.split('\n').map(line => line.trim()).filter(Boolean);
    const entries = rows.map(line => {
      const separator = line.indexOf('|');
      return separator < 0 ? null : [line.slice(0,separator).trim(), line.slice(separator+1).trim()];
    });
    if ((label && !/^[A-Za-z]$/.test(label)) || !entries.length || entries.some(entry => !entry || !entry[0] || !entry[1])) {
      const error = new Error('gb-index 分组只支持单个英文字母，条目必须为“关键词 | 章条、图表或附录位置”');
      error.status = 400; throw error;
    }
    return '<div class="gb-index">' + (label ? '<div class="gb-index-letter">' + escape(label) + '</div>' : '')
      + '<ul class="gb-index-entries">' + entries.map(([term,locations]) => '<li><span class="gb-index-term">' + escape(term)
        + '</span><span class="gb-index-dots"></span><span class="gb-index-locations">' + escape(locations) + '</span></li>').join('') + '</ul></div>';
  }
  if (role === 'term') {
    const rows = text.trim().split('\n');
    const gap = rows.findIndex(line => !line.trim());
    const names = (gap < 0 ? rows.slice(0, 1) : rows.slice(0, gap)).map(line => escape(line.trim())).join('　');
    const definition = gap < 0 ? rows.slice(1).join('\n') : rows.slice(gap + 1).join('\n');
    return '<div class="gb-term"><div class="gb-term-number">' + escape(label) + '</div><div class="gb-term-name">' + names + '</div><div class="gb-term-definition">' + markdown(definition, marked, depth) + '</div></div>';
  }
  if (['figure-footnote', 'table-footnote'].includes(role) && !label) {
    const error = new Error('图、表脚注必须显式填写脚注标记（例如 a））');
    error.status = 400; throw error;
  }
  const defaults = { note: '注：', example: '示例：', source: '来源：', 'table-note': '注：', 'figure-note': '注：' };
  const title = label || defaults[role] || '';
  const content = markdown(text, marked, depth);
  if (role === 'important') {
    const paragraphs = content.match(/<p>[\s\S]*?<\/p>/g) || [];
    const remainder = content.replace(/<p>[\s\S]*?<\/p>/g, '').trim();
    const inlineTags = new Set(['a','abbr','b','br','cite','code','del','em','i','kbd','mark','q','s','samp','small','span','strong','sub','sup','time','u','var']);
    if (remainder || !paragraphs.length || [...content.matchAll(/<\/?([a-z][\w-]*)\b/gi)].some(match => match[1].toLowerCase() !== 'p' && !inlineTags.has(match[1].toLowerCase()))) {
      const error = new Error('gb-important 只支持普通段落和行内格式，不支持列表、代码块或嵌套语义块');
      error.status = 400; throw error;
    }
  }
  // The label stays on the first line where possible, including multi-paragraph notes.
  const lead = title ? '<span class="gb-label">' + escape(title) + '</span>' : '';
  const hanging = ['note', 'table-note', 'figure-note', 'figure-footnote', 'table-footnote'].includes(role);
  const body = lead && content.startsWith('<p>')
    ? content.replace(/^<p>([\s\S]*?)<\/p>/, (_, first) => '<p>' + lead + (hanging ? '<span class="gb-note-text">' + first + '</span>' : first) + '</p>')
    : lead + content;
  return '<div class="gb-' + role + '">' + body + '</div>';
}

export function transformGbContent(html, title) {
  html = html.replace(/<h2([^>]*\bclass="[^"]*\bbody-start\b[^"]*"[^>]*)>([\s\S]*?)<\/h2>/, (_, attrs, inner) =>
    '<h2' + attrs + '>' + (title ? '<span class="gb-body-title">' + escape(title) + '</span>' : '') + '<span class="gb-first-heading">' + inner + '</span></h2>');
  html = html.replace(/<h2([^>]*\bclass="[^"]*\bappendix\b[^"]*"[^>]*)>([\s\S]*?)<\/h2>/g, (whole, attrs, inner) => {
    // Appendix metadata is explicit in the heading; do not invent its normative status.
    const text = inner.replace(/<[^>]*>/g, '').trim();
    const match = /^附录\s*([A-Z])\s*[（(](规范性|资料性)[）)]\s*(.+)$/is.exec(text);
    if (!match) return whole;
    return '<h2' + attrs + '><span class="gb-appendix-number">附录 ' + match[1].toUpperCase() + '</span><span class="gb-appendix-kind">（' + match[2] + '）</span><span class="gb-appendix-title">' + match[3] + '</span></h2>';
  });
  return attachFloatNotes(fillEmptyTableCells(placeImportant(html)));
}


const VOID_ELEMENTS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const TABLE_NOTES = new Set(['gb-table-note', 'gb-table-footnote']);
const FIGURE_NOTES = new Set(['gb-figure-note', 'gb-figure-footnote']);
const FLOAT_NOTES = new Set([...TABLE_NOTES, ...FIGURE_NOTES]);

// Pair real tags instead of matching </div> with a lazy regex: a note can contain
// nested paragraphs and semantic divs. Only adjacent sibling blocks are attached.
function elements(html) {
  const root = {children:[]}, stack = [root], all = [];
  const tags = /<!--[\s\S]*?-->|<\/?([A-Za-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;
  for (const match of html.matchAll(tags)) {
    if (!match[1]) continue;
    const tag = match[1].toLowerCase(), token = match[0];
    if (token.startsWith('</')) {
      const index = stack.findLastIndex(node => node.tag === tag);
      if (index < 1) continue;
      const node = stack[index];
      node.closeStart = match.index; node.end = match.index + token.length;
      stack.length = index;
      continue;
    }
    const node = {tag, start:match.index, openEnd:match.index + token.length, token, parent:stack.at(-1), children:[]};
    node.parent.children.push(node); all.push(node);
    if (VOID_ELEMENTS.has(tag) || /\/\s*>$/.test(token)) node.end = node.openEnd;
    else stack.push(node);
  }
  return all;
}
function classes(node) {
  return /\bclass="([^"]*)"/.exec(node.token)?.[1].split(/\s+/) || [];
}
function noteRole(node, allowed) {
  return node.tag === 'div' && classes(node).some(name => allowed.has(name));
}
function fillEmptyTableCells(html) {
  const edits = [];
  for (const cell of elements(html)) {
    if (!['td', 'th'].includes(cell.tag) || cell.closeStart === undefined) continue;
    let parent = cell.parent;
    while (parent?.tag && parent.tag !== 'table') parent = parent.parent;
    if (!parent || !/^\s*$/.test(html.slice(cell.openEnd, cell.closeStart))) continue;
    edits.push({ start: cell.openEnd, end: cell.closeStart });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    html = html.slice(0, edit.start) + '—' + html.slice(edit.end);
  }
  return html;
}

function tableColumns(rows) {
  let max = 1, occupied = [], group = null;
  for (const row of rows) {
    // Row spans do not cross row-group boundaries; rowspan=0 extends to its end.
    if (row.parent !== group) { group = row.parent; occupied = []; }
    let column = 0;
    for (const cell of row.children.filter(child => ['td', 'th'].includes(child.tag))) {
      while (occupied[column] > 0) column++;
      const attr = name => new RegExp('\\b' + name + '\\s*=\\s*["\']?(\\d+)', 'i').exec(cell.token)?.[1];
      const width = Math.max(1, Math.min(1000, Number(attr('colspan')) || 1));
      const rawHeight = attr('rowspan');
      const height = rawHeight === '0' ? Infinity : Math.max(1, Math.min(65534, Number(rawHeight) || 1));
      for (let i = column; i < column + width; i++) occupied[i] = Math.max(occupied[i] || 0, height);
      column += width;
    }
    max = Math.max(max, occupied.length);
    occupied = occupied.map(value => value === Infinity ? value : Math.max(0, value - 1));
  }
  return max;
}
function attachFloatNotes(html) {
  const all = elements(html), edits = [];
  for (const node of all) {
    if (!['table','figure'].includes(node.tag) || !node.end) continue;
    // Nested floats inside a note are preserved, not independently reassigned.
    let parent = node.parent, nested = false;
    while (parent?.tag) {
      if (['table','figure'].includes(parent.tag) || noteRole(parent,FLOAT_NOTES)) { nested = true; break; }
      parent = parent.parent;
    }
    if (nested) continue;
    const allowed = node.tag === 'table' ? TABLE_NOTES : FIGURE_NOTES;
    const siblings = node.parent.children, after = siblings.indexOf(node) + 1, notes = [];
    let end = node.end;
    for (const next of siblings.slice(after)) {
      if (!next.end || !noteRole(next,allowed) || !/^\s*$/.test(html.slice(end,next.start))) break;
      notes.push(next); end = next.end;
    }
    if (!notes.length) continue;
    const content = notes.map(note => html.slice(note.start,note.end)).join('\n');
    let insert, markup;
    if (node.tag === 'figure') {
      insert = node.children.find(child => child.tag === 'figcaption')?.start ?? node.closeStart;
      markup = content + '\n';
    } else {
      const rows = all.filter(row => row.tag === 'tr' && row.start > node.start && row.end < node.end && (() => {
        let table = row.parent; while (table && table.tag !== 'table') table = table.parent;
        return table === node;
      })());
      const columns = tableColumns(rows);
      const foot = node.children.find(child => child.tag === 'tfoot' && child.closeStart !== undefined);
      insert = foot?.closeStart ?? node.closeStart;
      const row = '<tr class="gb-table-notes"><td colspan="' + columns + '">' + content + '</td></tr>';
      markup = foot ? row : '<tfoot>' + row + '</tfoot>';
    }
    edits.push({start:node.start,end,text:html.slice(node.start,insert) + markup + html.slice(insert,node.end)});
  }
  for (const edit of edits.sort((a,b) => b.start-a.start)) html = html.slice(0,edit.start) + edit.text + html.slice(edit.end);
  return html;
}


function placeImportant(html) {
  const all = elements(html);
  const heading = all.find(node => node.tag === 'h2' && classes(node).includes('body-start'));
  if (!heading?.end) return html;
  const firstHeading = heading.children.find(node => classes(node).includes('gb-first-heading'));
  if (!firstHeading) return html;
  const siblings = heading.parent.children, blocks = [];
  let end = heading.end;
  for (const next of siblings.slice(siblings.indexOf(heading)+1)) {
    if (!next.end || next.tag !== 'div' || !classes(next).includes('gb-important') || !/^\s*$/.test(html.slice(end,next.start))) break;
    const content = html.slice(next.openEnd,next.closeStart).replace(/<p>/g,'<span class="gb-important-paragraph">').replace(/<\/p>/g,'</span>');
    blocks.push('<span class="gb-important">'+content+'</span>');
    end = next.end;
  }
  if (!blocks.length) return html;
  return html.slice(0,firstHeading.start) + blocks.join('\n') + html.slice(firstHeading.start,heading.end) + html.slice(end);
}
