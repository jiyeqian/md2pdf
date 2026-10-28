import { Marked } from '../vendor/marked.esm.js';

const inputError = message => Object.assign(new Error(message), {status:400});
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const contentParser = new Marked({ gfm:true, renderer: {
  html(token) { return escape(token.text); },
  link(token) {
    const label = this.parser.parseInline(token.tokens);
    return /^(https?:|mailto:|#)/i.test(token.href) ? '<a href="' + escape(token.href) + '">' + label + '</a>' : label;
  },
  image(token) { return escape(token.text); },
} });
contentParser.use({extensions:[{
  name:'gbFootnoteMath',level:'inline',
  start(source) { return source.indexOf('$'); },
  tokenizer(source) {
    const match=/^(?:\$\$[\s\S]+?\$\$|\$[^$\n]+\$)/.exec(source);
    if (match) return {type:'gbFootnoteMath',raw:match[0]};
  },
  renderer(token) { return escape(token.raw); },
}]});

// @ opts into a page footnote; the historical [^id] bibliography is unchanged.
// Inline tokenization lets Marked protect escapes, code, link destinations and image alt.
export function prepareGbFootnotes(source) {
  const definitions = new Map(), rows = String(source).split('\n'), output = [];
  let fence = null;
  for (let i = 0; i < rows.length; i++) {
    const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(rows[i]);
    if (boundary) {
      if (!fence) fence = {char:boundary[1][0], length:boundary[1].length};
      else if (boundary[1][0] === fence.char && boundary[1].length >= fence.length && !boundary[2].trim()) fence = null;
      output.push(rows[i]);
      continue;
    }
    const match = !fence && /^ {0,3}\[\^@([^\]\s]+)\]:[ \t]*(.*)$/.exec(rows[i]);
    if (!match) { output.push(rows[i]); continue; }
    if (definitions.has(match[1])) throw inputError('国家标准条文脚注定义重复：' + match[1]);
    let content = match[2];
    while (i + 1 < rows.length && /^(?: {4}|\t)\S/.test(rows[i + 1])) content += '\n' + rows[++i].replace(/^(?: {4}|\t)/, '');
    definitions.set(match[1], content);
  }
  const numbers = new Map(), occurrences = [];
  let marker = 'MD2PDFGBNOTESLOT';
  while (source.includes(marker)) marker += 'X';
  const slotPattern = new RegExp('<span data-md2pdf-gb-note-slot="' + marker + '(\\d+)END"></span>', 'g');
  return {
    body:output.join('\n'),
    get css() {
      return [...numbers.values()].map(number => `.gb-footnote-${number}::footnote-call { content: "${number})"; } .gb-footnote-${number}::footnote-marker { content: none; }`).join('\n');
    },
    finalize(html) {
      if (!html.includes('data-md2pdf-gb-note-slot="' + marker)) return html;
      numbers.clear();
      return html.replace(slotPattern, (slot, index) => {
        const id = occurrences[Number(index)];
        if (id === undefined) return slot;
        const repeated = numbers.has(id);
        if (!repeated) numbers.set(id, numbers.size + 1);
        const number = numbers.get(id);
        return repeated
          ? '<sup class="gb-footnote-repeat"><a href="#gb-footnote-' + number + '">' + number + ')</a></sup>'
          : '<span class="gb-footnote gb-footnote-' + number + '" id="gb-footnote-' + number + '" data-note="' + number + ')">' + '<span class="gb-footnote-label">' + number + ')</span><span class="gb-footnote-content">' + contentParser.parseInline(definitions.get(id)) + '</span></span>';
      });
    },
    extension: {
      name:'gbPageFootnote',level:'inline',
      start(source) { return source.indexOf('[^@'); },
      tokenizer(source) {
        const match = /^\[\^@([^\]\s]+)\]/.exec(source);
        if (!match) return;
        if (this.lexer.state.inLink || this.lexer.state.inRawBlock) return {type:'text',raw:match[0],text:match[0]};
        if (!definitions.has(match[1])) throw inputError('国家标准条文脚注未定义：' + match[1]);
        return {type:'gbPageFootnote',raw:match[0],id:match[1]};
      },
      renderer(token) {
        const index = occurrences.push(token.id) - 1;
        return '<span data-md2pdf-gb-note-slot="' + marker + index + 'END"></span>';

      },
    },
  };
}
