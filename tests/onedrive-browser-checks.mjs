import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
const visualDir='/private/tmp/md2pdf-onedrive-ui';
const screenshot = async (name, selector) => {
  await mkdir(visualDir,{recursive:true});
  for (const [width,mode] of [[1280,'desktop'],[390,'mobile']]) {
    await browser.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
    for (const scheme of ['light','dark']) {
      await browser.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
      const geometry=await evaluate(`(()=>{const d=document.querySelector(${JSON.stringify(selector)}),r=d.getBoundingClientRect(),b=d.querySelector('button'),s=getComputedStyle(d),bs=getComputedStyle(b);return {left:r.left,right:r.right,width:innerWidth,background:s.backgroundColor,radius:s.borderRadius,buttonRadius:bs.borderRadius,font:parseFloat(bs.fontSize),overflow:d.scrollWidth>d.clientWidth}})()`);
      assert.ok(geometry.left>=0 && geometry.right<=geometry.width && !geometry.overflow,JSON.stringify(geometry));
      assert.notEqual(geometry.radius,'0px'); assert.notEqual(geometry.buttonRadius,'0px'); assert.ok(geometry.font<=16,JSON.stringify(geometry));
      const shot=await browser.send('Page.captureScreenshot',{format:'png'});
      await writeFile(`${visualDir}/${name}-${mode}-${scheme}.png`,Buffer.from(shot.data,'base64'));
    }
  }
  await browser.send('Emulation.clearDeviceMetricsOverride');
  await browser.send('Emulation.setEmulatedMedia',{features:[]});
};
const wait = async expression => { for (let n=0;n<300;n++) { try { if (await evaluate(`Boolean(${expression})`)) return; } catch {} await new Promise(resolve=>setTimeout(resolve,50)); } throw new Error('Timeout: '+expression); };
try {
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  await new Promise(resolve=>staticServer.listen(0,'127.0.0.1',resolve));
  await browser.start();
  const unconfigured = await browser.send('Page.addScriptToEvaluateOnNewDocument', {source:`{ const original=window.fetch.bind(window); window.fetch=(url,options)=>String(url).includes('onedrive-config.json') ? Promise.resolve(new Response('{}')) : original(url,options); }`});
  for (const url of [`http://127.0.0.1:${app.server.address().port}/`, `http://127.0.0.1:${staticServer.address().port}/nested/`]) {
    await browser.send('Page.navigate',{url});
    await wait('window.mdDrafts && window.mdEditor && window.mdOneDrive');
    assert.equal(await evaluate(`performance.getEntriesByType('resource').some(x=>/onedrive-config|msal-browser/.test(x.name))`),false);
    await evaluate(`mdEditor.setValue('# 保留原稿'); mdDrafts.flush()`);
    const id = await evaluate('mdDrafts.current()');
    await evaluate(`document.querySelector('button[aria-label="打开 Markdown"]').click()`);
    await wait(`[...document.querySelectorAll('#md-drafts-menu:not([hidden]) button')].some(x=>x.textContent.includes('OneDrive'))`);
    await evaluate(`[...document.querySelectorAll('#md-drafts-menu button')].find(x=>x.textContent.includes('OneDrive')).click()`);
    await wait(`document.querySelector('.md-cloud-error')?.textContent.includes('尚未配置')`);
    assert.equal(await evaluate(`document.querySelector('.md-cloud-error a')?.href`),new URL('onedrive-setup.html', url).href);
    assert.equal(await evaluate(`fetch(document.querySelector('.md-cloud-error a').href).then(r=>r.ok)`),true);
    assert.equal(await evaluate('mdEditor.getValue()'),'# 保留原稿');
    assert.equal(await evaluate('mdDrafts.current()'),id);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))`);
    await wait(`document.querySelector('.md-cloud-error')?.textContent.includes('尚未配置')`);
    assert.equal(await evaluate('mdEditor.getValue()'),'# 保留原稿');
  }
  console.log('OneDrive unconfigured Node and nested static browser checks passed');
  await browser.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:unconfigured.identifier});
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
      if (!url.startsWith('https://graph.microsoft.com/') && !url.startsWith('https://test-transfer.example/') && !url.startsWith('https://public-sn3302.files.1drv.com/')) return nativeFetch(value,options);
      state.calls.push({url,method:options.method || 'GET',headers:options.headers || {}});
      if (state.mode === 'offline') throw new TypeError('offline');
      const json = (body, status = 200) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
      if (url.startsWith('https://public-sn3302.files.1drv.com/download')) return new Response('# 云端原稿');
      if (url.startsWith('https://test-transfer.example/upload')) return options.method === 'DELETE' ? new Response(null,{status:204}) : state.mode === 'conflict' ? json({},409) : json({id:'new',name:'new.md',eTag:'new',file:{},size:new TextEncoder().encode('# 云端原稿').length},201);
      if (url.includes('/special/approot')) return json({id:'root'});
      if (url.includes('/children?')) return json({value:[{id:'cloud',name:'cloud.md',eTag:'old',file:{},size:5652},{id:'empty',name:'空文件.md',file:{},size:0},{id:'long',name:'这是一个用于检查长文件名换行的文档名称非常长非常长非常长非常长非常长.md',file:{},size:123},...Array.from({length:12},(_,i)=>({id:'extra'+i,name:'附加文件'+i+'.md',file:{},size:1}))]});
      if (url.includes('/items/cloud?')) return json(state.mode === 'missing' ? {id:'cloud',name:'cloud.md',file:{},size:4} : {id:'cloud',name:'cloud.md',eTag:'old','@microsoft.graph.downloadUrl':'https://public-sn3302.files.1drv.com/download'});
      if (url.includes('/items/new?')) return json({id:'new',name:'new.md',eTag:'new','@microsoft.graph.downloadUrl':'https://public-sn3302.files.1drv.com/download'});
      if (url.endsWith('/createUploadSession')) return json({uploadUrl:'https://test-transfer.example/upload'});
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
    await wait(`[...document.querySelectorAll('#md-drafts-menu:not([hidden]) button')].some(x=>x.textContent.includes('OneDrive'))`);
    await evaluate(`[...document.querySelectorAll('#md-drafts-menu button')].find(x=>x.textContent.includes('OneDrive')).click()`);
    await wait(`document.querySelector('dialog[aria-label="连接 OneDrive"]')`);
    await screenshot(url.includes('/nested/')?'static-connect':'node-connect','dialog[aria-label="连接 OneDrive"]');
    assert.equal(await evaluate('mockGraph.popups'),0);
    await evaluate(`mockGraph.mode='cancel'; document.querySelector('dialog[aria-label="连接 OneDrive"] button:last-child').click()`);
    await wait(`document.querySelector('dialog[aria-label="连接 OneDrive"] p')?.textContent.includes('登录已取消')`);
    assert.equal(await evaluate('mdEditor.getValue()'),'# 本地原稿');
    await evaluate(`mockGraph.mode='ok'`);
    await evaluate(`document.querySelector('dialog[aria-label="连接 OneDrive"] button:last-child').click()`);
    await wait(`document.querySelector('dialog[aria-label="从 OneDrive 打开 Markdown"]')`);
    assert.ok(await evaluate(`[...document.querySelectorAll('.md-onedrive-file')].some(x=>x.textContent.includes('空文件') && x.textContent.includes('0 B'))`));
    assert.ok(await evaluate(`[...document.querySelectorAll('.md-onedrive-file')].some(x=>x.textContent.includes('5.5 KiB'))`));
    assert.ok(await evaluate(`(()=>{const files=document.querySelector('.md-onedrive-files');return files.scrollHeight>files.clientHeight})()`));
    await screenshot(url.includes('/nested/')?'static-list':'node-list','dialog[aria-label="从 OneDrive 打开 Markdown"]');
    await evaluate(`mockGraph.mode='missing'; [...document.querySelectorAll('dialog[aria-label="从 OneDrive 打开 Markdown"] button')].find(x=>x.querySelector('.md-onedrive-name')?.textContent==='cloud.md').click()`);
    await wait(`document.querySelector('.md-cloud-error')?.textContent.includes('eTag')`);
    assert.equal(await evaluate('mdEditor.getValue()'),'# 本地原稿');
    assert.equal(await evaluate('mdDrafts.current()'),local);
    await evaluate(`mockGraph.mode='ok'; document.querySelector('button[aria-label="打开 Markdown"]').click()`);
    await wait(`[...document.querySelectorAll('#md-drafts-menu:not([hidden]) button')].some(x=>x.textContent.includes('OneDrive'))`);
    await evaluate(`[...document.querySelectorAll('#md-drafts-menu button')].find(x=>x.textContent.includes('OneDrive')).click()`);
    await wait(`document.querySelector('dialog[aria-label="从 OneDrive 打开 Markdown"]')`);
    await evaluate(`[...document.querySelectorAll('dialog[aria-label="从 OneDrive 打开 Markdown"] button')].find(x=>x.textContent==='取消').click()`);
    assert.equal(await evaluate('mdEditor.getValue()'),'# 本地原稿');
    await wait(`!document.querySelector('dialog[aria-label="从 OneDrive 打开 Markdown"]')`);
    await evaluate(`document.querySelector('button[aria-label="打开 Markdown"]').click()`);
    await wait(`[...document.querySelectorAll('#md-drafts-menu:not([hidden]) button')].some(x=>x.textContent.includes('OneDrive'))`);
    await evaluate(`[...document.querySelectorAll('#md-drafts-menu button')].find(x=>x.textContent.includes('OneDrive')).click()`);
    await wait(`document.querySelector('dialog[aria-label="从 OneDrive 打开 Markdown"]')`);
    await evaluate(`[...document.querySelectorAll('dialog[aria-label="从 OneDrive 打开 Markdown"] button')].find(x=>x.querySelector('.md-onedrive-name')?.textContent==='cloud.md').click()`);
    await wait(`mdEditor.getValue()==='# 云端原稿'`);
    assert.equal(await evaluate(`mdDrafts.store.get(${JSON.stringify(local)}).then(x=>x.md)`),'# 本地原稿');
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}))`);
    await wait('mockGraph.downloads===1');
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))`);
    await wait(`document.querySelector('dialog[aria-label="保存到 OneDrive"]')`);
    assert.match(await evaluate(`document.querySelector('dialog[aria-label="保存到 OneDrive"] input').value`), /\.md$/);
    await evaluate(`[...document.querySelectorAll('dialog[aria-label="保存到 OneDrive"] button')].find(x=>x.textContent==='取消').click()`);
    await wait(`!document.querySelector('dialog[aria-label="保存到 OneDrive"]')`);
    for (const mode of ['conflict','offline','ok']) {
      await evaluate(`mockGraph.mode=${JSON.stringify(mode)}; document.querySelector('button[aria-label="下载 Markdown"]').click()`);
      await wait(`document.querySelector('[aria-label="保存 Markdown"]')`);
      await evaluate(`[...document.querySelectorAll('[aria-label="保存 Markdown"] button')].find(x=>x.textContent.includes('保存到 OneDrive')).click()`);
      await wait(`document.querySelector('dialog[aria-label="保存到 OneDrive"]')`);
      assert.match(await evaluate(`document.querySelector('dialog[aria-label="保存到 OneDrive"] input').value`), /^云端原稿_\d{8}_\d{6}\.md$/, 'cloud default follows local download naming');
      assert.ok(await evaluate(`document.querySelector('dialog[aria-label="保存到 OneDrive"] p').textContent.startsWith('OneDrive / Apps / md2pdf · ')`));
      if(mode==='conflict') await screenshot(url.includes('/nested/')?'static-save':'node-save','dialog[aria-label="保存到 OneDrive"]');
      await evaluate(`document.querySelector('dialog[aria-label="保存到 OneDrive"] input').value='new.md'; [...document.querySelectorAll('dialog[aria-label="保存到 OneDrive"] button')].find(x=>x.textContent==='保存').click()`);
      await wait(mode === 'conflict' ? `document.querySelector('.md-cloud-error')?.textContent.includes('同名')` : mode === 'offline' ? `document.querySelector('.md-cloud-error')?.textContent.includes('网络')` : `document.querySelector('.md-cloud-status')?.textContent.includes('已保存')`);
      assert.equal(await evaluate('mdEditor.getValue()'),'# 云端原稿');
    }
    assert.ok(await evaluate(`mockGraph.calls.filter(x=>(x.url.startsWith('https://test-transfer.example/') || x.url.startsWith('https://public-sn3302.files.1drv.com/'))).every(x=>!x.headers.Authorization)`));
  }
  console.log('OneDrive mocked Node and nested static browser checks passed');

} finally { await browser.stop(); await new Promise(resolve=>app.server.close(resolve)); await new Promise(resolve=>staticServer.close(resolve)); await rm(temp,{recursive:true,force:true}); }
