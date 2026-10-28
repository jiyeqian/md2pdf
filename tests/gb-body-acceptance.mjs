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
const opts={type:'gb'},body=JSON.stringify({md,opts});
try{
 const build=await buildStatic();
 globalThis.fetch=async(input,init)=>new URL(input).protocol==='file:'?new Response(await readFile(new URL(input))):nativeFetch(input,init);
 const offline=await import(pathToFileURL(build.directory+'/runtime.mjs'));
 await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
 const base='http://127.0.0.1:'+app.server.address().port;
 await chrome.start();const reports=[];
 for(const runtime of ['cli','node','static']){
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
     const h=title.closest('h2')||title;const next=kind==='body'?h.querySelector('.gb-first-heading'):kind==='toc'?title.parentElement.querySelector('ol li .toc-text'):h.nextElementSibling;add('first',next);}
    const a=page.querySelector('.pagedjs_area').getBoundingClientRect(),p=page.querySelector('.pagedjs_pagebox').getBoundingClientRect(),s=p.width/210;
    return {area:{left:(a.left-p.left)/s,right:(a.right-p.left)/s},page:i+1,label:page.dataset.gbPage||null,right:page.classList.contains('pagedjs_right_page'),kind,boxes};});
   const formulas=[...document.querySelectorAll('.pagedjs_pages mjx-container[display="true"]')].filter(e=>e.querySelector('svg')).map(e=>({leader:e.querySelectorAll('.gb-equation-leader').length,contained:[...e.querySelectorAll('.gb-equation-leader')].every(l=>l.getBoundingClientRect().right<=e.getBoundingClientRect().right+.5),width:e.getBoundingClientRect().width,svg:e.querySelector('svg')?.outerHTML.slice(0,400)}));
   const legendRows=[...document.querySelectorAll('.pagedjs_pages .gb-equation-definition')].map(td=>{const range=document.createRange();range.selectNodeContents(td);return {left:td.getBoundingClientRect().left,lines:[...range.getClientRects()].filter(r=>r.width).map(r=>r.left)};});
   const numbers=[...document.querySelectorAll('.pagedjs_pages .gb-decimal')].map(e=>({value:e.textContent,table:e.closest('table').caption?.textContent,column:e.closest('td').cellIndex,intRight:e.firstElementChild.getBoundingClientRect().right,page:pages.indexOf(e.closest('.pagedjs_page'))}));
   const emptyFootnoteRules=[...document.querySelectorAll('.pagedjs_footnote_area')].filter(a=>!a.querySelector('.gb-footnote')).map(a=>getComputedStyle(a,'::before').content);
   const tables=[...document.querySelectorAll('.pagedjs_pages table.tbl')].map(t=>({title:t.caption?.textContent,head:t.tHead?.textContent,headRows:t.tHead?.rows.length,unit:t.querySelector('.gb-table-unit')?.textContent,rows:[...t.querySelectorAll('tbody tr')].map(r=>r.cells[0]?.textContent.trim()),cols:[...t.tHead.rows[0].cells].map(c=>c.getBoundingClientRect().width/t.getBoundingClientRect().width),spans:t.querySelectorAll('[rowspan]').length}));
   const style=selector=>{const e=document.querySelector('.pagedjs_pages '+selector),s=getComputedStyle(e);return {font:s.fontFamily,size:s.fontSize,line:s.lineHeight,border:s.borderBottomWidth,spacing:s.letterSpacing,margin:s.marginBottom};};
   const typography={header:style('.gb-fixed-header'),term:style('.gb-term-name'),body:style('.gb-term-definition p'),reference:style('.fnref-back'),front:style('h2.front'),references:style('h2.gb-references-title')};
   return {error:window.__md2pdfPagedError||null,audit:window.__gbBodyAudit,states,formulas,legendRows,numbers,tables,typography,emptyFootnoteRules,legend:!!document.querySelector('.pagedjs_pages .gb-equation-legend'),labels:document.querySelectorAll('.pagedjs_pages [data-labels]').length};
  })()`});
  assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));const state=result.result.value;
  await writeFile(out+'/'+runtime+'-state.json',JSON.stringify(state,null,2));
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
  const records=state.tables.filter(t=>t.title.includes('连续抓取试验记录'));
  assert.ok(records.length>1,'records continue across pages');
  for(const table of records){
   assert.ok(table.head.includes('记录编号')&&table.head.includes('恢复时间'),'repeated complete header');
   assert.equal(table.unit,'单位为毫秒','repeated unit statement');
   table.cols.forEach((w,i)=>assert.ok(Math.abs(w-records[0].cols[i])<.003,'continuation column widths stay fixed'));
  }
  const rows=records.flatMap(t=>t.rows);
  for(let i=1;i<=100;i++)assert.equal(rows.filter(v=>v==='R'+String(i).padStart(3,'0')).length,1,'record appears exactly once');
  const complex=state.tables.find(t=>t.title.includes('分项检测条件'));
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
 const pdfTexts=['cli','node','static'].map(runtime=>execFileSync('pdftotext',['-layout',out+'/'+runtime+'.pdf','-'],{encoding:'utf8'}));
 assert.equal(pdfTexts[0],pdfTexts[1],'CLI and Node PDF text and pagination');
 assert.equal(pdfTexts[1],pdfTexts[2],'Node and static PDF text and pagination');
 await writeFile(out+'/states.json',JSON.stringify(reports,null,2));
 console.log('PASS: CLI/Node/static body PDF, semantic guards and equation leaders; '+out);
}finally{globalThis.fetch=nativeFetch;await chrome.stop();await app.close();await rm(temp,{recursive:true,force:true});}
