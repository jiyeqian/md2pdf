import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {render} from '../src/render.mjs';
import {createApp} from '../src/server.mjs';
import {buildStatic} from '../src/static-build.mjs';
import {Chrome,findChrome} from '../src/chrome.mjs';
const out='/private/tmp/gb-equation-calibration';await mkdir(out,{recursive:true});await mkdir('output/pdf',{recursive:true});
const temp=await mkdtemp('/private/tmp/gb-equation-calibration-'),chrome=new Chrome(findChrome(),temp),app=createApp(),nativeFetch=globalThis.fetch;
const md='---\ndisable: [gb-cover]\ntoc: false\n---\n# 公式编号校准\n\n## 公式\n\n'+Array.from({length:12},(_,i)=>'$$x='+i+'\\label{eq:n'+(i+1)+'}$$').join('\n\n')+'\n\n'+['A.1','A.12','B.1','C.1','D.1','E.1'].map(t=>'$$x=1\\tag{'+t+'}\\label{eq:'+t+'}$$').join('\n\n')+'\n\n$$x=1\\tag*{自定}$$\n\n引用 $\\eqref{eq:n1}$ 与 $\\eqref{eq:A.1}$。';
const opts={type:'gb'},payload={md,opts},reports=[];
try{
 const build=await buildStatic();globalThis.fetch=async(input,init)=>new URL(input).protocol==='file:'?new Response(await readFile(new URL(input))):nativeFetch(input,init);
 const offline=await import(pathToFileURL(build.directory+'/runtime.mjs'));
 await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve)});
 await chrome.start();const base='http://127.0.0.1:'+app.server.address().port;
 for(const runtime of ['core','node','static']){
  const core=await render(md,opts,{webSafe:true});let html=core.html;
  if(runtime==='node'){const response=await nativeFetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));html=result.html;}
  if(runtime==='static'){const result=await offline.renderDocument(payload,false);assert.ok(result.html,JSON.stringify(result));html=result.html;}
  assert.equal(typeof html,'string',runtime+' renderer returns HTML');
  await writeFile(out+'/'+runtime+'.html',html);
  let pdf;try{pdf=runtime==='core'?await chrome.print(out+'/core.html',{...core.printOptions,waitPaged:true}):await chrome.printHtml(html,{...core.printOptions,webSafe:true,waitPaged:true});}catch(error){console.error(JSON.stringify((await chrome.send('Runtime.evaluate',{returnByValue:true,expression:'({math:window.__md2pdfMathReady,paged:window.__md2pdfPagedReady,error:window.__md2pdfPagedError,body:document.body.innerText.slice(-1200)})'})).result.value));throw error;}
  if(runtime==='node'){const response=await nativeFetch(base+'/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(response.status,200,await response.clone().text());pdf=Buffer.from(await response.arrayBuffer());}
  await writeFile(out+'/'+runtime+'.pdf',pdf);if(runtime==='node')await writeFile('output/pdf/gb-equation-calibration-node.pdf',pdf);
  const state=await chrome.send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
   const pt=e=>{const page=e.closest('.pagedjs_page'),box=page.querySelector('.pagedjs_pagebox').getBoundingClientRect(),r=e.getBoundingClientRect(),scale=box.width/210*25.4/72;return {left:(r.left-box.left)/scale,top:(r.top-box.top)/scale,right:(r.right-box.left)/scale,bottom:(r.bottom-box.top)/scale,page:[...document.querySelectorAll('.pagedjs_page')].indexOf(page)+1}};
   const scope=document.querySelector('.pagedjs_pages');
   const report=()=>({numbers:[...scope.querySelectorAll('.gb-equation-number')].map(e=>({tag:e.dataset.gbEquationTag,box:pt(e),paths:e.querySelectorAll('path').length,coreHeight:e.firstElementChild.getBBox().height,rightError:e.getBoundingClientRect().right-e.parentElement.getBoundingClientRect().right})),leaders:[...scope.querySelectorAll('.gb-equation-leader')].map(e=>({box:pt(e),groups:e.querySelectorAll(':scope > use').length,firstTransform:e.querySelector(':scope > use')?.getAttribute('transform'),lastTransform:e.lastElementChild?.getAttribute('transform')})),fallback:[...scope.querySelectorAll('[data-labels]>[data-mml-node=mtd]')].filter(e=>getComputedStyle(e).visibility!=='hidden').map(e=>({text:e.textContent})),refs:[...scope.querySelectorAll('a')].map(e=>e.getAttribute('href')||e.getAttribute('xlink:href')).filter(h=>h?.includes('mjx-eqn')).map(href=>({href,resolved:!!document.getElementById(decodeURIComponent(href.slice(href.indexOf('#')+1)))})),fontText:[...scope.querySelectorAll('.gb-equation-number text')].length});
   const before=report();finalizeGbEquations(${JSON.stringify(JSON.parse(await readFile('assets/gb-equation-glyphs.json','utf8')).glyphs)});const after=report();finalizeGbEquations(${JSON.stringify(JSON.parse(await readFile('assets/gb-equation-glyphs.json','utf8')).glyphs)});const repeated=report();return {before,after,repeated};
  })()`});assert.equal(state.exceptionDetails,undefined,JSON.stringify(state.exceptionDetails));const {before,after,repeated}=state.result.value;await writeFile(out+'/'+runtime+'-state.json',JSON.stringify(state.result.value,null,2));
  assert.deepEqual(repeated,after,'consecutive finalization is stable after print media returns to preview');
  assert.deepEqual(before.numbers.map(n=>n.tag),[...Array.from({length:12},(_,i)=>String(i+1)),'A.1','A.12','B.1','C.1','D.1']);
  assert.ok(before.numbers.every(n=>Math.abs(n.rightError)<.05&&n.paths>2),'vector tags align right');
  assert.ok(before.numbers.every(n=>n.coreHeight>6&&n.coreHeight<7.5),'all number glyphs use the full reference size, including zero and two-digit tags');
  assert.equal(before.fallback.length,2,'uncovered appendix letter and explicit unbracketed custom tag remain visible');
  assert.equal(before.leaders.length,19);assert.ok(before.leaders.every(l=>l.groups>0&&l.groups<=10),'all formulas have full vector dot groups');
  assert.ok(before.refs.length>=2&&before.refs.every(r=>r.resolved),'automatic and appendix equation references retain targets');
  assert.equal(before.fontText,0,'calibrated tags have no font dependency');reports.push({runtime,...before});
 }
 await writeFile(out+'/measurements.json',JSON.stringify(reports,null,2));console.log('PASS: core/node/static numeric 1–12, appendix A–D, references, custom fallback and repeat finalization');
}finally{globalThis.fetch=nativeFetch;await chrome.stop();await app.close();await rm(temp,{recursive:true,force:true})}
