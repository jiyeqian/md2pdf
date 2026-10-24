import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { enhancePreview, PREVIEW_SCREEN_CSS } from '../src/preview.mjs';

function runtime() {
  const html = enhancePreview('<html><head></head><body><main></main></body></html>');
  return /<script data-md2pdf-preview-enhance="1">([\s\S]*?)<\/script>/.exec(html)[1];
}
function harness() {
  const handlers = {}, messages = [], frames = [], classes = new Set();
  const root = { querySelectorAll: () => [], getElementsByTagName: () => [] };
  const parent = { postMessage: message => messages.push(message) };
  const document = {
    documentElement: { clientWidth: 600, scrollHeight: 1000, classList: { toggle(name, value) { value ? classes.add(name) : classes.delete(name); } } },
    body: { children: [], style: {setProperty() {}} },
    querySelectorAll: () => [], querySelector: selector => selector === '.pagedjs_pages' ? root : null,
    addEventListener() {}, getElementById: () => null,
    createDocumentFragment: () => ({children: [], appendChild(node) {this.children.push(node);}}),
  };
  const sandbox = { document, parent, innerHeight: 500, scrollY: 0, scrollBy() {}, scrollTo() {}, getComputedStyle: () => ({ getPropertyValue: () => 'value' }),
    addEventListener(type, callback) { (handlers[type] ||= []).push(callback); },
    requestAnimationFrame(callback) {frames.push(callback);}, setTimeout() {}, clearTimeout() {}, window: {},
  };
  vm.runInNewContext(runtime().replace('})();', 'window.flowTest = {mode:function(){return MD2PDF_PREVIEW_FLOW;},snapshot:function(){return flowSnapshot;},setRoot:function(root){flowRoot=root;},fit:fit};})();'), sandbox);
  return { ...sandbox, classes, frames, messages, root, send(data, source = parent) {for (const callback of handlers.message) callback({data, source});} };
}

test('snapshot hook wraps only enhanced preview pagination and runs before pagination', () => {
  const source = '<body><script>window.PagedPolyfill.preview().then(done)</script></body>';
  const enhanced = enhancePreview(source);
  assert.match(enhanced, /__md2pdfPreviewSnapshot\(\), window\.PagedPolyfill\.preview\(\)/);
  assert.equal(enhancePreview(enhanced), enhanced);
  assert.ok(source.includes('window.PagedPolyfill.preview().then(done)'));
  assert.doesNotThrow(() => new Function(runtime()));
});

test('snapshot clones original body once while detached, excluding scripts and paginated output', () => {
  const env = harness(); let clones = 0;
  const original = {tagName: 'MAIN', classList: {contains: () => false}, cloneNode(deep) {assert.equal(deep, true); clones++; return {textContent: 'continuous paragraph', querySelectorAll: () => []};}};
  env.document.body.children = [original, {tagName: 'SCRIPT'}, {tagName: 'DIV', classList: {contains: () => true}}];
  env.window.__md2pdfPreviewSnapshot(); env.window.__md2pdfPreviewSnapshot();
  assert.equal(clones, 1);
  assert.equal(env.window.flowTest.snapshot().children[0].textContent, 'continuous paragraph');
  assert.equal(env.document.body.children.length, 3);
});

test('mode messages validate parent, revision and enum; duplicate messages do not restore scroll', () => {
  const env = harness();
  const command = {type: 'md2pdf-preview-mode', mode: 'flow', revision: 0};
  env.send(command, {}); env.send({...command, revision: 1}); env.send({...command, mode: 'other'});
  assert.equal(env.window.flowTest.mode(), false);
  env.send(command);
  assert.equal(env.window.flowTest.mode(), true);
  assert.equal(env.frames.length, 1);
  env.send(command);
  assert.equal(env.frames.length, 1);
  env.send({...command, mode: 'paged'});
  assert.equal(env.window.flowTest.mode(), false);
  assert.equal(env.messages.some(message => message.type === 'md2pdf-ready'), false);
});

test('flow fit adapts continuous source width at the requested text scale', () => {
  const env = harness(); const flow = {...env.root, style: {}};
  env.window.flowTest.setRoot(flow);
  env.send({type: 'md2pdf-preview-mode', mode: 'flow', revision: 0});
  assert.ok(env.classes.has('md2pdf-preview-flow'));
  assert.equal(flow.style.width, '576px');
  env.send({type: 'md2pdf-preview-zoom', zoom: 150});
  assert.equal(flow.style.zoom, 1.5);
  assert.equal(flow.style.width, '384px');
});

test('flow layout styles are screen-only and print explicitly excludes snapshot', () => {
  const [screen, print] = PREVIEW_SCREEN_CSS.split('@media print');
  assert.ok(screen.startsWith('@media screen'));
  assert.ok(screen.includes('html.md2pdf-preview-flow .pagedjs_pages { display: none'));
  assert.ok(screen.includes('#md2pdf-preview-flow .web-page-number'));
  assert.ok(!screen.includes('#md2pdf-preview-flow .colophon'));
  assert.ok(print.includes('#md2pdf-preview-flow { display: none !important; }'));
  assert.ok(runtime().includes('flowStyle.media = "screen"'));
});
