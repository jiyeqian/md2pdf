import { installInlineScripts } from './inline-scripts.mjs';
import { elements, tableColumns } from './gb-content.mjs';
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
installInlineScripts(contentParser);
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
  return {
    body:output.join('\n'),
    get css() {
      return [...numbers.values()].map(number => `.gb-footnote-${number}::footnote-call { content: "${number})"; } .gb-footnote-${number}::footnote-marker { content: none; }`).join('\n');
    },
    finalize(html) {
      if (!html.includes('data-md2pdf-gb-note-slot="' + marker)) return html;
      numbers.clear();
      const all=elements(html), owners=new Map(), scoped=new Map(), edits=[];
      let scopeNumber=0;
      for(const node of all) {
        const slot=/data-md2pdf-gb-note-slot="([^"]+)"/.exec(node.token)?.[1];
        if(!slot?.startsWith(marker))continue;
        const index=Number(slot.slice(marker.length,-3)), id=occurrences[index];
        if(id===undefined)continue;
        let owner=node.parent;
        while(owner?.tag && !['table','figure'].includes(owner.tag)) {
          if(/class="[^"]*\bgb-table-group\b/.test(owner.token)){owner=owner.children.find(n=>n.tag==='table');break;}
          owner=owner.parent;
        }
        if(!owner?.tag)owner=null;
        const key=owner?owner.start:'body';
        if(owners.has(id)&&owners.get(id)!==key)throw inputError('国家标准脚注跨正文或不同图表重复使用：'+id+'；请使用不同标识');
        owners.set(id,key);
        if(!owner) {
          const repeated=numbers.has(id);
          if(!repeated)numbers.set(id,numbers.size+1);
          const number=numbers.get(id);
          const text=repeated
            ? '<sup class="gb-footnote-repeat"><a href="#gb-footnote-'+number+'">'+number+')</a></sup>'
            : '<span class="gb-footnote gb-footnote-'+number+'" id="gb-footnote-'+number+'" data-note="'+number+')"><span class="gb-footnote-label">'+number+')</span><span class="gb-footnote-content">'+contentParser.parseInline(definitions.get(id))+'</span></span>';
          edits.push({start:node.start,end:node.end,text});
        } else {
          if(!scoped.has(key))scoped.set(key,{owner,number:++scopeNumber,notes:new Map()});
          const scope=scoped.get(key);
          if(!scope.notes.has(id)) {
            if(scope.notes.size===26)throw inputError('单个图表脚注超过26条，请拆分图表');
            scope.notes.set(id,String.fromCharCode(97+scope.notes.size));
          }
          const letter=scope.notes.get(id),target='gb-'+owner.tag+'-footnote-'+scope.number+'-'+letter;
          edits.push({start:node.start,end:node.end,text:'<sup class="gb-float-footnote-call"><a href="#'+target+'">'+letter+'</a></sup>'});
        }
      }
      for(const scope of scoped.values()) {
        const {owner,number,notes}=scope;
        const text=[...notes].map(([id,letter])=>'<div class="gb-'+owner.tag+'-footnote" id="gb-'+owner.tag+'-footnote-'+number+'-'+letter+'"><p><span class="gb-label"><sup>'+letter+'</sup></span><span class="gb-note-text">'+contentParser.parseInline(definitions.get(id))+'</span></p></div>').join('\n');
        if(owner.tag==='table') {
          const rows=all.filter(n=>n.tag==='tr'&&n.start>owner.start&&n.end<owner.end&&(()=>{let p=n.parent;while(p?.tag!=='table'&&p?.tag)p=p.parent;return p===owner;})());
          const foot=owner.children.find(n=>n.tag==='tfoot');
          const row='<tr class="gb-table-footnotes"><td colspan="'+tableColumns(rows)+'">'+text+'</td></tr>';
          edits.push({start:foot?.closeStart??owner.closeStart,end:foot?.closeStart??owner.closeStart,text:foot?row:'<tfoot>'+row+'</tfoot>'});
        } else {
          const at=owner.children.find(n=>n.tag==='figcaption')?.start??owner.closeStart;
          edits.push({start:at,end:at,text});
        }
      }
      for(const edit of edits.sort((a,b)=>b.start-a.start))html=html.slice(0,edit.start)+edit.text+html.slice(edit.end);
      return html;
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
