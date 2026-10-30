import { renderGbTable } from './gb-tables.mjs';
import { GB_BLOCKS, parseGbParameters } from './gb-blocks.mjs';
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const OPEN = new RegExp('^ {0,3}:::gb-(' + GB_BLOCKS.map(block => block.name).join('|') + ')(?:[ \t]+(.*))?[ \t]*$');
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
    if (!fence && /^\s*<!--\s*gb-check:.*?-->\s*$/.test(lines[i])) continue;
    if (!fence && /^ {0,3}:::gb-[\w-]+(?:\s|$)/.test(lines[i]) && !OPEN.test(lines[i])) {
      const error = new Error('未知或已移除的GB指令：' + lines[i].trim() + '；请使用新版 gb-note 参数语法'); error.status = 400; throw error;
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
    if (depth) {
      if (['table','index-section','note'].includes(open[1])) { const error = new Error('gb-' + open[1] + '：块未闭合'); error.status = 400; throw error; }
      out.push(lines[i]); continue;
    }
    if (open[1] === 'term' && !/^(?:(\d+(?:\.\d+)+)(?:\s+|$))?(?:id=([A-Za-z][\w:-]*))?$/.test((open[2] || '').trim())) {
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
  if (role === 'note') return renderNote(label, text, marked, depth);
  if (role === 'table') return renderGbTable(text, label, marked);
  if (role === 'index-section') {
    const params = parseGbParameters(label, ['lang','columns']);
    if (!['zh','en'].includes(params.lang) || (params.columns && !['1','2'].includes(params.columns)) || (params.lang === 'en' && params.columns === '2')) {
      const error = new Error('gb-index-section 使用 lang=zh（默认双栏，可选columns=1）或 lang=en（单栏）'); error.status = 400; throw error;
    }
    const content = markdown(text, marked, depth);
    const roots = elements(content).filter(n=>!n.parent?.tag);
    if (!roots.length || roots.some(n=>n.tag !== 'div' || !classes(n).includes('gb-index'))) {
      const error = new Error('gb-index-section 内仅支持 gb-index 字母分组'); error.status = 400; throw error;
    }
    const lang=params.lang, columns=params.columns || (lang === 'zh' ? '2' : '1');
    return '<div class="gb-index-section gb-index-'+lang+'" data-gb-index-lang="'+lang+'"><div class="gb-index-section-title">'+(lang==='zh'?'汉语拼音索引':'英文对应词索引')+'</div><div class="gb-index-columns" data-gb-index-columns="'+columns+'">'+content+'</div></div>';
  }
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
    const args = /^(?:(\d+(?:\.\d+)+)(?:\s+|$))?(?:id=([A-Za-z][\w:-]*))?$/.exec(label);
    const number = args?.[1] || '', key = args?.[2] || '';
    return '<div class="gb-term"' + (number || key ? ' id="gb-term-' + escape(key || number) + '"' : '') + (key ? ' data-gb-term-key="' + escape(key) + '"' : '') + (number ? '' : ' data-gb-term-auto="true"') + '><div class="gb-term-number">' + number + '</div><div class="gb-term-name">' + names + '</div><div class="gb-term-definition">' + markdown(definition, marked, depth) + '</div></div>';
  }
  let exampleLayout = 'block';
  if (role === 'example') {
    const layout = /(?:^|\s)layout=(\S+)/.exec(label);
    if (layout) {
      if (!['block', 'inline'].includes(layout[1])) {
        const error = new Error('gb-example layout 仅支持 block 或 inline'); error.status = 400; throw error;
      }
      exampleLayout = layout[1];
      label = label.replace(layout[0], '').trim();
    }
  }
  const defaults = { example: '示例：' };
  const title = label || defaults[role] || '';
  const content = markdown(text, marked, depth);
  if (role === 'example' && exampleLayout === 'inline' &&
      (!/^<p>[\s\S]*<\/p>\s*$/.test(content) || /<\/?(?:div|ul|ol|table|pre|blockquote|h[1-6])\b/.test(content) || (content.match(/<p>/g)||[]).length !== 1)) {
    const error = new Error('gb-example layout=inline 只支持单个文字段落；请改用 layout=block'); error.status = 400; throw error;
  }
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
  const body = lead && content.startsWith('<p>')
    ? content.replace(/^<p>([\s\S]*?)<\/p>/, (_, first) => '<p>' + lead + (role === 'example' && exampleLayout === 'block' ? '<span class="gb-example-text">' + first + '</span>' : first) + '</p>')
    : lead + content;
  return '<div class="gb-' + role + (role === 'example' ? ' gb-example-' + exampleLayout : '') + '"' + (role === 'example' && !label ? ' data-gb-example-auto="true"' : '') + '>' + body + '</div>';
}

function renderNote(argumentsText, text, marked, depth) {
  const args = parseGbParameters(argumentsText, ['scope','position','align','label','weight']);
  const fail = message => { const error = new Error('gb-note：' + message); error.status = 400; throw error; };
  if (args.scope !== undefined && !['table','figure'].includes(args.scope)) fail('scope 仅支持 table 或 figure');
  if (args.position !== undefined && !['top','bottom'].includes(args.position)) fail('position 仅支持 top 或 bottom');
  if (args.align !== undefined && !['left','center','right'].includes(args.align)) fail('align 仅支持 left、center 或 right');
  if (args.weight !== undefined && !['bold','normal'].includes(args.weight)) fail('weight 仅支持 bold 或 normal');
  const position = args.position || 'bottom', align = args.align || 'left';
  const lead = args.label ? '<span class="gb-label">' + escape(args.label) + '</span>' : '';
  const attributes = (args.scope ? ' data-gb-note-scope="' + args.scope + '"' : '') + ' data-gb-note-position="' + position + '" data-gb-note-align="' + align + '"' + (lead && args.weight === 'normal' ? ' data-gb-note-weight="normal"' : '');
  const content = markdown(text, marked, depth);
  const role = args.scope ? args.scope + '-note' : 'note';
  const body = lead && content.startsWith('<p>') ? content.replace(/^<p>([\s\S]*?)<\/p>/, (_,first)=>'<p>'+lead+'<span class="gb-note-text">'+first+'</span></p>') : lead + content;
  return '<div class="gb-' + role + (lead ? '' : ' gb-unlabelled') + '"' + attributes + '>' + body + '</div>';
}

export function transformGbContent(html, title) {
  html = html.replace(/<h2([^>]*class="[^"]*\bback\b[^"]*"[^>]*)>(参考文献)<\/h2>/g,
    (_, attrs, text) => '<h2' + attrs.replace('class="', 'class="gb-references-title ') + '>' + text + '</h2>');
  html = html.replace(/<h2([^>]*class="[^"]*\bback\b[^"]*"[^>]*)>(索引)<\/h2>/g,
    (_, attrs, text) => '<h2' + attrs.replace('class="', 'class="gb-index-title ') + '>' + text + '</h2>');
  html = html.replace(/<h2([^>]*data-gb-role="(bibliography|index)"[^>]*)>([\s\S]*?)<\/h2>/g, (_,attrs,role,text)=>'<h2'+(attrs.includes('gb-'+(role==='index'?'index':'references')+'-title') ? attrs : attrs.replace('class="','class="gb-'+(role==='index'?'index':'references')+'-title '))+'>'+text+'</h2>');
  html = numberGbTerms(html);
  html = markIntroParagraphs(html);
  html = numberExamples(html);
  html = linkIndexLocations(html);

  html = html.replace(/<h2([^>]*\bclass="[^"]*\bbody-start\b[^"]*"[^>]*)>([\s\S]*?)<\/h2>/, (_, attrs, inner) =>
    '<h2' + attrs + '>' + (title ? '<span class="gb-body-title">' + escape(title) + '</span>' : '') + '<span class="gb-first-heading">' + inner + '</span></h2>');
  html = html.replace(/<h2([^>]*\bclass="[^"]*\bappendix\b[^"]*"[^>]*)>([\s\S]*?)<\/h2>/g, (whole, attrs, inner) => {
    // Appendix metadata is explicit in the heading; do not invent its normative status.
    const text = inner.replace(/<[^>]*>/g, '').trim();
    const match = /^附录\s*([A-Z])\s*(?:[（(](规范性|资料性)[）)]\s*)?(.+)$/is.exec(text);
    if (!match) return whole;
    return '<h2' + attrs + '><span class="gb-appendix-number">附录 ' + match[1].toUpperCase() + '</span>' + (match[2] ? '<span class="gb-appendix-kind">（' + match[2] + '）</span>' : '') + '<span class="gb-appendix-title">' + match[3] + '</span></h2>';
  });
  html = attachFloatNotes(fillEmptyTableCells(placeImportant(html)));
  for (const node of elements(html)) {
    const scope = /data-gb-note-scope="(table|figure)"/.exec(node.token)?.[1];
    if (!scope) continue;
    let parent = node.parent;
    while (parent?.tag && parent.tag !== scope) parent = parent.parent;
    if (!parent?.tag) { const error = new Error('gb-note scope=' + scope + '：未找到相邻的对应图表（所有图表说明均须紧接对应图表之后）'); error.status = 400; throw error; }
  }
  return html;
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
  return node.tag === 'div' && (classes(node).some(name => allowed.has(name)) || (allowed === TABLE_NOTES && /data-gb-note-scope="table"/.test(node.token)) || (allowed === FIGURE_NOTES && /data-gb-note-scope="figure"/.test(node.token)));
}
// Headings are already numbered; terms consume the next slot below their containing heading.
function numberGbTerms(html) {
  const all = elements(html), used = new Set(), ids = new Set(), counters = new Map(), edits = [];
  let prefix = '';
  const fail = message => { const error = new Error('gb-term：' + message); error.status = 400; throw error; };
  for (const node of all.filter(n => /^h[2-6]$/.test(n.tag))) {
    const number = /^(\d+(?:\.\d+)*)(?=\s|　)/.exec(html.slice(node.openEnd,node.closeStart).replace(/<[^>]*>/g,''))?.[1];
    if (number) used.add(number);
  }
  for (const node of all) {
    if (/^h[2-6]$/.test(node.tag)) {
      prefix = /^(\d+(?:\.\d+)*)(?=\s|　)/.exec(html.slice(node.openEnd,node.closeStart).replace(/<[^>]*>/g,''))?.[1] || '';
    }
    if (!classes(node).includes('gb-term')) continue;
    const field = node.children.find(n=>classes(n).includes('gb-term-number'));
    if (!field?.closeStart) continue;
    let number = html.slice(field.openEnd,field.closeStart);
    if (!number) {
      if (!prefix) fail('自动编号需要位于已编号的章或分类标题之后');
      const next = (counters.get(prefix)||0)+1;
      number = prefix + '.' + next;
    } else if (prefix && number.slice(0,number.lastIndexOf('.')) !== prefix) fail('显式编号与所在标题层级不一致：' + number);
    if (used.has(number)) fail('编号重复或与分类标题冲突：' + number);
    used.add(number);
    const parent = number.slice(0,number.lastIndexOf('.'));
    counters.set(parent,Math.max(counters.get(parent)||0,Number(number.split('.').at(-1))));
    const key = /data-gb-term-key="([^"]+)"/.exec(node.token)?.[1];
    const id = 'gb-term-' + (key || number);
    if (ids.has(id)) fail('术语标识重复：' + id);
    ids.add(id);
    let token=node.token.replace(/ id="[^"]*"/,'');
    token=token.replace(/>$/, ' id="' + id + '">');
    edits.push({start:node.start,end:node.openEnd,text:token},{start:field.openEnd,end:field.closeStart,text:number});
  }
  for (const edit of edits.sort((a,b)=>b.start-a.start)) html=html.slice(0,edit.start)+edit.text+html.slice(edit.end);
  return html;
}

function markIntroParagraphs(html) {
  const edits = [];
  for (const node of elements(html)) {
    if (node.tag !== 'p' || (node.parent?.tag && node.parent.tag !== 'section')) continue;
    const position = node.parent.children.indexOf(node);
    const following = node.parent.children.slice(position+1).find(n => /^h[2-6]$/.test(n.tag) || classes(n).includes('gb-term'));
    if (!following || (following.tag !== 'h3' && !classes(following).includes('gb-term'))) continue;
    const preceding = node.parent.children.slice(0,position);
    const heading = preceding.filter(n => /^h[2-6]$/.test(n.tag)).at(-1);
    if (heading?.tag !== 'h2' || preceding.slice(preceding.indexOf(heading)+1).some(n => classes(n).includes('gb-term'))) continue;
    edits.push({start:node.start,end:node.openEnd,text:node.token.replace('<p','<p class="gb-intro"')});
  }
  for (const edit of edits.sort((a,b)=>b.start-a.start)) html=html.slice(0,edit.start)+edit.text+html.slice(edit.end);
  return html;
}

// Number unlabelled examples within the nearest clause or terminology entry.
function numberExamples(html) {
  const groups = new Map(); let heading = 'document';
  for (const node of elements(html)) {
    if (/^h[2-6]$/.test(node.tag)) heading = node.start;
    if (!classes(node).includes('gb-example')) continue;
    let parent = node.parent;
    while (parent?.tag && !classes(parent).includes('gb-term')) parent = parent.parent;
    const scope = parent?.tag ? 'term:' + parent.start : heading;
    if (!groups.has(scope)) groups.set(scope, []);
    groups.get(scope).push(node);
  }
  const edits = [];
  for (const group of groups.values()) {
    group.forEach((node, i) => {
      if (!node.token.includes('data-gb-example-auto="true"')) return;
      const label = [...node.children, ...node.children.flatMap(n => n.children || [])].find(n => classes(n).includes('gb-label'));
      if (label?.closeStart) edits.push({start:label.openEnd,end:label.closeStart,text:group.length > 1 ? '示例' + (i + 1) + '：' : '示例：'});
    });
  }
  for (const edit of edits.sort((a,b)=>b.start-a.start)) html = html.slice(0,edit.start)+edit.text+html.slice(edit.end);
  return html;
}

// Resolve only explicit, unambiguous locations backed by an existing element ID.
function linkIndexLocations(html) {
  const all = elements(html), targets = new Map(), labels = new Map(), edits = [];
  const key = value => value.startsWith('@') ? value.trim() : value.replace(/\s+/g, '').toUpperCase();
  const add = (name, id) => {
    const k = key(name), existing = targets.get(k);
    if (name.startsWith('@') && existing !== undefined && existing !== id) throw Object.assign(new Error('稳定标识重复：' + name), {status:400});
    targets.set(k, existing === undefined ? id : existing === id ? id : null);
  };
  for (const node of all) {
    if (classes(node).includes('gb-term')) {
      const id = /\bid="([A-Za-z0-9_.:-]+)"/.exec(node.token)?.[1];
      const number = node.children.find(n => classes(n).includes('gb-term-number'));
      if (id && number?.closeStart) {
        const value=html.slice(number.openEnd,number.closeStart); add(value,id);
        const stable=/data-gb-term-key="([^"]+)"/.exec(node.token)?.[1];
        if(stable) { add('@'+stable,id); labels.set(key('@'+stable),value); }
      }
    }
    if (!node.end || !/^(?:h[2-6]|figure|table)$/.test(node.tag)) continue;
    if (classes(node).includes('gb-index-title')) continue;
    let parent = node.parent, insideIndex = false;
    while (parent?.tag) { if (classes(parent).includes('gb-index')) insideIndex = true; parent = parent.parent; }
    if (insideIndex) continue;
    const id = /\bid="([A-Za-z0-9_.:-]+)"/.exec(node.token)?.[1];
    if (!id) continue;
    const caption = node.tag === 'figure' ? node.children.find(n => n.tag === 'figcaption') : node.tag === 'table' ? node.children.find(n => n.tag === 'caption') : node;
    if (!caption?.end) continue;
    const text = html.slice(caption.openEnd, caption.closeStart).replace(/<[^>]*>/g, '').trim();
    const number = node.tag === 'figure' ? /^图\s*([A-Z]\.\d+|\d+)(?=\s|[：:、]|$)/i.exec(text)
      : node.tag === 'table' ? /^表\s*([A-Z]\.\d+|\d+)(?=\s|[：:、]|$)/i.exec(text)
      : /^(附录\s*[A-Z]|(?:[A-Z]\.)?\d+(?:\.\d+)*)(?=\s|[、：:（(]|$)/i.exec(text);
    if (number) {
      const display = (node.tag === 'figure' ? '图' : node.tag === 'table' ? '表' : '') + number[1].replace(/\s/g,'');
      add(display, id);
      const stable = /data-gb-stable-key="([^"]+)"/.exec(node.token)?.[1];
      if (stable) { add('@'+stable,id); labels.set(key('@'+stable),display); }
    }
  }
  for (const node of all) {
    if (node.tag !== 'span' || !classes(node).includes('gb-index-locations') || node.closeStart === undefined) continue;
    const value = html.slice(node.openEnd, node.closeStart);
    let unresolved = false;
    const linked = value.split(/([,，、;；/])/).map(part => {
      const location = part.trim();
      if (!/^(?:@[A-Za-z][\w:-]*|附录\s*[A-Z]|[图表]\s*(?:[A-Z]\.)?\d+|(?:[A-Z]\.)?\d+(?:\.\d+)*)$/i.test(location)) return part;
      const id = targets.get(key(location));
      if (!id) {
        if (location.startsWith('@')) throw Object.assign(new Error('索引的稳定标识不存在或重复：' + location), {status:400});
        unresolved = true; return part;
      }
      return part.replace(location, '<a href="#' + id + '">' + (labels.get(key(location)) || location) + '</a>');
    }).join('');
    if (linked !== value) edits.push({start:node.openEnd,end:node.closeStart,text:linked});
    if (unresolved) edits.push({start:node.openEnd-1,end:node.openEnd-1,text:' data-gb-index-unresolved="true"'});
  }
  for (const edit of edits.sort((a,b) => b.start-a.start)) html = html.slice(0,edit.start) + edit.text + html.slice(edit.end);
  return html;
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
    const top = [], bottom = [];
    for (const note of notes) (/data-gb-note-position="top"/.test(note.token) ? top : bottom).push(html.slice(note.start,note.end));
    const insertions = [];
    if (node.tag === 'figure') {
      if (top.length) insertions.push({at:node.openEnd,text:top.join('\n')+'\n'});
      if (bottom.length) insertions.push({at:node.children.find(child=>child.tag==='figcaption')?.start ?? node.closeStart,text:bottom.join('\n')+'\n'});
    } else {
      if (top.length) {
        const caption=node.children.find(child=>child.tag==='caption');
        const content='<div class="gb-table-top">'+top.join('\n')+'</div>';
        insertions.push({at:caption?.closeStart ?? node.openEnd,text:caption ? content : '<caption>'+content+'</caption>'});
      }
      if (bottom.length) {
        const rows = all.filter(row => row.tag === 'tr' && row.start > node.start && row.end < node.end && (() => {
          let table = row.parent; while (table && table.tag !== 'table') table = table.parent;
          return table === node;
        })());
        const columns = tableColumns(rows);
        const foot = node.children.find(child => child.tag === 'tfoot' && child.closeStart !== undefined);
        const row = '<tr class="gb-table-notes"><td colspan="' + columns + '">' + bottom.join('\n') + '</td></tr>';
        insertions.push({at:foot?.closeStart ?? node.closeStart,text:foot ? row : '<tfoot>'+row+'</tfoot>'});
      }
    }
    let output=html.slice(node.start,node.end);
    for (const insertion of insertions.sort((a,b)=>b.at-a.at)) {
      const offset=insertion.at-node.start;
      output=output.slice(0,offset)+insertion.text+output.slice(offset);
    }
    edits.push({start:node.start,end,text:output});
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
