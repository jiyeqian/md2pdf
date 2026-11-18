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
  for (const [trigger, labelText] of [['#download', '打印或下载 PDF'], ['button[aria-label="下载 Markdown"]', '保存 Markdown']]) {
    await evaluate(`document.querySelector('${trigger}').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}))`);
    const menu = `div[aria-label="${labelText}"]`;
    await wait(`document.querySelector('${menu}')`);
    if (labelText === '保存 Markdown') assert.deepEqual(await evaluate(`[...document.querySelectorAll('${menu} button span:first-child')].map(x=>x.textContent)`),['保存到本地','保存到 OneDrive']);
    assert.ok(await evaluate(`(()=>{const m=document.querySelector('${menu}'),r=m.getBoundingClientRect(),v=visualViewport;return r.left>=v.offsetLeft&&r.right<=v.offsetLeft+v.width&&r.top>=v.offsetTop&&r.bottom<=v.offsetTop+v.height})()`));
    await evaluate(`document.querySelector('${trigger}').dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}));document.querySelector('${menu}').dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}))`);
    await new Promise(resolve=>setTimeout(resolve,220)); assert.ok(await evaluate(`document.querySelector('${menu}')`));
    await evaluate(`document.querySelector('${menu}').dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}))`);
    await new Promise(resolve=>setTimeout(resolve,220)); assert.equal(await evaluate(`!!document.querySelector('${menu}')`),false);
    await evaluate(`document.querySelector('${trigger}').click();document.querySelector('${menu}').dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}))`);
    await new Promise(resolve=>setTimeout(resolve,220)); assert.ok(await evaluate(`document.querySelector('${menu}')`));
    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); assert.equal(await evaluate(`!!document.querySelector('${menu}')`),false);
    await evaluate(`document.querySelector('${trigger}').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}))`); assert.equal(await evaluate(`!!document.querySelector('${menu}')`),false);
  }
  await browser.send('Emulation.setDeviceMetricsOverride',{width:110,height:600,deviceScaleFactor:1,mobile:false});
  for (const [trigger, labelText] of [['#download', '打印或下载 PDF'], ['button[aria-label="下载 Markdown"]', '保存 Markdown']]) {
    await evaluate(`document.querySelector('${trigger}').click()`);
    const result=await evaluate(`(()=>{const m=document.querySelector('div[aria-label="${labelText}"]'),r=m.getBoundingClientRect();return {left:r.left,right:r.right,rows:[...m.querySelectorAll('button')].map(b=>{const [name,key]=b.querySelectorAll('span'),n=name.getBoundingClientRect(),k=key.getBoundingClientRect();return {wrapped:k.top>n.top,visible:n.left>=r.left&&n.right<=r.right&&k.left>=r.left&&k.right<=r.right,overflow:b.scrollWidth>b.clientWidth}})}})()`);
    assert.ok(result.left>=0&&result.right<=110&&result.rows.every(x=>x.visible&&!x.overflow),JSON.stringify(result));
    if (labelText === '保存 Markdown') assert.ok(result.rows.some(x=>x.wrapped),JSON.stringify(result));
    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  }
  await browser.send('Emulation.clearDeviceMetricsOverride');
  await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:700,deviceScaleFactor:1,mobile:false});
  await wait(`document.querySelector('.editor-panel .md-wt-overflow-trigger:not([hidden])')`);
  await evaluate(`document.querySelector('.editor-panel .md-wt-overflow-trigger').click()`);
  assert.equal(await evaluate(`document.querySelector('.editor-panel .md-wt-overflow-trigger').getAttribute('aria-expanded')`),'true');
  await evaluate(`document.querySelector('#download').click()`);
  assert.ok(await evaluate(`!!document.querySelector('div[aria-label="打印或下载 PDF"]')`));
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await browser.send('Emulation.clearDeviceMetricsOverride');
  await evaluate(`document.querySelector('#download').click()`); await wait(`document.querySelector('div[aria-label="打印或下载 PDF"]')`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('div[aria-label="打印或下载 PDF"] button')].map(x=>x.textContent.replace(/（.*）/,''))`),['打印 PDF','下载 PDF']);
  await mkdir('/private/tmp/md2pdf-pdf-menu',{recursive:true}); const shot=await browser.send('Page.captureScreenshot',{format:'png'}); await writeFile(`/private/tmp/md2pdf-pdf-menu/${label}.png`,Buffer.from(shot.data,'base64'));
  await evaluate(`document.querySelectorAll('div[aria-label="打印或下载 PDF"] button')[1].click()`);
  if(label==='static') { await wait(`document.querySelector('#md-static-pdf-notice')`); await evaluate(`document.querySelector('#md-static-pdf-notice button').click()`); await wait(`!document.querySelector('#md-static-pdf-notice')`); }
  else await wait('testDownloads===1');
  await evaluate(`document.querySelector('#download').click(); document.querySelector('#download').click()`); assert.equal(await evaluate(`document.querySelectorAll('div[aria-label="打印或下载 PDF"]').length`),0);
  await evaluate(`document.querySelector('.cm-content, #markdown').focus()`); await key(label==='static'?5:3,label==='static'?'π':'p');
  if(label==='static') {await wait(`document.querySelector('#md-static-pdf-notice')`);assert.equal(await evaluate(`document.querySelector('#md-static-pdf-notice a')?.href`),'https://md2pdf.app.workbuddy.host/?sharecode=YD24U7EHBM'); assert.equal(await evaluate(`testRequests.some(x=>x.includes('/api/pdf'))`),false);await evaluate(`document.querySelector('#md-static-pdf-notice button').click()`); await wait(`!document.querySelector('#md-static-pdf-notice')`);}
  else {await wait('testDownloads===2');assert.ok(await evaluate(`testRequests.some(x=>x.includes('/api/pdf'))`));}
  await evaluate(`mdEditor.setValue(''); mdDrafts?.schedule()`); await wait(`document.querySelector('#download').disabled`); await key(label==='static'?4:2); await new Promise(resolve=>setTimeout(resolve,300));assert.equal(await evaluate('testPrintStarted'),0);
  await evaluate(`mdEditor.setValue('# PDF PRINT MARKER'); mdDrafts?.schedule(); document.querySelector('.cm-content, #markdown').focus()`);await wait('!document.querySelector("#download").disabled'); await key(label==='static'?4:2); await wait('testPrintStarted===1');
  assert.ok((await evaluate('testFrames[0]')).includes('PDF PRINT MARKER')); assert.ok(!(await evaluate('testFrames[0]')).includes('MAKE MD2PDF GREAT'));
  await browser.stop(); browser=null;
 }
 console.log('PDF menu, document print bridge, download and keyboard checks passed');
} finally {if(browser)await browser.stop();await new Promise(resolve=>app.server.close(resolve));if(staticServer)await new Promise(resolve=>staticServer.close(resolve));await rm(temp,{recursive:true,force:true});}
