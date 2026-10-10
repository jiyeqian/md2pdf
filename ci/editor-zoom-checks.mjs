// 工作台缩放滑块的结构与行为检查（无需浏览器）。
//
// 覆盖：
//   * Markdown / 排版预览两侧标题栏各注入一个缩放滑块（50–150，step 5，默认 100 真中点）；
//   * 共享外观类 .ruler-control / .ruler-scale / .ruler-slider 与专用容器类 .md-wt-zoom；
//   * Markdown 缩放只改 .cm-editor 显示字号（13px × 比例），textarea 兜底，不碰工具栏/标题；
//   * 预览缩放经 postMessage md2pdf-preview-zoom 下发，与 Markdown 缩放相互独立；
//   * 预览 ready 后按 event.source === previewFrame.contentWindow 校验并重发当前缩放；
//   * 数值 bubble/端点标签的位置 CSS 与窄屏不溢出。
//
// Run: node --test ci/editor-zoom-checks.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = rel => readFile(new URL('../' + rel, import.meta.url), 'utf8');
const wsJs = await read('web/editor-workspace.js');
const wsCss = await read('web/editor-workspace.css');

// ---------------------------------------------------------------- 源码契约
test('缩放常量：50–150、step 5、默认 100、基准字号 13px', () => {
  assert.match(wsJs, /var EDITOR_BASE_FONT = 13;/);
  assert.match(wsJs, /var ZOOM_MIN = 50, ZOOM_MAX = 150, ZOOM_STEP = 5, ZOOM_DEFAULT = 100;/);
});

test('滑块使用共享外观类，容器带专用类', () => {
  for (const token of [
    "class: 'md-wt-zoom'",
    "class: 'ruler-control'",
    "class: 'ruler-slider'",
    "class: 'ruler-scale'",
    "class: 'ruler-label ruler-label--min'",
    "class: 'ruler-label ruler-label--max'",
    "class: 'md-wt-zoom-value'",
  ]) assert.ok(wsJs.includes(token), '缺少：' + token);
});

test('Markdown 缩放只改字体尺寸，且优先走 mdEditor.requestMeasure', () => {
  assert.match(wsJs, /var size = \(EDITOR_BASE_FONT \* markdownZoom \/ 100\) \+ 'px';/);
  assert.ok(wsJs.includes("editorPanel.querySelector('.cm-editor')"), '应定位 .cm-editor 根元素');
  assert.ok(wsJs.includes("editorPanel.querySelector('textarea')"), '应允许 textarea 兜底');
  assert.match(wsJs, /target\.style\.fontSize = size;/);
  assert.match(wsJs, /typeof window\.mdEditor\.requestMeasure === 'function'/);
  assert.match(wsJs, /EditorView\.findFromDOM/);
  // 不得改动文档渲染字号或工具栏/标题栏。
  assert.ok(!/editorPanel\.style\.fontSize|body\.style\.fontSize|documentElement\.style\.fontSize/.test(wsJs));
});

test('预览缩放经 postMessage 下发且与 Markdown 独立', () => {
  assert.ok(wsJs.includes("type: 'md2pdf-preview-zoom'"), '缺少缩放消息类型');
  assert.match(wsJs, /previewFrame\.contentWindow\.postMessage\(\{ type: 'md2pdf-preview-zoom', zoom: previewZoom \}, '\*'\)/);
  assert.match(wsJs, /function sendPreviewZoom\(\)/);
  // ready 重发按预览窗口校验来源。
  assert.match(wsJs, /event\.source !== previewFrame\.contentWindow/);
  assert.match(wsJs, /event\.data\.type !== 'md2pdf-ready'/);
});

test('CSS：容器居中、bubble 位置随值、窄屏收缩、括号平衡', () => {
  for (const token of [
    '.workspace.md-editor-workspace .panel-heading',
    'grid-template-columns: auto minmax(0, 1fr) auto',
    '.md-wt-zoom {',
    'left: clamp(16px, var(--zoom-pos, 50%), calc(100% - 16px))',
    '.md-wt-zoom .md-wt-zoom-value',
    '.md-wt-zoom .ruler-label',
    '@media (max-width: 600px)',
    '@media (max-width: 390px)',
  ]) assert.ok(wsCss.includes(token), '缺少：' + token);
  const open = (wsCss.match(/\{/g) || []).length;
  const close = (wsCss.match(/\}/g) || []).length;
  assert.equal(open, close, 'CSS 花括号不平衡');
});

// ---------------------------------------------------------------- 行为：vm 执行
function fakeEnvironment(options = {}) {
  class ClassList {
    constructor() { this.set = new Set(); }
    add(...c) { c.forEach(x => this.set.add(x)); }
    remove(...c) { c.forEach(x => this.set.delete(x)); }
    toggle(c, force) { const on = force === undefined ? !this.set.has(c) : !!force; on ? this.set.add(c) : this.set.delete(c); return on; }
    contains(c) { return this.set.has(c); }
  }
  class FakeNode {
    constructor(tag) {
      this.tagName = (tag || 'div').toUpperCase();
      this.classList = new ClassList();
      this.attrs = {};
      this.children = [];
      this.listeners = {};
      this.style = { setProperty(k, v) { this[k] = v; } };
      this.dataset = {};
      this.hidden = false;
      this.disabled = false;
      this.textContent = '';
      this.value = '';
      this.q = {};
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get className() { return Array.from(this.classList.set).join(' '); }
    appendChild(c) { this.children.push(c); return c; }
    append(...c) { c.forEach(x => this.children.push(x)); }
    insertBefore(n, ref) { const i = ref ? this.children.indexOf(ref) : -1; if (i >= 0) this.children.splice(i, 0, n); else this.children.push(n); return n; }
    after() {}
    before() {}
    querySelector(sel) { return this.q[sel] || null; }
    querySelectorAll() { return []; }
    addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
    removeEventListener() {}
    dispatch(type, event) { (this.listeners[type] || []).forEach(fn => fn(event || { type })); }
    focus() {}
    closest() { return null; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 600 }; }
    setPointerCapture() {}
    releasePointerCapture() {}
  }

  const workspace = new FakeNode('div');
  const editorPanel = new FakeNode('section');
  const previewPanel = new FakeNode('section');
  workspace.q['.editor-panel'] = editorPanel;
  workspace.q['.preview-panel'] = previewPanel;

  const editorHeading = new FakeNode('div');
  const previewHeading = new FakeNode('div');
  editorPanel.q['.panel-heading'] = editorHeading;
  previewPanel.q['.panel-heading'] = previewHeading;

  const editorActions = new FakeNode('div');
  editorActions.appendChild(new FakeNode('span'));
  const previewActions = new FakeNode('div');
  const downloadNode = new FakeNode('button');
  previewActions.appendChild(downloadNode);
  previewActions.q['#download'] = downloadNode;
  editorHeading.q['.panel-actions'] = editorActions;
  previewHeading.q['.panel-actions'] = previewActions;

  const cmEditor = options.withEditor === false ? null : new FakeNode('div');
  if (cmEditor) editorPanel.q['.cm-editor'] = cmEditor;
  const textarea = new FakeNode('textarea');
  editorPanel.q['textarea'] = textarea;

  const previewFrame = new FakeNode('iframe');
  const sent = [];
  previewFrame.contentWindow = { postMessage(msg) { sent.push(msg); } };

  const docListeners = {};
  const document = {
    createElement: tag => new FakeNode(tag),
    createElementNS: (ns, tag) => new FakeNode(tag),
    querySelector(sel) {
      if (sel === '.workspace') return workspace;
      if (sel === '#preview') return previewFrame;
      return null;
    },
    addEventListener(type, fn) { (docListeners[type] || (docListeners[type] = [])).push(fn); },
    removeEventListener() {},
    dispatch(type, event) { (docListeners[type] || []).forEach(fn => fn(event || { type })); },
    dispatchEvent() {},
  };

  const winListeners = {};
  const measure = { calls: 0 };
  const sandbox = {
    document,
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    console: { warn() {} },
    setTimeout, clearTimeout,
    matchMedia: () => ({ matches: false }),
    addEventListener(type, fn) { (winListeners[type] || (winListeners[type] = [])).push(fn); },
    removeEventListener() {},
  };
  if (options.withEditor !== false) {
    const api = { runCommand() {}, focus() {}, getCursorLine() { return 1; }, goToLine() {} };
    if (options.vendorMeasure) {
      sandbox.MDEditorVendor = { EditorView: { findFromDOM() { return { requestMeasure() { measure.calls++; } }; } } };
    } else {
      api.requestMeasure = function () { measure.calls++; };
    }
    sandbox.mdEditor = api;
  }
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const dispatchWin = (type, event) => (winListeners[type] || []).forEach(fn => fn(event || { type }));
  return { sandbox, workspace, editorPanel, previewPanel, editorHeading, previewHeading, cmEditor, textarea, previewFrame, sent, measure, dispatchWin };
}

function zoomControls(node) {
  return node.children.filter(c => c.classList.contains('md-wt-zoom'));
}
function zoomParts(root) {
  const nodes = [];
  const walk = node => { nodes.push(node); node.children.forEach(walk); };
  walk(root);
  return {
    input: nodes.find(c => c.className.includes('ruler-slider')),
    scale: nodes.find(c => c.className.includes('ruler-scale')),
    value: nodes.find(c => c.className.includes('md-wt-zoom-value')),
    min: nodes.find(c => c.className.includes('ruler-label--min')),
    max: nodes.find(c => c.className.includes('ruler-label--max')),
  };
}

test('行为：两侧各注入一个滑块，默认 100 为真中点', () => {
  const env = fakeEnvironment();
  vm.runInContext(wsJs, env.sandbox, { filename: 'editor-workspace.js' });

  const editorZooms = zoomControls(env.editorHeading);
  const previewZooms = zoomControls(env.previewHeading);
  assert.equal(editorZooms.length, 1, 'Markdown 标题栏应有一个缩放滑块');
  assert.equal(previewZooms.length, 1, '预览标题栏应有一个缩放滑块');

  for (const root of [...editorZooms, ...previewZooms]) {
    const { input, scale, value, min, max } = zoomParts(root);
    assert.ok(input && scale && value && min && max, '滑块结构不完整');
    assert.equal(input.getAttribute('min'), '50');
    assert.equal(input.getAttribute('max'), '150');
    assert.equal(input.getAttribute('step'), '5');
    assert.equal(input.value, '100');
    assert.equal(input.getAttribute('aria-valuetext'), '100%');
    assert.equal(value.textContent, '100%');
    assert.equal(min.textContent, '50%');
    assert.equal(max.textContent, '150%');
    assert.equal(root.style['--zoom-pos'], '50%', '100% 应位于刻度中点');
  }
  // 默认字号 = 13px。
  assert.equal(env.cmEditor.style.fontSize, '13px');
  assert.ok(env.measure.calls >= 1, '应触发一次度量重算');
});

test('行为：Markdown 缩放在上下界夹取、随比例改字号，且不影响预览', () => {
  const env = fakeEnvironment();
  vm.runInContext(wsJs, env.sandbox, { filename: 'editor-workspace.js' });
  const md = zoomParts(zoomControls(env.editorHeading)[0]);

  const before = env.sent.length;
  md.input.value = '150';
  md.input.dispatch('input', { type: 'input', target: md.input });
  assert.equal(env.cmEditor.style.fontSize, '19.5px', '150% → 13×1.5');
  assert.equal(md.value.textContent, '150%');
  assert.equal(zoomControls(env.editorHeading)[0].style['--zoom-pos'], '100%');
  assert.equal(env.sent.length, before, 'Markdown 缩放不应触碰预览');

  md.input.value = '40';
  md.input.dispatch('input', { type: 'input', target: md.input });
  assert.equal(env.cmEditor.style.fontSize, '6.5px', '40% 应夹到 50% → 13×0.5');
  assert.equal(md.input.value, '50');

  md.input.value = '130';
  md.input.dispatch('input', { type: 'input', target: md.input });
  assert.equal(env.cmEditor.style.fontSize, '16.9px', '130% → 13×1.3');
  assert.equal(zoomControls(env.editorHeading)[0].style['--zoom-pos'], '80%', '(130-50)/100');
  assert.equal(env.sent.length, before);
});

test('行为：预览缩放独立下发消息、按 step 吸附并夹取', () => {
  const env = fakeEnvironment();
  vm.runInContext(wsJs, env.sandbox, { filename: 'editor-workspace.js' });
  const pv = zoomParts(zoomControls(env.previewHeading)[0]);

  pv.input.value = '125';
  pv.input.dispatch('input', { type: 'input', target: pv.input });
  const first = env.sent[env.sent.length - 1];
  assert.equal(first.type, 'md2pdf-preview-zoom');
  assert.equal(first.zoom, 125);
  assert.equal(env.cmEditor.style.fontSize, '13px', '预览缩放不应改 Markdown 字号');

  pv.input.value = '148';
  pv.input.dispatch('change', { type: 'change', target: pv.input });
  assert.equal(env.sent[env.sent.length - 1].zoom, 150, '148 应吸附到 150');

  pv.input.value = '10';
  pv.input.dispatch('input', { type: 'input', target: pv.input });
  assert.equal(env.sent[env.sent.length - 1].zoom, 50, '10 应夹到 50');
});

test('行为：预览 ready 后按来源校验并重发当前缩放', () => {
  const env = fakeEnvironment();
  vm.runInContext(wsJs, env.sandbox, { filename: 'editor-workspace.js' });
  const pv = zoomParts(zoomControls(env.previewHeading)[0]);
  pv.input.value = '75';
  pv.input.dispatch('input', { type: 'input', target: pv.input });

  const before = env.sent.length;
  // 来源不符：忽略。
  env.dispatchWin('message', { source: {}, data: { type: 'md2pdf-ready' } });
  assert.equal(env.sent.length, before, '非预览窗口的 ready 应被忽略');
  // 来源匹配：重发当前缩放 75。
  env.dispatchWin('message', { source: env.previewFrame.contentWindow, data: { type: 'md2pdf-ready' } });
  assert.equal(env.sent.length, before + 1);
  assert.equal(env.sent[env.sent.length - 1].type, 'md2pdf-preview-zoom');
  assert.equal(env.sent[env.sent.length - 1].zoom, 75);
});

test('行为：无 .cm-editor 时回退到 textarea 字号', () => {
  const env = fakeEnvironment({ withEditor: false });
  vm.runInContext(wsJs, env.sandbox, { filename: 'editor-workspace.js' });
  // withEditor:false 也未设置 mdEditor —— 手动触发一次缩放以覆盖兜底分支。
  const md = zoomParts(zoomControls(env.editorHeading)[0]);
  md.input.value = '120';
  md.input.dispatch('input', { type: 'input', target: md.input });
  assert.equal(env.textarea.style.fontSize, '15.6px', '120% → 13×1.2');
});

test('行为：mdEditor 无 requestMeasure 时退回厂商 EditorView.findFromDOM', () => {
  const env = fakeEnvironment({ vendorMeasure: true });
  vm.runInContext(wsJs, env.sandbox, { filename: 'editor-workspace.js' });
  const md = zoomParts(zoomControls(env.editorHeading)[0]);
  md.input.value = '110';
  md.input.dispatch('input', { type: 'input', target: md.input });
  assert.equal(env.cmEditor.style.fontSize, '14.3px');
  assert.ok(env.measure.calls >= 1, '应经 vendored EditorView 触发度量');
});

test("sliders omit ticks and character count belongs to the footer", async () => {
  assert.ok(!wsJs.includes("class: 'ruler-ticks'"));
  const html = await read("web/index.html");
  assert.match(html, /class="editor-footer"[^>]*>.*id="count"/);
  assert.ok(!html.includes("ruler-ticks"));
});
