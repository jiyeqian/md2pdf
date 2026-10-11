import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../web/editor-core.js';

const sandbox = { console: { warn() {} } };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../web/editor-vendor.js', import.meta.url), 'utf8'), sandbox);
const parser = sandbox.MDEditorVendor.markdownLanguage.parser.configure(globalThis.mdEditorCoreHelpers.academicMarkdownExtension());
function nodes(source) {
  const result = [];
  parser.parse(source).iterate({ enter(node) { result.push({ name: node.name, from: node.from, to: node.to }); } });
  return result;
}

test('display math brackets and TeX commands never become links, including blank lines', () => {
  const source = '$$\nM(\\theta) + \\big[\\,C(\\theta) +\n\nK_d\\,\\bigr] = 0\n$$\n\n[real](https://example.com)';
  const tree = nodes(source);
  assert.equal(tree.filter(n => n.name === 'MdMath').length, 1);
  assert.deepEqual(tree.filter(n => n.name === 'Link').map(n => source.slice(n.from, n.to)), ['[real](https://example.com)']);
});

test('successive footnotes cannot absorb intervening prose as a shortcut link', () => {
  const source = '收敛[^astrom2008]。参数整定方法参见文献[^astrom2008]，\n基于学习的灵巧抓取策略见会议论文[^liu2020]。';
  const tree = nodes(source);
  assert.equal(tree.filter(n => n.name === 'MdFootnote').length, 3);
  assert.equal(tree.filter(n => n.name === 'Link').length, 0);
});

test('inline math is neutral while real links, reference links and code remain Markdown', () => {
  const source = '$K_[d] + x$ [real](https://example.com) [reference][id] `[^code] $x$`\n\n[id]: https://example.com\n\n[^note]: **定义** [source](https://example.com)';
  const tree = nodes(source);
  assert.equal(tree.filter(n => n.name === 'MdMath').length, 1);
  assert.equal(tree.filter(n => n.name === 'Link').length, 3);
  assert.equal(tree.filter(n => n.name === 'LinkReference').length, 1);
  assert.equal(tree.filter(n => n.name === 'InlineCode').length, 1);
  assert.equal(tree.filter(n => n.name === 'MdFootnoteDefinition').length, 1);
  assert.equal(tree.filter(n => n.name === 'StrongEmphasis').length, 1);
});

test('fenced and indented code do not gain academic syntax nodes', () => {
  for (const source of ['```tex\n$$\n[x]\n$$\n[^id]\n```', '    $$\n    [x]\n    $$']) {
    assert.equal(nodes(source).filter(n => n.name.startsWith('Md')).length, 0);
  }
});

test('unclosed display math reaches EOF without swallowing following text outside a closed block', () => {
  assert.equal(nodes('$$\n[x]\n').filter(n => n.name === 'MdMath').length, 1);
  assert.equal(nodes('$$').filter(n => n.name === 'MdMath').length, 1);
  const tree = nodes('$$\n[x]\n$$\n\n**正文**');
  assert.equal(tree.filter(n => n.name === 'StrongEmphasis').length, 1);
});
