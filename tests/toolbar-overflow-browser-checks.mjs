import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';

const app = createApp();
const temp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-actions-'));
const browser = new Chrome(findChrome(), temp);
const evaluate = async expression => {
  const result = await browser.send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const wait = async expression => {
  for (let n=0;n<200;n++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve,50));
  }
  throw new Error('Timeout: '+expression);
};
try {
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  await browser.start();
  await browser.send('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.navigate',{url:`http://127.0.0.1:${app.server.address().port}`});
  await wait('window.mdDrafts && window.mdEditor && document.querySelectorAll(".md-wt-overflow-trigger").length===2');
  await new Promise(resolve=>setTimeout(resolve,500));
  const state=await evaluate(`Array.from(document.querySelectorAll('.md-wt-overflow-trigger')).map(b=>({hidden:b.hidden, count:b.parentElement.querySelectorAll('.md-wt-overflow-item').length, height:b.parentElement.getBoundingClientRect().height}))`);
  console.log(JSON.stringify(state));
  assert.ok(state.every(s=>!s.hidden && s.count>0 && s.height<60));
  await browser.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await evaluate(`document.querySelector('.preview-toolbar .md-wt-overflow-trigger').scrollIntoView({block:'center'})`);
  const touchPoint = await evaluate(`(()=>{let r=document.querySelector('.preview-toolbar .md-wt-overflow-trigger').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await browser.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touchPoint]});
  await browser.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const menu=await evaluate(`(()=>{let b=document.querySelector('.preview-toolbar .md-wt-overflow-trigger');let e=b.parentElement.querySelector('.md-wt-overflow-open');let r=e.getBoundingClientRect();return {open:b.getAttribute('aria-expanded'), visible:getComputedStyle(e).visibility, left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);
  console.log(JSON.stringify(menu));
  assert.equal(menu.open,'true'); assert.equal(menu.visible,'visible'); assert.ok(menu.left>=0 && menu.right<=320 && menu.top>=0 && menu.bottom<=800);
  await evaluate(`document.querySelector('.preview-toolbar .md-wt-overflow-open summary').click()`);
  assert.equal(await evaluate(`document.querySelector('.preview-toolbar .md-wt-overflow-open details').open`),true);
  await wait(`(()=>{let r=document.querySelector('.preview-toolbar .md-wt-overflow-open .range-popover').getBoundingClientRect();return r.left>=0 && r.right<=320 && r.top>=0 && r.bottom<=800})()`);
  const nested = await evaluate(`(()=>{let r=document.querySelector('.preview-toolbar .md-wt-overflow-open .range-popover').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);
  assert.ok(nested.left>=0 && nested.right<=320 && nested.top>=0 && nested.bottom<=800,JSON.stringify(nested));
  await evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
  assert.equal(await evaluate(`document.querySelector('.preview-toolbar .md-wt-overflow-trigger').getAttribute('aria-expanded')`),'false');
  await evaluate(`document.querySelector('.md-wt-toolbar .md-wt-overflow-trigger').click()`);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.md-wt-toolbar .md-wt-overflow-open')).some(x=>Array.from(x.querySelectorAll('button')).some(b=>b.tabIndex===0)||x.matches('button[tabindex=\"0\"]'))`),true);
  await evaluate(`document.querySelector('.preview-toolbar').dataset.documentType='gb'`);
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(await evaluate(`document.querySelector('.preview-toolbar .md-wt-overflow-trigger').hidden`),true);
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1800,height:900,deviceScaleFactor:1,mobile:false});
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(await evaluate(`document.querySelector('.md-wt-toolbar .md-wt-overflow-trigger').hidden`),true);
  const beforeDrag = await evaluate(`document.querySelector('.editor-panel').getBoundingClientRect().width`);
  await evaluate(`(()=>{const d=document.querySelector('.md-wt-divider'),r=d.getBoundingClientRect();for(const [type,x] of [['pointerdown',r.left],['pointermove',r.left-180],['pointerup',r.left-180]])d.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:7,pointerType:'touch',clientX:x,clientY:r.top+20}));})()`);
  await new Promise(resolve=>setTimeout(resolve,300));
  const afterDrag = await evaluate(`document.querySelector('.editor-panel').getBoundingClientRect().width`);
  assert.ok(afterDrag < beforeDrag - 100, JSON.stringify({beforeDrag,afterDrag}));
  assert.ok(await evaluate(`document.querySelector('.md-wt-toolbar').getBoundingClientRect().height<60 && document.querySelector('.preview-toolbar').getBoundingClientRect().height<60`));
  await evaluate(`document.querySelector('.editor-panel [data-panel-fullscreen]').click()`);
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(await evaluate(`document.querySelector('.md-wt-toolbar .md-wt-overflow-trigger').hidden`),true);
  await evaluate(`document.querySelector('.editor-panel [data-panel-fullscreen]').click()`);
  await browser.send('Emulation.setDeviceMetricsOverride',{width:700,height:800,deviceScaleFactor:1,mobile:false});
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.ok(await evaluate(`document.querySelector('.md-wt-toolbar').getBoundingClientRect().height<60 && document.querySelector('.preview-toolbar').getBoundingClientRect().height<60`));
  console.log('overflow browser check passed');
} finally { await browser.stop(); await app.close(); await rm(temp,{recursive:true,force:true}); }
