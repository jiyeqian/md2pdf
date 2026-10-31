import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Marked} from '../vendor/marked.esm.js';
import {GB_BLOCKS, GB_NOTE_FORMS, parseGbParameters} from '../src/gb-blocks.mjs';
import {prepareGbContent,transformGbContent} from '../src/gb-content.mjs';
const marked=new Marked({gfm:true});
const parse=source=>{const p=prepareGbContent(source);return p.restore(marked.parse(p.body),marked);};
const table='<table><caption>表1</caption><tbody><tr><td>记录</td></tr></tbody></table>';
const figure='<figure><img src="x"><figcaption>图1</figcaption></figure>';

test('nine directives; labels are explicit, arbitrary text never implies a footnote',()=>{
 assert.equal(GB_BLOCKS.length,9);
 const plain=parse(':::gb-note\na）普通正文\n:::');
 assert.ok(!plain.includes('gb-label'));
 assert.match(plain,/gb-unlabelled/);
 assert.match(parse(':::gb-note label="注："\n说明\n:::'),/class="gb-label">注：/);
 assert.match(parse(':::gb-note label="a）" weight=normal\n说明\n:::'),/data-gb-note-weight="normal"/);
});

test('named parameters allow reordered, quoted, escaped values without accepting duplicate or unknown keys',()=>{
 const a='scope=table label="标签 有空格：" weight=normal';
 const b="weight='normal' label=\"标签 有空格：\" scope='table'";
 assert.equal(parse(`:::gb-note ${a}\n说明\n:::`),parse(`:::gb-note ${b}\n说明\n:::`));
 assert.deepEqual(parseGbParameters('label="a\\"b"',['label']),{label:'a"b'});
 for(const args of ['scope=table scope=figure','scope=','scope=term','kind=other','label=未闭合 文本','label="未闭合','foo=bar','position=unknown','align=justify','kind=source','label-weight=normal','label="a）" weight=heavy']) {
  assert.throws(()=>parse(`:::gb-note ${args}\n说明\n:::`),e=>e.status===400,args);
 }
});

test('removed directives and old bare labels fail, while fenced code remains literal',()=>{
 for(const old of ['source','unit','table-note','figure-note','table-footnote','figure-footnote','footnote']) {
  const source=`:::gb-${old}\n内容\n:::`;
  assert.throws(()=>parse(source),e=>e.status===400);
  assert.equal(parse('```text\n'+source+'\n```'),marked.parse('```text\n'+source+'\n```'));
 }
 assert.throws(()=>parse(':::gb-note 注：\n内容\n:::'),e=>e.status===400);
 assert.throws(()=>parse(':::gb-term id=test\n术语\n\n:::gb-source\n旧来源\n:::\n:::'),e=>e.status===400);
});

test('table and figure notes are authored after their object, with independent placement',()=>{
 for(const [scope,object] of [['table',table],['figure',figure]]) {
  const source=parse(`:::gb-note scope=${scope}${scope==='table'?' position=bottom-boxed':''}\n[来源：GB/T 1，表2]\n:::`);
  const top=parse(`:::gb-note position=top align=right scope=${scope} label="自定义：" weight=normal\n单位或其他内容\n:::`);
  const out=transformGbContent(object+source+top,'');
  assert.ok(out.indexOf('单位或其他内容')<out.indexOf('<tbody>')||scope==='figure');
  if(scope==='figure') assert.ok(out.indexOf('单位或其他内容')<out.indexOf('<img'));
  assert.equal((out.match(/来源：/g)||[]).length,1);
  assert.ok(out.indexOf('[来源：')<out.lastIndexOf(`</${scope}>`));
  assert.throws(()=>transformGbContent(top+object,''),e=>e.status===400);
  assert.throws(()=>transformGbContent(object+'<p>阻隔</p>'+top,''),e=>e.status===400);
  assert.throws(()=>transformGbContent(source,''),e=>e.status===400);
 }
});

test('explicit defaults are identical and unlabelled weight has no effect',()=>{
 const compact=parse(':::gb-note scope=table label="注："\n内容\n:::');
 const expanded=parse(':::gb-note align=left position=bottom weight=bold label="注：" scope=table\n内容\n:::');
 assert.equal(compact,expanded);
 assert.equal(parse(':::gb-note weight=normal\n内容\n:::'),parse(':::gb-note\n内容\n:::'));
});

test('multiple top and bottom notes keep per-position source order',()=>{
 const note=(position,text)=>parse(`:::gb-note scope=table position=${position} align=center label="标签："\n${text}\n:::`);
 const html=transformGbContent(table+note('bottom','B1')+note('top','T1')+note('bottom','B2')+note('top','T2'),'');
 assert.ok(html.indexOf('T1')<html.indexOf('T2')&&html.indexOf('T2')<html.indexOf('<tbody>'));
 assert.ok(html.indexOf('</tbody>')<html.indexOf('B1')&&html.indexOf('B1')<html.indexOf('B2'));
});

test('all completion forms parse and Markdown examples use the new grammar',async()=>{
 for(const form of GB_NOTE_FORMS) assert.doesNotThrow(()=>parse(`:::gb-note ${form.argument}\n${form.body||'说明'}\n:::`));
 for(const file of ['../web/examples/gb.md','../examples/gb.md','./fixtures/gb-ef.md']) {
  const {render}=await import('../src/render.mjs');
  const source=await readFile(new URL(file,import.meta.url),'utf8');
  await assert.doesNotReject(()=>render(source,{type:'gb',pagedHtml:true}));
 }
});
