import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Chrome, findChrome } from '../src/chrome.mjs';

const targets=[
  ['baseline-node',process.env.MD2PDF_BASELINE_NODE_URL||'http://127.0.0.1:3182/','node'],
  ['baseline-static',process.env.MD2PDF_BASELINE_STATIC_URL||'http://127.0.0.1:3183/','static'],
  ['candidate-node',process.env.MD2PDF_NODE_URL||'http://127.0.0.1:3190/','node'],
  ['candidate-static',process.env.MD2PDF_STATIC_URL||'http://127.0.0.1:3191/','static'],
];
const chromePath=findChrome();
const chromeVersion=spawnSync(chromePath,['--version'],{encoding:'utf8'}).stdout.trim();
const commit=execFileSync('git',['rev-parse','--short','HEAD'],{encoding:'utf8'}).trim();
const scenarios=[{name:'cold-visible-desktop',rounds:3,latency:0,download:-1,cpu:1},{name:'warm-visible-desktop',rounds:1,latency:0,download:-1,cpu:1},{name:'weak-visible-desktop',rounds:1,latency:150,download:750000,cpu:4}];
const samples=[];
async function sample(kind,url,runtime,scenario,round){
  const versionUrl=new URL(runtime==='node'?'api/version':'version-data.json',url).href;
  const versionResponse=await fetch(versionUrl);
  assert.equal(versionResponse.status,200,`${kind} version endpoint`);
  const version=await versionResponse.json();
  const targetCommit=version.commit||version.version?.commit||version.gitCommit||null;
  const dir=await mkdtemp(path.join(os.tmpdir(),'md2pdf-perf-'));
  const browser=new Chrome(findChrome(),dir);
  try{
    await browser.start();
    await browser.send('Network.enable');
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await browser.send('Emulation.setCPUThrottlingRate',{rate:scenario.cpu});
    if(scenario.latency||scenario.download>0)await browser.send('Network.emulateNetworkConditions',{offline:false,latency:scenario.latency,downloadThroughput:scenario.download,uploadThroughput:250000,connectionType:scenario.latency?'cellular3g':'none'});
    await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__perfEvents=[];for(const type of ['md-app-ready','md-preview-ready','md-preview-error','md2pdf-offline-ready'])addEventListener(type,event=>window.__perfEvents.push({type,at:performance.now(),ready:event.detail?.ready}));addEventListener('message',event=>{if(event.data?.type==='md2pdf-ready'||event.data?.type==='md2pdf-error')window.__perfEvents.push({type:event.data.type==='md2pdf-ready'?'md-preview-ready':'md-preview-error',at:performance.now(),source:'iframe-message'})});`});
    const evaluate=async expression=>{const response=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(response.exceptionDetails,undefined,JSON.stringify(response.exceptionDetails));return response.result.value;};
    const loadAndMeasure=async()=>{
      for(let i=0;i<450;i++){
        if(await evaluate('window.__perfEvents?.some(event=>event.type==="md-app-ready")||typeof window.mdEditor!=="undefined"'))break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      const appReady=await evaluate('window.__perfEvents.find(event=>event.type==="md-app-ready")|| (typeof window.mdEditor!=="undefined" ? {type:"mdEditor-ready-fallback",at:performance.now()} : null)');
      if(!appReady)return evaluate(`(()=>{const r=document.querySelector('#preview')?.getBoundingClientRect();return {appReadyMs:null,previewResult:'app-ready-timeout',previewEventMs:null,previewAfterInputMs:null,previewAfterAppReadyMs:null,visible:document.visibilityState==='visible',iframe:r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right,intersects:r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}:null}})()`);
      await evaluate(`window.mdEditor.setValue('# Performance sample\\n\\nPlain text.');document.querySelector('#markdown').dispatchEvent(new Event('input',{bubbles:true}))`);
      await evaluate('window.__previewMeasureStart=performance.now()');
      for(let i=0;i<200;i++){
        if(await evaluate('window.__perfEvents?.some(event=>event.type==="md-preview-ready"||event.type==="md-preview-error")&&window.__perfEvents.find(event=>event.type==="md-preview-ready"||event.type==="md-preview-error").at>=window.__previewMeasureStart'))break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      return evaluate(`(()=>{const events=window.__perfEvents,appReady=events.find(event=>event.type==='md-app-ready'),preview=events.find(event=>(event.type==='md-preview-ready'||event.type==='md-preview-error')&&event.at>=window.__previewMeasureStart),entries=performance.getEntriesByType('resource'),r=document.querySelector('#preview')?.getBoundingClientRect();return {appReadyMs:appReady?.at??null,previewResult:preview?.type||'timeout',previewEventMs:preview?.at??null,previewAfterInputMs:preview?preview.at-window.__previewMeasureStart:null,previewAfterAppReadyMs:preview&&appReady?preview.at-appReady.at:null,visible:document.visibilityState==='visible',iframe:r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right,intersects:r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}:null,resourceCount:entries.length,transferBytes:entries.reduce((sum,entry)=>sum+(entry.transferSize||0),0),decodedBytes:entries.reduce((sum,entry)=>sum+(entry.decodedBodySize||0),0)}})()`);
    };
    await browser.send('Page.navigate',{url});
    if(scenario.name==='warm-visible-desktop'){
      const first=await loadAndMeasure();
      if(first.previewResult!=='md-preview-ready')return {target:kind,runtime,targetCommit,scenario:scenario.name,round,warmupResult:first.previewResult,...first};
      for(let i=0;i<900;i++){
        if(await evaluate('window.__perfEvents?.some(event=>event.type==="md2pdf-offline-ready"&&event.ready===true)'))break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.ok(await evaluate('window.__perfEvents?.some(event=>event.type==="md2pdf-offline-ready"&&event.ready===true)'),`${kind} offline cache must be ready before warm reload`);
      await browser.send('Page.reload');
    }
    const result=await loadAndMeasure();
    if(result.previewResult!=='app-ready-timeout'){
      assert.equal(result.previewResult,'md-preview-ready',`${kind} ${scenario.name} preview should succeed; iframe=${JSON.stringify(result.iframe)}`);
      assert.equal(result.visible,true,`${kind} document must be foreground-visible`);
      assert.equal(result.iframe?.intersects,true,`${kind} iframe must intersect fixed 1440x1000 viewport`);
    }
    return {target:kind,runtime,targetCommit,scenario:scenario.name,round, ...result};
  }finally{await browser.stop();await rm(dir,{recursive:true,force:true});}
}
for(const [kind,url,runtime]of targets){
  for(const scenario of scenarios){
    for(let round=1;round<=scenario.rounds;round++){
      const result=await sample(kind,url,runtime,scenario,round);
      samples.push(result);
      console.log(JSON.stringify(result));
    }
  }
}
const output=path.resolve(process.env.MD2PDF_PERF_OUTPUT||'docs/performance-samples-2026-10-22.json');
await writeFile(output,JSON.stringify({date:'2026-10-22',runnerCommit:commit,viewport:{width:1440,height:1000,deviceScaleFactor:1,mobile:false},platform:`${process.platform} ${process.arch} ${os.release()}`,node:process.version,chrome:chromeVersion,targets:targets.map(([name,url,runtime])=>({name,url,runtime})),scenarios,samples},null,2)+'\n');
console.log(`Samples: ${output}`);
