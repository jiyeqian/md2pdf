import test from 'node:test';
import assert from 'node:assert/strict';
import { documentShortcut, currentTemplateType } from '../web/workspace-navigation.mjs';
test('document shortcuts cover Mac and Windows/Linux without consuming navigation or IME', () => {
  for (const modifier of ['metaKey','ctrlKey']) for (const [key, action] of [['s','save'],['o','open'],['p','pdf']]) {
    assert.equal(documentShortcut({key,[modifier]:true}), action);
    for (const flag of ['repeat','isComposing','altKey','shiftKey']) assert.equal(documentShortcut({key,[modifier]:true,[flag]:true}), null);
  }
  for (const key of ['l','t','w','r','f']) assert.equal(documentShortcut({key,ctrlKey:true}), null);
});
test('template association resolves effective type; only explicit type is forwarded', async () => {
  let body;
  const resolver = async value => { body=value; return {type:'paper'}; };
  assert.equal(await currentTemplateType({md:'---\ntype: paper\n---\n正文',opts:{theme:'elegant'}},resolver),'paper');
  assert.deepEqual(body.opts, {});
  await currentTemplateType({md:'正文',opts:{type:'skill',theme:'minimal'}},resolver);
  assert.deepEqual(body.opts,{type:'skill'});
  assert.equal(await currentTemplateType(null,resolver),'');
  assert.equal(await currentTemplateType({md:'正文'},async()=>null),'');
});
