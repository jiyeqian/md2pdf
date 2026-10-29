import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {createApp} from '../src/server.mjs';
import {buildStatic} from '../src/static-build.mjs';
import {Chrome,findChrome} from '../src/chrome.mjs';
import {render} from '../src/render.mjs';

const md='---\n标准号: GB/T 39999—2026\n中文名称: 目录命名验收\ntitle: 旧标题\nversion: v2\ntoc: 3\n---\n## 范围\n\n### 次级条\n\n#### 三级条\n\n##### 四级条\n';
const app=createApp(),chrome=new Chrome(findChrome(),await mkdtemp('/private/tmp/gb-options-browser-'));
let staticServer;
const evaluate=async expression=>{
  expression=expression.includes(';')&&!expression.trim().startsWith('(')
    ?`(async()=>{${expression}})()`:`(async()=>(${expression}))()`;
  const r=await chrome.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  assert.equal(r.exceptionDetails,undefined,JSON.stringify(r.exceptionDetails));return r.result.value;
};
const wait=async expression=>{
  for(let n=0;n<400;n++){
    if(await evaluate(`Boolean(${expression})`))return;
    await new Promise(r=>setTimeout(r,50));
  }
  throw new Error('Timeout: '+expression);
};
try{
  const built=await buildStatic();
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  await chrome.start();
  await chrome.send('Page.addScriptToEvaluateOnNewDocument',{source:`
    if(!sessionStorage.getItem('gb-test-seed')){sessionStorage.setItem('gb-test-seed','1');sessionStorage.setItem('md2pdf:draft',JSON.stringify({md:${JSON.stringify(md)},opts:{}}));}
    const nativeFetch=window.fetch;window.fetch=async(...args)=>{const r=await nativeFetch(...args);if(String(args[0]).includes('/api/preview')){try{const b=await r.clone().json();window.__lastPreview={status:r.status,depth:b.effective?.tocDepth};}catch{}}return r;};
  `});
  await chrome.send('Page.navigate',{url:base});
  await wait('window.mdEditor && window.mdDrafts');
  await evaluate('mdDrafts.flush()');
  assert.equal(await evaluate('(await mdDrafts.store.get(mdDrafts.current())).title'),'目录命名验收');
  await wait(`document.querySelector('[data-option-trigger="toc"]').title.includes('3级目录')`);
  assert.ok(await evaluate(`[...document.querySelector('#options').elements.toc.options].some(o=>o.value==='3'&&o.textContent==='三级目录')`));
  await evaluate(`document.querySelector('[data-option-menu="toc"] [data-option-value="1"]').click()`);
  await wait(`document.querySelector('[data-option-trigger="toc"]').title==='目录：一级目录'`);
  await wait(`window.__lastPreview?.status===200&&__lastPreview.depth===1`);
  await evaluate(`document.querySelector('[data-option-menu="toc"] [data-option-value="3"]').click();mdDrafts.schedule();await mdDrafts.flush()`);
  assert.equal(await evaluate('(await mdDrafts.store.get(mdDrafts.current())).opts.toc'),'3');
  await wait(`window.__lastPreview?.status===200&&__lastPreview.depth===3`);
  await evaluate(`window.__download='';HTMLAnchorElement.prototype.click=function(){if(this.download)window.__download=this.download;};document.querySelector('#privacy-save').click()`);
  await wait('window.__download');
  assert.equal(await evaluate('window.__download'),'目录命名验收_v2.md');

  // Reading an older stored title updates only derived display metadata, not the file or revision.
  const old=await evaluate(`(async()=>{const s=await mdDrafts.store.save({id:'legacy-gb-title',version:0,md:${JSON.stringify(md)},opts:{},filename:'original.md'});await new Promise((resolve,reject)=>{const req=indexedDB.open('md2pdf-local-documents');req.onsuccess=()=>{const db=req.result,tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put({...s,title:'未命名文档'});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error);};});const r=await mdDrafts.store.get(s.id);return {title:r.title,filename:r.filename,version:r.version,savedAt:r.savedAt,originalSavedAt:s.savedAt};})()`);
  assert.equal(old.title,'目录命名验收');assert.equal(old.filename,'original.md');assert.equal(old.version,1);assert.equal(old.savedAt,old.originalSavedAt);

  const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const pdf=await post('/api/pdf',{md,opts:{}});assert.equal(pdf.status,200);
  assert.ok(decodeURIComponent(pdf.headers.get('content-disposition')).includes('目录命名验收_v2.pdf'));
  const bytes=Buffer.from(await pdf.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  await writeFile('/private/tmp/md2pdf-gb-options.pdf',bytes);
  const online=await(await post('/api/render',{md,opts:{}})).json();
  const core=await render(md,{pagedHtml:true},{webSafe:true});
  await chrome.printHtml(online.html,{...core.printOptions,waitPaged:true});
  const state=await evaluate(`(()=>{const rows=[...document.querySelectorAll('.pagedjs_pages .toc>ol:first-of-type>li')];return {rows:rows.map(e=>({text:e.textContent.trim(),level:e.className,indent:parseFloat(getComputedStyle(e.querySelector('a')).marginLeft),step:(parseFloat(getComputedStyle(e).lineHeight)+parseFloat(getComputedStyle(e).paddingTop)+parseFloat(getComputedStyle(e).paddingBottom))*.75})),error:window.__md2pdfPagedError||null};})()`);
  assert.equal(state.error,null);assert.equal(state.rows.length,3);
  assert.deepEqual(state.rows.map(r=>r.level),['toc-level-0','toc-level-1','toc-level-2']);
  assert.deepEqual(state.rows.map(r=>r.indent),[0,14,28]);
  assert.ok(state.rows.every(r=>Math.abs(r.step-18.34)<.02));
  await writeFile('/private/tmp/md2pdf-gb-options-layout.json',JSON.stringify(state,null,2));
  const image=await chrome.send('Page.captureScreenshot',{format:'png'});
  await writeFile('/private/tmp/md2pdf-gb-options-preview.png',Buffer.from(image.data,'base64'));

  const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
  staticServer=createServer(async(req,res)=>{
    const file=path.resolve(built.directory,'.'+decodeURIComponent(new URL(req.url,'http://test').pathname).replace(/\/$/,'/index.html'));
    if(!file.startsWith(built.directory+path.sep)){res.writeHead(403).end();return;}
    try{const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>staticServer.listen(0,'127.0.0.1',resolve));
  await chrome.send('Page.navigate',{url:'http://127.0.0.1:'+staticServer.address().port+'/'});
  await wait('window.mdEditor && window.mdDrafts');
  await wait(`document.querySelector('[data-option-trigger="toc"]').title.includes('3级目录')`);
  await evaluate(`window.__printNames=[];addEventListener('message',e=>{if(e.data?.type==='print-ready'){const f=[...document.querySelectorAll('iframe.static-print-frame')].find(f=>f.contentWindow===e.source);if(!f)return;__printNames.push(new DOMParser().parseFromString(f.srcdoc,'text/html').title);e.stopImmediatePropagation();setTimeout(()=>{for(const type of ['print-started','print-finished'])dispatchEvent(new MessageEvent('message',{source:e.source,data:{type,id:e.data.id}}));},0);}});window.__printModule=await import('/pdf.mjs');`);
  await evaluate(`__printModule.exportPdf({md:${JSON.stringify(md)},opts:{}})`);
  await wait(`!document.querySelector('.static-print-frame')`);
  await evaluate(`__printModule.exportPdf({md:${JSON.stringify(md)},opts:{},filename:'特殊$&名称_v2.pdf'})`);
  await wait(`!document.querySelector('.static-print-frame')`);
  assert.deepEqual(await evaluate('__printNames'),['目录命名验收_v2','特殊$&名称_v2']);
  console.log('PASS: Node/static UI third-level menu, old draft display refresh, Markdown/PDF names, actual GB pagination and static print title (native print handshake stubbed)');
}finally{
  await chrome.stop();await app.close();
  if(staticServer)await new Promise(resolve=>staticServer.close(resolve));
}
