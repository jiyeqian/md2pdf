import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  const md = '---\ntoc: false\n---\n# 格式测试\n\n' + Array.from({ length: 40 }, (_, i) => '段落' + i + ' ' + '内容'.repeat(70)).join('\n\n') + '\n\n重复文字\n\n重复文字\n\n跨段选择';
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.navigate', { url });
  await wait('window.mdEditor && document.querySelector("#md-wt-sync")');
  await evaluate('mdEditor.setValue(' + JSON.stringify(md) + ')');
  try { await wait('window.__MD2PDF_PREVIEW_READY__ && document.querySelector("#preview").srcdoc.includes("重复文字")'); } catch (error) { console.error(await evaluate('({status:document.querySelector("#status").textContent,value:mdEditor.getValue(),src:document.querySelector("#preview").srcdoc.length,ready:window.__MD2PDF_PREVIEW_READY__,error:window.__MD2PDF_PREVIEW_ERROR__})')); throw error; }
  await evaluate('document.querySelector("#md-wt-sync").checked=false');
  let session = await frame();
  const beforeTop = await evaluate(`(()=>{const nodes=[...document.querySelectorAll('.pagedjs_pages p[data-md2pdf-source-id]')].filter(n=>n.textContent==='重复文字');nodes[1].scrollIntoView({block:'center',behavior:'instant'});return nodes[1].getBoundingClientRect().top;})()`, session);
  const select = async (second) => evaluate(`(()=>{const nodes=[...document.querySelectorAll('.pagedjs_pages p[data-md2pdf-source-id]')].filter(n=>n.textContent==='重复文字');const node=nodes[${second}].firstChild;const r=document.createRange();r.setStart(node,0);r.setEnd(node,node.length);getSelection().removeAllRanges();getSelection().addRange(r);nodes[${second}].dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:20,clientY:20}));})()`, session);
  await select(1);
  await wait('document.querySelector(".md-preview-format-menu button:not(:disabled)")');
  await browser.send('Page.captureScreenshot',{format:'png'}).then(result=>writeFile('/private/tmp/md2pdf-format-before.png',Buffer.from(result.data,'base64')));
  await evaluate(`const original=mdEditor.replaceRange;mdEditor.replaceRange=function(...args){mdEditor.replaceRange=original;setTimeout(()=>original.apply(mdEditor,args),600)};window.__coverAtReplacement=null;new MutationObserver(()=>{const cover=document.querySelector('[data-md2pdf-format-cover]');window.__coverAtReplacement=!!cover&&getComputedStyle(cover).opacity==='1';}).observe(document.querySelector('#preview'),{attributes:true,attributeFilter:['srcdoc']});document.querySelector('.md-preview-format-menu button').click()`);
  await wait('document.querySelector("[data-md2pdf-format-cover]") && getComputedStyle(document.querySelector("[data-md2pdf-format-cover]")).opacity==="1"');
  await browser.send('Page.captureScreenshot',{format:'png'}).then(result=>writeFile('/private/tmp/md2pdf-format-cover.png',Buffer.from(result.data,'base64')));
  await wait('mdEditor.getValue().includes("**重复文字**")');
  assert.equal(await evaluate('mdEditor.getValue()'), md.replace('重复文字\n\n跨段', '**重复文字**\n\n跨段'));
  await wait('window.__MD2PDF_PREVIEW_READY__');
  session = await frame();
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(await evaluate('getSelection().toString()', session), '重复文字', 'formatted selection is restored');
  assert.equal(await evaluate('window.__coverAtReplacement'), true, 'visible snapshot covers the preview when srcdoc is replaced');
  await wait('!document.querySelector("[data-md2pdf-format-cover]")');
  await browser.send('Page.captureScreenshot',{format:'png'}).then(result=>writeFile('/private/tmp/md2pdf-format-after.png',Buffer.from(result.data,'base64')));
  const afterTop = await evaluate(`(()=>{const nodes=[...document.querySelectorAll('.pagedjs_pages p[data-md2pdf-source-id]')].filter(n=>n.textContent==='重复文字');return nodes[1].getBoundingClientRect().top;})()`, session);
  assert.ok(Math.abs(afterTop - beforeTop) < 25, 'formatting restores the preview scroll anchor: ' + JSON.stringify({beforeTop,afterTop}));
  await evaluate('mdEditor.runCommand("undo")');
  assert.equal(await evaluate('mdEditor.getValue()'), md, 'formatting is one undo transaction');
  await wait('window.__MD2PDF_PREVIEW_READY__');
  session = await frame();
  await evaluate(`(()=>{const nodes=[...document.querySelectorAll('.pagedjs_pages p[data-md2pdf-source-id]')].filter(n=>n.textContent==='重复文字');const r=document.createRange();r.setStart(nodes[0].firstChild,0);r.setEnd(nodes[1].firstChild,2);getSelection().removeAllRanges();getSelection().addRange(r);nodes[1].dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:20,clientY:20}));})()`, session);
  await wait('document.querySelector(".md-preview-format-menu")');
  assert.equal(await evaluate('document.querySelectorAll(".md-preview-format-menu button:disabled").length'), 3, 'cross-paragraph selection cannot authorize writes');
  await evaluate('document.querySelector(".md-preview-format-menu").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  assert.equal(await evaluate('!!document.querySelector(".md-preview-format-menu")'), false);
  const fixtures = [
    ['bold', 'abc', '**abc**', 0], ['italic', 'abc', '*abc*', 1], ['strike', 'abc', '~~abc~~', 2],
    ['nested', '**abc**', '**_abc_**', 1],
  ];
  for (const [label, source, expected, button] of fixtures) {
    await evaluate('mdEditor.setValue(' + JSON.stringify(source) + ')');
    await wait('window.__MD2PDF_PREVIEW_READY__ && document.querySelector("#preview").srcdoc.includes("abc")');
    session = await frame();
    const open = async () => {
      await evaluate(`(()=>{const p=document.querySelector('.pagedjs_pages p[data-md2pdf-format-source-id]');const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let n;while((n=walker.nextNode())&&!n.data.includes('abc')){}const i=n.data.indexOf('abc'),r=document.createRange();r.setStart(n,i);r.setEnd(n,i+3);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:innerWidth-2,clientY:innerHeight-2}));})()`, session);
      await wait('document.querySelector(".md-preview-format-menu")');
      assert.equal(await evaluate('(()=>{const r=document.querySelector(".md-preview-format-menu").getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight})()'), true, label + ' menu remains in viewport');
      assert.equal(await evaluate('document.querySelectorAll(".md-preview-format-menu button")[' + button + '].disabled'), false, label + ' enabled');
      await evaluate('document.querySelectorAll(".md-preview-format-menu button")[' + button + '].click()');
    };
    await open();
    await wait('mdEditor.getValue()===' + JSON.stringify(expected));
    await wait('window.__MD2PDF_PREVIEW_READY__');
    session = await frame();
    await wait('getSelection().toString()==="abc"', session);
    await open();
    await wait('mdEditor.getValue()===' + JSON.stringify(source));
    assert.equal(await evaluate('mdEditor.getValue()'), source, label + ' toggles off');
  }
  for (const [label, source, selector] of [
    ['table', '| abc | x |\n|---|---|\n| def | y |', '.pagedjs_pages td'],
    ['forged', '<p data-md2pdf-format-source-id="0">abc</p>\n\nordinary', '.pagedjs_pages p'],
  ]) {
    await evaluate('mdEditor.setValue(' + JSON.stringify(source) + ')');
    await wait('window.__MD2PDF_PREVIEW_READY__');
    session = await frame();
    await evaluate(`(()=>{const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.textContent.trim());const r=document.createRange();r.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(r);node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:30,clientY:30}));})()`, session);
    await wait('document.querySelector(".md-preview-format-menu")');
    assert.equal(await evaluate('document.querySelectorAll(".md-preview-format-menu button:disabled").length'), 3, label + ' is disabled');
    assert.equal(await evaluate('mdEditor.getValue()'), source);
  }
  await evaluate('mdEditor.setValue("abc")');
  await wait('window.__MD2PDF_PREVIEW_READY__');
  session = await frame();
  await evaluate(`(()=>{const p=document.querySelector('.pagedjs_pages p[data-md2pdf-format-source-id]');const r=document.createRange();r.setStart(p.firstChild,0);r.setEnd(p.firstChild,p.firstChild.length);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:30,clientY:30}));})()`, session);
  await wait('document.querySelector(".md-preview-format-menu button:not(:disabled)")');
  await evaluate(`window.__oldPostPreview=mdWorkspaceHosts.postPreview;mdWorkspaceHosts.postPreview=data=>data.type==='md2pdf-transfer-capture'?undefined:window.__oldPostPreview(data);document.querySelector('.md-preview-format-menu button').click()`);
  await wait('document.querySelector("#status").textContent.includes("请稍后重试")');
  assert.equal(await evaluate('mdEditor.getValue()'), 'abc', 'snapshot timeout leaves source unchanged');
  console.log('preview formatting browser checks passed');
} finally {
  await browser.stop();
  if (app) await app.close();
  await rm(temp, { recursive: true, force: true });
}
