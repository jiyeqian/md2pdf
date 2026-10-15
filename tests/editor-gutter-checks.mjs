import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/editor-gutter.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const { resolveVisible } = context.mdEditorGutterHelpers;
test('gutter defaults adapt to viewport before a manual choice', () => {
  assert.equal(resolveVisible(null, true), false);
  assert.equal(resolveVisible(null, false), true);
  assert.equal(resolveVisible('invalid', true), false);
});
test('saved manual gutter choice overrides either viewport default', () => {
  for (const small of [true, false]) {
    assert.equal(resolveVisible('shown', small), true);
    assert.equal(resolveVisible('hidden', small), false);
  }
});
