import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.mjs';
import {buildStatic} from '../src/static-build.mjs';
import {Chrome,findChrome} from '../src/chrome.mjs';
const temp=await mkdtemp('/private/tmp/content-browser-'),chrome=new Chrome(findChrome(),temp),app=createApp(),nativeFetch=globalThis.fetch;
const md='---\ntitle: 内容声明验收\nauthor: 张三\nversion: v2\ntags: [文档管理]\n---\n\n:::kicker\n技术研究报告\n:::\n\n## 摘要 {role=abstract}\n\n研究 **方法** 与排版。\n\n第二段内容。\n\n## 关键词 {role=keywords}\n\n- 矢量图形\n- 版面校准\n\n## 正文\n\n引用[^r]。\n\n## 参考资料 {role=bibliography}\n\n## 后记\n\n后记内容。\n\n[^r]: 参考内容\n\n:::colophon\nleft: 编制：张三\nright: ""\n:::';
try{
 const build=await buildStatic();globalThis.fetch=async(input,init)=>new URL(input).protocol==='file:'?new Response(await readFile(new URL(input))):nativeFetch(input,init);
 const offline=await import(pathToFileURL(build.directory+'/runtime.mjs'));
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
 await chrome.start();await mkdir('output/pdf',{recursive:true});
 for(const type of ['general','paper','skill'])for(const runtime of ['node','static']){
  const body={md,opts:{type}};
  const response=runtime==='node'?await nativeFetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}):await offline.appFetch('/api/render',{body:JSON.stringify(body)});
  assert.equal(response.status,200);const result=await response.json();
  const pdf=await chrome.printHtml(result.html,{webSafe:true,waitPaged:true,outline:true});
  const state=await chrome.send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const scope=document.querySelector('.pagedjs_pages')||document;return {abstract:scope.querySelector('.abstract')?.textContent,keywords:scope.querySelector('.keywords')?.textContent,kicker:scope.querySelector('.kicker')?.textContent,cols:[...scope.querySelectorAll('.colophon > span')].map(e=>e.textContent),refs:scope.querySelectorAll('ol.references li').length,headings:[...scope.querySelectorAll('h2')].map(e=>e.textContent),error:window.__md2pdfPagedError};})()`});
  assert.equal(state.exceptionDetails,undefined);const s=state.result.value;
  assert.ok(!s.error);assert.ok(s.abstract.includes('第二段内容'));assert.ok(s.keywords.includes('矢量图形；版面校准'));
  assert.equal(s.kicker,'技术研究报告');assert.deepEqual(s.cols,['编制：张三','v2','']);assert.equal(s.refs,1);
  assert.equal(s.headings.filter(t=>t==='摘要').length,1);
  assert.equal(s.headings.filter(t=>t==='关键词').length,1);
  assert.ok(!s.headings.some(t=>/^[0-9一二三四五六七八九十]+[、.　 ]*(摘要|关键词)$/.test(t)));
  if(type==='paper')assert.ok(s.headings.includes('参考资料'));
  await writeFile('output/pdf/content-'+type+'-'+runtime+'.pdf',pdf);
  console.log(runtime+'/'+type+': summaries, keywords, explicit references and partial colophon override verified');
 }
}finally{globalThis.fetch=nativeFetch;await chrome.stop();await app.close();await rm(temp,{recursive:true,force:true});}
