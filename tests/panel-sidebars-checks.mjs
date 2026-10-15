import test from 'node:test';
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
  assert.ok(html.includes('.pagedjs_pages h1,.pagedjs_pages h2'));
  assert.ok(html.includes("!node.closest('.toc')"));
  assert.ok(html.includes("!node.hasAttribute('data-split-from')"));
  assert.ok(html.includes("type:'md2pdf-outline-current'"));
  assert.ok(html.includes('sendOutline();'));
  assert.ok(source.includes("button.setAttribute('aria-current', 'location')"));
});

test('sidebar dismiss respects panel mode buttons and prioritizes Escape over fullscreen', () => {
  assert.ok(source.includes('.md-panel-mode,[data-panel-fullscreen]'));
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
