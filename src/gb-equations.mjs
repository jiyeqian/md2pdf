// Called after the GB semantic blocks and protected math have been restored.
// MathJax retains sole ownership of equation tags, labels and references.
export function applyGbEquations(html) {
  return html.replace(/<div class="gb-equation">([\s\S]*?)<\/div>/g, (original, content) => {
    const paragraphs = [...content.matchAll(/<p>([\s\S]*?)<\/p>/g)];
    if (paragraphs.length < 2 || content.replace(/<p>[\s\S]*?<\/p>/g, '').trim()) return original;
    const formula = paragraphs[0][1].trim();
    if (!/^\$\$[\s\S]+\$\$$/.test(formula)) return original;

    const lines = paragraphs.slice(1).flatMap(p => p[1].split(/\r?\n/)).map(line => line.trim()).filter(Boolean);
    if (!/^式中[：:]$/.test(lines.shift() || '') || !lines.length) return original;
    const rows = lines.map(line => {
      const separator = line.indexOf('|');
      if (separator < 0) return null;
      const symbol = line.slice(0, separator).trim();
      const definition = line.slice(separator + 1).trim();
      return symbol && definition ? [symbol, definition] : null;
    });
    if (rows.some(row => !row)) return original;
    return '<div class="gb-equation"><div class="gb-equation-formula">' + formula + '</div>'
      + '<div class="gb-equation-legend-title">式中：</div><table class="gb-equation-legend" role="presentation"><tbody>'
      + rows.map(([symbol, definition]) => '<tr><td class="gb-equation-symbol">' + symbol
        + '</td><td class="gb-equation-dash">——</td><td class="gb-equation-definition">' + definition + '</td></tr>').join('')
      + '</tbody></table></div>';
  });
}

export const GB_EQUATION_CSS = `
.gb-equation { display: inline-block; width: 100%; vertical-align: top; break-inside: avoid; }
.gb-equation-formula { text-align: center; }
.gb-equation-legend-title { margin-left: 2em; }
.gb-equation table.gb-equation-legend { width: calc(100% - 2em); margin: 0 0 0 2em; border: 0; border-collapse: collapse; table-layout: auto; font: 10.5pt/1.62 var(--font-body); }
.gb-equation table.gb-equation-legend tbody tr { background: transparent; }
.gb-equation table.gb-equation-legend tbody td, .gb-equation table.gb-equation-legend tbody td:first-child { border: 0; padding: 0; text-indent: 0; vertical-align: top; text-align: left; font: 10.5pt/1.62 var(--font-body); }
.gb-equation table.gb-equation-legend tbody td.gb-equation-symbol { width: 1px; white-space: nowrap; padding-right: .5em; }
.gb-equation table.gb-equation-legend tbody td.gb-equation-dash { width: 1px; white-space: nowrap; padding-right: .5em; }
.gb-equation table.gb-equation-legend tbody td.gb-equation-definition { overflow-wrap: anywhere; }
`;

// Run after pagination, when the cloned containers have their final width. This function is also
// serialized into the document, so it must not close over module variables.
export function finalizeGbEquations(glyphs) {
  document.querySelectorAll('.gb-equation-leader,.gb-equation-number').forEach(node => node.remove());
  const ns = 'http://www.w3.org/2000/svg';
  const make = (tag,attrs={}) => {const node=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));return node;};
  const draw = (parent,key,attrs={}) => {
    const group=make('g',attrs);for(const d of glyphs[key].paths)group.appendChild(make('path',{d}));parent.appendChild(group);return group;
  };
  const readTag = node => {
    if(node.nodeType===3)return node.textContent;
    if(node.hasAttribute?.('data-c'))return String.fromCodePoint(parseInt(node.getAttribute('data-c'),16));
    if(node.tagName?.toLowerCase()==='defs')return '';
    return [...node.childNodes].map(readTag).join('');
  };
  let serial=0;
  for (const container of document.querySelectorAll('.pagedjs_page_content mjx-container[display="true"]')) {
    const svg = container.querySelector('svg');
    if (!svg) continue;
    const rows = [...svg.querySelectorAll('[data-mml-node="mlabeledtr"]')];
    const labels = [...svg.querySelectorAll('[data-labels] > [data-mml-node="mtd"]')];
    if (!rows.length || rows.length !== labels.length) continue;
    const bounds = container.getBoundingClientRect();
    // Preview scaling must not be applied twice to CSS positions or physical point sizes.
    const scale=bounds.width/parseFloat(getComputedStyle(container).width)||1, pxPerPt=96/72;
    const width=bounds.width/scale;
    container.style.position = 'relative';
    for (let i = 0; i < rows.length; i++) {
      const formula = rows[i].getBoundingClientRect(), label=labels[i];
      label.style.visibility='';
      const original=label.getBoundingClientRect();
      const tag=readTag(label).trim(), match=/^[（(]((?:[A-Z]\.)?\d+)[）)]$/.exec(tag);
      let numberLeft=(original.left-bounds.left)/scale;
      let center=(original.top-bounds.top+original.height/2)/scale;
      if(glyphs&&match&&[...match[1]].every(c=>c==='.'||glyphs[c])){
        const number=make('svg',{'aria-hidden':'true','class':'gb-equation-number'});
        container.appendChild(number);
        const core=make('g');number.appendChild(core);let cursor=0;
        for(const char of match[1]){
          draw(core,char==='.'?'decimal':char,{transform:'translate('+cursor+' 0)'});
          cursor+=char==='.'?.582:char==='A'?9.014:char==='B'?8.24:char==='C'?8.34:char==='D'?8.63:5.24;
        }
        const ink=core.getBBox(),leftWidth=2.84375,rightWidth=2.828125,gapLeft=5.1,gapRight=5.25;
        const numberWidth=leftWidth+gapLeft+ink.width+gapRight+rightWidth;
        core.setAttribute('transform','translate('+(leftWidth+gapLeft-ink.x)+' 0)');
        draw(number,'open',{transform:'translate(-1.203125 -1.454)'});
        draw(number,'close',{transform:'translate('+(numberWidth-rightWidth-.703125)+' -1.454)'});
        number.setAttribute('viewBox','0 -9 '+numberWidth+' 10');
        number.setAttribute('width',numberWidth+'pt');number.setAttribute('height','10pt');
        // Match the original bracket/leader midline, rather than the SVG font's em-box center.
        Object.assign(number.style,{position:'absolute',right:'0',top:(center-4.6006875*pxPerPt)+'px',overflow:'visible'});
        label.style.visibility='hidden';numberLeft=width-numberWidth*pxPerPt;
        number.dataset.gbEquationTag=match[1];
      }
      let left=Math.max(0,(formula.right-bounds.left)/scale+6*pxPerPt);
      const right=Math.min(width,numberLeft-2.7*pxPerPt);
      if(!formula.width||!original.width||right<=left)continue;
      const leader=make('svg',{'class':'gb-equation-leader','aria-hidden':'true'});
      const span=Math.min((right-left)/pxPerPt,8.75+9*10.48);
      if(span<8.75)continue;
      left=right-span*pxPerPt;
      leader.setAttribute('viewBox','0 -3.703125 '+(span+.5)+' 1.5');
      leader.setAttribute('width',(span+.5)+'pt');leader.setAttribute('height','1.5pt');
      // Half a point of empty viewport prevents subpixel clipping of the final dot.
      // Reuse one vector definition; repeat whole three-dot groups from the number backwards.
      const defs=make('defs');leader.appendChild(defs);const id='gb-equation-dots-'+serial++;
      draw(defs,'ellipsis',{id});
      for(let x=span-8.75,n=0;x>=-.000001&&n<10;x-=10.48,n++)leader.appendChild(make('use',{href:'#'+id,transform:'translate('+Math.max(0,x)+' 0)'}));
      Object.assign(leader.style,{position:'absolute',left:left+'px',top:(center-.75*pxPerPt)+'px',overflow:'hidden',pointerEvents:'none'});
      container.appendChild(leader);
    }
  }
}
