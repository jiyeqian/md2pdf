import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Chrome, findChrome } from '../src/chrome.mjs';
import { render } from '../src/render.mjs';
import { prepareGbBodyLayout, finalizeGbBodyLayout } from '../src/gb-body-layout.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(),'gb-body-ink-'));
const chrome = new Chrome(findChrome(),temp);
try {
  const md = await readFile(new URL('./fixtures/gb-ef.md',import.meta.url),'utf8');
  const result = await render(md,{type:'gb',pagedHtml:true},{webSafe:false});
  let html = result.pagedHtml;
  if (!html.includes('function prepareGbBodyLayout(')) {
    html = html.replace('function prepareGbLayout()', `${prepareGbBodyLayout}\n${finalizeGbBodyLayout}\nfunction prepareGbLayout()`)
      .replace('      prepareGbLayout();','      prepareGbLayout(); prepareGbBodyLayout("GB/T 39999—2026");')
      .replace('finalizeGbLayout("GB/T 39999—2026");','finalizeGbLayout("GB/T 39999—2026"); finalizeGbBodyLayout();');
  }
  const htmlPath = path.join(temp,'document.html');
  await writeFile(htmlPath,html);
  await chrome.start();
  await chrome.print(htmlPath,{...result.printOptions,waitPaged:true});
  const response = await chrome.send('Runtime.evaluate',{returnByValue:true,expression:`(() => {
    const mm = n => n*96/25.4;
    const ctx = document.createElement('canvas').getContext('2d');
    const segments = new Intl.Segmenter(undefined,{granularity:'grapheme'});
    const ink = (element, page) => {
      if (!element) return null;
      const box = page.querySelector('.pagedjs_pagebox').getBoundingClientRect();
      const sx = box.width/mm(210), sy = box.height/mm(297), bounds = [];
      const walker = document.createTreeWalker(element,NodeFilter.SHOW_TEXT), nodes = [];
      while (walker.nextNode()) if (walker.currentNode.data.trim()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const style = getComputedStyle(node.parentElement);
        ctx.font = style.fontStyle+' '+style.fontWeight+' '+(parseFloat(style.fontSize)*32)+'px '+style.fontFamily;
        const marker = document.createElement('span'); marker.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline;font-size:0;line-height:0;'; node.after(marker);
        const runs=[];
        for (const {segment,index} of segments.segment(node.data)) { if (!segment.trim()) continue; const r=document.createRange();r.setStart(node,index);r.setEnd(node,index+segment.length);const rect=r.getBoundingClientRect();if(rect.width&&rect.height) runs.push({segment,rect}); }
        if (runs.length) { const base=(marker.getBoundingClientRect().top-box.top)/sy, last=runs.at(-1).rect.top;
          for(const {segment,rect} of runs) {const m=ctx.measureText(segment), x=(rect.left-box.left)/sx,y=base+(rect.top-last)/sy;bounds.push({left:x-m.actualBoundingBoxLeft/32,right:x+m.actualBoundingBoxRight/32,top:y-m.actualBoundingBoxAscent/32,bottom:y+m.actualBoundingBoxDescent/32});} }
        marker.remove();
      }
      return bounds.length ? {left:Math.min(...bounds.map(b=>b.left)),right:Math.max(...bounds.map(b=>b.right)),top:Math.min(...bounds.map(b=>b.top)),bottom:Math.max(...bounds.map(b=>b.bottom))} : null;
    };
    const pages=[...document.querySelectorAll('.pagedjs_page')];
    const labels=pages.filter(p=>p.querySelector('.gb-fixed-page-number')).map(p=>({right:p.classList.contains('pagedjs_right_page'),header:ink(p.querySelector('.gb-fixed-header'),p),footer:ink(p.querySelector('.gb-fixed-page-number'),p)}));
    const selectors=['.toc-title','h2.front','h2.back','h2.appendix','.gb-body-title'];
    const headings=selectors.flatMap(s=>[...document.querySelectorAll('.pagedjs_pages '+s)].map(title=>{const p=title.closest('.pagedjs_page');const h=title.closest('h2')||title; const next=title.matches('.gb-body-title')? h.querySelector('.gb-important, .gb-first-heading'):title.matches('.toc-title')?title.parentElement.querySelector('ol li'):h.nextElementSibling; return {type:s,header:ink(p.querySelector('.gb-fixed-header'),p),title:ink(title,p),next:ink(next,p)};}));
    return {error:window.__md2pdfPagedError,labels,headings};
  })()`});
  assert.equal(response.exceptionDetails,undefined,JSON.stringify(response.exceptionDetails));
  const {error,labels,headings}=response.result.value;
  assert.ok(!error,error);
  const near=(value,expected,label)=>assert.ok(Math.abs(value-expected)<1.5,`${label}: ${value}, expected ${expected}`);
  const mm=n=>n*96/25.4;
  assert.ok(labels.length>2);
  for (const {right,header,footer} of labels) {
    near(header.top,mm(25),'header top'); near(right?header.right:header.left,mm(right?190:20),'header outer edge');
    near(footer.bottom,mm(277),'footer bottom'); near(right?footer.right:footer.left,mm(right?186:24),'footer outer edge');
  }
  assert.ok(headings.length>=5);
  for (const {type,header,title,next} of headings) {
    assert.ok(header&&title,`${type} ink`);
    near(title.top-header.bottom,mm(15),`${type} header gap`);
    if(next) near(next.top-title.bottom,mm(type==='h2.back'||type==='h2.appendix'?5:12),`${type} content gap`);
  }
  console.log(`GB body ink: ${labels.length} page labels and ${headings.length} headings checked`);
} finally { await chrome.stop(); await rm(temp,{recursive:true,force:true}); }
