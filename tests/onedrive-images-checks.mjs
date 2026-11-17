import test from 'node:test';
import assert from 'node:assert/strict';
import { lexer, walkTokens } from '../vendor/marked.esm.js';
import { createCloudImages, imageMime } from '../web/onedrive-images.mjs';
import { createOneDriveGraph } from '../web/onedrive-graph.mjs';
import { validateInput } from '../src/web-input.mjs';
import { render } from '../src/render.mjs';
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64'));
const lex = lexer;
test('image tokens include reference syntax, ignore code and URLs, preserve Markdown and cache repeated images', async () => {
  const calls=[];const resolve=createCloudImages({lex,walkTokens,readImage:async href=>{calls.push(href);return png;}});
  const md='![hello](images/a.png)\n![again][pic]\n[pic]: images/a.png\n`![code](no.png)`\n![web](https://example.com/a.png)';
  const assets=await resolve(md);
  assert.deepEqual(calls,['images/a.png']);assert.match(assets['images/a.png'],/^data:image\/png;base64,/);
  await resolve(md);assert.equal(calls.length,1);assert.ok(md.includes('images/a.png'));
});
test('image failures retry, invalid content fails, cancelled work never commits assets', async () => {
  let fail=true;const resolve=createCloudImages({lex,walkTokens,readImage:async()=>{if(fail)throw new Error('missing');return png;}});
  await assert.rejects(resolve('![x](missing.png)'),/missing.png.*missing/);fail=false;assert.ok((await resolve('![x](missing.png)'))['missing.png']);
  await assert.rejects(createCloudImages({lex,walkTokens,readImage:async()=>new Uint8Array([1,2,3])})('![x](bad.png)'),/仅支持/);
  const controller=new AbortController();controller.abort();await assert.rejects(resolve('![x](missing.png)',controller.signal),{name:'AbortError'});
  await assert.rejects(createCloudImages({lex,walkTokens,readImage:async()=>new Uint8Array(10*1024*1024+1)})('![x](big.png)'),/10 MiB/);
});
test('render resources preserve source and use the same image in ordinary and paged HTML', async () => {
  const md='![hello image](images/helloworld.jpeg)';const assets={'images/helloworld.jpeg':`data:image/png;base64,${Buffer.from(png).toString('base64')}`};
  const input=validateInput({md,imageAssets:assets});assert.equal(input.md,md);
  const result=await render(md,{type:'general',pagedHtml:true},{webSafe:true,imageAssets:input.imageAssets});
  assert.ok(result.html.includes(assets['images/helloworld.jpeg']));assert.ok(result.pagedHtml.includes(assets['images/helloworld.jpeg']));
  assert.throws(()=>validateInput({md,imageAssets:{x:'https://example.com/a.png'}}),/云端图片资源无效/);
  assert.throws(()=>validateInput({md,imageAssets:{x:'data:image/svg+xml;base64,AAAA'}}),/云端图片资源无效/);
});
test('Graph relative paths remain in AppFolder; decode safe filenames and never send bearer token to image storage', async () => {
 const calls=[];const json=x=>new Response(JSON.stringify(x));
 const graph=createOneDriveGraph({token:async()=>'secret',fetch:async(url,options)=>{
  calls.push({url,options});
  if(url.includes('/special/approot'))return json({id:'root'});
  if(url.includes('/items/root?'))return json({id:'root',folder:{}});
  if(url.includes('/items/root:/images:'))return json({id:'images',name:'images',folder:{},parentReference:{id:'root'}});
  if(url.includes('/items/images:/hello%20world.png:'))return json({id:'pic',name:'hello world.png',file:{},size:png.length,parentReference:{id:'images'}});
  if(url.includes('/items/pic?'))return json({id:'pic',name:'hello world.png',eTag:'v1',file:{},size:png.length,'@microsoft.graph.downloadUrl':'https://s.files.1drv.com/image'});
  if(url.startsWith('https://s.files.1drv.com/'))return new Response(png);
  throw new Error('unexpected '+url);
 }});
 assert.deepEqual(await graph.readImage('root','./images/hello%20world.png'),png);
 assert.equal(calls.at(-1).options.headers,undefined);
 for(const href of ['../outside.png','%2e%2e/outside.png','https://evil/a.png','//evil/a.png','images/%2fa.png','images/a.png?token=x']) await assert.rejects(graph.readImage('root',href));
 assert.ok(!calls.some(x=>x.url.includes('outside.png')));
});

test('combined cloud images stay within total budget and stale download results are discarded', async () => {
 const large = new Uint8Array(6*1024*1024);large.set(png.slice(0,8));
 const resolve=createCloudImages({lex,walkTokens,readImage:async()=>large});
 await assert.rejects(resolve('![a](a.png) ![b](b.png) ![c](c.png)'),/16 MiB/);
 const controller=new AbortController();
 const cancelled=createCloudImages({lex,walkTokens,readImage:async()=>{controller.abort();return png;}});
 await assert.rejects(cancelled('![a](a.png)',controller.signal),{name:'AbortError'});
 const encoded=`data:image/png;base64,${Buffer.from(large).toString('base64')}`;
 assert.throws(()=>validateInput({md:`![embedded](${encoded})`,imageAssets:{a:encoded,b:encoded}}),/16 MiB/);
});

test('image signatures support all four allowed raster formats and reject SVG', () => {
 assert.equal(imageMime(png),'image/png');
 assert.equal(imageMime(Uint8Array.from([255,216,255,0])),'image/jpeg');
 assert.equal(imageMime(new TextEncoder().encode('GIF89a')),'image/gif');
 assert.equal(imageMime(new TextEncoder().encode('RIFFxxxxWEBP')),'image/webp');
 assert.throws(()=>imageMime(new TextEncoder().encode('<svg></svg>')),/仅支持/);
});
