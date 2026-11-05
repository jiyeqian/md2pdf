import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';

const app = process.argv[2] ? null : createApp();
const temp = await mkdtemp('/private/tmp/md2pdf-content-sync-');
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
      browser.pending.set(id, { resolve: result => { clearTimeout(timer); result.error ? reject(new Error(result.error.message)) : resolve(result.result); }, reject });
      browser.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  };
  const evaluate = async (expression, sessionId) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression, sessionId) => {
    for (let n = 0; n < 300; n++) {
      if (await evaluate('Boolean(' + expression + ')', sessionId)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('timeout: ' + expression);
  };
  const frame = async () => {
    for (const target of (await browser.send('Target.getTargets')).targetInfos.filter(target => target.type === 'iframe')) {
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      if (await evaluate('typeof window.__md2pdfPreviewSnapshot === "function"', sessionId)) return sessionId;
      await browser.send('Target.detachFromTarget', { sessionId });
    }
    throw new Error('preview frame missing');
  };
  const label = '目标章节：窄屏、大纲侧栏与工具栏换行定位验证';
  const paragraph = '这是用于验证视口变化之后位置映射的普通段落。'.repeat(12);
  const md = '---\ntoc: false\n---\n# 窄屏定位\n\n'+Array.from({length:6},(_,i)=>'## '+(i===2?label:'章节 '+i)+'\n\n'+Array(6).fill(paragraph).join('\n\n')).join('\n\n');
  const offset = md.indexOf('## '+label);
  const header = `(()=>{const node=[...document.querySelectorAll((document.documentElement.classList.contains('md2pdf-preview-flow')?'#md2pdf-preview-flow':'.pagedjs_pages')+' h2')].find(n=>n.textContent.includes(${JSON.stringify(label)}));return node?.getBoundingClientRect().top;})()`;
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.navigate',{url});
  await wait('window.mdEditor && window.mdPreviewController');
  await evaluate('mdEditor.setValue('+JSON.stringify(md)+')');
  await wait('mdPreviewController.state().ready');
  const session = await frame();
  for(const width of [390,760,1440]) {
    await browser.send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});
    await new Promise(resolve=>setTimeout(resolve,250));
    for(const flow of [false,true]) {
      await evaluate(`mdWorkspaceHosts.postPreview({type:'md2pdf-preview-mode',revision:mdPreviewController.state().previewRevision,mode:${JSON.stringify(flow?'flow':'paged')}})`);
      await wait(`document.documentElement.classList.contains('md2pdf-preview-flow')===${flow}`,session);
      for(const origin of ['editor','preview']) {
        await evaluate(`(()=>{for(const id of ['editor-assistant','preview-outline']){if(document.querySelector('#'+id).hidden)document.querySelector('#'+id+'-toggle').click();}})()`);
        await new Promise(resolve=>setTimeout(resolve,200));
        await evaluate(`(()=>{const rows=[...document.querySelectorAll(${JSON.stringify(origin==='editor'?'.md-pro-outline-item':'.md-preview-outline button[data-outline-index]')})];rows.find(n=>n.textContent.includes(${JSON.stringify(label)})).click();})()`);
        await new Promise(resolve=>setTimeout(resolve,250));
        console.log('window',width,flow,origin,await evaluate(header,session));
        await evaluate(`document.querySelector('.preview-panel [data-panel-fullscreen]').click()`);
        await wait(`document.querySelector('.workspace').classList.contains('preview-focus')`);
        await new Promise(resolve=>setTimeout(resolve,300));
        let top=await evaluate(header,session);
        console.log('preview fullscreen',width,flow,origin,top);
        assert.ok(Math.abs(top)<8,JSON.stringify({width,flow,origin,top,stage:'preview fullscreen'}));
        for(let change=0;change<2;change++) {
          await evaluate(`document.querySelector('#preview-outline-toggle').click()`);
          await new Promise(resolve=>setTimeout(resolve,300));
          top=await evaluate(header,session);
          assert.ok(Math.abs(top)<8,JSON.stringify({width,flow,origin,top,stage:'sidebar width change'}));
        }
        await evaluate(`document.querySelector('.preview-panel .md-panel-mode').click()`);
        await wait(`document.querySelector('.workspace').classList.contains('editor-focus')`);
        await new Promise(resolve=>setTimeout(resolve,300));
        const delta=await evaluate(`(()=>{const r=mdEditor.coordsAtPos(${offset}),b=document.querySelector('.cm-scroller').getBoundingClientRect();return r.top-b.top;})()`);
        assert.ok(Math.abs(delta)<8,JSON.stringify({width,flow,origin,delta,stage:'editor fullscreen'}));
        await evaluate(`document.querySelector('.editor-panel .md-panel-mode').click()`);
        await wait(`document.querySelector('.workspace').classList.contains('preview-focus')`);
        await new Promise(resolve=>setTimeout(resolve,300));
        top=await evaluate(header,session);
        assert.ok(Math.abs(top)<8,JSON.stringify({width,flow,origin,top,stage:'M/P return'}));
        await evaluate(`document.querySelector('.preview-panel [data-panel-fullscreen]').click()`);
        await new Promise(resolve=>setTimeout(resolve,250));
      }
    }
  }
  console.log('PASS: outline viewport matrix');
} finally {
  await browser.stop();
  if(app) await app.close();
  await rm(temp,{recursive:true,force:true});
}
