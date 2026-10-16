import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';

const app = createApp({ lanHost:'' });
const temp = await mkdtemp('/tmp/md-app-shell-');
const browser = new Chrome(findChrome(), temp);
const evaluate = async expression => {
  const result = await browser.send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const wait = async expression => {
  for (let i=0;i<240;i++) {
    try { if (await evaluate(`Boolean(${expression})`)) return; }
    catch (error) { if (!/context|navigated|Cannot find/.test(error.message)) throw error; }
    await new Promise(resolve => setTimeout(resolve,50));
  }
  throw new Error('Timeout: '+expression);
};
const layout = () => evaluate(`['.topbar','main','.workspace','.editor-panel','.preview-panel','.editor-footer'].map(selector=>{
  const r=document.querySelector(selector).getBoundingClientRect();return [r.x,r.y,r.width,r.height];
})`);
try {
  await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  await browser.start();
  await browser.send('Network.enable');
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1200,height:800,deviceScaleFactor:1,mobile:false});
  // Blocking only the new shell provides a same-build desktop baseline.
  await browser.send('Network.setBlockedURLs',{urls:['*app-shell.js','*app-shell.css']});
  await browser.send('Page.navigate',{url});
  await wait('window.mdDrafts && window.mdEditor');
  const baseline = await layout();
  await browser.send('Network.setBlockedURLs',{urls:[]});
  await evaluate('window.mdDrafts=null');
  await browser.send('Page.reload');
  await wait('window.mdDrafts && window.mdAppShell');
  assert.equal(await evaluate('mdAppShell.standalone()'),false);
  assert.deepEqual(await layout(),baseline,'ordinary desktop geometry must remain identical');
  assert.equal(await evaluate(`mdAppShell.offerFile(new File(['test'],'test.md',{type:'text/markdown'}))`),false);
  assert.equal(await evaluate(`!!document.querySelector('meta[name="viewport"]').content.includes('viewport-fit')`),false);
  await evaluate(`(async()=>{mdEditor.setValue('# 主屏恢复验收');await mdDrafts.flush()})()`);
  const id = await evaluate('mdDrafts.current()');
  // Simulate iOS standalone detection and share support before startup.
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`
    Object.defineProperty(navigator,'standalone',{get:()=>true});
    Object.defineProperty(navigator,'canShare',{value:({files})=>files.length===1});
    Object.defineProperty(navigator,'share',{value:async({files})=>{window.sharedName=files[0].name}});
  `});
  await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate('window.mdDrafts=null');
  await browser.send('Page.reload');
  await wait('window.mdDrafts && window.mdAppShell?.standalone()');
  assert.equal(await evaluate(`document.documentElement.classList.contains('app-standalone')`),true);
  assert.equal(await evaluate('mdDrafts.current()'),id);
  assert.equal(await evaluate('mdEditor.getValue()'),'# 主屏恢复验收');
  assert.match(await evaluate(`document.querySelector('meta[name="viewport"]').content`),/viewport-fit=cover/);
  await evaluate(`document.querySelector('.editor-panel [data-panel-fullscreen]').click()`);
  await wait(`document.querySelector('.workspace').classList.contains('editor-focus')`);
  const before = await evaluate(`document.querySelector('.workspace').getBoundingClientRect().height`);
  await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:520,deviceScaleFactor:1,mobile:true});
  await wait(`parseFloat(document.documentElement.style.getPropertyValue('--app-view-height'))===visualViewport.height`);
  assert.ok(await evaluate(`document.querySelector('.workspace').getBoundingClientRect().height`)<before);
  await evaluate(`document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('pageshow'))`);
  assert.equal(await evaluate('mdEditor.getValue()'),'# 主屏恢复验收');
  await evaluate(`document.querySelector('.editor-panel [data-panel-fullscreen]').click()`);
  // Markdown uses the same export content, offering a fresh user gesture for sharing.
  await evaluate(`document.querySelector('button[aria-label="下载 Markdown"]').click()`);
  await wait(`document.querySelector('dialog[aria-label="保存或分享文件"][open]')`);
  assert.match(await evaluate(`document.querySelector('dialog .app-file-name').textContent`),/^主屏恢复验收_.*\.md$/);
  assert.equal(await evaluate(`!!document.querySelector('dialog a[download]')`),true);
  await evaluate(`document.querySelector('dialog .primary').click()`);
  await wait('window.sharedName');
  assert.match(await evaluate('sharedName'),/\.md$/);
  // Server-rendered PDF is also offered through the same explicit share/download dialog.
  await wait(`!document.querySelector('#download').disabled`);
  await evaluate(`document.querySelector('#download').click()`);
  await wait(`document.querySelector('dialog[aria-label="保存或分享文件"][open]')`);
  assert.match(await evaluate(`document.querySelector('dialog .app-file-name').textContent`),/\.pdf$/);
  await evaluate(`document.querySelector('dialog .template-confirm-cancel').click()`);
  await browser.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await wait(`document.querySelector('#app-network-status')?.hidden===false`);
  await evaluate(`(async()=>{mdEditor.setValue('# 暂时断网也保存');await mdDrafts.flush()})()`);
  assert.equal(await evaluate(`mdDrafts.store.get(mdDrafts.current()).then(d=>d.md)`),'# 暂时断网也保存');
  await browser.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await wait(`document.querySelector('#app-network-status').hidden===true`);
  // LAN HTTP lacks randomUUID: the fallback must still create durable documents.
  await evaluate(`Object.defineProperty(crypto,'randomUUID',{value:undefined});`);
  await evaluate(`mdDrafts.openFile('# HTTP兼容','http.md')`);
  assert.match(await evaluate('mdDrafts.current()'),/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  console.log('App shell: unchanged desktop geometry, standalone restore, viewport/foreground recovery, Markdown/PDF file offers, offline editing and HTTP-compatible draft IDs passed');
} finally {
  await browser.stop();
  await app.close();
  await rm(temp,{recursive:true,force:true});
}
