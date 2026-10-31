import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../src/render.mjs';
import {provideCompletions,analyzeMarkdown} from '../web/editor-analysis.mjs';
const options={type:'gb',toc:false};
const table=(id,ref,body='1')=>`表：${id} {#tab:${id}}\n\n| 内径${ref} | 外径 |\n|---|---|\n| ${body} | 2 |`;
const box=(label='注1：')=>`:::gb-note scope=table layout=boxed label="${label}"\n检测条件说明。\n:::`;
const tables=html=>[...html.matchAll(/<table[^>]*>[\s\S]*?<\/table>/g)].map(m=>m[0]);
test('table notes and footnotes are separate full-width rows, with stable links and repeats',async()=>{
 const md='# 标准\n\n## 范围\n\n'+table('one','[^@diameter]','1[^@value]，复引[^@diameter]')+'\n\n'+box()+'\n\n'+box('注2：')+'\n\n[^@diameter]: 内径测量。\n[^@value]: 数值测量。';
 const {html}=await render(md,options),t=tables(html)[0];
 assert.equal((t.match(/class="gb-table-notes"/g)||[]).length,1);
 assert.equal((t.match(/class="gb-table-footnotes"/g)||[]).length,1);
 assert.equal((t.match(/id="gb-table-footnote-1-a"/g)||[]).length,1);
 assert.equal((t.match(/href="#gb-table-footnote-1-a"/g)||[]).length,2);
 assert.ok(t.indexOf('注2：')<t.indexOf('gb-table-footnotes'));
 assert.match(t,/<tr class="gb-table-footnotes"><td colspan="2">/);
 assert.match(t,/gb-table-footnote-1-b/);assert.ok(!t.includes('class="gb-footnote '));
});
test('each table resets letters and body footnotes keep their own sequence',async()=>{
 const md='# 标准\n\n## 范围\n\n正文[^@body1]。\n\n'+table('one','[^@first]')+'\n\n正文[^@body2]。\n\n'+table('two','[^@second]')+'\n\n[^@body1]: 正文一\n[^@body2]: 正文二\n[^@first]: 第一表\n[^@second]: 第二表';
 const {html}=await render(md,options),ts=tables(html);
 assert.match(ts[0],/gb-table-footnote-1-a/);assert.match(ts[1],/gb-table-footnote-2-a/);
 assert.match(html,/id="gb-footnote-1"/);assert.match(html,/id="gb-footnote-2"/);assert.doesNotMatch(html,/id="gb-footnote-3"/);
});
test('ownership follows reference, never definition position; cross-owner reuse fails',async()=>{
 for(const md of [table('one','[^@x]')+'\n\n正文[^@x]',table('one','[^@x]')+'\n\n'+table('two','[^@x]')])await assert.rejects(render(md+'\n\n[^@x]: 定义',options),/跨正文或不同图表/);
 const {html}=await render('[^@x]: 前置定义\n\n'+table('one','[^@x]'),options);assert.match(tables(html)[0],/前置定义/);
});
test('plain table notes preserve data structure, boxed notes explicitly add a footer',async()=>{
 const {html}=await render(table('one','')+'\n\n:::gb-note scope=table label="注："\n独立说明\n:::',options);
 assert.ok(!tables(html)[0].includes('tfoot'));assert.match(html,/<div class="gb-table-group">/);
 assert.ok(html.indexOf('</table>')<html.indexOf('独立说明'));
 const result=await render(table('one','')+'\n\n'+box(),options);assert.match(tables(result.html)[0],/<tfoot>/);
 for(const args of ['layout=bad','layout=boxed','scope=figure layout=boxed','scope=table position=top layout=boxed'])await assert.rejects(render(':::gb-note '+args+'\n说明\n:::',options),e=>e.status===400);
});
test('manual image markers render upper-case/lower-case script labels literally, no numbering inference',async()=>{
 const md='图：状态 {#fig:state}\n\n![状态](data:image/png;base64,AAAA)\n\n:::gb-note scope=figure label="注："\n普通图注\n:::\n\n:::gb-note scope=figure label="^{b}" weight=normal\n固定标记说明\n:::';
 const {html}=await render(md,options);assert.match(html,/<span class="gb-label"><sup class="md-superscript">b<\/sup><\/span>/);
 assert.ok(html.indexOf('普通图注')<html.indexOf('固定标记说明'));assert.doesNotMatch(html,/gb-figure-footnote-\d/);
});
test('complex table spans and Markdown footnotes coexist',async()=>{
 const md=':::gb-table\nhead:\n| {rowspan=2} 项目[^@a] | {colspan=2} 数值 |\n| 甲 | 乙 |\nbody:\n| 项目一 | 1 | 2 |\n:::\n\n'+box()+'\n\n[^@a]: 复杂表脚注。';
 const {html}=await render(md,options);assert.match(html,/<tr class="gb-table-footnotes"><td colspan="3">/);
 assert.match(html,/rowspan="2"/);assert.match(html,/colspan="2"/);
});
test('boxed and superscript labels complete without adding a directive or refs parameter',()=>{
 for(const [text,label] of [[':::gb-note scope=table layout=','layout=boxed'],[':::gb-note scope=figure label','label="^{a}"']]) {
  const r=provideCompletions({text,pos:text.length,templateType:'gb'},analyzeMarkdown(text));assert.ok(r.options.some(o=>o.label===label));
 }
 const text='[^@a]: 表脚注\n\n| 项目[^@';const r=provideCompletions({text,pos:text.length,templateType:'gb'},analyzeMarkdown(text));assert.equal(r.options[0].apply,'@a]');
});

test('automatic notes in explicitly owned plain explanations still belong to the table',async()=>{
 const {html}=await render(table('one','')+'\n\n:::gb-note scope=table\n补充[^@x]\n:::\n\n[^@x]: 说明中的表脚注',options);
 assert.match(tables(html)[0],/gb-table-footnote-1-a/);assert.doesNotMatch(html,/class="gb-footnote gb-footnote/);
});
