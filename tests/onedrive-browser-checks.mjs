import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';

const root = path.resolve('dist/static');
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
const staticServer = http.createServer(async (req,res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname;
    if (!name.startsWith('/nested/')) throw new Error();
    let file = path.resolve(root, '.' + name.slice('/nested'.length));
    if (!file.startsWith(root + path.sep) && file !== root) throw new Error();
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
const app = createApp(), temp = await mkdtemp(path.join(os.tmpdir(),'md2pdf-onedrive-')), browser = new Chrome(findChrome(), temp);
const evaluate = async expression => {
  const result = await browser.send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails)); return result.result.value;
};
const wait = async expression => { for (let n=0;n<300;n++) { try { if (await evaluate(`Boolean(${expression})`)) return; } catch {} await new Promise(resolve=>setTimeout(resolve,50)); } throw new Error('Timeout: '+expression); };
try {
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  await new Promise(resolve=>staticServer.listen(0,'127.0.0.1',resolve));
  await browser.start();
  for (const url of [`http://127.0.0.1:${app.server.address().port}/`, `http://127.0.0.1:${staticServer.address().port}/nested/`]) {
    await browser.send('Page.navigate',{url});
    await wait('window.mdDrafts && window.mdEditor && window.mdOneDrive');
    assert.equal(await evaluate(`performance.getEntriesByType('resource').some(x=>/onedrive-config|msal-browser/.test(x.name))`),false);
    await evaluate(`mdEditor.setValue('# 保留原稿'); mdDrafts.flush()`);
    const id = await evaluate('mdDrafts.current()');
    await evaluate(`document.querySelector('button[aria-label="打开 Markdown"]').click()`);
    await wait(`document.querySelector('#md-drafts-menu:not([hidden])')`);
    await evaluate(`[...document.querySelectorAll('#md-drafts-menu button')].find(x=>x.textContent.includes('OneDrive')).click()`);
    await wait(`document.querySelector('.md-cloud-status')?.textContent.includes('尚未配置')`);
    assert.equal(await evaluate('mdEditor.getValue()'),'# 保留原稿');
    assert.equal(await evaluate('mdDrafts.current()'),id);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))`);
    await wait(`document.querySelector('.md-cloud-status')?.textContent.includes('尚未配置')`);
    assert.equal(await evaluate('mdEditor.getValue()'),'# 保留原稿');
  }
  console.log('OneDrive unconfigured Node and nested static browser checks passed');
  const injected = `(() => {
    const nativeFetch = window.fetch.bind(window);
    window.mockGraph = { calls: [], mode: 'ok', popups: 0, downloads: 0 };
    window.msal = { InteractionRequiredAuthError: class extends Error {}, PublicClientApplication: class {
      async initialize() {} async clearCache() {} async acquireTokenPopup() { window.mockGraph.popups++; if (window.mockGraph.mode === 'cancel') throw new Error('登录已取消'); return { account:{ username:'person@example.test' }, accessToken:'test-token' }; }
      async acquireTokenSilent() { return { accessToken:'test-token' }; }
    }};
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { window.mockGraph.downloads++; return; } return nativeClick.call(this); };
    window.fetch = async (value, options = {}) => {
      const url = String(value), state = window.mockGraph;
      if (url.includes('onedrive-config.json')) return new Response(JSON.stringify({clientId:'test',redirectUri:new URL('onedrive-callback.html',location.href).href}));
      if (!url.startsWith('https://graph.microsoft.com/') && !url.startsWith('https://test-transfer.example/')) return nativeFetch(value,options);
      state.calls.push({url,method:options.method || 'GET',headers:options.headers || {}});
      if (state.mode === 'offline') throw new TypeError('offline');
      const json = (body, status = 200) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
      if (url.startsWith('https://test-transfer.example/download')) return new Response('# 云端原稿');
      if (url.startsWith('https://test-transfer.example/upload')) return json({},202);
      if (url.includes('/special/approot')) return json({id:'root'});
      if (url.includes('/children?')) return json({value:[{id:'cloud',name:'cloud.md',eTag:'old',file:{}}]});
      if (url.includes('/items/cloud?')) return json({id:'cloud',name:'cloud.md',eTag:'old','@microsoft.graph.downloadUrl':'https://test-transfer.example/download'});
      if (url.endsWith('/createUploadSession')) return json({uploadUrl:'https://test-transfer.example/upload'});
      if (url.endsWith('/items/root') && options.method === 'PUT') return state.mode === 'conflict' ? json({},412) : json({id:'new',name:'new.md',eTag:'new'});
      return json({},404);
    };
  })();`;
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:injected});
  for (const url of [`http://127.0.0.1:${app.server.address().port}/`, `http://127.0.0.1:${staticServer.address().port}/nested/`]) {
    await browser.send('Page.navigate',{url});
    await wait('window.mdDrafts && window.mdEditor && window.mdOneDrive && window.mockGraph');
    await evaluate(`mdEditor.setValue('# 本地原稿'); mdDrafts.flush()`);
    const local = await evaluate('mdDrafts.current()');
    await evaluate(`document.querySelector('button[aria-label="打开 Markdown"]').click()`);
    await wait(`document.querySelector('#md-drafts-menu:not([hidden])')`);
    await evaluate(`[...document.querySelectorAll('#md-drafts-menu button')].find(x=>x.textContent.includes('OneDrive')).click()`);
    await wait(`document.querySelector('dialog[aria-label="连接 OneDrive"]')`);
    assert.equal(await evaluate('mockGraph.popups'),0);
    await evaluate(`mockGraph.mode='cancel'; document.querySelector('dialog[aria-label="连接 OneDrive"] button:last-child').click()`);
    await wait(`document.querySelector('dialog[aria-label="连接 OneDrive"] p')?.textContent.includes('登录已取消')`);
    assert.equal(await evaluate('mdEditor.getValue()'),'# 本地原稿');
    await evaluate(`mockGraph.mode='ok'`);
    await evaluate(`document.querySelector('dialog[aria-label="连接 OneDrive"] button:last-child').click()`);
    await wait(`document.querySelector('dialog[aria-label="从 OneDrive 打开 Markdown"]')`);
    await evaluate(`[...document.querySelectorAll('dialog[aria-label="从 OneDrive 打开 Markdown"] button')].find(x=>x.textContent==='cloud.md').click()`);
    await wait(`mdEditor.getValue()==='# 云端原稿'`);
    assert.equal(await evaluate(`mdDrafts.store.get(${JSON.stringify(local)}).then(x=>x.md)`),'# 本地原稿');
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}))`);
    await wait('mockGraph.downloads===1');
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))`);
    await wait(`document.querySelector('.md-cloud-status')?.textContent.includes('不能安全覆盖')`);
    for (const mode of ['conflict','offline','ok']) {
      await evaluate(`mockGraph.mode=${JSON.stringify(mode)}; document.querySelector('button[aria-label="下载 Markdown"]').click()`);
      await wait(`document.querySelector('[aria-label="保存 Markdown"]')`);
      await evaluate(`[...document.querySelectorAll('[aria-label="保存 Markdown"] button')].find(x=>x.textContent.includes('另存')).click()`);
      if (mode === 'offline') { await wait(`document.querySelector('.md-cloud-status')?.textContent.includes('offline')`); continue; }
      await wait(`document.querySelector('dialog[aria-label="另存到 OneDrive"]')`);
      await evaluate(`document.querySelector('dialog[aria-label="另存到 OneDrive"] input').value='new.md'; [...document.querySelectorAll('dialog[aria-label="另存到 OneDrive"] button')].find(x=>x.textContent==='保存').click()`);
      await wait(mode === 'conflict' ? `document.querySelector('.md-cloud-status')?.textContent.includes('同名')` : `document.querySelector('.md-cloud-status')?.textContent.includes('已保存')`);
      assert.equal(await evaluate('mdEditor.getValue()'),'# 云端原稿');
    }
    assert.ok(await evaluate(`mockGraph.calls.filter(x=>x.url.startsWith('https://test-transfer.example/')).every(x=>!x.headers.Authorization)`));
  }
  console.log('OneDrive mocked Node and nested static browser checks passed');

} finally { await browser.stop(); await new Promise(resolve=>app.server.close(resolve)); await new Promise(resolve=>staticServer.close(resolve)); await rm(temp,{recursive:true,force:true}); }
