import test from 'node:test';
import assert from 'node:assert/strict';
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

test('complex, transformed and non-web sources cannot issue provenance', async () => {
  for (const md of [
    'safe\n\n<p data-md2pdf-format-source-id="0">safe</p>',
    'safe\n\n![image](image.png)',
    'safe\n\n| a | b |\n| - | - |\n| c | d |',
    'safe\n\n$math$',
    'safe\r\n\r\nsecond',
    'safe\n\n[^a]: footnote\n\nreference[^a]',
  ]) {
    const result = await render(md, options, {webSafe:true, formatProvenance:true});
    assert.doesNotMatch(result.html, /<p data-md2pdf-format-source-id=/, md);
    assert.deepEqual(result.formatSourceIds, [], md);
  }
  const plain = await render('safe', options, {});
  assert.doesNotMatch(plain.html, /data-md2pdf-format-source-id/);
});
