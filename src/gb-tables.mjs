import { Lexer } from '../vendor/marked.esm.js';

function invalid(message) {
  const error = new Error('gb-table：' + message);
  error.status = 400;
  throw error;
}

function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) invalid('每行必须以 | 开始和结束');
  const cells = [];
  let cell = '';
  for (let i = 1; i < trimmed.length - 1; i++) {
    if (trimmed[i] === '\\' && trimmed[i + 1] === '|') { cell += '\\|'; i++; }
    else if (trimmed[i] === '|') { cells.push(cell.trim()); cell = ''; }
    else cell += trimmed[i];
  }
  cells.push(cell.trim());
  return cells.map(value => {
    let rowspan = 1, colspan = 1;
    if (value.startsWith('{')) {
      const match = /^\{([^}]*)\}\s*/.exec(value);
      if (!match) invalid('单元格尺寸格式无效');
      const attrs = match[1].trim().split(/\s+/);
      const seen = new Set();
      for (const attr of attrs) {
        const item = /^(rowspan|colspan)=([1-9]\d*)$/.exec(attr);
        if (!item || seen.has(item[1])) invalid('单元格尺寸格式无效');
        seen.add(item[1]);
        const n = Number(item[2]);
        if (!Number.isSafeInteger(n) || n > (item[1] === 'colspan' ? 12 : 500)) invalid('单元格尺寸超出范围');
        if (item[1] === 'rowspan') rowspan = n; else colspan = n;
      }
      value = value.slice(match[0].length);
    }
    return { value, rowspan, colspan };
  });
}

function validate(rows, columns) {
  const occupied = Array(columns).fill(0);
  const groups = [];
  let group = [];
  rows.forEach((row, index) => {
    let column = 0;
    for (const cell of row) {
      while (column < columns && occupied[column]) column++;
      if (column + cell.colspan > columns || index + cell.rowspan > rows.length) invalid('单元格超出网格或跨越行组');
      for (let i = column; i < column + cell.colspan; i++) {
        if (occupied[i]) invalid('单元格重叠');
        occupied[i] = cell.rowspan;
      }
      column += cell.colspan;
    }
    if (occupied.some(value => !value)) invalid('每行必须填满网格');
    group.push(row);
    for (let i = 0; i < columns; i++) occupied[i]--;
    if (occupied.every(value => !value)) { groups.push(group); group = []; }
  });
  return groups;
}

function inline(value, marked) {
  const check = tokens => {
    for (const token of tokens) {
      if (token.type === 'image') invalid('表格单元格不支持图片，请使用独立图');
      if (token.type === 'link') {
        const url = token.href.replace(/&#(?:x([\da-f]+)|(\d+));?/gi, (_, hex, dec) => String.fromCodePoint(Math.min(parseInt(hex || dec, hex ? 16 : 10), 0x10ffff)))
          .replace(/&colon;/gi, ':').replace(/&Tab;|&NewLine;/gi, '').replace(/[\u0000-\u0020]/g, '');
        if (!/^(?:https?:|mailto:|#)/i.test(url)) invalid('表格单元格链接仅支持 HTTP、HTTPS、邮件地址或文内锚点');
      }
      if (token.tokens) check(token.tokens);
    }
  };
  check(Lexer.lexInline(value, { gfm: true }));
  let html = marked.parseInline(value.replace(/</g, '&lt;').replace(/>/g, '&gt;'), { gfm: true, async: false });
  return html.replace(/<(a|img)\b[^>]*>/g, tag => tag.replace(/\b(href|src)="([^"]*)"/g, (attribute, name, raw) => {
    const url = raw.replace(/&#(?:x([\da-f]+)|(\d+));?/gi, (_, hex, dec) => String.fromCodePoint(Math.min(parseInt(hex || dec, hex ? 16 : 10), 0x10ffff)))
      .replace(/&colon;/gi, ':').replace(/&Tab;|&NewLine;/gi, '').replace(/[\u0000-\u0020]/g, '');
    const safe = name === 'href' ? /^(?:https?:|mailto:|#)/i.test(url) : /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(url);
    return safe ? attribute : name + '="' + (name === 'href' ? '#' : '') + '"';
  }));
}

export function renderGbTable(text, label, marked) {
  if (label) invalid('块标记不接受参数');
  let section = '', widths = null;
  const head = [], body = [];
  for (const line of text.split('\n')) {
    const value = line.trim();
    if (!value) continue;
    if (value.startsWith('widths:')) {
      if (widths || section) invalid('widths 必须位于表格开头且只能出现一次');
      const parts = value.slice(7).trim().split(/\s+/);
      if (!parts.length || parts.some(part => !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(part) || !Number.isFinite(Number(part)) || Number(part) <= 0)) invalid('列宽必须为有限正数');
      widths = parts.map(Number);
    } else if (value === 'head:') {
      if (section) invalid('head 分区重复或顺序错误');
      section = 'head';
    } else if (value === 'body:') {
      if (section !== 'head' || !head.length) invalid('body 必须位于非空 head 之后');
      section = 'body';
    } else {
      if (!section) invalid('缺少 head 分区');
      (section === 'head' ? head : body).push(splitRow(value));
    }
  }
  if (!head.length || !body.length) invalid('head 和 body 均至少需要一行');
  if (head.length + body.length > 500) invalid('行数不能超过 500');
  const columns = widths ? widths.length : head[0].reduce((sum, cell) => sum + cell.colspan, 0);
  if (!columns || columns > 12) invalid('列数必须为 1 至 12');
  if (!widths) widths = Array(columns).fill(1);
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (!Number.isFinite(total)) invalid('列宽总和超出范围');
  validate(head, columns);
  const groups = validate(body, columns);
  const rowHtml = (row, tag) => '<tr>' + row.map(cell => '<' + tag
    + (cell.rowspan > 1 ? ' rowspan="' + cell.rowspan + '"' : '')
    + (cell.colspan > 1 ? ' colspan="' + cell.colspan + '"' : '') + '>'
    + inline(cell.value, marked) + '</' + tag + '>').join('') + '</tr>';
  return '<table><colgroup>' + widths.map(width => '<col style="width:' + (width / total * 100) + '%">').join('')
    + '</colgroup><thead>' + head.map(row => rowHtml(row, 'th')).join('') + '</thead>'
    + groups.map(group => '<tbody>' + group.map(row => rowHtml(row, 'td')).join('') + '</tbody>').join('') + '</table>';
}
