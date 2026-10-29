// Regenerate after changing examples, templates, fonts, or rendering code.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';

const args=process.argv.slice(2);
if(args.length&&(args.length!==2||args[0]!=='--type'||!['general','paper','gb','skill'].includes(args[1])))throw new Error('用法：node scripts/generate-template-previews.mjs [--type gb]');
const selectedType=args[1];
const output = fileURLToPath(new URL('../web/template-previews/', import.meta.url));
const temp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-snapshots-'));
const app = createApp();
const browser = new Chrome(findChrome(), temp);
try {
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  await mkdir(output, { recursive: true });
  await browser.start();
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 1200, deviceScaleFactor: 1, mobile: false });
  const { examples } = await (await fetch(base + '/api/examples')).json();
  for (const example of examples.filter(example=>!selectedType||example.type===selectedType)) {
    const { md } = await (await fetch(base + '/api/example?id=' + encodeURIComponent(example.id))).json();
    const response = await fetch(base + '/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ md, opts: { type: example.type } }) });
    if (!response.ok) throw new Error(`Render failed: ${example.id}`);
    const { html } = await response.json();
    await browser.printHtml(html, { webSafe: true });
    const ready = await browser.send('Runtime.evaluate', { expression: `new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{if(window.__md2pdfMermaidError||window.__md2pdfPagedError){clearInterval(timer);reject(new Error('Preview rendering failed'));}else if(window.__md2pdfMathReady!==false&&window.__md2pdfMermaidReady!==false&&window.__md2pdfPagedReady!==false&&document.querySelector('.pagedjs_page')){clearInterval(timer);document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}else if(Date.now()-started>30000){clearInterval(timer);reject(new Error('Preview timeout'));}},100);})`, awaitPromise: true });
    if (ready.exceptionDetails) throw new Error(JSON.stringify(ready.exceptionDetails));
    const geometry = await browser.send('Runtime.evaluate', { expression: `(()=>{const page=document.querySelector('.pagedjs_page');if(!page)throw new Error('Missing first page');const r=page.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()`, returnByValue: true });
    if (geometry.exceptionDetails) throw new Error(JSON.stringify(geometry.exceptionDetails));
    const shot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: geometry.result.value });
    await writeFile(path.join(output, example.id + '.png'), Buffer.from(shot.data, 'base64'));
    console.log(`Saved ${example.id}.png`);
  }
} finally {
  await browser.stop();
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
