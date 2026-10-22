import assert from 'node:assert/strict';
import { Session } from 'node:inspector';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/server.mjs';
import { buildStatic } from '../src/static-build.mjs';

const build = await buildStatic();
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input);
  return url.protocol === 'file:' ? new Response(await readFile(url)) : nativeFetch(input, init);
};
const runtime = await import(pathToFileURL(build.directory + '/runtime.mjs'));
const app = createApp();
const session = new Session();
session.connect();
const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (err, result) => err ? reject(err) : resolve(result)));
const parseCount = async run => {
  await post('Profiler.startPreciseCoverage', { callCount:true, detailed:true });
  await run();
  const coverage = await post('Profiler.takePreciseCoverage');
  await post('Profiler.stopPreciseCoverage');
  return coverage.result.filter(script => script.url.endsWith('/src/config.mjs'))
    .flatMap(script => script.functions).filter(fn => fn.functionName === 'parseFrontmatter')
    .reduce((count, fn) => count + fn.ranges[0].count, 0);
};
try {
  await post('Profiler.enable');
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const targets = [
    ['node', (route, body) => nativeFetch(base + route, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) })],
    ['static', (route, body) => runtime.appFetch(route, { body:JSON.stringify(body) })],
  ];
  const doc = { md:'---\nfont-size: 11\n---\n# Auto preview', opts:{fontSize:12,marginLeft:21} };
  for (const [name, request] of targets) {
    await request('/api/preview', doc); // Warm module imports outside the measured operations.
    const oldCount = await parseCount(async () => {
      assert.equal((await request('/api/resolve', {md:doc.md,opts:{}})).status,200);
      assert.equal((await request('/api/render',doc)).status,200);
    });
    const count = await parseCount(async () => assert.equal((await request('/api/preview',doc)).status,200));
    assert.deepEqual([oldCount,count],[2,1],`${name}: actual parser invocations`);
    const merged = await (await request('/api/preview',doc)).json();
    const legacy = await (await request('/api/render',doc)).json();
    assert.deepEqual(merged.effective,legacy.effective);
    const stable = html => html.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}/g,'TIMESTAMP');
    assert.equal(stable(merged.html),stable(legacy.html));
    const gb = {md:'---\ntype: gb\n---\n# Standard',opts:{fontSize:12,lineHeight:1.5,marginLeft:21,theme:'minimal',landscape:true}};
    const adapted = await (await request('/api/preview',gb)).json();
    assert.equal(adapted.type,'gb');
    assert.deepEqual(new Set(adapted.resetOptions),new Set(Object.keys(gb.opts)));
    assert.equal((await request('/api/render',gb)).status,400,'legacy endpoint keeps strict validation');
    assert.equal((await request('/api/preview',{...gb,opts:{...gb.opts,type:'gb'}})).status,400,'explicit choices are not normalized');
    for (const body of [
      {...gb,opts:{fontSize:999}}, {...gb,opts:{theme:'invalid'}},
      {md:'---\ntype: gb\nfont-size: 12\n---\n# Bad',opts:{}},
      {md:'---\nfont-size: null\n---\n# Bad',opts:{}},
      {...doc,parsedFrontmatter:{fm:{}}},
    ]) assert.equal((await request('/api/preview',body)).status,400,`${name}: invalid configuration remains rejected`);
    const paper = await (await request('/api/preview',{md:'---\ntype: paper\n---\n# Paper',opts:{numbering:'force',numberScheme:'cjk',fontSize:13}})).json();
    assert.deepEqual(new Set(paper.resetOptions),new Set(['numbering','numberScheme']));
    assert.equal(paper.effective.fontSize,13);
    console.log(`${name}: requests 2→1; measured parseFrontmatter calls ${oldCount}→${count}; policy, explicit/legacy and invalid-input checks passed`);
  }
  const controller = new AbortController();
  controller.abort();
  const abortedCount = await parseCount(async () => {
    await assert.rejects(runtime.appFetch('/api/preview',{body:JSON.stringify(doc),signal:controller.signal,md2pdfConsumer:'editor'}),{name:'AbortError'});
  });
  assert.equal(abortedCount,0,'already aborted preview never reaches the parser');
  const queuedCount = await parseCount(async () => {
    const old = runtime.appFetch('/api/preview',{body:JSON.stringify(doc),md2pdfConsumer:'editor'});
    const latest = runtime.appFetch('/api/preview',{body:JSON.stringify({...doc,md:'# Latest'}),md2pdfConsumer:'editor'});
    await assert.rejects(old,{name:'AbortError'});
    assert.equal((await latest).status,200);
  });
  assert.equal(queuedCount,1,'only latest queued editor preview reaches the parser');
  console.log('static cancellation: aborted input does not start, superseded queued pair invokes parser once');
} finally {
  session.disconnect();
  await app.close();
  globalThis.fetch = nativeFetch;
}
