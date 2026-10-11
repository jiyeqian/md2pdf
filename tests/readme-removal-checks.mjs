import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { detectProfile, PROFILE_NAMES } from '../src/profiles.mjs';
test('README files use general and explicit removed type fails', () => {
  assert.deepEqual(PROFILE_NAMES, ['general', 'skill', 'paper', 'gb']);
  assert.equal(detectProfile({ basename: 'README.md', fm: {} }).name, 'general');
  assert.throws(() => detectProfile({ basename: '', fm: {}, explicit: 'readme' }), /未知文档类型/);
});
test('legacy draft migrates type without changing content or explicit settings', () => {
  const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('function applyStoredOptions('), source.indexOf('// 只收集'));
  const fields = Object.fromEntries(['type', 'theme', 'fontSize', 'margin', 'lineHeight'].map(name => [name, { value: '', tagName: 'INPUT' }]));
  fields.type.tagName = 'SELECT';
  fields.type.options = PROFILE_NAMES.map(value => ({ value }));
  const draft = { md: '# README\n\n保留正文', opts: { type: 'readme', theme: 'minimal', fontSize: '14', margin: '20', lineHeight: '1.6' } };
  const before = structuredClone(draft);
  const context = vm.createContext({ form: { elements: fields }, isRangeControl: () => false });
  vm.runInContext(fn, context);
  context.applyStoredOptions(draft.opts);
  assert.equal(fields.type.value, 'general');
  for (const key of ['theme', 'fontSize', 'margin', 'lineHeight']) assert.equal(fields[key].value, draft.opts[key]);
  assert.deepEqual(draft, before);
});
