import test from 'node:test';
import assert from 'node:assert/strict';
import { lexer,walkTokens } from '../vendor/marked.esm.js';
import { createCloudImages } from '../web/onedrive-images.mjs';
import { createOneDriveGraph } from '../web/onedrive-graph.mjs';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64'));
const json=(x,status=200)=>new Response(JSON.stringify(x),{status});
const md=Array.from({length:6},(_,i)=>`![${i}](p${i}.png)`).join('\n');

test('overlapping previews download each image once and cap shared concurrency at three', async () => {
 const calls=new Map();let active=0,peak=0;
 const resolve=createCloudImages({lex:lexer,walkTokens,readImage:async href=>{calls.set(href,(calls.get(href)||0)+1);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return png;}});
 const [a,b]=await Promise.all([resolve(md),resolve(md)]);
 assert.deepEqual(a,b);assert.equal(peak,3);assert.equal(calls.size,6);assert.ok([...calls.values()].every(x=>x===1));
 await resolve('# New text\n'+md);assert.ok([...calls.values()].every(x=>x===1),'ordinary editing does not download images again');
});
test('one cancelled consumer does not cancel a shared image for the latest preview', async () => {
 let release,calls=0;const controller=new AbortController();
 const resolve=createCloudImages({lex:lexer,walkTokens,readImage:async()=>{calls++;await new Promise(r=>release=r);return png;}});
 const old=resolve('![a](a.png)',controller.signal);const latest=resolve('![a](a.png)');
 await new Promise(r=>setTimeout(r,0));controller.abort();release();
 await assert.rejects(old,{name:'AbortError'});assert.ok((await latest)['a.png']);assert.equal(calls,1);
});
test('a cancelled preview does not schedule its remaining images', async () => {
 const releases=[];let calls=0;const controller=new AbortController();
 const resolve=createCloudImages({lex:lexer,walkTokens,readImage:async()=>{calls++;await new Promise(r=>releases.push(r));return png;}});
 const first=resolve(md,controller.signal);await new Promise(r=>setTimeout(r,0));controller.abort();releases.splice(0).forEach(r=>r());
 await assert.rejects(first,{name:'AbortError'});assert.equal(calls,3);
});
test('image batches share their directory reads but a new batch checks boundaries again', async () => {
 const calls=[];let moved=false;
 const graph=createOneDriveGraph({token:async()=>'test',fetch:async(url)=>{
  calls.push(url);
  if(url.includes('/special/approot'))return json({id:'root'});
  if(url.includes('/items/root?'))return json(moved?{id:'root',file:{}}:{id:'root',folder:{}});
  if(url.includes('/items/root:/images:'))return json({id:'images',name:'images',folder:{},parentReference:{id:'root'}});
  const match=url.match(/\/items\/images:\/(p\d\.png):/);if(match)return json({id:match[1],name:match[1],file:{},size:png.length,parentReference:{id:'images'}});
  if(url.startsWith('https://s.files.1drv.com'))return new Response(png);
  const id=new URL(url).pathname.split('/').at(-1);if(/^p\d\.png$/.test(id))return json({id,name:id,eTag:'1',file:{},size:png.length,'@microsoft.graph.downloadUrl':'https://s.files.1drv.com/'+id});
  throw new Error('unexpected '+url);
 }});
 const read=graph.imageReader('root');await Promise.all([read('images/p0.png'),read('images/p1.png')]);
 assert.equal(calls.filter(x=>x.includes('/special/approot')).length,1);
 assert.equal(calls.filter(x=>x.includes('/items/root?')).length,1);
 assert.equal(calls.filter(x=>x.includes('/items/root:/images:')).length,1);
 moved=true;await assert.rejects(graph.imageReader('root')('images/p2.png'),/应用文件夹/);
 assert.equal(calls.filter(x=>x.includes('/items/root?')).length,2);
});
test('root lookup retries failures, coalesces callers, and mutation validation remains fresh', async () => {
 let roots=0,fail=true;
 const graph=createOneDriveGraph({token:async()=>'test',fetch:async(url)=>{
  if(url.includes('/special/approot')){roots++;return fail?json({},503):json({id:'root'});}
  if(url.includes('/items/root?'))return json({id:'root',folder:{}});
  if(url.includes('/children'))return json({id:'created',folder:{}});
  throw new Error('unexpected');
 }});
 await assert.rejects(graph.getRoot());fail=false;
 assert.deepEqual(await Promise.all([graph.getRoot(),graph.getRoot()]),['root','root']);assert.equal(roots,2);
 await graph.createFolder('root','new');assert.equal(roots,3,'write ancestry check bypasses root cache');
});
test('a stale directory error invalidates the cached root', async () => {
 let roots=0;
 const graph=createOneDriveGraph({token:async()=>'test',fetch:async url=>url.includes('/special/approot')?(roots++,json({id:'root'})):json({},404)});
 await graph.getRoot();await assert.rejects(graph.listPage('root'));await graph.getRoot();assert.equal(roots,2);
});
test('cancelled consumers queued behind other downloads do not start new network work', async () => {
 const releases=[];const calls=[];
 const resolve=createCloudImages({lex:lexer,walkTokens,readImage:async href=>{calls.push(href);await new Promise(r=>releases.push(r));return png;}});
 const first=resolve('![a](a.png) ![b](b.png) ![c](c.png)');
 await new Promise(r=>setTimeout(r,0));
 const controller=new AbortController();
 const queued=resolve('![x](x.png)',controller.signal);
 const cancelled=assert.rejects(queued,{name:'AbortError'});
 controller.abort();releases.splice(0).forEach(r=>r());
 await first;await cancelled;assert.deepEqual(calls,['a.png','b.png','c.png']);
});
