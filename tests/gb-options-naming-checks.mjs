import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFrontmatter,resolveDocumentOptions} from '../src/config.mjs';
import {render} from '../src/render.mjs';
import {policyForType,assertOptionsAllowed} from '../src/web-options.mjs';
import {documentDownloadName,frontmatterTitle} from '../web/editor-files.mjs';
import {draftTitle} from '../web/draft-store.mjs';
import {resolveWebInput,validateInput} from '../src/web-input.mjs';
import {parseArgs} from '../src/options.mjs';
const doc=fm=>`---\n${fm}\n---\n## 范围\n\n### 次级条\n\n#### 三级条\n\n##### 四级条\n`;
const date=new Date(2026,9,29,12,0,0);

test('toc 0–3, legacy booleans/depth and explicit level override',()=>{
  for(const n of [0,1,2,3])for(const value of [String(n),`"${n}"`]){
    const c=parseFrontmatter(doc(`toc: ${value}`)).config;
    assert.equal(c.toc,n!==0);if(n)assert.equal(c.tocDepth,n);
  }
  assert.equal(parseFrontmatter(doc('toc: true\ntoc-depth: 3')).config.tocDepth,3);
  assert.equal(parseFrontmatter(doc('toc: 1\ntoc-depth: 2')).config.tocDepth,2);
  assert.equal(resolveDocumentOptions({toc:1},{toc:3},{defaults:{}}).tocDepth,1);
  assert.equal(parseFrontmatter(doc('toc: false')).config.toc,false);
  assert.equal(parseArgs(['--toc','--toc-depth','3','file.md']).tocDepth,3);
  assert.throws(()=>parseArgs(['--toc-depth','4','file.md']),/1、2 或 3/);
  for(const bad of ['4','-1','1.5','null','[]','{}','wrong']){
    assert.throws(()=>parseFrontmatter(doc(`toc: ${bad}`)),e=>e.configErrors[0].field==='toc'&&/0、1、2或3/.test(e.message));
  }
  assert.throws(()=>parseFrontmatter(doc('toc: 3\ntoc-depth: 2')),/冲突/);
  assert.doesNotThrow(()=>assertOptionsAllowed({tocDepth:3},'gb'));
  assert.deepEqual(policyForType('gb').controls.toc.triValues,['false','1','2','3']);
  assert.equal(resolveWebInput({md:doc('toc: 1'),opts:{toc:true,tocDepth:3}}).effective.tocDepth,3);
  for(const bad of [0,4,1.5,'3'])assert.throws(()=>validateInput({md:'正文',opts:{tocDepth:bad}}),/tocDepth/);
});

test('all templates render real third-level contents and preserve limits at 0–2',async()=>{
  for(const type of ['general','paper','gb','skill'])for(const depth of [0,1,2,3]){
    const result=await render(doc(`toc: ${depth}`),{type},{webSafe:true});
    const toc=result.html.match(/<div class="toc">([\s\S]*?)<\/ol><\/div>/)?.[1]||'';
    assert.equal(toc.includes('范围'),depth>=1,type+depth);
    assert.equal(toc.includes('次级条'),depth>=2,type+depth);
    assert.equal(toc.includes('三级条'),depth>=3,type+depth);
    assert.equal(toc.includes('四级条'),false,type+depth);
    if(depth===3)assert.match(toc,/toc-level-2/);
  }
});

test('GB Chinese title drives drafts and matching Markdown/PDF basenames',()=>{
  const md=doc('标准号: GB/T 39999—2026\n中文名称: "机械系统 # 标题" # 注释\ntitle: 旧标题\nversion: v2');
  assert.equal(frontmatterTitle(md),'机械系统 # 标题');
  assert.equal(draftTitle({md}),'机械系统 # 标题');
  assert.equal(documentDownloadName(md,date,'md'),'机械系统 # 标题_v2.md');
  assert.equal(documentDownloadName(md,date,'pdf'),'机械系统 # 标题_v2.pdf');
  for(const type of ['general','paper','skill']){
    assert.equal(frontmatterTitle(md,type),'旧标题');
    assert.equal(draftTitle({md,opts:{type}}),'旧标题');
  }
  assert.equal(frontmatterTitle(doc('中文名称: 中文名\ntitle: 普通名')),'普通名');
  assert.equal(frontmatterTitle(doc('中文名称: 中文名\ntitle: 普通名'),'gb'),'中文名');
  assert.equal(frontmatterTitle(doc('type: gb\n中文名称: 中文名\ntitle: 普通名')),'中文名');
});

test('GB naming keeps non-GB detection and invalid metadata fallbacks',()=>{
  const base='standard: GB/T 1\n中文名称: 中文名\ntitle: 普通名';
  for(const extra of ['name: skill','abstract: 摘要','keywords: [a]','keywords:\n  - a']){
    assert.equal(frontmatterTitle(doc(base+'\n'+extra)),'普通名');
  }
  for(const bad of ['""','null','[a]','{a: b}']){
    assert.equal(frontmatterTitle(doc(`type: gb\n中文名称: ${bad}\ntitle: 回退`)),'回退');
  }
  assert.equal(draftTitle({md:'正文',filename:'保留.md'}),'保留');
  assert.equal(draftTitle({md:'正文'}),'未命名文档');
  assert.equal(frontmatterTitle('---\n中文名称: 不闭合\n标准号: GB/T 1'),'');
});
