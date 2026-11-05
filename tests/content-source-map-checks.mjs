import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentSourceMap } from '../src/content-source-map.mjs';

function checked(source, options) {
  const entries = buildContentSourceMap(source, options);
  assert.deepEqual(entries.map(entry => entry.id), entries.map((_, index) => index));
  for (const entry of entries) {
    assert.ok(entry.from >= 0 && entry.to <= source.length && entry.from < entry.to, JSON.stringify(entry));
    assert.equal(entry.positions.length, entry.text.length, entry.text);
    assert.ok(entry.positions.every(offset => Number.isSafeInteger(offset) && offset >= entry.from && offset < entry.to), entry.text);
    assert.ok(entry.positions.every((offset, index) => !index || offset >= entry.positions[index - 1]), entry.text);
  }
  return entries;
}

test('duplicate blocks and Unicode/CRLF retain distinct original UTF-16 positions', () => {
  const source = '---\r\ntitle: hidden\r\n---\r\n# 标题 🚀\r\n\r\n同一段文字\r\n\r\n同一段文字\r\n';
  const entries = checked(source);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].line, 4);
  assert.equal(entries[0].positions[0], source.indexOf('标题'));
  assert.equal(entries[0].positions.at(-1), source.indexOf('🚀') + 1);
  const duplicates = entries.filter(entry => entry.text === '同一段文字');
  assert.deepEqual(duplicates.map(entry => entry.from), [source.indexOf('同一段文字'), source.lastIndexOf('同一段文字')]);
  assert.deepEqual(duplicates.map(entry => entry.line), [6, 8]);
});

test('inline syntax, entities and heading attributes map visible characters to source', () => {
  const source = '## # **粗体** 与 [链接](https://example.com) {#sec:x role=abstract}\n\n斜体*字*、~~删~~、` a  b `、\\*、&amp;、&#x1f680;。';
  const entries = checked(source), [heading, paragraph] = entries;
  assert.equal(heading.text, '# 粗体 与 链接');
  assert.equal(heading.role, 'abstract');
  assert.equal(heading.positions[0], source.indexOf('# **'));
  assert.equal(heading.positions[heading.text.indexOf('粗')], source.indexOf('粗'));
  assert.equal(heading.positions[heading.text.indexOf('链')], source.indexOf('链接'));
  assert.equal(paragraph.text, '斜体字、删、a b、*、&、🚀。');
  assert.equal(paragraph.positions[paragraph.text.indexOf('*')], source.indexOf('\\*') + 1);
  assert.equal(paragraph.positions[paragraph.text.indexOf('&')], source.indexOf('&amp;'));
  const rocket = paragraph.text.indexOf('🚀');
  assert.deepEqual(paragraph.positions.slice(rocket, rocket + 2), [source.indexOf('&#x1f680;'), source.indexOf('&#x1f680;')]);
});

test('nested lists, task items and multiline quotes preserve token-local offsets', () => {
  const source = '- [ ] **第一项**\n  - 子项\n    延续内容\n- 第二项\n\n> 引用第一行\n> 引用第二行\n';
  const entries = checked(source);
  assert.deepEqual(entries.map(entry => [entry.tag, entry.text]), [['li', '第一项'], ['li', '子项 延续内容'], ['li', '第二项'], ['p', '引用第一行 引用第二行']]);
  assert.equal(entries[0].from, 0);
  assert.equal(entries[0].positions[0], source.indexOf('第一项'));
  assert.equal(entries[1].from, source.indexOf('- 子项'));
  assert.equal(entries[1].positions[entries[1].text.indexOf('延')], source.indexOf('延续内容'));
  assert.equal(entries[3].positions[entries[3].text.indexOf('引用第二行')], source.indexOf('引用第二行'));
});

test('loose lists map their paragraphs separately', () => {
  const source = '- 第一段\n\n  同项第二段\n\n- 第二项\n';
  const entries = checked(source);
  assert.deepEqual(entries.map(entry => [entry.tag, entry.text]), [['p', '第一段'], ['p', '同项第二段'], ['p', '第二项']]);
  assert.equal(entries[1].positions[0], source.indexOf('同项第二段'));
});

test('list and quote marker lookalikes resolve to visible content, not syntax', () => {
  const source = '1. 1\n2. 2\n\n- **-**\n\n> > nested\n';
  const entries = checked(source);
  assert.equal(entries[0].text, '1');
  assert.equal(entries[0].positions[0], source.indexOf('1. 1') + 3);
  assert.equal(entries[1].positions[0], source.indexOf('2. 2') + 3);
  const dash = entries.find(entry => entry.text === '-');
  assert.equal(dash.positions[0], source.indexOf('**-**') + 2);
  const nested = entries.find(entry => entry.text === 'nested');
  assert.equal(nested.positions[0], source.indexOf('nested'));
});

test('table cells map escaped pipes, inline formatting and duplicate values', () => {
  const source = '| a\\|b | **值** |\n|---|---|\n| 重复 | 重复 |\n| x | `y` |';
  const entries = checked(source);
  assert.deepEqual(entries.map(entry => [entry.tag, entry.text]), [['th', 'a|b'], ['th', '值'], ['td', '重复'], ['td', '重复'], ['td', 'x'], ['td', 'y']]);
  assert.equal(entries[0].positions[1], source.indexOf('\\|') + 1);
  assert.notEqual(entries[2].positions[0], entries[3].positions[0]);
});

test('numbered table and diagram captions cannot bind a later identical paragraph', () => {
  const source = '表：**标题** {#tab:x}\n\n| A |\n|---|\n| B |\n\n表：**标题** {#tab:x}\n\n图：流程 {#fig:x}\n\n```mermaid\ngraph TD; A-->B\n```\n';
  const entries = checked(source);
  const captions = entries.filter(entry => ['caption', 'figcaption'].includes(entry.tag));
  assert.deepEqual(captions.map(entry => [entry.tag, entry.text]), [['caption', '标题'], ['figcaption', '流程']]);
  assert.equal(captions[0].positions[0], source.indexOf('标题'));
  assert.equal(captions[1].positions[0], source.indexOf('流程'));
  assert.ok(entries.some(entry => entry.tag === 'p' && entry.text === '表：标题 {#tab:x}'));
});

test('fenced and indented code positions exclude language and fence delimiters', () => {
  const source = '```js\njs\nconst x = "<a>";\n```\n\n    let a = 1;\n    a++;\n\n```mermaid\ngraph TD; A-->B\n```';
  const entries = checked(source);
  assert.deepEqual(entries.map(entry => entry.kind), ['code', 'code', 'diagram']);
  assert.equal(entries[0].text, 'js const x = "<a>";');
  assert.equal(entries[0].positions[0], source.indexOf('\njs') + 1);
  assert.equal(entries[1].positions[0], source.indexOf('let a'));
  assert.deepEqual(entries[2].positions, []);
});

test('math, images and citations are atomic without polluting surrounding prose', () => {
  const source = '甲 $a=b$ 乙 \\ref{fig:x} 丙[^x] 丁 \\eqref{eq:x} 戊。\n\n$$\na=b\n$$\n\n![图名](data:image/png;base64,AAAA)\n\n[^x]: @book{x, title={测试}}';
  const entries = checked(source);
  assert.equal(entries[0].text, '甲 乙 丙 丁 戊。');
  assert.equal(entries.filter(entry => entry.kind === 'math').length, 2);
  const image = entries.find(entry => entry.kind === 'image');
  assert.equal(source.slice(image.from, image.to), '![图名](data:image/png;base64,AAAA)');
  assert.deepEqual(image.positions, []);
  assert.equal(entries.find(entry => entry.kind === 'reference').number, 1);
});

test('references follow first citation order and keep multiline definition ranges', () => {
  const source = '先[^b] 后[^a] 再[^b]。\n\n[^a]: 第一条\n  后续行\n[^b]: @book{b,\n  title={第二条}\n  }\n[^c]: 未引用';
  const references = checked(source).filter(entry => entry.kind === 'reference');
  assert.deepEqual(references.map(entry => [entry.key, entry.number]), [['a', 2], ['b', 1], ['c', 3]]);
  assert.ok(source.slice(references[0].from, references[0].to).includes('后续行'));
  assert.ok(source.slice(references[1].from, references[1].to).includes('title={第二条}'));
});

test('authoritative rendered reference keys prevent numbering drift and ghost bindings', () => {
  const source = '实际[^actual]。\n\n[^ghost]: 不会生成文献\n[^actual]: 实际文献';
  const entries = checked(source, { type: 'general', referenceKeys: ['fenced-definition', 'actual'] });
  assert.deepEqual(entries.filter(entry => entry.kind === 'reference').map(entry => [entry.key, entry.number]), [['actual', 2]]);
  assert.equal(checked(source, { referenceKeys: [] }).filter(entry => entry.kind === 'reference').length, 0);
});

test('GB page notes are separate from bibliography and preserve surrounding prose', () => {
  const source = '---\ntype: gb\n---\n甲[^@n]乙。\n\n  [^@n]: 注内容[^bib]\n    延续内容\n\n正文[^real]。\n\n[^bib]: 来源\n[^real]: 真正引用';
  const entries = checked(source, { referenceKeys: ['real', 'bib'] });
  assert.ok(entries.some(entry => entry.text === '甲乙。'));
  assert.ok(!entries.some(entry => entry.text.includes('注内容') || entry.text.includes('延续内容')));
  assert.deepEqual(entries.filter(entry => entry.kind === 'reference').map(entry => [entry.key, entry.number]), [['bib', 2], ['real', 1]]);
});

test('nonGB @ identifiers follow ordinary bibliography numbering', () => {
  const source = '甲[^@n]乙。\n\n[^@n]: 普通来源';
  const entries = checked(source, { type: 'general', referenceKeys: ['@n'] });
  assert.equal(entries[0].text, '甲乙。');
  assert.deepEqual(entries.filter(entry => entry.kind === 'reference').map(entry => [entry.key, entry.number]), [['@n', 1]]);
});

test('shared superscript and subscript syntax maps script characters and escapes', () => {
  const source = 'H_{2}O 与 m^{2}，a^{x\\{y\\}}；\\^{普通}。';
  const entries = checked(source), entry = entries[0];
  assert.equal(entry.text, 'H2O 与 m2，ax{y}；^{普通}。');
  assert.equal(entry.positions[entry.text.indexOf('2')], source.indexOf('2'));
  assert.equal(entry.positions[entry.text.indexOf('x')], source.indexOf('x'));
  assert.equal(entry.positions[entry.text.indexOf('{')], source.indexOf('\\{') + 1);
});

test('document chrome is omitted; GB simple paragraphs and complex objects retain ranges', () => {
  const source = ':::kicker\n隐藏类别\n:::\n\n:::colophon\n"左" | "中" | "右"\n:::\n\n:::gb-note label="注："\n普通注内容\n:::\n\n:::gb-table\nhead:\n| 指标 | 数值 |\nbody:\n| A | 1 |\n:::\n\n:::gb-term id=a\n术语名称\nterm\n\n定义内容[^ref]\n:::\n\n[^ref]: 来源';
  const entries = checked(source);
  assert.ok(!entries.some(entry => entry.text.includes('隐藏类别') || entry.text.includes('"左"')));
  assert.ok(entries.some(entry => entry.text === '普通注内容'));
  assert.deepEqual(entries.filter(entry => entry.kind === 'object').map(entry => entry.key), ['gb-table', 'gb-term']);
  assert.equal(entries.find(entry => entry.kind === 'reference').number, 1);
});

test('code examples keep literal frontmatter, directives, math and footnote definitions', () => {
  const source = '~~~text\n---\ntitle: x\n---\n:::gb-table\n[^ref]: definition\n$x$\n~~~';
  const entries = checked(source);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'code');
  assert.ok(entries[0].text.includes('[^ref]: definition $x$'));
});

test('unsupported named entities stay conservative and image data never expands a character map', () => {
  const source = '未知实体 &NotEqualTilde;\n\n![图](data:image/png;base64,' + 'A'.repeat(10000) + ')';
  const entries = checked(source);
  assert.equal(entries[0].text, '未知实体 &NotEqualTilde;');
  const image = entries.find(entry => entry.kind === 'image');
  assert.equal(image.text, '');
  assert.equal(image.positions.length, 0);
});
