import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {render} from '../src/render.mjs';
import {analyzeMarkdown,provideCompletions} from '../web/editor-analysis.mjs';
const make=md=>render(md.includes('role=toc') ? md : '## 目次 {role=toc}\n\n'+md,{type:'gb',pagedHtml:true},{webSafe:true});
const fig=key=>`图：${key} {#fig:${key}}\n\n\`\`\`mermaid\nflowchart LR\n A-->B\n\`\`\`\n`;
const table=key=>`表：${key} {#tab:${key}}\n\n| 值 |\n|---|\n| 1 |\n`;
const index='## 索引 {role=index}\n\n:::gb-index A\n章条 | @sec:details\n图示 | @fig:alpha\n表格 | @tab:alpha\n:::';
function entry(html,name) {
 const match=new RegExp('<span class="gb-index-term">'+name+'</span><span class="gb-index-dots"></span><span class="gb-index-locations"><a href="#([^"]+)">([^<]+)</a>').exec(html);
 assert.ok(match,'index entry: '+name);
 return {id:match[1],number:match[2]};
}

test('moving chapter, figures and tables updates numbers and keeps semantic targets',async()=>{
 const alpha='## 甲 {#sec:alpha}\n\n### 明细 {#sec:details}\n\n明细内容。\n';
 const beta='## 乙 {#sec:beta}\n\n乙内容。\n';
 for(const moved of [false,true]) {
  const md='## 范围\n\n见条款 \\ref{sec:details}、图 \\ref{fig:alpha}、表 \\ref{tab:alpha}。\n\n'+(moved?beta+'\n'+alpha:alpha+'\n'+beta)+'\n'+(moved?fig('beta')+'\n'+fig('alpha'):fig('alpha')+'\n'+fig('beta'))+'\n'+(moved?table('beta')+'\n'+table('alpha'):table('alpha')+'\n'+table('beta'))+'\n'+index;
  const {html}=await make(md);
  assert.deepEqual(entry(html,'章条'),{id:'gb-sec-details',number:moved?'3.1':'2.1'});
  assert.deepEqual(entry(html,'图示'),{id:moved?'fig-2':'fig-1',number:moved?'图2':'图1'});
  assert.deepEqual(entry(html,'表格'),{id:moved?'tab-2':'tab-1',number:moved?'表2':'表1'});
  assert.match(html,new RegExp('id="'+entry(html,'图示').id+'" data-gb-stable-key="fig:alpha"'));
  assert.match(html,new RegExp('id="'+entry(html,'表格').id+'" data-gb-stable-key="tab:alpha"'));
  assert.ok(html.includes('<a href="#gb-sec-details" class="ref">'+(moved?'3.1':'2.1')+'</a>'));
  assert.ok(!html.includes('{#sec:'));
  assert.ok(!html.includes('@fig:alpha'));
  assert.equal((html.match(/toc-level-0 toc-float/g)||[]).length,4,'float contents retained');
 }
});

test('appendix heading and table references show appendix numbers',async()=>{
 const md='## 范围\n\n内容。\n\n## 补充 {role=appendix nature=informative #sec:appendix}\n\n### 项目 {#sec:item}\n\n'+table('appendix')+'\n## 索引 {role=index}\n\n:::gb-index A\n附录 | @sec:appendix\n条款 | @sec:item\n表格 | @tab:appendix\n:::';
 const {html}=await make(md);
 assert.equal(entry(html,'附录').number,'附录A');
 assert.equal(entry(html,'条款').number,'A.1');
 assert.equal(entry(html,'表格').number,'表A.1');
});

test('duplicate and missing stable references fail explicitly',async()=>{
 for(const md of [
  '## 范围 {#sec:same}\n\n## 内容 {#sec:same}',
  '## 范围\n\n'+fig('same')+'\n'+fig('same'),
  '## 范围\n\n'+table('same')+'\n'+table('same'),
  '## 范围\n\n见 \\ref{sec:missing}。',
  '## 范围\n\n见 \\ref{fig:missing}。',
  '## 范围\n\n## 索引 {role=index}\n\n:::gb-index A\n丢失 | @tab:missing\n:::',
 ]) await assert.rejects(()=>make(md),e=>e.status===400 && /稳定标识/.test(e.message));
});

test('section completions and diagnostics are enabled only for the GB editor',()=>{
 const md='## 内容 {#sec:content}\n\n见 \\ref{sec:content}。';
 const gb=analyzeMarkdown(md,{templateType:'gb'});
 assert.ok(!gb.diagnostics.some(d=>d.code==='unsupported-ref'||d.code==='unsupported-target'));
 assert.equal(gb.targets[0].kind,'section');
 const text=md+'\n\\ref{sec:';
 const completion=provideCompletions({text,pos:text.length,templateType:'gb'},analyzeMarkdown(text,{templateType:'gb'}));
 assert.ok(completion.options.some(o=>o.label==='sec:content'));
 assert.equal(analyzeMarkdown(md).targets[0].kind,'anchor');
});

test('the comprehensive example uses stable targets for every index entry',async()=>{
 const md=await readFile(new URL('../web/examples/gb.md',import.meta.url),'utf8');
 const entries=md.slice(md.indexOf('## 索引 {role=index}')).split('\n').filter(l=>l.includes(' | '));
 assert.ok(entries.length>10);
 for(const line of entries) assert.ok(line.split(' | ')[1].split('，').every(s=>/^@[\w:.-]+$/.test(s)),line);
 await assert.doesNotReject(()=>make(md));
});

test('reference syntax inside inline and fenced code remains literal',async()=>{
 const source='## 范围\n\n`\\ref{sec:literal}`\n\n```text\n\\ref{fig:literal}\n## 标题 {#sec:literal}\n```';
 const {html}=await make(source);
 assert.ok(html.includes('\\ref{sec:literal}'));
 assert.ok(!html.includes('data-gb-stable-key="sec:literal"'));
});
