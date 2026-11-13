import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../src/server.mjs';
import { startStaticServer } from '../src/static-server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';
const app=createApp({chromeBinary:'mock',chromeFactory:()=>({start:async()=>{},stop:async()=>{},printHtml:async()=>Buffer.from('%PDF-1.4\nmock')})});
const temp=await mkdtemp(path.join(os.tmpdir(),'md2pdf-pdf-menu-')); let browser, staticServer;
const evaluate=async expression=>{const r=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(r.exceptionDetails,undefined,JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=async expression=>{for(let i=0;i<200;i++){try{if(await evaluate(`Boolean(${expression})`))return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Timeout: '+expression);};
const key=async (modifiers,keyValue='p')=>{await browser.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:keyValue,code:'KeyP',windowsVirtualKeyCode:80,nativeVirtualKeyCode:80,modifiers});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:keyValue,code:'KeyP',windowsVirtualKeyCode:80,nativeVirtualKeyCode:80,modifiers});};
try {
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve)); staticServer=await startStaticServer({directory:path.resolve('dist/static'),port:0});
 for(const [label,base] of [['node',`http://127.0.0.1:${app.server.address().port}`],['static',`http://127.0.0.1:${staticServer.address().port}`]]){
  browser=new Chrome(findChrome(),temp); await browser.start();
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(window===top){window.testPrintStarted=0;window.testFrames=[];window.testDownloads=0;window.testRequests=[];addEventListener('message',e=>{if(e.data?.type==='print-started')testPrintStarted++});new MutationObserver(()=>{for(const f of document.querySelectorAll('.static-print-frame'))if(!f.dataset.captured){f.dataset.captured='true';testFrames.push(f.srcdoc)}}).observe(document,{childList:true,subtree:true});const native=window.fetch.bind(window);window.fetch=(url,opts)=>{testRequests.push(String(url));return native(url,opts)};const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){testDownloads++;return;}return click.call(this)};}`});
  await browser.send('Page.navigate',{url:base+'/'}); await wait('window.mdEditor && window.md2pdfConfigErrors && !document.querySelector("#download").disabled');
  await evaluate(`mdEditor.setValue('# PDF PRINT MARKER'); mdDrafts?.schedule()`); await wait('!document.querySelector("#download").disabled');
  await evaluate(`document.querySelector('#download').click()`); await wait(`document.querySelector('div[aria-label="打印或下载 PDF"]')`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('div[aria-label="打印或下载 PDF"] button')].map(x=>x.textContent.replace(/（.*）/,''))`),['打印…','下载 PDF']);
  await mkdir('/private/tmp/md2pdf-pdf-menu',{recursive:true}); const shot=await browser.send('Page.captureScreenshot',{format:'png'}); await writeFile(`/private/tmp/md2pdf-pdf-menu/${label}.png`,Buffer.from(shot.data,'base64'));
  await evaluate(`document.querySelectorAll('div[aria-label="打印或下载 PDF"] button')[1].click()`);
  if(label==='static') { await wait(`document.querySelector('#md-static-pdf-notice')`); await evaluate(`document.querySelector('#md-static-pdf-notice button').click()`); }
  else await wait('testDownloads===1');
  await evaluate(`document.querySelector('#download').click(); document.querySelector('#download').click()`); assert.equal(await evaluate(`document.querySelectorAll('div[aria-label="打印或下载 PDF"]').length`),0);
  await evaluate(`document.querySelector('.cm-content, #markdown').focus()`); await key(label==='static'?5:3,label==='static'?'π':'p');
  if(label==='static') {await wait(`document.querySelector('#md-static-pdf-notice')`);assert.equal(await evaluate(`testRequests.some(x=>x.includes('/api/pdf'))`),false);await evaluate(`document.querySelector('#md-static-pdf-notice button').click()`);}
  else {await wait('testDownloads===2');assert.ok(await evaluate(`testRequests.some(x=>x.includes('/api/pdf'))`));}
  await evaluate(`mdEditor.setValue(''); mdDrafts?.schedule()`); await wait(`document.querySelector('#download').disabled`); await key(label==='static'?4:2); await new Promise(resolve=>setTimeout(resolve,300));assert.equal(await evaluate('testPrintStarted'),0);
  await evaluate(`mdEditor.setValue('# PDF PRINT MARKER'); mdDrafts?.schedule(); document.querySelector('.cm-content, #markdown').focus()`);await wait('!document.querySelector("#download").disabled'); await key(label==='static'?4:2); await wait('testPrintStarted===1');
  assert.ok((await evaluate('testFrames[0]')).includes('PDF PRINT MARKER')); assert.ok(!(await evaluate('testFrames[0]')).includes('MAKE MD2PDF GREAT'));
  await browser.stop(); browser=null;
 }
 console.log('PDF menu, document print bridge, download and keyboard checks passed');
} finally {if(browser)await browser.stop();await new Promise(resolve=>app.server.close(resolve));if(staticServer)await new Promise(resolve=>staticServer.close(resolve));await rm(temp,{recursive:true,force:true});}
