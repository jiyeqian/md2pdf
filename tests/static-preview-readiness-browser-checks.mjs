import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Chrome, findChrome } from '../src/chrome.mjs';
import { buildStatic } from '../src/static-build.mjs';

const build=await buildStatic();
const dir=await mkdtemp(path.join(os.tmpdir(),'md2pdf-static-preview-'));
const browser=new Chrome(findChrome(),dir);
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=new URL(request.url,'http://localhost').pathname;
    const file=path.resolve(build.directory,pathname.replace(/^\/md2pdf\//,'')||'index.html');
    if(!file.startsWith(build.directory+path.sep))throw new Error('bad path');
    response.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    response.end(await readFile(file));
  }catch{response.writeHead(404);response.end();}
});
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  await browser.start();
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(window.top===window){window.timeline=[];window.iframeFlags=null;const mark=name=>window.timeline.push({name,at:performance.now(),visible:document.visibilityState==='visible',intersects:(()=>{const r=document.querySelector('#preview')?.getBoundingClientRect();return !!r&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth})()});window.addEventListener('md-app-ready',()=>mark('app-ready'));window.addEventListener('md-preview-ready',()=>mark('preview-ready'));window.addEventListener('md-preview-error',()=>mark('preview-error'));window.addEventListener('md2pdf-offline-ready',event=>{if(event.detail.ready)mark('offline-ready')});window.addEventListener('message',event=>{if(event.data?.type==='md2pdf-ready'||event.data?.type==='md2pdf-error')mark(event.data.type);if(event.data?.type==='static-preview-probe')window.iframeFlags=event.data.flags});}`});
  await browser.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/md2pdf/`});
  const evaluate=async expression=>{const result=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));return result.result.value;};
  const wait=async expression=>{for(let n=0;n<450;n++){if(await evaluate(`Boolean(${expression})`))return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Timeout: '+expression)};
  await wait('window.mdEditor && window.__MD2PDF_APP_READY__');
  await evaluate(`mdEditor.setValue('# Static readiness');document.querySelector('#markdown').dispatchEvent(new Event('input',{bubbles:true}))`);
  await wait(`document.querySelector('#preview').srcdoc.includes('Static readiness')`);
  await wait(`window.timeline.some(item=>item.name==='preview-ready'||item.name==='preview-error')`);
  const timeline=await evaluate('window.timeline'),flags=await evaluate('window.iframeFlags');
  const preview=timeline.find(item=>item.name==='preview-ready');
  assert.ok(preview,`normal static preview must succeed: ${JSON.stringify(timeline)}`);
  assert.equal(preview.visible,true,JSON.stringify(timeline));
  assert.equal(preview.intersects,true,`iframe intersects fixed 1440x1000 viewport: ${JSON.stringify(timeline)}`);
  await wait(`window.timeline.some(item=>item.name==='offline-ready')`);
  console.log('PASS visible static preview and offline readiness:',JSON.stringify({timeline:await evaluate('window.timeline'),flags}));
}finally{await browser.stop();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
