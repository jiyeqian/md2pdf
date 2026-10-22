import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { render } from '../src/render.mjs';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';
import { buildStatic } from '../src/static-build.mjs';

const out = path.resolve(process.env.MD2PDF_ACCEPTANCE_DIR || path.join(os.tmpdir(), 'md2pdf-paper-authors-review'));
const temp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-authors-'));
const app = createApp();
const chrome = new Chrome(findChrome(), temp);
const nativeFetch = globalThis.fetch;
const normalize = html => html.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}/g,'GENERATED_AT');
const evaluate = async expression => {
  const result = await chrome.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
try {
  await mkdir(out,{recursive:true});
  const build = await buildStatic();
  globalThis.fetch = async (input,init) => { const url=new URL(input);return url.protocol==='file:'?new Response(await readFile(url)):nativeFetch(input,init); };
  const staticRuntime = await import(pathToFileURL(path.join(build.directory,'runtime.mjs')));
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const md=await readFile(new URL('../web/examples/paper.md',import.meta.url),'utf8');
  const unusedMd=md.replace('affiliations:\n', 'affiliations:\n  - id: unused\n    text: 未引用测试单位\n');
  const warningBody=JSON.stringify({md:unusedMd,opts:{}});
  const nodeWarnings=await(await nativeFetch(base+'/api/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:warningBody})).json();
  const staticWarnings=await(await staticRuntime.appFetch('/api/resolve',{body:warningBody})).json();
  assert.deepEqual(nodeWarnings,staticWarnings);
  assert.equal(nodeWarnings.authorDiagnostics.length,1);
  assert.match(nodeWarnings.authorDiagnostics[0].message,/未引用测试单位/);
  await chrome.start();
  await chrome.send('Emulation.setDeviceMetricsOverride',{width:820,height:1200,deviceScaleFactor:1,mobile:false});
  for (const theme of ['elegant','minimal']) {
    const opts={type:'paper',theme};
    const core=await render(md,{...opts,pagedHtml:true},{webSafe:true});
    const response=await nativeFetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({md,opts})});
    assert.equal(response.status,200);
    const online=await response.json();
    const offline=await(await staticRuntime.appFetch('/api/render',{body:JSON.stringify({md,opts})})).json();
    assert.equal(normalize(offline.html),normalize(online.html));
    const input=path.join(temp,'paper.md'),cliHtml=path.join(out,theme+'-cli.html');
    await writeFile(input,md);
    execFileSync(process.execPath,['src/md2pdf.mjs',input,'--html-only','--type','paper','--theme',theme,'--paged-html=','-o',cliHtml],{stdio:'pipe'});
    assert.equal(normalize((await readFile(cliHtml,'utf8')).replaceAll('&amp;','&')),normalize(core.pagedHtml.replaceAll('&amp;','&')));
    const pdf=await chrome.printHtml(online.html,{webSafe:true,waitPaged:true,outline:true});
    await evaluate(`new Promise(resolve=>{const check=()=>document.getElementById('md2pdf-preview-screen')?document.fonts.ready.then(resolve):setTimeout(check,50);check()})`);
    const authors=await evaluate(`(()=>{const root=document.querySelector('.pagedjs_pages'),block=root.querySelector('.authors');return {names:Array.from(block.querySelectorAll('.author-entry')).map(author=>author.textContent),units:Array.from(block.querySelectorAll('.affil')).map(unit=>unit.textContent),contact:block.querySelector('.correspondence').textContent,mark:getComputedStyle(block.querySelector('.author-mark')).verticalAlign,links:Array.from(block.querySelectorAll('a[href^="#"]')).every(link=>!!root.querySelector(link.getAttribute('href'))),email:block.querySelector('a[href^="mailto:"]').getAttribute('href'),page:block.closest('.pagedjs_page').getBoundingClientRect().top}})()`);
    assert.deepEqual(authors.names,['高松年1','朱千里2','赵辛楣3','方鸿渐3,4*']);
    assert.deepEqual(authors.units,['1 三闾大学机械工程系','2 北平国学专修社','3 三闾大学自动化研究所','4 克莱登大学机械工程系']);
    assert.equal(authors.contact,'* 通讯作者：方鸿渐（fanghongjian@clayton.edu）');
    assert.equal(authors.mark,'super');
    assert.equal(authors.links,true);
    assert.equal(authors.email,'mailto:fanghongjian@clayton.edu');
    const clip=await evaluate(`(()=>{const r=document.querySelector('.pagedjs_page').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()`);
    const shot=await chrome.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});
    await writeFile(path.join(out,theme+'.png'),Buffer.from(shot.data,'base64'));
    await writeFile(path.join(out,theme+'.pdf'),pdf);
    console.log(`${theme}: authors, affiliations, correspondence, links, CLI/server/static parity and PDF passed`);
  }
  for (const invalid of [md.replace('affiliations: [sanlu-automation]','affiliations: [missing]'),md.replace('authors:','author: 旧作者\nauthors:')]) {
    const body=JSON.stringify({md:invalid,opts:{type:'paper'}});
    const online=await nativeFetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body});
    const offline=await staticRuntime.appFetch('/api/render',{body});
    assert.equal(online.status,400);assert.equal(offline.status,400);
    assert.deepEqual(await online.json(),await offline.json());
    const input=path.join(temp,'invalid.md');await writeFile(input,invalid);
    assert.throws(()=>execFileSync(process.execPath,['src/md2pdf.mjs',input,'--html-only'],{stdio:'pipe'}),error=>error.status!==0&&/authors/.test(error.stderr.toString()));
  }
  console.log(`Review artifacts: ${out}`);
} finally {
  globalThis.fetch=nativeFetch;
  await chrome.stop();await app.close();await rm(temp,{recursive:true,force:true});
}
