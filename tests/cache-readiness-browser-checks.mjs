import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';

const app=createApp();
const dir=await mkdtemp(path.join(os.tmpdir(),'md2pdf-cache-gate-'));
const browser=new Chrome(findChrome(),dir);
try{
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  await browser.start();
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.timeline=[];const mark=name=>window.timeline.push({name,at:performance.now()});window.addEventListener('md-app-ready',()=>mark('app-ready'));window.addEventListener('md-preview-ready',()=>mark('preview-ready'));window.addEventListener('md-preview-error',()=>mark('preview-error'));const original=navigator.serviceWorker.register.bind(navigator.serviceWorker);navigator.serviceWorker.register=(...args)=>{mark('service-worker-register');return original(...args)};`});
  await browser.send('Page.navigate',{url:`http://127.0.0.1:${app.server.address().port}`});
  const evaluate=async expression=>{const result=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));return result.result.value;};
  for(let n=0;n<150;n++){if(await evaluate('window.__MD2PDF_APP_READY__===true'))break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(await evaluate('window.__MD2PDF_APP_READY__'),true,'application reaches ready before preview is measured');
  await evaluate('window.timeline=[]');
  await evaluate(`mdEditor.setValue('# Node readiness');document.querySelector('#markdown').dispatchEvent(new Event('input',{bubbles:true}))`);
  for(let n=0;n<400;n++){
    if(await evaluate(`window.timeline?.some(item=>['preview-ready','preview-error'].includes(item.name))`))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const timeline=await evaluate('window.timeline');
  const previewReady=timeline.find(item=>item.name==='preview-ready');
  const previewError=timeline.find(item=>item.name==='preview-error');
  const terminal=previewReady||previewError;
  const registration=timeline.find(item=>item.name==='service-worker-register');
  assert.ok(terminal,`Node preview must explicitly report success or failure: ${JSON.stringify(timeline)}`);
  assert.ok(registration&&registration.at>=terminal.at,JSON.stringify(timeline));
  if(previewError)assert.match(await evaluate('document.querySelector("#status").textContent'),/超时|失败/);
  console.log('PASS Node preview result and cache ordering:',JSON.stringify({timeline,result:previewError?'preview error was surfaced':'preview succeeded'}));
}finally{await browser.stop();await app.close();await rm(dir,{recursive:true,force:true});}
