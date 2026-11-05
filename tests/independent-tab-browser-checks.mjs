import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';

const app = process.argv[2] ? null : createApp();
const temp = await mkdtemp('/private/tmp/md2pdf-independent-');
const browser = new Chrome(findChrome(), temp);
try {
  if (app) await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = process.argv[2] || 'http://127.0.0.1:' + app.server.address().port;
  await browser.start();
  const send = (method, params, sessionId) => {
    if (!sessionId) return browser.send(method, params);
    const id = ++browser.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(method + ' timed out')), 40000);
      browser.pending.set(id, { resolve: message => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolve(message.result); }, reject });
      browser.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  };
  const evaluate = async (expression, sessionId) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, sessionId);
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression, sessionId) => {
    for (let n = 0; n < 400; n++) {
      if (await evaluate('Boolean(' + expression + ')', sessionId)) return;
      await new Promise(resolve => setTimeout(resolve, 75));
    }
    const status = await evaluate('(window.mdWorkspaceHosts?.query("#status") || document.querySelector("#status"))?.textContent', sessionId).catch(() => 'closed');
    const mode = await evaluate('window.mdPreviewController?.state()', sessionId).catch(() => null);
    throw new Error('timeout: ' + expression + ' / ' + status + ' / ' + JSON.stringify(mode));
  };
  const targetSession = async type => {
    for (let attempt = 0; attempt < 60; attempt++) {
    const targets = (await browser.send('Target.getTargets')).targetInfos.filter(target => target.type === (type === 'thumbnail' ? 'iframe' : type));
    for (const target of targets) {
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      let match = await evaluate(type === 'page' ? '!!document.querySelector("#independent-workspace")' : type === 'thumbnail' ? '!!document.querySelector("#pages")' : 'typeof __md2pdfPreviewSnapshot === "function"', sessionId).catch(() => false);
      if (match && type !== 'page') {
        const probe = target.targetId + ':' + Date.now();
        await evaluate(`parent.postMessage({type:'md2pdf-test-frame-probe',probe:${JSON.stringify(probe)}},'*')`, sessionId);
        await new Promise(resolve => setTimeout(resolve, 50));
        match = await evaluate(`window.frameProbes.includes(${JSON.stringify(probe)})`);
      }
      if (match) return { sessionId, targetId: target.targetId };
      await browser.send('Target.detachFromTarget', { sessionId });
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(type + ' target missing');
  };
  const ready = () => wait('window.__MD2PDF_PREVIEW_READY__ && mdPreviewController.state().ready && mdWorkspaceHosts.query("#status").dataset.error!=="true"');
  const idle = () => wait('window.mdWindowMode.active && !mdWindowMode.busy');
  const normal = () => wait('!mdWindowMode.active && !mdWindowMode.popup && document.querySelector(".editor-panel") && document.querySelector(".preview-panel")');
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.navigate',{url});await wait('window.mdEditor && window.mdWindowMode');
  const rootTarget=(await browser.send('Target.getTargets')).targetInfos.find(target=>target.type==='page'&&target.url.startsWith(url));
  await evaluate(`window.frameProbes=[];window.addEventListener('message',event=>{if(event.data?.type==='md2pdf-test-frame-probe'&&event.source===mdWorkspaceHosts.query('#preview')?.contentWindow)frameProbes.push(event.data.probe)})`);
  const fixture='# 后台主标签页\n\n## 第一章\n\n'+('正文用于检查独立预览。\n\n'.repeat(80))+'## 目标章\n\nTARGET_CONTENT';
  await evaluate('mdEditor.setValue('+JSON.stringify(fixture)+')');await ready();
  // A normal tab rather than popup features reproduces the browser's actual
  // hidden-opener scheduling; do not fake visibility or resume its RAF queue.
  await evaluate(`window.realOpen=open;window.open=(url,name)=>realOpen(url,name);document.querySelector('.preview-panel [data-panel-independent]').click();window.open=realOpen`);
  await wait('mdWindowMode.active');await ready();
  const popup=await targetSession('page');
  await browser.send('Target.activateTarget',{targetId:popup.targetId});
  await wait(`document.visibilityState==='hidden'`);
  await wait('!mdWindowMode.restoring && !mdWindowMode.busy');
  const state=await evaluate(`({root:document.visibilityState,popup:mdWindowMode.popup.document.visibilityState,opacity:mdWorkspaceHosts.query('#preview').style.opacity,outline:mdWindowMode.popup.document.querySelectorAll('.md-preview-outline button').length})`);
  assert.equal(state.root,'hidden');assert.equal(state.popup,'visible');assert.notEqual(state.opacity,'0');assert.ok(state.outline>=2);
  const frame=await targetSession('iframe');
  assert.ok(await evaluate(`document.querySelectorAll('.pagedjs_page').length>0`,frame.sessionId));
  assert.ok(await evaluate(`document.body.textContent.includes('TARGET_CONTENT')`,frame.sessionId));
  await evaluate(`document.querySelector('#preview-outline-toggle').click()`,popup.sessionId);
  await evaluate('mdEditor.setValue('+JSON.stringify(fixture+'\n\nBACKGROUND_EDIT')+')');
  await ready();await wait('!mdWindowMode.restoring');
  assert.notEqual(await evaluate(`mdWorkspaceHosts.query('#preview').style.opacity`),'0');
  // Closing the preview tab returns the original editor and keeps its source.
  await browser.send('Target.closeTarget',{targetId:popup.targetId});
  await browser.send('Target.activateTarget',{targetId:rootTarget.targetId});
  await normal();await ready();await wait('!mdWindowMode.restoring');
  assert.ok(await evaluate(`mdEditor.getValue().includes('BACKGROUND_EDIT')`));
  assert.notEqual(await evaluate(`document.querySelector('#preview').style.opacity`),'0');
  console.log('PASS: real hidden opener tab, visible restored preview, background edit and close recovery');
} finally {await browser.stop();if(app)await app.close();await rm(temp,{recursive:true,force:true});}
