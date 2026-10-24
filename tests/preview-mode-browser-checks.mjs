import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.mjs';
import {Chrome,findChrome} from '../src/chrome.mjs';
const app=process.argv[2]?null:createApp();
const temp=await mkdtemp(path.join(os.tmpdir(),'md2pdf-preview-mode-'));
const browser=new Chrome(findChrome(),temp);
try {
  if(app) await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const url=process.argv[2]||`http://127.0.0.1:${app.server.address().port}`;
  await browser.start();
  const send=(method,params,sessionId)=>{
    if(!sessionId)return browser.send(method,params);
    const id=++browser.id;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error(method+' timeout')),40000);
      browser.pending.set(id,{resolve:message=>{clearTimeout(timer);message.error?reject(new Error(message.error.message)):resolve(message.result)},reject});
      browser.ws.send(JSON.stringify({id,method,params,sessionId}));
    });
  };
  const evaluate=async(expression,sessionId)=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
    assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait=async(expression,sessionId)=>{
    console.log('waiting:',expression);
    for(let n=0;n<300;n++){
      if(await evaluate(`Boolean(${expression})`,sessionId))return;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('timeout: '+expression);
  };
  const frameSession=async()=>{
    for(const target of (await browser.send('Target.getTargets')).targetInfos.filter(t=>t.type==='iframe')){
      const {sessionId}=await browser.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
      if(await evaluate(`typeof window.__md2pdfPreviewSnapshot==='function'`,sessionId))return sessionId;
      await browser.send('Target.detachFromTarget',{sessionId});
    }
    assert.fail('preview frame missing: '+JSON.stringify((await browser.send('Target.getTargets')).targetInfos.map(t=>({type:t.type,url:t.url}))));
  };
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.navigate',{url});
  await wait('window.mdEditor && document.querySelector("[data-preview-mode-toggle]")');
  assert.equal(await evaluate(`document.querySelector('[data-preview-mode-toggle]').getAttribute('aria-pressed')`),'false');
  assert.equal(await evaluate(`document.querySelector('[data-orientation-toggle]').closest('.toolbar-field').nextElementSibling.querySelector('[data-preview-mode-toggle]')!==null`),true);
  const md='---\ntoc: true\n---\n# Flow fixture\n\n## First section\n\nText with $x^2$ and [jump](#last).\n\n```mermaid\ngraph LR\n A-->B\n```\n\n| Name | Value |\n| --- | --- |\n| Alpha | 1 |\n\n'+Array.from({length:70},(_,i)=>'Paragraph '+i+' unique continuous content. '.repeat(6)).join('\n\n')+'\n\n## Last section\n\nLast paragraph END_MARKER.';
  await evaluate(`mdEditor.setValue(${JSON.stringify(md)})`);
  await wait('document.querySelector("#preview").srcdoc.includes("END_MARKER") && window.__MD2PDF_PREVIEW_READY__===true && document.querySelector("#status").textContent.includes("预览已更新")');
  let session=await frameSession();
  assert.ok(await evaluate(`document.querySelectorAll('.pagedjs_page').length>1`,session));
  await evaluate(`window.modeRequestCount=0;const original=window.fetch;window.fetch=function(...args){if(String(args[0]).includes('/api/'))window.modeRequestCount++;return original.apply(this,args)}`);
  await evaluate(`document.querySelector('[data-preview-mode-toggle]').click();document.querySelector('#preview-outline-toggle').click()`);
  await wait(`document.documentElement.classList.contains('md2pdf-preview-flow')`,session);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.pagedjs_pages')).display`,session),'none');
  const flow=await evaluate(`(()=>{const root=document.querySelector('#md2pdf-preview-flow');return {text:root.textContent,main:root.querySelectorAll('main').length,tables:root.querySelectorAll('table').length,formula:root.querySelectorAll('mjx-container').length,diagrams:root.querySelectorAll('.mermaid svg,pre svg').length,pages:root.querySelectorAll('.pagedjs_page').length,markers:Array.from(root.querySelectorAll('[marker-end]'),e=>e.getAttribute('marker-end')),visible:getComputedStyle(root).display!=='none'}})()`,session);
  assert.ok(flow.visible&&flow.main===1&&flow.tables===1&&flow.formula>0&&flow.diagrams>0&&flow.pages===0,JSON.stringify({...flow,text:flow.text.slice(0,160)}));
  assert.equal(flow.text.split('END_MARKER').length-1,1);
  assert.ok(flow.markers.length>0 && flow.markers.every(value=>value.includes('#md2pdf-flow-')),JSON.stringify(flow.markers));
  const screenshot=await browser.send('Page.captureScreenshot',{format:'png'});
  await writeFile(path.join(os.tmpdir(),'md2pdf-flow-preview.png'),Buffer.from(screenshot.data,'base64'));
  for(let i=0;i<70;i++)assert.equal(flow.text.split('Paragraph '+i+' unique').length-1,1);
  await wait(`document.querySelectorAll('#preview-outline button[data-outline-index]').length===3`);
  await evaluate(`document.querySelector('#preview-outline button[data-outline-index="2"]').click()`);
  await wait(`Array.from(document.querySelectorAll('#md2pdf-preview-flow h2')).at(-1).getBoundingClientRect().top<innerHeight`,session);
  await evaluate(`document.querySelector('#md2pdf-preview-flow .toc a').click()`,session);
  await wait(`(()=>{const root=document.querySelector('#md2pdf-preview-flow'),a=root.querySelector('.toc a'),hit=root.querySelector('.md2pdf-preview-target');return hit && hit.id===decodeURIComponent(a.getAttribute('href').slice(1))})()`,session);
  await evaluate(`document.querySelector('[data-preview-mode-toggle]').click()`);
  await wait(`!document.documentElement.classList.contains('md2pdf-preview-flow')`,session);
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.pagedjs_pages')).display`,session),'none');
  assert.equal(await evaluate('window.modeRequestCount'),0,'view mode does not request or mutate rendering options');
  assert.equal(await evaluate(`document.querySelectorAll('.md-preview-thumbnails iframe').length`),0);
  await evaluate(`document.querySelector('[data-preview-mode-toggle]').click();document.querySelector('#preview-outline-tab-thumbnails').click()`);
  await wait(`!document.documentElement.classList.contains('md2pdf-preview-flow')`,session);
  await wait(`document.querySelectorAll('.md-preview-thumbnails iframe').length===1`);
  let thumbnailSession;
  for(let attempt=0;attempt<100&&!thumbnailSession;attempt++){
    for(const target of (await browser.send('Target.getTargets')).targetInfos.filter(t=>t.type==='iframe')){
      const attached=await browser.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
      if(await evaluate(`!!document.querySelector('#pages')`,attached.sessionId)){thumbnailSession=attached.sessionId;break;}
      await browser.send('Target.detachFromTarget',{sessionId:attached.sessionId});
    }
    if(!thumbnailSession)await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(thumbnailSession,'thumbnail frame available');
  await wait(`document.querySelectorAll('.page-copy .pagedjs_page').length>0`,thumbnailSession);
  assert.ok(await evaluate(`document.querySelectorAll('.thumbnail').length>1&&document.querySelectorAll('.page-copy .pagedjs_page').length<=12`,thumbnailSession));
  await evaluate(`document.querySelectorAll('.thumbnail')[1].click()`,thumbnailSession);
  await wait(`Math.abs(document.querySelectorAll('.pagedjs_pages > .pagedjs_page')[1].getBoundingClientRect().top)<50`,session);
  const thumbnailScreenshot=await browser.send('Page.captureScreenshot',{format:'png'});
  await writeFile(path.join(os.tmpdir(),'md2pdf-thumbnails-preview.png'),Buffer.from(thumbnailScreenshot.data,'base64'));
  await evaluate(`document.querySelector('#preview-outline-tab-outline').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.md-preview-thumbnails iframe').length`),0);
  assert.equal(await evaluate('window.modeRequestCount'),0,'thumbnails reuse pagination without rendering requests');
  await evaluate(`document.querySelector('[data-preview-mode-toggle]').click();mdEditor.setValue(${JSON.stringify(md+'\n\nEDIT_MARKER')})`);
  await wait('window.__MD2PDF_PREVIEW_READY__===true && document.querySelector("#status").textContent.includes("预览已更新")');
  await browser.send('Target.detachFromTarget',{sessionId:session});
  session=await frameSession();
  await wait(`document.documentElement.classList.contains('md2pdf-preview-flow')&&document.querySelector('#md2pdf-preview-flow').textContent.includes('EDIT_MARKER')`,session);
  // A stale revision cannot switch the active mode.
  await evaluate(`document.querySelector('#preview').contentWindow.postMessage({type:'md2pdf-preview-mode',mode:'paged',revision:-1},'*')`);
  await evaluate(`new Promise(resolve=>setTimeout(resolve,100))`);
  assert.equal(await evaluate(`document.documentElement.classList.contains('md2pdf-preview-flow')`,session),true);
  // Flow presentation is screen-only; printing retains paginated output.
  await send('Emulation.setEmulatedMedia',{media:'print'},session);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#md2pdf-preview-flow')).display`,session),'none');
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.pagedjs_pages')).display`,session),'none');
  await send('Emulation.setEmulatedMedia',{media:''},session);
  await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  assert.deepEqual(await evaluate(`['#analytics-slot','.app-bottom-center','#app-version'].map(selector=>{const s=getComputedStyle(document.querySelector(selector));return [s.gridColumnStart,s.gridRowStart]})`),[['1','1'],['1','2'],['1','3']]);
  console.log('PASS: default pagination, continuous original content/math/diagrams, links/outline, mode persistence, stale revision, print isolation, stacked footer');
}finally{
  await browser.stop();
  if(app)await app.close();
  await rm(temp,{recursive:true,force:true});
}
