// Real Chromium checks for shared navigation, docked sidebars and control feedback.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';
const app = process.argv[2] ? null : createApp();
const temp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-controls-'));
const browser = new Chrome(findChrome(), temp);
try {
  if (app) await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = process.argv[2] || `http://127.0.0.1:${app.server.address().port}`;
  await browser.start();
  const evaluate = async expression => {
    const result = await browser.send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = expression => evaluate(`new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(${expression}){clearInterval(timer);resolve(true)}else if(++n>200){clearInterval(timer);reject(new Error(${JSON.stringify(expression)}))}},50)})`);
  const settle = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await browser.send('Emulation.setDeviceMetricsOverride', {width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.navigate', {url});
  await wait('window.mdEditor && document.querySelector("#editor-assistant-toggle")');
  await evaluate(`mdEditor.setValue(${JSON.stringify('# 标题\n\n## 子标题\n\n正文')}); document.querySelector('#editor-assistant-toggle').click(); document.querySelector('#preview-outline-toggle').click()`);
  await wait('document.querySelectorAll(".md-pro-outline-item").length === 2');
  await settle();
  const geometry = () => evaluate(`['.editor-panel','.preview-panel'].map(selector=>{const panel=document.querySelector(selector),dock=panel.querySelector('.md-panel-body'),main=dock.firstElementChild.getBoundingClientRect(),side=panel.querySelector('.md-panel-sidebar').getBoundingClientRect();return {mainWidth:main.width,mainRight:main.right,sideLeft:side.left,sideWidth:side.width,dockWidth:dock.clientWidth}})`);
  const open = await geometry();
  await evaluate(`scrollTo(0,0)`);
  const desktopShot = await browser.send('Page.captureScreenshot',{format:'png'});
  await writeFile(path.join(os.tmpdir(),'md2pdf-controls-desktop.png'),Buffer.from(desktopShot.data,'base64'));
  for (const row of open) {
    assert.ok(row.mainWidth > 100 && row.sideWidth > 150, JSON.stringify(row));
    assert.ok(Math.abs(row.mainRight-row.sideLeft)<1, 'sidebar occupies its own column: '+JSON.stringify(row));
  }
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#editor-assistant .md-pro-section-head h3'),e=>e.textContent)`),['文档大纲','引用与章节检查','文档类型']);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#editor-assistant details'),e=>e.open)`),[false,false]);
  await evaluate(`document.querySelector('.md-pro-outline-disclosure').click()`);
  assert.equal(await evaluate(`document.querySelector('.md-pro-outline-children').hidden`),true);
  await evaluate(`document.querySelector('.md-pro-outline-disclosure').click(); document.querySelector('.cm-content').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); document.querySelector('#preview').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.md-panel-sidebar')).every(e=>!e.hidden)`),true);
  await evaluate(`document.querySelector('.editor-panel [data-panel-fullscreen]').click()`);
  await settle();
  assert.equal(await evaluate(`document.querySelector('#editor-assistant').hidden`),false);
  await evaluate(`document.querySelector('.preview-panel .md-panel-mode').click()`);
  await settle();
  assert.equal(await evaluate(`document.querySelector('#preview-outline').hidden`),false);
  await evaluate(`document.querySelector('.preview-panel [data-panel-fullscreen]').click(); document.querySelector('.editor-panel .md-panel-mode').click()`);
  await settle();
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.md-panel-sidebar')).every(e=>!e.hidden)`),true);
  await evaluate(`document.querySelector('#editor-assistant-toggle').click()`);
  await settle();
  assert.ok((await geometry())[0].mainWidth > open[0].mainWidth + 100, 'closing sidebar restores writing width');
  await evaluate(`mdEditor.setValue(''); document.querySelector('#md-wt-basic-format').click(); document.querySelector('#md-wt-basic-menu [aria-label="任务列表"]').click()`);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#md-wt-basic-menu .md-wt-menu-row[aria-label=列表] button'),e=>e.getAttribute('aria-label'))`),['无序列表','有序列表','任务列表']);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#md-wt-basic-menu .md-wt-menu-row[aria-label=缩进] button'),e=>e.getAttribute('aria-label'))`),['左缩进','右缩进']);
  assert.equal(await evaluate('mdEditor.getValue()'),'- [ ] ');
  assert.deepEqual(await evaluate('mdEditor.getSelection()'),{from:6,to:6,text:''});
  await evaluate(`document.querySelector('.md-wt-toolbar [aria-label="查找与替换"]').click()`);
  await wait('document.querySelector(".cm-search input[type=checkbox]")');
  const feedback = await evaluate(`Array.from(document.querySelectorAll('.cm-search input,.cm-search button,.topbar-actions a, .md-wt-toolbar button, .preview-toolbar summary')).filter(e=>!e.disabled).map(e=>{e.focus();const style=getComputedStyle(e);return {label:e.getAttribute('aria-label')||e.name||e.textContent,outline:style.outlineStyle,shadow:style.boxShadow}})`);
  for (const row of feedback) assert.deepEqual([row.outline,row.shadow],['none','none'],JSON.stringify(row));
  await evaluate(`document.querySelector('#examples-link-top').click()`);
  await wait('document.querySelector("[data-view=editor]").hidden');
  assert.equal(await evaluate(`document.querySelector('#examples-link-top').getAttribute('aria-current')`),'page');
  assert.equal(await evaluate(`document.querySelector('#examples-link-top').dataset.viewLink`),'templates');
  assert.equal(await evaluate(`document.querySelectorAll('#examples-link-top svg').length`),1);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#examples-link-top svg')).display`),'block');
  await evaluate(`document.querySelector('#examples-link-top').click()`);
  await settle();
  assert.equal(await evaluate(`document.querySelector('[data-view=editor]').hidden`),true,'template icon keeps its destination');
  await evaluate(`document.querySelector('#editor-link-top').click()`);
  await wait('!document.querySelector("[data-view=editor]").hidden');
  for (const width of [1440,780,390]) {
    await browser.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await settle();
    const layout = await evaluate(`(()=>{const top=document.querySelector('.topbar'),brand=top.querySelector('.brand').getBoundingClientRect(),logo=top.querySelector('.brand-logo').getBoundingClientRect(),icon=top.querySelector('.brand-icon').getBoundingClientRect(),nav=top.querySelector('.topbar-actions').getBoundingClientRect(),tag=top.querySelector('.topbar-tagline'),text=tag.getBoundingClientRect(),style=getComputedStyle(tag);return {height:top.clientHeight,centerDelta:(logo.top+logo.bottom-icon.top-icon.bottom)/2,navRight:nav.right,brandRight:brand.right,navLeft:nav.left,tagVisible:style.display!=='none'&&style.visibility!=='hidden',textLeft:text.left,textRight:text.right,viewport:innerWidth}})()`);
    assert.ok(Math.abs(layout.centerDelta)<1,JSON.stringify(layout));
    assert.ok(layout.navRight<=width && layout.brandRight<layout.navLeft,JSON.stringify(layout));
    if(layout.tagVisible) assert.ok(layout.textLeft>=layout.brandRight+15 && layout.textRight<=layout.navLeft-15,JSON.stringify(layout));
    else if(width===1440) assert.fail('wide view must show tagline');
    if(width===390) assert.ok(!layout.tagVisible && layout.height<=84,JSON.stringify(layout));
  }
  const {data} = await browser.send('Page.captureScreenshot',{format:'png'});
  await writeFile(path.join(os.tmpdir(),'md2pdf-controls-mobile.png'),Buffer.from(data,'base64'));
  console.log('PASS: navigation, task insertion, docked sidebar geometry/persistence, focus feedback, 1440/780/390px layouts');
} finally {
  await browser.stop();
  if(app) await app.close();
  await rm(temp,{recursive:true,force:true});
}
