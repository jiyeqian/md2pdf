import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import path from 'node:path';
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Chrome,findChrome} from '../src/chrome.mjs';
import {createApp} from '../src/server.mjs';
import {buildStatic} from '../src/static-build.mjs';
import {render} from '../src/render.mjs';
import {withGbFontFallback} from '../src/gb-fonts.mjs';
const tmp=await mkdtemp('/private/tmp/md2pdf-fonts-');
const browser=new Chrome(findChrome(),tmp),app=createApp();
let staticServer;
const originalFetch=globalThis.fetch;
const report={checks:[]};
const absent='MD2PDF Deliberately Absent Font 20261030';
const text=(fonts)=>'---\ntitle: Font Test\n标准号: GB/T 39999—2026\n中文名称: 字体测试\nfonts:\n'+Object.entries(fonts).map(([k,v])=>'  '+k+': '+v).join('\n')+'\n---\n\n## 范围\n\nBodyLatin ABC123 中文正文。\n\n### HeadingLatin 标题\n\n`CodeLatin ABC123`\n\n```text\nBlockCode ABC123\n```\n\n图：Font flow {#fig:font-flow}\n\n```mermaid\nflowchart LR\n A[Start ABC123]-->B[End]\n```';
const evaluate=async expression=>{const r=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(r.exceptionDetails,undefined,JSON.stringify(r.exceptionDetails));return r.result.value;};
try {
 const build=await buildStatic();
 globalThis.fetch=async(input,init)=>new URL(input).protocol==='file:'?new Response(await readFile(new URL(input))):originalFetch(input,init);
 const offline=await import(pathToFileURL(build.directory+'/runtime.mjs'));
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 const post=(route,body)=>originalFetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 await browser.start();
 report.browser=await browser.send('Browser.getVersion',{});
 const md=text({body:'Arial',heading:'Helvetica',western:'Times New Roman',code:'Menlo'});
 for(const type of ['general','skill','paper','gb']) {
  const core=await render(md,{type,pagedHtml:true});
  for(const runtime of ['node','static']) {
   let html;
   if(runtime==='node') {const response=await post('/api/preview',{md,opts:{type}});assert.equal(response.status,200);html=(await response.json()).html;}
   else html=(await offline.renderDocument({md,opts:{type}},true)).html;
   await browser.printHtml(html,{...core.printOptions,requireFonts:false,requireGbFonts:false,waitPaged:true});
   const state=await evaluate(`(()=>{
    const root=document.querySelector('.pagedjs_pages');
    const p=[...root.querySelectorAll('main p')].find(n=>n.textContent.includes('BodyLatin'));
    const heading=[...root.querySelectorAll('h3')].find(n=>n.textContent.includes('HeadingLatin'));
    const code=root.querySelector('main code');
    const cs=n=>getComputedStyle(n).fontFamily;
    p.id='font-body-probe';code.id='font-code-probe';
    const cover=root.querySelector('.cover-cn'), standard=root.querySelector('.cover-stdno'), title=root.querySelector('.gb-body-title');
    const header=root.querySelector('.gb-fixed-header');
    return {body:cs(p),heading:cs(heading),code:cs(code),size:getComputedStyle(p).fontSize,line:getComputedStyle(p).lineHeight,graph:root.querySelector('figure .nodeLabel')?cs(root.querySelector('figure .nodeLabel')):null,cover:cover?cs(cover):null,standard:standard?cs(standard):null,title:title?cs(title):null,header:header?cs(header):null,missing:window.__md2pdfFontError||null};
   })()`);
   assert.ok(state.body.includes('MD2PDF User body')&&state.body.includes('MD2PDF User western'),JSON.stringify(state));
   assert.ok(state.heading.includes('MD2PDF User heading'));
   assert.ok(state.code.includes('MD2PDF User code')&&!state.code.includes('western'));
   assert.ok(state.graph?.includes('MD2PDF User'),JSON.stringify(state));
   assert.equal(state.missing,null,'test fonts must be installed: '+JSON.stringify(state.missing));
   if(type==='gb') {
    for (const key of ['cover','standard','title','header']) assert.ok(state[key]&&!state[key].includes('MD2PDF User'),key+': '+JSON.stringify(state));
    assert.ok(Math.abs(parseFloat(state.size)-14)<.1);
    assert.ok(Math.abs(parseFloat(state.line)-22.68)<.1);
   }
   await browser.send('DOM.enable',{});await browser.send('CSS.enable',{});
   const dom=await browser.send('DOM.getDocument',{});
   const platform=async selector=>{const node=await browser.send('DOM.querySelector',{nodeId:dom.root.nodeId,selector});return (await browser.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId})).fonts;};
   const bodyFonts=await platform('#font-body-probe'), codeFonts=await platform('#font-code-probe');
   assert.ok(bodyFonts.some(f=>/Times/i.test(f.familyName)&&f.glyphCount>0),JSON.stringify(bodyFonts));
   assert.ok(codeFonts.some(f=>/Menlo/i.test(f.familyName)&&f.glyphCount>0),JSON.stringify(codeFonts));
   report.checks.push({runtime,type,...state,bodyFonts,codeFonts});
   console.log(runtime+'/'+type+': custom families, Western range and code precedence verified');
  }
 }
 const noWestern=await render(text({body:'Arial',heading:'Helvetica',code:'Menlo'}),{type:'general',theme:'minimal',pagedHtml:true});
 await browser.printHtml(noWestern.html,noWestern.printOptions);
 await evaluate(`(()=>{document.querySelector('h3').id='heading-without-western';return true;})()`);
 await browser.send('DOM.enable',{});await browser.send('CSS.enable',{});
 const headingDom=await browser.send('DOM.getDocument',{});
 const headingNode=await browser.send('DOM.querySelector',{nodeId:headingDom.root.nodeId,selector:'#heading-without-western'});
 const headingFonts=(await browser.send('CSS.getPlatformFontsForNode',{nodeId:headingNode.nodeId})).fonts;
 assert.ok(headingFonts.some(f=>/Helvetica/i.test(f.familyName)&&f.glyphCount>0),JSON.stringify(headingFonts));
 report.minimalHeadingFonts=headingFonts;
 await mkdir('output/pdf',{recursive:true});
 const configuredPdf=await post('/api/pdf',{md,opts:{type:'general'}});
 assert.equal(configuredPdf.status,200);
 await writeFile('output/pdf/custom-fonts-node.pdf',Buffer.from(await configuredPdf.arrayBuffer()));
 const missingMd=text({body:absent});
 const raw=await render(missingMd,{type:'general',pagedHtml:true});
 await assert.rejects(()=>browser.printHtml(raw.html,raw.printOptions),e=>e.code==='FONT_MISSING'&&e.fonts.includes(absent));
 const preview=await post('/api/preview',{md:missingMd,opts:{type:'general'}});
 await browser.printHtml((await preview.json()).html,{waitPaged:true,waitFonts:true});
 assert.ok(await evaluate("Boolean(document.getElementById('font-fallback-warning'))"));
 let response=await post('/api/pdf',{md:missingMd,opts:{type:'general'}});
 assert.equal(response.status,503);assert.equal((await response.json()).code,'FONT_MISSING');
 response=await post('/api/pdf',{md:missingMd,opts:{type:'general'},allowFontFallback:true});
 assert.equal(response.status,200);
 await mkdir('output/pdf',{recursive:true});await writeFile('output/pdf/custom-fonts-node-fallback.pdf',Buffer.from(await response.arrayBuffer()));
 const file=tmp+'/input.md';await writeFile(file,missingMd);
 let rejected=false;
 try {execFileSync(process.execPath,['src/md2pdf.mjs',file,'--type','general','-o',tmp+'/strict.pdf'],{stdio:'pipe'});} catch(error){rejected=true;assert.ok(error.stderr.toString().includes(absent));}
 assert.ok(rejected,'CLI must reject absent custom font');
 execFileSync(process.execPath,['src/md2pdf.mjs',file,'--type','general','--allow-font-fallback','-o',tmp+'/fallback.pdf'],{stdio:'pipe'});
 assert.equal((await readFile(tmp+'/fallback.pdf')).subarray(0,5).toString(),'%PDF-');
 execFileSync(process.execPath,['src/md2pdf.mjs',file,'--type','general','--font-body','Arial','--font-code','Menlo','-o',tmp+'/override.pdf'],{stdio:'pipe'});
 assert.equal((await readFile(tmp+'/override.pdf')).subarray(0,5).toString(),'%PDF-');
 const staticRaw=await offline.renderDocument({md:missingMd,opts:{type:'general'}},false);
 await assert.rejects(()=>browser.printHtml(staticRaw.html,raw.printOptions),e=>e.code==='FONT_MISSING');
 await browser.printHtml(withGbFontFallback(staticRaw.html),raw.printOptions);
 // Exercise the actual static sandbox and consent dialog. Intercept only the
 // native print handoff; this does not claim system-print UI acceptance.
 staticServer=createServer(async(req,res)=>{
  if(req.url==='/fonts-probe.html') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/static.css"><script src="/template-confirm.js"></script>');return;}
  try {
   const file=path.resolve(build.directory,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
   if(!file.startsWith(build.directory+path.sep))throw new Error('outside');
   const mime=file.endsWith('.mjs')||file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'application/octet-stream';
   res.setHeader('Content-Type',mime);res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>staticServer.listen(0,'127.0.0.1',resolve));
 await browser.send('Page.navigate',{url:'http://127.0.0.1:'+staticServer.address().port+'/fonts-probe.html'});
 const waitFor=async expression=>{for(let i=0;i<300;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw new Error('browser wait: '+expression);};
 await waitFor("typeof window.mdExportWithFontConsent === 'function' && document.readyState==='complete'");
 await evaluate(`(async()=>{
  window.__readyPrints=0;
  addEventListener('message',event=>{
   if(event.data?.type!=='print-ready')return;
   const frame=[...document.querySelectorAll('iframe.static-print-frame')].find(f=>f.contentWindow===event.source);
   if(!frame)return;
   event.stopImmediatePropagation();window.__readyPrints++;
   setTimeout(()=>{for(const type of ['print-started','print-finished'])dispatchEvent(new MessageEvent('message',{source:event.source,data:{type,id:event.data.id}}));},0);
  });
  window.__pdf=await import('/pdf.mjs');return true;
 })()`);
 for(const accepted of [false,true]) {
  await evaluate(`(()=>{window.__exportOutcome=null;window.mdExportWithFontConsent(allowFontFallback=>window.__pdf.exportPdf({md:${JSON.stringify(missingMd)},opts:{type:'general'},allowFontFallback})).then(()=>window.__exportOutcome='download',error=>window.__exportOutcome=error.code);return true;})()`);
  await waitFor("Boolean(document.querySelector('.font-error-dialog[open]'))");
  assert.equal(await evaluate('document.activeElement.textContent'),'下载');
  assert.ok((await evaluate("document.querySelector('.font-error-dialog').textContent")).includes(absent));
  await evaluate("document.querySelector('.font-error-dialog "+(accepted?'.primary':'.template-confirm-cancel')+"').click()");
  await waitFor('window.__exportOutcome!==null');
  assert.equal(await evaluate('window.__exportOutcome'),accepted?'download':'EXPORT_CANCELLED');
  assert.equal(await evaluate('window.__readyPrints'),accepted?1:0);
 }
 report.missingFont={font:absent,nodeStrictStatus:503,nodeConfirmedStatus:200,cliStrictRejected:true,cliExplicitFallback:true,cliOverrides:true,staticCancel:'EXPORT_CANCELLED',staticConfirmed:true,nativePrintStubbed:true};
 await writeFile('/private/tmp/md2pdf-fonts-acceptance.json',JSON.stringify(report,null,2)+'\n');
 console.log('Static sandbox: actual font rejection and consent/cancel dialog verified; only native print is stubbed.');
 console.log('Missing custom font: preview fallback, Node strict/confirmed PDF, CLI strict/explicit fallback, static print document strict/allowed verified. System print UI is not exercised.');
} finally {
 globalThis.fetch=originalFetch;await browser.stop();await app.close();if(staticServer)await new Promise(resolve=>staticServer.close(resolve));await rm(tmp,{recursive:true,force:true});
}
