import assert from 'node:assert/strict';
import { readFile,writeFile,mkdtemp,mkdir,rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { Chrome,findChrome } from '../src/chrome.mjs';
const artifact='/private/tmp/md2pdf-onedrive-images';await mkdir(artifact,{recursive:true});
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAIAAADmAupWAAAASklEQVR4nO3PAQkAMAzAsGmafwGXdRmHPlABzZzdr5rnB8DAwMDAwMDfBFwPuB5wPeB6wPWA6wHXA64HXA+4HnA94HrA9YDrAde7GxOm080g+C4AAAAASUVORK5CYII=';
const body={md:'# Cloud image\n\n![hello image](images/helloworld.jpeg)',opts:{type:'general'},imageAssets:{'images/helloworld.jpeg':png}};
const app=createApp(),temp=await mkdtemp(path.join(os.tmpdir(),'md2pdf-image-export-')),browser=new Chrome(findChrome(),temp);
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>String(input).startsWith('file:')?new Response(await readFile(new URL(input))):nativeFetch(input,init);
try {
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));await browser.start();
 const request=(route,payload)=>nativeFetch(`http://127.0.0.1:${app.server.address().port}${route}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
 const runtime=await import(pathToFileURL(path.resolve('dist/static/runtime.mjs')).href);
 const nodePreview=await request('/api/render',body);assert.equal(nodePreview.status,200);
 const previewHtml=(await nodePreview.json()).html;assert.ok(previewHtml.includes(png));
 const nodePrint=await request('/api/render',{...body,printDocument:true});assert.equal(nodePrint.status,200);
 const nodeHtml=(await nodePrint.json()).html;
 const staticPreview=await runtime.renderDocument(body,true);assert.ok(staticPreview.html.includes(png));
 const staticPrint=await runtime.renderDocument(body,false);
 for(const [name,html]of [['node-print',nodeHtml],['static-print',staticPrint.html]]) {
  assert.ok(html.includes(png));
  const pdf=await browser.printHtml(html,{webSafe:true,waitPaged:true});await writeFile(`${artifact}/${name}.pdf`,pdf);
  const state=await browser.send('Runtime.evaluate',{expression:`(()=>{const image=[...document.images].find(x=>x.alt==='hello image');return image && {loaded:image.complete,width:image.naturalWidth,src:image.src}})()`,returnByValue:true});
  assert.equal(state.result.value?.loaded,true);assert.equal(state.result.value?.width,80);assert.equal(state.result.value?.src,png);
  const list=execFileSync('pdfimages',['-list',`${artifact}/${name}.pdf`],{encoding:'utf8'});assert.match(list,/\bimage\b/,'printed PDF must contain an image object');
  const screenshot=await browser.send('Page.captureScreenshot',{format:'png'});await writeFile(`${artifact}/${name}.png`,Buffer.from(screenshot.data,'base64'));
 }
 const pdf=await request('/api/pdf',body);assert.equal(pdf.status,200);await writeFile(`${artifact}/node-download.pdf`,Buffer.from(await pdf.arrayBuffer()));
 assert.match(execFileSync('pdfimages',['-list',`${artifact}/node-download.pdf`],{encoding:'utf8'}),/\bimage\b/);
 console.log('PASS: Node/static preview and print decode the same image; Node PDF download and both printed PDFs contain images. Artifacts: '+artifact);
} finally {globalThis.fetch=nativeFetch;await browser.stop();await app.close();await rm(temp,{recursive:true,force:true});}
