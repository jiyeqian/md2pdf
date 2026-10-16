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
const clickCreate = async () => {
  await evaluate(`document.querySelector('#create-markdown').click()`);
  await wait(`document.querySelector('#md-create-menu:not([hidden]) [data-template-id]')`);
};
const geometry = () => evaluate(`(()=>{
  const menu=document.querySelector('.md-quick-actions'),r=menu.getBoundingClientRect(),c=mdEditor.coordsAtPos(mdEditor.getSelection().from),v=visualViewport;
  return {visible:!menu.hidden&&getComputedStyle(menu).visibility==='visible',x:r.left,y:r.top,width:r.width,height:r.height,
    caretTop:c.top,caretBottom:c.bottom,left:v.offsetLeft,top:v.offsetTop,right:v.offsetLeft+v.width,bottom:v.offsetTop+v.height};
})()`);
const assertAnchored = g => {
  assert.ok(g.visible, JSON.stringify(g));
  assert.ok(g.x>=g.left && g.x+g.width<=g.right+1,JSON.stringify(g));
  assert.ok(g.y>=g.top && g.y+g.height<=g.bottom+1,JSON.stringify(g));
  assert.ok(Math.min(Math.abs(g.y+g.height-g.caretTop),Math.abs(g.y-g.caretBottom))<=9,JSON.stringify(g));
};
try {
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  await browser.start();
  await browser.send('Page.navigate',{url:`http://127.0.0.1:${app.server.address().port}`});
  await wait('window.mdDrafts && window.mdEditor');
  const origin=await evaluate('performance.timeOrigin');
  await evaluate(`mdEditor.setValue('# 保留此文档'); mdDrafts.schedule()`);
  assert.equal(await evaluate(`(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented})()`),true,'unsaved edits retain leaving protection');
  const original=await evaluate(`mdDrafts.flush().then(()=>mdDrafts.current())`);
  await evaluate(`mdDrafts.schedule()`);
  assert.equal(await evaluate(`(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented})()`),false,'unchanged draft must not mark pending');
  await clickCreate();
  assert.deepEqual(await evaluate(`[...document.querySelector('#md-create-menu').children].map(n=>n.textContent)`),['通用文档','学术论文','国家标准','技能文档','从模板库选择…']);
  assert.ok(await evaluate(`(()=>{const menu=document.querySelector('#md-create-menu'),a=menu.querySelector('a'),b=menu.querySelector('button'),r=menu.getBoundingClientRect();return r.width>=128&&r.width<200&&getComputedStyle(a).fontSize===getComputedStyle(b).fontSize&&getComputedStyle(a).color===getComputedStyle(b).color})()`));
  await evaluate(`document.querySelector('#browse-examples').click()`);
  await wait(`document.querySelector('[data-view="templates"]').hidden===false`);
  assert.equal(await evaluate('performance.timeOrigin'),origin,'template navigation stays in the same page');
  assert.equal(await evaluate(`mdDrafts.current()`),original);
  await wait(`document.querySelector('[data-create-template]')`);
  assert.equal(await evaluate(`document.querySelector('[data-create-template]').getAttribute('aria-label')`),'从该模板创建');
  await evaluate(`document.querySelector('#examples-link-top').click()`);
  await wait(`document.querySelector('[data-view="editor"]').hidden===false`);
  await evaluate(`document.querySelector('button[aria-label="创建空文件"]').click()`);
  await wait(`mdEditor.getValue()==='' && mdDrafts.current()===null`);
  assert.equal(await evaluate(`mdDrafts.store.get(${JSON.stringify(original)}).then(d=>d.md)`),'# 保留此文档');
  await clickCreate();
  await evaluate(`document.querySelector('[data-template-id="paper"]').click()`);
  await wait(`JSON.parse(sessionStorage.getItem('md2pdf:draft') || '{}').templateId==='paper' && mdEditor.getValue().trim()!==''`);
  assert.equal(await evaluate(`document.querySelector('[data-view="editor"]').hidden`),false);
  assert.equal(await evaluate('performance.timeOrigin'),origin);
  assert.equal(await evaluate(`mdDrafts.store.get(${JSON.stringify(original)}).then(d=>d.md)`),'# 保留此文档');
  // Footer layout preserves the gutter switch and aligns count/status on one row.
  assert.ok(await evaluate(`(()=>{const footer=document.querySelector('.editor-footer'),count=document.querySelector('#count'),status=document.querySelector('#draft-save-status');return footer.contains(count)&&footer.contains(status)&&!footer.querySelector('math')&&count.getBoundingClientRect().left<footer.getBoundingClientRect().left+90&&count.getBoundingClientRect().left<status.getBoundingClientRect().left&&Math.abs((count.getBoundingClientRect().top+count.getBoundingClientRect().bottom-status.getBoundingClientRect().top-status.getBoundingClientRect().bottom)/2)<2})()`));
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.md-wt-zoom input')].map(n=>[n.min,n.max])`),[['20','200'],['20','200']]);
  await evaluate(`(()=>{const slider=document.querySelector('.md-wt-zoom input');slider.value='200';slider.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.cm-content')).fontSize`),'26px');
  await evaluate(`(()=>{const slider=document.querySelector('.md-wt-zoom input');slider.value='100';slider.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  // Cursor popup follows actual page/editor scrolls, resizing and visual viewport panning.
  await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate(`mdEditor.setValue(${JSON.stringify('/b\n\n'+Array.from({length:80},(_,i)=>'正文 '+i).join('\n'))});mdEditor.setSelection(2);mdEditor.focus()`);
  await wait(`document.querySelector('.md-quick-actions')?.style.visibility==='visible'`);
  assertAnchored(await geometry());
  await evaluate(`scrollTo(0,70)`);
  await evaluate(`new Promise(r=>setTimeout(r,160))`);
  assertAnchored(await geometry());
  await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:520,deviceScaleFactor:1,mobile:true});
  await evaluate(`new Promise(r=>setTimeout(r,160))`);
  assertAnchored(await geometry());
  await evaluate(`document.querySelector('.cm-scroller').scrollTop=600`);
  await wait(`document.querySelector('.md-quick-actions').style.visibility==='hidden'`);
  await evaluate(`document.querySelector('.cm-scroller').scrollTop=0`);
  await wait(`document.querySelector('.md-quick-actions').style.visibility==='visible'`);
  assertAnchored(await geometry());
  // Simulated visual viewport offsets exercise the same layout-coordinate boundary calculation.
  await browser.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.5});
  await evaluate(`new Promise(r=>setTimeout(r,160))`);
  const scaled=await geometry();
  if(scaled.caretTop>=scaled.top && scaled.caretBottom<=scaled.bottom) assertAnchored(scaled);
  await browser.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1200,height:800,deviceScaleFactor:1,mobile:false});
  await evaluate(`scrollTo(0,0);mdEditor.setSelection(2)`);
  await wait(`document.querySelector('.md-quick-actions').style.visibility==='visible'`);
  assertAnchored(await geometry());
  await evaluate(`document.querySelector('.md-quick-actions [data-action="footnote"]').click()`);
  assert.equal(await evaluate(`mdEditor.getValue().startsWith('/b')`),false,'popup action still consumes its trigger');
  console.log('Workspace actions: leave protection, template/blank creation, draft preservation, footer, zoom, and caret popup scroll/viewport positioning passed');
} finally {
  await browser.stop();
  await app.close();
  await rm(temp,{recursive:true,force:true});
}
