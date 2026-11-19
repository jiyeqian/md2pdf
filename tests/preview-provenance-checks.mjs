import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { render } from '../src/render.mjs';
import { buildContentSourceMap } from '../src/content-source-map.mjs';

const marker = / data-md2pdf-format-source-id="\d+"/g;
const options = { lead: false, numbering: 'none', pagedHtml: true };

test('web preview paragraphs carry source-token identity without altering output', async () => {
  const md = '---\ntitle: Sample\n---\n## Heading\n\n重复 **文字**\n\n重复 **文字**';
  const [identified, baseline] = await Promise.all([
    render(md, options, {webSafe:true, formatProvenance:true}),
    render(md, options, {webSafe:true, formatProvenance:false}),
  ]);
  const items = buildContentSourceMap(md).filter(item => item.kind === 'text');
  assert.deepEqual([...identified.html.matchAll(marker)].map(match => Number(/="(\d+)"/.exec(match[0])[1])), items.map(item => item.id));
  assert.deepEqual(identified.formatSourceIds, items.map(item => item.id));
  assert.deepEqual(baseline.formatSourceIds, []);
  assert.equal(identified.html.replace(marker, ''), baseline.html);
  assert.equal(identified.pagedHtml.replace(marker, ''), baseline.pagedHtml);
});

test('unrelated structures preserve safe paragraph identities and rendered output', async () => {
  for (const middle of [
    '- list item', '| a | b |\n| - | - |\n| c | d |', '![image](image.png)',
    '[link](https://example.com)', '```js\ncode\n```', '$math$',
    '[^a]: footnote\n\nreference[^a]', '## Heading {#sec:test}',
  ]) {
    const md = `same\n\n${middle}\n\nsame`;
    const [result, baseline] = await Promise.all([
      render(md, options, {webSafe:true, formatProvenance:true}),
      render(md, options, {webSafe:true}),
    ]);
    const expected = buildContentSourceMap(md).filter(item => item.kind === 'text' && item.tag === 'p' && (md.slice(item.from, item.to) === 'same' || md.slice(item.from, item.to) === 'reference[^a]' || md.slice(item.from, item.to) === '[link](https://example.com)')).map(item => item.id);
    assert.deepEqual(result.formatSourceIds, expected, middle);
    assert.equal(result.html.replace(marker, ''), baseline.html, middle);
    assert.equal(result.pagedHtml.replace(marker, ''), baseline.pagedHtml, middle);
  }
});

test('unsafe paragraphs and non-web sources do not issue provenance', async () => {
  const forged = await render('safe\n\n<p data-md2pdf-format-source-id="0">safe</p>', options, {webSafe:true, formatProvenance:true});
  assert.deepEqual(forged.formatSourceIds, [0]);
  assert.equal([...forged.html.matchAll(marker)].length, 1);
  const plain = await render('safe', options, {});
  assert.deepEqual(plain.formatSourceIds, []);
});

test('paper example preserves keyword processing with preview provenance', async () => {
  const md = await readFile(new URL('../examples/paper.md', import.meta.url), 'utf8');
  const [result, baseline] = await Promise.all([
    render(md, options, {webSafe:true, formatProvenance:true}),
    render(md, options, {webSafe:true}),
  ]);
  assert.match(result.html, /class="keywords"/);
  assert.equal(result.html.replace(marker, ''), baseline.html);
  assert.equal(result.pagedHtml.replace(marker, ''), baseline.pagedHtml);
});

test('captions and lead preserve postprocessed rendering', async () => {
  for (const [md, extra, expected] of [
    ['表：表题\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n正文', {}, /<caption>/],
    ['图：图题\n\n```mermaid\ngraph TD\nA-->B\n```\n\n正文', {}, /<figcaption>/],
    ['导语内容\n\n后续正文', {lead:true}, /class="lead"/],
  ]) {
    const [result, baseline] = await Promise.all([
      render(md, {...options, ...extra}, {webSafe:true, formatProvenance:true}),
      render(md, {...options, ...extra}, {webSafe:true}),
    ]);
    assert.match(result.html, expected);
    assert.equal(result.html.replace(marker, ''), baseline.html);
    assert.equal(result.pagedHtml.replace(marker, ''), baseline.pagedHtml);
  }
});

test('GB ordinary paragraphs retain identity around notes and structured blocks', async () => {
  const md = '重复段落。\n\n:::gb-note\n重复段落。\n:::\n\n正文脚注[^@n]。\n\n[^@n]: 注释\n\n重复段落。';
  const opts = {type:'gb', gbCover:false, pagedHtml:true};
  const [result, baseline] = await Promise.all([
    render(md, opts, {webSafe:true, formatProvenance:true}),
    render(md, opts, {webSafe:true}),
  ]);
  const expected = buildContentSourceMap(md, {type:'gb'}).filter(item => item.kind === 'text' && item.tag === 'p' && (item.from === 0 || item.to === md.length || item.formatAtoms?.some(atom => atom.kind === 'gbFootnote'))).map(item => item.id);
  assert.deepEqual(result.formatSourceIds, expected);
  assert.equal(result.html.replace(marker, ''), baseline.html);
  assert.equal(result.pagedHtml.replace(marker, ''), baseline.pagedHtml);
});

test('GB example preserves rendering and pagination with provenance', async () => {
  const md = await readFile(new URL('../examples/gb.md', import.meta.url), 'utf8');
  const opts = {type:'gb', gbCover:false, pagedHtml:true};
  const [result, baseline] = await Promise.all([
    render(md, opts, {webSafe:true, formatProvenance:true}),
    render(md, opts, {webSafe:true}),
  ]);
  assert.ok(result.formatSourceIds.length > 0);
  assert.equal(result.html.replace(marker, ''), baseline.html);
  assert.equal(result.pagedHtml.replace(marker, ''), baseline.pagedHtml);
});

test('GB forged marker remains escaped and cannot acquire provenance', async () => {
  const md = '重复文字\n\n<p data-md2pdf-format-source-id="0">重复文字</p>\n\n重复文字';
  const opts = {type:'gb', gbCover:false, pagedHtml:true};
  const [result, baseline] = await Promise.all([
    render(md, opts, {webSafe:true, formatProvenance:true}),
    render(md, opts, {webSafe:true}),
  ]);
  assert.equal(result.formatSourceIds.length, 2);
  assert.equal([...result.html.matchAll(marker)].length, 2);
  assert.equal(result.html.replace(marker, ''), baseline.html);
});

test('content blocks leave surrounding ordinary paragraph identities intact', async () => {
  for (const type of ['general', 'gb']) {
    const md = '相同正文。\n\n:::kicker\n相同正文。\n:::\n\n中间正文。\n\n:::colophon\n甲 | 乙 | 丙\n:::\n\n相同正文。';
    const opts = type === 'gb' ? {type, gbCover:false, pagedHtml:true} : {...options, type};
    const [result, baseline] = await Promise.all([
      render(md, opts, {webSafe:true, formatProvenance:true}),
      render(md, opts, {webSafe:true}),
    ]);
    const expected = buildContentSourceMap(md, {type}).filter(item => item.kind === 'text' && item.tag === 'p').map(item => item.id);
    assert.deepEqual(result.formatSourceIds, expected, type);
    assert.equal(result.html.replace(marker, ''), baseline.html, type);
    assert.equal(result.pagedHtml.replace(marker, ''), baseline.pagedHtml, type);
  }
});

test('mixed line endings preserve exact source identities', async () => {
  for (const type of ['general', 'gb']) {
    const md = '相同文字\r\n\r\n:::kicker\r\n文件类型\r\n:::\r\n\r\n相同文字\r\r跨行\r\n段落\n\n<p data-md2pdf-format-source-id="0">伪造</p>\r\n\r\n尾段';
    const opts = type === 'gb' ? {type, gbCover:false, pagedHtml:true} : {...options, type};
    const [result, baseline] = await Promise.all([
      render(md, opts, {webSafe:true, formatProvenance:true}),
      render(md, opts, {webSafe:true}),
    ]);
    const map = buildContentSourceMap(md, {type});
    const marked = result.formatSourceIds.map(id => map.find(item => item.id === id));
    assert.deepEqual(marked.map(item => md.slice(item.from, item.to)), ['相同文字', '相同文字', '跨行\r\n段落', '尾段'], type);
    assert.equal(result.html.replace(marker, ''), baseline.html, type);
    assert.equal(result.pagedHtml.replace(marker, ''), baseline.pagedHtml, type);
  }
});


test('safe paired inline HTML renders consistently and carries preview identity', async () => {
  const md = '前 <strong>粗<em>斜</em></strong> 与 <del>删</del>。';
  const cli = await render(md, options, {});
  const web = await render(md, options, { webSafe: true, formatProvenance: true });
  const expected = '前 <strong>粗<em>斜</em></strong> 与 <del>删</del>。';
  assert.ok(cli.html.includes(expected));
  assert.ok(web.html.includes(expected));
  assert.equal(web.formatSourceIds.length, 1);
  const unsafe = await render('前 <strong onclick="evil()">坏</strong>。', options, { webSafe: true });
  assert.ok(!unsafe.html.includes('<strong onclick="evil()">'));
});

test('formatted repeated references retain their targets in CLI and WebApp', async () => {
  const md = '前 <strong>\\ref{fig:a} 和 \\ref{fig:a} 与[^key]及[^key]</strong>。\n\n![图片 {#fig:a}](https://a.b/test.png)\n\n[^key]: 内容\n';
  const [cli, web] = await Promise.all([render(md, options), render(md, options, {webSafe:true, formatProvenance:true})]);
  const paragraph = result => result.html.match(/<p[^>]*>前 [\s\S]*?<\/p>/)?.[0].replace(marker, '');
  assert.equal(paragraph(web), paragraph(cli));
  assert.equal((paragraph(web).match(/href="#fig-1"/g) || []).length, 2);
  assert.equal((paragraph(web).match(/href="#fn-1"/g) || []).length, 2);
  assert.match(paragraph(web), /<strong>[\s\S]*<\/strong>/);
});

test('ordinary text around equation and GB notes retains paragraph identity', async () => {
  for (const md of ['前文 $\\eqref{eq:a}$ 后文。', '---\ntype: gb\n---\n# 标准\n\n前文[^@a]后文。\n\n[^@a]: 注释']) {
    const result = await render(md, {}, {webSafe:true, formatProvenance:true});
    const item = buildContentSourceMap(md).find(x => x.kind === 'text' && x.text.startsWith('前文'));
    assert.ok(result.formatSourceIds.includes(item.id), md);
  }
});

test('formatting complete equations and GB footnote calls keeps the rendered targets', async () => {
  const samples = [
    ['前文 $\\eqref{eq:a}$ 后文。', '\n\n$$\nx=1\\label{eq:a}\n$$', ''],
    ['前文[^@a]后文。', '\n\n[^@a]: 注释', '---\ntype: gb\n---\n# 标准\n\n'],
  ];
  for (const [paragraph, suffix, prefix] of samples) {
    const original = await render(prefix + paragraph + suffix, {});
    const renderedParagraph = result => result.html.match(/<p[^>]*>(?:<(?:strong|em|del)>)?前文[\s\S]*?<\/p>/)?.[0].replace(marker, '');
    assert.ok(renderedParagraph(original));
    for (const tag of ['strong', 'em', 'del']) {
      const source = prefix + '<' + tag + '>' + paragraph + '</' + tag + '>' + suffix;
      const [cli, web] = await Promise.all([render(source, {}), render(source, {}, {webSafe:true, formatProvenance:true})]);
      assert.equal(renderedParagraph(web), renderedParagraph(cli));
      assert.ok(renderedParagraph(cli)?.includes('<' + tag + '>'));
      assert.equal(renderedParagraph(cli).replace('<' + tag + '>', '').replace('</' + tag + '>', ''), renderedParagraph(original));
    }
  }
});

test('formatted links retain destinations in CLI and WebApp', async () => {
  const md = '前 <strong>[链接](https://example.com/a?q=1 "标题")</strong> 后。';
  const [cli, web] = await Promise.all([render(md, options), render(md, options, {webSafe:true, formatProvenance:true})]);
  const paragraph = result => result.html.match(/<p[^>]*>前 [\s\S]*?<\/p>/)?.[0].replace(marker, '');
  for (const result of [cli, web]) assert.match(paragraph(result), /<strong><a href="https:\/\/example\.com\/a\?q=1"[^>]*>链接<\/a><\/strong>/);
  assert.equal(web.formatSourceIds.length, 1);
});
