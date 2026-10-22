import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Chrome, findChrome } from '../src/chrome.mjs';
import { createApp } from '../src/server.mjs';
import { buildStatic } from '../src/static-build.mjs';

// HTTPS production origins are fulfilled locally by CDP: no event reaches a live collector.
const endpoint = 'https://metrics.example.com/events';
const previous = { enabled: process.env.MD2PDF_ANALYTICS_ENABLED, endpoint: process.env.MD2PDF_ANALYTICS_ENDPOINT };
process.env.MD2PDF_ANALYTICS_ENABLED = '1';
process.env.MD2PDF_ANALYTICS_ENDPOINT = endpoint;
const app = createApp({ publicHost: 'md2pdf.qianjiye.de' });
for (const [name, value] of [['MD2PDF_ANALYTICS_ENABLED', previous.enabled], ['MD2PDF_ANALYTICS_ENDPOINT', previous.endpoint]]) {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
}
const directory = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-analytics-browser-'));
const browser = new Chrome(findChrome(), directory);
const events = [], errors = [];
try {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${app.server.address().port}`;
  await browser.start();
  const evaluate = async expression => {
    const response = await browser.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  // Navigation can destroy the preceding document's evaluation context before commit.
  const wait = async expression => {
    for (let attempt=0; attempt<5; attempt++) {
      try { return await evaluate(`new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(${expression}){clearInterval(timer);resolve(true);}else if(++n>200){clearInterval(timer);reject(Error('browser wait timeout'));}},50);})`); }
      catch(error) { if(attempt===4 || !/Inspected target navigated or closed|Execution context was destroyed|Cannot find context/.test(error.message)) throw error; }
    }
  };
  browser.ws.addEventListener('message', async event => {
    const message = JSON.parse(event.data);
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    try {
      let status = 200, body, headers;
      if (request.url.startsWith('https://metrics.example.com/')) {
        if (request.method === 'POST') events.push({ url: request.url, body: JSON.parse(request.postData), headers: request.headers });
        status = 204; body = Buffer.alloc(0);
        headers = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: 'Content-Type' }, { name: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' }];
      } else {
        const url = new URL(request.url);
        const response = url.pathname === '/api/pdf'
          ? new Response('{"error":"synthetic failure"}', { status: 503, headers: { 'Content-Type': 'application/json' } })
          : await fetch(local + url.pathname + url.search, { method: request.method, headers: request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}, body: request.postData });
        status = response.status; body = Buffer.from(await response.arrayBuffer());
        headers = [...response.headers].filter(([key]) => !['content-length', 'transfer-encoding', 'connection'].includes(key)).map(([name, value]) => ({ name, value }));
      }
      await browser.send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: headers, body: body.toString('base64') });
    } catch (error) { errors.push(error.message); await browser.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {}); }
  });
  await browser.send('Fetch.enable', { patterns: [{ urlPattern: 'https://md2pdf.qianjiye.de/*' }, { urlPattern: 'https://metrics.example.com/*' }] });
  await browser.send('Page.navigate', { url: 'https://md2pdf.qianjiye.de/?utm_source=github' });
  await wait('window.mdEditor && window.md2pdfAnalytics && document.querySelector(".analytics-settings")');
  assert.equal(events.length, 0, 'no consent sends nothing');
  await evaluate('document.querySelector(".analytics-prompt [data-choice=none]").click()');
  assert.equal(events.length, 0);
  await evaluate('document.querySelector(".analytics-settings").click()');
  assert.equal(await evaluate('document.querySelector(".analytics-dialog").open'), true);
  await evaluate('document.querySelector(".analytics-dialog [data-choice=all]").click()');
  await wait('!document.querySelector(".analytics-dialog").open');
  await evaluate('window.md2pdfAnalytics.track("export_started",{method:"browser-print"})');
  await evaluate('new Promise(resolve=>setTimeout(resolve,150))');
  assert.equal(events.filter(entry => entry.body.event === 'page_view').length, 1);
  assert.equal(events.find(entry => entry.body.event === 'page_view').body.properties.campaign, 'github');
  const source = '# PRIVATE_DOCUMENT_TITLE\n\nPrivate body never leaves in analytics.';
  await evaluate(`window.mdEditor.setValue(${JSON.stringify(source)}); document.querySelector('#markdown').dispatchEvent(new Event('input',{bubbles:true})); const field=document.querySelector('#options').elements.type;field.value='paper';field.dispatchEvent(new Event('change',{bubbles:true}));`);
  await wait('document.querySelector("#preview").srcdoc.includes("PRIVATE_DOCUMENT_TITLE")');
  await wait('!document.querySelector("#download").disabled');
  await evaluate('document.querySelector("#download").click()');
  await wait('document.querySelector("#download").dataset.state === "idle"');
  await evaluate('new Promise(resolve=>setTimeout(resolve,150))');
  assert.ok(events.some(entry => entry.body.event === 'template_selected'));
  assert.ok(events.some(entry => entry.body.event === 'export_failed' && entry.body.properties.code === 'unavailable'));
  assert.ok(!JSON.stringify(events).includes('PRIVATE_DOCUMENT_TITLE'));
  assert.ok(events.every(entry => !Object.keys(entry.headers).some(key => /cookie|referer/i.test(key))));
  assert.match(events.find(entry => entry.body.event === 'page_view').body.visitorId, /^[0-9a-f-]{36}$/);
  assert.ok(events.filter(entry => entry.body.event !== 'page_view').every(entry => !entry.body.visitorId));
  await wait('!document.querySelector("#app-version").hidden');
  const footer = await evaluate(`(()=>{const nodes=['.analytics-settings','.privacy','#app-version'].map(s=>document.querySelector(s));return nodes.map(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);return {left:b.left,right:b.right,center:(b.left+b.right)/2,font:s.fontFamily,size:s.fontSize,color:s.color};});})()`);
  assert.equal(footer[0].font,footer[1].font);assert.equal(footer[1].font,footer[2].font);
  assert.equal(footer[0].size,footer[1].size);assert.equal(footer[1].size,footer[2].size);
  assert.equal(footer[0].color,footer[1].color);assert.equal(footer[1].color,footer[2].color);
  assert.ok(footer[0].left<footer[1].left && footer[1].right<footer[2].right);
  assert.ok(Math.abs(footer[1].center-(await evaluate('innerWidth'))/2)<2, 'notice geometrically centered');
  await evaluate('document.querySelector(".app-bottom").scrollIntoView({block:"end"})');
  await writeFile('/tmp/md2pdf-analytics-footer.png',Buffer.from((await browser.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate('window.md2pdfAnalytics.setConsent({basic:false,product:false})');
  await evaluate('new Promise(resolve=>setTimeout(resolve,150))');
  assert.ok(events.some(entry=>entry.url.endsWith('/forget')), 'withdrawal requests deletion');
  const count = events.length;
  await evaluate('window.md2pdfAnalytics.track("export_started",{method:"browser-print"})');
  await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
  assert.equal(events.length, count, 'withdrawal stops requests');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate('document.querySelector(".analytics-settings").click()');
  assert.equal(await evaluate('document.querySelector(".analytics-dialog").getBoundingClientRect().right <= innerWidth'), true);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".analytics-dialog input")).width'), '16px');
  const screenshot = await browser.send('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/md2pdf-analytics-mobile.png', Buffer.from(screenshot.data, 'base64'));
  process.env.MD2PDF_ANALYTICS_ENDPOINT=endpoint;
  const localApp = createApp();
  if(previous.endpoint===undefined)delete process.env.MD2PDF_ANALYTICS_ENDPOINT;else process.env.MD2PDF_ANALYTICS_ENDPOINT=previous.endpoint;
  try {
    await new Promise(resolve => localApp.server.listen(0, '127.0.0.1', resolve));
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${localApp.server.address().port}` });
    await wait('window.md2pdfAnalytics && document.querySelector(".analytics-settings")');
    await evaluate('window.md2pdfAnalytics.setConsent({basic:true,product:true});window.md2pdfAnalytics.track("export_started",{method:"server-pdf"})');
    await evaluate('new Promise(resolve=>setTimeout(resolve,150))');
    assert.ok(events.length>count, 'localhost sends only after consent');
    assert.ok(events.slice(count).some(entry=>entry.body.event==='page_view' && entry.body.site==='local'));
    assert.equal(app.operationalMetrics().counts.some(row=>row.route==='page'),true);
    assert.deepEqual(localApp.operationalMetrics().counts,[], 'local operations never upload automatically');
  } finally { await localApp.close(); }
  const offlineCount=events.length;
  const build = await buildStatic();
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  const staticServer = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (!pathname.startsWith('/md2pdf/')) throw new Error('not found');
      const file = path.resolve(build.directory, pathname.slice('/md2pdf/'.length) || 'index.html');
      if (!file.startsWith(build.directory + path.sep)) throw new Error('not found');
      response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  try {
    await new Promise(resolve => staticServer.listen(0, '127.0.0.1', resolve));
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.offlineSeen=[];window.addEventListener("md2pdf-offline-ready",event=>window.offlineSeen.push(event.detail.ready));' });
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${staticServer.address().port}/md2pdf/` });
    await wait('window.mdEditor && window.md2pdfAnalytics && document.querySelector(".analytics-settings")');
    await wait('window.offlineSeen.includes(true)');
    await browser.send('Network.enable');
    await browser.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await browser.send('Page.reload');
    await wait('window.mdEditor && window.md2pdfAnalytics && document.querySelector(".analytics-settings")');
    assert.equal(await evaluate('navigator.onLine'), false);
    await evaluate('document.querySelector(".analytics-settings").click()');
    assert.equal(await evaluate('document.querySelector(".analytics-dialog").open'), true);
    assert.equal(events.length, offlineCount, 'static offline reload never sends');
  } finally {
    await browser.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await new Promise(resolve => staticServer.close(resolve));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: actual UI consent, sanitized source/events, withdrawal, mobile layout, localhost opt-in, footer alignment, static project path and offline reload; all HTTPS requests mocked locally.');
} finally {
  await browser.stop(); await app.close(); await rm(directory, { recursive: true, force: true });
}
