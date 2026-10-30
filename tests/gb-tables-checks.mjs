import test from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from '../vendor/marked.esm.js';
import { prepareGbContent, transformGbContent } from '../src/gb-content.mjs';

const marked = new Marked({ gfm: true });
const parse = source => { const block = prepareGbContent(source); return block.restore(marked.parse(block.body), marked); };
const table = text => `:::gb-table\n${text}\n:::`;

test('复杂表格支持合并单元格、列宽、转义竖线和行内 Markdown', () => {
  const html = parse(table('widths: 20 35 35\nhead:\n| {rowspan=2} 项目 | {colspan=2} **指标** |\n| 甲 | 乙 |\nbody:\n| {rowspan=2} A\\|B | 1 | 2 |\n| 3 | 4 |\n| C | 5 | 6 |'));
  assert.match(html, /<colgroup><col style="width:22\.222/);
  assert.match(html, /<th rowspan="2">项目<\/th><th colspan="2"><strong>指标<\/strong>/);
  assert.match(html, /<td rowspan="2">A\|B<\/td>/);
  assert.equal((html.match(/<tbody>/g) || []).length, 2);
  assert.match(transformGbContent(html + '\n<div class="gb-table-note"><p>注</p></div>', ''), /<tfoot><tr class="gb-table-notes"><td colspan="3">/);
});

test('拒绝错误尺寸、缺格、重叠、跨行组、无效结构及未闭合块', () => {
  const invalid = [
    'head:\n| A | B |\nbody:\n| 1 |',
    'widths: 1 1\nhead:\n| A | B |\nbody:\n| {colspan=3} x |',
    'head:\n| {rowspan=2} A | B |\nbody:\n| 1 | 2 |',
    'head:\n| A | B | C |\nbody:\n| x | {rowspan=2} y | z |\n| {colspan=2} q |',
    'widths: 1 0\nhead:\n| A | B |\nbody:\n| 1 | 2 |',
    'head:\n| A |\nbody:\n| {rowspan=0} B |',
    'head:\n| A |\nbody:\n| {colspan=1 onclick=x} B |',
    'head:\n| A |\nbody:',
  ];
  for (const value of invalid) assert.throws(() => parse(table(value)), error => error.status === 400);
  assert.throws(() => parse(':::gb-table\nhead:\n| A |'), error => error.status === 400);
});

test('限制链接协议和 HTML，围栏内语法保持原样', () => {
  const html = parse(table('head:\n| 标题 |\nbody:\n| <script>x</script> |'));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  const source = '```text\n:::gb-table\nhead:\n| A |\n:::\n```';
  assert.equal(parse(source), marked.parse(source));
});

test('核心渲染在 CLI 和 webSafe 模式保留复杂表格及数学，其他模板不解释块', async () => {
  const { render } = await import('../src/render.mjs');
  const source = '# 标题\n\n表：测试\n\n' + table('head:\n| A | B |\nbody:\n| **内容** | $x+1$ |');
  const cli = await render(source, { type: 'gb' });
  const web = await render(source, { type: 'gb' }, { webSafe: true });
  for (const result of [cli, web]) {
    assert.match(result.html, /<table class="tbl" id="tab-1">/);
    assert.match(result.html, /<td><strong>内容<\/strong><\/td><td>\$x\+1\$<\/td>/);
  }
  const other = await render(source, { type: 'general' });
  assert.doesNotMatch(other.html, /<colgroup><col style="width:50%">/);
  assert.match(other.html, /:::gb-table/);
});


test('GB 校准注释仅在代码围栏外移除，CLI 和 webSafe 一致', async () => {
  const { render } = await import('../src/render.mjs');
  const source = '# 标题\n\n<!-- gb-check:location -->\n\n```text\n<!-- gb-check:in-code -->\n```';
  for (const context of [{}, { webSafe: true }]) {
    const result = await render(source, { type: 'gb' }, context);
    assert.doesNotMatch(result.html, /gb-check:location/);
    assert.match(result.html, /gb-check:in-code/);
  }
  const other = await render(source, { type: 'general' }, { webSafe: true });
  assert.match(other.html, /gb-check:location/);
});

test('GB 文献填入显式章节，其他模板保持既有追加顺序', async () => {
  const {render}=await import('../src/render.mjs');
  const md='---\ntitle: 次序\n---\n\n## 范围\n正文[^ref]。\n\n## 参考文献 {role=bibliography}\n\n## 索引 {role=index}\n\n:::gb-index G\n关键词 | 1\n:::\n\n[^ref]: 参考文件';
  const gb=await render(md,{type:'gb'});
  const main=/<main>([\s\S]*?)<\/main>/.exec(gb.html)[1];
  assert.ok(main.indexOf('gb-references-title')<main.indexOf('gb-index-title'));
  const normal=await render(md.replace('## 参考文献 {role=bibliography}\n\n',''),{type:'general'});
  const body=/<main>([\s\S]*?)<\/main>/.exec(normal.html)[1];
  assert.ok(body.indexOf('索引')<body.indexOf('参考文献'));
});


test('单元格图片和不允许的链接在 CLI 和 webSafe 中以相同错误拒绝', async () => {
  const { render } = await import('../src/render.mjs');
  for (const value of ['![图](photo.png)', '![图](https://example.com/a.png)', '![图](data:image/png;base64,AAAA)', '[文](other.md)', '[文](javascript:alert%281%29)', '[文](javascript&#58;alert)']) {
    const source = '# 标题\n\n' + table('head:\n| 标题 |\nbody:\n| ' + value + ' |');
    const errors = [];
    for (const context of [{}, { webSafe: true }]) {
      try { await render(source, { type: 'gb' }, context); assert.fail('应拒绝 ' + value); }
      catch (error) { assert.equal(error.status, 400, value); errors.push(error.message); }
    }
    assert.equal(errors[0], errors[1], value);
  }
});

test('安全链接和代码内字面图片、链接均可跨模式渲染', async () => {
  const { render } = await import('../src/render.mjs');
  const source = '# 标题\n\n' + table('head:\n| 标题 |\nbody:\n| [网页](https://example.com) [锚点](#here) `![图片](a.png) [链接](b.md)` |');
  for (const context of [{}, { webSafe: true }]) {
    const { html } = await render(source, { type: 'gb' }, context);
    assert.match(html, /href="https:\/\/example\.com"/);
    assert.match(html, /href="#here"/);
    assert.match(html, /<code>!\[图片\]\(a\.png\) \[链接\]\(b\.md\)<\/code>/);
  }
});
