import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {render} from '../src/render.mjs';
import {createApp} from '../src/server.mjs';
import {buildStatic} from '../src/static-build.mjs';
import {Chrome,findChrome} from '../src/chrome.mjs';
const out='/private/tmp/md2pdf-gb-comprehensive';await mkdir(out,{recursive:true});await mkdir('output/pdf',{recursive:true});
const temp=await mkdtemp('/private/tmp/gb-body-acceptance-');
const chrome=new Chrome(findChrome(),temp);
const app=createApp(),nativeFetch=globalThis.fetch;
const md=await readFile(new URL('../web/examples/gb.md',import.meta.url),'utf8');
const runtimes=process.argv.includes('--node-only')?['node']:['cli','node','static'];
const opts={type:'gb'},body=JSON.stringify({md,opts});
try{
 const build=await buildStatic();
 globalThis.fetch=async(input,init)=>new URL(input).protocol==='file:'?new Response(await readFile(new URL(input))):nativeFetch(input,init);
 const offline=await import(pathToFileURL(build.directory+'/runtime.mjs'));
 await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
 const base='http://127.0.0.1:'+app.server.address().port;
 await chrome.start();const reports=[];
 for(const runtime of runtimes){
  const core=await render(md,{type:'gb',pagedHtml:true},{webSafe:true});let html;
  if(runtime==='cli'){
   await writeFile(out+'/input.md',md);
   execFileSync(process.execPath,['src/md2pdf.mjs',out+'/input.md','--type','gb','--html-only','--paged-html=','-o',out+'/cli.html']);
   html=await readFile(out+'/cli.html','utf8');
  }else if(runtime==='node')html=(await(await nativeFetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body})).json()).html;
  else html=(await offline.renderDocument({md,opts},false)).html;
  await writeFile(out+'/'+runtime+'.html',html);
  const pdf=runtime==='cli'?await chrome.print(out+'/cli.html',{...core.printOptions,waitPaged:true}):await chrome.printHtml(html,{...core.printOptions,webSafe:true,waitPaged:true});
  await writeFile(out+'/'+runtime+'.pdf',pdf);
  const result=await chrome.send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
   const pages=[...document.querySelectorAll('.pagedjs_page')];
   const box=(el,page)=>{if(!el)return null;const r=el.getBoundingClientRect(),p=page.querySelector('.pagedjs_pagebox').getBoundingClientRect(),s=p.width/210;
    const range=document.createRange();range.selectNodeContents(el);const t=range.getBoundingClientRect();
    return {left:(t.left-p.left)/s,top:(t.top-p.top)/s,right:(t.right-p.left)/s,bottom:(t.bottom-p.top)/s};};
   const states=pages.map((page,i)=>{const boxes={};const add=(role,e)=>{if(e)boxes[role]=box(e,page);};
    add('header',page.querySelector('.gb-fixed-header'));add('footer',page.querySelector('.gb-fixed-page-number'));
    const title=page.querySelector('.toc-title,h2.front,h2.back,h2.appendix,.gb-body-title');
    let kind=null;
    if(title){kind=title.matches('.toc-title')?'toc':title.matches('.gb-body-title')?'body':title.classList.contains('front')?'front':title.classList.contains('appendix')?'appendix':'back';add('title',title);
     const h=title.closest('h2')||title.closest('.gb-body-heading')?.querySelector('h2')||title;const next=kind==='body'?h.querySelector('.gb-first-heading'):kind==='toc'?title.parentElement.querySelector('ol li .toc-text'):h.nextElementSibling;add('first',next);}
    const a=page.querySelector('.pagedjs_area').getBoundingClientRect(),p=page.querySelector('.pagedjs_pagebox').getBoundingClientRect(),s=p.width/210;
    return {area:{left:(a.left-p.left)/s,right:(a.right-p.left)/s},page:i+1,label:page.dataset.gbPage||null,right:page.classList.contains('pagedjs_right_page'),kind,boxes};});
   const formulas=[...document.querySelectorAll('.pagedjs_pages mjx-container[display="true"]')].filter(e=>e.querySelector('svg')).map(e=>({leader:e.querySelectorAll('.gb-equation-leader').length,contained:[...e.querySelectorAll('.gb-equation-leader')].every(l=>l.getBoundingClientRect().right<=e.getBoundingClientRect().right+.5),width:e.getBoundingClientRect().width,svg:e.querySelector('svg')?.outerHTML.slice(0,400)}));
   const legendRows=[...document.querySelectorAll('.pagedjs_pages .gb-equation-definition')].map(td=>{const range=document.createRange();range.selectNodeContents(td);return {left:td.getBoundingClientRect().left,lines:[...range.getClientRects()].filter(r=>r.width).map(r=>r.left)};});
   const numbers=[...document.querySelectorAll('.pagedjs_pages .gb-decimal')].map(e=>({value:e.textContent,table:e.closest('table').caption?.textContent,column:e.closest('td').cellIndex,intRight:e.firstElementChild.getBoundingClientRect().right,page:pages.indexOf(e.closest('.pagedjs_page'))}));
   const emptyFootnoteRules=[...document.querySelectorAll('.pagedjs_footnote_area')].filter(a=>!a.querySelector('.gb-footnote')).map(a=>getComputedStyle(a,'::before').content);
   const tables=[...document.querySelectorAll('.pagedjs_pages table.tbl')].map(t=>({title:t.caption?.textContent,head:t.tHead?.textContent,headRows:t.tHead?.rows.length,unit:t.querySelector('.gb-table-top')?.textContent.trim(),rows:[...t.querySelectorAll('tbody tr')].map(r=>r.cells[0]?.textContent.trim()),cols:[...(t.tHead?.rows[0]?.cells||[])].map(c=>c.getBoundingClientRect().width/t.getBoundingClientRect().width),spans:t.querySelectorAll('[rowspan]').length}));
   const style=selector=>{const e=document.querySelector('.pagedjs_pages '+selector),s=getComputedStyle(e);return {font:s.fontFamily,size:s.fontSize,line:s.lineHeight,border:s.borderBottomWidth,spacing:s.letterSpacing,margin:s.marginBottom};};
   const typography={header:style('.gb-fixed-header'),term:style('.gb-term-name'),body:style('.gb-term-definition p'),reference:style('.fnref-back'),front:style('h2.front'),references:style('h2.gb-references-title')};
   const scope=document.querySelector('.pagedjs_pages');
   const extras={firstChapterOutline:scope.querySelector('h2.body-start')?.textContent.trim(),contentsHeadings:scope.querySelectorAll('h2.toc-title').length,tocMarkers:[...scope.querySelectorAll('.toc li')].some(n=>getComputedStyle(n,'::before').display!=='none' && !['none','normal','""'].includes(getComputedStyle(n,'::before').content)),bibliographyHeadings:scope.querySelectorAll('h2[data-gb-role="bibliography"]').length,figureContents:scope.querySelectorAll('.toc-float').length,nestedContents:scope.querySelectorAll('.toc-level-1').length,indexLinks:scope.querySelectorAll('.gb-index-locations a').length,unresolved:scope.querySelectorAll('[data-gb-index-unresolved]').length,source:[...scope.querySelectorAll('.gb-note')].find(n=>n.textContent.includes('[来源：'))?.textContent,visibleCitations:[...scope.querySelectorAll('.fnref-back')].every(e=>getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'),vectorRules:scope.querySelectorAll('[data-gb-table-rules]').length};
   extras.indexSections=[...scope.querySelectorAll('.gb-index-section')].map(e=>({lang:e.dataset.gbIndexLang,columns:getComputedStyle(e.querySelector('.gb-index-columns')).columnCount}));
   extras.tocRowHeights=[...scope.querySelectorAll('.toc li')].filter(e=>e.textContent.trim()).map(e=>e.getBoundingClientRect().height/(e.closest('.pagedjs_page').querySelector('.pagedjs_pagebox').getBoundingClientRect().width/(210*96/25.4)));
   extras.tocMargins=[...scope.querySelectorAll('.toc li')].map(e=>({top:parseFloat(getComputedStyle(e).marginTop),bottom:parseFloat(getComputedStyle(e).marginBottom)}));
   extras.tocGroups=[...scope.querySelectorAll('.toc>ol')].map(ol=>{const page=ol.closest('.pagedjs_page');const rows=[...ol.querySelectorAll('.toc-text')];return {page:pages.indexOf(page)+1,kind:rows[0]?.textContent.startsWith('图')?'figure':rows[0]?.textContent.startsWith('表')?'table':'body',rows:rows.map(e=>({text:e.textContent,box:box(e,page)}))};});
   extras.footnotes=[...scope.querySelectorAll('.pagedjs_footnote_area .gb-footnote')].map(e=>({number:parseInt(e.querySelector('.gb-footnote-label').textContent,10),page:pages.indexOf(e.closest('.pagedjs_page'))}));
   extras.depth4=[...scope.querySelectorAll('h5')].some(e=>e.textContent.includes('5.6.1.1'));
   extras.depth3Term=!!scope.querySelector('[id="gb-term-grasp"]');
   extras.notes=[...scope.querySelectorAll('.gb-note-text')].map(e=>{const r=document.createRange();r.selectNodeContents(e);const boxes=[...r.getClientRects()].filter(r=>r.width>0);return {lines:boxes.length,aligned:boxes.every(b=>Math.abs(b.left-boxes[0].left)<1)};});
   extras.intros=[...scope.querySelectorAll('.gb-intro')].map(e=>({indent:parseFloat(getComputedStyle(e).textIndent),before:getComputedStyle(e).marginTop,after:getComputedStyle(e).marginBottom}));
   extras.indexClean=[...scope.querySelectorAll('.gb-index-locations a')].every(e=>getComputedStyle(e).textDecorationLine==='none'&&parseFloat(getComputedStyle(e).borderBottomWidth)===0);
   extras.referenceGaps=[...scope.querySelectorAll('.references>li')].every(e=>parseFloat(getComputedStyle(e).marginBottom)===0);
   extras.exampleLayouts=['block','inline'].every(layout=>!!scope.querySelector('.gb-example-'+layout));
   extras.autoExampleLabels=[...scope.querySelectorAll('[data-gb-example-auto] .gb-label')].map(e=>e.textContent);
   return {extras,error:window.__md2pdfPagedError||null,audit:window.__gbBodyAudit,states,formulas,legendRows,numbers,tables,typography,emptyFootnoteRules,legend:!!document.querySelector('.pagedjs_pages .gb-equation-legend'),labels:document.querySelectorAll('.pagedjs_pages [data-labels]').length};
  })()`});
  assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));const state=result.result.value;
  await writeFile(out+'/'+runtime+'-state.json',JSON.stringify(state,null,2));
  assert.equal(state.extras.firstChapterOutline,'1　范围','first chapter heading excludes document title and important notices');
  assert.equal(state.extras.tocMarkers,false,'contents never use body list markers');
  assert.equal(state.extras.contentsHeadings,1,'semantic contents heading appears once');
  assert.equal(state.extras.bibliographyHeadings,1,'explicit bibliography heading appears once');
  assert.ok(state.extras.figureContents>=2&&state.extras.nestedContents>0,'multilevel contents and float list');
  assert.ok(state.extras.indexLinks>=10&&state.extras.unresolved===0,'all index locations resolve');
  assert.ok(state.extras.source?.includes('[来源：GB/T 20000.1—2014，5.3]'),'bracketed terminology source');
  assert.ok(state.extras.visibleCitations&&state.extras.vectorRules>0,'visible citations and vector table rules');
  assert.ok(Math.max(...state.extras.tocRowHeights)-Math.min(...state.extras.tocRowHeights)<.1,'equal contents row spacing across all levels and groups');
  assert.ok(state.extras.tocRowHeights.every(h=>Math.abs(h*.75-18.34)<.1),'contents rows match 2026 reference 18.34pt');
  assert.ok(state.extras.tocMargins.every(m=>m.top===0&&m.bottom===0),'all contents rows have no external margins, including float rows');
  assert.ok(state.extras.depth4&&state.extras.depth3Term,'four-level clauses and three-level terms');
  const footnotes=state.extras.footnotes;
  assert.ok(footnotes.length>=3&&new Set(footnotes.map(n=>n.page)).size>=3,'footnotes span front/body/appendix pages');
  assert.deepEqual(footnotes.map(n=>n.number),footnotes.map((_,i)=>i+1),'document-wide footnote sequence');
  assert.ok(state.extras.notes.some(n=>n.lines>1&&n.aligned),'long notes wrap at the content start');
  assert.ok(state.extras.intros.length>=2&&state.extras.intros.every(p=>p.indent===28&&p.before==='0px'&&p.after==='0px'),'unified introduction paragraphs');
  assert.ok(state.extras.indexSections.some(e=>e.lang==='zh'&&e.columns==='2')&&state.extras.indexSections.some(e=>e.lang==='en'&&e.columns==='1'),'Chinese two-column and English single-column sections');
  assert.ok(state.extras.indexClean&&state.extras.referenceGaps&&state.extras.exampleLayouts,'index, bibliography and example styles');
  assert.ok(state.extras.autoExampleLabels.includes('示例3：'),'local automatic example numbering');
  assert.equal(state.error,null);assert.equal(state.audit.problems.length,0);assert.ok(state.legend,'structured equation legend');
  assert.ok(state.formulas.length&&state.formulas.every(f=>f.leader>0&&f.contained),'GB equations have dotted number leaders');
  for(const row of state.legendRows)assert.ok(row.lines.every(x=>x>=row.left-1),'symbol definitions stay within their shared column');
  const bodyStart=state.states.find(p=>p.kind==='body');
  assert.ok(bodyStart.page%2===1&&bodyStart.label==='1','body begins at 1 on an odd physical page');
  const arabic=state.states.filter(p=>/^\d+$/.test(p.label||''));
  arabic.forEach((p,i)=>assert.equal(p.label,String(i+1),'Arabic page sequence'));
  for(const p of state.states.filter(p=>p.label)){
   assert.ok(Math.abs(p.area.left-(p.right?25:20))<.5,'mirrored left margin');
   assert.ok(Math.abs(p.area.right-(p.right?190:185))<.5,'mirrored right margin');
  }
  {
   const right=(value,column)=>state.numbers.find(n=>n.table.includes('位移标定记录')&&n.value===value&&(column===undefined||n.column===column)).intRight;
   assert.ok(Math.abs(right('9.2')-right('123.45'))<.1,'decimal integer alignment in second column');
   assert.ok(Math.abs(right('12.34',2)-right('9.1',2))<.1&&Math.abs(right('123.40')-right('9.1'))<.1,'decimal integer alignment in third column');
  }
  assert.ok(state.emptyFootnoteRules.every(c=>c==='none'||c==='normal'),'no orphan footnote divider on empty area');
  const records=state.tables.filter(t=>t.title?.includes('连续抓取试验记录'));
  assert.ok(records.length>1,'records continue across pages');
  for(const table of records){
   assert.ok(table.head.includes('记录编号')&&table.head.includes('恢复时间'),'repeated complete header');
   assert.equal(table.unit,'单位为毫秒','repeated unit statement');
   table.cols.forEach((w,i)=>assert.ok(Math.abs(w-records[0].cols[i])<.003,'continuation column widths stay fixed'));
  }
  const rows=records.flatMap(t=>t.rows);
  for(let i=1;i<=40;i++)assert.equal(rows.filter(v=>v==='R'+String(i).padStart(3,'0')).length,1,'record appears exactly once');
  const complex=state.tables.find(t=>t.title?.includes('分项检测条件'));
  assert.ok(complex?.headRows===2&&complex.spans>=5,'complex merged headers and rows');
  assert.equal(state.typography.reference.border,'0px','no dotted underline on reference number');
  assert.ok(state.typography.header.font.includes('GB Hei')&&state.typography.term.font.includes('GB Hei'),'F.1 header and term Hei');
  assert.ok(state.typography.body.font.includes('GB Song'),'F.1 body Song');
  assert.equal(state.typography.body.margin,'0px','no decorative paragraph gap');
  assert.equal(state.formulas.length,3,'two body equations and one appendix equation');
  const searchable=execFileSync('pdftotext',['-layout',out+'/'+runtime+'.pdf','-'],{encoding:'utf8'}).replace(/\s+/g,'');
  for(const marker of ['a)识别异常','b)检查恢复','c)恢复受控','1)传感器','2)通信接口'])assert.ok(searchable.includes(marker),'letter and numeric list markers '+marker);
  assert.ok(searchable.lastIndexOf('参考文献')<searchable.lastIndexOf('索引'),'references precede index');
  const embedded=execFileSync('pdffonts',[out+'/'+runtime+'.pdf'],{encoding:'utf8'});
  assert.ok(embedded.includes('TimesNewRomanPS-BoldMT'),'chosen Latin bold font is actually embedded');
  reports.push({runtime,...state});
  // The server PDF endpoint and CLI export are exercised independently of the locator browser.
  if(runtime==='cli')execFileSync(process.execPath,['src/md2pdf.mjs',out+'/input.md','--type','gb','-o',out+'/cli.pdf']);
  if(runtime==='node'){
   const response=await nativeFetch(base+'/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body});assert.equal(response.status,200,await response.clone().text());
   await writeFile(out+'/node.pdf',Buffer.from(await response.arrayBuffer()));
  }
  await copyFile(out+'/'+runtime+'.pdf','output/pdf/gb-comprehensive-'+runtime+'.pdf');
 }
 const pdfTexts=runtimes.map(runtime=>execFileSync('pdftotext',['-layout',out+'/'+runtime+'.pdf','-'],{encoding:'utf8'}));
 if(runtimes.length===3) assert.equal(pdfTexts[0],pdfTexts[1],'CLI and Node PDF text and pagination');
 if(runtimes.length===3) assert.equal(pdfTexts[1],pdfTexts[2],'Node and static PDF text and pagination');
 await writeFile(out+'/states.json',JSON.stringify(reports,null,2));
 console.log('PASS: '+runtimes.join('/')+' body PDF, semantic guards and equation leaders; '+out);
}finally{globalThis.fetch=nativeFetch;await chrome.stop();await app.close();await rm(temp,{recursive:true,force:true});}
