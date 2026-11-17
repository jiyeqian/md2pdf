import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';
const app=createApp(), temp=await mkdtemp(path.join(os.tmpdir(),'md2pdf-cloud-sidebar-')), browser=new Chrome(findChrome(),temp);
const evalJS=async expression=>{const r=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});assert.equal(r.exceptionDetails,undefined,JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=async expression=>{for(let n=0;n<300;n++){try{if(await evalJS(`Boolean(${expression})`))return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Timeout: '+expression);};
const click=async selector=>{const rect=await evalJS(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});};
try{
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));await browser.start();await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const native=fetch.bind(window);window.fakeCalls=[];window.msal={InteractionRequiredAuthError:class extends Error{},PublicClientApplication:class{async initialize(){} async acquireTokenPopup(){fakeCalls.push({popup:true,gesture:navigator.userActivation.isActive});return {account:{username:'person@example.test'},accessToken:'fake'}} async acquireTokenSilent(){return {accessToken:'fake'}}async clearCache(){fakeCalls.push({cleared:true})}}};window.fetch=async(value,opts={})=>{const url=String(value);if(url.includes('onedrive-config.json'))return new Response(JSON.stringify({clientId:'fake',redirectUri:new URL('onedrive-callback.html',location.href).href}));if(!url.startsWith('https://graph.microsoft.com/')&&!url.startsWith('https://public-sn3302.files.1drv.com/'))return native(value,opts);fakeCalls.push({url,method:opts.method||'GET'});const json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});if(url.includes('/special/approot'))return json({id:'root'});if(window.folderTest&&url.includes('/items/sub/children?'))return json({value:[{id:'nested',name:'inside.md',eTag:'v1',file:{},size:5}]});if(window.folderTest&&url.includes('/items/root/children?'))return json({value:[{id:'sub',name:'项目',folder:{childCount:1}}]});if(url.includes('/children?'))return json({value:[{id:'one',name:'示例文件.md',eTag:'tag',file:{},size:5652},{id:'empty',name:'空文件.md',file:{},size:0}]});if(url.includes('/items/one?'))return json({id:'one',name:'示例文件.md',eTag:'tag','@microsoft.graph.downloadUrl':'https://public-sn3302.files.1drv.com/file'});return new Response('# 云端文档');};})();`});
 await browser.send('Page.navigate',{url:`http://127.0.0.1:${app.server.address().port}/`});await wait('window.mdDrafts && window.mdOneDrive && window.mdEditorSidebar');
 await evalJS('window.mdOneDrive.open()');await wait(`document.querySelector('#editor-assistant-tab-cloud[aria-selected="true"]')`);await wait(`[...document.querySelectorAll('.md-cloud-panel-button')].some(x=>x.textContent==='连接 OneDrive'&&!x.disabled)`);
 const connectSelector='.md-cloud-panel-button';assert.equal(await evalJS(`document.querySelector(${JSON.stringify(connectSelector)}).textContent`),'连接 OneDrive');await click(connectSelector);
 await wait(`document.querySelectorAll('.md-cloud-panel-file').length===2`);assert.equal(await evalJS(`fakeCalls.find(x=>x.popup).gesture`),true);
 await browser.send('Emulation.setEmulatedMedia',{features:[{name:'hover',value:'hover'}]});
 const canHover=await evalJS(`matchMedia('(hover:hover)').matches`); assert.equal(canHover,true,'desktop hover emulation must be active');
 if(canHover){
  await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
  await wait(`getComputedStyle(document.querySelector('.md-cloud-row-menu')).opacity==='0'`);
  const point=await evalJS(`(()=>{const r=document.querySelector('.md-cloud-panel-row').getBoundingClientRect();return {x:r.left+10,y:r.top+10}})()`);
  await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await wait(`getComputedStyle(document.querySelector('.md-cloud-row-menu')).opacity==='1'`);
 }
 await evalJS(`document.querySelector('.md-cloud-row-menu').focus()`);assert.equal(await evalJS(`getComputedStyle(document.querySelector('.md-cloud-row-menu')).opacity`),'1');
 await browser.send('Emulation.setEmulatedMedia',{features:[]});
 await browser.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await evalJS(`document.querySelector('.md-cloud-row-menu').blur()`);
 assert.equal(await evalJS(`matchMedia('(hover:none)').matches`),true,'touch hover emulation must be active'); assert.equal(await evalJS(`getComputedStyle(document.querySelector('.md-cloud-row-menu')).opacity`),'1');
 await browser.send('Emulation.setEmulatedMedia',{features:[]});
 await browser.send('Emulation.setTouchEmulationEnabled',{enabled:false});
 console.log('Cloud menu hover, keyboard and touch visibility passed');
 assert.equal(await evalJS(`(()=>{const b=document.querySelector('.md-cloud-crumb');return b.textContent==='md2pdf' && b.scrollWidth<=b.clientWidth+1})()`),true,'root path must not truncate md2pdf');

 assert.equal(await evalJS(`document.querySelectorAll('.md-cloud-item-icon').length`),2);
 await evalJS(`document.querySelector('.md-cloud-row-menu').click()`);
 const menuPoint=await evalJS(`(()=>{const r=document.querySelectorAll('.md-cloud-popup button')[1].getBoundingClientRect();return {x:r.left+10,y:r.top+10}})()`);
 await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',...menuPoint});
 assert.equal(await evalJS(`getComputedStyle(document.querySelector('.md-cloud-popup button')).backgroundColor`),'rgba(0, 0, 0, 0)');
 assert.notEqual(await evalJS(`getComputedStyle(document.querySelectorAll('.md-cloud-popup button')[1]).backgroundColor`),'rgba(0, 0, 0, 0)');
 await evalJS(`document.querySelector('.md-cloud-popup button').click()`);

 assert.equal(await evalJS(`document.querySelector('.md-cloud-rename input').value`),'示例文件');
 assert.equal(await evalJS(`document.querySelector('.md-cloud-extension').textContent`),'.md');
 assert.equal(await evalJS(`document.querySelectorAll('.md-cloud-rename button').length`),0);
 await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:1,y:1});
 await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:1,y:1});
 await wait(`!document.querySelector('.md-cloud-rename')`);
 assert.equal(await evalJS(`fakeCalls.some(x=>x.method==='PATCH')`),false,'outside click must cancel rename');
 assert.ok(await evalJS(`document.querySelector('.md-cloud-panel').textContent.includes('0 B · 空文件')`));await mkdir('/private/tmp/md2pdf-cloud-sidebar',{recursive:true});await writeFile('/private/tmp/md2pdf-cloud-sidebar/node-desktop.png',Buffer.from((await browser.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const cas=await evalJS(`(async()=>{const s=mdDrafts.store;const original=await s.active();await s.activateIf(original,undefined);const absent=await s.active();const saved=await s.save({id:'cas-test',md:'test',opts:{},version:0},{activate:false});const stillAbsent=await s.active();const first=await s.activateIf(undefined,saved.id);await s.activate('other-tab');const prevented=await s.activateIf(saved.id,original);const other=await s.active();await s.activate(null);const nullResult=await s.activateIf(null,saved.id);await s.save({id:'default-test',md:'test',opts:{},version:0});const normal=await s.active();await s.activate(original);return {absent:absent===undefined,stillAbsent:stillAbsent===undefined,first,prevented,other,nullResult,normal};})()`);
 assert.deepEqual(cas,{absent:true,stillAbsent:true,first:true,prevented:false,other:'other-tab',nullResult:true,normal:'default-test'});
 await evalJS(`(async()=>{mdEditor.setValue('# 本地草稿');await mdDrafts.flush();window.beforeRace={id:mdDrafts.current(),text:mdEditor.getValue()};const store=mdDrafts.store,original=store.save.bind(store);window.raceGuard=true;store.save=async(...args)=>{const result=await original(...args);if(args[1]?.activate===false)await new Promise(resolve=>window.releaseRace=resolve);return result};window.raceResult=mdDrafts.openFile('# 迟到云端','late.md',()=>window.raceGuard).catch(e=>e.name);})()`);
 await wait('window.releaseRace');await evalJS('window.raceGuard=false;window.releaseRace()');assert.equal(await evalJS('window.raceResult'),'AbortError');
 assert.deepEqual(await evalJS(`(async()=>({id:mdDrafts.current(),active:await mdDrafts.store.active(),text:mdEditor.getValue()}))()`),{id:await evalJS('beforeRace.id'),active:await evalJS('beforeRace.id'),text:'# 本地草稿'});
 await evalJS(`window.folderTest=true;document.querySelector('.md-cloud-icon-button[aria-label="刷新"]').click()`);
 await wait(`document.querySelector('[data-cloud-id="sub"]')`);
 await evalJS(`document.querySelector('[data-cloud-id="sub"]').click()`);await wait(`document.querySelector('[data-cloud-id="nested"]')`);
 assert.ok(await evalJS(`document.querySelector('.md-cloud-panel').textContent.includes('项目')`));
 await evalJS(`[...document.querySelectorAll('.md-cloud-crumb')].find(x=>x.textContent==='md2pdf').click()`);await wait(`document.querySelector('[data-cloud-id="sub"]')`);
 await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:568,deviceScaleFactor:1,mobile:true}); await new Promise(resolve=>setTimeout(resolve,200));
 await writeFile('/private/tmp/md2pdf-cloud-sidebar/node-mobile.png',Buffer.from((await browser.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 assert.ok(await evalJS('document.documentElement.scrollWidth <= innerWidth'));
 console.log('OneDrive sidebar Node connection and screenshots passed');
}finally{await browser.stop();await app.close();await rm(temp,{recursive:true,force:true});}
