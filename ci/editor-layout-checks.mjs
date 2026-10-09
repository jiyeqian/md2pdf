// 工作台布局与面板动作的结构/行为检查（无需浏览器）。
//
// 覆盖：
//   * index.html 的品牌、按钮外观、下载与双全屏按钮的静态结构；
//   * app.js 的下载加载态（不破坏内联图标）与草稿/示例交接保留；
//   * editor-workspace.js 的双全屏契约、互斥、Esc 退出与同步默认开启；
//   * editor-workspace.css 的共享固定 viewport 全屏模式；
//   * 用最小 fake DOM 在 vm 中真实执行 editor-workspace.js，验证互斥与 Esc 行为。
//
// Run: node --test ci/editor-layout-checks.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = rel => readFile(new URL('../' + rel, import.meta.url), 'utf8');
const indexHtml = await read('web/index.html');
const examplesHtml = await read('web/examples.html');
const appJs = await read('web/app.js');
const appCss = await read('web/app.css');
const wsJs = await read('web/editor-workspace.js');
const wsCss = await read('web/editor-workspace.css');

// ---------------------------------------------------------------- index.html
test('头部品牌：主标题 md2pdf，副标题 MAKE MD2PDF GREAT，页面标题 md2pdf', () => {
  assert.match(indexHtml, /<h1 class="brand-logo">md2pdf<\/h1>/);
  assert.match(indexHtml, /<p class="brand-sub">MAKE MD2PDF GREAT<\/p>/);
  assert.match(indexHtml, /<title>md2pdf<\/title>/);
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
  assert.match(indexHtml, /<a id="examples-link-top" class="button-link" href="\/examples">模板库<\/a>/);
  assert.ok(!/示例库/.test(indexHtml), '编辑器不应再残留「示例库」字样');
  // 库页标题 / 副标题同步为「模板库」。
  assert.match(examplesHtml, /<title>md2pdf · 模板库<\/title>/);
  assert.match(examplesHtml, /<h1>md2pdf<\/h1><p>模板库<\/p>/);
  assert.ok(!/示例库/.test(examplesHtml), '库页不应再残留「示例库」标题');
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
  assert.match(editor, /<div class="panel-actions">\s*<span id="count">0 字符<\/span>\s*<\/div>/);
  const preview = indexHtml.match(/<section class="preview-panel"[\s\S]*?<\/section>/)[0];
  assert.ok(!indexHtml.includes('document-type'), 'index 不应再有 #document-type');
  assert.ok(!preview.includes('document-type'), '预览标题不应再显示文档类型文本');
  assert.match(preview, /<button id="download" class="icon-button panel-download"/);
});

test('editor-workspace.js 在两侧动作区注入全屏图标按钮（外壳职责）', () => {
  assert.match(wsJs, /function buildFullscreenButtons/);
  assert.match(wsJs, /function makeFullscreenButton/);
  assert.match(wsJs, /var SVG_NS = 'http:\/\/www\.w3\.org\/2000\/svg'/);
  assert.match(wsJs, /createElementNS\(SVG_NS, 'svg'\)/);
  assert.match(wsJs, /make\('button', \{ type: 'button', class: 'icon-button', 'aria-pressed': 'false', 'aria-label': label, title: title \}\)/);
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
    'function buildFullscreenButtons', "setAttribute('aria-pressed', 'true')", "setAttribute('aria-pressed'",
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
  for (const token of ['md-wt-group--history', 'md-wt-group--format', 'md-wt-group--insert', 'md-wt-group--academic', 'md-wt-group--view']) {
    assert.ok(wsJs.includes(token), '缺少分组：' + token);
  }
  for (const token of ["label: '撤销'", "hint: '撤销（Ctrl/⌘+Z）'", "label: '查找与替换'", "label: '粗体'", "label: '链接'", "label: '脚注'", "label: '公式'"]) {
    assert.ok(wsJs.includes(token), '缺少按钮文案：' + token);
  }
  // 插入组挂载点（图片按钮由图片模块挂入）
  assert.match(wsJs, /'data-md-wt-mount': mount/, '插入组应暴露图片挂载点');
  assert.match(wsJs, /IMAGE_MOUNT_ATTR = 'data-md-wt-mount'/);
  // 折叠/展开共用一个命令按钮，不猜状态
  assert.ok(wsJs.includes("runCommand('toggleFold')"), '折叠按钮应调用 toggleFold');
  // 同步定位：图标开关按钮（aria-pressed）+ .checked 兼容访问器，不是隐藏复选框
  assert.ok(!/type: 'checkbox'/.test(wsJs), '不再使用隐藏复选框冒充按钮');
  assert.match(wsJs, /defineProperty\(button, 'checked'/, '保留 .checked 兼容访问器');
  assert.match(wsJs, /'aria-pressed', 'true'/, '同步定位默认开启');
});

test('editor-workspace.css：紧凑图标按钮、组间分隔、窄屏不溢出', () => {
  for (const token of [
    '.md-wt-icon { width: 16px; height: 16px',
    '.md-wt-group + .md-wt-group',
    'border-left: 1px solid #e3e8ef',
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
      this.style = { setProperty() {} };
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
  const sandbox = {
    document,
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    console: { warn() {} },
    setTimeout, clearTimeout,
    matchMedia: () => ({ matches: false }),
    addEventListener(type, fn) { (winListeners[type] || (winListeners[type] = [])).push(fn); },
    removeEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const buttonIn = node => node.children.find(child => child.tagName === 'BUTTON');
  return { sandbox, workspace, editorPanel, previewPanel, editorActions, previewActions, downloadNode, buttonIn, document };
}

test('行为：双全屏互斥、再次点击退出、Esc 退出（vm 执行真实逻辑）', () => {
  const env = fakeEnvironment();
  vm.runInContext(wsJs, env.sandbox, { filename: 'editor-workspace.js' });
  const { workspace, editorActions, previewActions, downloadNode, buttonIn, document } = env;

  // 模块应把全屏按钮注入到动作区：Markdown 侧最右、预览侧在下载之后。
  const editorBtn = buttonIn(editorActions);
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
  assert.ok(!all.some(n => n.tagName === 'INPUT'), '工具栏不应再含隐藏复选框 input');

  const buttons = all.filter(n => n.tagName === 'BUTTON' && n.classList.contains('md-wt-button'));
  assert.ok(buttons.length >= 15, '图标按钮数量偏少：' + buttons.length);
  for (const button of buttons) {
    assert.ok(button.getAttribute('aria-label'), '每个图标按钮需有中文 aria-label');
    assert.ok(button.getAttribute('title'), '每个图标按钮需有 title（功能/快捷键）');
    const icon = (button.children || []).find(c => c.tagName === 'SVG' || c.tagName === 'IMG');
    assert.ok(icon, '每个按钮需内含 SVG 图标');
    if (icon.tagName === 'SVG') assert.equal(icon.getAttribute('viewBox'), '0 0 20 20');
    else {
      const src = button.getAttribute('aria-label') === 'BibTeX 参考文献' ? '/icons/bibtex.svg' : '/icons/doi.svg';
      assert.equal(icon.getAttribute('src'), src);
      assert.equal(icon.getAttribute('alt'), '');
      assert.equal(icon.getAttribute('aria-hidden'), 'true');
    }
  }
  assert.equal(all.filter(n => n.classList && n.classList.contains('md-wt-group')).length, 5, '应有 5 个操作分组');
  assert.equal(buttons.filter(b => b.getAttribute('aria-label') === '查找与替换').length, 1);
  assert.equal(buttons.filter(b => ['查找', '替换'].includes(b.getAttribute('aria-label'))).length, 0);
  assert.equal(buttons.filter(b => b.getAttribute('aria-label') === 'DOI 引用').length, 1);
  assert.equal(buttons.filter(b => b.getAttribute('aria-label') === 'BibTeX 参考文献').length, 1);
  const headingButton = buttons.find(b => b.getAttribute('aria-label') === '二级标题');
  assert.ok(headingButton && headingButton.getAttribute('title').includes('H2'));

  const templateLink = env.editorActions.children.find(n => n.getAttribute && n.getAttribute('id') === 'browse-examples');
  assert.ok(templateLink, '标题栏应含「从模板创建」锚点');
  assert.equal(env.editorActions.children.at(-2), templateLink, '模板入口应紧邻全屏按钮左侧');
  assert.equal(templateLink.className, 'icon-button');
  assert.ok(!walk(toolbar, []).includes(templateLink), '工具条不再重复模板入口');
  assert.equal(templateLink.tagName, 'A', '从模板创建应是锚点而非命令按钮');
  assert.equal(templateLink.getAttribute('href'), '/examples');
  assert.equal(templateLink.getAttribute('aria-label'), '从模板创建');
  assert.ok(templateLink.getAttribute('title'), '锚点需有 title');
  assert.ok((templateLink.children || []).some(c => c.tagName === 'SVG'), '锚点应含文档+图标');

  const mount = all.find(n => n.getAttribute && n.getAttribute('data-md-wt-mount') === 'images');
  assert.ok(mount, '插入组应暴露图片按钮挂载点');
  assert.notEqual(mount.getAttribute('aria-hidden'), 'true', '图片挂载点不能隐藏其子按钮的可访问名称');

  const syncBtn = all.find(n => n.getAttribute && n.getAttribute('id') === 'md-wt-sync');
  assert.ok(syncBtn, '应存在 #md-wt-sync');
  assert.equal(syncBtn.tagName, 'BUTTON', '同步定位应是按钮而非复选框');
  assert.equal(syncBtn.getAttribute('aria-pressed'), 'true', '同步定位默认开启');
  assert.equal(syncBtn.checked, true, '.checked 兼容访问器读出默认值');
  syncBtn.dispatch('click');
  assert.equal(syncBtn.getAttribute('aria-pressed'), 'false', '点击应关闭同步定位');
  assert.equal(syncBtn.checked, false);
  syncBtn.dispatch('click');
  assert.equal(syncBtn.getAttribute('aria-pressed'), 'true', '再次点击应开启');

  const foldBtn = buttons.find(b => b.getAttribute('aria-label') === '折叠或展开');
  assert.ok(foldBtn, '应有折叠 / 展开共用按钮');
  foldBtn.dispatch('click');
  assert.deepEqual(calls, ['toggleFold'], '折叠按钮应调用 toggleFold 命令');
});


// ---------------------------------------------------------------- 选项模型（index.html 静态）
test('index.html：「标题编号」合并菜单替代旧的章节编号 / 编号方案两个控件', () => {
  assert.match(indexHtml, /<label data-control="numbering">标题编号<select name="numbering">/);
  assert.ok(!indexHtml.includes('name="numberScheme"'), '不应再有独立的编号方案控件');
  assert.ok(!/data-control="numberScheme"/.test(indexHtml), '不应再有独立的编号方案控件外壳');
  assert.ok(!indexHtml.includes('编号方案'), '旧「编号方案」控件文案应已移除');
  // 六项语义完整的选项：跟随 / 不加 / 自动 / 数字 / 中文 / 章节
  for (const [value, label] of [
    ['', '跟随文档'], ['none', '不加编号'], ['auto', '自动编号'],
    ['force:arabic', '数字编号 · 1 / 1.1'], ['force:cjk', '中文编号 · 一、/（一）'], ['force:chapter', '章节编号 · 第 1 章'],
  ]) assert.match(indexHtml, new RegExp('<option value="' + value + '">' + label.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&') + '</option>'), '缺少选项：' + label);
});

test('index.html：字号 / 边距 / 行距为紧凑按钮 + 调整浮层（滑块 / 数值 / 跟随文档 / 说明）', () => {
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
    assert.match(block, /<summary class="range-trigger"[^>]*>跟随文档<\/summary>/, name + ' 触发器默认文案应为「跟随文档」');
    assert.match(block, new RegExp('data-range-slider="' + name + '" min="' + min + '" max="' + max + '" step="' + step + '"'), name + ' 滑块范围');
    assert.match(block, new RegExp('<input name="' + name + '"[^>]*data-range-number="' + name + '"[^>]*type="number" min="' + min + '" max="' + max + '" step="' + step + '"'), name + ' 数值输入范围');
    assert.match(block, new RegExp('data-range-default="' + name + '"'), name + ' 跟随文档按钮');
    assert.match(block, new RegExp('data-range-note="' + name + '"'), name + ' 模板默认说明节点');
    assert.match(block, new RegExp('<span class="range-unit">' + unit + '<\/span>'), name + ' 单位');
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
  assert.match(wsJs, /href: '\/examples'/);
  assert.match(wsJs, /label: '从模板创建'/);
  assert.match(wsJs, /id: 'browse-examples'/);
  assert.match(wsJs, /template: \[/, '需要线性文档+图标');
  const insertBlock = wsJs.slice(wsJs.indexOf('var INSERT_ITEMS = ['), wsJs.indexOf('];', wsJs.indexOf('var INSERT_ITEMS = [')));
  assert.ok(!insertBlock.includes("icon: 'template'"), '插入组不再包含模板入口');
});

test('app.css：范围控件为紧凑按钮 + 浮层样式（滑块 / 数值 / 单位 / 默认态）', () => {
  for (const token of ['.range-row', '.range-slider', '.range-number', '.range-default', '.range-pop', '.range-trigger', '.range-popover', '.range-note', '.range-unit', '[data-control].is-default']) {
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
  for (const token of ['data-range-slider', 'data-range-number', 'data-range-default', 'data-range-note', 'function syncRangeFromEvent', 'function showRangeDefault', 'function reflectRangeValue', 'function updateRangeTrigger', 'function updateRangeNote', 'function closeRangePopovers', 'details.range-pop', 'showRangeDefault(name, currentRange(name))']) {
    assert.ok(appJs.includes(token), '缺少：' + token);
  }
  assert.match(appJs, /form\.addEventListener\('input', event => \{ syncRangeFromEvent\(event\.target\); saveDraft\(\); schedulePreview\(\)/);
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
      this.style = { setProperty() {} };
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
      if (sel === '.status-row') return new FakeNode('div');
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
    addEventListener() {},
    removeEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return { sandbox };
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
