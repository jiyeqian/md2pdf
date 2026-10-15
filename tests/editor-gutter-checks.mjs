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


test('toolbar button fixes gutter axis and toggle position across visibility changes', () => {
  let click, hidden = false, frame, gutterWidth = 42;
  const style = {};
  const button = {style:{setProperty:(key,value) => style[key] = value}, setAttribute(){}, addEventListener(type, handler){if(type === 'click') click = handler;}};
  const gutter = {getBoundingClientRect:() => ({left:10, width:hidden ? 0 : gutterWidth})};
  const footer = {prepend(){}, getBoundingClientRect:() => ({left:10})};
  const openButton = {getBoundingClientRect:() => ({left:20, width:28})};
  const panel = {style:{setProperty(){}}, querySelector:selector => selector === '.editor-footer' ? footer : selector.includes('打开 Markdown') ? openButton : gutter, classList:{toggle:(name,value) => hidden = value}};
  const context = vm.createContext({document:{querySelector:() => panel, createElement:() => button, addEventListener(){}}, matchMedia:() => ({matches:false, addEventListener(){}}), localStorage:{getItem:() => null, setItem(){}}, ResizeObserver:class{observe(){} unobserve(){}}, MutationObserver:class{observe(){}}, requestAnimationFrame:callback => {frame = callback; return 1;}, addEventListener(){}});
  vm.runInContext(source, context);
  frame();
  assert.equal(style['--gutter-button-slot'], '48px');
  click(); frame();
  assert.equal(hidden, true);
  assert.equal(style['--gutter-button-slot'], '48px');
  frame();
  assert.equal(style['--gutter-button-slot'], '48px');
  gutterWidth = 50; click(); frame();
  assert.equal(hidden, false);
  assert.equal(style['--gutter-button-slot'], '48px');
  click(); frame();
  assert.equal(style['--gutter-button-slot'], '48px');
});
