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
  if (/[\r\n\\&<>\[\]`$|!]/.test(raw)) return null;
  const stack = [], nodes = [], delimiters = new Set();
  for (let i = 0; i < raw.length;) {
    const c = raw[i];
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
  const target = format === 'bold' ? ['**', '__'] : format === 'italic' ? ['*', '_'] : ['~~'];
  const overlap = nodes.filter(node => from < node.after && to > node.before);
  if (overlap.some(node => (from > node.before && from < node.begin) || (to > node.end && to < node.after) || (from <= node.before && to > node.before && to < node.after) || (from > node.before && from < node.after && to >= node.after))) return null;
  const active = nodes.filter(node => target.includes(node.mark) && from >= node.begin && to <= node.end);
  if (active.length > 1) return null;
  if (active.length) {
    const node = active[0];
    if ((from !== node.begin || to !== node.end) && overlap.some(other => other !== node && other.before < to && other.after > from)) return null;
    const left = source.slice(node.begin, from), selected = source.slice(from, to), right = source.slice(to, node.end);
    if ((left && /\s$/.test(left)) || (right && /^\s/.test(right))) return null;
    const prefix = left ? node.mark + left + node.mark : '';
    const suffix = right ? node.mark + right + node.mark : '';
    return { from: node.before, to: node.after, insert: prefix + selected + suffix, selectionFrom: node.before + prefix.length, selectionTo: node.before + prefix.length + selected.length };
  }
  if (overlap.some(node => target.includes(node.mark))) return null;
  if (!/[\p{L}\p{N}]/u.test(source[from]) || !/[\p{L}\p{N}]/u.test(source[to - 1])) return null;
  let insertionMarker = marker;
  if (/[*_~]/.test(source[from - 1] || '') || /[*_~]/.test(source[to] || '')) {
    const enclosing = nodes.filter(node => node.begin === from && node.end === to);
    if (enclosing.length !== 1) return null;
    const outer = enclosing[0].mark;
    if (outer[0] === insertionMarker[0]) insertionMarker = format === 'bold' ? '__' : format === 'italic' ? '_' : insertionMarker;
    if (outer[0] === insertionMarker[0]) return null;
  }
  const selected = source.slice(from, to);
  return { from, to, insert: insertionMarker + selected + insertionMarker, selectionFrom: from + insertionMarker.length, selectionTo: to + insertionMarker.length };
}
