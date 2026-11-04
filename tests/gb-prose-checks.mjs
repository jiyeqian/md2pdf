import test from 'node:test';
import assert from 'node:assert/strict';
import {calibrateGbProse} from '../src/gb-prose.mjs';
import {render} from '../src/render.mjs';

const compact = '<span class="gb-prose-punctuation">';
test('only direct ordinary/appendix prose compresses comma and semicolon; source characters stay unchanged',()=>{
 const html='<section><h2>正文</h2><p>甲，乙；丙。<em>丁，戊</em><a title="甲，乙" href="#a">己；庚</a></p></section><section><h2 data-gb-role="appendix">附录</h2><p>甲，乙</p></section>';
 const result=calibrateGbProse(html);
 assert.equal(result.split(compact).length-1,5);
 assert.equal(result.replace(/<span class="gb-prose-punctuation">([，；])<\/span>/g,'$1'),html);
 assert.match(result,/title="甲，乙"/);
 assert.equal(calibrateGbProse(result),result,'calibration is idempotent');
});
test('front/back matter, floats, lists, notes, code, math and page footnotes retain their spacing',()=>{
 const html='<section><h2 data-gb-role="preface">前言</h2><p>甲，乙</p></section><section><h2 data-gb-role="bibliography">参考文献</h2><p>甲，乙</p></section><section><h2>正文</h2><ul><li><p>甲，乙</p></li></ul><table><tr><td><p>甲，乙</p></td></tr></table><div class="gb-note"><p>甲，乙</p></div><figure><p>甲，乙</p></figure><p><code>甲，乙</code> $x，y$ $$x；y$$ <span class="gb-footnote">甲，乙</span><sup>甲，乙</sup></p></section>';
 assert.equal(calibrateGbProse(html),html);
});
test('GB prose calibration is shared by CLI/Web and absent from the other three templates',async()=>{
 const md='# 文档\n\n## 正文\n\n甲，乙；丙。';
 for(const type of ['gb','general','paper','skill']){
  for(const ctx of [{},{webSafe:true}]){
   const {html}=await render(md,{type},ctx);
   assert.equal(html.includes(compact),type==='gb',type);
  }
 }
});
