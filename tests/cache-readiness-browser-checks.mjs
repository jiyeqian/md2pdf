import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';

const app=createApp();
const dir=await mkdtemp(path.join(os.tmpdir(),'md2pdf-cache-gate-'));
const browser=new Chrome(findChrome(),dir);
try{
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  await browser.start();
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(top===window){window.previewRequests=[];const nativeFetch=window.fetch.bind(window);window.fetch=(input,init)=>{if(['/api/preview','/api/render','/api/resolve'].includes(String(input)))previewRequests.push(String(input));return nativeFetch(input,init)}}`});
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.timeline=[];window.measureStart=null;const mark=name=>window.timeline.push({name,at:performance.now(),visible:document.visibilityState==='visible',iframe:(()=>{const r=document.querySelector('#preview')?.getBoundingClientRect();return r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right,intersects: r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}:null})()});window.addEventListener('md-app-ready',()=>mark('app-ready'));window.addEventListener('md-preview-ready',()=>mark('preview-ready'));window.addEventListener('md-preview-error',()=>mark('preview-error'));const original=navigator.serviceWorker.register.bind(navigator.serviceWorker);navigator.serviceWorker.register=(...args)=>{mark('service-worker-register');return original(...args)};`});
  await browser.send('Page.navigate',{url:`http://127.0.0.1:${app.server.address().port}`});
  const evaluate=async expression=>{const result=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));return result.result.value;};
  for(let n=0;n<150;n++){if(await evaluate('window.__MD2PDF_APP_READY__===true'))break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(await evaluate('window.__MD2PDF_APP_READY__'),true,'application reaches ready before preview is measured');
  await evaluate('window.measureStart=performance.now();previewRequests.length=0');
  await evaluate(`mdEditor.setValue('# Node readiness');document.querySelector('#markdown').dispatchEvent(new Event('input',{bubbles:true}))`);
  for(let n=0;n<250;n++){
    if(await evaluate(`window.timeline?.some(item=>['preview-ready','preview-error'].includes(item.name)&&item.at>=window.measureStart)`))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const timeline=await evaluate('window.timeline');
  const measureStart=await evaluate('window.measureStart');
  const previewReady=timeline.find(item=>item.name==='preview-ready'&&item.at>=measureStart);
  const previewError=timeline.find(item=>item.name==='preview-error'&&item.at>=measureStart);
  const terminal=previewReady||previewError;
  const registration=timeline.find(item=>item.name==='service-worker-register');
  assert.ok(terminal,`Node preview must report a result in a visible desktop viewport: ${JSON.stringify(timeline)}`);
  assert.ok(previewReady,`normal Node preview must succeed: ${JSON.stringify(timeline)}`);
  assert.equal(previewReady.visible,true,JSON.stringify(timeline));
  assert.equal(previewReady.iframe?.intersects,true,`preview iframe must intersect 1440x1000 viewport: ${JSON.stringify(timeline)}`);
  assert.ok(registration&&registration.at>=terminal.at,JSON.stringify(timeline));
  assert.deepEqual(await evaluate('previewRequests'),['/api/preview'],'automatic editor sends one preview request and no resolve request');
  await evaluate(`Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))`);
  await evaluate('window.measureStart=performance.now()');
  await evaluate(`mdEditor.setValue('# Hidden then restored');document.querySelector('#markdown').dispatchEvent(new Event('input',{bubbles:true}))`);
  for(let n=0;n<100;n++){
    if(await evaluate(`document.querySelector('#preview').srcdoc.includes('Hidden then restored')`))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  await new Promise(resolve=>setTimeout(resolve,1200));
  assert.equal(await evaluate(`window.timeline.filter(item=>['preview-ready','preview-error'].includes(item.name)&&item.at>=window.measureStart).length`),0,'managed hidden preview stays paused until visible');
  assert.equal(await evaluate(`document.querySelector('#preview').srcdoc.includes('MD2PDF_PREVIEW_MANAGED = true;')`),true);
  await evaluate(`Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'))`);
  for(let n=0;n<150;n++){
    if(await evaluate(`window.timeline?.some(item=>['preview-ready','preview-error'].includes(item.name)&&item.at>=window.measureStart)`))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const recovery=await evaluate('window.timeline.filter(item=>item.at>=window.measureStart)');
  assert.ok(recovery.some(item=>item.name==='preview-ready'),`preview recovers after foregrounding: ${JSON.stringify(recovery)}`);
  assert.ok(!recovery.some(item=>item.name==='preview-error'),`background time must not produce a preview error: ${JSON.stringify(recovery)}`);
  const update = async expression => {
    await evaluate('window.measureStart=performance.now();previewRequests.length=0');
    await evaluate(expression);
    for(let n=0;n<150;n++){
      if(await evaluate(`window.timeline.some(item=>item.name==='preview-ready'&&item.at>=measureStart)`))return;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('policy-switch preview did not become ready');
  };
  await update(`document.querySelector('#options').elements.fontSize.value='12';mdEditor.setValue('---\\ntype: gb\\n---\\n# Standard');document.querySelector('#markdown').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.equal(await evaluate(`document.querySelector('#options').elements.fontSize.value`),'','new GB policy clears old numeric override');
  assert.match(await evaluate(`document.querySelector('#status').textContent`),/重置/,'reset is disclosed to the user');
  assert.deepEqual(await evaluate('previewRequests'),['/api/preview']);
  await update(`mdEditor.setValue('# General again');document.querySelector('#markdown').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.equal(await evaluate(`document.querySelector('#options').elements.fontSize.value`),'','returning to general does not restore a reset override');
  await update(`document.querySelector('#options').elements.type.value='paper';document.querySelector('#options').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.deepEqual(await evaluate('previewRequests'),['/api/render'],'explicit mode retains the strict render endpoint');
  const authors = '---\ntype: paper\nauthors:\n  - name: 甲\n    affiliations: [used]\naffiliations:\n  - id: used\n    text: 单位甲\n  - id: unused\n    text: 未引用单位\n---\n# Authors';
  await update(`document.querySelector('#options').elements.type.value='';mdEditor.setValue(${JSON.stringify(authors)});document.querySelector('#markdown').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.deepEqual(await evaluate('previewRequests'),['/api/preview'],'author diagnostics reuse the same preview response');
  assert.equal(await evaluate(`document.body.textContent.includes('未被任何作者引用')`),true,'professional assistant receives author diagnostics without a second resolve');
  const invalid = '---\nfont-size: null\n---\n# Invalid';
  await evaluate(`mdEditor.setValue(${JSON.stringify(invalid)});document.querySelector('#markdown').dispatchEvent(new Event('input',{bubbles:true}))`);
  for(let n=0;n<100;n++){
    if(await evaluate(`document.querySelector('#status').textContent.includes('配置无效')`))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(await evaluate(`document.body.textContent.includes('未被任何作者引用')`),false,'invalid current source cannot retain old author warnings');
  await update(`mdEditor.setValue(${JSON.stringify(authors)});mdEditor.setValue('# Fixed latest');document.querySelector('#markdown').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.deepEqual(await evaluate('previewRequests'),['/api/preview'],'rapid edits submit only the final document');
  assert.equal(await evaluate(`document.body.textContent.includes('未被任何作者引用')`),false,'old diagnostics do not reappear after correction and cancellation');
  await update(`mdEditor.setValue(${JSON.stringify(authors)});document.querySelector('#markdown').dispatchEvent(new Event('input',{bubbles:true}))`);
  await evaluate(`previewRequests.length=0;mdEditor.setValue('');document.querySelector('#markdown').dispatchEvent(new Event('input',{bubbles:true}));document.dispatchEvent(new CustomEvent('md-document-diagnostics',{detail:{source:${JSON.stringify(authors)},authorDiagnostics:[{message:'未被任何作者引用'}]}}))`);
  await new Promise(resolve=>setTimeout(resolve,700));
  assert.deepEqual(await evaluate('previewRequests'),[],'empty document does not submit a preview');
  assert.equal(await evaluate(`document.body.textContent.includes('未被任何作者引用')`),false,'empty document rejects stale-source diagnostic events');
  console.log('PASS Node visible preview, cache ordering, and hidden-to-visible recovery:',JSON.stringify({timeline:await evaluate('window.timeline'),previewMs:previewReady.at-timeline.find(item=>item.name==='app-ready').at,recovery}));
}finally{await browser.stop();await app.close();await rm(dir,{recursive:true,force:true});}
