import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../src/render.mjs';
import {gbHeading} from '../src/gb-sections.mjs';
import {parseColophonRow,prepareDocumentContent} from '../src/document-content.mjs';
import {attachSourcePositions} from '../src/editor-position.mjs';
import {analyzeMarkdown,provideCompletions} from '../web/editor-analysis.mjs';
test('subtitle is free display text; GB validates appendix wording without modifying it',async()=>{
 const r=await render('## 范围\n\n## 方法 {subtitle="（自定 性质）" role=appendix #sec:method}',{type:'gb',toc:false});
 assert.match(r.html,/gb-appendix-kind">（自定 性质）/);assert.ok(r.warnings.some(w=>w.includes('不符合')));
 const literal=await render('## 范围\n\n## 方法 {role=appendix subtitle="资料性"}',{type:'gb',toc:false});assert.match(literal.html,/gb-appendix-kind">资料性<\/span>/);assert.doesNotMatch(literal.html,/gb-appendix-kind">（资料性）/);
 assert.equal(gbHeading('标题 {subtitle="含 空格" #sec:x role=appendix}').subtitle,'含 空格');
 for(const type of ['gb','general','paper','skill'])await assert.rejects(render('## 标题 {nature=normative}',{type}),/已移除/);
});
for(const type of ['general','paper','skill','gb'])test(type+': common subtitle is literal, safe, locatable and outside numbering',async()=>{
 const md='## **结果** {subtitle="原文 **文字** x^{2} <img/src=x>"}\n\n正文';
 const r=await render(md,{type,toc:false});
 assert.match(r.html,/class="heading-subtitle">原文 \*\*文字\*\* x\^\{2\} &lt;img\/src=x&gt;/);
 assert.doesNotMatch(r.html,/<img\b[^>]*src=["']?x[\s>]/);
 const located=attachSourcePositions(r.html,md);assert.match(located,/<h2[^>]*data-md2pdf-source-line="1"/);
 assert.equal(analyzeMarkdown(md,{templateType:type}).headings[0].text,'**结果**');
});
test('keyword punctuation, spelling and inline formatting belong to the author',async()=>{
 for(const type of ['general','paper','skill','gb']){
  const r=await render('## 关键词 {role=keywords}\n\n仿生机械手 / **控制**; H_{2}O、抓取',{type,toc:false});assert.match(r.html,/仿生机械手 \/ <strong>控制<\/strong>; H<sub class="md-subscript">2<\/sub>O、抓取/);
  for(const body of ['- 甲\n- 乙','甲\n\n乙','> 甲'])await assert.rejects(render('## 关键词 {role=keywords}\n\n'+body,{type}),/普通段落/);
 }
});
test('three-cell colophon distinguishes inheritance, explicit clearing and literal separators',()=>{
 assert.deepEqual(parseColophonRow('"左" | | ""'),{left:'左',right:''});
 assert.deepEqual(parseColophonRow('" " | 中 | 右'),{left:'',center:'中',right:'右'});
 assert.deepEqual(parseColophonRow('"A | B" | C\\|D | "E\\"F"'),{left:'A | B',center:'C|D',right:'E"F'});
 assert.deepEqual(parseColophonRow(' | | '),{});assert.deepEqual(parseColophonRow(''),{});
 for(const row of ['left: A\ncenter: B\nright: C','单段旧内容','一 | 二','一 | 二 | 三 | 四','"未闭合 | |','"闭合"多字 | |'])assert.throws(()=>parseColophonRow(row),/colophon/);
});
test('colophon renders safe inline text and keeps disabled/default behavior',async()=>{
 const md='---\nversion: v2\n---\n\n## 正文\n\n:::colophon\n"**编制**：甲 H_{2}O" | | ""\n:::';
 const r=await render(md,{type:'general'});assert.match(r.html,/<div class="colophon"><span><strong>编制<\/strong>：甲 H<sub class="md-subscript">2<\/sub>O<\/span><span>v2<\/span><span><\/span>/);
 const safe=await render('## 正文\n\n:::colophon\n"<img/src=x>" | | ""\n:::',{type:'general'});assert.doesNotMatch(safe.html,/<img\b|href="javascript:/);
 const off=await render(md,{type:'general',colophonEnabled:false});assert.doesNotMatch(off.html,/<div class="colophon">/);
 assert.throws(()=>prepareDocumentContent(':::colophon\nleft: A\nright: B\n:::'),/三格/);
});
test('completion offers shared subtitles and a literal three-cell row, no nature',()=>{
 for(const templateType of ['general','paper','skill','gb']){
  const text='### 标题 {su';const result=provideCompletions({text,pos:text.length,templateType},analyzeMarkdown(text));assert.ok(result.options.some(o=>o.label==='subtitle=""'));assert.ok(result.options.every(o=>!o.label.startsWith('nature=')));
  const block=':::col';const c=provideCompletions({text:block,pos:block.length,templateType},analyzeMarkdown(block));assert.ok(c.options[0].apply.includes(' | '));assert.ok(!c.options[0].apply.includes('left:'));
 }
});

test('role-looking text in a subtitle does not assign a chapter role',async()=>{
 for(const type of ['general','gb']){
  const md='## 结果 {subtitle="role=keywords 是字面说明"}\n\n正文。';const r=await render(md,{type,toc:false});
  assert.match(r.html,/class="heading-subtitle">role=keywords 是字面说明/);assert.doesNotMatch(r.html,/class="keywords"/);
  assert.equal(analyzeMarkdown(md,{templateType:type}).headings[0].role,undefined);
  assert.match(attachSourcePositions(r.html,md),/<h2[^>]*data-md2pdf-source-line="1"/);
 }
});

test('malformed quoted heading attributes reject rather than appearing as ordinary title text',async()=>{
 for(const type of ['general','gb'])for(const tail of ['{subtitle="未闭合}','{role=""}','{subtitle="一" subtitle="二"}'])await assert.rejects(render('## 标题 '+tail,{type}),e=>e.status===400&&/章节属性|未知章节/.test(e.message));
});
