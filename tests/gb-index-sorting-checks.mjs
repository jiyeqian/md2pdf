import test from 'node:test';
import assert from 'node:assert/strict';
import {groupGbIndex,parseGbIndex,parseGbIndexSection} from '../src/gb-index.mjs';
import {analyzeMarkdown,provideCompletions} from '../web/editor-analysis.mjs';
import {render} from '../src/render.mjs';
const group=(text,label='')=>parseGbIndex(text,label);
const terms=groups=>groups.flatMap(([,rows])=>rows.map(r=>r.term));
test('default Chinese groups and full pinyin order, including phrase pronunciation',()=>{
 const result=groupGbIndex(group('试验报告 | @a\n数据整理 | @b\n刚度系数 | @c\n试验步骤 | @d\n采集装置 | @e\n重庆 | @f'));
 assert.deepEqual(result.map(([letter])=>letter),['C','G','S']);
 assert.deepEqual(terms(result),['采集装置','重庆','刚度系数','试验报告','试验步骤','数据整理']);
});
test('sort-key overrides automatic reading but forced uppercase grouping wins',()=>{
 const entries=group('重载 {sort-key="zhong zai"} | @a\n重庆 {sort-key="chong qing"} | @b');
 assert.deepEqual(groupGbIndex(entries).map(([k])=>k),['C','Z']);
 assert.equal(groupGbIndex(group('重庆 {sort-key="chong qing"} | @b','k'))[0][0],'K');
 assert.deepEqual(terms(groupGbIndex(group('重载 {sort-key="zhong zai"} | @a\n重庆 {sort-key="chong qing"} | @b','C'))),['重庆','重载']);
});
test('input mode keeps first group and entry order, still using keys for grouping',()=>{
 const result=groupGbIndex(group('数据 | @a\n刚度 | @b\n试验 | @c\n重载 {sort-key="chong zai"} | @d'),{sort:'input'});
 assert.deepEqual(result.map(([k])=>k),['S','G','C']);assert.deepEqual(terms(result),['数据','试验','刚度','重载']);
});
test('English natural ordering ignores case, punctuation and spaces, # last',()=>{
 assert.deepEqual(terms(groupGbIndex(group('Model 10 | @a\nmodel-2 | @b\n“Alpha” | @c\n#123 | @d'),{lang:'en'})),['“Alpha”','model-2','Model 10','#123']);
});
test('tone and original text tie breaks are fixed; prefix sorts first',()=>{
 assert.deepEqual(terms(groupGbIndex(group('麻 | @a\n妈 | @b\n马 | @c\n骂 | @d\n妈妈 | @e'))),['妈','麻','马','骂','妈妈']);
 const result=groupGbIndex(group('a | 1\nA | 2'),{lang:'en'});assert.deepEqual(terms(result),['A','a']);
});
test('same letter groups and same terms merge; references deduplicate',()=>{
 const entries=parseGbIndexSection(':::gb-index\n刚度 | @a，@b\n:::\n:::gb-index g\n刚度 | @b;@c\n:::\n:::gb-index G\n构件 | @d\n:::');
 const result=groupGbIndex(entries);assert.equal(result.length,1);assert.equal(result[0][1][0].locations,'@a，@b，@c');
 assert.throws(()=>groupGbIndex([...group('同词 | @a','A'),...group('同词 | @b','B')]),/冲突/);
});
test('invalid keys, sorting and section content fail explicitly',()=>{
 for(const text of ['词 {sort-key=""} | 1','词 {sort-key=x sort-key=y} | 1','词 {unknown=x} | 1'])assert.throws(()=>group(text),e=>e.status===400);
 assert.throws(()=>groupGbIndex(group('词 | 1'),{sort:'source'}),/sort/);
 assert.throws(()=>parseGbIndexSection('普通正文'),/仅支持/);
 assert.throws(()=>parseGbIndexSection(':::gb-index\n词 | 1'),/未闭合/);
});
const source='## 范围 {#sec:scope}\n\n图：流程 {#fig:flow}\n\n表：数据 {#tab:data}\n\n:::gb-term id=grasp\n抓取\ngrasp\n\n定义\n:::\n\n:::gb-index-section lang=zh\n:::gb-index\n抓取 | ';
const complete=(tail,templateType='gb')=>{const text=source+tail;return provideCompletions({text,pos:text.length,templateType},analyzeMarkdown(text,{templateType}));};
test('index @ completion supports stable sections, figures, tables and terms',()=>{
 const result=complete('@');assert.deepEqual(result.options.map(o=>o.label),['@sec:scope','@fig:flow','@tab:data','@grasp']);
 assert.equal(complete('@g').options[0].apply,'grasp');
 for(const separator of ['，',',','、',';','；','/'])assert.equal(complete('@sec:scope'+separator+' @ta').options[0].apply,'tab:data');
 assert.equal(complete('@','paper'),null);
});
test('completion replaces suffix and does not trigger in code, prose, term names or closed blocks',()=>{
 const text=source+'@sec:scope';const result=provideCompletions({text,pos:text.length-5,templateType:'gb'},analyzeMarkdown(text,{templateType:'gb'}));assert.equal(result.to,text.length);
 for(const text of ['---\nname: |\n  :::gb-index\n---\n词 | @','正文 @','```md\n:::gb-index\n词 | @',':::gb-index\n词 @',':::gb-index\n词 | `@',':::gb-index\n词 | 1\n:::\n正文 | @'])assert.equal(provideCompletions({text,pos:text.length,templateType:'gb'},analyzeMarkdown(text,{templateType:'gb'})),null);
});
test('section parameters and per-entry sort-key complete',()=>{
 for(const input of [':::gb-index-section sort=',':::gb-index-section lang=zh sort=']){
  const result=provideCompletions({text:input,pos:input.length,templateType:'gb'},analyzeMarkdown(input));assert.deepEqual(result.options.map(o=>o.label),['sort=auto','sort=input','sort=pinyin','sort=alphabetical']);
 }
 const text=':::gb-index\n词 {sort';assert.equal(provideCompletions({text,pos:text.length,templateType:'gb'},analyzeMarkdown(text)).options[0].apply,'sort-key=""}');
});
test('stable IDs with dots complete and resolve',async()=>{
 const text='## 范围 {#sec:test.one}\n\n:::gb-index\n词 | @sec:test.';
 const result=provideCompletions({text,pos:text.length,templateType:'gb'},analyzeMarkdown(text,{templateType:'gb'}));assert.equal(result.options[0].apply,'sec:test.one');
 const {html}=await render(text+'one\n:::',{type:'gb',toc:false});assert.match(html,/gb-index-locations"><a href="#gb-sec-test.one">1<\/a>/);
});
test('render integrates groups and strips metadata, reference links update',async()=>{
 const body='# 标准\n\n## 范围 {#sec:scope}\n\n## 索引 {role=index}\n\n:::gb-index-section lang=zh sort=auto\n:::gb-index\n数据 | @sec:scope\n刚度 {sort-key="gang du"} | @sec:scope\n:::\n:::';
 const {html}=await render(body,{type:'gb',toc:false});assert.ok(html.indexOf('gb-index-letter">G')<html.indexOf('gb-index-letter">S'));assert.doesNotMatch(html,/sort-key|gang du/);assert.match(html,/href="#gb-sec-scope">1<\/a>/);
});
