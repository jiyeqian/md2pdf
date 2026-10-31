import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Chrome,findChrome} from '../src/chrome.mjs';
import {createApp} from '../src/server.mjs';
import {buildStatic} from '../src/static-build.mjs';
const tmp=await mkdtemp('/private/tmp/completion-defaults-'),chrome=new Chrome(findChrome(),tmp),app=createApp(),nativeFetch=globalThis.fetch;
try {
 const build=await buildStatic();globalThis.fetch=async(input,init)=>new URL(input).protocol==='file:'?new Response(await readFile(new URL(input))):nativeFetch(input,init);
 const offline=await import(pathToFileURL(build.directory+'/runtime.mjs'));
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;await chrome.start();
 const md='---\nfonts: {heading: "", body: "", western: "", code: ""}\n---\n# 替代字体\n\n## 正文\n\nFallback 中文。';
 for(const runtime of ['node','static']) {
  const body={md,opts:{type:'general'}};
  const response=runtime==='node'?await nativeFetch(base+'/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}):await offline.appFetch('/api/preview',{body:JSON.stringify(body)});
  assert.equal(response.status,200);const result=await response.json();
  await chrome.printHtml(result.html,{webSafe:true,waitPaged:true});
  const state=await chrome.send('Runtime.evaluate',{returnByValue:true,expression:`({missing:window.__md2pdfFontError||null,emptyAlias:!!document.querySelector('.pagedjs_pages')&&getComputedStyle(document.querySelector('.pagedjs_pages')).fontFamily.includes('MD2PDF User')})`});
  assert.equal(state.result.value.missing,null);assert.equal(state.result.value.emptyAlias,false);
  if(runtime==='node'){
   const exported=await nativeFetch(base+'/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   assert.equal(exported.status,200);assert.equal(Buffer.from(await exported.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
  }
  console.log(runtime+': empty font roles preview and PDF use fallback without font error');
 }
 await chrome.send('Network.setBlockedURLs',{urls:[]});await chrome.send('Page.navigate',{url:base+'/'});
 for(let i=0;i<100;i++){const r=await chrome.send('Runtime.evaluate',{returnByValue:true,expression:'location.href'});if(r.result.value===base+'/')break;await new Promise(resolve=>setTimeout(resolve,50));}
 const r=await chrome.send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{const {analyzeMarkdown,provideCompletions}=await import('/editor-analysis.mjs');const complete=(text,pos=text.length)=>provideCompletions({text,pos,templateType:'general'},analyzeMarkdown(text));return {fonts:complete(${JSON.stringify('---\nfon\n---')},7).options.find(o=>o.label==='fonts').apply,kicker:complete(':::ki').options[0].apply,colophon:complete(':::co').options[0].apply};})()`});
 assert.equal(r.exceptionDetails,undefined,JSON.stringify(r.exceptionDetails));
 assert.match(r.result.value.fonts,/heading: "PostScript Name or Full Name"/);assert.match(r.result.value.fonts,/body: ""/);
 assert.equal(r.result.value.kicker,'kicker\n技术报告\n:::');
 assert.equal(r.result.value.colophon,'colophon\nleft: "编制：方鸿渐"\ncenter: "审核：褚慎明、韩学愈、李广智"\nright: "校对：范进、孔乙己、李梅亭"\n:::');
 console.log('browser completion defaults verified');
}finally{globalThis.fetch=nativeFetch;await chrome.stop();await app.close();await rm(tmp,{recursive:true,force:true});}
