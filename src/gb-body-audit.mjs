// Serialized into the same document for CLI, Node and static export.
export function prepareGbBodyAudit() {
  const norm=s=>s.replace(/\s+/g,'');
  const text=node=>{const copy=node.cloneNode(true);if(!node.matches('.gb-footnote'))copy.querySelectorAll('.gb-footnote').forEach(n=>n.remove());return norm(copy.textContent);};
  const areaHeight=(297-27)*96/25.4-window.__gbContentTop;
  const width=document.body.style.width;
  document.body.style.width='165mm';
  const expected=[];
  try {
    for(const table of document.querySelectorAll('main table:not(.gb-equation-legend)')){
      const rows=[...table.tBodies].flatMap(body=>[...body.rows]);
      const columns=Math.max(0,...rows.map(row=>row.cells.length));
      if(!table.querySelector('thead [rowspan], thead [colspan], tbody [rowspan], tbody [colspan]')) for(let i=0;i<columns;i++){
        const cells=rows.map(row=>row.cells[i]).filter(Boolean);
        if(cells.some(c=>c.colSpan!==1||c.rowSpan!==1||c.children.length))continue;
        const values=cells.map(c=>/^([+−-]?\d+)(\.\d+)?(%|‰)?$/.exec(c.textContent.trim()));
        if(!values.some(Boolean)||values.some((v,j)=>!v&&cells[j].textContent.trim()!=='—'))continue;
        const ctx=document.createElement('canvas').getContext('2d');
        const style=getComputedStyle(cells[0]);ctx.font=style.font;
        const widths=[1,2,3].map(k=>Math.max(0,...values.filter(Boolean).map(v=>ctx.measureText(v[k]||'').width)));
        cells.forEach((cell,j)=>{
          cell.classList.add('gb-number-cell');
          if(!values[j])return;
          const span=document.createElement('span');span.className='gb-decimal';
          ['int','frac','suffix'].forEach((key,k)=>span.style.setProperty('--gb-'+key+'-width',widths[k]+'px'));
          for(let k=1;k<=3;k++){const part=document.createElement('span');part.textContent=values[j][k]||'';span.appendChild(part);}
          cell.replaceChildren(span);
        });
      }
      if(!table.querySelector(':scope > colgroup')&&table.tHead?.rows[0]){
        const cells=[...table.tHead.rows[0].cells],width=table.getBoundingClientRect().width;
        if(width&&cells.every(c=>c.colSpan===1)){
          const group=document.createElement('colgroup');
          for(const cell of cells){const col=document.createElement('col');col.style.width=cell.getBoundingClientRect().width/width*100+'%';group.appendChild(col);}
          table.insertBefore(group,table.tHead);table.style.tableLayout='fixed';
        }
      }
      const header=(table.tHead?.getBoundingClientRect().height||0)+(table.caption?.getBoundingClientRect().height||0);
      if(header>areaHeight-4)throw new Error('国家标准表题或表头过高，无法在一页中容纳表格内容，请拆分表头');
      for(const group of table.tBodies){
        if(group.querySelector('td[rowspan]')&&group.getBoundingClientRect().height>areaHeight-header-4)
          throw new Error('国家标准表格合并行组超过可用页高，请拆分合并单元格后导出');
      }
      for(const row of [...table.rows].filter(row=>!row.closest('thead'))){
        if(row.getBoundingClientRect().height>areaHeight-header-4)
          throw new Error('国家标准表格单行超过可用页高，请拆分长单元格后导出');
      }
    }
    for(const equation of document.querySelectorAll('main .gb-equation')){
      if(equation.getBoundingClientRect().height>areaHeight-4)throw new Error('国家标准公式及释义超过可用页高，请拆分后导出');
    }
    for(const figure of document.querySelectorAll('main figure.fig')){
      if(figure.getBoundingClientRect().height>areaHeight-4)
        throw new Error('国家标准图及图题、图注超过可用页高，请拆分为分图或续图后导出');
    }
    for(const note of document.querySelectorAll('main .gb-footnote')){
      const measure=note.cloneNode(true);
      measure.style.cssText='position:absolute;left:-10000px;top:0;float:none;width:165mm;box-sizing:border-box;';
      document.body.appendChild(measure);const height=measure.getBoundingClientRect().height;measure.remove();
      if(height>areaHeight-50)throw new Error('国家标准条文脚注超过单页可用空间，请拆分或移入资料性附录后导出');
    }
    for(const entry of document.querySelectorAll('main .gb-index-entries > li')) {
      if(entry.getBoundingClientRect().height>areaHeight-4)
        throw new Error('国家标准索引单条超过单页可用高度，请缩短关键词或拆分位置');
    }
    for(const node of document.querySelectorAll('main .gb-footnote, main .gb-note, main .gb-example, main .gb-figure-note, main .gb-figure-footnote, main .gb-table-note, main .gb-table-footnote, main table tr, main li[data-gb-marker], main .gb-index-entries > li')){
      const id=String(expected.length+1);node.dataset.gbAudit=id;
      expected.push({id,text:text(node),role:node.className||node.tagName});
    }
    window.__gbBodyExpected=expected;
  } finally {document.body.style.width=width;}
}

export function finalizeGbBodyAudit() {
  const norm=s=>s.replace(/\s+/g,'');
  const text=node=>{const copy=node.cloneNode(true);if(!node.matches('.gb-footnote'))copy.querySelectorAll('.gb-footnote').forEach(n=>n.remove());return norm(copy.textContent);};
  const pages=[...document.querySelectorAll('.pagedjs_page')];
  const problems=[];
  for(const record of window.__gbBodyExpected||[]){
    const nodes=[...document.querySelectorAll('.pagedjs_pages [data-gb-audit="'+record.id+'"]')];
    const actual=nodes.map(text).join('');
    if(!actual.includes(record.text))problems.push('内容未完整排入页面：'+record.role+' #'+record.id);
  }
  for(const page of pages){
    if(page.matches('.pagedjs_blank_page,.pagedjs_gb-cover_page,.pagedjs_gb-back-cover_page'))continue;
    const area=page.querySelector('.pagedjs_area').getBoundingClientRect();
    const scale=area.width/(165*96/25.4),tolerance=1.5*scale;
    for(const e of page.querySelectorAll('.pagedjs_page_content p, .pagedjs_page_content li, .pagedjs_page_content tr, .pagedjs_page_content figure.fig, .pagedjs_page_content mjx-container[display="true"], .pagedjs_page_content mjx-container[display="true"] > svg')){
      const r=e.getBoundingClientRect();
      if(r.width&&r.height&&(r.top<area.top-tolerance||r.left<area.left-tolerance||r.right>area.right+tolerance||r.bottom>area.bottom+tolerance))
        problems.push('正文元素超出版心：'+e.tagName+' '+e.textContent.trim().slice(0,40));
    }
  }
  for(const note of document.querySelectorAll('.pagedjs_pages .gb-footnote')){
    const clip=note.closest('.pagedjs_footnote_content');
    if(!clip)continue;
    const boundary=clip.getBoundingClientRect();
    const walker=document.createTreeWalker(note,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      if(!walker.currentNode.textContent.trim())continue;
      const range=document.createRange();range.selectNodeContents(walker.currentNode);
      if([...range.getClientRects()].some(r=>r.bottom>boundary.bottom+1.5))
        problems.push('条文脚注末行被裁切：'+note.textContent.slice(0,30));
    }
  }
  const end=document.querySelector('.pagedjs_pages .gb-end-line');
  if(end){
    const page=end.closest('.pagedjs_page'),r=end.getBoundingClientRect();
    const preceding=[...page.querySelectorAll('.pagedjs_page_content p, .pagedjs_page_content li, .pagedjs_page_content tr, .pagedjs_page_content li, .pagedjs_page_content h1, .pagedjs_page_content h2, .pagedjs_page_content h3, .pagedjs_page_content h4, .pagedjs_page_content h5, .pagedjs_page_content h6, .pagedjs_page_content figure, .pagedjs_page_content img, .pagedjs_page_content mjx-container[display="true"]')]
      .some(e=>(e.textContent.trim()||e.matches('img')||e.matches('figure')&&e.querySelector('img,svg'))&&e.getBoundingClientRect().height&&e.getBoundingClientRect().bottom<=r.top+1.5);
    if(!preceding)problems.push('终结线被单独排入新页，请调整末尾内容');
  }
  if(problems.length)throw new Error('国家标准排版检查未通过：'+problems.slice(0,5).join('；'));
  window.__gbBodyAudit={records:(window.__gbBodyExpected||[]).length,problems:[]};
}
