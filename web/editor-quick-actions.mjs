/** Context-sensitive editor actions. Transformations retain the selected source text. */
export function protectedRanges(text) {
  const ranges = [];
  const fm = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
  if (fm) ranges.push([0, fm[0].endsWith("\n") ? fm[0].length-1 : fm[0].length]);
  const lines = text.split('\n'); let offset = 0, open = null;
  for (const line of lines) {
    if (!open) {
      const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) open = { start: offset, char: fence[1][0], length: fence[1].length };
      else if (/^\s*\$\$\s*\r?$/.test(line)) open = { start: offset, math: true };
      else if (/^\s*\$\$[\s\S]+\$\$\s*\r?$/.test(line)) ranges.push([offset,offset+line.length]);
    } else if (open.math ? /^\s*\$\$\s*\r?$/.test(line) : new RegExp('^\\s{0,3}' + open.char + '{' + open.length + ',}\\s*\\r?$').test(line)) {
      ranges.push([open.start, offset + line.length]); open = null;
    }
    offset += line.length + 1;
  }
  if (open) ranges.push([open.start, text.length]);
  return ranges;
}
export function isProtected(text, from, to = from) {
  return protectedRanges(text).some(([a,b]) => from === to ? from >= a && from <= b : from < b && to > a);
}
export function selectionActions(text, from, to) {
  if (from === to || isProtected(text, from, to)) return [];
  return text.slice(from,to).includes('\n') ? ['ul','ol','quote'] : ['link','bold','italic','strike'];
}
export function transformSelection(text, from, to, action) {
  if (!selectionActions(text,from,to).includes(action)) return null;
  if (['link','bold','italic','strike'].includes(action)) {
    const selected = text.slice(from,to);
    if (action === 'link') {
      const existing = /^\[([\s\S]*)\]\([^\n]*\)$/.exec(selected);
      if (existing) return { from,to,text:existing[1],anchor:from,head:from+existing[1].length };
      const suffix = /^\]\([^\n]*\)/.exec(text.slice(to));
      if (text[from-1] === '[' && suffix) return { from:from-1,to:to+suffix[0].length,text:selected,anchor:from-1,head:to-1 };
      return { from,to,text:'['+selected+'](https://)',anchor:from+1,head:to+1 };
    }
    const mark = { bold:'**',italic:'*',strike:'~~' }[action];
    if (selected.startsWith(mark) && selected.endsWith(mark) && selected.length >= mark.length*2) {
      const value = selected.slice(mark.length,-mark.length);
      return { from,to,text:value,anchor:from,head:from+value.length };
    }
    if (text.slice(from-mark.length,from) === mark && text.slice(to,to+mark.length) === mark && (action !== 'italic' || (text[from-2] !== '*' && text[to+1] !== '*'))) {
      return { from:from-mark.length,to:to+mark.length,text:selected,anchor:from-mark.length,head:to-mark.length };
    }
    return { from,to,text:mark+selected+mark,anchor:from+mark.length,head:to+mark.length };
  }
  const start = text.lastIndexOf('\n',from-1)+1;
  const last = to > from && text[to-1] === '\n' ? to-1 : to;
  const next = text.indexOf('\n',last); const end = next < 0 ? text.length : next;
  const lines = text.slice(start,end).split('\n');
  const parsed = lines.map(line => { const m = /^(\s*)(?:(?:[-+*]|\d+[.)])\s+|>\s?)/.exec(line); const indent = /^[ \t]*/.exec(line)[0]; return {line,indent,old:m ? m[0].length-indent.length : 0}; });
  const same = parsed.every(p => action === 'quote' ? /^>\s?/.test(p.line.slice(p.indent.length)) : action === 'ol' ? /^\d+[.)]\s+/.test(p.line.slice(p.indent.length)) : /^[-+*]\s+/.test(p.line.slice(p.indent.length)));
  let oldOffset=start,newOffset=start;
  const original = [from,to], mapped = [from,to];
  const values = parsed.map((p,index) => {
    const prefix = same ? '' : action === 'ul' ? '- ' : action === 'ol' ? (index+1)+'. ' : '> ';
    const oldPrefix=p.indent.length+p.old, newPrefix=p.indent.length+prefix.length;
    for (let i=0;i<2;i++) if (original[i] >= oldOffset && original[i] <= oldOffset+p.line.length) mapped[i]=newOffset+Math.max(newPrefix,original[i]-oldOffset-oldPrefix+newPrefix);
    const value=p.indent+prefix+p.line.slice(oldPrefix);
    oldOffset+=p.line.length+1;newOffset+=value.length+1; return value;
  });
  if (to > end) mapped[1]=newOffset;
  return {from:start,to:end,text:values.join('\n'),anchor:mapped[0],head:mapped[1]};
}
const labels = {link:'链接',bold:'粗体',italic:'斜体',strike:'删除线',ul:'无序列表',ol:'有序列表',quote:'引用块',image:'图片',table:'表格',codeblock:'代码块',formula:'公式块'};
const paths = {link:'M10 8l4-4a4 4 0 015 5l-4 4M14 16l-4 4a4 4 0 01-5-5l4-4M8 16l8-8',bold:'M7 4h6a4 4 0 010 8H7zm0 8h7a4 4 0 010 8H7z',italic:'M10 4h8M6 20h8M15 4L9 20',strike:'M5 12h14M17 6c-6-5-14 4-6 6 8 2 4 11-3 6',ul:'M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1',ol:'M9 6h11M9 12h11M9 18h11M3 4h1v4M3 11h2l-2 3h2M3 17h2v3H3',quote:'M4 5h6v7H7l-3 6M14 5h6v7h-3l-3 6',image:'M3 4h18v16H3zM3 17l6-6 4 4 3-3 5 5M7 8h1',table:'M3 4h18v16H3zM3 10h18M10 4v16',codeblock:'M8 6l-5 6 5 6M16 6l5 6-5 6M14 3l-4 18',formula:'M5 2h10M5 18h10M6 5h8l-4.5 5 4.5 5H6'};
export function installQuickActions(editor) {
  const doc = document;
  const menu = doc.createElement('div');menu.className='md-quick-actions';menu.setAttribute('role','toolbar');menu.hidden=true;doc.body.append(menu);
  let mode=null,range=null,index=0,dismissed=null;
  const close=()=>{menu.hidden=true;mode=null;range=null;};
  const show=(kind,sel,actions)=>{
    const key=kind+':'+sel.from+':'+sel.to+':'+editor.getValue(); if (dismissed===key) return;
    const same=mode===kind && range?.from===sel.from && range?.to===sel.to && menu.dataset.key===key;
    if (same) return;
    mode=kind;range={...sel};index=0;menu.dataset.key=key;menu.replaceChildren();
    for (const action of actions) {
      const button=doc.createElement('button');button.type='button';button.dataset.action=action;button.title=labels[action];button.setAttribute('aria-label',labels[action]);
      const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',action==='formula'?'0 0 20 20':'0 0 24 24');svg.setAttribute('aria-hidden','true');const path=doc.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[action]);svg.append(path);button.append(svg);
      button.addEventListener('mousedown',e=>e.preventDefault());button.addEventListener('click',()=>activate(action));menu.append(button);
    }
    menu.hidden=false; const coords=editor.coordsAtPos(sel.from); if(coords) {menu.style.left=Math.max(4,Math.min(coords.left,innerWidth-actions.length*32-12))+'px';menu.style.top=Math.max(4,coords.top-38)+'px';}
    mark();
  };
  const mark=()=>Array.from(menu.children).forEach((b,i)=>b.classList.toggle('is-active',i===index));
  const activate=action=>{
    const saved=range,kind=mode;close();if(!saved)return;
    const text=editor.getValue();
    if(kind==='selection') {const change=transformSelection(text,saved.from,saved.to,action);if(change)editor.applyEdit(change.from,change.to,change.text,change.anchor,change.head);}
    else {editor.applyEdit(saved.from-1,saved.from,'',saved.from-1,saved.from-1);editor.focus();if(action==='image')doc.querySelector('.md-image-insert')?.click();else window.mdEditorTools?.insert(action);}
    if(kind==='selection')editor.focus();
  };
  const update=()=>{
    const sel=editor.getSelection(),text=editor.getValue();const actions=selectionActions(text,sel.from,sel.to);
    if(actions.length){show('selection',sel,actions);return;}
    const line=text.slice(text.lastIndexOf('\n',sel.from-1)+1,sel.from);const tail=text.slice(sel.from,text.indexOf('\n',sel.from)<0?text.length:text.indexOf('\n',sel.from));
    if(sel.from===sel.to && /^[ \t]*\/$/.test(line) && /^[ \t\r]*$/.test(tail) && !isProtected(text,sel.from)){show('slash',sel,['image','table','codeblock','formula']);return;}
    close();dismissed=null;
  };
  for(const event of ['md-editor-selection','md-editor-change','md-editor-reset'])doc.addEventListener(event,update);
  doc.addEventListener('keydown',event=>{
    if(menu.hidden)return;
    if(event.key==='Escape'){dismissed=menu.dataset.key;close();event.preventDefault();return;}
    if(mode==='slash' && ['ArrowLeft','ArrowRight','Enter'].includes(event.key)){event.preventDefault();event.stopPropagation();if(event.key==='Enter')activate(menu.children[index].dataset.action);else{index=(index+(event.key==='ArrowRight'?1:-1)+menu.children.length)%menu.children.length;mark();}}
  },true);
  doc.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)){dismissed=menu.dataset.key;close();}});
  const reposition=()=>{if(menu.hidden)return;const active=index;close();update();index=Math.min(active,menu.children.length-1);mark();};
  window.addEventListener('scroll',reposition,true);window.addEventListener('resize',reposition);
  return {close,update};
}
