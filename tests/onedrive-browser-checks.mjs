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
    await wait(`document.querySelector('.md-cloud-panel-error')?.textContent.includes('尚未配置')`);
    assert.equal(await evaluate(`document.querySelector('.md-cloud-panel-error a')?.href`),new URL('onedrive-setup.html', url).href);
    assert.equal(await evaluate(`fetch(document.querySelector('.md-cloud-panel-error a').href).then(r=>r.ok)`),true);
    assert.equal(await evaluate('mdEditor.getValue()'),'# 保留原稿');
    assert.equal(await evaluate('mdDrafts.current()'),id);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))`);
    await wait(`document.querySelector('.md-cloud-panel-error')?.textContent.includes('尚未配置')`);
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
      if (url.startsWith('https://test-transfer.example/upload')) return options.method === 'DELETE' ? new Response(null,{status:204}) : ['conflict','conflictoverwrite'].includes(state.mode) ? json({},409) : json({id:'new',name:'new.md',eTag:'new',file:{},size:new TextEncoder().encode('# 云端原稿').length},201);
      if (url.includes('/special/approot')) return json({id:'root'});
      if (url.includes('/items/root?$select=id,name,eTag,folder,file,package,remoteItem,root,parentReference')) return json({id:'root',folder:{}});
      if (state.deep && url.includes('/children?')) {const id=new URL(url).pathname.split('/').at(-2);const next={root:'deep1',deep1:'deep2',deep2:'deep3',deep3:'deep4'}[id];if(next)return json({value:[{id:next,name:'长目录名称'+next,eTag:'tag',folder:{}}]});}
      if (state.folderTest && url.includes('/items/nested?')) { if (state.holdOpen) await new Promise(resolve=>window.releaseNested=resolve); return json({id:'nested',name:'inside.md',eTag:'v1','@microsoft.graph.downloadUrl':'https://public-sn3302.files.1drv.com/download'}); }
      if (state.folderTest && url.includes('/items/sub/children?')) return json({value:[{id:'nested',name:'inside.md',eTag:'v1',file:{},size:5}]});
      if (state.folderTest && url.includes('/items/root/children?')) return json({value:[{id:'sub',name:'目录',eTag:'folder-tag',folder:{childCount:1}}]});
      if (state.folderTest && url.includes('/items/sub?$select=id,name,eTag,folder,file,package,remoteItem,root,parentReference')) return json({id:'sub',name:'目录',eTag:'folder-tag',folder:{},parentReference:{id:'root'}});
      if (state.folderTest && url.endsWith('/items/sub') && options.method==='PATCH') return state.renameConflict ? json({},409) : json({id:'sub',name:'更名目录',eTag:'folder-new',folder:{},parentReference:{id:'root'}});
      if (state.folderTest && url.endsWith('/items/sub') && options.method==='DELETE') return state.folderDeleteSuccess ? new Response(null,{status:204}) : json({},412);
      if (state.folderTest && url.includes('/items/sub/children') && options.method==='POST') { if (state.holdCreate) await new Promise(resolve=>window.releaseCreate=resolve); return json({id:'newfolder',name:'新增',folder:{}}); }
      if (url.includes('skiptoken=next')) return json({value:[{id:'cloud',name:'cloud.md',file:{},size:5652},{id:'last',name:'last.md',file:{},size:5}]});
      if (url.includes('/children?')) return json({'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/drive/items/root/children?$skiptoken=next',value:[{id:'cloud',name:'cloud.md',eTag:'old',file:{},size:5652},{id:'empty',name:'空文件.md',file:{},size:0},{id:'long',name:'这是一个用于检查长文件名换行的文档名称非常长非常长非常长非常长非常长.md',file:{},size:123},...Array.from({length:12},(_,i)=>({id:'extra'+i,name:'附加文件'+i+'.md',file:{},size:1}))]});
      if (url.endsWith('/items/cloud/content') && options.method==='PUT') { if (state.holdSave) await new Promise(resolve=>window.releaseSave=resolve); return state.mode==='late' ? json({},412) : json({id:'cloud',name:'cloud.md',eTag:'old',file:{},size:new TextEncoder().encode('# 云端原稿').length}); }
      if (url.includes('/items/root:/new.md:?')) return json({id:'same',name:'new.md',eTag:'old',file:{},parentReference:{id:'root'}});
      if (url.includes('/items/same?$select=id,name,eTag,folder,file,package,remoteItem,root,parentReference')) return json({id:'same',name:'new.md',eTag:'old',file:{},parentReference:{id:'root'}});
      if (url.endsWith('/items/same/content') && options.method==='PUT') return json({id:'same',name:'new.md',eTag:'new',file:{},size:new TextEncoder().encode('# 云端原稿').length});
      if (url.includes('/items/same?')) return json({id:'same',name:'new.md',eTag:'new','@microsoft.graph.downloadUrl':'https://public-sn3302.files.1drv.com/download'});
      if (url.endsWith('/items/cloud') && options.method==='PATCH') {state.renamedBody=JSON.parse(options.body);return json({id:'cloud',name:state.renamedBody.name,eTag:'renamed',file:{},parentReference:{id:'root'}});}
      if (url.includes('/items/cloud') && options.method==='DELETE') return new Response(null,{status:204});
      if (url.includes('/items/cloud?$select=id,name,eTag,folder,file,package,remoteItem,root,parentReference')) return json({id:'cloud',name:'cloud.md',eTag:'old',file:{},parentReference:{id:'root'}});
      if (url.includes('/items/cloud?')) { if (state.holdCloud) await new Promise(resolve=>window.releaseCloud=resolve); return json(state.mode === 'missing' ? {id:'cloud',name:'cloud.md',file:{},size:4} : {id:'cloud',name:'cloud.md',eTag:'old','@microsoft.graph.downloadUrl':'https://public-sn3302.files.1drv.com/download'}); }
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
    await wait(`[...document.querySelectorAll('.md-cloud-panel-button')].some(x=>x.textContent==='连接 OneDrive'&&!x.disabled)`);
    assert.equal(await evaluate('mockGraph.popups'),0);
    await evaluate(`mockGraph.mode='cancel'; [...document.querySelectorAll('.md-cloud-panel-button')].find(x=>x.textContent==='连接 OneDrive').click()`);
    await wait(`document.querySelector('.md-cloud-panel-error')?.textContent.includes('登录已取消')`);
    assert.equal(await evaluate('mdEditor.getValue()'),'# 本地原稿');
    await evaluate(`mockGraph.mode='ok'; [...document.querySelectorAll('.md-cloud-panel-button')].find(x=>x.textContent==='连接 OneDrive').click()`);
    await wait(`document.querySelectorAll('.md-cloud-panel-file').length===15`);
    assert.ok(await evaluate(`[...document.querySelectorAll('.md-cloud-panel-file')].some(x=>x.textContent.includes('空文件') && x.textContent.includes('0 B'))`));
    assert.ok(await evaluate(`[...document.querySelectorAll('.md-cloud-panel-file')].some(x=>x.textContent.includes('5.5 KiB'))`));
    await evaluate(`document.querySelector('.preview-panel [data-panel-fullscreen]').click()`);
    await wait(`document.querySelector('.preview-panel [data-panel-fullscreen]').getAttribute('aria-pressed')==='true'`);
    await evaluate(`document.querySelector('.preview-panel button[aria-label="打开 Markdown"]').click()`);
    await wait(`document.querySelector('#md-drafts-menu:not([hidden])')`);
    await evaluate(`[...document.querySelectorAll('#md-drafts-menu button')].find(x=>x.textContent.includes('OneDrive')).click()`);
    await wait(`document.querySelector('#preview-outline-tab-cloud[aria-selected="true"]') && document.querySelector('#preview-outline-view-cloud .md-cloud-panel-file')`);
    assert.equal(await evaluate(`document.querySelector('.preview-panel [data-panel-fullscreen]').getAttribute('aria-pressed')`),'true','cloud open stays in preview fullscreen');
    assert.equal(await evaluate(`document.querySelector('#preview-outline .md-sidebar-tabs').lastElementChild.getAttribute('aria-label')`),'云文件');
    assert.equal(await evaluate(`document.querySelectorAll('.md-cloud-panel').length`),1,'panels share one cloud view and account');
    await evaluate(`document.querySelector('.preview-panel [data-panel-fullscreen]').click()`);
    await wait(`document.querySelector('.preview-panel [data-panel-fullscreen]').getAttribute('aria-pressed')==='false'`);
    await evaluate(`mdOneDrive.open('editor')`);
    await wait(`document.querySelector('#editor-assistant-view-cloud .md-cloud-panel-file')`);

    await evaluate(`mockGraph.mode='offline'; [...document.querySelectorAll('.md-cloud-panel-button')].find(x=>x.textContent==='加载更多').click()`);
    await wait(`[...document.querySelectorAll('.md-cloud-panel-button')].some(x=>x.textContent==='重试加载')`);
    assert.equal(await evaluate(`document.querySelectorAll('.md-cloud-panel-file').length`),15);
    await evaluate(`mockGraph.mode='ok'; [...document.querySelectorAll('.md-cloud-panel-button')].find(x=>x.textContent==='重试加载').click()`);
    await wait(`document.querySelectorAll('.md-cloud-panel-file').length===16`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-cloud-id=cloud]').length`),1);
    await evaluate(`mockGraph.mode='missing'; [...document.querySelectorAll('.md-cloud-panel-file')].find(x=>x.querySelector('.md-cloud-panel-name')?.textContent==='cloud.md').click()`);
    await wait(`document.querySelector('.md-cloud-panel-error')?.textContent.includes('eTag')`);
    assert.equal(await evaluate('mdEditor.getValue()'),'# 本地原稿');
    assert.equal(await evaluate('mdDrafts.current()'),local);
    await evaluate(`mockGraph.mode='ok'; [...document.querySelectorAll('.md-cloud-panel-button')].find(x=>x.textContent==='重试打开').click()`);
    await wait(`mdEditor.getValue()==='# 云端原稿'`);
    assert.equal(await evaluate(`mdDrafts.store.get(${JSON.stringify(local)}).then(x=>x.md)`),'# 本地原稿');
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}))`);
    await wait('mockGraph.downloads===1');
    await evaluate(`mockGraph.mode='ok'; mockGraph.holdSave=true; document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))`);
    await wait('window.releaseSave');
    assert.equal(await evaluate(`document.querySelector('[aria-label="cloud.md 更多操作"]').disabled`),true);
    await evaluate(`document.querySelector('[aria-label="cloud.md 更多操作"]').click()`); assert.equal(await evaluate(`mockGraph.calls.filter(x=>x.method==='DELETE'&&x.url.endsWith('/items/cloud')).length`),0);
    await evaluate('mockGraph.holdSave=false; window.releaseSave()');
    await wait(`mockGraph.calls.some(x=>x.url.endsWith('/items/cloud/content')&&x.method==='PUT')`);
    await wait(`document.querySelector('.md-cloud-status')?.textContent.includes('已保存')`);
    await evaluate(`mockGraph.mode='late'; document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))`);
    await wait(`document.querySelector('dialog[aria-label="OneDrive 保存冲突"]')`);
    assert.equal(await evaluate(`mockGraph.calls.filter(x=>x.url.endsWith('/items/cloud/content')).at(-1).headers['If-Match']`),'old');
    await evaluate(`[...document.querySelectorAll('dialog[aria-label="OneDrive 保存冲突"] button')].find(x=>x.textContent==='保存副本').click()`);
    await wait(`document.querySelector('dialog[aria-label="保存到 OneDrive"]')`);
    await evaluate(`[...document.querySelectorAll('dialog[aria-label="保存到 OneDrive"] button')].find(x=>x.textContent==='取消').click()`);
    await wait(`!document.querySelector('dialog[aria-label="保存到 OneDrive"]')`);
    await evaluate(`mockGraph.mode='ok';mdDrafts.openFile('# 云端原稿','local.md')`);
    for (const mode of ['conflict','conflictoverwrite','offline','ok']) {
      await evaluate(`mockGraph.mode=${JSON.stringify(mode)}; document.querySelector('button[aria-label="下载 Markdown"]').click()`);
      await wait(`document.querySelector('[aria-label="保存 Markdown"]')`);
      await evaluate(`[...document.querySelectorAll('[aria-label="保存 Markdown"] button')].find(x=>x.textContent.includes('保存到 OneDrive')).click()`);
      await wait(`document.querySelector('dialog[aria-label="保存到 OneDrive"]')`);
      assert.match(await evaluate(`document.querySelector('dialog[aria-label="保存到 OneDrive"] input').value`), /^云端原稿_\d{8}_\d{6}\.md$/, 'cloud default follows local download naming');
      assert.ok(await evaluate(`document.querySelector('dialog[aria-label="保存到 OneDrive"] p').textContent.startsWith('OneDrive / Apps / md2pdf · ')`));
      if(mode==='conflict') await screenshot(url.includes('/nested/')?'static-save':'node-save','dialog[aria-label="保存到 OneDrive"]');
      await evaluate(`document.querySelector('dialog[aria-label="保存到 OneDrive"] input').value='new.md'; [...document.querySelectorAll('dialog[aria-label="保存到 OneDrive"] button')].find(x=>x.textContent==='保存').click()`);
      if (mode === 'conflict' || mode === 'conflictoverwrite') {
        await wait(`document.querySelector('dialog[aria-label="OneDrive 保存冲突"]')`); assert.ok(await evaluate(`document.querySelector('dialog[aria-label="OneDrive 保存冲突"]').textContent.includes('new.md')`));
        await evaluate(`[...document.querySelectorAll('dialog[aria-label="OneDrive 保存冲突"] button')].find(x=>x.textContent===${JSON.stringify(mode === 'conflict' ? '改名' : '覆盖')}).click()`);
        if (mode === 'conflict') { await wait(`document.querySelector('dialog[aria-label="保存到 OneDrive"]')`); assert.equal(await evaluate(`document.querySelector('dialog[aria-label="保存到 OneDrive"] input').value`),'new.md'); await evaluate(`[...document.querySelectorAll('dialog[aria-label="保存到 OneDrive"] button')].find(x=>x.textContent==='取消').click()`); await wait(`!document.querySelector('dialog[aria-label="保存到 OneDrive"]')`); }
        else { await wait(`mockGraph.calls.some(x=>x.url.endsWith('/items/same/content')&&x.method==='PUT')`); await wait(`document.querySelector('.md-cloud-status')?.textContent.includes('已保存')`); assert.equal(await evaluate(`mockGraph.calls.find(x=>x.url.endsWith('/items/same/content')).headers['If-Match']`),'old'); await evaluate(`mdDrafts.openFile('# 云端原稿','local.md')`); }
      } else await wait(mode === 'offline' ? `document.querySelector('.md-cloud-error')?.textContent.includes('网络')` : `document.querySelector('.md-cloud-status')?.textContent.includes('已保存')`);
      await wait(`!document.querySelector('dialog[aria-label="OneDrive 保存冲突"]')`);
      assert.equal(await evaluate('mdEditor.getValue()'),'# 云端原稿');
    }
    const delayedDraft=await evaluate('mdDrafts.current()');
    await evaluate(`mockGraph.holdCloud=true;document.querySelector('[data-cloud-id="cloud"]').click()`);await wait('window.releaseCloud');
    await evaluate(`document.querySelector('[aria-label="cloud.md 更多操作"]').click();[...document.querySelectorAll('.md-cloud-popup button')].find(x=>x.textContent==='移到回收站').click()`);
    await wait(`mockGraph.calls.filter(x=>x.method==='DELETE'&&x.url.endsWith('/items/cloud')).length===1`);
    await evaluate('mockGraph.holdCloud=false;window.releaseCloud()');await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await evaluate('mdDrafts.current()'),delayedDraft);assert.equal(await evaluate(`!!document.querySelector('[data-cloud-id="cloud"][aria-current="true"]')`),false);
    await evaluate(`document.querySelector('[data-cloud-id="cloud"]').click()`); await wait(`document.querySelector('[data-cloud-id="cloud"][aria-current="true"]')`);
    const openedId=await evaluate('mdDrafts.current()');
    await evaluate(`document.querySelector('[aria-label="cloud.md 更多操作"]').click()`);
    await evaluate(`[...document.querySelectorAll('.md-cloud-popup button')].find(x=>x.textContent==='移到回收站').click()`);
    await wait(`mockGraph.calls.filter(x=>x.method==='DELETE' && x.url.endsWith('/items/cloud')).length===2`);
    await wait(`!document.querySelector('[data-cloud-id="cloud"][aria-current="true"]')`);
    assert.equal(await evaluate('mdDrafts.current()'),openedId); assert.equal(await evaluate('mdEditor.getValue()'),'# 云端原稿');
    await evaluate(`document.querySelector('[aria-label="cloud.md 更多操作"]').click(); document.querySelector('.md-cloud-popup button').click()`);
    assert.equal(await evaluate(`document.querySelector('.md-cloud-rename input').value`),'cloud');
    assert.equal(await evaluate(`document.querySelector('.md-cloud-extension').textContent`),'.md');
    await evaluate(`document.querySelector('.md-cloud-rename input').value='report.v2';document.querySelector('.md-cloud-rename').requestSubmit()`);
    await wait(`mockGraph.renamedBody?.name==='report.v2.md' && !document.querySelector('.md-cloud-rename')`);
    await evaluate(`mockGraph.folderTest=true; document.querySelector('.md-cloud-icon-button[aria-label="刷新"]').click()`);
    await wait(`document.querySelector('[data-cloud-id="sub"]')`);
    await evaluate(`document.querySelector('[aria-label="目录 更多操作"]').click(); [...document.querySelectorAll('.md-cloud-popup button')].find(x=>x.textContent==='重命名').click()`);
    await wait(`document.querySelector('.md-cloud-rename input')`);
    await evaluate(`document.querySelector('.md-cloud-rename input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
    await wait(`!document.querySelector('.md-cloud-rename')`); assert.equal(await evaluate(`document.querySelector('#editor-assistant-tab-cloud').getAttribute('aria-selected')`),'true');
    await evaluate(`document.querySelector('[aria-label="目录 更多操作"]').click(); [...document.querySelectorAll('.md-cloud-popup button')].find(x=>x.textContent==='重命名').click();document.querySelector('.editor-panel .md-sidebar-close').click();window.escapeAfterClose=false;window.addEventListener('keydown',e=>{if(e.key==='Escape')window.escapeAfterClose=true;},{once:true});window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
    assert.equal(await evaluate('window.escapeAfterClose'),true);
    await evaluate('window.mdOneDrive.open()');await wait(`document.querySelector('[aria-label="目录 更多操作"]')`);
    await evaluate(`mockGraph.renameConflict=true;document.querySelector('[aria-label="目录 更多操作"]').click(); [...document.querySelectorAll('.md-cloud-popup button')].find(x=>x.textContent==='重命名').click(); document.querySelector('.md-cloud-rename input').value='冲突目录'; document.querySelector('.md-cloud-rename').requestSubmit()`);
    await wait(`document.querySelector('.md-cloud-panel-error')?.textContent.includes('409')`);
    assert.equal(await evaluate(`document.querySelector('.md-cloud-rename input').value`),'冲突目录');
    await evaluate(`mockGraph.renameConflict=false;document.querySelector('.md-cloud-rename input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`); await wait(`!document.querySelector('.md-cloud-rename')`);
    await evaluate(`document.querySelector('[aria-label="目录 更多操作"]').click(); [...document.querySelectorAll('.md-cloud-popup button')].find(x=>x.textContent==='重命名').click(); document.querySelector('.md-cloud-rename input').value='更名目录'; document.querySelector('.md-cloud-rename').requestSubmit()`);
    await wait(`mockGraph.calls.some(x=>x.url.endsWith('/items/sub')&&x.method==='PATCH')`);
    assert.equal(await evaluate(`mockGraph.calls.find(x=>x.url.endsWith('/items/sub')&&x.method==='PATCH').headers['If-Match']`),'folder-tag');
    await wait(`document.querySelector('[aria-label="目录 更多操作"]')`);
    await evaluate(`document.querySelector('[aria-label="目录 更多操作"]').click()`);
    assert.ok(await evaluate(`document.querySelector('.md-cloud-popup').textContent.includes('移到回收站')`));
    await evaluate(`document.querySelector('.md-cloud-popup button').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);await wait(`!document.querySelector('.md-cloud-popup')`);
    assert.equal(await evaluate(`mockGraph.calls.filter(x=>x.url.endsWith('/items/sub')&&x.method==='DELETE').length`),0);
    await evaluate(`document.querySelector('[aria-label="目录 更多操作"]').click(); [...document.querySelectorAll('.md-cloud-popup button')].find(x=>x.textContent==='移到回收站').click()`);
    await wait(`document.querySelector('.md-cloud-panel-error')?.textContent.includes('412')`);
    assert.equal(await evaluate(`mockGraph.calls.find(x=>x.url.endsWith('/items/sub')&&x.method==='DELETE').headers['If-Match']`),'folder-tag');
    await evaluate(`document.querySelector('[data-cloud-id="sub"]').click()`); await wait(`document.querySelector('[data-cloud-id="nested"]')`);
    await evaluate(`document.querySelector('.md-cloud-icon-button[aria-label="新建文件夹"]').click(); document.querySelector('[aria-label="文件夹名称"]').value='新增'; document.querySelector('.md-cloud-panel form').requestSubmit()`);
    await wait(`mockGraph.calls.some(x=>x.url.includes('/items/sub/children')&&x.method==='POST')`);
    await wait(`document.querySelector('[data-cloud-id="nested"]')`);
    assert.equal(await evaluate(`document.querySelector('.md-cloud-panel').textContent.includes('目录')`),true);
    if(url.includes('/nested/')) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:568,deviceScaleFactor:1,mobile:false});
      await mkdir(visualDir,{recursive:true}); const shot=await browser.send('Page.captureScreenshot',{format:'png'}); await writeFile(`${visualDir}/static-folder-mobile.png`,Buffer.from(shot.data,'base64'));
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      await browser.send('Emulation.clearDeviceMetricsOverride');
    }

    await wait(`!document.querySelector('[aria-label="文件夹名称"]')`);
    await evaluate(`mockGraph.holdCreate=true; document.querySelector('.md-cloud-icon-button[aria-label="新建文件夹"]').click(); document.querySelector('[aria-label="文件夹名称"]').value='迟到'; document.querySelector('.md-cloud-panel form').requestSubmit()`);
    await wait('window.releaseCreate');
    const raceDraft=await evaluate('mdDrafts.current()');
    assert.equal(await evaluate(`document.querySelector('[data-cloud-id="nested"]').disabled`),true);
    await evaluate(`[...document.querySelectorAll('.md-cloud-crumb')].find(x=>x.textContent==='md2pdf').click()`); await wait(`document.querySelector('[data-cloud-id="sub"]')`);
    await evaluate('window.releaseCreate()'); await new Promise(resolve=>setTimeout(resolve,100));
    assert.ok(await evaluate(`document.querySelector('[data-cloud-id="sub"]')`));
    assert.equal(await evaluate('mdDrafts.current()'),raceDraft); assert.equal(await evaluate('mdEditor.getValue()'),'# 云端原稿');
    await evaluate(`mockGraph.holdOpen=false;mockGraph.holdCreate=false;document.querySelector('[data-cloud-id="sub"]').click()`); await wait(`document.querySelector('[data-cloud-id="nested"]')`);
    await evaluate(`document.querySelector('[data-cloud-id="nested"]').click()`); await wait(`document.querySelector('[data-cloud-id="nested"][aria-current="true"]')`);
    const nestedDraft=await evaluate('mdDrafts.current()');
    await evaluate(`[...document.querySelectorAll('.md-cloud-crumb')].find(x=>x.textContent==='md2pdf').click()`); await wait(`document.querySelector('[data-cloud-id="sub"]')`);
    await evaluate(`mockGraph.folderDeleteSuccess=true;document.querySelector('[aria-label="目录 更多操作"]').click(); [...document.querySelectorAll('.md-cloud-popup button')].find(x=>x.textContent==='移到回收站').click()`);
    await wait(`mockGraph.calls.filter(x=>x.url.endsWith('/items/sub')&&x.method==='DELETE').length===2`);
    await wait(`document.querySelector('.md-cloud-notice').hidden`);
    assert.equal(await evaluate('mdDrafts.current()'),nestedDraft);assert.equal(await evaluate('mdEditor.getValue()'),'# 云端原稿');
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))`);
    await wait(`document.querySelector('dialog[aria-label="保存到 OneDrive"]')`);
    await evaluate(`[...document.querySelectorAll('dialog[aria-label="保存到 OneDrive"] button')].find(x=>x.textContent==='取消').click()`); await wait(`!document.querySelector('dialog[aria-label="保存到 OneDrive"]')`);

    await evaluate(`mockGraph.deep=true;mockGraph.folderTest=false;document.querySelector('.md-cloud-icon-button[aria-label="刷新"]').click()`);await wait(`document.querySelector('[data-cloud-id="deep1"]')`);
    for(const id of ['deep1','deep2','deep3']) {await evaluate(`document.querySelector('[data-cloud-id="${id}"]').click()`);await wait(`document.querySelector('[data-cloud-id="${{deep1:'deep2',deep2:'deep3',deep3:'deep4'}[id]}"]')`);}
    await browser.send('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:false}); await new Promise(resolve=>setTimeout(resolve,500));
    const pathGeometry=await evaluate(`(()=>{const n=document.querySelector('.md-cloud-breadcrumb'),last=n.querySelector(':scope > .md-cloud-crumb:last-child'),r=last.getBoundingClientRect();return {width:r.width,right:r.right,viewport:innerWidth,collapsed:!!n.querySelector('details')};})()`);
    assert.ok(pathGeometry.collapsed && pathGeometry.width>=38 && pathGeometry.right<=pathGeometry.viewport,JSON.stringify(pathGeometry));
    await evaluate(`document.querySelector('.md-cloud-path-more summary').click()`);assert.equal(await evaluate(`document.querySelector('.md-cloud-path-more').open`),true);
    await mkdir(visualDir,{recursive:true});const deepShot=await browser.send('Page.captureScreenshot',{format:'png'});await writeFile(`${visualDir}/${url.includes('/nested/')?'static':'node'}-deep-320.png`,Buffer.from(deepShot.data,'base64'));
    await browser.send('Emulation.clearDeviceMetricsOverride');
    await evaluate(`mockGraph.deep=false; [...document.querySelectorAll('.md-cloud-crumb')].find(x=>x.textContent==='md2pdf').click()`);await wait(`document.querySelectorAll('.md-cloud-panel-file').length===15`);
    await evaluate(`mockGraph.folderTest=false; document.querySelector('.md-cloud-icon-button[aria-label="刷新"]').click()`); await wait(`document.querySelectorAll('.md-cloud-panel-file').length===15`);
    await evaluate(`mockGraph.mode='offline'; document.querySelector('.md-cloud-icon-button[aria-label="刷新"]').click()`);
    await wait(`document.querySelector('.md-cloud-panel-error')?.textContent.includes('网络')`);
    assert.ok(await evaluate(`document.querySelectorAll('.md-cloud-panel-file').length>0`));
    await evaluate(`mockGraph.mode='ok'; [...document.querySelectorAll('.md-cloud-panel-button')].find(x=>x.textContent==='重试').click()`);
    await wait(`!document.querySelector('.md-cloud-panel-error')`);
    const currentId=await evaluate('mdDrafts.current()');
    await evaluate(`document.querySelector('.md-cloud-icon-button[aria-label="断开"]').click()`);
    await wait(`[...document.querySelectorAll('.md-cloud-panel-button')].some(x=>x.textContent==='连接 OneDrive'&&!x.disabled)`);
    assert.equal(await evaluate('mdDrafts.current()'),currentId); assert.equal(await evaluate('mdEditor.getValue()'),'# 云端原稿');
    assert.ok(await evaluate(`mockGraph.calls.filter(x=>(x.url.startsWith('https://test-transfer.example/') || x.url.startsWith('https://public-sn3302.files.1drv.com/'))).every(x=>!x.headers.Authorization)`));
  }
  console.log('OneDrive mocked Node and nested static browser checks passed');

} finally { await browser.stop(); await new Promise(resolve=>app.server.close(resolve)); await new Promise(resolve=>staticServer.close(resolve)); await rm(temp,{recursive:true,force:true}); }
