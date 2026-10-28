import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile, mkdtemp} from 'node:fs/promises';
import {Chrome, findChrome} from '../src/chrome.mjs';
const root=new URL('../',import.meta.url);
const model=JSON.parse(await readFile(new URL('docs/gb-logo-parametric-model.json',root)));
const svg=await readFile(new URL('assets/candidates/gb-logo-parametric.svg',root),'utf8');
assert.ok(!svg.includes('#fff')&&!/<(?:image|text|mask)\b/.test(svg),'only black ink and real transparent cutouts');
assert.deepEqual([...new Set([...svg.matchAll(/stroke-width="([^"]+)"/g)].map(m=>+m[1]))].sort((a,b)=>a-b),[model.lineWidth,2*model.lineWidth]);
assert.ok(!svg.includes('miter'),'no miter extrusion');
assert.ok(svg.includes('stroke-linecap="butt"')&&svg.includes('data-junction'),'explicit flat-capped edges and junction polygons');
assert.equal(new Set([...svg.matchAll(/\br="([^"]+)"/g)].map(m=>m[1])).size,1);
assert.ok(!model.dots,'dots must come from equations, not recorded individual coordinates');
for(const j of model.junctions){
  for(const index of j.facets){
    const tokens=model.facets[index].match(/[MLHVCZ]|-?(?:\d*\.\d+|\d+)/g);
    const points=[];let x=0,y=0;
    for(let k=0;k<tokens.length;){
      const c=tokens[k++];
      if(c==='M'||c==='L'){x=+tokens[k++];y=+tokens[k++];}
      else if(c==='H')x=+tokens[k++];
      else if(c==='V')y=+tokens[k++];
      else if(c==='C'){k+=4;x=+tokens[k++];y=+tokens[k++];}
      else continue;
      points.push([x,y]);
    }
    assert.ok(points.some(p=>Math.abs(p[0]-j.point[0])<1e-5&&Math.abs(p[1]-j.point[1])<1e-5),j.name);
  }
}
execFileSync('python3',['scripts/build-gb-logo-parametric.py','--svg','/private/tmp/gb-parametric-reproduced.svg']);
assert.equal(svg,await readFile('/private/tmp/gb-parametric-reproduced.svg','utf8'));
const chrome=new Chrome(findChrome(),await mkdtemp('/private/tmp/gb-parametric-'));
try{
 await chrome.start();
 const tree=await chrome.send('Page.getFrameTree');
 async function capture(content,name,scale=1,background='white'){
  await chrome.send('Emulation.setDeviceMetricsOverride',{width:948,height:474,deviceScaleFactor:scale,mobile:false});
  await chrome.send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html:`<style>html,body{margin:0;background:${background}}svg{display:block;width:948px;height:474px}</style>${content}`});
  const shot=await chrome.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:948,height:474,scale:1}});
  await writeFile(name,Buffer.from(shot.data,'base64'));
 }
 if(process.argv.includes('--sweep')){
  const results=[];
  for(const width of [2,2.5,3,3.5,4])for(const radius of [2.5,2.75,3]){
   const m={...model,lineWidth:width,circleRadius:radius};
   await writeFile('/private/tmp/gb-parametric-sweep.json',JSON.stringify(m));
   execFileSync('python3',['scripts/build-gb-logo-parametric.py','--model','/private/tmp/gb-parametric-sweep.json','--svg','/private/tmp/gb-parametric-sweep.svg']);
   await capture(await readFile('/private/tmp/gb-parametric-sweep.svg','utf8'),'/private/tmp/gb-parametric-sweep.png');
   const score=+execFileSync('/Users/jiyeqian/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',['-c',`from PIL import Image;import numpy as np;a=np.array(Image.open('/private/tmp/gb-logo-reference.png').convert('L'))<128;b=np.array(Image.open('/private/tmp/gb-parametric-sweep.png').convert('L'))<128;print((a&b).sum()/(a|b).sum())`]).toString();
   results.push({width,radius,iou:score});
  }
  await writeFile('docs/gb-logo-parametric-sweep.json',JSON.stringify(results,null,2)+'\n');
  console.log(results.sort((a,b)=>b.iou-a.iou).slice(0,5));
 }
 await capture(svg,'/private/tmp/gb-logo-parametric.png');
 await capture(svg,'/private/tmp/gb-logo-parametric-4x.png',4);
 await capture(await readFile(new URL('assets/candidates/gb-logo-parametric-v2.svg',root),'utf8'),'/private/tmp/gb-logo-parametric-v2-4x.png',4);
 await capture(svg,'/private/tmp/gb-logo-parametric-background.png',1,'#24b8c8');
 await capture(`<svg viewBox="0 0 948 474">${model.silhouettes.map(d=>`<path d="${d}"/>`).join('')}</svg>`,'/private/tmp/gb-logo-silhouette-4x.png',4);
 await capture(`<svg viewBox="0 0 948 474">${model.facets.map(d=>`<path d="${d}"/>`).join('')}</svg>`,'/private/tmp/gb-logo-faces-4x.png',4);
 await capture(`<svg viewBox="0 0 948 474">${model.counters.map(d=>`<path d="${d}"/>`).join('')}</svg>`,'/private/tmp/gb-logo-holes-4x.png',4);
 console.log('PASS: deterministic equations, uniform stroke/radius, shared junctions, black-only transparent SVG; rendered at 1x/4x and colored background');
}finally{await chrome.stop()}
