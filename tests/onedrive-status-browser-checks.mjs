import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { startStaticServer } from '../src/static-server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';
const app=createApp(), temp=await mkdtemp(path.join(os.tmpdir(),'md2pdf-cloud-status-')); let browser, staticServer;
const evaluate=async expression=>{const result=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));return result.result.value;};
const wait=async expression=>{for(let n=0;n<300;n++){try{if(await evaluate(`Boolean(${expression})`))return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Timeout: '+expression);};
const geometry=()=>evaluate(`(()=>{const p=document.querySelector('.editor-panel'),r=p.getBoundingClientRect(),h=p.querySelector('.panel-heading'),t=p.querySelector('.md-wt-toolbar');return {heading:h.getBoundingClientRect().height,toolbarTop:t.getBoundingClientRect().top-r.top,toolbarHeight:t.getBoundingClientRect().height,buttons:[...p.querySelectorAll('.panel-heading button,.md-wt-toolbar button')].map(b=>{const x=b.getBoundingClientRect();return [Math.round(x.left-r.left),Math.round(x.top-r.top),Math.round(x.width),Math.round(x.height)]}),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
const source=`(()=>{const native=fetch.bind(window);window.testMode='unconfigured';window.msal={InteractionRequiredAuthError:class extends Error{},PublicClientApplication:class{async initialize(){} async acquireTokenPopup(){return {account:{username:'mock@example.test'},accessToken:'fake'}} async acquireTokenSilent(){if(testMode==='verylong')throw new Error('长错误'+('abcdef'.repeat(200))+'结束标记');return {accessToken:'fake'}}}};window.fetch=async (value,options)=>{const url=String(value);if(url.includes('onedrive-config.json'))return new Response(JSON.stringify(testMode==='unconfigured'?{}:{clientId:'fake',redirectUri:new URL('onedrive-callback.html',location.href).href}));if(!url.startsWith('https://graph.microsoft.com/')&&!url.startsWith('https://public-sn3302.files.1drv.com/'))return native(value,options);const json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});if(url.includes('/special/approot'))return json({id:'root'});if(url.includes('/children?'))return json({value:[{id:'cloud',name:'cloud.md',eTag:'tag',file:{},size:3}]});if(url.includes('/items/cloud?'))return json({id:'cloud',name:'cloud.md',eTag:'tag','@microsoft.graph.downloadUrl':testMode==='long'?'https://'+(['a'.repeat(60),'b'.repeat(60),'c'.repeat(60)].join('.'))+'.evil.test/file?secret=hidden':'https://public-sn3302.files.1drv.com/file'});return new Response('# 云端文档');};})();`;
try{
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));staticServer=await startStaticServer({directory:path.resolve('dist/static'),port:0});
 await mkdir('/private/tmp/md2pdf-cloud-status',{recursive:true});
 for(const [name,base] of [['node',`http://127.0.0.1:${app.server.address().port}`],['static',`http://127.0.0.1:${staticServer.address().port}`]])for(const [width,height] of [[1440,900],[390,900],[320,900],[390,568]]){
  browser=new Chrome(findChrome(),temp);await browser.start();await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await browser.send('Page.addScriptToEvaluateOnNewDocument',{source});await browser.send('Page.navigate',{url:base+'/'});await wait('window.mdDrafts && window.mdEditor && window.mdOneDrive');
  await evaluate('window.mdOneDrive.open()');await wait(`document.querySelector('.md-cloud-panel-error')?.textContent.includes('尚未配置')`);const before=await geometry();
  await evaluate(`testMode='ok'; [...document.querySelectorAll('.md-cloud-panel-button')].find(x=>x.textContent==='重试').click()`);
  await wait(`[...document.querySelectorAll('.md-cloud-panel-button')].some(x=>x.textContent==='连接 OneDrive'&&!x.disabled)`);
  await evaluate(`[...document.querySelectorAll('.md-cloud-panel-button')].find(x=>x.textContent==='连接 OneDrive').click()`);
  await wait(`document.querySelector('.md-cloud-panel-file')`); assert.deepEqual(await geometry(),before);
  await evaluate(`document.querySelector('.md-cloud-panel-file').click()`);await wait(`document.querySelector('.md-cloud-status')?.textContent.includes('已打开')`);
  await evaluate(`testMode='long';window.mdOneDrive.open()`);await wait(`document.querySelector('.md-cloud-panel-file')`);const opened=await geometry();
  await evaluate(`document.querySelector('.md-cloud-panel-file').click()`);await wait(`document.querySelector('.md-cloud-panel-error')?.textContent.includes('evil.test')`);assert.deepEqual(await geometry(),opened);
  const detail=await evaluate(`(()=>{const d=document.querySelector('.md-cloud-panel-error'),p=d.closest('.md-sidebar-content');return {text:d.textContent,width:d.getBoundingClientRect().width,panel:p.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth}})()`);assert.ok(!detail.text.includes('secret')&&detail.width<=detail.panel&&!detail.overflow,JSON.stringify(detail));
  const shot=await browser.send('Page.captureScreenshot',{format:'png'});await writeFile(`/private/tmp/md2pdf-cloud-status/${name}-${width}-${height}.png`,Buffer.from(shot.data,'base64'));
  if(name==='node' && width===390 && height===568){
    await evaluate(`testMode='verylong';document.querySelector('.md-cloud-panel-file').click()`);await wait(`document.querySelector('.md-cloud-panel-error')?.textContent.includes('结束标记')`);
    const long=await evaluate(`(()=>{const d=document.querySelector('.md-cloud-panel-error'),body=d.closest('.md-cloud-panel-status');body.scrollTop=body.scrollHeight;return {length:d.textContent.length,scroll:body.scrollHeight,client:body.clientHeight,reachedEnd:body.scrollTop+body.clientHeight>=body.scrollHeight-1,editor:mdEditor.getValue()}})()`);
    assert.ok(long.length>1000&&long.scroll>long.client&&long.reachedEnd&&long.editor==='# 云端文档',JSON.stringify(long));assert.deepEqual(await geometry(),opened);
  }
  if(width===390 && height===568){
    const others=await evaluate(`(()=>{const text='https://example.test/'+('x'.repeat(900));const selectors=['.md-image-status','.md-doi-status','#draft-save-status','#status'];return selectors.map(selector=>{const node=document.querySelector(selector);node.textContent=text;node.dataset.error='true';const box=node.getBoundingClientRect(),parent=node.parentElement.getBoundingClientRect(),style=getComputedStyle(node);return {selector,width:box.width,parentWidth:parent.width,height:box.height,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,overflow:style.overflow,documentOverflow:document.documentElement.scrollWidth>innerWidth};})})()`);
    for(const item of others) assert.ok(item.width<=item.parentWidth && item.height<=120 && item.overflow!=='visible' && !item.documentOverflow,JSON.stringify(item));
    assert.ok(others.find(item=>item.selector==='#status').width>0,JSON.stringify(others));
    assert.deepEqual(await geometry(),opened);
  }
  await browser.stop();browser=null;
 }
 console.log('OneDrive status geometry and safe long error passed for Node/static desktop/mobile');
}finally{if(browser)await browser.stop();await new Promise(resolve=>app.server.close(resolve));if(staticServer)await new Promise(resolve=>staticServer.close(resolve));await rm(temp,{recursive:true,force:true});}
