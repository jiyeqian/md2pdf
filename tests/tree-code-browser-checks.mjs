import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  const md = '# 树形检查\n\n```text\nstation 变电站\n├── equipment 设备\n│   ├── component 组件\n│   └── functional_system 功能系统\n├── spatial_area 空间区域\n└── functional_unit 功能单元\n```\n\n```text\nordinary code\n  second line\n```';
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.navigate', { url });
  await wait('window.mdEditor && document.querySelector("#preview")');
  await evaluate('mdEditor.setValue(' + JSON.stringify(md) + ')');
  await wait('window.__MD2PDF_PREVIEW_READY__ && document.querySelector("#preview").srcdoc.includes("functional_unit")');
  await wait('document.querySelectorAll(".cm-line.md-tree-line").length >= 5');
  const editor = await evaluate(`(()=>{const line=document.querySelector('.cm-line.md-tree-line'), ordinary=[...document.querySelectorAll('.cm-line')].find(n=>n.textContent==='ordinary code');return {tree:getComputedStyle(line).lineHeight, treeSize:getComputedStyle(line).fontSize, treeFont:getComputedStyle(line).fontFamily, ordinary:getComputedStyle(ordinary).lineHeight, text:mdEditor.getValue()}})()`);
  assert.equal(editor.text, md);
  assert.ok(parseFloat(editor.tree) / parseFloat(editor.treeSize) <= 1.01, JSON.stringify(editor));
  assert.ok(parseFloat(editor.ordinary) > parseFloat(editor.tree), JSON.stringify(editor));
  const session = await frame();
  await wait('document.querySelector(".pagedjs_pages pre.md-tree-code code")', session);
  const preview = await evaluate(`(()=>{const code=document.querySelector('.pagedjs_pages pre.md-tree-code code'),pre=code.parentElement, ordinary=[...document.querySelectorAll('.pagedjs_pages pre')].find(n=>n.textContent.includes('ordinary code'));return {line:getComputedStyle(pre).lineHeight,font:getComputedStyle(code).fontFamily,size:getComputedStyle(pre).fontSize,ordinary:getComputedStyle(ordinary).lineHeight,text:code.textContent}})()`, session);
  assert.ok(parseFloat(preview.line) / parseFloat(preview.size) <= 1.01, JSON.stringify(preview));
  assert.ok(preview.text.includes('│   ├── component 组件'), JSON.stringify(preview));
  await browser.send('Page.captureScreenshot',{format:'png'}).then(result=>writeFile('/private/tmp/md2pdf-tree-browser.png',Buffer.from(result.data,'base64')));
  console.log('Tree browser checks passed', JSON.stringify({editor, preview}));
} finally {
  await browser.stop();
  if (app) await app.close();
  await rm(temp, { recursive: true, force: true });
}
