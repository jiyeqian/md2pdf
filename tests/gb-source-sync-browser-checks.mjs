import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Chrome,findChrome} from '../src/chrome.mjs';
import {createApp} from '../src/server.mjs';
import {buildStatic} from '../src/static-build.mjs';
import {parseMarkdownHeadings} from '../src/editor-position.mjs';
const tmp=await mkdtemp('/private/tmp/gb-source-sync-');
const browser=new Chrome(findChrome(),tmp),app=createApp();
const nativeFetch=globalThis.fetch;
try {
 const build=await buildStatic();
 globalThis.fetch=async(input,init)=>new URL(input).protocol==='file:'?new Response(await readFile(new URL(input))):nativeFetch(input,init);
 const offline=await import(pathToFileURL(build.directory+'/runtime.mjs'));
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 assert.equal((await nativeFetch(base+'/src/gb-sections.mjs')).status,200,'editor shared section module is served');
 await browser.start();
 for(const [runtime,type] of [['node','gb'],['static','gb'],['node','general'],['node','paper'],['static','paper'],['node','skill']]) {
  const md=await readFile(new URL('../web/examples/'+type+'.md',import.meta.url),'utf8');
  const body={md,opts:{type}};
  let html;
  if(runtime==='static') html=(await offline.renderDocument(body,true)).html;
  else {
   const response=await nativeFetch(base+'/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   assert.equal(response.status,200);
   html=(await response.json()).html;
  }
  html=html.replace('<head>','<head><script>addEventListener("message",e=>{if(e.data?.type==="md2pdf-outline")window.__testOutline=e.data.headings;});</script>');
  await browser.printHtml(html,{waitPaged:true,webSafe:true});
  if(type==='gb') {
   const outline=await browser.send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:'new Promise(resolve=>setTimeout(()=>resolve(window.__testOutline?.map(h=>h.text)),100))'});
   assert.ok(outline.result.value?.includes('目次'),runtime+' contents in preview outline');
   assert.ok(outline.result.value?.includes('参考文献'),runtime+' bibliography in preview outline');
   assert.ok(outline.result.value?.includes('1　范围'),runtime+' first chapter outline excludes document title');
   assert.ok(!outline.result.value.some(t=>t.includes('仿生机械手抓取控制系统技术要求')&&t.includes('1　范围')),runtime+' document title not included in chapter outline');
  }
  if(type==='paper') {
   const outline=await browser.send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:'new Promise(resolve=>setTimeout(()=>resolve(window.__testOutline),100))'});
   const entries=outline.result.value;
   for(const label of ['摘要','关键词']) {
    assert.equal(entries.filter(h=>h.text===label&&h.level===2).length,1,runtime+' unnumbered summary navigation');
    const index=entries.findIndex(h=>h.text===label);
    const jump=await browser.send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{dispatchEvent(new MessageEvent('message',{source:parent,data:{type:'md2pdf-outline-locate',index:${index}}}));const target=document.querySelector('.md2pdf-preview-target');return {role:target?.dataset.documentRole,line:Number(target?.dataset.md2pdfSourceLine)};})()`});
    assert.equal(jump.result.value.role,label==='摘要'?'abstract':'keywords');
    assert.ok(jump.result.value.line>0,runtime+' outline selects source-linked summary block');
   }
  }
  const lines=parseMarkdownHeadings(md).filter(h=>h.level>=2&&h.level<=6).map(h=>h.line);
  const result=await browser.send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
   return ${JSON.stringify(lines)}.map(line=>{
    dispatchEvent(new MessageEvent('message',{source:parent,data:{type:'md2pdf-locate',line,instant:true}}));
    const target=document.querySelector('.md2pdf-preview-target');
    return {line,actual:Number(target?.getAttribute('data-md2pdf-source-line'))||0};
   });
  })()`});
  assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));
  for(const item of result.result.value) assert.equal(item.actual,item.line,runtime+'/'+type+' line '+item.line);
  console.log(runtime+'/'+type+': '+lines.length+' heading location messages select their exact source headings');
 }
 await browser.send('Network.setBlockedURLs',{urls:[]});
 await browser.send('Page.navigate',{url:base+'/'});
 for(let i=0;i<100;i++) {
  const state=await browser.send('Runtime.evaluate',{returnByValue:true,expression:'location.href'});
  if(state.result?.value===base+'/') break;
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 const editor=await browser.send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
  const {analyzeMarkdown,provideCompletions}=await import('/editor-analysis.mjs');
  const text='## 数据 {role=appendix}';
  const result=analyzeMarkdown(text,{templateType:'gb'});
  const prefix='## 数据 {na';
  const missing=analyzeMarkdown('---\\ntoc: 3\\n---\\n\\n## 范围\\n\\n文献[^ref]。\\n\\n[^ref]: 来源',{templateType:'gb'});
  return {missing:missing.diagnostics,diagnostics:result.diagnostics,options:provideCompletions({text:prefix,pos:prefix.length,templateType:'gb'},result).options.map(o=>o.label)};
 })()`});
 assert.equal(editor.exceptionDetails,undefined,JSON.stringify(editor.exceptionDetails));
 assert.ok(editor.result.value.diagnostics.some(d=>d.code==='gb-appendix-nature'&&d.line===1));
 assert.ok(editor.result.value.options.includes('nature=normative'));
 assert.ok(editor.result.value.missing.some(d=>d.code==='gb-missing-toc'&&d.line===2));
 assert.ok(editor.result.value.missing.some(d=>d.code==='gb-missing-bibliography'&&d.line===7));
 console.log('Node editor browser module: missing-nature diagnostic and heading completion load successfully');

} finally {
 globalThis.fetch=nativeFetch;
 await browser.stop();await app.close();await rm(tmp,{recursive:true,force:true});
}
