// Web 文末落款链接的结构性检查（无需浏览器/服务）：
// 只断言 render() 产出的 HTML（html 与 pagedHtml 两种产物），与真实浏览器行为解耦。
// 四种情形：web 默认 / CLI 默认 / 显式 colophon / GB；并覆盖安全转义与 SKILL 落款。
import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/render.mjs';

const REPO_URL = 'https://github.com/jiyeqian/md2pdf';
const ANCHOR = '<a href="' + REPO_URL + '" data-md2pdf-open-repo="1">md2pdf</a>';
const COLOPHON = /<div class="colophon">([\s\S]*?)<\/div>/;
const colophon = html => { const m = COLOPHON.exec(html); return m ? m[1] : ''; };

const BODY = '# 标题\n\n正文。\n';

test('web 默认：落款左侧 document.md 换成官方仓库超链接（html 与 pagedHtml 一致）', async () => {
  const res = await render(BODY, { pagedHtml: true }, { webSafe: true });
  assert.ok(colophon(res.html).includes(ANCHOR), 'html 落款应含仓库链接');
  assert.ok(!colophon(res.html).includes('document.md'), 'html 不应再出现占位文件名');
  assert.ok(res.pagedHtml, '应产出 pagedHtml');
  assert.ok(colophon(res.pagedHtml).includes(ANCHOR), 'pagedHtml 落款应含仓库链接');
  assert.ok(!colophon(res.pagedHtml).includes('document.md'));
});

test('CLI 默认：文件名落款保持原样，不产生链接', async () => {
  const res = await render(BODY, {}, { filename: 'notes.md' });
  assert.ok(colophon(res.html).includes('<span>notes.md</span>'));
  assert.ok(!colophon(res.html).includes('md2pdf-open-repo'));
});

test('CLI 文件名恰为 document.md 时也不得改链接（仅 webSafe 生效）', async () => {
  const res = await render(BODY, {}, { filename: 'document.md' });
  assert.ok(colophon(res.html).includes('<span>document.md</span>'));
  assert.ok(!colophon(res.html).includes('md2pdf-open-repo'));
});

test('显式 colophon：原样转义输出，不产生链接', async () => {
  const res = await render(BODY, { colophon: 'A & <B>"' }, { webSafe: true });
  const c = colophon(res.html);
  assert.ok(!c.includes('md2pdf-open-repo'));
  assert.ok(c.includes('<span>A &amp; &lt;B&gt;&quot;</span>'), '显式落款应 HTML 转义');
});

test('GB：无文末落款（无 colophon 容器，更无链接）', async () => {
  const res = await render('---\n标准号: GB/T 1—2020\n---\n\n## 1 范围\n', { type: 'gb', numbering: 'none', gbDefaults: false }, { webSafe: true });
  assert.ok(!res.html.includes('<div class="colophon">'));
});

test('web 且显式文件名：非 document.md 时保持文件名落款', async () => {
  const res = await render(BODY, {}, { webSafe: true, filename: 'report.md' });
  assert.ok(colophon(res.html).includes('<span>report.md</span>'));
  assert.ok(!colophon(res.html).includes('md2pdf-open-repo'));
});

test('web + SKILL 落款：保持 SKILL · <name>，不产生链接', async () => {
  const res = await render('---\nname: demo\n---\n\n# 标题\n', {}, { webSafe: true });
  const c = colophon(res.html);
  assert.ok(c.includes('SKILL · demo'));
  assert.ok(!c.includes('md2pdf-open-repo'));
});
