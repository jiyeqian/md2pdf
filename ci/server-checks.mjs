import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Chrome } from '../src/chrome.mjs';
import { createApp, validateInput } from '../src/server.mjs';

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
  for (const body of [null, [], { md: 1 }, { md: '' }, { ...doc, path: '/etc/passwd' }, { ...doc, opts: { output: '/tmp/out' } }, { ...doc, opts: { theme: '../secret' } }, { ...doc, opts: { fontSize: NaN } }, { ...doc, opts: { toc: 'false' } }, { ...doc, opts: { toString: 'x' } }, { md: '\\href{javascript:alert(1)}{X}' }]) assert.throws(() => validateInput(body), { status: 400 });
  assert.throws(() => validateInput({ md: 'a'.repeat(200001) }), { status: 413 });
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
  for (const [body, type, expected] of [['{', 'application/json', 400], ['x', 'text/plain', 415], ['a'.repeat(1024 * 1024 + 1), 'application/json', 413]]) {
    const response = await fetch(app.url + '/api/render', { method: 'POST', headers: { 'Content-Type': type }, body });
    assert.equal(response.status, expected);
  }
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

test('a stopped browser cannot launch later during shutdown', async () => {
  const browser = new Chrome('never-launch-this-path', '/tmp');
  await browser.stop();
  await assert.rejects(browser.start(), /startup cancelled/);
  assert.equal(browser.proc, undefined);
});
