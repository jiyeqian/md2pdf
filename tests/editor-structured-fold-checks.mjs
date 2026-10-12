import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../web/editor-core.js';

const sandbox = { console: { warn() {} } };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../web/editor-vendor.js', import.meta.url), 'utf8'), sandbox);
const V = sandbox.MDEditorVendor;
const H = globalThis.mdEditorCoreHelpers;
function stateFor(doc) {
  const folding = H.structuredFolding(V);
  return V.EditorState.create({ doc, extensions: [
    V.markdown({ base: V.markdownLanguage, codeLanguages: info => info === 'yaml' ? V.yamlLanguage : null,
      extensions: [H.structuredMarkdownExtension(V),
      H.academicMarkdownExtension(), { props: [folding.props] }] }),
    folding.service, V.codeFolding()
  ] });
}
function nodes(state) {
  const found = [];
  V.ensureSyntaxTree(state, state.doc.length, 1000).iterate({ enter(node) {
    found.push({ name: node.name, from: node.from, to: node.to });
  } });
  return found;
}
function foldAt(state, number) {
  const line = state.doc.line(number);
  const fold = V.foldable(state, line.from, line.to);
  return fold && { from: fold.from, to: fold.to };
}
function ranges(state) {
  const found = [];
  V.foldedRanges(state).between(0, state.doc.length, (from, to) => found.push({ from, to }));
  return found;
}
const entry = (id = 'wang2021') => `[^${id}]: @article{${id},
  author = {王伟 and 李强},
  title = {仿生机械手抓取控制研究进展},
  year = {2021}
  }`;

test('GB, paper and skill frontmatter mount YAML and never become Markdown headings', () => {
  for (const file of ['gb', 'paper', 'skill']) {
    const source = readFileSync(new URL('../examples/' + file + '.md', import.meta.url), 'utf8');
    const state = stateFor(source), tree = nodes(state), fm = H.frontmatterRange(source);
    assert.equal(tree.filter(node => node.name === 'MdFrontmatter').length, 1);
    assert.ok(tree.some(node => /Mapping/.test(node.name) && node.from < fm.to));
    assert.equal(tree.filter(node => /Heading/.test(node.name) && node.from < fm.to).length, 0);
    assert.deepEqual(foldAt(state, 1), { from: state.doc.line(1).to, to: fm.to });
    assert.equal(state.doc.sliceString(fm.to, fm.to + 1), '\n');
  }
});

test('YAML keys receive the same property-name highlight for English and Chinese', () => {
  const state = stateFor('---\ntitle: Example\n标准号: GB/T 1\n---\n正文');
  const spans = [];
  const style = V.HighlightStyle.define([{ tag: V.tags.propertyName, class: 'yaml-key' }]);
  V.highlightTree(V.syntaxTree(state), style, (from, to, classes) => {
    if (classes === 'yaml-key') spans.push(state.doc.sliceString(from, to));
  });
  assert.deepEqual(spans, ['title', '标准号']);
});

test('frontmatter arrays, nested mappings and multiline text fold completely at their keys', () => {
  const source = '---\n标准号: GB/T 1\n发布单位:\n  - 单位一\n  - 单位二\noptions:\n  nested:\n    enabled: true\nabstract: |\n  第一段\n  第二段\n---\n\n## 正文\n内容';
  const state = stateFor(source); nodes(state);
  assert.equal(foldAt(state, 2), null);
  for (const [first, last] of [[3, 5], [6, 8], [7, 8], [9, 11]]) {
    assert.deepEqual(foldAt(state, first), { from: state.doc.line(first).to, to: state.doc.line(last).to });
  }
  const inner = foldAt(state, 3), outer = foldAt(state, 1);
  let folded = state.update({ effects: V.foldEffect.of(inner) }).state;
  folded = folded.update({ effects: V.foldEffect.of(outer) }).state;
  folded = folded.update({ effects: V.unfoldEffect.of(outer) }).state;
  assert.deepEqual(ranges(folded), [inner]);
  assert.equal(folded.doc.toString(), source);
});

test('only complete document-start frontmatter is recognized, including BOM and CRLF', () => {
  for (const source of ['---\ntitle: 未完成\n\n## 正文', '正文\n\n---\ntitle: 示例\n---', '```yaml\n---\na: b\n---\n```']) {
    assert.equal(nodes(stateFor(source)).filter(node => node.name === 'MdFrontmatter').length, 0);
  }
  const source = '\uFEFF---\r\na: b\r\n---\r\n正文';
  const state = stateFor(source);
  assert.equal(nodes(state).filter(node => node.name === 'MdFrontmatter').length, 1);
  assert.equal(state.doc.sliceString(foldAt(state, 1).to).trim(), '正文');
});

test('a BibTeX footnote folds all continuation lines including the closing brace', () => {
  const source = entry() + '\n\n正文[^wang2021]。';
  const state = stateFor(source), tree = nodes(state);
  assert.equal(tree.filter(node => node.name === 'MdBibtexFootnote').length, 1);
  assert.deepEqual(foldAt(state, 1), { from: state.doc.line(1).to, to: entry().length });
  assert.equal(H.bibliographyGroups(V, state).length, 0);
  assert.equal(tree.filter(node => node.name === 'MdFootnote').length, 1);
});

test('blank-separated entries form a group with independent first-entry and group ranges', () => {
  const source = entry('one') + '\n\n \n' + entry('two') + '\n\n' + entry('three') + '\n\n正文';
  const state = stateFor(source); nodes(state);
  const groups = H.bibliographyGroups(V, state);
  assert.equal(groups.length, 1); assert.equal(groups[0].count, 3);
  const group = { from: groups[0].from, to: groups[0].to }, individual = foldAt(state, 1);
  assert.equal(individual.to, entry('one').length);
  assert.ok(group.to > individual.to);
  const second = nodes(state).filter(node => node.name === 'MdBibtexFootnote')[1];
  const secondFold = foldAt(state, state.doc.lineAt(second.from).number);
  let folded = state.update({ effects: [V.foldEffect.of(individual), V.foldEffect.of(secondFold)] }).state;
  folded = folded.update({ effects: V.foldEffect.of(group) }).state;
  folded = folded.update({ effects: V.unfoldEffect.of(group) }).state;
  assert.deepEqual(ranges(folded), [individual, secondFold]);
  assert.equal(folded.doc.toString(), source);
});

test('prose, ordinary footnotes and code terminate or exclude bibliography groups', () => {
  for (const separator of ['正文', '## 标题', '[^ordinary]: 普通脚注', '    [^code]: @article{x,title={code}}']) {
    const state = stateFor(entry('one') + '\n\n' + separator + '\n\n' + entry('two'));
    assert.equal(nodes(state).filter(node => node.name === 'MdBibtexFootnote').length, 2);
    assert.equal(H.bibliographyGroups(V, state).length, 0);
  }
  for (const source of ['```bibtex\n' + entry() + '\n```', entry().split('\n').map(line => '    ' + line).join('\n'), '---\nnotes: |\n' + entry().split('\n').map(line => '  ' + line).join('\n') + '\n---']) {
    assert.equal(nodes(stateFor(source)).filter(node => node.name === 'MdBibtexFootnote').length, 0);
  }
});

test('nested and escaped BibTeX braces are respected; malformed entries cannot swallow prose', () => {
  const valid = '[^tex]: @book{tex,\n  title = {{Nested} and \\{literal\\}},\n  author = "Quoted } text",\n  year = {2021}\n}\n正文';
  const state = stateFor(valid);
  assert.equal(nodes(state).filter(node => node.name === 'MdBibtexFootnote').length, 1);
  assert.equal(state.doc.sliceString(foldAt(state, 1).to).trim(), '正文');
  for (const source of ['[^bad]: @article{x,\n  title={unclosed}\n正文\n}', '[^bad]: @article{x,title={X}} suffix\n正文']) {
    assert.equal(nodes(stateFor(source)).filter(node => node.name === 'MdBibtexFootnote').length, 0);
  }
});

test('editing a closing delimiter invalidates frontmatter parsing and folding', () => {
  const source = '---\na: b\n---\n\n正文';
  const state = stateFor(source); nodes(state);
  const closing = source.lastIndexOf('---');
  const changed = state.update({ changes: { from: closing, to: closing + 3, insert: 'oops' } }).state;
  assert.equal(nodes(changed).filter(node => node.name === 'MdFrontmatter').length, 0);
});

test('multiline flow values and quoted keys include their closing delimiter in the fold', () => {
  const state = stateFor('---\n"单位:列表": [\n  "甲",\n  "乙"\n]\nmap: {\n  x: 1\n}\n---\n正文');
  nodes(state);
  assert.deepEqual(foldAt(state, 2), { from: state.doc.line(2).to, to: state.doc.line(5).to });
  assert.deepEqual(foldAt(state, 6), { from: state.doc.line(6).to, to: state.doc.line(8).to });
});

test('incremental edits create, split and rejoin bibliography groups', () => {
  let state = stateFor(entry('one')); nodes(state);
  state = state.update({ changes: { from: state.doc.length, insert: '\n\n' + entry('two') } }).state;
  nodes(state); assert.equal(H.bibliographyGroups(V, state)[0]?.count, 2);
  const at = entry('one').length + 2;
  state = state.update({ changes: { from: at, insert: '正文\n\n' } }).state;
  nodes(state); assert.equal(H.bibliographyGroups(V, state).length, 0);
  state = state.update({ changes: { from: at, to: at + 4 } }).state;
  nodes(state); assert.equal(H.bibliographyGroups(V, state)[0]?.count, 2);
});

test('empty frontmatter is an independent foldable block', () => {
  const state = stateFor('---\n---\n正文');
  assert.equal(nodes(state).filter(node => node.name === 'MdFrontmatter').length, 1);
  assert.deepEqual(foldAt(state, 1), { from: 3, to: 7 });
});

test('structured parsing preserves math, prose links, ordinary notes and fenced YAML', () => {
  const source = '---\ntitle: Example\n---\n\n$$\n\\big[x\\big]\n$$\n\n正文[^note] [link](https://example.com)\n\n[^note]: **普通脚注**\n\n```yaml\nitems:\n  - one\n  - two\n```';
  const state = stateFor(source), tree = nodes(state);
  assert.equal(tree.filter(node => node.name === 'MdMath').length, 1);
  assert.equal(tree.filter(node => node.name === 'Link').length, 1);
  assert.equal(tree.filter(node => node.name === 'MdFootnoteDefinition').length, 1);
  assert.equal(tree.filter(node => node.name === 'StrongEmphasis').length, 1);
  const codeNodes = [];
  for (let node = V.syntaxTree(state).resolveInner(source.indexOf('one'), 1); node; node = node.parent) codeNodes.push(node.name);
  assert.ok(codeNodes.includes('BlockSequence'), 'fenced YAML retains its mounted language parser');
  assert.equal(H.bibliographyGroups(V, state).length, 0);
});
