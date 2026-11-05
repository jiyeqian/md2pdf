import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Chrome, findChrome } from '../src/chrome.mjs';

for (const mode of ['node','static']) {
  const dir=await mkdtemp('/tmp/md2pdf-manual-update-');
  const browser=new Chrome(findChrome(),dir);
  const base=mode==='static'?'/md2pdf/':'/';
  let revision='old';
  const helper=await readFile(new URL('../web/manual-update.mjs',import.meta.url),'utf8');
  const footer=await readFile(new URL('../web/footer-status.js',import.meta.url),'utf8');
  const worker=await readFile(new URL(mode==='static'?'../web/platform-static/cache.js':'../web/app-worker.js',import.meta.url),'utf8');
  const page=()=>`<!doctype html><meta charset="utf-8"><a class="brand-icon" href="${base}">M↓</a><div class="app-bottom-center"><div id="app-resource-status"></div></div><script src="./footer-status.js"></script><script type="module">
    import {bindManualUpdate} from './manual-update.mjs';
    window.release=${JSON.stringify(revision)};
    window.states=[];const setStatus=mdFooterStatus.set;mdFooterStatus.set=(...args)=>{window.states.push(args[1]);setStatus(...args);};
    window.mdDrafts={flush:async()=>{if(window.failSave)throw Error('save failed');localStorage.setItem('draft','unsaved document');}};
    const registration=await navigator.serviceWorker.register('./service-worker.js',{scope:'./',updateViaCache:'none'});
    await navigator.serviceWorker.ready;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(window.reloading)location.reload();});
    bindManualUpdate({getRegistration:async()=>registration,statusType:${JSON.stringify(mode==='static'?'APP_CACHE_STATUS':'APP_STATUS')},activation:${mode==='static'},
      applyUpdate:()=>mdFooterStatus.saveAndUpdate(async()=>{window.reloading=true;if(registration.waiting)registration.waiting.postMessage({type:'APP_ACTIVATE'});else location.reload();})});
    window.ready=true;
  </script>`;
  const server=http.createServer((request,response)=>{
    const html=page();
    const files={[base]:html,[base+'index.html']:html,[base+'manual-update.mjs']:helper,[base+'footer-status.js']:footer};
    response.setHeader('Cache-Control','no-store');
    if(request.url===base+'service-worker.js'){
      const entries=Object.entries(files).map(([url,text])=>({url:mode==='static'?url.slice(base.length)||'index.html':url,hash:createHash('sha256').update(text).digest('hex')}));
      response.setHeader('Content-Type','text/javascript');
      response.end(mode==='static'?`const VERSION=${JSON.stringify(revision)},FILES=${JSON.stringify(entries)};\n${worker}`:`const APP_VERSION=${JSON.stringify(revision)},APP_FILES=${JSON.stringify(entries)};\n${worker}`);
    }else if(files[request.url]!==undefined){response.setHeader('Content-Type',request.url.endsWith('.js')||request.url.endsWith('.mjs')?'text/javascript':'text/html');response.end(files[request.url]);}
    else{response.writeHead(404);response.end();}
  });
  const evaluate=async expression=>{
    const result=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));return result.result.value;
  };
  const wait=async expression=>{
    for(let i=0;i<300;i++){
      try{if(await evaluate(`Boolean(${expression})`))return;}catch(error){if(!/context|navigated|Cannot find/.test(error.message))throw error;}
      await new Promise(resolve=>setTimeout(resolve,50));
    }throw Error('Timeout: '+expression+'; '+await evaluate(`JSON.stringify({status:document.querySelector('#app-resource-status').textContent,release:window.release,ready:window.ready,online:navigator.onLine})`));
  };
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    await browser.start();
    await browser.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}${base}`});
    await wait('window.ready && navigator.serviceWorker.controller');
    await evaluate(`document.querySelector('.brand-icon').click()`);
    await wait(`window.states.includes('latest')`);
    revision='new';
    await evaluate(`window.failSave=true;document.querySelector('.brand-icon').click()`);
    await wait(`document.querySelector('#app-resource-status').textContent.includes('保存失败')`);
    assert.equal(await evaluate('window.release'),'old','save failure must never navigate');
    await evaluate(`window.failSave=false;document.querySelector('.brand-icon').click()`);
    await wait(`window.ready && window.release==='new'`);
    assert.equal(await evaluate(`localStorage.getItem('draft')`),'unsaved document');
    await browser.send('Network.enable');
    await browser.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await evaluate(`document.querySelector('.brand-icon').click()`);
    await wait(`document.querySelector('#app-resource-status').textContent.includes('检查更新失败')`);
    assert.equal(await evaluate('window.release'),'new');
    console.log(`✓ ${mode}: latest, complete update, save failure, draft preservation and offline failure${mode==='static'?' at /md2pdf/':''}`);
  } finally {
    await browser.stop();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});
  }
}
