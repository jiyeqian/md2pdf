import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/render.mjs';
const web = (md, opts = {}) => render(md, { numbering: 'none', ...opts }, { webSafe: true });
const toc = html => /<div class="toc">([\s\S]*?)<\/ol><\/div>/.exec(html)?.[1] || '';
const lead = html => /<p class="lead">([\s\S]*?)<\/p>/.exec(html)?.[1] || '';
test('missing H1 prompts; empty H1 suppresses fallback without overriding explicit metadata', async () => {
  assert.equal((await web('正文。')).title, '设置一级标题为文档标题');
  assert.equal((await web('#\n\n正文。')).title, '');
  assert.equal((await web('#\n', {title:'显式标题'})).title, '显式标题');
  assert.equal((await web('---\ntitle: 元数据标题\n---\n#\n')).title, '元数据标题');
});
test('lead requires H1 and cannot promote text beneath H2, with no length threshold', async () => {
  assert.equal(lead((await web('# 标题\n\n短导言。\n\n## 小节\n\n正文。')).html), '短导言。');
  assert.equal(lead((await web('# 标题\n\n## 小节\n\n较长的正文不会被错误提升为导言。')).html), '');
  assert.equal(lead((await web('没有一级标题的长段落也不作为导言。')).html), '');
  assert.equal(lead((await web('# 标题\n\n没有二级标题的段落仍为正文。')).html), '');
});
test('TOC excludes H1 and selects highest one or two actual levels with live anchors', async () => {
  const md = '# 标题\n\n## 顶层\n\n### 次层\n\n#### 三层';
  const one = toc((await web(md, {toc:true,tocDepth:1})).html);
  const two = toc((await web(md, {toc:true,tocDepth:2})).html);
  assert.ok(one.includes('顶层')); assert.ok(!one.includes('次层'));
  assert.ok(two.includes('次层')); assert.ok(!two.includes('三层')); assert.ok(!two.includes('>标题<'));
  const gaps = toc((await web('# 标题\n\n### 顶层\n\n##### 次层', {toc:true,tocDepth:2})).html);
  assert.ok(gaps.includes('顶层')); assert.ok(gaps.includes('次层'));
});
test('TOC keeps the chosen heading numbering, and colophon only links md2pdf', async () => {
  const html = (await web('# 标题\n\n## 小节', {toc:true,numbering:'force',numberScheme:'arabic'})).html;
  assert.match(toc(html), />1 小节<\/a>/);
  assert.match(html, /make <a[^>]*>md2pdf<\/a> great/);
});
