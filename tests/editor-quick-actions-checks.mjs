import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionActions,transformSelection,isProtected,slashActions} from '../web/editor-quick-actions.mjs';
function edit(text,from,to,action) {const c=transformSelection(text,from,to,action);return {text:text.slice(0,c.from)+c.text+text.slice(c.to),from:c.anchor,to:c.head};}
test('single source line offers character actions, newline offers blocks',()=>{assert.deepEqual(selectionActions('a b',0,3),['link','bold','italic','strike']);assert.deepEqual(selectionActions('a\nb',0,3),['ul','ol','quote']);});
test('character actions retain original selection and toggle surrounding markers',()=>{for(const a of ['bold','italic','strike','link']){const first=edit('one two',0,3,a);assert.equal(first.text.slice(first.from,first.to),'one');assert.equal(edit(first.text,first.from,first.to,a).text,'one two');}});
test('block conversion preserves indentation and does not stack list markers',()=>{const input='  - a\n  - b';const out=edit(input,4,input.length,'ol');assert.equal(out.text,'  1. a\n  2. b');assert.equal(out.text.slice(out.from,out.to),'a\n  2. b');assert.equal(edit(out.text,out.from,out.to,'ol').text,'  a\n  b');});
test('selection ending at next line start excludes that line',()=>{const out=edit('a\nb\nc',0,4,'ul');assert.equal(out.text,'- a\n- b\nc');assert.equal(out.text.slice(out.from,out.to),'a\n- b\n');});
test('mixed blocks are normalized and one-line source does not offer block edits',()=>{assert.equal(edit('- a\nb',0,5,'ul').text,'- a\n- b');assert.equal(transformSelection('a',0,1,'ul'),null);});
test('protected regions suppress actions, including crossed and unclosed fences',()=>{for(const input of ['---\ntitle: a\n---\nx','```js\nx\n```\ny','$$\nx\n$$\ny','~~~\nx']){assert.equal(isProtected(input,1),true);assert.deepEqual(selectionActions(input,0,input.length),[]);}assert.equal(isProtected('x\n```\na\n```\ny',0),false);});

test('slash commands use scoped triggers and exact replacement spans',()=>{
  for(const text of ['/r','  /r']) assert.deepEqual(slashActions(text,text.length),{from:text.length-2,actions:['table','image','figure']});
  for(const text of ['/b','正文/b','正文/b后续']) {const pos=text.indexOf('/b')+2;assert.deepEqual(slashActions(text,pos),{from:pos-2,actions:['footnote','bibliography','doi']});}
  for(const text of ['正文/r','/m','/more','/book','```\n/b','---\n/b\n---','$$\n/m\n$$']) assert.equal(slashActions(text,text.includes('\n')?text.indexOf('/')+2:text.length),null);
});

test('symmetric icon commands distinguish insertions and existing-target references',()=>{
 for(const [text,actions] of [['/',['codeblock']],['/e',['formula']],['\\r',['ref']],['正文\\e',['eqref']],['正文\\b',['noteref']]]) assert.deepEqual(slashActions(text,text.length)?.actions,actions);
 for(const text of ['正文/e','正文/','\\book','\\ref{','---\n\\b\n---','---\n\\b','```\n\\r']) assert.equal(slashActions(text,text.includes('\n')?text.indexOf('\\')+2:text.length),null);
});
