import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/options.mjs';
import { parseFrontmatter, resolveDocumentOptions } from '../src/config.mjs';
import { render } from '../src/render.mjs';

test('three bars default on, lead off; text and switches resolve independently', () => {
  const defaults = resolveDocumentOptions();
  assert.equal(defaults.header, true);
  assert.equal(defaults.footer, true);
  assert.equal(defaults.colophonEnabled, true);
  assert.equal(defaults.lead, false);
  const fm = parseFrontmatter('---\nheader-left: "资料"\ndisable: [header, colophon]\n---\n正文').fm;
  const result = resolveDocumentOptions(parseArgs(['--enable', 'header']), fm);
  assert.equal(result.header, true);
  assert.equal(result.headerLeft, '资料');
  assert.equal(result.colophonEnabled, false);
});
test('same-layer switch and legacy text conflicts fail', () => {
  assert.throws(() => parseArgs(['--enable', 'colophon', '--disable', 'colophon']), /冲突/);
  assert.throws(() => parseArgs(['--colophon', '甲', '--colophon-left', '乙']), /未知选项/);
  assert.throws(() => parseFrontmatter('---\ncolophon: "甲"\ncolophon-left: "乙"\n---\n正文'), /已移至/);
  assert.throws(() => parseArgs(['--header-right']), /缺少/);
  assert.throws(()=>parseArgs(['--colophon=false']),/未知选项/);
});
test('empty header has no native template; custom header matches paged preview', async () => {
  const empty = await render('# 标题\n\n普通段落。', {});
  assert.equal(empty.printOptions.header, false);
  assert.match(empty.html, /<p>普通段落。<\/p>/);
  const custom = await render('# 标题\n\n正文', {headerLeft:'甲<&',headerCenter:'中',headerRight:'右',pagedHtml:true});
  assert.equal(custom.printOptions.header, true);
  assert.match(custom.printOptions.headerTemplate, /甲&lt;&amp;/);
  for (const side of ['left','center','right']) assert.ok(custom.pagedHtml.includes('@top-' + side));
  const off = await render('# 标题', {header:false,headerLeft:'隐藏',colophonEnabled:false,pagedHtml:true});
  assert.equal(off.printOptions.header, false);
  assert.ok(!off.pagedHtml.includes('@top-left { content:'));
  assert.ok(!off.html.includes('<div class="colophon">'));
});
test('colophon three slots clear independently and GB keeps fixed layout', async () => {
  const result = await render('# 标题\n\n:::colophon\nleft: ""\ncenter: 居中\nright: ""\n:::');
  assert.match(result.html, /<div class="colophon"><span><\/span><span>居中<\/span><span><\/span><\/div>/);
  await assert.rejects(render('---\ntype: gb\nheader-left: "覆盖"\n---\n# 标题'), /固定版式/);
});


test('frontmatter version defaults the center colophon consistently for CLI and Web', async () => {
  const md = '---\nversion: "v2.3<&"\n---\n# 标题';
  const cli = await render(md, parseArgs([]));
  const web = await render(md, {}, { webSafe: true });
  const center = /<div class="colophon"><span>[\s\S]*?<\/span><span>([\s\S]*?)<\/span>/;
  assert.equal(cli.html.match(center)[1], 'v2.3&lt;&amp;');
  assert.equal(web.html.match(center)[1], cli.html.match(center)[1]);
  for (const value of ['', '自定义']) {
    const r=await render('---\nversion: "1.2"\n---\n# 标题\n\n:::colophon\ncenter: '+JSON.stringify(value)+'\n:::');
    assert.equal(r.html.match(center)[1],value);
  }
  const off = await render('---\nversion: "1.2"\ndisable: [colophon]\n---\n# 标题');
  assert.ok(!off.html.includes('<div class="colophon">'));
});
