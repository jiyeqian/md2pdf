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
 await browser.start();
 for(const [runtime,type] of [['node','gb'],['static','gb'],['node','general'],['node','paper'],['node','skill']]) {
  const md=await readFile(new URL('../web/examples/'+type+'.md',import.meta.url),'utf8');
  const body={md,opts:{type}};
  let html;
  if(runtime==='static') html=(await offline.renderDocument(body,true)).html;
  else {
   const response=await nativeFetch(base+'/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   assert.equal(response.status,200);
   html=(await response.json()).html;
  }
  await browser.printHtml(html,{waitPaged:true,webSafe:true});
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
} finally {
 globalThis.fetch=nativeFetch;
 await browser.stop();await app.close();await rm(tmp,{recursive:true,force:true});
}
