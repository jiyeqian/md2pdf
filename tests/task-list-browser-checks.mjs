import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';
import { buildStatic } from '../src/static-build.mjs';

const md = '# 任务列表对齐\n\n保留原有主题的列表样式。\n\n## 列表\n\n- 普通无序\n- [x] 完成任务\n- [ ] 未完成任务\n\n1. 普通有序\n2. [x] 有序任务\n\n- 嵌套父项\n  - 嵌套普通\n  - [ ] 嵌套任务\n\n- [ ] 多段任务\n\n  任务的第二段。\n';
const out = path.join(os.tmpdir(), 'md2pdf-task-list-review');
const temp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-tasks-'));
const app = createApp();
const browser = new Chrome(findChrome(), temp);
const nativeFetch = globalThis.fetch;
try {
  await mkdir(out, {recursive:true});
  const build = await buildStatic();
  globalThis.fetch = async (input, init) => { const url=new URL(input); return url.protocol==='file:' ? new Response(await readFile(url)) : nativeFetch(input,init); };
  const staticRuntime = await import(pathToFileURL(path.join(build.directory, 'runtime.mjs')));
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const base = `http://127.0.0.1:${app.server.address().port}`;
  await browser.start();
  await browser.send('Emulation.setDeviceMetricsOverride',{width:820,height:1200,deviceScaleFactor:1,mobile:false});
  for (const type of ['general','paper','skill','gb']) for (const theme of type==='gb'?['gb']:['elegant','minimal']) {
    const body={md,opts:{type,...(type==='gb'?{}:{theme}),toc:false}};
    const response=await nativeFetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(response.status,200,response.ok ? undefined : await response.text());
    const online=await response.json();
    const offline=await(await staticRuntime.appFetch('/api/render',{body:JSON.stringify(body)})).json();
    const normalize=html=>html.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}/g,'GENERATED_AT');
    assert.equal(normalize(offline.html),normalize(online.html));
    const pdf=await browser.printHtml(online.html,{webSafe:true,waitPaged:true,outline:true});
    const result=await browser.send('Runtime.evaluate',{returnByValue:true,awaitPromise:true,expression:`new Promise(resolve=>{const check=()=>{if(!document.getElementById('md2pdf-preview-screen'))return setTimeout(check,50);const root=document.querySelector('.pagedjs_pages'),find=text=>Array.from(root.querySelectorAll('li')).find(li=>li.textContent.trim().startsWith(text)),left=text=>{const li=find(text),walker=document.createTreeWalker(li,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const index=node.textContent.indexOf(text);if(index>=0){const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+1);return range.getBoundingClientRect().left;}}},tasks=Array.from(root.querySelectorAll('input[type=checkbox]'));resolve({lefts:['普通无序','完成任务','未完成任务','普通有序','有序任务','多段任务'].map(left),nested:[left('嵌套普通'),left('嵌套任务')],checks:tasks.length,checked:tasks.filter(input=>input.checked).length,markers:tasks.map(input=>{const li=input.closest('li');return [getComputedStyle(li).listStyleType,getComputedStyle(li,'::before').display]})});};check();})`});
    assert.equal(result.exceptionDetails,undefined);
    const metrics=result.result.value;
    assert.equal(metrics.checks,5);
    assert.equal(metrics.checked,2);
    assert.ok(Math.max(...metrics.lefts)-Math.min(...metrics.lefts)<1,`${type}/${theme}: ${JSON.stringify(metrics)}`);
    assert.ok(Math.abs(metrics.nested[0]-metrics.nested[1])<1);
    assert.ok(metrics.markers.every(([style,display])=>style==='none'&&display==='none'));
    const clip=await browser.send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const r=document.querySelector('.pagedjs_pages input[type=checkbox]').closest('.pagedjs_page').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()`});
    const shot=await browser.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:clip.result.value});
    await writeFile(path.join(out,`${type}-${theme}.png`),Buffer.from(shot.data,'base64'));
    await writeFile(path.join(out,`${type}-${theme}.pdf`),pdf);
    console.log(`${type}/${theme}: task markers, text alignment, nesting, paragraphs, server/static parity and PDF passed`);
  }
  console.log(`Review artifacts: ${out}`);
} finally {
  globalThis.fetch=nativeFetch;
  await browser.stop();
  await app.close();
  await rm(temp,{recursive:true,force:true});
}
