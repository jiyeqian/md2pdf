import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { Chrome } from '../src/chrome.mjs';
import { createApp, validateInput, imageBudget } from '../src/server.mjs';

const webFile = name => new URL('../web/' + name, import.meta.url);

async function fixture(t, options = {}) {
  const app = createApp({ chromeBinary: 'test-browser', ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, url, post: (route, body, headers = {}) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) };
}
const doc = { md: '# 测试\n\n正文\n\n## 小节\n\n内容', opts: {} };

test('validates options, body shape, limits and TeX resource macros', () => {
  assert.equal(validateInput(doc).opts.pagedHtml, true);
  for (const body of [null, [], { md: 1 }, { md: '' }, { ...doc, path: '/etc/passwd' }, { ...doc, opts: { output: '/tmp/out' } }, { ...doc, opts: { theme: '../secret' } }, { ...doc, opts: { fontSize: NaN } }, { ...doc, opts: { lineHeight: 0.9 } }, { ...doc, opts: { lineHeight: 2.6 } }, { ...doc, opts: { lineHeight: NaN } }, { ...doc, opts: { lineHeight: '2.1' } }, { ...doc, opts: { toc: 'false' } }, { ...doc, opts: { toString: 'x' } }, { md: '\\href{javascript:alert(1)}{X}' }]) assert.throws(() => validateInput(body), { status: 400 });
  assert.throws(() => validateInput({ md: 'a'.repeat(200001) }), { status: 413 });
  // 有限数字 1.0–2.5（含边界）通过；保留原值不做改写
  for (const lineHeight of [1, 1.9, 2.5]) assert.equal(validateInput({ ...doc, opts: { lineHeight } }).opts.lineHeight, lineHeight);
});

// 生成“恰好 bytes 字节”的标准 Base64 载荷（字符数 4 的倍数，填充仅出现在末尾）。
const b64 = bytes => { const g = Math.ceil(bytes / 3); return 'A'.repeat(g * 4 - (g * 3 - bytes)) + '='.repeat(g * 3 - bytes); };

test('image budget counts only strictly-valid embedded Markdown image tokens', () => {
  const ok = '![img](data:image/png;base64,AAAA)';
  const budget = imageBudget('# 标题\n\n' + ok);
  assert.equal(budget.images, 1);
  assert.equal(budget.totalBytes, 3);
  assert.equal(budget.excluded, 'data:image/png;base64,AAAA'.length);
  // 代码块 / 行内代码里的“图片”不算图片；非图片、非法 Base64、裸 URL、普通链接也都不算。
  const notImages = [
    '![x](data:image/png;base64,AAAA',
    '\\![x](data:image/png;base64,AAAA)',
    '![x](<data:image/png;base64,AAAA)',
    '![x](data:image/png;base64,AAAA invalid)',
    '```\n![x](data:image/png;base64,AAAA)\n```',
    '~~~\n![x](data:image/png;base64,AAAA)\n~~~',
    '`![x](data:image/png;base64,AAAA)`',
    '    ![x](data:image/png;base64,AAAA)',
    '![x](data:text/plain;base64,AAAA)',
    '![x](data:image/svg+xml;base64,AAAA)',
    '![x](data:IMAGE/PNG;base64,AAAA)',
    '![x](data:image/png;base64,AAA)',
    '![x](data:image/png;base64,AAAAA)',
    '![x](data:image/png;base64,AA=A)',
    '![x](data:image/png,notbase64)',
    'data:image/png;base64,AAAA',
    '[x](data:image/png;base64,AAAA)',
  ];
  for (const md of notImages) assert.equal(imageBudget(md).images, 0, md);
  // 末尾填充形式合法（1/2 个 =）；标题与尖括号写法同样识别。
  assert.equal(imageBudget('![a](data:image/gif;base64,AA==)').totalBytes, 1);
  assert.equal(imageBudget('![a](data:image/jpeg;base64,AAA=)').totalBytes, 2);
  assert.equal(imageBudget('![a](data:image/webp;base64,AAAA "题")').images, 1);
  assert.equal(imageBudget('![a](<data:image/png;base64,AAAA>)').images, 1);
});

test('body-character budget excludes valid images but blocks smuggle attempts', () => {
  // 图片 token 的语法开销计入正文；正文 190000 字 + 约 20k Base64 图片 → 总长度超过 200000 仍应接受。
  const image = '![x](data:image/png;base64,' + b64(15000) + ')';
  const withImage = 'a'.repeat(190000) + '\n\n' + image;
  assert.ok(withImage.length > 200000, '嵌入图片后总长度应超过 200000');
  assert.equal(validateInput({ md: withImage }).opts.pagedHtml, true);
  // 同样的“图片”放进代码块 → 计入正文 → 超限拒绝。
  assert.throws(() => validateInput({ md: 'a'.repeat(200000) + '\n\n```\n' + image + '\n```' }), { status: 413 });
  // 非图片 / 非法 Base64 Data URL 不能借图片 token 绕过正文字符预算。
  assert.throws(() => validateInput({ md: 'a'.repeat(200000) + '\n\n![x](data:text/plain;base64,' + b64(3) + ')' }), { status: 413 });
  assert.throws(() => validateInput({ md: 'a'.repeat(200000) + '\n\n![x](data:image/png;base64,AAA)' }), { status: 413 });
});

test('enforces 10 MiB per-image and 16 MiB total image budgets', () => {
  const over = '![x](data:image/png;base64,' + b64(10 * 1024 * 1024 + 1) + ')';
  assert.throws(() => validateInput({ md: over }), { status: 413 });
  const part = b64(7 * 1024 * 1024); // 7 MiB/张，两张 14 MiB 在限内，三张 21 MiB 超限
  const within = '![a](data:image/png;base64,' + part + ')\n\n![b](data:image/jpeg;base64,' + part + ')';
  assert.equal(validateInput({ md: within }).opts.pagedHtml, true);
  const tooMuch = '![a](data:image/png;base64,' + part + ')\n\n![b](data:image/jpeg;base64,' + part + ')\n\n![c](data:image/gif;base64,' + part + ')';
  assert.throws(() => validateInput({ md: tooMuch }), { status: 413 });
});

test('serves UI/example; refuses traversal, foreign host/origin and wrong methods', async t => {
  const app = await fixture(t);
  const page = await fetch(app.url);
  assert.equal(page.status, 200);
  const pageHtml = await page.text();
  assert.match(pageHtml, /sandbox="allow-scripts"/);
  assert.doesNotMatch(pageHtml, /<\/option\s+[^>]/);
  assert.match(pageHtml, /<option value="general">/);
  assert.match(pageHtml, /<option value="elegant">/);
  for (const route of ['/app.js', '/app.css', '/api/example']) assert.equal((await fetch(app.url + route)).status, 200);
  for (const route of ['/src/render.mjs', '/vendor/marked.esm.js', '/%2e%2e/package.json']) assert.equal((await fetch(app.url + route)).status, 404);
  assert.equal((await app.post('/api/render', doc, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await app.post('/api/render', doc, { Origin: 'null' })).status, 403);
  assert.equal((await fetch(app.url + '/api/render')).status, 405);
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(app.url, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
});

test('rejects malformed JSON, unsupported content type and oversized request', async t => {
  const app = await fixture(t);
  for (const [body, type, expected] of [['{', 'application/json', 400], ['x', 'text/plain', 415], ['a'.repeat(24 * 1024 * 1024 + 1), 'application/json', 413]]) {
    const response = await fetch(app.url + '/api/render', { method: 'POST', headers: { 'Content-Type': type }, body });
    assert.equal(response.status, expected);
  }
});

test('accepts a small embedded image end to end and rejects image overflows over HTTP', async t => {
  const app = await fixture(t);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==';
  const ok = await app.post('/api/render', { md: '# 图\n\n![小图](data:image/png;base64,' + png + ')' });
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).html, /data:image\/png;base64,/);

  const single = await app.post('/api/render', { md: '![x](data:image/png;base64,' + b64(10 * 1024 * 1024 + 1) + ')' });
  assert.equal(single.status, 413);
  assert.match((await single.json()).error, /10 MiB/);

  // 3×5.5 MiB ≈ 16.5 MiB 解码，Base64 总量约 22 MiB，仍在 24 MiB 请求上限内，用于命中 16 MiB 图片预算。
  const part = b64(5.5 * 1024 * 1024);
  const total = await app.post('/api/render', { md: '![a](data:image/png;base64,' + part + ')\n\n![b](data:image/png;base64,' + part + ')\n\n![c](data:image/png;base64,' + part + ')' });
  assert.equal(total.status, 413);
  assert.match((await total.json()).error, /16 MiB/);
});

test('serves local editor assets and limits source positions to preview', async t => {
  let printed;
  const app = await fixture(t, { chromeFactory: () => ({
    start: async () => {},
    printHtml: async html => { printed = html; return Buffer.from('%PDF-test'); },
    stop: async () => {},
  }) });
  const editorAssets = ['editor-vendor.js', 'editor-core.js', 'editor-pro.js', 'editor-workspace.js', 'editor-analysis.mjs', 'editor-core.css', 'editor-pro.css', 'editor-workspace.css', 'editor-images.js', 'editor-images.css'];
  for (const file of editorAssets) {
    const response = await fetch(app.url + '/' + file);
    if (!existsSync(webFile(file))) { assert.equal(response.status, 404, file + ' 缺失时应为 404 而非 500'); continue; }
    assert.equal(response.status, 200, file);
    assert.match(response.headers.get('content-type'), file.endsWith('.css') ? /text\/css/ : /text\/javascript/, file);
  }
  // 图片模块静态路由必须已接线：文件存在即按脚本/样式返回，不存在也必须被识别为 404（而非 SPA 回退）。
  for (const file of ['editor-images.js', 'editor-images.css']) {
    const response = await fetch(app.url + '/' + file);
    assert.ok([200, 404].includes(response.status), file);
  }
  const source = '# 编辑验收\n\n## 中文章节\n\n保留正文。';
  const response = await app.post('/api/render', { md: source });
  assert.equal(response.status, 200);
  assert.match((await response.json()).html, /<h2\b[^>]*data-md2pdf-source-line="3"/);
  assert.equal((await app.post('/api/pdf', { md: source })).status, 200);
  assert.doesNotMatch(printed, /data-md2pdf-source-line|md2pdf-source/);
});

test('web render escapes raw/math HTML, blocks paths and dangerous links, inlines trusted assets', async t => {
  const app = await fixture(t);
  const response = await app.post('/api/render', { md: '# 安全\n\n<script>alert("owned")</script>\n\n$<img src=x onerror=alert(2)>$\n\n![secret](file:///etc/passwd)\n\n![remote](http://127.0.0.1:9999/private)\n\n[bad](javascript:alert%281%29)\n\n## 小节\n\n正常内容' });
  assert.equal(response.status, 200);
  const { html } = await response.json();
  assert.match(html, /&lt;script&gt;alert/);
  assert.match(html, /&lt;img src=x onerror/);
  assert.doesNotMatch(html, /<img[^>]+(?:file:|http:|onerror)/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /<script[^>]+src="(?:https?:|file:)/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /md2pdf-ready/);
  const refs = await app.post('/api/render', { md: '# 引用\n\n正文[^a]\n\n[^a]: 普通脚注' });
  assert.match((await refs.json()).html, /<sup class="fnref"/);
  const gb = await app.post('/api/render', { md: '---\nstandard: </style><script>alert("gb")</script>\n---\n# 标准\n\n## 范围\n\n正文' });
  const gbHtml = (await gb.json()).html;
  assert.doesNotMatch(gbHtml, /<script>alert\("gb"\)/);
  assert.match(gbHtml, /data:image\/svg\+xml;base64,/);
});

test('serializes printing and refuses a full queue', async t => {
  let release; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const app = await fixture(t, { queueLimit: 1, chromeFactory: () => ({ async start() {}, async stop() {}, async printHtml() { entered(); await hold; return Buffer.from('%PDF-test'); } }) });
  const first = app.post('/api/pdf', doc);
  await started;
  assert.equal((await app.post('/api/pdf', doc)).status, 429);
  release();
  const result = await first;
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('content-type'), 'application/pdf');
  assert.match(result.headers.get('content-disposition'), /filename\*=UTF-8/);
});

test('restarts browser after failure, keeps response free of internal details', async t => {
  let attempts = 0, stops = 0;
  const app = await fixture(t, { chromeFactory: () => {
    const instance = ++attempts;
    return { async start() {}, async stop() { stops++; }, async printHtml() { if (instance === 1) throw new Error('secret local filesystem path'); return Buffer.from('%PDF-recovered'); } };
  } });
  const failed = await app.post('/api/pdf', doc);
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /secret/);
  assert.equal((await app.post('/api/pdf', doc)).status, 200);
  assert.equal(attempts, 2);
  assert.equal(stops, 1);
});

test('times out stuck printing and releases queue for another task', async t => {
  let attempts = 0;
  const app = await fixture(t, { taskTimeout: 30, chromeFactory: () => {
    const instance = ++attempts;
    return { async start() {}, async stop() {}, async printHtml() { return instance === 1 ? new Promise(() => {}) : Buffer.from('%PDF-ok'); } };
  } });
  assert.equal((await app.post('/api/pdf', doc)).status, 504);
  assert.equal((await app.post('/api/pdf', doc)).status, 200);
});

test('serves policy, example catalog and allowlisted example sources', async t => {
  const app = await fixture(t);
  const policy = await fetch(app.url + '/api/policy');
  assert.equal(policy.status, 200);
  const policyDoc = await policy.json();
  assert.equal(policyDoc.version, 1);
  assert.ok(policyDoc.policy.gb);
  assert.deepEqual(policyDoc.policy.gb.availableKeys, ['type', 'toc']);

  const catalogRes = await fetch(app.url + '/api/examples');
  assert.equal(catalogRes.status, 200);
  const { examples } = await catalogRes.json();
  assert.deepEqual(examples.map(e => e.id), ['general', 'skill', 'readme', 'paper', 'gb']);
  for (const e of examples) {
    assert.equal(typeof e.type, 'string');
    assert.ok(e.title && e.description, '目录项需带 id/type/title/description');
    assert.equal('summary' in e, false);
    assert.equal('md' in e, false);
  }

  // 带 id：返回 {md, type, title}
  const gb = await fetch(app.url + '/api/example?id=gb');
  assert.equal(gb.status, 200);
  const gbBody = await gb.json();
  assert.equal(gbBody.type, 'gb');
  assert.ok(gbBody.title);
  assert.match(gbBody.md, /标准号/);

  // 旧契约：不带 id 仍返回默认正文
  const defaultRes = await fetch(app.url + '/api/example');
  assert.equal(defaultRes.status, 200);
  const defaultBody = await defaultRes.json();
  assert.equal(typeof defaultBody.md, 'string');
  assert.ok(defaultBody.md.length > 0);

  // 白名单之外（遍历 / 未知 id）一律 404
  for (const route of ['/api/example?id=../../package.json', '/api/example?id=../examples/general.md', '/api/example?id=nope']) {
    assert.equal((await fetch(app.url + route)).status, 404, route);
  }

  // 在线示例 .md：只服务白名单实例
  const md = await fetch(app.url + '/examples/general.md');
  assert.equal(md.status, 200);
  assert.match(md.headers.get('content-type'), /text\/markdown/);
  for (const route of ['/examples/../package.json', '/examples/%2e%2e/package.json', '/examples/secret.md']) {
    assert.equal((await fetch(app.url + route)).status, 404, route);
  }
});

test('enforces document-type policy on both render and pdf before rendering', async t => {
  const app = await fixture(t);
  // 直接覆盖被禁用的控件 → 400
  assert.equal((await app.post('/api/render', { md: doc.md, opts: { theme: 'gb' } })).status, 400);
  assert.equal((await app.post('/api/pdf', { md: doc.md, opts: { numberScheme: 'gb' } })).status, 400);

  // 未开放的编号方案（paper 无 cjk）→ 400
  const paper = { md: '---\nabstract: 摘要\n---\n# 论文\n\n## 方法\n\n正文', opts: { numberScheme: 'cjk' } };
  assert.equal((await app.post('/api/render', paper)).status, 400);

  // 自动识别为 gb 后，字号 / 版式等一律锁定 → 400
  const gbSource = '---\n标准号: GB/T 9999-2020\n---\n# 标准\n\n## 范围\n\n正文';
  assert.equal((await app.post('/api/render', { md: gbSource, opts: { fontSize: 12 } })).status, 400);
  assert.equal((await app.post('/api/render', { md: gbSource, opts: { marginTop: 12 } })).status, 400);

  // 合法的原始 GB 输入（不加任何覆盖）→ 200，并回带策略/生效配置
  const ok = await app.post('/api/render', { md: gbSource, opts: {} });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.type, 'gb');
  assert.equal(body.policy.locked, true);
  assert.equal(body.effective.theme, 'gb');
  assert.equal(body.effective.numberScheme, 'gb');
});

test('render metadata reflects the effective configuration', async t => {
  const app = await fixture(t);
  const res = await app.post('/api/render', { md: doc.md, opts: { theme: 'minimal' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'general');
  assert.equal(body.effective.theme, 'minimal');
  assert.ok(body.policy.controls.theme);
});

test('lineHeight flows through to the rendered CSS and effective options', async t => {
  const app = await fixture(t);
  // 省略时保持正文默认 1.9（--doc-line-height 变量落到 base.css 的 :root）
  const dflt = await app.post('/api/render', { md: doc.md, opts: {} });
  assert.equal(dflt.status, 200);
  const dfltBody = await dflt.json();
  assert.equal(dfltBody.effective.lineHeight, 1.9);
  assert.equal(dfltBody.policy.controls.lineHeight.available, true);
  assert.match(dfltBody.html, /--doc-line-height:\s*1\.9;/);
  assert.match(dfltBody.html, /line-height:\s*var\(--doc-line-height\)/);
  // 显式值既回显在 effective，也写进与 PDF 同源的 CSS
  const custom = await app.post('/api/render', { md: doc.md, opts: { lineHeight: 2.1 } });
  assert.equal(custom.status, 200);
  const customBody = await custom.json();
  assert.equal(customBody.effective.lineHeight, 2.1);
  assert.match(customBody.html, /--doc-line-height:\s*2\.1;/);
  // 范围外 / 非法类型 → 400
  for (const lineHeight of [0.5, 3, '2.1', null, true]) {
    assert.equal((await app.post('/api/render', { md: doc.md, opts: { lineHeight } })).status, 400, String(lineHeight));
  }
  // GB：行距锁定为模板固定值，拒绝任何在线覆盖
  const gbSource = '---\n标准号: GB/T 9999-2020\n---\n# 标准\n\n## 范围\n\n正文';
  assert.equal((await app.post('/api/render', { md: gbSource, opts: { lineHeight: 2 } })).status, 400);
  const gbOk = await app.post('/api/render', { md: gbSource, opts: {} });
  assert.equal(gbOk.status, 200);
  const gbBody = await gbOk.json();
  assert.equal(gbBody.effective.lineHeight, 1.62);
  assert.equal(gbBody.policy.controls.lineHeight.available, false);
  assert.match(gbBody.html, /body\s*\{[^}]*line-height:\s*1\.62/);
});

test('resolve reports automatic type before stale overrides are submitted', async t => {
  const app = await fixture(t);
  const res = await app.post('/api/resolve', { md: '---\n标准号: GB/T 9999-2020\n---\n# 标准', opts: {} });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'gb');
  assert.equal(body.policy.controls.fontSize.available, false);
  assert.equal(body.policy.controls.toc.available, true);
});

test('publicHost mode allows the configured Origin and denies others', async t => {
  const app = await fixture(t, { publicHost: 'docs.example.test' });
  assert.equal((await app.post('/api/render', doc, { Origin: 'https://docs.example.test' })).status, 200);
  assert.equal((await app.post('/api/render', doc, { Origin: 'http://docs.example.test' })).status, 200);
  assert.equal((await app.post('/api/render', doc, { Origin: 'https://evil.example.test' })).status, 403);
  assert.equal((await app.post('/api/render', doc, { Origin: 'null' })).status, 403);
  const malformed = await new Promise((resolve, reject) => {
    http.get(app.url, { headers: { Host: 'https://evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(malformed, 403);
});

test('a stopped browser cannot launch later during shutdown', async () => {
  const browser = new Chrome('never-launch-this-path', '/tmp');
  await browser.stop();
  await assert.rejects(browser.start(), /startup cancelled/);
  assert.equal(browser.proc, undefined);
});
