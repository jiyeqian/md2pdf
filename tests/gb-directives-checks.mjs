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
 assert.match(parse(':::gb-note label="a）" label-weight=normal\n说明\n:::'),/data-gb-label-weight="normal"/);
});

test('named parameters allow reordered, quoted, escaped values without accepting duplicate or unknown keys',()=>{
 const a='scope=table label="标签 有空格：" label-weight=normal';
 const b="label-weight='normal' label=\"标签 有空格：\" scope='table'";
 assert.equal(parse(`:::gb-note ${a}\n说明\n:::`),parse(`:::gb-note ${b}\n说明\n:::`));
 assert.deepEqual(parseGbParameters('label="a\\"b"',['label']),{label:'a"b'});
 for(const args of ['scope=table scope=figure','scope=','scope=term','kind=other','label=未闭合 文本','label="未闭合','foo=bar','kind=source label="注："','kind=unit','label-weight=normal','label="a）" label-weight=heavy']) {
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

test('table and figure sources follow their own objects; unit precedes and stays inside its object',()=>{
 for(const [scope,object] of [['table',table],['figure',figure]]) {
  const source=parse(`:::gb-note kind=source scope=${scope}\n[来源：GB/T 1，表2]\n:::`);
  const out=transformGbContent(object+source,'');
  assert.ok(out.indexOf('[<span class="gb-label">来源：')<out.lastIndexOf(`</${scope}>`));
  assert.equal((out.match(/来源：/g)||[]).length,1);
  const unit=parse(`:::gb-note kind=unit scope=${scope}\n单位为毫米\n:::`);
  assert.match(transformGbContent(unit+object,''),/单位为毫米/);
  assert.throws(()=>transformGbContent(unit+'<p>阻隔</p>'+object,''),e=>e.status===400);
  assert.throws(()=>transformGbContent(source,''),e=>e.status===400);
  assert.throws(()=>transformGbContent(object+'<p>阻隔</p>'+source,''),e=>e.status===400);
  assert.throws(()=>transformGbContent(object+unit,''),e=>e.status===400);
 }
});

test('all completion forms parse and Markdown examples use the new grammar',async()=>{
 for(const form of GB_NOTE_FORMS) assert.doesNotThrow(()=>parse(`:::gb-note ${form.argument}\n${form.body||'说明'}\n:::`));
 for(const file of ['../web/examples/gb.md','../examples/gb.md','./fixtures/gb-ef.md']) {
  const {render}=await import('../src/render.mjs');
  const source=await readFile(new URL(file,import.meta.url),'utf8');
  await assert.doesNotReject(()=>render(source,{type:'gb',pagedHtml:true}));
 }
});
