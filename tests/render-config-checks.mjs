// 渲染配置合并与统一行为的结构性检查（无需浏览器）：
// 覆盖 CLI/Web 同结果、优先级、空标题、页脚各路径、导语排除、落款时间、
// 参考文献自定义与空标题、GB 强制版式、enable/disable 与 ConfigError。
import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/render.mjs';

const AT = new Date('2026-10-12T13:45:06+08:00');
const web = (md, opts = {}, ctx = {}) => render(md, opts, { webSafe: true, generatedAt: AT, ...ctx });
const tocBlock = html => /<div class="toc">([\s\S]*?)<\/ol><\/div>/.exec(html)?.[1] || '';

test('优先级 explicit > FM > profile.defaults > 全局默认', async () => {
  const fm = '---\ntitle: FM标题\nkicker: FM副题\n---\n# 正文标题\n';
  const a = await web(fm);
  assert.equal(a.title, 'FM标题');
  assert.match(a.html, /<div class="kicker">FM副题<\/div>/);

  const b = await web(fm, { title: 'CLI标题', kicker: 'CLI副题' });
  assert.equal(b.title, 'CLI标题');
  assert.match(b.html, /<div class="kicker">CLI副题<\/div>/);

  // 显式空串清空并阻止低层回退
  const c = await web(fm, { title: '', kicker: '' });
  assert.equal(c.title, '');
  assert.match(c.html, /<div class="kicker"><\/div>/);
});

test('title 显式空串隐藏文档标题：不回退 H1 或文件名', async () => {
  const w = await web('# 正文标题\n\n正文。', { title: '' });
  assert.equal(w.title, '');
  assert.match(w.html, /<header class="masthead title-omitted">/);
  const cli = await render('# 正文标题\n\n正文。', { title: '' }, { filename: 'notes.md', generatedAt: AT });
  assert.equal(cli.title, '');
});

test('页脚：默认 center=当前/总页数，左右独立，footer=false 关整栏', async () => {
  const def = await web('# 标题\n\n## 小节\n\n正文。', { toc: true });
  assert.match(def.html, /@bottom-center \{ content: counter\(page\) " \/ " counter\(pages\)/);
  const left = await web('# 标题\n\n## 小节\n\n正文。', { toc: true, footerLeft: 'L' });
  assert.match(left.html, /@bottom-left \{ content: "L"/);
  const right = await web('# 标题\n\n## 小节\n\n正文。', { toc: true, footerRight: 'R' });
  assert.match(right.html, /@bottom-right \{ content: "R"/);
  const off = await web('# 标题\n\n## 小节\n\n正文。', { toc: true, footer: false });
  assert.ok(!off.html.includes('@bottom-center'));
  assert.ok(!off.html.includes('@bottom-left'));
});

test('页脚 center 显式替换与空串清空', async () => {
  const c = await web('# 标题\n\n## 小节\n\n正文。', { toc: true, footerCenter: '第 X 页' });
  assert.match(c.html, /@bottom-center \{ content: "第 X 页"/);
  assert.ok(!/@bottom-center \{ content: counter\(page\)/.test(c.html));
  const empty = await web('# 标题\n\n## 小节\n\n正文。', { toc: true, footerCenter: '' });
  assert.ok(!empty.html.includes('@bottom-center'));
});

test('Chrome 打印路径页脚与 Paged 路径一致', async () => {
  const def = await web('# 标题\n\n正文。');
  assert.match(def.printOptions.footerTemplate, /pageNumber/);
  assert.match(def.printOptions.footerTemplate, /totalPages/);
  const c = await web('# 标题\n\n正文。', { footerCenter: 'C' });
  assert.match(c.printOptions.footerTemplate, /text-align:center;">C<\/span>/);
  const e = await web('# 标题\n\n正文。', { footerCenter: '' });
  assert.match(e.printOptions.footerTemplate, /text-align:center;"><\/span>/);
});

test('参考文献标题可自定义；空串只去标题、保留条目与链接；无引用不生成', async () => {
  const md = '# 标题\n\n引用[^a]。\n\n[^a]: @article{k, title={T}, author={A}, journal={J}, year={2020}}\n';
  const def = await web(md);
  assert.match(def.html, /<h2[^>]*>[\d\s]*参考文献<\/h2>/);
  const custom = await web(md, { bibliographyTitle: '引用文献' });
  assert.match(custom.html, /<h2[^>]*>[\d\s]*引用文献<\/h2>/);
  const none = await web(md, { bibliographyTitle: '' });
  assert.ok(!none.html.includes('参考文献<\/h2>'));
  assert.match(none.html, /class="references"/);
  assert.match(none.html, /href="#fn-1"/);
  const emptyDoc = await web('# 标题\n\n无参考文献。');
  assert.ok(!emptyDoc.html.includes('<ol class="references">'));
  assert.ok(!/参考文献<\/h2>/.test(emptyDoc.html));
});

test('FM enable/disable 控制功能开关（列表、可重复）', async () => {
  const on = await web('---\nenable:\n  - toc\n---\n# 标题\n\n## 小节\n');
  assert.match(on.html, /class="toc"/);
  const off = await web('---\nname: demo\ndisable:\n  - meta\n---\n# 标题\n');
  assert.ok(!off.html.includes('class="meta"'));
});

test('FM 未知功能名与运行型开关被拒绝', async () => {
  await assert.rejects(() => web('---\nenable:\n  - nope\n---\n# 标题\n'), /未知功能名/);
  await assert.rejects(() => web('---\nenable:\n  - open\n---\n# 标题\n'), /运行操作|不能由 frontmatter/);
});

test('frontmatter 配置错误抛 ConfigError（带行号，中文可读）', async () => {
  await assert.rejects(
    () => web('---\ntitle: ok\ntitle: dup\n---\n# 标题\n'),
    e => e.name === 'ConfigError' && e.status === 400 && Array.isArray(e.configErrors)
      && e.configErrors[0].line === 3);
  await assert.rejects(
    () => web('---\ntitle:\n  - a\n  - b\n---\n# 标题\n'),
    e => e.name === 'ConfigError');
  await assert.rejects(
    () => web('---\ntheme: nope\n---\n# 标题\n'),
    e => e.name === 'ConfigError' && /主题|未知/.test(e.configErrors[0].message));
});

test('字号/行距/边距/主题/编号/目录深度可由 FM 配置', async () => {
  const r = await web('---\nfont-size: 12\nline-height: 1.5\nmargin: "30,25"\nnumbering: none\ntheme: minimal\n---\n# 标题\n\n## 小节\n\n正文。\n');
  assert.match(r.html, /--doc-font-size:\s*12pt/);
  assert.match(r.html, /--doc-line-height:\s*1\.5/);
  assert.match(r.html, /margin:\s*30mm 25mm 30mm 25mm/);
  const depth = await web('---\nenable:\n  - toc\ntoc-depth: 2\n---\n# 标题\n\n## 顶层\n\n### 次层\n');
  const t = tocBlock(depth.html);
  assert.ok(t.includes('顶层') && t.includes('次层'));
});

test('GB 强制版式不可被 FM enable 绕过（无导语、无落款）', async () => {
  const md = '---\n标准号: GB/T 1—2020\nenable:\n  - lead\n---\n\n# 标题\n\n这段不该成为导语。\n\n## 1 范围\n\n正文。\n';
  const r = await web(md, { gbDefaults: false });
  assert.equal(r.type, 'gb');
  assert.ok(!/<p class="lead">[^<]/.test(r.html));
  assert.ok(!r.html.includes('<div class="colophon">'));
});

test('CLI 与 Web 对同一配置产出相同有效结果', async () => {
  const src = '---\ntitle: 共用标题\nfooter-center: "中心"\n---\n# 正文\n\n正文。\n';
  const cli = await render(src, {}, { filename: 'a.md', generatedAt: AT });
  const wv = await render(src, {}, { webSafe: true, generatedAt: AT });
  assert.equal(cli.title, wv.title);
  assert.match(cli.printOptions.footerTemplate, /text-align:center;">中心<\/span>/);
  assert.match(wv.printOptions.footerTemplate, /text-align:center;">中心<\/span>/);
});
// —— CLI 层：配置错误给出文件行号、退出非零、不写无效输出、输入源数据不改 ——
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const CLI = fileURLToPath(new URL('../src/md2pdf.mjs', import.meta.url));

test('CLI：frontmatter 错误给出行号、退出非零、不写输出、不改输入', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'md2pdf-cfg-'));
  const md = path.join(dir, 'bad.md');
  const src = '---\ntitle: ok\ntitle: dup\n---\n# 标题\n';
  writeFileSync(md, src);
  const out = path.join(dir, 'out.html');
  const r = spawnSync(process.execPath, [CLI, md, '--html-only', '-o', out], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, '配置错误应以非零退出');
  assert.match(r.stderr, /:3\b/, '错误信息应含 frontmatter 行号');
  assert.ok(!existsSync(out), '不应写出无效输出');
  assert.equal(readFileSync(md, 'utf8'), src, '不应改写输入源数据');
});

test('自定义 center 不被 finalizePagedCounters 覆盖；列表序号修正仍在', async () => {
  const def = await web('# 标题\n\n## 小节\n\n正文。', { toc: true });
  assert.match(def.html, /finalizePagedCounters\(true\)/);
  const custom = await web('# 标题\n\n## 小节\n\n正文。', { toc: true, footerCenter: 'X' });
  assert.match(custom.html, /finalizePagedCounters\(false\)/);
  const off = await web('# 标题\n\n## 小节\n\n正文。', { toc: true, footer: false });
  assert.match(off.html, /finalizePagedCounters\(false\)/);
  assert.ok(def.html.includes('stampPagedLists'));
});

test('目录采用文档字号比例，CLI 与 Web 共用缩放规则', async () => {
  for (const theme of ['elegant', 'minimal']) {
    for (const fontSize of [10.5, 21]) {
      const source = '# 文档\n\n## 一级\n\n### 二级\n';
      const options = { theme, fontSize, toc: true, tocDepth: 2 };
      const cli = await render(source, options, { generatedAt: AT });
      const preview = await web(source, options);
      for (const html of [cli.html, preview.html]) {
        assert.ok(html.includes('--doc-font-size: ' + fontSize + 'pt'));
        assert.match(html, /\.toc \{\s*font-size: calc\(var\(--doc-font-size\) \/ 10\.5 \* 9\.5\)/);
        assert.match(html, /\.toc-title \{\s*font-size: inherit/);
        assert.match(html, /\.toc li \{[^}]*font-size: inherit/);
      }
    }
  }
});


test('CLI and Web render list keywords identically, hide empty lists, and leave tags as metadata', async () => {
  const {parseArgs} = await import('../src/options.mjs');
  const md = '---\nkeywords: ["甲<&", "乙"]\ntags: ["标签"]\n---\n# 标题\n';
  const cli = await render(md, parseArgs([]), {generatedAt:AT});
  const online = await web(md);
  for (const result of [cli, online]) {
    assert.equal(result.type, 'paper');
    assert.ok(result.html.includes('甲&lt;&amp;；乙'));
    assert.ok(!result.html.includes('标签'));
  }
  const empty = await web('---\nkeywords: []\ntags: ["标签"]\n---\n# 标题');
  assert.equal(empty.type, 'general');
  assert.ok(!empty.html.includes('<div class="keywords">'));
});
