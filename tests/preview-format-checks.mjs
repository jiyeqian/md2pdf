import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContentSourceMap } from '../src/content-source-map.mjs';
import { formatPreviewSelection as change } from '../web/preview-format.mjs';
function run(source, selected, format, occurrence = 0) {
  const item = buildContentSourceMap(source).find(x => x.kind === 'text');
  let index = -1; for (let i = 0; i <= occurrence; i++) index = source.indexOf(selected, index + 1);
  const result = change(source, { from: index, to: index + selected.length, item }, format);
  return result && source.slice(0, result.from) + result.insert + source.slice(result.to);
}
test('adds and removes formatting by source position', () => {
  assert.equal(run('abc abc', 'abc', 'bold', 1), 'abc **abc**');
  assert.equal(run('**abc**', 'abc', 'bold'), 'abc');
  assert.equal(run('*abc*', 'abc', 'italic'), 'abc');
  assert.equal(run('~~abc~~', 'abc', 'strike'), 'abc');
  assert.equal(run('**abcde**', 'bcd', 'bold'), '**a**bcd**e**');
  assert.equal(run('**a *b* c**', 'a *b* c', 'bold'), 'a *b* c');
});
test('rejects constructs or selections that cannot be verified safely', () => {
  for (const source of ['a &amp; b', 'a \\*b', '[abc](url)', 'a $x$ b', 'a `b` c']) assert.equal(run(source, 'a', 'bold'), null, source);
  assert.equal(run('**ab** cd', 'ab** cd', 'bold'), null);
  assert.equal(run('**a *b* c**', 'a *b*', 'bold'), null);
  assert.equal(run('a b', 'a ', 'bold'), null);
  assert.equal(run('**abc**', 'abc', 'italic'), '**_abc_**');
  assert.equal(run('*abc*', 'abc', 'bold'), '*__abc__*');
  assert.equal(run('~~abc~~', 'abc', 'bold'), '~~**abc**~~');
  assert.equal(run('**abc**', 'abc', 'strike'), '**~~abc~~**');
  assert.equal(run('~~abc~~', 'abc', 'italic'), '~~*abc*~~');
  assert.equal(run('*abc*', 'abc', 'strike'), '*~~abc~~*');
  assert.equal(run('(abc)', '(abc)', 'bold'), null);
});
