import test from 'node:test';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enhancePreview } from '../src/preview.mjs';

const source = readFileSync(new URL('../web/panel-sidebars.js', import.meta.url), 'utf8');
const html = enhancePreview('<!doctype html><html><head></head><body></body></html>');

test('sidebar protocol accepts only the active preview frame and bounded heading navigation', () => {
  assert.ok(source.includes('event.source !== preview.contentWindow'));
  assert.ok(html.includes('event.source !== parent'));
  assert.ok(html.includes('!Number.isSafeInteger(event.data.index)'));
  assert.ok(html.includes('event.data.index >= outlineHeadings.length'));
  assert.ok(source.includes('button.textContent = item.text'));
});

test('outline uses the paginated heading tree and reports scroll selection', () => {
  assert.ok(html.includes("activeNodes('h1,h2,h3,h4,h5,h6')"));
  assert.ok(html.includes("!node.closest('.toc')"));
  assert.ok(html.includes("!node.hasAttribute('data-split-from')"));
  assert.ok(html.includes("type:'md2pdf-outline-current'"));
  assert.ok(html.includes('sendOutline();'));
  assert.ok(source.includes("button.setAttribute('aria-current', 'location')"));
});

test('docked sidebars stay open during editing, reading and panel mode changes', () => {
  assert.ok(!source.includes("document.addEventListener('pointerdown'"));
  assert.ok(!source.includes("data.type === 'md2pdf-preview-pointerdown'"));
  assert.ok(source.includes('dock.append(element)'));
  assert.ok(source.includes('main.before(dock); dock.append(main)'));
  assert.ok(!source.includes('element.style.top'));
  assert.ok(!source.includes('element.style.bottom'));
  assert.ok(source.includes('event.stopImmediatePropagation()'));
  assert.ok(html.includes("if (sidebarOpen) { parent.postMessage({type:'md2pdf-sidebar-escape'}"));
  assert.ok(source.includes("resize.setPointerCapture(event.pointerId)"));
  assert.ok(source.includes("e.key === 'ArrowLeft'"));
});

test('outline branches use accessible disclosure controls and retain path collapse state', () => {
  assert.ok(source.includes("disclosure.setAttribute('aria-expanded', String(expanded))"));
  assert.ok(source.includes("disclosure.setAttribute('aria-label', '折叠或展开：' + item.text)"));
  assert.ok(source.includes('const collapsedOutlinePaths = new Set()'));
  assert.ok(source.includes('JSON.stringify([parent.key, item.level, item.text])'));
  assert.ok(source.includes('children.hidden = !expanded'));
});


const pro = readFileSync(new URL('../web/editor-pro.js', import.meta.url), 'utf8');
test('assistant sections are ordered with collapsed diagnostics and type details', () => {
  assert.ok(pro.includes('body.append(outlineSection, diagSection, typeSection)'));
  assert.ok(pro.includes("const diagSection = el('details'"));
  assert.ok(pro.includes("const typeSection = el('details'"));
  assert.ok(!pro.includes('diagSection.open'));
  assert.ok(!pro.includes('typeSection.open'));
  assert.ok(pro.includes('const collapsedEditorOutline = new Set()'));
  assert.ok(pro.includes("disclosure.setAttribute('aria-expanded', String(expanded))"));
  assert.ok(pro.includes('editor.goToLine(heading.line)'));
});


test('task insertion converts existing list markers and places the caret after an empty task', () => {
  const start = pro.indexOf('function transformLines(');
  const fn = pro.slice(start, pro.indexOf('\nfunction ', start + 1));
  const markText = pro.match(/const LIST_MARK = ([^;]+);/)[1];
  const anyMarkText = pro.match(/const ANY_LIST_MARK = ([^;]+);/)[1];
  for (const [value, expected] of [['', '- [ ] '], ['1. One\n- [x] Two', '- [ ] One\n- [ ] Two'], ['One\n\nTwo', '- [ ] One\n\n- [ ] Two']]) {
    let result, selection;
    const sandbox = {
      getApi: () => ({getValue: () => value, replaceRange: (from, to, text) => { result = value.slice(0, from) + text + value.slice(to); }}),
      coreHelpers: () => ({offsetToLine: (text, pos) => text.slice(0, pos).split('\n').length, lineToOffset: (text, line) => text.split('\n').slice(0, line - 1).reduce((n, x) => n + x.length + 1, 0)}),
      HEADING_PREFIX: {}, selectRange: (from, to) => {selection = [from, to];},
    };
    vm.runInNewContext(`const LIST_MARK = ${markText}; const ANY_LIST_MARK = ${anyMarkText};` + fn + `\n;transformLines({from:0,to:${value.includes('\n') ? value.length : 0}}, 'task-list');`, sandbox);
    assert.equal(result, expected);
    if (!value) assert.deepEqual(selection, [6, 6]);
  }
});
