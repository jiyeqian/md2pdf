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
test('duplicates reject, missing declarations never create chapters and other templates stay unchanged',async()=>{
 await assert.rejects(render('## 目次 {role=toc}\n\n## 目录 {role=toc}',opts),/重复/);
 const incomplete=await render('## 名称 {nature=normative}',opts);
 assert.ok(incomplete.warnings.some(w=>w.includes('nature 需要')));
 assert.doesNotMatch(incomplete.html,/class="appendix"/);
 const legacy=await render('## 范围\n\n文献[^a]\n\n[^a]: 来源',opts);
 assert.doesNotMatch(legacy.html,/class="toc-title"|<ol class="references"/);
 assert.ok(legacy.warnings.some(w=>w.includes('role=toc')));
 assert.ok(legacy.warnings.some(w=>w.includes('role=bibliography')));
 assert.match(legacy.html,/class="fnref"/);
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

test('standard names and handwritten appendix letters without role are ordinary chapters',async()=>{
 const names=['前言','引言','目次','参考文献','索引','附录 A（规范性）手写附录'];
 const r=await render(names.map(t=>'## '+t).join('\n\n'),opts);
 for(let i=0;i<names.length;i++) assert.ok(r.html.includes((i+1)+'　'+names[i]));
 assert.doesNotMatch(r.html,/data-gb-role=|class="appendix"|class="toc"/);
 const mixed=await render('## 附录 Z（资料性）普通章\n\n## 真正附录 {role=appendix nature=informative}\n\n### 子条',opts);
 assert.match(mixed.html,/class="gb-appendix-number">附录 A/);
 assert.match(mixed.html,/A\.1　子条/);
});
test('missing declaration diagnostics locate toc settings and first reference, ignoring page footnotes',()=>{
 const md='---\ntoc: 3\n---\n\n## 范围\n\n文献[^ref]，脚注[^@page]。\n\n[^ref]: 来源\n[^@page]: 脚注';
 const a=analyzeMarkdown(md,{templateType:'gb'});
 assert.equal(a.diagnostics.find(d=>d.code==='gb-missing-toc').line,2);
 assert.equal(a.diagnostics.find(d=>d.code==='gb-missing-bibliography').line,7);
 const off=analyzeMarkdown(md.replace('toc: 3','toc: 0'),{templateType:'gb'});
 assert.ok(!off.diagnostics.some(d=>d.code==='gb-missing-toc'));
 const pageOnly=analyzeMarkdown('正文[^@page]。\n\n[^@page]: 脚注',{templateType:'gb'});
 assert.ok(!pageOnly.diagnostics.some(d=>d.code==='gb-missing-bibliography'));
});
test('appendix movement updates clause, float, stable reference and index numbers',async()=>{
 const a='## 甲 {role=appendix nature=informative #sec:a}\n\n### 子条 {#sec:child}\n\n![测试 {#fig:a}](data:image/png;base64,AAAA)\n\n表：数据 {#tab:a}\n\n| 值 |\n| --- |\n| 1 |\n';
 const b='## 乙 {role=appendix nature=normative}\n\n内容。\n';
 for(const moved of [false,true]) {
  const r=await render('## 范围\n\n见 \\ref{sec:a}、\\ref{sec:child}、\\ref{fig:a}。\n\n'+(moved?b+a:a+b)+'\n## 索引 {role=index}\n\n:::gb-index A\n子条 | @sec:child\n图 | @fig:a\n表 | @tab:a\n:::',opts);
  const letter=moved?'B':'A';
  assert.ok(r.html.includes('class="ref">附录'+letter+'</a>'));
  assert.ok(r.html.includes('class="ref">'+letter+'.1</a>'));
  assert.ok(r.html.includes('>图'+letter+'.1</a>'));
  assert.ok(r.html.includes('>表'+letter+'.1</a>'));
 }
});
