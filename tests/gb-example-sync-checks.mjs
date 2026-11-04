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

test('GB全面范例的前言列项、历史、引用日期和关键词索引保持规范',async()=>{
 const md=await readFile(new URL('../web/examples/gb.md',import.meta.url),'utf8');
 assert.match(md,/主要技术变化如下：[\s\S]*?1\. 增加了[\s\S]*?3\. 完善了/);
 assert.match(md,/本文件及其所代替文件的历次版本发布情况为：\n\n- 2019 年首次发布[\s\S]*?- 本次为第一次修订。/);
 assert.match(md,/GB\/T 12643—2013、GB\/T 20000\.1—2014 界定/);
 assert.match(md,/## 技术要求[^\n]*\n\n### 一般要求/);
 const index=md.slice(md.indexOf('## 索引'));
 assert.doesNotMatch(index,/@sec:(?:appendix-data|sample-processing)|@tab:response-summary/);
 assert.match(index,/时钟偏差 \| @sec:test-preparation/);
 assert.match(index,/异常切换 \| @sec:test-preparation/);
});

test('公式全角编号格式仅启用于GB，不改变其他模板的MathJax标签机制',async()=>{
 const md='# 验证\n\n$$x=1\\label{eq:test}$$\n\n公式 $\\eqref{eq:test}$。';
 for(const type of ['gb','general','paper','skill']){
  const {html}=await render(md,{type},{webSafe:true});
  assert.equal(html.includes('parseOptions.tags.formatTag ='),type==='gb',type);
 }
});
