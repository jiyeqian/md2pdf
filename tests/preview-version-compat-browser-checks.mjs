import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';

// The real pre-visibility parent represents an already-open, SW-pinned client.
// Its GET code stays old while POST /api/render uses the current server.
const oldApp = execFileSync('git', ['show', 'ad3f803:web/app.js'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
assert.equal(oldApp.includes('md2pdf-visibility'), false);
const app = createApp();
let serveOldApp = true;
let appScriptRequests = 0;
const original = app.server.listeners('request')[0];
app.server.removeListener('request', original);
app.server.on('request', (request, response) => {
  if (request.url === '/app.js' && serveOldApp) {
    appScriptRequests++;
    response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    response.end(oldApp);
  } else {
    if (request.url === '/app.js') appScriptRequests++;
    if (request.url === '/service-worker.js' && serveOldApp) {
      const end = response.end.bind(response);
      response.end = (body, ...args) => {
        const hash = createHash('sha256').update(oldApp).digest('hex');
        const script = String(body)
          .replace(/const APP_VERSION="[^"]+";/, `const APP_VERSION="compat-${hash.slice(0,20)}";`)
          .replace(/\{"url":"\/app.js","hash":"[^"]+"\}/, JSON.stringify({url:'/app.js',hash}));
        return end(script, ...args);
      };
    }
    original(request, response);
  }
});
const dir = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-version-compat-'));
const browser = new Chrome(findChrome(), dir);
try {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  await browser.start();
  await browser.send('Emulation.setDeviceMetricsOverride', { width:1440, height:1000, deviceScaleFactor:1, mobile:false });
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `if(top===window){window.compatDocumentToken=crypto.randomUUID();window.compatEvents=[];for(const name of ['md-preview-ready','md-preview-error'])addEventListener(name,()=>compatEvents.push(name));}` });
  await browser.send('Page.navigate', { url:`http://127.0.0.1:${app.server.address().port}/` });
  const evaluate = async expression => {
    const result = await browser.send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  for (let n=0;n<100;n++) {
    if (await evaluate('Boolean(window.__MD2PDF_APP_READY__)')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const md = '# Mixed parent and backend\n\n$x^2$\n\n```mermaid\ngraph LR\nA-->B\n```';
  await evaluate(`compatEvents.length=0;mdEditor.setValue(${JSON.stringify(md)});document.querySelector('#markdown').dispatchEvent(new Event('input',{bubbles:true}))`);
  for (let n=0;n<100;n++) {
    if (await evaluate('compatEvents.length>0')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const result = await evaluate(`({events:compatEvents,status:document.querySelector('#status').textContent,legacyParent:!document.querySelector('#preview').srcdoc.includes('MD2PDF_PREVIEW_REVISION = 1;')})`);
  assert.ok(result.events.includes('md-preview-ready'), JSON.stringify(result));
  assert.ok(!result.events.includes('md-preview-error'), JSON.stringify(result));
  for (let n=0;n<100;n++) {
    if (await evaluate('Boolean(navigator.serviceWorker.controller)')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(await evaluate('Boolean(navigator.serviceWorker.controller)'), true, 'old parent is controlled by its warm service-worker cache');
  serveOldApp = false;
  const beforeReload = appScriptRequests;
  const previousDocument = await evaluate('compatDocumentToken');
  await browser.send('Page.reload');
  for (let n=0;n<100;n++) {
    if (await evaluate(`window.compatDocumentToken !== ${JSON.stringify(previousDocument)} && Boolean(window.__MD2PDF_APP_READY__) && compatEvents.includes("md-preview-ready")`)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const currentDocument = await evaluate('compatDocumentToken');
  assert.notEqual(currentDocument, previousDocument, 'warm-cache assertions belong to the new document after reload');
  assert.equal(appScriptRequests, beforeReload, 'reload obtains the historical app.js from warm SW cache, not the new server');
  const warm = await evaluate(`({events:compatEvents,status:document.querySelector('#status').textContent,unmanaged:document.querySelector('#preview').srcdoc.includes('MD2PDF_PREVIEW_MANAGED = false;')})`);
  assert.ok(warm.events.includes('md-preview-ready'), JSON.stringify(warm));
  assert.equal(warm.unmanaged, true, 'cached historical parent did not opt into managed visibility');
  console.log('PASS historical ad3f803 parent + current Node API, including warm SW reload:', JSON.stringify({initial:result,warm,appScriptRequests,previousDocument,currentDocument}));
} finally {
  await browser.stop();
  await app.close();
  await rm(dir, { recursive:true, force:true });
}
