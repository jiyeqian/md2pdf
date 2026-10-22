import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentAssetCache } from '../web/platform-static/document-asset-cache.mjs';

test('shares an in-flight asset conversion and retains its successful result', async () => {
  const cache=createDocumentAssetCache(4);
  let resolveLoad;
  let calls=0;
  const load=()=>{calls++;return new Promise(resolve=>{resolveLoad=resolve})};
  const first=cache('v1|/asset.js',load);
  const second=cache('v1|/asset.js',load);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
  resolveLoad('data:text/javascript;base64,QQ==');
  assert.equal(await first,await second);
  assert.equal(await cache('v1|/asset.js',load),'data:text/javascript;base64,QQ==');
  assert.equal(calls,1);
});

test('drops failed conversions so a later render can retry', async () => {
  const cache=createDocumentAssetCache(4);
  let calls=0;
  await assert.rejects(cache('v1|/asset.js',async()=>{calls++;throw new Error('temporary read failure')}),/temporary read failure/);
  assert.equal(await cache('v1|/asset.js',async()=>{calls++;return 'converted'}),'converted');
  assert.equal(calls,2);
});

test('uses version and resource identity in cache keys and evicts least-recent ready entries', async () => {
  const cache=createDocumentAssetCache(2);
  const calls=new Map();
  const load=key=>async()=>{calls.set(key,(calls.get(key)||0)+1);return key};
  await cache('v1|/asset.js',load('v1'));
  await cache('v1|/logo.svg',load('logo'));
  await cache('v1|/asset.js',load('unused'));
  await cache('v2|/asset.js',load('v2'));
  await cache('v1|/logo.svg',load('logo-again'));
  assert.deepEqual(Object.fromEntries(calls),{v1:1,logo:1,v2:1,'logo-again':1});
  assert.throws(()=>createDocumentAssetCache(0),RangeError);
});
