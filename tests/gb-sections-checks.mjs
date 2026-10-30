import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../src/render.mjs';
import {gbHeading,gbSectionDiagnostics} from '../src/gb-sections.mjs';
import {analyzeMarkdown,provideCompletions} from '../web/editor-analysis.mjs';
const opts={type:'gb',gbCover:false,toc:2};
const source='## 目录 {role=toc}\n\n## 序言 {role=preface}\n\n说明。\n\n## 范围\n\n正文[^r]。\n\n## 检测 {role=appendix nature=normative #sec:tests}\n\n### 条件 {#sec:conditions}\n\n图：示意 {#fig:sample}\n\n![图](data:image/png;base64,AAAA)\n\n## 数据 {role=appendix #sec:data}\n\n### 数据项\n\n## 文献 {role=bibliography}\n\n[^r]: 文献内容\n';
test('roles, automatic appendix numbers and explicit generated sections',async()=>{
 const r=await render(source,opts);
 assert.equal((r.html.match(/class="toc"/g)||[]).length,1);
 assert.match(r.html,/class="toc-title"[^>]*>目录<\/h2>/);
 assert.doesNotMatch(r.html,/<span class="toc-text">目录/);
 assert.match(r.html,/class="gb-appendix-number">附录 A/);
 assert.match(r.html,/class="gb-appendix-number">附录 B/);
 assert.match(r.html,/A\.1　条件/); assert.match(r.html,/B\.1　数据项/);
 assert.match(r.html,/图 A\.1/);
 assert.match(r.html,/gb-references-title[^>]*>文献/);
 assert.equal((r.html.match(/class="references"/g)||[]).length,1);
 assert.ok(r.warnings.some(w=>w.includes('未指定性质')));
 assert.ok(r.warnings.some(w=>w.includes('自定义名称')));
 assert.doesNotMatch(r.html,/class="gb-appendix-kind">（资料性）/);
 const reversed=await render(source.replace('## 检测 {role=appendix nature=normative #sec:tests}','## 检测 {#sec:tests nature=normative role=appendix}'),opts);
 assert.equal(r.html,reversed.html);
});
test('appendix stable references track movement and no id is required',async()=>{
 const r=await render('## 范围\n\n见 \\ref{sec:b}。\n\n## 甲 {role=appendix}\n\n## 乙 {role=appendix nature=informative #sec:b}\n\n### 方法\n',opts);
 assert.match(r.html,/href="#gb-sec-b"[^>]*>附录B/);
 assert.match(r.html,/B\.1　方法/);
});
test('attribute validation and inherited subsection semantics',()=>{
 assert.equal(gbHeading('说明 {nature=normative role=appendix}').role,'appendix');
 assert.equal(gbHeading('方法 {#sec:method}',3).role,undefined);
 for(const value of ['{role=appendix nature=unknown}','{role=toc role=toc}','{role=unknown}']) assert.throws(()=>gbHeading('名称 '+value));
 assert.throws(()=>gbHeading('条 {role=appendix}',3));
 const d=gbSectionDiagnostics([{text:'甲 {role=appendix}',level:2,line:3}]);
 assert.equal(d[0].line,3); assert.match(d[0].message,/附录 A 未指定性质/);
});
test('duplicates reject, legacy automatic sections and other templates remain supported',async()=>{
 await assert.rejects(render('## 目次 {role=toc}\n\n## 目录 {role=toc}',opts),/重复/);
 const incomplete=await render('## 名称 {nature=normative}',opts);
 assert.ok(incomplete.warnings.some(w=>w.includes('nature 需要')));
 assert.doesNotMatch(incomplete.html,/class="appendix"/);
 const legacy=await render('## 范围\n\n文献[^a]\n\n[^a]: 来源',opts);
 assert.match(legacy.html,/class="toc-title"[^>]*>目次/);
 assert.match(legacy.html,/gb-references-title/);
 for(const type of ['general','paper','skill']) {
  const r=await render('## 普通章节 {role=appendix nature=normative}\n\n内容',{type});
  assert.ok(!r.warnings.some(w=>w.includes('附录')));
  assert.doesNotMatch(r.html,/data-gb-role=/);
 }
});
test('assistant, heading targets and completion share the GB-only grammar',()=>{
 const md='## 数据 {nature=informative #sec:data role=appendix}\n\n### 子条 {#sec:child}\n\n## 其他 {role=appendix}';
 const a=analyzeMarkdown(md,{templateType:'gb'});
 assert.equal(a.headings[0].text,'数据');assert.equal(a.headings[0].id,'sec:data');
 assert.ok(a.targets.some(t=>t.id==='sec:data'&&t.kind==='section'));
 assert.ok(a.diagnostics.some(d=>d.code==='gb-appendix-nature'&&d.line===5));
 const text='## 数据 {na';
 const c=provideCompletions({text,pos:text.length,templateType:'gb'},a);
 assert.ok(c.options.some(o=>o.label==='nature=normative'));
 assert.equal(provideCompletions({text,pos:text.length,templateType:'normal'},analyzeMarkdown(text)),null);
});

test('explicit role takes priority over a conflicting visible title',async()=>{
 const r=await render('## 范围\n\n## 前言 {role=bibliography}\n',opts);
 assert.match(r.html,/<h2[^>]*data-gb-role="bibliography"[^>]*class="[^"]*back/);
});
