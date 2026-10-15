// 工作台布局与面板动作的结构/行为检查（无需浏览器）。
//
// 覆盖：
//   * index.html 的品牌、按钮外观、下载与双全屏按钮的静态结构；
//   * app.js 的下载加载态（不破坏内联图标）与草稿/示例交接保留；
//   * editor-workspace.js 的双全屏契约、互斥、Esc 退出与同步默认开启；
//   * editor-workspace.css 的共享固定 viewport 全屏模式；
//   * 用最小 fake DOM 在 vm 中真实执行 editor-workspace.js，验证互斥与 Esc 行为。
//
// Run: node --test tests/editor-layout-checks.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = rel => readFile(new URL('../' + rel, import.meta.url), 'utf8');
const indexHtml = await read('web/index.html');
const examplesHtml = await read('web/examples.html');
const examplesJs = await read('web/examples.js');
const examplesCss = await read('web/examples.css');
const appJs = await read('web/app.js');
const appCss = await read('web/app.css');
const wsJs = await read('web/editor-workspace.js');
const wsCss = await read('web/editor-workspace.css');

// ---------------------------------------------------------------- index.html
test('头部品牌：主标题 md2pdf，副标题编辑器，页面标题 md2pdf', () => {
  assert.match(indexHtml, /<h1 class="brand-logo">md2pdf<\/h1>/);
  assert.match(indexHtml, /<p class="brand-sub" id="app-view-label">编辑器<\/p>/);
  assert.equal((indexHtml.match(/<header class="topbar"/g) || []).length, 1, '单页应用只保留一个顶栏');
  assert.match(indexHtml, /<title>make md2pdf great<\/title>/);
  assert.ok(!/Markdown 排版工作台<\/p>/.test(indexHtml), '不应残留旧的描述文案');
});

test('固定规则整栏已移除（index / form / app / css）', () => {
  assert.ok(!indexHtml.includes('fixed-rules'), 'index 不应再有 #fixed-rules');
  assert.ok(!/aria-describedby/.test(indexHtml), 'form 不应再引用 fixed-rules');
  assert.ok(!/fixedRules|renderFixedRules/.test(appJs), 'app.js 不应再有 fixedRules 代码');
  assert.ok(!/\.fixed-rules/.test(appCss), 'app.css 不应残留 .fixed-rules');
  // 真实控件约束功能仍在。
  assert.match(appJs, /function applyPolicy/);
  assert.match(appJs, /control\.available !== false/);
});

test('导航栏示例库入口改为「模板库」，编辑器与库页标题统一', () => {
  assert.match(indexHtml, /<a id="examples-link-top" class="button-link nav-square" href="\/" aria-label="模板库" title="模板库" data-view-link="templates"><svg[^>]*aria-hidden="true"/);
  assert.ok(!/示例库/.test(indexHtml), '编辑器不应再残留「示例库」字样');
  // 库页标题 / 副标题同步为「模板库」。
  assert.match(examplesHtml, /<title>make md2pdf great · 模板库<\/title>/);
  assert.match(examplesHtml, /<h1>md2pdf<\/h1><p id="app-view-label">模板库<\/p>/);
  assert.ok(!/示例库/.test(examplesHtml), '库页不应再残留「示例库」标题');
});

test('空白会话草稿不阻止默认示例载入；模板库以预览卡片呈现', () => {
  assert.match(appJs, /draft\.md\.trim\(\)/, '空草稿不应覆盖启动默认示例');
  assert.match(examplesJs, /'use strict';[\s\S]*?\(\(\) => \{/, '模板脚本应隔离作用域，避免阻止编辑器脚本解析');
  assert.match(examplesJs, /viewLink\.dataset\.viewLink = view === 'templates' \? 'editor' : 'templates'/, '共享顶栏导航目标应随当前页面切换');
  assert.match(indexHtml, /<ul id="example-list" class="example-cards"/);
  assert.match(examplesJs, /className = 'template-card-preview'/);
  assert.match(examplesJs, /aria-label', '从该模板创建'/);
  assert.ok(!indexHtml.includes('template-search') && !indexHtml.includes('detail-source'), '模板库不显示搜索或 Markdown 源码区');
  assert.ok(!indexHtml.includes('examples-heading') && !examplesHtml.includes('examples-heading'), '模板库不显示额外标题区');
  assert.match(indexHtml, /data-nav-icon="templates"[\s\S]*data-nav-icon="editor"/, '顶栏提供可切换的模板库与主页图标');
  assert.match(examplesCss, /\.example-cards\{[^}]*display:grid;grid-template-columns:repeat\(auto-fit/);
  assert.match(examplesCss, /@media\(max-width:760px\)[\s\S]*?\.example-cards\{grid-template-columns:1fr/);
  assert.match(examplesCss, /\.example-card-copy\{height:96px/);
  assert.match(examplesCss, /\.example-card h3\{[^}]*-webkit-line-clamp:1/);
  assert.match(examplesCss, /\.example-card p\{[^}]*-webkit-line-clamp:2[^}]*min-height:38px/);
});

test('下载按钮移入预览 panel-heading，保留 id/disabled/aria-label 与图标', () => {
  const heading = indexHtml.match(/<section class="preview-panel"[\s\S]*?<\/section>/);
  assert.ok(heading, '未找到预览面板');
  const block = heading[0];
  assert.match(block, /<button id="download"[^>]*disabled/);
  assert.match(block, /aria-label="下载 PDF"/);
  assert.match(block, /class="icon-button panel-download"/, '下载应为与全屏一致的描边图标按钮');
  assert.match(block, /<span class="btn-label sr-only">下载 PDF<\/span>/);
  assert.match(block, /<svg class="btn-icon"[^>]*viewBox="0 0 24 24"[^>]*stroke="currentColor"/, '应内联 Tabler file-type-pdf 图标（currentColor，24 视图）');
  assert.match(block, /M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4/, '应保留 file-type-pdf 路径数据');
  // 下载必须在预览 surface 之前（位于标题栏内）
  assert.ok(block.indexOf('id="download"') < block.indexOf('preview-surface'), '下载按钮应在标题栏而非预览区');
});

test('两侧标题栏提供动作区：Markdown 侧计数，预览侧仅下载与全屏', () => {
  const editor = indexHtml.match(/<section class="editor-panel"[\s\S]*?<\/section>/)[0];
  assert.match(editor, /<div class="editor-footer">.*<span id="count">0 字符<\/span>/);
  const preview = indexHtml.match(/<section class="preview-panel"[\s\S]*?<\/section>/)[0];
  assert.ok(!indexHtml.includes('document-type'), 'index 不应再有 #document-type');
  assert.ok(!preview.includes('document-type'), '预览标题不应再显示文档类型文本');
  assert.match(preview, /<button id="download" class="icon-button panel-download"/);
});

test('预览页脚承载 #status（span 左、p 右，role=status/live），且不再有 .status-row', () => {
  assert.ok(!indexHtml.includes('status-row'), 'index 不应再残留 .status-row');
  const preview = indexHtml.match(/<section class="preview-panel"[\s\S]*?<\/section>/)[0];
  const footer = preview.match(/<div class="preview-footer">([\s\S]*?)<\/div>/);
  assert.ok(footer, '预览面板应有 .preview-footer');
  assert.match(footer[1], /<span><math[\s\S]*?<\/math><\/span>/);
  assert.match(footer[1], /<p id="status" role="status" aria-live="polite">/);
  assert.ok(footer[1].indexOf('<span>') < footer[1].indexOf('<p id="status"'), 'span 在左，p#status 在右');
  // 页脚属于面板结构，不进入预览 iframe / PDF。
  assert.ok(preview.indexOf('preview-footer') > preview.indexOf('preview-surface'), '页脚在预览区之后');
  assert.ok(preview.indexOf('preview-footer') > preview.indexOf('</iframe>'), '页脚不在 iframe 内');
  for (const token of ['.preview-footer', '.preview-footer #status']) assert.ok(appCss.includes(token), '缺少样式：' + token);
  assert.ok(!/\.status-row/.test(appCss), 'app.css 不应残留 .status-row 样式');
  assert.match(appJs, /\.preview-footer/, '草稿告警应挂到预览页脚');
});

test('editor-workspace.js 在两侧动作区注入全屏图标按钮（外壳职责）', () => {
  assert.match(wsJs, /function buildFullscreenButtons/);
  assert.match(wsJs, /function makeFullscreenButton/);
  assert.match(wsJs, /var SVG_NS = 'http:\/\/www\.w3\.org\/2000\/svg'/);
  assert.match(wsJs, /createElementNS\(SVG_NS, 'svg'\)/);
  assert.match(wsJs, /make\('button', \{ type: 'button', class: 'icon-button', 'data-panel-fullscreen': '', 'aria-pressed': 'false', 'aria-label': label, title: title \}\)/);
  assert.match(wsJs, /querySelector\('\.panel-actions'\)/);
  assert.match(wsJs, /editorActions\.appendChild\(editorFullscreenBtn\)/, 'Markdown 全屏按钮应位于动作区最右');
  assert.match(wsJs, /previewActions\.appendChild\(previewFullscreenBtn\)/, '预览全屏按钮应追加在下载按钮之后（最右）');
});

test('字符计数保留', () => {
  assert.match(indexHtml, /<span id="count">0 字符<\/span>/);
  assert.match(appJs, /字符/);
});

test('index 在 core 之后加载 editor-images.css / editor-images.js', () => {
  const coreCss = indexHtml.indexOf('/editor-core.css');
  const imgCss = indexHtml.indexOf('/editor-images.css');
  const coreJs = indexHtml.indexOf('/editor-core.js');
  const imgJs = indexHtml.indexOf('/editor-images.js');
  assert.ok(coreCss >= 0 && imgCss > coreCss, 'editor-images.css 应在 editor-core.css 之后');
  assert.ok(coreJs >= 0 && imgJs > coreJs, 'editor-images.js 应在 editor-core.js 之后');
  assert.match(indexHtml, /<script src="\/editor-images\.js" defer><\/script>/);
});

// ---------------------------------------------------------------- app.js
test('app.js：下载加载态不使用 textContent 覆盖按钮，改状态属性 + 标签节点', () => {
  assert.ok(!/download\.textContent/.test(appJs), '不得用 download.textContent 破坏内联图标');
  assert.match(appJs, /download\.dataset\.state = loading \? 'loading' : 'idle'/);
  assert.match(appJs, /setAttribute\('aria-busy'/);
  assert.match(appJs, /querySelector\('\.btn-label'\)/);
  assert.match(appJs, /download\.disabled = downloading \|\| !editor\.value\.trim\(\)/);
});

test('app.js：保留草稿与示例交接', () => {
  for (const token of ["DRAFT_KEY = 'md2pdf:draft'", "HANDOFF_KEY = 'md2pdf:handoff'", 'function saveDraft', '#browse-examples', 'topExamplesLink', 'sessionStorage']) {
    assert.ok(appJs.includes(token), '缺少交接契约：' + token);
  }
  assert.match(appJs, /topExamplesLink\?\.addEventListener\('click', saveDraft\)/);
  assert.match(appJs, /closest\('#browse-examples, #examples-link-top'\)/, '动态注入的从模板创建需经委托保存草稿');
  assert.ok(appJs.includes("window.addEventListener('pagehide', saveDraft)"), 'pagehide 兜底保存');
});

// ---------------------------------------------------------------- editor-workspace.js
test('editor-workspace.js：语法有效且不调用浏览器全屏 API', () => {
  assert.doesNotThrow(() => new Function(wsJs));
  assert.ok(!/requestFullscreen|fullscreenElement|exitFullscreen/.test(wsJs), '全屏应为固定 viewport 面板模式，非浏览器 API');
});

test('editor-workspace.js：双全屏契约与默认同步定位', () => {
  for (const token of [
    "var PREVIEW_FOCUS_CLASS = 'preview-focus'", 'function nextFullscreenMode', 'function applyFullscreen',
    'function buildFullscreenButtons', "updateSync(true)", "setAttribute('aria-pressed'",
    "toggleFullscreen('editor')", "toggleFullscreen('preview')",
  ]) assert.ok(wsJs.includes(token), '缺少：' + token);
  // 互斥：applyFullscreen 同时切换两个状态类
  const body = wsJs.slice(wsJs.indexOf('function applyFullscreen'));
  assert.match(body, /classList\.toggle\(FOCUS_CLASS, editorOn\)/);
  assert.match(body, /classList\.toggle\(PREVIEW_FOCUS_CLASS, previewOn\)/);
  // Esc：任意全屏下退出
  assert.match(wsJs, /event\.key === 'Escape' && fullscreenMode\(\)/);
});

test('editor-workspace.js：工具栏为分组 SVG 图标按钮，title/aria-label 齐备，同步定位是图标开关', () => {
  for (const token of ['var ICONS = {', 'function iconSvg', 'function iconButton', "createElementNS(SVG_NS, 'svg')", "class: 'md-wt-button'"]) {
    assert.ok(wsJs.includes(token), '缺少图标基础设施：' + token);
  }
  for (const token of ['md-wt-group--history', 'md-wt-group--format', 'md-wt-group--insert', 'md-wt-group--academic']) {
    assert.ok(wsJs.includes(token), '缺少分组：' + token);
  }
  for (const token of ["label: '撤销'", "action: 'undo'", "label: '查找与替换'", "iconButton('basicFormat', '基础格式'", "label: '一级标题'", "label: '二级标题'", "label: '三级标题'", "label: '粗体'", "label: '斜体'", "label: '无序列表'", "label: '有序列表'", "label: '链接'", "label: '引用块'", "label: '行内代码'", "label: '行内公式'", "label: '参考文献'", "label: 'BibTeX参考文献'", "label: 'DOI参考文献'", "label: '公式块'", "label: '图表引用'", "label: '公式引用'", "SHORTCUTS = {"]) {
    assert.ok(wsJs.includes(token), '缺少按钮文案：' + token);
  }
  // 插入组挂载点（图片按钮由图片模块挂入）
  assert.match(wsJs, /'data-md-wt-mount': mount/, '插入组应暴露图片挂载点');
  assert.match(wsJs, /IMAGE_MOUNT_ATTR = 'data-md-wt-mount'/);
  // 折叠/展开共用一个命令按钮，不猜状态
  assert.ok(!wsJs.includes("runCommand('toggleFold')"), '工具条不再提供折叠按钮');
  // 同步定位：图标开关按钮（aria-pressed）+ .checked 兼容访问器，不是隐藏复选框
  assert.ok(!/type: 'checkbox'/.test(wsJs), '不再使用隐藏复选框冒充按钮');
  assert.match(wsJs, /defineProperty\(button, 'checked'/, '保留 .checked 兼容访问器');
  assert.match(wsJs, /updateSync\(true\)/, '同步定位默认开启');
});

test('editor-workspace.css：紧凑图标按钮逐个换行、窄屏不溢出', () => {
  for (const token of [
    '.md-wt-icon { width: 16px; height: 16px',
    '.md-wt-group { display: contents; }',
    'width: 28px',
    'max-width: 390px',
  ]) assert.ok(wsCss.includes(token), '缺少：' + token);
  assert.ok(!/.md-wt-sync-input/.test(wsCss), '不应残留同步复选框样式');
  assert.match(wsCss, /\.md-wt-toolbar \{[^}]*flex-wrap: wrap/);
});

// ---------------------------------------------------------------- editor-workspace.css
test('editor-workspace.css：双全屏共享固定 viewport 模式且窄屏可用、括号平衡', () => {
  for (const token of [
    '.workspace.md-editor-workspace.editor-focus',
    '.workspace.md-editor-workspace.preview-focus',
    'position: fixed', 'inset: 12px',
    '.editor-focus .preview-panel { display: none; }',
    '.preview-focus .editor-panel { display: none; }',
    'max-width: 900px',
  ]) assert.ok(wsCss.includes(token), '缺少：' + token);
  assert.match(wsCss, /\.workspace\.md-editor-workspace\.editor-focus,[\s\S]*?\.workspace\.md-editor-workspace\.preview-focus\s*\{[^}]*position:\s*fixed/,
    '两种全屏应共用同一固定 viewport 规则');
  assert.match(wsCss, /preview-focus \.preview-panel \{ height: 100%/, '窄/全屏预览应占满高度');
  const open = (wsCss.match(/\{/g) || []).length;
  const close = (wsCss.match(/\}/g) || []).length;
  assert.equal(open, close, 'CSS 花括号不平衡');
});

// ---------------------------------------------------------------- 行为：vm 执行
function fakeEnvironment() {
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
    contains(node) { return node === this || this.children.some(child => child.contains && child.contains(node)); }
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
  editorPanel.q['h2'] = new FakeNode('h2');
  previewPanel.q['h2'] = new FakeNode('h2');
  editorPanel.q['.panel-heading'] = editorHeading;
  previewPanel.q['.panel-heading'] = previewHeading;

  // 标题栏动作区：Markdown 侧含计数，预览侧含下载（下载是 #download 查询目标）。
  const editorActions = new FakeNode('div');
  editorActions.appendChild(new FakeNode('span'));
  const previewActions = new FakeNode('div');
  const downloadNode = new FakeNode('button');
  previewActions.appendChild(downloadNode);
  previewActions.q['#download'] = downloadNode;
  editorHeading.q['.panel-actions'] = editorActions;
  previewHeading.q['.panel-actions'] = previewActions;

  const previewFrame = new FakeNode('iframe');
  const privacySave = new FakeNode('button');

  const docListeners = {};
  const document = {
    createElement: tag => new FakeNode(tag),
    createElementNS: (ns, tag) => new FakeNode(tag),
    querySelector(sel) {
      if (sel === '.workspace') return workspace;
      if (sel === '#preview') return previewFrame;
      if (sel === '#privacy-save') return privacySave;
      return null;
    },
    addEventListener(type, fn) { (docListeners[type] || (docListeners[type] = [])).push(fn); },
    removeEventListener() {},
    dispatch(type, event) { (docListeners[type] || []).forEach(fn => fn(event || { type })); },
    dispatchEvent() {},
  };
  const winListeners = {};
  const sandbox = {
    document,
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    console: { warn() {} },
    setTimeout, clearTimeout,
    requestAnimationFrame: callback => callback(),
    matchMedia: () => ({ matches: false }),
    addEventListener(type, fn) { (winListeners[type] || (winListeners[type] = [])).push(fn); },
    removeEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const buttonIn = node => node.children.find(child => child.tagName === 'BUTTON');
  const dispatchWindow = (type, event) => (winListeners[type] || []).forEach(fn => fn(event || { type }));
  return { sandbox, workspace, editorPanel, previewPanel, editorActions, previewActions, downloadNode, privacySave, buttonIn, document, dispatchWindow };
}

test('行为：双全屏互斥、再次点击退出、Esc 退出（vm 执行真实逻辑）', () => {
  const env = fakeEnvironment();
  vm.runInContext(wsJs, env.sandbox, { filename: 'editor-workspace.js' });
  const { workspace, editorActions, previewActions, downloadNode, buttonIn, document } = env;

  // 模块应把全屏按钮注入到动作区：Markdown 侧最右、预览侧在下载之后。
  const editorBtn = editorActions.children.find(n => n.getAttribute('aria-label') === 'Markdown 全屏写作');
  const previewBtn = previewActions.children.filter(c => c.tagName === 'BUTTON').find(b => b !== downloadNode);
  assert.ok(editorBtn, '应注入 Markdown 全屏按钮');
  assert.ok(previewBtn, '应注入预览全屏按钮');
  assert.equal(previewActions.children.indexOf(downloadNode), 0, '下载按钮应位于动作区最左');
  assert.equal(previewActions.children.indexOf(previewBtn), 1, '预览全屏按钮应位于下载之后（最右）');

  assert.equal(workspace.classList.contains('editor-focus'), false);
  assert.equal(editorBtn.getAttribute('aria-pressed'), 'false', '初始应同步 aria-pressed');
  assert.equal(previewBtn.getAttribute('aria-pressed'), 'false');

  editorBtn.dispatch('click');
  assert.equal(workspace.classList.contains('editor-focus'), true, '进入 Markdown 全屏');
  assert.equal(workspace.classList.contains('preview-focus'), false);
  assert.equal(editorBtn.getAttribute('aria-pressed'), 'true');

  // 互斥：进入预览全屏应清除 Markdown 全屏
  previewBtn.dispatch('click');
  assert.equal(workspace.classList.contains('preview-focus'), true, '进入预览全屏');
  assert.equal(workspace.classList.contains('editor-focus'), false, '两种全屏不得同时存在');
  assert.equal(editorBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(previewBtn.getAttribute('aria-pressed'), 'true');

  // 再次点击同一按钮退出
  previewBtn.dispatch('click');
  assert.equal(workspace.classList.contains('preview-focus'), false);
  assert.equal(previewBtn.getAttribute('aria-pressed'), 'false');

  // Esc 退出任意全屏
  editorBtn.dispatch('click');
  assert.equal(workspace.classList.contains('editor-focus'), true);
  document.dispatch('keydown', { key: 'Escape', defaultPrevented: false, isComposing: false, keyCode: 0 });
  assert.equal(workspace.classList.contains('editor-focus'), false, 'Esc 应退出 Markdown 全屏');
  assert.equal(editorBtn.getAttribute('aria-pressed'), 'false');

  previewBtn.dispatch('click');
  document.dispatch('keydown', { key: 'Escape', defaultPrevented: false, isComposing: false, keyCode: 0 });
  assert.equal(workspace.classList.contains('preview-focus'), false, 'Esc 应退出预览全屏');
  previewBtn.dispatch('click');
  document.dispatch('md-preview-exit-fullscreen');
  assert.equal(workspace.classList.contains('preview-focus'), false, 'iframe 的 Esc 桥接应退出预览全屏');
  editorBtn.dispatch('click');
  document.dispatch('md-preview-exit-fullscreen');
  assert.equal(workspace.classList.contains('editor-focus'), true, 'iframe 不应退出 Markdown 全屏');
});

test('行为：工具栏生成分组 SVG 图标按钮；同步定位是图标开关；折叠按钮调用 toggleFold（vm 执行）', () => {
  const env = fakeEnvironment();
  const calls = [];
  env.sandbox.mdEditor = { runCommand(name) { calls.push(name); return true; }, focus() {}, getCursorLine() { return 1; } };
  vm.runInContext(wsJs, env.sandbox, { filename: 'editor-workspace.js' });

  const walk = (node, out) => { out.push(node); (node.children || []).forEach(child => walk(child, out)); return out; };
  const all = walk(env.editorPanel, []);
  const toolbar = all.find(n => n.classList && n.classList.contains('md-wt-toolbar'));
  assert.ok(toolbar, '应生成工作台工具条');
  assert.ok(!all.some(n => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox'), '工具栏不应再含隐藏复选框 input');

  const buttons = all.filter(n => n.tagName === 'BUTTON' && n.classList.contains('md-wt-button'));
  assert.ok(buttons.length >= 15, '图标按钮数量偏少：' + buttons.length);
  for (const button of buttons) {
    assert.ok(button.getAttribute('aria-label'), '每个图标按钮需有中文 aria-label');
    assert.ok(button.getAttribute('title'), '每个图标按钮需有 title（功能/快捷键）');
    const icon = (button.children || []).find(c => c.tagName === 'SVG' || c.tagName === 'IMG');
    assert.ok(icon, '每个按钮需内含 SVG 图标');
    if (icon.tagName === 'SVG') assert.equal(icon.getAttribute('viewBox'), '0 0 20 20');
    else {
      const src = button.getAttribute('aria-label') === 'BibTeX参考文献' ? '/icons/bibtex.svg' : '/icons/doi.svg';
      assert.equal(icon.getAttribute('src'), src);
      assert.equal(icon.getAttribute('alt'), '');
      assert.equal(icon.getAttribute('aria-hidden'), 'true');
    }
  }
  assert.equal(all.filter(n => n.classList && n.classList.contains('md-wt-group')).length, 5, '应有 5 个操作分组');
  assert.equal(buttons.filter(b => b.getAttribute('aria-label') === '查找与替换').length, 1);
  assert.equal(buttons.filter(b => ['查找', '替换'].includes(b.getAttribute('aria-label'))).length, 0);
  assert.equal(buttons.filter(b => b.getAttribute('aria-label') === 'DOI参考文献').length, 1);
  assert.equal(buttons.filter(b => b.getAttribute('aria-label') === 'BibTeX参考文献').length, 1);
  assert.equal(buttons.filter(b => b.getAttribute('aria-label') === '图表引用').length, 1);
  assert.equal(buttons.filter(b => b.getAttribute('aria-label') === '公式引用').length, 1);
  // 第一级只保留一个「基础格式」入口；第二级面板默认隐藏，aria-expanded=false。
  const basicButton = buttons.find(b => b.getAttribute('aria-label') === '基础格式');
  assert.ok(basicButton, '应有基础格式入口');
  assert.equal(basicButton.getAttribute('aria-expanded'), 'false');
  const basicMenu = all.find(n => n.getAttribute && n.getAttribute('role') === 'menu');
  assert.ok(basicMenu && basicMenu.hidden === true, '第二级面板默认隐藏');
  const menuLabels = (basicMenu.children || []).reduce((out, row) => out.concat((row.children || []).map(c => c.getAttribute('aria-label'))), []);
  for (const label of ['一级标题', '二级标题', '三级标题', '粗体', '斜体', '无序列表', '有序列表', '链接', '引用块', '行内代码', '行内公式']) assert.ok(menuLabels.includes(label), '第二级缺少：' + label);
  basicButton.dispatch('click', { preventDefault() {} });
  assert.equal(basicButton.getAttribute('aria-expanded'), 'true', '点击应展开第二级面板');
  assert.equal(basicMenu.hidden, false);
  env.document.dispatch('keydown', { key: 'Escape', defaultPrevented: false, isComposing: false, keyCode: 0, preventDefault() {} });
  assert.equal(basicMenu.hidden, true, 'Esc 应关闭第二级面板并保持可访问性状态');
  assert.equal(basicButton.getAttribute('aria-expanded'), 'false');

  const templateLink = all.find(n => n.getAttribute && n.getAttribute('id') === 'browse-examples');
  assert.ok(templateLink, '标题栏应含「从模板创建」锚点');
  assert.ok(walk(toolbar, []).includes(templateLink), '模板入口应移到工具条');
  assert.ok(!env.editorActions.children.includes(templateLink));
  assert.equal(templateLink.tagName, 'A', '从模板创建应是锚点而非命令按钮');
  assert.equal(templateLink.getAttribute('href'), '/');
  assert.equal(templateLink.getAttribute('aria-label'), '从模板创建');
  assert.ok(templateLink.getAttribute('title'), '锚点需有 title');
  assert.ok((templateLink.children || []).some(c => c.tagName === 'SVG'), '锚点应含文档+图标');

  const mount = all.find(n => n.getAttribute && n.getAttribute('data-md-wt-mount') === 'images');
  assert.ok(mount, '插入组应暴露图片按钮挂载点');
  assert.notEqual(mount.getAttribute('aria-hidden'), 'true', '图片挂载点不能隐藏其子按钮的可访问名称');
  // 表格不重复：插入组只保留左侧一个表格按钮，图片挂载点位于其右侧。
  assert.equal(buttons.filter(b => b.getAttribute('aria-label') === '表格').length, 1, '插入组应只有一个表格按钮');
  const insertGroup = all.find(n => n.classList && n.classList.contains('md-wt-group--insert'));
  const tableButton = buttons.find(b => b.getAttribute('aria-label') === '表格');
  assert.ok(insertGroup.children.indexOf(tableButton) < insertGroup.children.indexOf(mount), '表格在左，图片在右');

  const syncBtn = walk(env.workspace, []).find(n => n.getAttribute && n.getAttribute('id') === 'md-wt-sync');
  assert.ok(syncBtn, '应存在 #md-wt-sync');
  assert.equal(syncBtn.tagName, 'BUTTON', '同步定位应是按钮而非复选框');
  assert.equal(syncBtn.getAttribute('aria-pressed'), 'true', '同步定位默认开启');
  assert.equal(syncBtn.checked, true, '.checked 兼容访问器读出默认值');
  syncBtn.dispatch('click');
  assert.equal(syncBtn.getAttribute('aria-pressed'), 'false', '点击应关闭同步定位');
  assert.equal(syncBtn.checked, false);
  syncBtn.dispatch('click');
  assert.equal(syncBtn.getAttribute('aria-pressed'), 'true', '再次点击应开启');

  assert.ok(!buttons.some(b => b.getAttribute('aria-label') === '折叠或展开'));
  assert.ok(!walk(toolbar, []).includes(syncBtn), '同步开关不在工具条');
});


test('行为：基础格式面板的命令插入、快捷键与焦点（vm 执行，非正则）', () => {
  const env = fakeEnvironment();
  const inserted = [];
  const focused = [];
  env.sandbox.mdEditor = { focus() { focused.push(1); }, getSelection() { return { from: 0, to: 0 }; }, runCommand() { return true; }, getCursorLine() { return 1; } };
  env.sandbox.mdEditorTools = { insert(name) { inserted.push(name); } };
  vm.runInContext(wsJs, env.sandbox, { filename: 'editor-workspace.js' });

  const walk = (node, out) => { out.push(node); (node.children || []).forEach(child => walk(child, out)); return out; };
  const all = walk(env.editorPanel, []);
  const basicButton = all.find(n => n.tagName === 'BUTTON' && n.getAttribute && n.getAttribute('aria-label') === '基础格式');
  const basicMenu = all.find(n => n.getAttribute && n.getAttribute('role') === 'menu');
  const menuButtons = (basicMenu.children || []).reduce((out, row) => out.concat(row.children || []), []);
  const itemFor = label => menuButtons.find(b => b.getAttribute('aria-label') === label);
  const topButton = label => all.find(n => n.tagName === 'BUTTON' && n.getAttribute && n.getAttribute('aria-label') === label);
  assert.deepEqual(menuButtons.filter(b => ['有序列表', '右缩进', '左缩进'].includes(b.getAttribute('aria-label'))).map(b => b.getAttribute('aria-label')), ['有序列表', '右缩进', '左缩进']);
  assert.ok(itemFor('二级标题') && itemFor('行内公式'), '第二级应含标题与行内公式');
  assert.ok(topButton('图表引用') && topButton('公式引用'), '第一级应含图表引用与公式引用');

  // 工具提示：有绑定带平台快捷键，无绑定只显示简洁功能名。
  assert.match(itemFor('二级标题').getAttribute('title'), /^二级标题（.+2）$/, '有绑定应含快捷键');
  assert.match(itemFor('行内代码').getAttribute('title'), /^行内代码（.+E）$/, '行内代码应有真实绑定');
  assert.match(itemFor('行内公式').getAttribute('title'), /^行内公式（.+X）$/, '行内公式应有真实绑定');
  assert.match(itemFor('引用块').getAttribute('title'), /^引用块（.+\.）$/, '引用块应有真实绑定');
  assert.match(topButton('代码块').getAttribute('title'), /代码块（.+E）/);
  assert.match(topButton('公式块').getAttribute('title'), /公式块（.+M）/);
  // 无绑定项标题必须与功能名完全一致（不得残留冗长说明）。
  for (const label of ['参考文献', 'BibTeX参考文献', 'DOI参考文献', '表格', '图表引用', '公式引用', '图表']) {
    assert.equal(topButton(label).getAttribute('title'), label, label + ' 的 title 应为简洁功能名');
  }

  basicButton.dispatch('click', { preventDefault() {} });
  assert.equal(basicButton.getAttribute('aria-expanded'), 'true');
  itemFor('二级标题').dispatch('click', {});
  assert.deepEqual(inserted, ['h2'], '菜单项应插入对应命令');
  assert.equal(basicMenu.hidden, true, '插入后面板应关闭');
  assert.ok(focused.length >= 1, '插入后应把焦点交还编辑器');

  itemFor('删除线').dispatch('click', {});
  itemFor('分割线').dispatch('click', {});
  assert.deepEqual(inserted.slice(-2), ['strikethrough', 'rule']);
  assert.ok(itemFor('无序列表'));

  itemFor('行内公式').dispatch('click', {});
  topButton('图表引用').dispatch('click', {});
  topButton('公式引用').dispatch('click', {});
  topButton('文献引用').dispatch('click', {});
  assert.deepEqual(inserted.slice(-4), ['inline-math', 'ref', 'eqref', 'noteref']);

  // 复杂插入仍在第一级且可插入（表格 / 代码块 / 公式块）。
  topButton('表格').dispatch('click', {});
  topButton('代码块').dispatch('click', {});
  topButton('公式块').dispatch('click', {});
  assert.deepEqual(inserted.slice(-3), ['table', 'codeblock', 'formula']);

  // 快捷键：仅编辑器上下文生效，且不拦截浏览器保留键（Mod+L 等）。
  const editorTarget = env.sandbox.document.createElement('textarea');
  editorTarget.id = 'markdown';
  const press = (key, opts) => env.document.dispatch('keydown', Object.assign({ key, defaultPrevented: false, isComposing: false, keyCode: 0, target: editorTarget, preventDefault() {} }, opts));
  inserted.length = 0;
  press('2', { metaKey: true, altKey: true, code: 'Digit2' });
  assert.deepEqual(inserted, ['h2'], 'Mod+Alt+2 → 二级标题');
  // 列表快捷键对齐备忘录：Mac ⇧⌘7/8/9、Windows Ctrl+Shift+7/8/9；
  // Shift 会改变 event.key（US 布局 '&' '*' '('），须用 event.code 命中物理数字。
  inserted.length = 0;
  press('&', { metaKey: true, shiftKey: true, code: 'Digit7' });
  assert.deepEqual(inserted, ['ul-dash'], 'Mod+Shift+7（物理键）→ 无序列表');
  inserted.length = 0;
  press('*', { ctrlKey: true, shiftKey: true, code: 'Digit8' });
  assert.deepEqual(inserted, ['ul-dash'], 'Mod+Shift+8（物理键）→ 无序列表（-）');
  inserted.length = 0;
  press('(', { ctrlKey: true, shiftKey: true, code: 'Digit9' });
  assert.deepEqual(inserted, ['ol'], 'Mod+Shift+9（物理键）→ 有序列表');
  inserted.length = 0;
  for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
    press('s', { ...mod, altKey: true });
    press('e', { ...mod, altKey: true });
    press('m', { ...mod, altKey: true });
  }
  assert.deepEqual(inserted, ['strikethrough', 'codeblock', 'formula', 'strikethrough', 'codeblock', 'formula']);
  inserted.length = 0;
  press('s', { ctrlKey: true, altKey: true, getModifierState: () => true });
  assert.deepEqual(inserted, [], 'AltGr 输入不得触发格式操作');
  assert.equal(topButton('重做').getAttribute('title'), '重做（Ctrl+Y / Ctrl+Shift+Z）');
  let redoCalls = 0;
  env.sandbox.mdEditor.runCommand = name => { if (name === 'redo') redoCalls++; return true; };
  press('y', { ctrlKey: true });
  assert.equal(redoCalls, 1, 'Windows Ctrl+Y 执行重做');
  assert.equal(itemFor('粗体').getAttribute('title'), '粗体（Ctrl+B）');
  assert.equal(itemFor('删除线').getAttribute('title'), '删除线（Ctrl+Alt+S）');
  // 行内代码 / 行内公式 / 引用块的真实绑定。
  inserted.length = 0;
  press('e', { metaKey: true, shiftKey: true });
  assert.deepEqual(inserted, ['code'], 'Mod+Shift+E → 行内代码');
  inserted.length = 0;
  press('x', { metaKey: true, shiftKey: true });
  assert.deepEqual(inserted, ['inline-math'], 'Mod+Shift+X → 行内公式');
  inserted.length = 0;
  press('>', { ctrlKey: true, shiftKey: true, code: 'Period' });
  assert.deepEqual(inserted, ['quote'], 'Mod+Shift+. → 引用块');
  inserted.length = 0;
  press('b', { metaKey: true });
  assert.deepEqual(inserted, ['bold'], 'Mod+B 保留');
  inserted.length = 0;
  press('i', { metaKey: true });
  press('k', { metaKey: true });
  assert.deepEqual(inserted, ['italic', 'link'], 'Mod+I / Mod+K 保留');
  inserted.length = 0;
  press('l', { metaKey: true });
  press('p', { metaKey: true });
  press('t', { metaKey: true });
  press('w', { metaKey: true });
  assert.deepEqual(inserted, [], '不得拦截浏览器保留键');
});

test('行为：基础格式面板的关闭路径（菜单内点击 / 外部点击 / 窗口失焦）', () => {
  const env = fakeEnvironment();
  env.sandbox.mdEditor = { focus() {}, getSelection() { return { from: 0, to: 0 }; }, runCommand() { return true; }, getCursorLine() { return 1; } };
  env.sandbox.mdEditorTools = { insert() {} };
  vm.runInContext(wsJs, env.sandbox, { filename: 'editor-workspace.js' });

  const walk = (node, out) => { out.push(node); (node.children || []).forEach(child => walk(child, out)); return out; };
  const all = walk(env.editorPanel, []);
  const basicButton = all.find(n => n.tagName === 'BUTTON' && n.getAttribute && n.getAttribute('aria-label') === '基础格式');
  const basicMenu = all.find(n => n.getAttribute && n.getAttribute('role') === 'menu');
  const menuItem = basicMenu.children[0].children[0];
  const click = target => env.document.dispatch('click', { target });
  const open = () => basicButton.dispatch('click', { preventDefault() {} });

  open();
  assert.equal(basicMenu.hidden, false);
  click(menuItem); // 面板内部的点击不应关闭
  assert.equal(basicMenu.hidden, false, '点击面板内部不关闭');
  click(env.editorActions); // 外部点击关闭
  assert.equal(basicMenu.hidden, true, '点击面板外部应关闭');
  assert.equal(basicButton.getAttribute('aria-expanded'), 'false');

  open();
  assert.equal(basicMenu.hidden, false);
  // 预览 iframe 的点击不会冒泡到父文档：窗口失焦时关闭。
  env.dispatchWindow('blur');
  assert.equal(basicMenu.hidden, true, '窗口失焦（含点击预览 iframe）应关闭面板');
});

// ---------------------------------------------------------------- 选项模型（index.html 静态）
test('index.html：「标题编号」合并菜单替代旧的章节编号 / 编号方案两个控件', () => {
  assert.match(indexHtml, /<select hidden aria-label="编号" name="numbering">/);
  assert.ok(!indexHtml.includes('name="numberScheme"'), '不应再有独立的编号方案控件');
  assert.ok(!/data-control="numberScheme"/.test(indexHtml), '不应再有独立的编号方案控件外壳');
  assert.ok(!indexHtml.includes('编号方案'), '旧「编号方案」控件文案应已移除');
  // 六项语义完整的选项：跟随 / 不加 / 自动 / 数字 / 中文 / 章节
  for (const [value, label] of [
    ['', '跟随文档'], ['none', '不加编号'], ['auto', '自动编号'],
    ['force:arabic', '数字编号'], ['force:cjk', '中文编号'], ['force:chapter', '章节编号'],
  ]) assert.match(indexHtml, new RegExp('<option value="' + value + '">' + label.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&') + '</option>'), '缺少选项：' + label);
});

test('index.html：字号 / 边距 / 行距为紧凑按钮 + 调整浮层（直尺滑块 / 重置图标 / 瞬时数值）', () => {
  const specs = [
    ['fontSize', 8, 24, '0.5', 'pt'],
    ['margin', 10, 40, '1', 'mm'],
    ['lineHeight', 1, 2.5, '0.05', '倍'],
  ];
  for (const [name, min, max, step, unit] of specs) {
    const at = indexHtml.indexOf('data-control="' + name + '"');
    assert.ok(at >= 0, '缺少控件：' + name);
    const next = indexHtml.indexOf('data-control="', at + 1);
    const block = indexHtml.slice(at, next < 0 ? at + 2000 : next);
    assert.match(block, /<details class="range-pop">/, name + ' 应为 details 浮层');
    assert.match(block, /<summary class="range-trigger"[^>]*><svg/, name + ' 触发器应为纯图标');
    assert.match(block, new RegExp('data-range-slider="' + name + '" min="' + min + '" max="' + max + '" step="' + step + '"'), name + ' 滑块范围');
    assert.match(block, new RegExp('<input[^>]*name="' + name + '"[^>]*type="hidden"'), name + ' 隐藏字段保留草稿与导出参数');
    assert.match(block, new RegExp('data-range-default="' + name + '"'), name + ' 跟随文档按钮');
    assert.match(block, new RegExp('data-range-value="' + name + '"'), name + ' 操作中显示数值');
    assert.ok(!block.includes('range-note'), '不保留范围说明');
    assert.ok(!block.includes('class="range-unit"'), name + ' 浮层不再显示数值输入单位');
  }
  // 边距旧的三档下拉已移除
  assert.ok(!/<select name="margin"/.test(indexHtml), '边距不应再是下拉选择');
});

test('从模板创建入口：位于 Markdown 标题栏全屏按钮之前（锚点 + 文档图标）', () => {
  // 底部不再重复入口。
  assert.ok(!indexHtml.includes('id="browse-examples"'), '底部不应再有重复入口');
  assert.ok(!/>浏览示例库<\/a>/.test(indexHtml), '旧的示例入口文案应移除');
  assert.ok(!/>从模板创建<\/a>/.test(indexHtml), 'index 底部不再内联从模板创建');
  // editor-workspace.js 注入锚点：保持 id / href / aria-label，使用文档+图标。
  assert.match(wsJs, /href: '\/'/);
  assert.match(wsJs, /label: '从模板创建'/);
  assert.match(wsJs, /id: 'browse-examples'/);
  assert.match(wsJs, /template: \[/, '需要线性文档+图标');
  const insertBlock = wsJs.slice(wsJs.indexOf('var INSERT_ITEMS = ['), wsJs.indexOf('];', wsJs.indexOf('var INSERT_ITEMS = [')));
  assert.ok(!insertBlock.includes("icon: 'template'"), '插入组不再包含模板入口');
});

test('app.css：范围控件为紧凑按钮 + 直尺滑块及重置图标', () => {
  for (const token of ['.ruler-slider', '.ruler-scale', '.range-default', '.range-pop', '.range-trigger', '.range-popover', '.range-value']) {
    assert.ok(appCss.includes(token), '缺少：' + token);
  }
  const open = (appCss.match(/\{/g) || []).length;
  const close = (appCss.match(/\}/g) || []).length;
  assert.equal(open, close, 'CSS 花括号不平衡');
});

// ---------------------------------------------------------------- app.js 静态契约
test('app.js：控件顺序含 lineHeight，且合并菜单不再单列 numberScheme', () => {
  const order = appJs.match(/const CONTROL_ORDER = \[[^\]]*\]/)[0];
  assert.ok(order.includes("'lineHeight'"), '控制顺序应包含 lineHeight');
  assert.ok(!order.includes('numberScheme'), '合并后不应再把 numberScheme 单列在控制顺序里');
});

test('app.js：滑块与数值双向同步、跟随文档省略覆盖、触发器文案 + 浮层互斥、复用防抖', () => {
  for (const token of ['data-range-slider', 'data-range-number', 'data-range-default', 'data-range-value', 'function syncRangeFromEvent', 'function showRangeDefault', 'function reflectRangeValue', 'function updateRangeTrigger', 'function updateOptionTriggers', 'function closeRangePopovers', 'details.range-pop', 'showRangeDefault(name, currentRange(name))']) {
    assert.ok(appJs.includes(token), '缺少：' + token);
  }
  assert.match(appJs, /form\.addEventListener\('input', event => \{ syncRangeFromEvent\(event\.target\); updateOptionTriggers\(\); saveDraft\(\); schedulePreview\(\)/);
  // collectedOptions 只在非空时发送，未显式操作不覆盖默认
  assert.match(appJs, /const value = field\.value;\s*\n\s*if \(value === ''\) continue;/);
});

// ---------------------------------------------------------------- 选项模型（vm 执行 app.js 真实逻辑）
function fakeAppEnvironment() {
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
      this.options = [];
      this.q = {};
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get className() { return Array.from(this.classList.set).join(' '); }
    appendChild(c) { this.children.push(c); return c; }
    append(...c) { c.forEach(x => this.children.push(x)); }
    after() {}
    before() {}
    replaceChildren(...c) { this.children = c.slice(); }
    querySelector(sel) { return this.q[sel] || null; }
    querySelectorAll() { return []; }
    addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
    removeEventListener() {}
    dispatch(type, event) { (this.listeners[type] || []).forEach(fn => fn(event || { type })); }
    focus() {}
    closest() { return null; }
  }
  const form = new FakeNode('form');
  const named = {};
  for (const name of ['type', 'theme', 'toc', 'numbering']) named[name] = new FakeNode('select');
  for (const name of ['fontSize', 'margin', 'lineHeight']) named[name] = new FakeNode('input');
  named.type.value = '';
  form.elements = named;
  const editor = new FakeNode('textarea');
  const preview = new FakeNode('iframe');
  const document = {
    createElement: tag => new FakeNode(tag),
    createElementNS: (ns, tag) => new FakeNode(tag),
    querySelector(sel) {
      if (sel === '#markdown') return editor;
      if (sel === '#options') return form;
      if (sel === '#preview') return preview;
      if (sel === '#status') return new FakeNode('p');
      if (sel === '#download') return new FakeNode('button');
      if (sel === '#count') return new FakeNode('span');
      if (sel === '#empty-preview') return new FakeNode('div');
      if (sel === '#browse-examples' || sel === '#examples-link-top') return new FakeNode('a');
      if (sel === '.preview-footer') return new FakeNode('div');
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  };
  const sandbox = {
    document,
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    console: { warn() {}, log() {}, error() {} },
    setTimeout, clearTimeout,
    fetch: () => new Promise(() => {}),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    navigator: { userActivation: { isActive: false } },
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return { sandbox, form, preview };
}

const appEnv = fakeAppEnvironment();
vm.runInContext(appJs, appEnv.sandbox, { filename: 'app.js' });
const model = appEnv.sandbox.window.md2pdfOptions;
// vm 内创建的对象/数组来自另一 realm，deepStrictEqual 会因原型不同而失败，统一转成 plain JSON 再比较。
const plain = value => JSON.parse(JSON.stringify(value));

test('调整浮层定位在视口内，适配工具栏左右两列', () => {
  appEnv.sandbox.innerWidth = 452;
  for (const anchorLeft of [28, 232]) {
    const panel = { style: {}, getBoundingClientRect: () => ({ width: 300 }) };
    const details = { querySelector: () => panel, getBoundingClientRect: () => ({ left: anchorLeft }) };
    appEnv.sandbox.positionRangePopover(details);
    const left = anchorLeft + parseFloat(panel.style.left);
    assert.ok(left >= 12, '浮层不应超出左边缘');
    assert.ok(left + 300 <= 440, '浮层不应超出右边缘');
    assert.equal(panel.style.right, 'auto');
  }
});

test('选项模型：合并菜单按类型能力过滤（general 全量 / paper 无 cjk / GB 隐藏）', () => {
  assert.ok(model, 'app.js 应导出 md2pdfOptions 纯函数模型');
  const general = { numbering: { available: true, values: ['auto', 'force', 'none'] }, numberScheme: { available: true, values: ['arabic', 'cjk', 'chapter'] } };
  assert.deepEqual(plain(model.headingChoices(general).map(e => e[0])), ['', 'none', 'auto', 'force:arabic', 'force:cjk', 'force:chapter']);
  const paper = { numbering: { available: true, values: ['auto', 'force', 'none'] }, numberScheme: { available: true, values: ['arabic', 'chapter'] } };
  assert.deepEqual(plain(model.headingChoices(paper).map(e => e[0])), ['', 'none', 'auto', 'force:arabic', 'force:chapter']);
  const gb = { numbering: { available: false, values: [] }, numberScheme: { available: false, values: [] } };
  assert.deepEqual(plain(model.headingChoices(gb)), [['', '跟随文档']]);
  assert.equal(model.headingAvailable(gb), false);
  assert.equal(model.headingAvailable(general), true);
});

test('选项模型：旧草稿 numbering + numberScheme 正确合并为菜单 token', () => {
  assert.equal(model.headingDraftToken('force', 'cjk'), 'force:cjk');
  assert.equal(model.headingDraftToken('force', ''), 'force:arabic');
  assert.equal(model.headingDraftToken('force:cjk'), 'force:cjk');
  assert.equal(model.headingDraftToken('auto', 'chapter'), 'auto');
  assert.equal(model.headingDraftToken('none', ''), 'none');
  assert.equal(model.headingDraftToken('', 'cjk'), '');
  assert.deepEqual(plain(model.decodeHeadingToken('force:chapter')), { numbering: 'force', numberScheme: 'chapter' });
  assert.deepEqual(plain(model.decodeHeadingToken('none')), { numbering: 'none' });
  assert.deepEqual(plain(model.decodeHeadingToken('')), {});
});

test('选项模型：发送前过滤类型不支持的方案，跟随文档省略两项', () => {
  const paper = { numbering: { available: true, values: ['auto', 'force', 'none'] }, numberScheme: { available: true, values: ['arabic', 'chapter'] } };
  const general = { numbering: { available: true, values: ['auto', 'force', 'none'] }, numberScheme: { available: true, values: ['arabic', 'cjk', 'chapter'] } };
  assert.deepEqual(plain(model.headingOptionsFromToken('force:cjk', general)), { numbering: 'force', numberScheme: 'cjk' });
  assert.deepEqual(plain(model.headingOptionsFromToken('force:cjk', paper)), { numbering: 'force' });
  assert.deepEqual(plain(model.headingOptionsFromToken('none', general)), { numbering: 'none' });
  assert.deepEqual(plain(model.headingOptionsFromToken('', general)), {});
});

test('选项模型：范围默认值（元数据缺省回退），空值不发送覆盖', () => {
  assert.deepEqual(plain(model.resolveRange('lineHeight', null)), { min: 1, max: 2.5, step: 0.05, defaultValue: 1.9 });
  assert.deepEqual(plain(model.resolveRange('margin', null)), { min: 10, max: 40, step: 1, defaultValue: 20 });
  assert.equal(model.resolveRange('margin', { min: 10, max: 40, step: 1, defaultValue: 22 }).defaultValue, 22);
  assert.equal(model.rangeOptionValue('fontSize', ''), undefined);
  assert.equal(model.rangeOptionValue('lineHeight', '1.9'), 1.9);
  assert.equal(model.rangeOptionValue('fontSize', 'abc'), undefined);
  assert.equal(model.rangeOptionValue('margin', undefined), undefined);
});

test('两页标语居中且弱化，模板页面文案一致', async () => {
  const examples = await read('web/examples.html');
  for (const html of [indexHtml, examples]) assert.match(html, /<p class="topbar-tagline">MAKE MD2PDF GREAT<\/p>/);
  assert.match(examples, /id="example-list" class="example-cards"/);
  assert.ok(!examples.includes('examples-heading'));
  assert.match(examplesJs, /从该模板创建/);
  assert.ok(!examples.includes('使用此示例'));
  assert.ok(!examples.includes('template-search') && !examples.includes('detail-source'));
  assert.match(appCss, /\.topbar-tagline\{[^}]*left:50%[^}]*color:#9aa5b3/);
});

test('预览点击关闭浮层仅接受当前 iframe 与当前 revision 的消息', () => {
  const env = fakeAppEnvironment();
  env.preview.contentWindow = {};
  const popover = { open: true };
  env.form.querySelectorAll = selector => selector.endsWith('[open]') ? [popover] : [];
  vm.runInContext(appJs, env.sandbox);
  vm.runInContext('previewRevision = 7', env.sandbox);
  const emit = event => env.sandbox.listeners.message.forEach(fn => fn(event));
  emit({ source: {}, data: { type: 'md2pdf-preview-pointerdown', revision: 7 } });
  assert.equal(popover.open, true);
  emit({ source: env.preview.contentWindow, data: { type: 'md2pdf-preview-pointerdown', revision: 6 } });
  assert.equal(popover.open, true);
  emit({ source: env.preview.contentWindow, data: { type: 'md2pdf-preview-pointerdown', revision: 7 } });
  assert.equal(popover.open, false);
  assert.match(env.sandbox.injectRevision("type:'md2pdf-preview-pointerdown'", 7), /revision:7/);
});


test('标题栏保留下载与全屏，打开与模板位于工具条最前', () => {
  const env = fakeEnvironment();
  vm.runInContext(wsJs, env.sandbox);
  const labels = env.editorActions.children.filter(n => ['BUTTON', 'A'].includes(n.tagName)).map(n => n.getAttribute('aria-label'));
  assert.deepEqual(labels, ['下载 Markdown', 'Markdown 全屏写作']);
  const toolbar = env.editorPanel.children.find(n => n.getAttribute && n.getAttribute('role') === 'toolbar');
  const first = toolbar.children[0].children.filter(n => ['BUTTON', 'A'].includes(n.tagName));
  assert.deepEqual(first.map(n => n.getAttribute('aria-label')), ['打开 Markdown', '从模板创建']);
});


test('privacy 下载保存与标题栏 Markdown 下载使用同一个动作', () => {
  const env = fakeEnvironment();
  vm.runInContext(wsJs, env.sandbox, { filename: 'editor-workspace.js' });
  const download = env.editorActions.children.find(node => node.getAttribute('aria-label') === '下载 Markdown');
  assert.ok(download);
  assert.equal(env.privacySave.listeners.click.length, 1);
  assert.equal(env.privacySave.listeners.click[0], download.listeners.click[0]);
});

 test('预览排版工具条：位于预览标题之后，七项按图标逐个换行', () => {
  const formAt = indexHtml.indexOf('<form id="options"');
  assert.ok(formAt > indexHtml.indexOf('id="preview-title"'));
  assert.ok(formAt < indexHtml.indexOf('id="config-errors"'));
  const form = indexHtml.slice(formAt, indexHtml.indexOf('</form>', formAt));
  const names = [...form.matchAll(/data-control="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(names, ['type', 'theme', 'toc', 'numbering', 'fontSize', 'margin', 'lineHeight']);
  assert.equal((form.match(/<summary /g) || []).length, 7);
  assert.equal((form.match(/class="preview-option-icon"/g) || []).length, 7);
  assert.match(appCss, /\.preview-toolbar \.toolbar-field\{flex:0 0 auto;min-width:0/);
  assert.match(appJs, /slider.addEventListener\('keydown'/);
  assert.match(appJs, /slider.addEventListener\('blur', end\)/);
  assert.match(appJs, /window.addEventListener\('pointerup', end\)/);
});

test('范围图标跟随实际文档值，保留空覆盖并将数值气泡定位到滑块', () => {
  const env = fakeAppEnvironment();
  vm.runInContext(appJs, env.sandbox);
  const group = env.sandbox.document.createElement('div');
  const summary = env.sandbox.document.createElement('summary');
  const slider = env.sandbox.document.createElement('input');
  const bubble = env.sandbox.document.createElement('output');
  slider.min = 8; slider.max = 24; slider.clientWidth = 200; slider.offsetLeft = 0;
  group.q['summary.range-trigger'] = summary;
  group.q['[data-range-slider="fontSize"]'] = slider;
  group.q['[data-range-value="fontSize"]'] = bubble;
  env.form.q['[data-control="fontSize"]'] = group;
  vm.runInContext('renderedEffective = {fontSize:18}; showRangeDefault("fontSize", currentRange("fontSize"));', env.sandbox);
  assert.equal(env.form.elements.fontSize.value, '', '跟随文档不写入覆盖');
  assert.equal(slider.value, '18');
  assert.equal(summary.title, '字号：跟随文档（当前 18 pt）');
  assert.equal(bubble.textContent, '18 pt');
  assert.equal(bubble.style.left, '124px');
  vm.runInContext('form.elements.fontSize.value = "24"; reflectRangeValue("fontSize", "24");', env.sandbox);
  assert.equal(summary.title, '字号：24 pt');
  assert.equal(bubble.style.left, '196px', '气泡不进入重置按钮区域');
  assert.ok(summary.classList.contains('is-explicit'));
});

test('排版图标直接列出策略选项，选择只发送一次 input/change 并还焦点', () => {
  const env = fakeAppEnvironment();
  vm.runInContext(appJs, env.sandbox);
  const group = env.sandbox.document.createElement('div');
  const menu = env.sandbox.document.createElement('div');
  const details = { open: true };
  let restored = false;
  const trigger = { focus() { restored = true; } };
  group.q['[data-option-menu]'] = menu;
  group.q['details'] = details;
  group.q['[data-option-trigger]'] = trigger;
  menu.querySelectorAll = () => menu.children;
  const field = env.form.elements.theme;
  field.options = [{value:'', textContent:'跟随文档'}, {value:'minimal', textContent:'简洁 · 黑白'}, {value:'gb', textContent:'国家标准', disabled:true}];
  const events = [];
  field.dispatchEvent = event => events.push(event.type);
  env.sandbox.Event = class { constructor(type) { this.type = type; } };
  env.form.q['[data-control="theme"]'] = group;
  vm.runInContext('renderOptionMenu("theme")', env.sandbox);
  assert.match(appCss, /\.preview-toolbar select\[hidden\]\{display:none!important\}/, '现代原生选择器样式不得重新显示隐藏绑定字段');
  assert.equal(menu.children.length, 2, '不显示策略禁用选项');
  assert.equal(menu.children[0].textContent, '跟随文档');
  assert.equal(menu.children[0].getAttribute('aria-checked'), 'true');
  let focused = false;
  menu.children[1].focus = () => { focused = true; };
  let prevented = false;
  menu.children[0].dispatch('keydown', { key:'End', preventDefault() { prevented = true; } });
  assert.ok(prevented && focused);
  menu.children[1].dispatch('click');
  assert.equal(field.value, 'minimal');
  assert.deepEqual(events, ['input', 'change']);
  assert.equal(details.open, false);
  assert.ok(restored);
});


test('M/P 交换面板并在全屏间切换，退出恢复布局、宽度及编辑实例', () => {
  const env = fakeEnvironment();
  const editor = { focus() {}, getCursorLine() { return 1; }, captureViewport() { return { line: 7 }; }, restoreViewport() {}, requestMeasure() {} };
  env.sandbox.mdEditor = editor;
  env.editorPanel.getBoundingClientRect = () => ({ width: 420 });
  vm.runInContext(wsJs, env.sandbox);
  const m = env.editorPanel.q.h2.children[0];
  const p = env.previewPanel.q.h2.children[0];
  assert.equal(m.textContent, 'M');
  assert.equal(p.textContent, 'P');
  assert.equal(m.title, '交换面板位置');
  m.dispatch('click');
  assert.ok(env.workspace.classList.contains('panels-reversed'));
  assert.equal(env.workspace.style['--md-wt-editor-width'], '420px');
  const full = env.editorActions.children.find(n => n.getAttribute('aria-label') === 'Markdown 全屏写作');
  full.dispatch('click');
  assert.ok(env.workspace.classList.contains('editor-focus'));
  assert.equal(m.title, '切换到预览');
  m.dispatch('click');
  assert.ok(env.workspace.classList.contains('preview-focus'));
  assert.equal(p.title, '切换到 Markdown');
  p.dispatch('click');
  assert.ok(env.workspace.classList.contains('editor-focus'));
  env.dispatchWindow('resize');
  env.document.dispatch('keydown', { key: 'Escape', defaultPrevented: false, isComposing: false, keyCode: 0 });
  assert.ok(env.workspace.classList.contains('panels-reversed'));
  assert.equal(env.workspace.style['--md-wt-editor-width'], '420px');
  assert.equal(env.sandbox.mdEditor, editor);
  p.dispatch('click');
  assert.equal(env.workspace.classList.contains('panels-reversed'), false);
});

test('交换后分隔条的拖动及键盘方向与实际位置一致', () => {
  const env = fakeEnvironment();
  env.editorPanel.getBoundingClientRect = () => ({ width: 420 });
  env.workspace.getBoundingClientRect = () => ({ left: 0, right: 1000, width: 1000 });
  vm.runInContext(wsJs, env.sandbox);
  env.editorPanel.q.h2.children[0].dispatch('click');
  const divider = env.workspace.children.find(n => n.classList.contains('md-wt-divider'));
  divider.dispatch('pointerdown', { pointerId: 1, preventDefault() {} });
  divider.dispatch('pointermove', { clientX: 540 });
  assert.equal(env.workspace.style['--md-wt-editor-width'], '460px');
  divider.dispatch('keydown', { key: 'ArrowLeft', preventDefault() {} });
  assert.equal(env.workspace.style['--md-wt-editor-width'], '444px');
  divider.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.equal(env.workspace.style['--md-wt-editor-width'], '396px');
});


test('面板共享网格覆盖左右边缘，缩放轨道占两侧按钮间空白的三成', () => {
  for (const [width, mobile] of [[300, false], [500, false], [1400, false], [340, true]]) {
    const env = fakeEnvironment();
    env.editorPanel.getBoundingClientRect = () => ({ width });
    env.previewPanel.getBoundingClientRect = () => ({ width: width + 100 });
    env.sandbox.matchMedia = query => ({ matches: mobile && query === '(max-width: 600px)' });
    const observed = [];
    let resize;
    env.sandbox.ResizeObserver = class {
      constructor(fn) { resize = fn; }
      observe(panel) { observed.push(panel); }
    };
    vm.runInContext(wsJs, env.sandbox);
    assert.deepEqual(observed, [env.editorPanel, env.previewPanel]);
    const style = env.editorPanel.style;
    const n = Number(style['--panel-columns']);
    const b = parseFloat(style['--panel-button']);
    const gap = parseFloat(style['--panel-gap']);
    const inset = parseFloat(style['--panel-inset']);
    assert.equal(b, 28);
    assert.ok(gap >= 2 && gap < 6.5, '左右间距接近上下4px间距且不拉伸按钮');
    assert.ok(Math.abs(n * b + (n - 1) * gap + 2 * inset - width) < 0.001);
    const left = inset + b;
    const right = width - inset - (3 * b + 2 * gap);
    assert.ok(Math.abs(parseFloat(style['--panel-zoom-left']) - (left + right) / 2) < 0.001);
    assert.ok(Math.abs((parseFloat(style['--panel-zoom-width']) - 62.334) / (right - left) - 0.3) < 0.001);
    env.editorPanel.getBoundingClientRect = () => ({ width: width + 200 });
    resize();
    assert.ok(Number(style['--panel-columns']) > n, '观察面板实际尺寸变化后更新网格');
  }
});
