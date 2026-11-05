import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { capturePreviewTransfer, installPreviewTransfer, installPreviewPositionStream, installPreviewSelection, readPreviewTransferState } from '../src/preview-window-transfer.mjs';
import { enhancePreview } from '../src/preview.mjs';

const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
class Element {
  constructor(tag, attrs = {}, text = '') {
    this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.textContent = text; this.children = [];
    this.style = { setProperty() {} };
    this.classList = { remove: name => { this.attrs.class = (this.attrs.class || '').split(/\s+/).filter(value => value !== name).join(' '); },
      contains: name => (this.attrs.class || '').split(/\s+/).includes(name), toggle: (name, on) => {
        this.classList.remove(name); if (on) this.attrs.class = ((this.attrs.class || '') + ' ' + name).trim();
      } };
  }
  get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
  get id() { return this.attrs.id || ''; }
  set id(value) { this.attrs.id = value; }
  set type(value) { this.attrs.type = value; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  removeAttribute(name) { delete this.attrs[name]; }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  prepend(node) { node.parentNode = this; this.children.unshift(node); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); }
  cloneNode(deep) { const clone = new Element(this.tagName, this.attrs, this.textContent); if (deep) this.children.forEach(node => clone.appendChild(node.cloneNode(true))); return clone; }
  matches(selector) {
    if (selector === '*') return true;
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    const match = /^(\w+)?(?:\[([^=\]]+)(?:="([^"]*)")?\])?$/.exec(selector);
    return !!match && (!match[1] || match[1].toUpperCase() === this.tagName) && (!match[2] || this.hasAttribute(match[2]) && (match[3] === undefined || this.getAttribute(match[2]) === match[3]));
  }
  querySelectorAll(selector) {
    const choices = selector.split(','); const result = [];
    const visit = parent => parent.children.forEach(node => { if (choices.some(choice => node.matches(choice))) result.push(node); visit(node); });
    visit(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getElementsByTagName(tag) { return this.querySelectorAll(tag); }
  get outerHTML() {
    const attrs = this.attributes.map(({ name, value }) => ` ${name}="${escape(value)}"`).join('');
    const text = ['SCRIPT', 'STYLE'].includes(this.tagName) ? this.textContent : escape(this.textContent);
    return `<${this.tagName.toLowerCase()}${attrs}>${text}${this.children.map(node => node.outerHTML).join('')}</${this.tagName.toLowerCase()}>`;
  }
}

function fixture() {
  const html = new Element('html'), head = html.appendChild(new Element('head')), body = html.appendChild(new Element('body'));
  head.appendChild(new Element('meta', { 'http-equiv': 'Content-Security-Policy', content: "default-src 'none'; script-src 'unsafe-inline' data:; font-src data:;" }));
  const style = head.appendChild(new Element('style', { 'data-pagedjs-inserted-styles': '' }));
  style.sheet = { cssRules: [{ cssText: '.pagedjs_page { width: 794px; }' }, { cssText: '@font-face { font-family: Example; src: url(data:font/woff2;base64,AAAA); }' }] };
  head.appendChild(new Element('script', { src: 'data:text/javascript;base64,LAYOUT' }, 'window.layoutWasRun=true;'));
  head.appendChild(new Element('script', { type: 'application/json', 'data-md2pdf-content-map': '' }, '[{"id":0,"from":1}]'));
  const pages = body.appendChild(new Element('div', { class: 'pagedjs_pages' }));
  const page = pages.appendChild(new Element('div', { class: 'pagedjs_page' }));
  page.appendChild(new Element('p', { 'data-md2pdf-source-id': '0', class: 'md2pdf-preview-target', onclick: 'unwanted()' }, 'already laid out'));
  const flow = body.appendChild(new Element('div', { id: 'md2pdf-preview-flow' }, 'continuous copy'));
  const svg = flow.appendChild(new Element('svg')); svg.appendChild(new Element('path', { id: 'md2pdf-flow-glyph', d: 'M0 0L1 1' }));
  svg.appendChild(new Element('use', { href: 'https://old-window.invalid/#md2pdf-flow-glyph', fill: 'url(https://old-window.invalid/#md2pdf-flow-glyph)' }));
  body.appendChild(new Element('div', { 'data-md2pdf-sync-highlight': '' }, 'temporary overlay'));
  body.appendChild(new Element('script', { 'data-md2pdf-preview-enhance': '1' }, 'var MD2PDF_PREVIEW_REVISION = 12; var MD2PDF_PREVIEW_MANAGED = true;'));
  body.appendChild(new Element('script', {}, 'window.PagedPolyfill.preview();'));
  body.appendChild(new Element('iframe', { src: 'https://unwanted.invalid' }));
  const document = { documentElement: html, head, body, querySelectorAll: selector => html.querySelectorAll(selector), querySelector: selector => html.querySelector(selector),
    createElement: tag => new Element(tag), getElementById: id => html.querySelector('#' + id), addEventListener() {} };
  return { document, style, pages, flow };
}

const state = () => ({ version: 1, zoom: 135, flow: true, position: { from: 17, anchorRatio: .31, line: 3, offset: -.5, ratio: .4 }, fonts: ['Example'] });

test('capture preserves computed pages, flow, CSSOM fonts, source IDs and CSP; strips active work and transient UI', () => {
  const { document, style } = fixture(); const snapshot = capturePreviewTransfer(document, state());
  assert.ok(snapshot.startsWith('<!DOCTYPE html>'));
  assert.ok(snapshot.includes('already laid out') && snapshot.includes('continuous copy') && snapshot.includes('md2pdf-flow-glyph'));
  assert.ok(snapshot.includes('href="#md2pdf-flow-glyph"') && snapshot.includes('fill="url(#md2pdf-flow-glyph)"'));
  assert.ok(snapshot.includes('.pagedjs_page { width: 794px; }') && snapshot.includes('data:font/woff2;base64,AAAA'));
  assert.ok(snapshot.includes('data-md2pdf-source-id="0"') && snapshot.includes('data-md2pdf-content-map'));
  assert.ok(snapshot.includes('Content-Security-Policy') && snapshot.includes("default-src 'none'"));
  assert.equal((snapshot.match(/<script\b/g) || []).length, 3, 'only enhancement runtime and two inert metadata nodes remain');
  assert.ok(snapshot.includes('var MD2PDF_PREVIEW_REVISION = 12; var MD2PDF_PREVIEW_MANAGED = true;'));
  assert.ok(!snapshot.includes('PagedPolyfill.preview()') && !snapshot.includes('LAYOUT') && !snapshot.includes('layoutWasRun'));
  assert.ok(!snapshot.includes('temporary overlay') && !snapshot.includes('md2pdf-preview-target') && !snapshot.includes('onclick=') && !snapshot.includes('<iframe'));
  assert.equal(style.textContent, '', 'capture does not mutate live styles');
  assert.ok(document.querySelector('[data-md2pdf-sync-highlight]'), 'capture does not mutate live highlights');
});

test('transfer state is inert JSON and rejects malformed or incompatible records', () => {
  const { document } = fixture(); const value = state(); value.fonts = ['</script><script>unwanted()</script>'];
  const snapshot = capturePreviewTransfer(document, value);
  assert.ok(snapshot.includes('\\u003c/script>\\u003cscript>unwanted()'));
  const read = value => readPreviewTransferState({ querySelector: () => ({ textContent: typeof value === 'string' ? value : JSON.stringify(value) }) });
  assert.deepEqual(read(state()), state());
  for (const value of ['{', { ...state(), version: 2 }, { ...state(), zoom: 0 }, { ...state(), flow: 'true' }, { ...state(), position: { ratio: 1, offset: null } }, { ...state(), position: { ratio: 2, offset: 0 } }]) assert.equal(read(value), null);
  const sanitized = read({ ...state(), position: { ...state().position, from: -1, line: -3 }, fonts: ['Valid', 3, null] });
  assert.equal(sanitized.position.from, undefined); assert.equal(sanitized.position.line, 0); assert.deepEqual(sanitized.fonts, ['Valid']);
});

test('capture restores only trusted runtime source when pagination removed its DOM element', () => {
  const { document } = fixture();
  document.querySelector('script[data-md2pdf-preview-enhance="1"]').remove();
  assert.throws(() => capturePreviewTransfer(document, state()), /缺少运行时/);
  const trusted = 'var MD2PDF_PREVIEW_REVISION = 12; var MD2PDF_PREVIEW_MANAGED = true;';
  const snapshot = capturePreviewTransfer(document, state(), trusted);
  assert.ok(snapshot.includes('<script data-md2pdf-preview-enhance="1">' + trusted + '</script>'));
  assert.equal((snapshot.match(/<script\b/g) || []).length, 3);
  assert.ok(!snapshot.includes('PagedPolyfill.preview()') && !snapshot.includes('LAYOUT'));
  assert.equal(document.querySelector('script[data-md2pdf-preview-enhance="1"]'), null, 'live DOM remains unchanged');
});

test('capture protocol requires the current parent, revision, readiness and bounded request ID', () => {
  let handler, ready = false, captures = 0; const messages = [], parent = { postMessage: message => messages.push(message) };
  installPreviewTransfer({ parent, revision: () => 12, isReady: () => ready, capture: () => { captures++; return { html: '<html>computed</html>', position: state().position }; }, listen: (type, callback) => { assert.equal(type, 'message'); handler = callback; } });
  const command = { type: 'md2pdf-transfer-capture', id: 'capture-1', revision: 12 };
  handler({ source: parent, data: command }); assert.equal(captures, 0);
  ready = true;
  for (const event of [{ source: {}, data: command }, { source: parent, data: { ...command, revision: 11 } }, { source: parent, data: { ...command, id: '' } }, { source: parent, data: { ...command, id: 'x'.repeat(101) } }, { source: parent, data: { ...command, type: 'other' } }]) handler(event);
  assert.equal(captures, 0);
  handler({ source: parent, data: command });
  assert.equal(captures, 1);
  assert.deepEqual(messages, [{ type: 'md2pdf-transfer-snapshot', id: 'capture-1', revision: 12, html: '<html>computed</html>', position: state().position }]);
});

test('capture failures report only the request and revision', () => {
  let handler; const messages = [], parent = { postMessage: message => messages.push(message) };
  installPreviewTransfer({ parent, revision: () => 2, isReady: () => true, capture: () => { throw new Error('private internals'); }, listen: (_, callback) => { handler = callback; } });
  handler({ source: parent, data: { type: 'md2pdf-transfer-capture', id: 'x', revision: 2 } });
  assert.deepEqual(messages, [{ type: 'md2pdf-transfer-error', id: 'x', revision: 2 }]);
});

test('window position stream validates control messages and throttles all scroll origins independently of content sync', () => {
  const handlers = {}, frames = [], messages = []; let captures = 0, current = 12;
  const parent = { postMessage: message => messages.push(message) };
  installPreviewPositionStream({ parent, revision: () => current, capturePosition: () => { captures++; return { ratio: captures / 10 }; },
    listen: (type, callback) => { handlers[type] = callback; }, frame: callback => frames.push(callback) });
  const control = { type: 'md2pdf-window-position-stream', revision: 12, enabled: true };
  handlers.scroll(); assert.equal(frames.length, 0);
  for (const event of [{ source: {}, data: control }, { source: parent, data: { ...control, revision: 11 } }, { source: parent, data: { ...control, enabled: 'true' } }]) handlers.message(event);
  handlers.scroll(); assert.equal(frames.length, 0);
  handlers.message({ source: parent, data: control });
  handlers.scroll(); handlers.scroll(); handlers.scroll();
  assert.equal(frames.length, 1); assert.equal(captures, 0);
  frames.shift()();
  assert.deepEqual(messages, [{ type: 'md2pdf-position', id: 'window-position', revision: 12, position: { ratio: .1 } }]);
  handlers.scroll(); handlers.message({ source: parent, data: { ...control, enabled: false } }); frames.shift()();
  assert.equal(captures, 1, 'disable also cancels a queued report');
  current = 13;
  handlers.message({ source: parent, data: control }); handlers.scroll(); assert.equal(frames.length, 0, 'old revision cannot reenable');
  handlers.message({ source: parent, data: { ...control, revision: current } }); handlers.selectionchange(); frames.shift()();
  assert.equal(messages.at(-1).revision, current); assert.equal(captures, 2);
});

function textSelectionFixture() {
  const element = (tag, ...children) => {
    const node = { nodeType: 1, tagName: tag.toUpperCase(), id: tag === 'main' ? 'md2pdf-preview-flow' : '', childNodes: children };
    children.forEach(child => { child.parentNode = node; });
    node.contains = child => { while (child) { if (child === node) return true; child = child.parentNode; } return false; };
    node.focus = () => { throw new Error('selection restoration must not focus'); };
    return node;
  };
  const text = data => ({ nodeType: 3, data, childNodes: [] });
  const first = text('ab'), middle = text('c🚀'), last = text(' def'), ignored = text('not selected');
  const root = element('main', first, element('strong', middle), element('style', ignored), last);
  const selection = { rangeCount: 1, anchorNode: last, anchorOffset: 3, focusNode: middle, focusOffset: 1, calls: 0,
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) { this.calls++; Object.assign(this, { rangeCount: 1, anchorNode, anchorOffset, focusNode, focusOffset }); } };
  return { root, first, middle, last, ignored, selection };
}

test('native selection preserves backward direction and endpoints across text nodes and completed clones', () => {
  const original = textSelectionFixture(); let active = original;
  const api = installPreviewSelection({ activeScope: () => active.root, getSelection: () => active.selection });
  const saved = api.capture();
  assert.deepEqual(saved, { version: 1, scope: 'flow', anchor: 8, focus: 3, anchorBias: 1, focusBias: 1 });
  active = textSelectionFixture(); active.selection.rangeCount = 0; active.selection.anchorNode = active.selection.focusNode = null;
  assert.equal(api.restore(saved), true);
  assert.equal(active.selection.anchorNode, active.last); assert.equal(active.selection.anchorOffset, 3);
  assert.equal(active.selection.focusNode, active.middle); assert.equal(active.selection.focusOffset, 1);
  assert.equal(active.selection.calls, 1);
  assert.equal(api.restore(saved), true); assert.equal(active.selection.calls, 1, 'unchanged selection does not cause another selectionchange');
});

test('native selection handles element boundaries and text-end affinity while excluding style content', () => {
  const env = textSelectionFixture();
  const api = installPreviewSelection({ activeScope: () => env.root, getSelection: () => env.selection });
  Object.assign(env.selection, { anchorNode: env.first, anchorOffset: 2, focusNode: env.root, focusOffset: 2 });
  const saved = api.capture();
  assert.equal(saved.anchor, 2); assert.equal(saved.anchorBias, -1); assert.equal(saved.focus, 5);
  env.selection.anchorNode = null; env.selection.focusNode = null;
  assert.equal(api.restore(saved), true);
  assert.equal(env.selection.anchorNode, env.first); assert.equal(env.selection.anchorOffset, 2);
  assert.equal(env.selection.focusNode, env.last); assert.equal(env.selection.focusOffset, 0);
  Object.assign(env.selection, { anchorNode: env.ignored, anchorOffset: 0 });
  assert.equal(api.capture(), null, 'style text cannot be captured as visible selection');
});

test('invalid or null native selection never clears or changes a newer selection', () => {
  const env = textSelectionFixture(), api = installPreviewSelection({ activeScope: () => env.root, getSelection: () => env.selection });
  const valid = api.capture();
  for (const value of [null, { ...valid, scope: 'paged' }, { ...valid, anchor: -1 }, { ...valid, focus: Infinity }, { ...valid, focus: 16777217 }, { ...valid, anchor: 10 }, { ...valid, version: 2 }]) assert.equal(api.restore(value), false);
  assert.equal(env.selection.calls, 0);
  assert.equal(env.selection.anchorNode, env.last); assert.equal(env.selection.focusNode, env.middle);
  api.protect(); env.selection.rangeCount = 0;
  assert.deepEqual(api.capture(), valid, 'brief visibility changes preserve the captured nonempty range');
  api.clearProtection(); assert.equal(api.capture(), null, 'new user input releases transition protection');
});

test('native selection and mirror highlight survive transfer state filtering', () => {
  const env = textSelectionFixture(), selection = installPreviewSelection({ activeScope: () => env.root, getSelection: () => env.selection }).capture();
  const value = state(); value.position.selection = selection; value.position.highlight = { from: 2, to: 9 }; value.position.revision = 12;
  const parsed = readPreviewTransferState({ querySelector: () => ({ textContent: JSON.stringify(value) }) });
  assert.deepEqual(parsed.position.selection, selection); assert.deepEqual(parsed.position.highlight, { from: 2, to: 9 });
  assert.equal(parsed.position.revision, 12);
  value.position.selection.anchor = NaN; value.position.highlight.to = -1;
  const invalid = readPreviewTransferState({ querySelector: () => ({ textContent: JSON.stringify(value) }) });
  assert.equal(invalid.position.selection, null); assert.equal(invalid.position.highlight, null);
});

test('rehydration reuses existing flow, flags work ready, and restores state without calling layout or rebinding source', async () => {
  const { document, flow, pages } = fixture();
  document.head.appendChild(new Element('script', { type: 'application/json', 'data-md2pdf-transfer-state': '' }, JSON.stringify({ ...state(), position: { line: 0, offset: 0, ratio: .4 } })));
  document.head.appendChild(new Element('style', { id: 'md2pdf-preview-screen' }));
  document.documentElement.clientWidth = 600; document.documentElement.scrollHeight = 2000; document.fonts = { ready: Promise.resolve() };
  const handlers = {}, frames = [], messages = [], scrolls = []; const parent = { postMessage: value => messages.push(value) };
  const window = { PagedPolyfill: { preview() { throw new Error('layout must not run'); } } };
  const sandbox = { document, parent, window, innerHeight: 500, scrollY: 0, requestAnimationFrame: callback => frames.push(callback), setTimeout() {}, clearTimeout() {}, scrollTo: (...args) => scrolls.push(args),
    addEventListener: (type, callback) => (handlers[type] ||= []).push(callback) };
  const html = enhancePreview('<html><head></head><body></body></html>');
  const runtime = /<script data-md2pdf-preview-enhance="1">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.doesNotThrow(() => new Function(runtime));
  vm.runInNewContext(runtime.replace('})();', 'window.transferTest={flowRoot:function(){return flowRoot;},snapshot:function(){return flowSnapshot;}};})();'), sandbox);
  assert.equal(window.__md2pdfMathReady, true); assert.equal(window.__md2pdfMermaidReady, true); assert.equal(window.__md2pdfPagedReady, true);
  assert.equal(window.transferTest.flowRoot(), flow);
  window.__md2pdfPreviewSnapshot(); assert.equal(window.transferTest.snapshot(), null);
  handlers.load.forEach(callback => callback()); handlers.load.forEach(callback => callback()); await Promise.resolve();
  assert.equal(flow.style.zoom, 1.35); assert.equal(frames.length, 1);
  assert.ok(!messages.some(message => message.type === 'md2pdf-ready'), 'ready waits for restored position even if initialization was requested twice');
  frames.shift()();
  assert.deepEqual(scrolls, [[0, 600]]);
  assert.ok(messages.some(message => message.type === 'md2pdf-ready'));
  assert.ok(messages.some(message => message.type === 'md2pdf-outline'));
  assert.ok(document.documentElement.classList.contains('md2pdf-preview-flow'));
  assert.equal(document.querySelector('.pagedjs_pages'), pages);
});

test('transfer keeps only a valid source outline target', () => {
  const value={version:1,zoom:100,flow:false,position:{offset:0,ratio:0,outline:42}};
  const read=()=>readPreviewTransferState({querySelector:()=>({textContent:JSON.stringify(value)})});
  assert.equal(read().position.outline,42);
  value.position.outline=-1;assert.equal(read().position.outline,undefined);
  value.position.outline=1.5;assert.equal(read().position.outline,undefined);
});
