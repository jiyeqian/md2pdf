import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  const label='目标章：横竖窗口交换验收';
  const fixture='# 双窗口\n\n'+Array.from({length:6},(_,i)=>'## '+(i===2?label:'章节 '+i)+'\n\n'+Array(7).fill('长段落用于验证横竖屏自动换行之后的定位。'.repeat(20)).join('\n\n')).join('\n\n');
  const offset=fixture.indexOf('## '+label);
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.navigate',{url});
  await wait('window.mdEditor && window.mdWindowMode');
  await evaluate(`window.frameProbes=[];window.addEventListener('message',event=>{if(event.data?.type==='md2pdf-test-frame-probe' && (event.source===mdWorkspaceHosts.query('#preview')?.contentWindow || [...document.querySelectorAll('.md-preview-thumbnails iframe')].some(frame=>frame.contentWindow===event.source)))frameProbes.push(event.data.probe)})`);
  await evaluate('mdEditor.setValue('+JSON.stringify(fixture)+')');await ready();
  await evaluate(`window.layoutTasks=0;new MutationObserver(()=>{if(new DOMParser().parseFromString(mdWorkspaceHosts.query('#preview').srcdoc,'text/html').querySelector('script[src]'))layoutTasks++}).observe(document.querySelector('#preview'),{attributes:true,attributeFilter:['srcdoc']})`);
  await evaluate(`document.querySelector('.preview-panel [data-panel-independent]').click()`);await idle();await ready();await wait('!mdWindowMode.restoring');
  const popup=await targetSession('page');
  await send('Emulation.setDeviceMetricsOverride',{width:650,height:1200,deviceScaleFactor:1,mobile:false},popup.sessionId);
  await new Promise(r=>setTimeout(r,300));
  let frame=await targetSession('iframe');
  for(const flow of [false,true]) {
    await evaluate(`mdWorkspaceHosts.postPreview({type:'md2pdf-preview-mode',revision:mdPreviewController.state().previewRevision,mode:${JSON.stringify(flow?'flow':'paged')}})`);
    await new Promise(r=>setTimeout(r,250));
    const heading=`(()=>{const h=[...document.querySelectorAll(${JSON.stringify(flow?'#md2pdf-preview-flow h2':'.pagedjs_pages h2')})].find(n=>n.textContent.includes(${JSON.stringify(label)}));return h.getBoundingClientRect().top;})()`;
    for(const origin of ['preview','editor']) {
      const owner=origin==='preview'?popup.sessionId:undefined;
      const sidebar=origin==='preview'?'preview-outline':'editor-assistant';
      const selector=origin==='preview'?'.md-preview-outline button':'.md-pro-outline-item';
      await evaluate(`(()=>{if(document.querySelector('#${sidebar}').hidden)document.querySelector('#${sidebar}-toggle').click()})()`,owner);
      await wait(`document.querySelectorAll(${JSON.stringify(selector)}).length`,owner);
      await evaluate(`(()=>{[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.textContent.includes(${JSON.stringify(label)})).click()})()`,owner);
      await new Promise(r=>setTimeout(r,300));
      for(let n=0;n<6;n++) {
        await evaluate('mdWindowMode.swap()');await idle();await ready();await wait('!mdWindowMode.restoring');
        await new Promise(r=>setTimeout(r,350));frame=await targetSession('iframe');
        assert.notEqual(await evaluate("mdWorkspaceHosts.query('#preview').style.opacity"),'0','preview revealed after position acknowledgement');
        const top=await evaluate(heading,frame.sessionId);
        const delta=await evaluate(`(()=>{const rect=mdEditor.coordsAtPos(${offset}),box=mdEditor.getDocumentRoot().querySelector('.cm-scroller').getBoundingClientRect();return rect&&rect.top-box.top;})()`);
        console.log('swap',{flow,origin,n,top,delta});
        assert.ok(Math.abs(top)<8,'preview heading: '+JSON.stringify({flow,origin,n,top}));
        assert.ok(delta!==null&&Math.abs(delta)<8,'editor heading: '+JSON.stringify({flow,origin,n,delta}));
        assert.equal(await evaluate('layoutTasks'),0,'completed preview is not repaginated');
      }
    }
  }
  console.log('PASS: unequal portrait/landscape independent windows');
} finally { await browser.stop(); if(app) await app.close(); await rm(temp,{recursive:true,force:true}); }
