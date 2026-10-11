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
  assert.match(toc(html), /class="toc-text">1 小节<\/span>/);
  assert.match(html, /make <a[^>]*>md2pdf<\/a> great/);
});


test('empty H1 removes the masthead rule and TOC titles preserve two spaces', async () => {
  const html = (await web('#\n\n## 小节', {toc:true})).html;
  assert.match(html, /<header class="masthead title-omitted">/);
  assert.match(html, /class="toc-title">目  录<\/div>/);
  assert.match(html, /class="toc-text">小节<\/span><span class="toc-dots"><\/span>/);
});


test('TOC PDF uses Paged.js and disables duplicate native page footers', async () => {
  const result = await web('# 标题\n\n## 小节', {toc:true});
  assert.equal(result.printOptions.waitPaged, true);
  assert.equal(result.printOptions.footer, false);
  assert.match(result.html, /window.__md2pdfPagedReady/);
  assert.match(result.html, /target-counter\(attr\(href\), page\)/);
});


test('documents without TOC retain native PDF printing', async () => {
  const result = await web('# 标题\n\n## 小节', {toc:false});
  assert.equal(result.printOptions.waitPaged, false);
  assert.ok(!result.html.includes('window.__md2pdfPagedReady'));
});


test('TOC pagination respects explicit disabling of page footers', async () => {
  const result = await web('# 标题\n\n## 小节', {toc:true,footer:false});
  assert.ok(!result.html.includes('@bottom-center'));
});

import { stampPagedLists, finalizePagedCounters } from '../src/paged-counters.mjs';
test('paged lists preserve start, explicit values and reversed numbering, excluding references', () => {
  const node = (attrs = {}) => ({tagName:'LI', attrs:{...attrs}, getAttribute(k){return this.attrs[k] ?? null;}, setAttribute(k,v){this.attrs[k]=v;}});
  const a = [node(), node({value:'7'}), node()];
  const b = [node(), node()];
  const excluded = [node()];
  const ol = (children, attrs = {}, skip = false) => ({children, closest:()=>skip, hasAttribute:k=>k in attrs, getAttribute:k=>attrs[k] ?? null});
  stampPagedLists({querySelectorAll:()=>[ol(a,{start:'3'}),ol(b,{reversed:''}),ol(excluded,{},true)]});
  assert.deepEqual(a.map(n=>n.attrs['data-md2pdf-n']), ['3','7','8']);
  assert.deepEqual(b.map(n=>n.attrs['data-md2pdf-n']), ['2','1']);
  assert.equal(excluded[0].attrs['data-md2pdf-n'], undefined);
});
test('paged footers receive actual nonzero page counts after pagination', () => {
  const footers = Array.from({length:4},()=>({classList:{add(){}},textContent:''}));
  const styles = [];
  const root = {createElement:()=>({}),head:{appendChild:s=>styles.push(s)},querySelectorAll:()=>footers.map(f=>({querySelector:()=>f}))};
  finalizePagedCounters(true,root);
  assert.deepEqual(footers.map(f=>f.textContent), ['1 / 4','2 / 4','3 / 4','4 / 4']);
  assert.ok(styles[0].textContent.includes('content: attr(data-md2pdf-n)'));
});
