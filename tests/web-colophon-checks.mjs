// Web 文末落款的结构性检查（无需浏览器/服务）：
// 统一默认落款：左侧官方仓库口号（md2pdf 超链接）、右侧本次渲染生成时间（本机时区带偏移）。
// colophon 仅覆盖左侧；显式空串只清空左侧、右侧时间保留；GB 不输出落款。
import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/render.mjs';

const REPO_URL = 'https://github.com/jiyeqian/md2pdf';
const ANCHOR = '<a href="' + REPO_URL + '" data-md2pdf-open-repo="1">md2pdf</a>';
const COLOPHON = /<div class="colophon">([\s\S]*?)<\/div>/;
const colophon = html => { const m = COLOPHON.exec(html); return m ? m[1] : ''; };
const spans = html => [...colophon(html).matchAll(/<span>([\s\S]*?)<\/span>/g)].map(m => m[1]);

// 与 render 相同的本机时区格式化，作为测试基准（同进程同时区）。
const stamp = d => {
  const p = n => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' '
    + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' '
    + sign + p(Math.floor(Math.abs(off) / 60)) + ':' + p(Math.abs(off) % 60);
};
const AT = new Date('2026-10-12T13:45:06+08:00');
const BODY = '# 标题\n\n正文。\n';

test('默认落款：左侧官方仓库口号，右侧本次渲染时间（html 与 pagedHtml 一致）', async () => {
  const res = await render(BODY, { pagedHtml: true }, { webSafe: true, generatedAt: AT });
  for (const html of [res.html, res.pagedHtml]) {
    assert.ok(colophon(html).includes(ANCHOR), '落款左侧应含仓库链接');
    assert.ok(colophon(html).includes(stamp(AT)), '落款右侧应为本次渲染时间');
    assert.ok(!colophon(html).includes('document.md'), '不应再出现占位文件名');
  }
});

test('CLI 与 Web 默认一致：都输出官方仓库口号 + 时间（不再按文件名）', async () => {
  const cli = await render(BODY, {}, { filename: 'notes.md', generatedAt: AT });
  assert.ok(colophon(cli.html).includes(ANCHOR));
  const s = spans(cli.html);
  assert.equal(s[0], 'make ' + ANCHOR + ' great');
  assert.equal(s[2], stamp(AT));
});

test('显式 colophon：只覆盖左侧并转义，右侧时间保留', async () => {
  const res = await render(BODY+'\n\n:::colophon\nA & <B>"\n:::', {}, { webSafe: true, generatedAt: AT });
  const s = spans(res.html);
  assert.ok(!colophon(res.html).includes('md2pdf-open-repo'));
  assert.equal(s[0], 'A &amp; &lt;B&gt;&quot;');
  assert.equal(s[2], stamp(AT), '右侧时间不因 colophon 改变');
});

test('显式空 colophon：只清空左侧，右侧时间保留', async () => {
  const res = await render(BODY+'\n\n:::colophon\n\n:::', {}, { webSafe: true, generatedAt: AT });
  const s = spans(res.html);
  assert.equal(s[0], '');
  assert.equal(s[2], stamp(AT));
  assert.ok(res.html.includes('<div class="colophon">'), '空 colophon 仍输出落款容器');
});

test('时间格式固定为 YYYY-MM-DD HH:mm:ss ±HH:mm', () => {
  assert.match(stamp(AT), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}$/);
});

test('GB：无文末落款（无 colophon 容器，更无链接）', async () => {
  const res = await render('---\n标准号: GB/T 1—2020\n---\n\n## 1 范围\n', { type: 'gb', gbDefaults: false }, { webSafe: true, generatedAt: AT });
  assert.ok(!res.html.includes('<div class="colophon">'));
});

test('SKILL 默认落款与其他类型一致（官方仓库口号 + 时间）', async () => {
  const res = await render('---\nname: demo\n---\n\n# 标题\n', {}, { webSafe: true, generatedAt: AT });
  assert.ok(colophon(res.html).includes(ANCHOR));
  assert.equal(spans(res.html)[2], stamp(AT));
});

test('每次 render 单一时间：落款时间不随内容/页数变化', async () => {
  const a = await render(BODY, {}, { generatedAt: AT });
  const b = await render(BODY + '\n更多正文。\n\n## 小节\n\n正文。\n', {}, { generatedAt: AT });
  assert.equal(spans(a.html)[2], spans(b.html)[2]);
});
