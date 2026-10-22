import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// web/app.js 的前端行为测试：在 vm 内用最小 DOM 桩真实执行，覆盖
//   1) 服务端配置错误 payload 的前端消费（行号按钮、跳转、textContent 防 XSS）；
//   2) 配置无效时保留上次成功预览、禁止导出 PDF、状态文案正确；
//   3) 乱序响应：陈旧失败不得覆盖新成功；修正后提示条自动消失并恢复导出。
// 纯 DOM 桩，不启动浏览器。

const appJs = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');

const POLICY_DOC = {
  version: 1,
  labels: { type: {}, theme: { elegant: '雅致', minimal: '简洁' }, numberScheme: {}, numbering: {} },
  policy: {},
  autoPolicy: autoPolicy('auto'),
};

function control(name, extra = {}) {
  return { name, label: name, available: true, ...extra };
}
function autoPolicy(type) {
  return {
    version: 1, type, label: type, locked: false,
    controls: {
      type: { name: 'type', available: true, values: ['general', 'skill', 'paper', 'gb'] },
      theme: control('theme', { kind: 'enum', values: ['elegant', 'minimal'], fixedValue: 'elegant' }),
      toc: control('toc', { kind: 'tri', allowEmpty: true, fixedValue: false, triValues: ['false', '1', '2'] }),
      fontSize: control('fontSize', { kind: 'number', allowEmpty: true, unsettable: true, min: 8, max: 24, step: 0.5, defaultValue: 10.5, fixedValue: 10.5 }),
      lineHeight: control('lineHeight', { kind: 'number', allowEmpty: true, unsettable: true, min: 1, max: 2.5, step: 0.05, defaultValue: 1.9, fixedValue: 1.9 }),
      margin: control('margin', { kind: 'enum', allowEmpty: true, values: ['15', '20', '25'], fixedValue: '20 / 18' }),
      numbering: control('numbering', { kind: 'enum', values: ['auto', 'force', 'none'], fixedValue: 'auto' }),
      numberScheme: control('numberScheme', { kind: 'enum', values: ['arabic', 'cjk', 'chapter'], fixedValue: 'arabic' }),
    },
    lockedKeys: [], availableKeys: ['type', 'theme', 'toc', 'fontSize', 'lineHeight', 'margin', 'numbering'],
    notes: [], fixed: {}, defaults: {},
  };
}

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
      this.tagName = String(tag || 'div').toUpperCase();
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
    get options() { return this.children.filter(c => c.tagName === 'OPTION'); }
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get className() { return Array.from(this.classList.set).join(' '); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(c) { this.children.push(c); return c; }
    append(...c) { c.forEach(x => this.children.push(x)); }
    after() {}
    before() {}
    replaceChildren(...c) { this.children = c.slice(); }
    querySelector(sel) { return this.q[sel] || null; }
    querySelectorAll(sel) { return this.qall && this.qall[sel] ? this.qall[sel] : []; }
    addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
    removeEventListener() {}
    dispatch(type, event) { (this.listeners[type] || []).forEach(fn => fn(event || { type })); }
    focus() { this.focused = true; }
    closest() { return null; }
    contains() { return false; }
  }

  const form = new FakeNode('form');
  form.reportValidity = () => true;
  const named = {};
  for (const name of ['type', 'theme', 'toc', 'numbering']) named[name] = new FakeNode('select');
  for (const name of ['fontSize', 'margin', 'lineHeight']) named[name] = new FakeNode('input');
  form.elements = named;

  const editor = new FakeNode('textarea');
  const preview = new FakeNode('iframe');
  const status = new FakeNode('p');
  const downloadLabel = new FakeNode('span');
  const download = new FakeNode('button');
  download.querySelector = sel => (sel === '.btn-label' ? downloadLabel : null);
  const count = new FakeNode('span');
  const emptyPreviewEl = new FakeNode('div');
  const configErrors = new FakeNode('div');
  const errorList = new FakeNode('ul');
  configErrors.hidden = true; // 对应 index.html 的 hidden 属性：初始隐藏
  configErrors.querySelector = sel => (sel === '.config-errors-list' ? errorList : null);

  const at = {
    '#markdown': editor, '#options': form, '#preview': preview, '#status': status,
    '#download': download, '#count': count, '#empty-preview': emptyPreviewEl,
    '#config-errors': configErrors, '#browse-examples': new FakeNode('a'), '#examples-link-top': new FakeNode('a'),
    '.preview-footer': new FakeNode('div'),
  };

  const docListeners = {};
  const document = {
    createElement: tag => new FakeNode(tag),
    createElementNS: (ns, tag) => new FakeNode(tag),
    querySelector: sel => at[sel] || null,
    getElementById: () => null,
    addEventListener(type, fn) { (docListeners[type] || (docListeners[type] = [])).push(fn); },
    removeEventListener() {},
    dispatchEvent() {},
    body: new FakeNode('body'),
  };

  const store = {};
  const winListeners = {};
  const fetchCalls = [];
  let fetchImpl = () => new Promise(() => {});
  const sandbox = {
    document,
    sessionStorage: {
      getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
      setItem(key, value) { store[key] = String(value); },
      removeItem(key) { delete store[key]; },
    },
    store,
    console: { warn() {}, log() {}, error() {} },
    setTimeout, clearTimeout,
    fetch: (url, init) => { fetchCalls.push(String(url)); return fetchImpl(String(url), init); },
    setFetch(fn) { fetchImpl = fn; },
    fetchCalls,
    Event,
    dispatchEvent(event) { for (const listener of winListeners[event.type] || []) listener(event); return true; },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    navigator: { onLine: true, userActivation: { isActive: false } },
    addEventListener(type, fn) { (winListeners[type] || (winListeners[type] = [])).push(fn); },
    removeEventListener() {},
    listeners: winListeners,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return {
    sandbox, form, editor, preview, status, download, downloadLabel, count, configErrors, errorList,
    dispatchWin: (type, event) => (winListeners[type] || []).forEach(fn => fn(event || { type })),
    tick: () => new Promise(resolve => setTimeout(resolve, 0)),
  };
}

async function bootedEnv() {
  const env = fakeEnvironment();
  env.sandbox.setFetch(url => {
    if (url.includes('/api/policy')) return Promise.resolve({ ok: true, status: 200, json: async () => POLICY_DOC });
    if (url.includes('/api/example')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ md: '' }) });
    return new Promise(() => {});
  });
  vm.runInContext(appJs, env.sandbox, { filename: 'app.js' });
  await env.tick();
  await env.tick();
  return env;
}

test('配置错误提示条：逐条渲染行号按钮、textContent 防 XSS、状态条显示', async () => {
  const env = await bootedEnv();
  vm.runInContext('revision = 1', env.sandbox);
  env.sandbox.md2pdfConfigErrors.showConfigErrors([
    { message: '主题「gb」不适用于通用文档', line: 3, column: 5, field: 'theme' },
    { message: '<img src=x onerror=alert(1)>', line: 8, column: 1, field: 'numbering' },
  ], false);

  assert.equal(env.configErrors.hidden, false, '提示条应显示');
  assert.equal(env.errorList.children.length, 2);
  const first = env.errorList.children[0];
  const jump = first.children.find(c => c.className.includes('config-error-jump'));
  assert.ok(jump, '第一条应有行号跳转按钮');
  assert.equal(jump.textContent, '第 3 行');
  const msg = first.children.find(c => c.className.includes('config-error-message'));
  assert.equal(msg.textContent, '主题「gb」不适用于通用文档');
  // 第二条危险文案必须以纯文本写入，不得被当作 HTML。
  const dangerous = env.errorList.children[1].children.find(c => c.className.includes('config-error-message'));
  assert.equal(dangerous.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(dangerous.children.length, 0, 'textContent 不得产生子节点');
  assert.equal(env.sandbox.md2pdfConfigErrors.isInvalid(), true);
});

test('点击行号按钮定位到对应行并聚焦编辑器', async () => {
  const env = await bootedEnv();
  const calls = [];
  const focus = { done: false };
  env.sandbox.mdEditor = { goToLine(line) { calls.push(line); }, focus() { focus.done = true; } };
  env.sandbox.md2pdfConfigErrors.showConfigErrors([{ message: '字号非法', line: 12 }], false);
  const jump = env.errorList.children[0].children.find(c => c.className.includes('config-error-jump'));
  jump.dispatch('click', { type: 'click' });
  assert.deepEqual(calls, [12]);
  assert.equal(focus.done, true);
});

test('配置无效：保留上次成功预览（不重置 iframe），状态标注，导出按钮禁用', async () => {
  const env = await bootedEnv();
  env.editor.value = '# 文档\n\n正文';
  env.preview.srcdoc = '<html>上次成功</html>';
  env.sandbox.md2pdfConfigErrors.setPreviewState(true);
  vm.runInContext('revision = 0', env.sandbox);

  env.sandbox.setFetch(url => {
    if (url.includes('/api/resolve')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ type: 'general', policy: autoPolicy('general') }) });
    if ((url.includes('/api/render') || url.includes('/api/preview'))) return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: '配置无效', configErrors: [{ message: '字号超出范围', line: 4, field: 'fontSize' }] }) });
    return new Promise(() => {});
  });

  await env.sandbox.renderPreview();
  assert.equal(env.preview.srcdoc, '<html>上次成功</html>', '不得重置已有预览');
  assert.equal(env.status.textContent, '配置无效 · 显示上次成功预览');
  assert.equal(env.status.dataset.error, 'true');
  assert.equal(env.download.disabled, true, '导出按钮应被禁用');
  assert.equal(env.configErrors.hidden, false);
});

test('首次出错无旧预览：仍可读错误，状态明确配置无效', async () => {
  const env = await bootedEnv();
  env.editor.value = '# 文档';
  env.sandbox.md2pdfConfigErrors.setPreviewState(false);
  vm.runInContext('revision = 0', env.sandbox);
  env.sandbox.setFetch(url => {
    if (url.includes('/api/resolve')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ type: 'general', policy: autoPolicy('general') }) });
    return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: '配置无效', configErrors: [{ message: '主题不支持', line: 2 }] }) });
  });
  await env.sandbox.renderPreview();
  assert.match(env.status.textContent, /配置无效/);
  assert.equal(env.configErrors.hidden, false);
  assert.equal(env.errorList.children.length, 1);
});

test('乱序响应：陈旧失败不得覆盖新成功（revision 守卫）', async () => {
  const env = await bootedEnv();
  env.editor.value = '# 文档';
  vm.runInContext('revision = 0', env.sandbox);
  let rejectRender;
  env.sandbox.setFetch(url => {
    if (url.includes('/api/resolve')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ type: 'general', policy: autoPolicy('general') }) });
    if ((url.includes('/api/render') || url.includes('/api/preview'))) return new Promise((_, reject) => { rejectRender = reject; });
    return new Promise(() => {});
  });
  const pending = env.sandbox.renderPreview();
  // 让 /api/resolve 的微任务链跑完，使 render 的 fetch 真正发起后再推进 revision。
  await env.tick(); await env.tick();
  assert.equal(typeof rejectRender, 'function', 'render 请求应已发起');
  // 期间用户继续编辑：revision 前进，旧失败应被丢弃。
  vm.runInContext('revision = 5', env.sandbox);
  rejectRender(Object.assign(new Error('配置无效'), { status: 400, configErrors: [{ message: '陈旧错误', line: 1 }] }));
  await pending;
  assert.equal(env.sandbox.md2pdfConfigErrors.isInvalid(), false, '陈旧失败不应置为配置无效');
  assert.equal(env.configErrors.hidden, true);
  assert.notEqual(env.status.textContent, '陈旧错误');
});

test('修正后自动恢复：成功渲染清除提示条并恢复导出', async () => {
  const env = await bootedEnv();
  env.editor.value = '# 文档';
  vm.runInContext('revision = 0', env.sandbox);
  env.sandbox.md2pdfConfigErrors.showConfigErrors([{ message: '主题不支持', line: 2 }], false);
  assert.equal(env.download.disabled, true);

  env.sandbox.setFetch(url => {
    if (url.includes('/api/resolve')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ type: 'general', policy: autoPolicy('general') }) });
    if ((url.includes('/api/render') || url.includes('/api/preview'))) return Promise.resolve({ ok: true, status: 200, json: async () => ({ html: '<html>ok</html>', type: 'general', policy: autoPolicy('general') }) });
    return new Promise(() => {});
  });
  await env.sandbox.renderPreview();
  assert.equal(env.configErrors.hidden, true, '提示条应自动消失');
  assert.equal(env.sandbox.md2pdfConfigErrors.isInvalid(), false);
  assert.equal(env.download.disabled, false, '导出恢复可用');
  assert.equal(env.sandbox.md2pdfConfigErrors.hasPreview(), true);
  assert.equal(env.preview.srcdoc, '<html>ok</html>');
  vm.runInContext('clearTimeout(previewTimer)', env.sandbox); // 清理 60s 等待计时器
});

test('下载处理器：配置无效时二次拦截，不发 PDF 请求', async () => {
  const env = await bootedEnv();
  env.editor.value = '# 文档';
  vm.runInContext('revision = 0', env.sandbox);
  env.sandbox.setFetch(() => new Promise(() => {}));
  env.sandbox.md2pdfConfigErrors.showConfigErrors([{ message: '字号非法', line: 3 }], false);
  const before = env.sandbox.fetchCalls.length;
  env.download.dispatch('click', { type: 'click' });
  await env.tick();
  assert.equal(env.sandbox.fetchCalls.length, before, '配置无效时不得发起请求');
  assert.match(env.status.textContent, /配置无效/);
});

test('index.html 的提示条位于预览 iframe 之外且默认隐藏', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const bannerAt = html.indexOf('id="config-errors"');
  const surfaceAt = html.indexOf('class="preview-surface"');
  const iframeAt = html.indexOf('id="preview"');
  assert.ok(bannerAt >= 0, '应存在配置错误提示条');
  assert.ok(bannerAt < surfaceAt && surfaceAt < iframeAt, '提示条应在预览面板内、iframe 之前（不覆盖正文）');
  assert.match(html, /id="config-errors"[^>]*\bhidden\b/);
  assert.match(html, /class="config-errors-list"/);
});

test('草稿保存原样保留 Markdown（含未识别 frontmatter 键，不被浏览器重写）', async () => {
  const env = await bootedEnv();
  const md = '---\ntitle: 示例\n自定义字段: 保留\nname: 技能\n---\n# 标题\n\n正文';
  env.editor.value = md;
  vm.runInContext('saveDraft()', env.sandbox);
  const raw = env.sandbox.store['md2pdf:draft'];
  assert.ok(raw, '应写入草稿');
  assert.equal(JSON.parse(raw).md, md, '浏览器不得改写 / 丢弃未识别 frontmatter 键');
});
