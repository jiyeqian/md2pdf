import { Marked } from '../vendor/marked.esm.js';
import { installInlineScripts } from './inline-scripts.mjs';

// Preview metadata uses UTF-16 offsets, just like CodeMirror. No annotations are
// inserted into Markdown or printed HTML, so measuring it cannot change layout.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', times: '×', divide: '÷', plusmn: '±', deg: '°' };
const slice = (value, from, to) => ({ text: value.text.slice(from, to), positions: value.positions.slice(from, to) });
const append = (to, from, start = 0, end = from.length) => { for (let i = start; i < end; i++) to.push(from[i]); };

function normalizedSource(source) {
  let text = ''; const positions = [];
  for (let i = 0; i < source.length; i++) {
    positions.push(i);
    if (source[i] === '\r') { text += '\n'; if (source[i + 1] === '\n') i++; }
    else text += source[i];
  }
  return { text, positions };
}

function canonical(value) {
  let text = ''; const positions = []; let pending = -1;
  for (let i = 0; i < value.text.length; i++) {
    if (/\s/.test(value.text[i])) { if (text && pending < 0) pending = value.positions[i]; continue; }
    if (pending >= 0) { text += ' '; positions.push(pending); pending = -1; }
    text += value.text[i]; positions.push(value.positions[i]);
  }
  return { text, positions };
}

function decode(value) {
  let text = ''; const positions = []; let cursor = 0;
  for (const match of value.text.matchAll(/&(?:#x([\da-f]+)|#(\d+)|([a-z]+));/gi)) {
    text += value.text.slice(cursor, match.index); append(positions, value.positions, cursor, match.index);
    let decoded = ENTITIES[match[3]];
    if (match[1] || match[2]) {
      const number = parseInt(match[1] || match[2], match[1] ? 16 : 10);
      if (number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)) decoded = String.fromCodePoint(number);
    }
    if (decoded === undefined) { text += match[0]; append(positions, value.positions, match.index, match.index + match[0].length); }
    else { text += decoded; for (let i = 0; i < decoded.length; i++) positions.push(value.positions[match.index]); }
    cursor = match.index + match[0].length;
  }
  text += value.text.slice(cursor); append(positions, value.positions, cursor);
  return { text, positions };
}

// A nested block's raw text has had quote/list prefixes stripped by Marked.
// Project only within its parent and in source order, checking every line.
function project(raw, parent, cursor = 0) {
  const index = parent.text.indexOf(raw, cursor);
  if (index >= 0) return { ...slice(parent, index, index + raw.length), end: index + raw.length };
  const positions = []; let at = cursor;
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === lines.length - 1 && !line) break;
    let found = false;
    while (at <= parent.text.length) {
      const end = parent.text.indexOf('\n', at), limit = end < 0 ? parent.text.length : end;
      const whole = parent.text.slice(at, limit), offset = line ? whole.indexOf(line) : whole.length;
      if (offset >= 0 && /^[\s>\-*+\d.)\[\]xX]*$/.test(whole.slice(0, offset)) && !whole.slice(offset + line.length).trim()) {
        append(positions, parent.positions, at + offset, at + offset + line.length);
        at += offset + line.length;
        if (i < lines.length - 1) { if (end < 0) return null; positions.push(parent.positions[end]); at = end + 1; }
        found = true; break;
      }
      if (whole.trim() && !/^[\s>]*$/.test(whole)) return null;
      if (end < 0) return null;
      at = end + 1;
    }
    if (!found) return null;
  }
  if (positions.length !== raw.length) return null;
  return { text: raw, positions, end: at };
}

function splitTableRow(region) {
  const cells = []; let start = 0, escaped = false;
  for (let i = 0; i <= region.text.length; i++) {
    const char = region.text[i];
    if (i === region.text.length || (char === '|' && !escaped)) {
      let from = start, to = i;
      while (from < to && /\s/.test(region.text[from])) from++;
      while (to > from && /\s/.test(region.text[to - 1])) to--;
      const raw = slice(region, from, to); let text = ''; const positions = [];
      for (let j = 0; j < raw.text.length; j++) {
        if (raw.text[j] === '\\' && raw.text[j + 1] === '|') j++;
        text += raw.text[j]; positions.push(raw.positions[j]);
      }
      cells.push({ text, positions }); start = i + 1;
    }
    escaped = char === '\\' ? !escaped : false;
  }
  if (/^\s*\|/.test(region.text)) cells.shift();
  if (/\|\s*$/.test(region.text) && !/\\\|\s*$/.test(region.text)) cells.pop();
  return cells;
}

function unquote(region) {
  let text = ''; const positions = [];
  for (const line of region.text.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!line[0]) continue;
    const prefix = /^ {0,3}>[ \t]?/.exec(line[0]);
    const start = line.index + (prefix?.[0].length || 0), end = line.index + line[0].length;
    text += region.text.slice(start, end); append(positions, region.positions, start, end);
  }
  return { text, positions };
}

/** Build verified, token-local source ranges for preview navigation. */
export function buildContentSourceMap(markdown, { type, referenceKeys: renderedReferenceKeys } = {}) {
  const source = String(markdown ?? '');
  const original = normalizedSource(source), chars = original.text.split(''), citationChars = chars.slice();
  const out = [], references = [], lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n' || (source[i] === '\r' && source[i + 1] !== '\n')) lineStarts.push(i + 1);
  const lineAt = offset => {
    let lo = 0, hi = lineStarts.length;
    while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid; }
    return lo + 1;
  };
  const add = (kind, tag, region, visible = { text: '', positions: [] }, extra = {}) => {
    if (!region?.positions.length) return;
    const from = region.positions[0], to = region.positions.at(-1) + (source[region.positions.at(-1)] === '\r' && source[region.positions.at(-1) + 1] === '\n' ? 2 : 1);
    const value = canonical(visible);
    out.push({ id: out.length, kind, tag, from, to, line: lineAt(from), ...value, ...extra });
  };
  const mask = (from, to, citations = false) => { for (let i = from; i < to; i++) if (chars[i] !== '\n') { chars[i] = ' '; if (citations) citationChars[i] = ' '; } };
  const fm = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(original.text);
  const gb = type === 'gb' || (type === undefined && /^type:[ \t]*["']?gb["']?[ \t]*(?:#.*)?$/m.test(fm?.[0] || ''));
  const pageNoteKeys = new Set();
  const begin = fm?.[0].length || 0; mask(0, begin, true);
  const lines = [...original.text.matchAll(/[^\n]*(?:\n|$)/g)].filter(line => line[0]);
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i], text = row[0].replace(/\n$/, ''); if (row.index < begin) continue;
    const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if (boundary) { if (!fence) fence = boundary[1]; else if (boundary[1][0] === fence[0] && boundary[1].length >= fence.length && !boundary[2].trim()) fence = null; continue; }
    if (fence) continue;
    const pageNote = gb && /^ {0,3}\[\^(@[^\]\s]+)\]:[ \t]*(.*)$/.exec(text);
    const definition = pageNote || /^\[\^([^\]]+)\]:[ \t]*(.*)$/.exec(text);
    if (definition) {
      let end = row.index + row[0].length;
      const continuation = pageNote ? /^(?: {4}|\t)\S/ : /^[ \t]+\S/;
      while (i + 1 < lines.length && continuation.test(lines[i + 1][0])) { i++; end = lines[i].index + lines[i][0].length; }
      if (pageNote) pageNoteKeys.add(definition[1]);
      else references.push({ key: definition[1], region: slice(original, row.index, end) });
      mask(row.index, end, true); continue;
    }
  }
  fence = null;
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i], text = row[0].replace(/\n$/, ''); if (row.index < begin) continue;
    const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if (boundary) { if (!fence) fence = boundary[1]; else if (boundary[1][0] === fence[0] && boundary[1].length >= fence.length && !boundary[2].trim()) fence = null; continue; }
    if (fence) continue;
    const directive = /^ {0,3}:::(kicker|colophon|gb-([\w-]+))(?:[ \t].*)?$/.exec(text);
    if (directive) {
      const atomic = ['kicker', 'colophon', 'gb-table', 'gb-term', 'gb-index', 'gb-index-section', 'gb-equation', 'gb-subfigure'].includes(directive[1]);
      if (atomic) {
        let depth = 1, innerFence = null, end = row.index + row[0].length, j = i + 1;
        for (; j < lines.length; j++) {
          const value = lines[j][0].replace(/\n$/, ''), code = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(value);
          if (code) { if (!innerFence) innerFence = code[1]; else if (code[1][0] === innerFence[0] && code[1].length >= innerFence.length && !code[2].trim()) innerFence = null; continue; }
          if (innerFence) continue;
          if (/^ {0,3}:::[a-z]/.test(value)) depth++;
          if (/^ {0,3}:::[ \t]*$/.test(value) && --depth === 0) { end = lines[j].index + lines[j][0].length; break; }
        }
        if (!depth) {
          if (directive[1].startsWith('gb-')) add('object', directive[1] === 'gb-table' ? 'table' : 'div', slice(original, row.index, end), undefined, { key: directive[1] });
          mask(row.index, end, !directive[1].startsWith('gb-')); i = j; continue;
        }
      }
      mask(row.index, row.index + row[0].length);
    } else if (/^ {0,3}:::[ \t]*$/.test(text)) mask(row.index, row.index + row[0].length);
  }

  const referenceKeys = new Set(Array.isArray(renderedReferenceKeys) ? renderedReferenceKeys : references.map(item => item.key));
  const referenceNumbers = new Map();
  const body = chars.join('');
  if (Array.isArray(renderedReferenceKeys)) renderedReferenceKeys.forEach((key, index) => { if (!referenceNumbers.has(key)) referenceNumbers.set(key, index + 1); });
  else {
    for (const match of citationChars.join('').matchAll(/\[\^([^\]]+)\]/g)) if (referenceKeys.has(match[1]) && !referenceNumbers.has(match[1])) referenceNumbers.set(match[1], referenceNumbers.size + 1);
    for (const item of references) if (!referenceNumbers.has(item.key)) referenceNumbers.set(item.key, referenceNumbers.size + 1);
  }
  const marked = new Marked({ gfm: true });
  installInlineScripts(marked);
  marked.use({ extensions: [
    { name: 'sourceMathBlock', level: 'block', start(text) { return /(?:^|\n) {0,3}\$\$/.exec(text)?.index; }, tokenizer(text) { const m = /^ {0,3}\$\$[\s\S]*?\$\$(?:[ \t]*(?:\n|$))/.exec(text); if (m) return { type: 'sourceMathBlock', raw: m[0] }; } },
    { name: 'sourceOmitted', level: 'inline', start(text) { return /\$|\\(?:eqref|ref)\{|\[\^/.exec(text)?.index; }, tokenizer(text) {
      const match = /^(?:\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\(?:eqref|ref)\{[\w:.-]+\})/.exec(text);
      if (match) return { type: 'sourceOmitted', raw: match[0], math: match[0][0] === '$' };
      const cite = /^\[\^([^\]]+)\]/.exec(text); if (cite && (referenceKeys.has(cite[1]) || pageNoteKeys.has(cite[1]))) return { type: 'sourceOmitted', raw: cite[0] };
    } },
  ] });

  function inline(tokens, region) {
    let text = ''; const positions = []; let cursor = 0;
    for (const token of tokens || []) {
      const raw = project(token.raw, region, cursor); if (!raw) continue; cursor = raw.end;
      if (token.type === 'sourceOmitted') { if (token.math) add('math', 'mjx-container', raw); continue; }
      if (token.type === 'image') { add('image', 'img', raw); continue; }
      let visible;
      if (token.tokens) {
        const content = project(token.text, raw); if (content) visible = inline(token.tokens, content);
      } else if (token.type === 'codespan') {
        const ticks = /^`+/.exec(raw.text)[0].length;
        let content = slice(raw, ticks, raw.text.length - ticks);
        content.text = content.text.replace(/\n/g, ' ');
        if (/^ .* $/.test(content.text) && /[^ ]/.test(content.text)) content = slice(content, 1, -1);
        visible = content;
      } else if (token.type === 'mdSuperscript' || token.type === 'mdSubscript') {
        const body = slice(raw, 2, -1); let text = ''; const positions = [];
        for (let i = 0; i < body.text.length; i++) {
          if (body.text[i] === '\\' && /[{}^_\\]/.test(body.text[i + 1] || '')) i++;
          text += body.text[i]; positions.push(body.positions[i]);
        }
        visible = { text, positions };
      } else if (token.type === 'escape') visible = { text: token.text, positions: Array(token.text.length).fill(raw.positions.at(-1)) };
      else if (token.type === 'br') visible = { text: '\n', positions: [raw.positions.at(-1)] };
      else visible = decode(raw);
      if (visible) { text += visible.text; append(positions, visible.positions); }
    }
    return { text, positions };
  }

  function visit(tokens, parent, textTag = 'p') {
    let cursor = 0;
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
      const token = tokens[tokenIndex];
      const raw = project(token.raw, parent, cursor); if (!raw) continue; cursor = raw.end;
      if (token.type === 'list') {
        let itemCursor = 0;
        for (const item of token.items) {
          const itemRaw = project(item.raw, raw, itemCursor); if (!itemRaw) continue; itemCursor = itemRaw.end;
          const marker = /^\s*(?:[-+*]|\d+[.)])(?:[ \t]+|$)/.exec(itemRaw.text);
          let itemBody = marker ? slice(itemRaw, marker[0].length) : itemRaw;
          const task = item.task && /^\[[ xX]\][ \t]+/.exec(itemBody.text);
          if (task) itemBody = slice(itemBody, task[0].length);
          const content = project(item.text, itemBody);
          if (content) {
            const before = out.length; visit(item.tokens, content, item.loose ? 'p' : 'li');
            const first = out.slice(before).find(entry => entry.kind === 'text');
            if (first) { first.from = itemRaw.positions[0]; first.line = lineAt(first.from); }
          }
        }
      } else if (token.type === 'blockquote') {
        const content = project(token.text, unquote(raw)); if (content) visit(token.tokens, content);
      } else if (token.type === 'table') {
        const rows = [...raw.text.matchAll(/[^\n]+/g)], tableRows = [token.header, ...token.rows];
        for (let i = 0; i < tableRows.length; i++) {
          const row = rows[i ? i + 1 : 0]; if (!row) continue;
          const cells = splitTableRow(slice(raw, row.index, row.index + row[0].length));
          for (let j = 0; j < tableRows[i].length; j++) {
            const cell = cells[j], value = tableRows[i][j]; if (!cell || cell.text !== value.text) continue;
            add('text', i ? 'td' : 'th', cell, inline(value.tokens, cell));
          }
        }
      } else if (token.type === 'sourceMathBlock') add('math', 'mjx-container', raw);
      else if (token.type === 'code') {
        if (/^mermaid(?:\s|$)/i.test(token.lang || '')) add('diagram', 'pre', raw);
        else {
          const opening = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(raw.text);
          const body = opening ? slice(raw, opening[0].length) : raw;
          const content = project(token.text, body); if (content) add('code', 'pre', raw, content);
          else add('code', 'pre', raw);
        }
      } else if (token.type === 'heading' || token.type === 'paragraph' || token.type === 'text') {
        const attributes = token.type === 'heading' && /\s*\{([^{}]*(?:#[\w:.-]+|(?:role|subtitle|nature)=)[^{}]*)\}\s*$/.exec(token.text);
        let value = attributes ? token.text.slice(0, attributes.index) : token.text;
        const caption = token.type === 'paragraph' && /^(表|图)\s*[：:]\s*/.exec(value);
        const next = caption && tokens.slice(tokenIndex + 1).find(entry => entry.type !== 'space');
        const captionTag = caption && ((caption[1] === '表' && next?.type === 'table') ? 'caption'
          : caption[1] === '图' && next?.type === 'code' && /^mermaid(?:\s|$)/i.test(next.lang || '') ? 'figcaption' : null);
        if (captionTag) value = value.slice(caption[0].length).replace(/\s*\{#(?:tab|fig):[\w.-]+\}\s*/g, ' ').trim();
        const prefix = token.type === 'heading' && /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(raw.text);
        const content = project(value, prefix ? slice(raw, prefix[0].length) : raw); if (!content) continue;
        const visible = inline(attributes || captionTag ? marked.Lexer.lexInline(value, { ...marked.defaults, extensions: marked.defaults.extensions }) : token.tokens, content);
        if (canonical(visible).text) add(token.type === 'heading' ? 'heading' : 'text', token.type === 'heading' ? 'h' + token.depth : captionTag || textTag, raw, visible,
          attributes ? { role: /\brole=([\w-]+)/.exec(attributes[1])?.[1] } : {});
      }
    }
  }
  visit(marked.lexer(body), { text: body, positions: original.positions });
  for (const item of references) if (referenceNumbers.has(item.key)) add('reference', 'li', item.region, undefined, { key: item.key, number: referenceNumbers.get(item.key) });
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return out.map((item, id) => ({ ...item, id }));
}
