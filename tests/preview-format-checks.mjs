import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from '../vendor/marked.esm.js';
import { buildContentSourceMap } from '../src/content-source-map.mjs';
import { formatPreviewSelection as change } from '../web/preview-format.mjs';
const marked = new Marked({ gfm: true });
function run(source, selected, format, occurrence = 0) {
  const item = buildContentSourceMap(source).find(x => x.kind === 'text');
  let index = -1; for (let i = 0; i <= occurrence; i++) index = source.indexOf(selected, index + 1);
  const result = change(source, { from: index, to: index + selected.length, item }, format);
  return result && source.slice(0, result.from) + result.insert + source.slice(result.to);
}
function rendered(source, selected, format, expected, occurrence = 0) {
  const result = run(source, selected, format, occurrence);
  assert.notEqual(result, null, source);
  assert.equal(marked.parseInline(result), expected);
}
test('sets and removes formats with Markdown rendering', () => {
  rendered('abc abc', 'abc', 'bold', 'abc <strong>abc</strong>', 1);
  rendered('**abc**', 'abc', 'bold', 'abc');
  rendered('*abc*', 'abc', 'italic', 'abc');
  rendered('~~abc~~', 'abc', 'strike', 'abc');
  rendered('**abcde**', 'bcd', 'bold', '<strong>a</strong>bcd<strong>e</strong>');
  rendered('**a *b* c**', 'a *b* c', 'bold', 'a <em>b</em> c');
  rendered('**ab** cd', 'ab** cd', 'bold', '<strong>ab cd</strong>');
  rendered('**中文**相邻', '相邻', 'bold', '<strong>中文相邻</strong>');
  rendered('__ab__ cd', 'ab__ cd', 'bold', '<strong>ab cd</strong>');
  rendered('~~ab~~ cd', 'ab~~ cd', 'strike', '<del>ab cd</del>');
  rendered('*ab* cd', 'ab* cd', 'italic', '<em>ab cd</em>');
  rendered('**a*b*c**', 'b', 'bold', '<strong>a</strong><em>b</em><strong>c</strong>');
  rendered('**a *b* c**', 'b', 'bold', '<strong>a </strong><em>b</em><strong> c</strong>');
  rendered('~~a *b* c~~', 'b', 'strike', '<del>a </del><em>b</em><del> c</del>');
  rendered('*a ~~b~~ c*', 'b', 'italic', '<em>a </em><del>b</del><em> c</em>');
  rendered('**abc**', 'abc', 'italic', '<strong><em>abc</em></strong>');
  rendered('*abc*', 'abc', 'bold', '<strong><em>abc</em></strong>');
});
test('rejects constructs and unsafe boundaries', () => {
  for (const source of ['a &amp; b', 'a \\*b', '[abc](url)', 'a $x$ b', 'a `b` c']) assert.equal(run(source, 'a', 'bold'), null, source);
  assert.equal(run('a b', 'a ', 'bold'), null);
});

test('handles HTML and Markdown together and punctuation boundaries', () => {
  rendered('<strong>abcde</strong>', 'bcd', 'bold', '<strong>a</strong>bcd<strong>e</strong>');
  rendered('<strong>a *b* c</strong>', 'b', 'bold', '<strong>a </strong><em>b</em><strong> c</strong>');
  rendered('**a <em>b</em> c**', 'b', 'italic', '<strong>a b c</strong>');
  rendered('hello, world!', ', world!', 'bold', 'hello<strong>, world!</strong>');
  rendered('<strong>ab</strong> cd', 'ab</strong> cd', 'bold', '<strong>ab cd</strong>');
  for (const source of ['a <strong class="x">b</strong>', 'a <strong>b</em>', 'a <script>b</script>']) assert.equal(run(source, 'b', 'bold'), null);
});
test('returns exact selected character boundaries after reconstruction', () => {
  const source = '<strong>abcde</strong>';
  const item = buildContentSourceMap(source).find(x => x.kind === 'text');
  const result = change(source, { from: source.indexOf('bcd'), to: source.indexOf('bcd') + 3, item }, 'bold');
  assert.ok(result);
  assert.equal(result.insert.slice(result.selectionFrom - result.from, result.selectionTo - result.from), 'bcd');
});
