import { Lexer } from '../vendor/marked.esm.js';

// Verify the reconstructed source using the same Markdown tokenizer as the renderer.
function inlineStates(raw) {
  const result = [];
  const htmlStack = [];
  function visit(tokens, styles = []) {
    for (const token of tokens) {
      const style = { strong: 'bold', em: 'italic', del: 'strike' }[token.type];
      if (style) { if (!visit(token.tokens, [...styles, style])) return false; }
      else if (token.type === 'html') {
        const match = /^<(\/?)(strong|em|del)>$/i.exec(token.raw);
        if (!match) return false;
        const name = { strong: 'bold', em: 'italic', del: 'strike' }[match[2].toLowerCase()];
        if (match[1]) { if (htmlStack.pop() !== name) return false; }
        else htmlStack.push(name);
      } else if (token.type === 'text' && !token.tokens) {
        for (let i = 0; i < token.text.length; i++) result.push([token.text[i], [...new Set([...styles, ...htmlStack])].sort().join(',')]);
      } else if (token.type === 'text' && token.tokens) { if (!visit(token.tokens, styles)) return false; }
      else return false;
    }
    return true;
  }
  return visit(Lexer.lexInline(raw, { gfm: true })) && !htmlStack.length ? result : null;
}
function rebuild(source, item, positions, nodes, from, to, format) {
  const type = mark => ({ '<strong>': 'bold', '<em>': 'italic', '<del>': 'strike', '**': 'bold', '__': 'bold', '~~': 'strike', '*': 'italic', '_': 'italic' })[mark];
  const states = positions.map(pos => ({ char: source[pos], pos, styles: ['bold', 'italic', 'strike'].filter(s => nodes.some(n => type(n.mark) === s && pos >= n.begin && pos < n.end)) }));
  const actual = inlineStates(source.slice(item.from, item.to));
  const matches = (parsed, expected) => parsed && parsed.length === expected.length && parsed.every((p, i) => p[0] === expected[i].char && p[1] === [...expected[i].styles].sort().join(','));
  if (!matches(actual, states)) return null;
  const chosen = states.filter(s => s.pos >= from && s.pos < to);
  if (!chosen.length) return null;
  const add = !chosen.every(s => s.styles.includes(format));
  for (const s of chosen) s.styles = ['bold', 'italic', 'strike'].filter(style => style === format ? add : s.styles.includes(style));
  const tags = { bold: 'strong', italic: 'em', strike: 'del' };
  let insert = '', stack = [], selectionFrom, selectionTo;
  for (const s of states) {
    let common = 0;
    while (common < stack.length && common < s.styles.length && stack[common] === s.styles[common]) common++;
    for (let i = stack.length - 1; i >= common; i--) insert += `</${tags[stack[i]]}>`;
    for (let i = common; i < s.styles.length; i++) insert += `<${tags[s.styles[i]]}>`;
    stack = s.styles;
    if (s.pos === from) selectionFrom = item.from + insert.length;
    insert += s.char;
    if (s.pos === to - 1) selectionTo = item.from + insert.length;
  }
  for (let i = stack.length - 1; i >= 0; i--) insert += `</${tags[stack[i]]}>`;
  if (selectionFrom !== undefined && selectionTo !== undefined && matches(inlineStates(insert), states)) return { from: item.from, to: item.to, insert, selectionFrom, selectionTo };
  return null;
}

// Offsets are UTF-16 source positions with an exclusive end.
export function formatPreviewSelection(source, selection, format) {
  const marker = { bold: '**', italic: '*', strike: '~~' }[format];
  const { from, to, item } = selection || {};
  if (!marker || typeof source !== 'string' || !item || !['text', 'heading'].includes(item.kind) || !Array.isArray(item.positions) || !Number.isInteger(from) || !Number.isInteger(to) || from >= to || from < item.from || to > item.to || item.from < 0 || item.to > source.length) return null;
  const positions = item.positions;
  if (!positions.length || positions.some((p, i) => !Number.isInteger(p) || p < item.from || p >= item.to || (i && p <= positions[i - 1]))) return null;
  const start = positions.indexOf(from), end = positions.indexOf(to - 1);
  if (start < 0 || end < start || /\s/.test(source[from]) || /\s/.test(source[to - 1])) return null;
  const raw = source.slice(item.from, item.to);
  if (/[\r\n\\&\[\]`$|]/.test(raw)) return null;
  const stack = [], nodes = [], delimiters = new Set();
  for (let i = 0; i < raw.length;) {
    const c = raw[i];
    if (c === '<') {
      const tag = /^<(\/?)(strong|em|del)>/i.exec(raw.slice(i));
      if (!tag) return null;
      const mark = `<${tag[2].toLowerCase()}>`;
      for (let j = 0; j < tag[0].length; j++) delimiters.add(item.from + i + j);
      if (tag[1]) {
        if (stack.at(-1)?.mark !== mark) return null;
        const node = stack.pop(); node.end = item.from + i; nodes.push(node);
      } else stack.push({ mark, begin: item.from + i + tag[0].length });
      i += tag[0].length; continue;
    }
    if (c === '>') return null;
    if (!'*_~'.includes(c)) { i++; continue; }
    let n = 1; while (raw[i + n] === c) n++;
    if (n > 2 || (c === '~' && n !== 2)) return null;
    const mark = c.repeat(n), previous = raw[i - 1] || '', next = raw[i + n] || '';
    if (c === '_' && /[\p{L}\p{N}]/u.test(previous) && /[\p{L}\p{N}]/u.test(next)) return null;
    const close = previous && !/\s/.test(previous), open = next && !/\s/.test(next);
    for (let j = 0; j < n; j++) delimiters.add(item.from + i + j);
    if (stack.at(-1)?.mark === mark && close) {
      const node = stack.pop(); node.end = item.from + i; node.after = node.end + n; nodes.push(node);
    } else if (open && !stack.some(node => node.mark === mark)) {
      stack.push({ mark, before: item.from + i, begin: item.from + i + n });
    } else return null;
    i += n;
  }
  if (stack.length) return null;
  const mappedPositions = new Set(positions);
  for (let i = item.from; i < item.to; i++) if (delimiters.has(i) === mappedPositions.has(i)) return null;
  return rebuild(source, item, positions, nodes, from, to, format);
}
