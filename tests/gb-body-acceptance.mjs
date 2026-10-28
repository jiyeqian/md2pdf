import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {render} from '../src/render.mjs';
import {createApp} from '../src/server.mjs';
import {buildStatic} from '../src/static-build.mjs';
import {Chrome,findChrome} from '../src/chrome.mjs';
const example=process.argv[2]==='--example';
const out=example?'/private/tmp/md2pdf-gb-template-final':'/private/tmp/md2pdf-gb-body';await mkdir(out,{recursive:true});await mkdir('output/pdf',{recursive:true});
const temp=await mkdtemp('/private/tmp/gb-body-acceptance-');
const chrome=new Chrome(findChrome(),temp);
const app=createApp(),nativeFetch=globalThis.fetch;
const md=await readFile(new URL(example?'../web/examples/gb.md':'./fixtures/gb-body-calibration.md',import.meta.url),'utf8');
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
   const formulas=[...document.querySelectorAll('.pagedjs_pages mjx-container[display="true"]')].map(e=>({leader:e.querySelectorAll('.gb-equation-leader').length,contained:[...e.querySelectorAll('.gb-equation-leader')].every(l=>l.getBoundingClientRect().right<=e.getBoundingClientRect().right+.5),width:e.getBoundingClientRect().width,svg:e.querySelector('svg')?.outerHTML.slice(0,400)}));
   const legendRows=[...document.querySelectorAll('.pagedjs_pages .gb-equation-definition')].map(td=>{const range=document.createRange();range.selectNodeContents(td);return {left:td.getBoundingClientRect().left,lines:[...range.getClientRects()].filter(r=>r.width).map(r=>r.left)};});
   const numbers=[...document.querySelectorAll('.pagedjs_pages .gb-decimal')].map(e=>({value:e.textContent,intRight:e.firstElementChild.getBoundingClientRect().right,page:pages.indexOf(e.closest('.pagedjs_page'))}));
   return {error:window.__md2pdfPagedError||null,audit:window.__gbBodyAudit,states,formulas,legendRows,numbers,legend:!!document.querySelector('.pagedjs_pages .gb-equation-legend'),labels:document.querySelectorAll('.pagedjs_pages [data-labels]').length};
  })()`});
  assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));const state=result.result.value;
  await writeFile(out+'/'+runtime+'-state.json',JSON.stringify(state,null,2));
  assert.equal(state.error,null);assert.equal(state.audit.problems.length,0);assert.ok(state.legend,'structured equation legend');
  assert.ok(state.formulas.length&&state.formulas.every(f=>f.leader>0&&f.contained),'GB equations have dotted number leaders');
  for(const row of state.legendRows)assert.ok(row.lines.every(x=>Math.abs(x-row.left)<1),'wrapped symbol definitions start in the same column');
  const bodyStart=state.states.find(p=>p.kind==='body');
  assert.ok(bodyStart.page%2===1&&bodyStart.label==='1','body begins at 1 on an odd physical page');
  const arabic=state.states.filter(p=>/^\d+$/.test(p.label||''));
  arabic.forEach((p,i)=>assert.equal(p.label,String(i+1),'Arabic page sequence'));
  for(const p of state.states.filter(p=>p.label)){
   assert.ok(Math.abs(p.area.left-(p.right?25:20))<.5,'mirrored left margin');
   assert.ok(Math.abs(p.area.right-(p.right?190:185))<.5,'mirrored right margin');
  }
  if(!example){
   const right=value=>state.numbers.find(n=>n.value===value).intRight;
   assert.ok(Math.abs(right('9.2')-right('123.45'))<.1,'decimal integer alignment in second column');
   assert.ok(Math.abs(right('12.34')-right('9.1'))<.1&&Math.abs(right('10')-right('9.1'))<.1,'decimal integer alignment in third column');
  }
  reports.push({runtime,...state});
  // The server PDF endpoint and CLI export are exercised independently of the locator browser.
  if(runtime==='cli')execFileSync(process.execPath,['src/md2pdf.mjs',out+'/input.md','--type','gb','-o',out+'/cli.pdf']);
  if(runtime==='node'){
   const response=await nativeFetch(base+'/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body});assert.equal(response.status,200,await response.clone().text());
   await writeFile(out+'/node.pdf',Buffer.from(await response.arrayBuffer()));
  }
  await copyFile(out+'/'+runtime+'.pdf','output/pdf/'+(example?'gb-template-final-':'gb-body-calibration-')+runtime+'.pdf');
 }
 await writeFile(out+'/states.json',JSON.stringify(reports,null,2));
 console.log('PASS: CLI/Node/static body PDF, semantic guards and equation leaders; '+out);
}finally{globalThis.fetch=nativeFetch;await chrome.stop();await app.close();await rm(temp,{recursive:true,force:true});}
