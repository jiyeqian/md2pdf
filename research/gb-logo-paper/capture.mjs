// A single Chromium session keeps the SVG comparison renderer fixed.
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {Chrome,findChrome} from '../../src/chrome.mjs';
const jobs=JSON.parse(await readFile(new URL('./data/jobs.json',import.meta.url)));
const selected=process.argv.slice(2);
const pending=selected.length?jobs.filter(job=>selected.includes(job.name)):jobs;
const chrome=new Chrome(findChrome(),await mkdtemp('/private/tmp/gb-paper-chrome-'));
try {
 await chrome.start();
 const browser=await chrome.send('Browser.getVersion');
 await writeFile(new URL('./data/browser.json',import.meta.url),JSON.stringify(browser,null,2)+'\n');
 const tree=await chrome.send('Page.getFrameTree');
 for (const job of pending) {
  const svg=await readFile(job.svg,'utf8');
  const scale=job.scale||1;
  await chrome.send('Emulation.setDeviceMetricsOverride',{width:948,height:474,deviceScaleFactor:scale,mobile:false});
  await chrome.send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html:`<!DOCTYPE html><style>html,body{margin:0;background:${job.background||'white'}}svg{display:block;width:948px;height:474px}</style>${svg}`});
  // Force style/layout before capture; no time-based animation or remote fonts occur.
  await chrome.send('Runtime.evaluate',{expression:'document.documentElement.getBoundingClientRect().width',returnByValue:true});
  const shot=await chrome.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:948,height:474,scale:1}});
  await writeFile(job.png,Buffer.from(shot.data,'base64'));
 }
 console.log(`Captured ${pending.length} controlled SVG rasters`);
} finally {await chrome.stop();}
