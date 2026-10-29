import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {syncGbExample} from '../scripts/sync-gb-example.mjs';
import {render} from '../src/render.mjs';
import {findExample} from '../src/web-examples.mjs';

test('完整GB范例逐字节同步，检查能拒绝漂移且不改写文件',async()=>{
 const root=await mkdtemp('/private/tmp/gb-source-sync-');
 try {
  await mkdir(root+'/web/examples',{recursive:true});await mkdir(root+'/examples');
  const source='---\n标准号: GB/T 1—2026\n---\n\n完整范例。\n';
  await writeFile(root+'/web/examples/gb.md',source);
  await assert.rejects(()=>syncGbExample(root,true),/不一致/);
  assert.equal(await syncGbExample(root),true);
  assert.equal(await readFile(root+'/examples/gb.md','utf8'),source);
  assert.equal(await syncGbExample(root,true),false);
  await writeFile(root+'/examples/gb.md','漂移的副本');
  await assert.rejects(()=>syncGbExample(root,true),/不一致/);
  assert.equal(await readFile(root+'/examples/gb.md','utf8'),'漂移的副本');
  assert.equal(await syncGbExample(root),true);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('仓库CLI副本、模板库和验收来源相同，空白骨架保持独立且可渲染',async()=>{
 await syncGbExample(undefined,true);
 const canonical=await readFile(new URL('../web/examples/gb.md',import.meta.url),'utf8');
 assert.equal((await findExample('gb')).md,canonical);
 const skeleton=await readFile(new URL('../templates/gb.md',import.meta.url),'utf8');
 assert.notEqual(skeleton,canonical);
 assert.doesNotMatch(skeleton,/^:::gb-term\s+\d/m);
 assert.doesNotMatch(skeleton,/R001|R040/);
 assert.match(skeleton,/gb-index-section lang=zh/);assert.match(skeleton,/gb-index-section lang=en/);
 for(const context of [{},{webSafe:true}]) {
  const result=await render(skeleton,{},context);
  assert.equal(result.type,'gb');
  assert.match(result.html,/gb-term-number">3\.1/);
  assert.match(result.html,/href="#gb-term-term">3\.1<\/a>/);
  assert.match(result.html,/data-gb-index-columns="2"/);
  assert.match(result.html,/data-gb-index-columns="1"/);
 }
});
