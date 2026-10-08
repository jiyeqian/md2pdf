// 纯解析模块 web/editor-analysis.mjs 的行为检查（无需浏览器）。
//
// 覆盖：大纲上下文（frontmatter / 围栏）、交叉引用目标与诊断、脚注与 BibTeX、
// 不可信标记的纯文本处理、slugify / uniqueId、片段渲染与补全插入范围，以及大输入边界。
//
// 与渲染层（src/render.mjs）支持字符集不一致的地方只在 docs/md-editor-iteration.md 报告，
// 不在本文件里把断言改成“现状即正确”。
//
// Run: node --test ci/editor-analysis-checks.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeMarkdown,
  slugify,
  uniqueId,
  renderSnippet,
  provideCompletions,
  SNIPPETS,
  MAX_DIAGNOSTICS,
  ID_SHAPE,
} from '../web/editor-analysis.mjs';

const BT = String.fromCharCode(96);
const FENCE = BT + BT + BT;

const codes = (result) => result.diagnostics.map((d) => d.code);
const of = (result, code) => result.diagnostics.filter((d) => d.code === code);
const ctx = (text, pos) => ({ text, pos: pos == null ? text.length : pos });

// ---------------------------------------------------------------- 大纲与上下文

test('frontmatter（--- 与 +++）内的伪标题与伪引用被忽略', () => {
  const md = ['---', 'title: 演示', 'note: \\ref{fig:假}', '---', '# 真标题', '', '## 甲'].join('\n');
  const r = analyzeMarkdown(md);
  assert.deepEqual(r.headings.map((h) => [h.level, h.text, h.line]), [[1, '真标题', 5], [2, '甲', 7]]);
  assert.deepEqual(r.occurrences, []);
  assert.deepEqual(r.targets, []);

  const toml = ['+++', 'title = "x"', '+++', '# 标题'].join('\n');
  assert.equal(analyzeMarkdown(toml).headings.length, 1);
});

test('未闭合的 frontmatter 不吞正文', () => {
  const r = analyzeMarkdown(['---', '# 标题'].join('\n'));
  assert.equal(r.headings.length, 1);
  assert.equal(r.headings[0].line, 2);
});

test('反引号 / 波浪号围栏内的标题、标签与引用被忽略', () => {
  const md = [
    '## 真',
    '',
    FENCE + 'js',
    '# 假标题',
    '\\ref{fig:假}',
    '{#fig:假}',
    FENCE,
    '',
    '~~~',
    '## 假标题（波浪）',
    '~~~',
    '',
    '## 真二',
  ].join('\n');
  const r = analyzeMarkdown(md);
  assert.deepEqual(r.headings.map((h) => [h.text, h.line]), [['真', 1], ['真二', 13]]);
  assert.deepEqual(r.occurrences, []);
  assert.deepEqual(r.targets, []);
});

test('未闭合围栏吞掉其后全部内容', () => {
  const md = [FENCE, '## 甲', '## 乙'].join('\n');
  assert.deepEqual(analyzeMarkdown(md).headings, []);
});

test('围栏开合规则：更长的闭围栏可闭合；短闭围栏与带反引号的信息串不生效', () => {
  const longer = [FENCE, 'x', BT.repeat(4), '## 甲'].join('\n');
  assert.equal(analyzeMarkdown(longer).headings.length, 1);

  const shorter = [BT.repeat(4), 'x', FENCE, '## 甲'].join('\n');
  assert.equal(analyzeMarkdown(shorter).headings.length, 0);

  // 反引号信息串里含反引号：不是围栏，后面的标题应当被识别
  const infoWithTick = [FENCE + 'a' + BT + 'b', '## 甲'].join('\n');
  assert.equal(analyzeMarkdown(infoWithTick).headings.length, 1);
});

test('标题解析：闭合 #、{#id} 标签、7 个 # 与 #tag 都不是标题', () => {
  const md = ['## 甲 ##', '### 乙 {#sec:b}', '####### 丙', '#tag'].join('\n');
  const r = analyzeMarkdown(md);
  assert.deepEqual(r.headings.map((h) => [h.level, h.text, h.id]),
    [[2, '甲', null], [3, '乙', 'sec:b']]);
});

// ---------------------------------------------------------------- 目标 / 引用 / 诊断

test('图、表、公式、锚点目标的种类与顺序', () => {
  const md = [
    '图：甲 {#fig:one}',
    '',
    '表：乙 {#tab:one}',
    '',
    '$$x \\label{eq:one}$$',
    '',
    '## 章节 {#sec:one}',
  ].join('\n');
  const r = analyzeMarkdown(md);
  assert.deepEqual(r.figures.map((f) => [f.id, f.title]), [['fig:one', '甲']]);
  assert.deepEqual(r.tables.map((t) => t.id), ['tab:one']);
  assert.deepEqual(r.equations.map((e) => [e.id, e.number]), [['eq:one', 1]]);
  assert.deepEqual(r.targets.map((t) => [t.id, t.kind]),
    [['fig:one', 'figure'], ['tab:one', 'table'], ['eq:one', 'equation'], ['sec:one', 'anchor']]);
});

test('公式编号按出现顺序递增，同一行多个 \\label 也分别计数', () => {
  const md = ['$$a \\label{eq:a}$$', '', '$$b \\label{eq:b} \\label{eq:c}$$'].join('\n');
  const r = analyzeMarkdown(md);
  assert.deepEqual(r.equations.map((e) => [e.id, e.number, e.line]),
    [['eq:a', 1, 1], ['eq:b', 2, 3], ['eq:c', 3, 3]]);
});

test('引用出现位置：kind 与 offset 精确', () => {
  const md = ['见 \\ref{fig:one} 与 $\\eqref{eq:one}$'].join('\n');
  const r = analyzeMarkdown(md);
  assert.deepEqual(r.occurrences.map((o) => [o.id, o.kind, o.offset]),
    [['fig:one', 'ref', md.indexOf('\\ref')], ['eq:one', 'eqref', md.indexOf('\\eqref')]]);
});

test('重复引用同一脚注不算重复定义，也不污染补全候选项', () => {
  const md = ['见[^astrom]与[^astrom]、[^astrom]。', '', '[^astrom]: 自适应控制'].join('\n');
  const r = analyzeMarkdown(md);
  assert.equal(r.footnotes.length, 1);
  assert.equal(r.targets.length, 1);
  assert.equal(of(r, 'duplicate-id').length, 0);
  assert.deepEqual(r.occurrences.map((o) => o.kind), ['footnote-ref', 'footnote-ref', 'footnote-ref']);

  const res = provideCompletions(ctx('见[^astr'), r);
  assert.equal(res.options.length, 1);
  assert.equal(res.options[0].label, 'astrom');
});

test('重复 ID（图标签 / 脚注定义）给出 duplicate-id 并指向首次定义行', () => {
  const md = ['图：a {#fig:one}', '', '图：b {#fig:one}', '', '[^n1]: x', '', '[^n1]: y'].join('\n');
  const r = analyzeMarkdown(md);
  const dups = of(r, 'duplicate-id');
  assert.equal(dups.length, 2);
  assert.deepEqual(dups.map((d) => [d.id, d.line]), [['fig:one', 3], ['n1', 7]]);
  assert.match(dups[0].message, /首次在第 1 行/);
});

test('缺失目标：\\ref 与 \\eqref 分别提示，且消息带原命令', () => {
  const md = ['\\ref{fig:nope}', '\\eqref{eq:nope}'].join('\n');
  const r = analyzeMarkdown(md);
  const missing = of(r, 'missing-target');
  assert.equal(missing.length, 2);
  assert.match(missing[0].message, /^\\ref\{fig:nope\}/);
  assert.match(missing[1].message, /^\\eqref\{eq:nope\}/);
  assert.deepEqual(missing.map((d) => d.line), [1, 2]);
});

test('已定义的引用不报缺失（图/表/公式/脚注）', () => {
  const md = [
    '图：a {#fig:one}',
    '表：b {#tab:one}',
    '$$x \\label{eq:one}$$',
    '[^n1]: 注',
    '',
    '见 \\ref{fig:one}、\\ref{tab:one}、\\eqref{eq:one}、[^n1]。',
  ].join('\n');
  const r = analyzeMarkdown(md);
  assert.equal(of(r, 'missing-target').length, 0);
  assert.equal(of(r, 'duplicate-id').length, 0);
});

test('空 ID 不产生目标与诊断', () => {
  const md = ['\\ref{}', '\\label{}', '{#}', '[^]: x'].join('\n');
  const r = analyzeMarkdown(md);
  assert.equal(r.targets.length, 0);
  assert.equal(r.occurrences.length, 0);
  assert.equal(r.diagnostics.length, 0);
});

test('Unicode ID 被登记为目标并给出 info 提示（与渲染层字符集不一致，见评审文档）', () => {
  const md = ['图：甲 {#fig:图}', '', '\\ref{fig:图}'].join('\n');
  const r = analyzeMarkdown(md);
  assert.deepEqual(r.targets.map((t) => t.id), ['fig:图']);
  assert.equal(of(r, 'missing-target').length, 0, '解析层认为该目标存在');
  assert.equal(ID_SHAPE.test('fig:图'), false);
  const uni = of(r, 'unicode-id');
  assert.equal(uni.length, 1);
  assert.equal(uni[0].severity, 'info');
});

test('脚注定义与 BibTeX 条目被收集，正文引用不重复入库', () => {
  const md = [
    '见[^r1]与[^r1]。',
    '',
    '[^r1]: @article{r1, author = {张三}, title = {标题}, journal = {期刊}, year = {2026},}',
  ].join('\n');
  const r = analyzeMarkdown(md);
  assert.equal(r.footnotes.length, 1);
  assert.equal(r.footnotes[0].id, 'r1');
  assert.match(r.footnotes[0].body, /^@article\{/);
  assert.deepEqual(codes(r), []);
});

test('手写章节号提示：不一致给出应有序号，缺失给出缺失提示', () => {
  const md = ['# 标题', '## 2.1 甲', '## 乙'].join('\n');
  const r = analyzeMarkdown(md);
  const nums = of(r, 'heading-number');
  assert.equal(nums.length, 1);
  assert.equal(nums[0].line, 2);
  assert.match(nums[0].message, /按顺序应为 1）/);
  const miss = of(r, 'heading-number-missing');
  assert.equal(miss.length, 1);
  assert.equal(miss[0].line, 3);
});

// ---------------------------------------------------------------- 不可信标记

test('恶意标记只作为纯文本保留，不产生 HTML', () => {
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const md = ['# ' + evil, '', '![<b>' + evil + '</b> {#fig:evil}](a.png)', '', FENCE, evil, FENCE].join('\n');
  const r = analyzeMarkdown(md);
  assert.equal(r.headings[0].text, evil, '标题文本原样保留（未转义、未注入）');
  assert.ok(r.figures[0].title.includes(evil), '图题注保留原始文本');
  assert.ok(!('html' in r), '结果里没有 HTML 字段');
  const strings = Object.values(r).filter((v) => typeof v === 'string');
  assert.ok(!strings.some((s) => s.includes('&lt;')), '没有 HTML 转义痕迹');
  assert.equal(r.headings.length, 1, '围栏内的恶意行不进入大纲');
});

// ---------------------------------------------------------------- slugify / uniqueId

test('slugify：转小写、压缩分隔符、裁剪长度，缺失回落到 fallback', () => {
  assert.equal(slugify('Hello World!'), 'hello-world');
  assert.equal(slugify('  --A__b-- '), 'a-b');
  assert.equal(slugify('总体指标', 'item'), 'item');
  assert.equal(slugify('', 'item'), 'item');
  assert.equal(slugify(null, 'item'), 'item');
  assert.equal(slugify('a'.repeat(40)).length, 32);
  assert.match(slugify('图 1.2'), /^[a-z0-9-]*$/);
});

test('uniqueId：Set / 数组都可用，冲突时递增且返回值一定不冲突', () => {
  assert.equal(uniqueId('a', []), 'a');
  assert.equal(uniqueId('a', new Set(['a'])), 'a-2');
  assert.equal(uniqueId('a', ['a', 'a-2']), 'a-3');
  assert.equal(uniqueId('', ['x']), 'x-2');
  const taken = new Set(['fig-x', 'fig-x-2']);
  const id = uniqueId('fig-x', taken);
  assert.equal(id, 'fig-x-3');
  assert.ok(!taken.has(id));
});

// ---------------------------------------------------------------- 片段

test('renderSnippet：未知片段抛错', () => {
  assert.throws(() => renderSnippet('nope'), /未知片段/);
});

test('renderSnippet：占位符全部被填充，不残留 {{…}}', () => {
  for (const name of Object.keys(SNIPPETS)) {
    if (SNIPPETS[name].text == null) continue;
    const keys = [...new Set([...SNIPPETS[name].text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
    const values = {};
    for (const k of keys) values[k] = '值-' + k;
    const { text } = renderSnippet(name, values);
    assert.ok(!/\{\{/.test(text), name + ' 残留占位符：' + text.slice(0, 160));
  }
});

test('renderSnippet：BibTeX 片段产出可被解析的单层花括号条目', () => {
  const { text, id } = renderSnippet('bibliography');
  assert.match(text, new RegExp('@article\{' + id + ',\s*\n'));
  assert.ok(text.includes('author = '), '字段被填充');
});

test('renderSnippet：wrap 类片段不产出整段文本', () => {
  for (const name of ['bold', 'italic', 'code']) {
    assert.equal(typeof SNIPPETS[name].wrap, 'string');
    assert.deepEqual(renderSnippet(name), { text: '', id: null });
  }
});

test('renderSnippet：ID 为 ASCII 安全串，重复插入互不冲突', () => {
  for (const name of Object.keys(SNIPPETS)) {
    const { id } = renderSnippet(name, { title: 'Robot Arm 2' }, { taken: [] });
    if (id == null) continue;
    assert.match(id, /^(?:(?:fig|tab|eq):)?[A-Za-z0-9][A-Za-z0-9_-]*$/, name + ' 的 ID 形态：' + id);
  }
  const taken = new Set();
  const ids = [];
  for (let i = 0; i < 50; i += 1) {
    const { id } = renderSnippet('figure', { title: 'Robot Arm' }, { taken });
    ids.push(id);
    taken.add(id);
  }
  assert.equal(new Set(ids).size, 50);
  assert.deepEqual(ids.slice(0, 3), ['fig:robot-arm', 'fig:robot-arm-2', 'fig:robot-arm-3']);
});

test('公式片段自洽：\\label 与 \\eqref 同 ID，回灌解析器无缺失诊断', () => {
  const { text, id } = renderSnippet('formula');
  assert.ok(text.includes('\\label{' + id + '}'));
  assert.ok(text.includes('\\eqref{' + id + '}'));
  const r = analyzeMarkdown(text);
  assert.deepEqual(r.equations.map((e) => e.id), [id]);
  assert.deepEqual(codes(r), []);
});

test('脚注 / 表格片段自洽：ID 一致且回灌解析器无缺失诊断', () => {
  const fn = renderSnippet('footnote');
  const r1 = analyzeMarkdown(fn.text);
  assert.equal(r1.footnotes.length, 1);
  assert.equal(r1.footnotes[0].id, fn.id);
  assert.deepEqual(codes(r1), []);

  const tb = renderSnippet('table', { title: '指标' });
  const r2 = analyzeMarkdown(tb.text);
  assert.deepEqual(r2.tables.map((t) => t.id), [tb.id]);
  assert.deepEqual(codes(r2), []);
});

// ---------------------------------------------------------------- 补全

const FIXTURE = [
  '## 甲',
  '',
  '图：图一 {#fig:one}',
  '',
  '表：表一 {#tab:one}',
  '',
  '$$x \\label{eq:one}$$',
  '',
  '[^n1]: 注一',
  '',
  '见[^n1]与[^n1]。',
].join('\n');
const FA = analyzeMarkdown(FIXTURE);

test('provideCompletions：[^ 前缀给出脚注候选与正确插入范围', () => {
  const text = '参见[^n';
  const res = provideCompletions(ctx(text), FA);
  assert.equal(res.from, text.lastIndexOf('n'));
  assert.deepEqual(res.options.map((o) => [o.label, o.type, o.apply]), [['n1', 'footnote', 'n1]']]);

  const none = provideCompletions(ctx('参见[^zz'), FA);
  assert.equal(none.from, '参见[^zz'.indexOf('zz'));
  assert.deepEqual(none.options, [], '已触发但无匹配候选');
});

test('provideCompletions：\\ref{ 前缀按已输入 ID 过滤并给出正确插入范围', () => {
  const text = '如图 \\ref{fig:';
  const res = provideCompletions(ctx(text), FA);
  assert.equal(res.from, text.indexOf('fig:'), '替换范围应覆盖已输入的 fig:');
  assert.deepEqual(res.options.map((o) => o.label), ['fig:one']);
});

test('provideCompletions：\\eqref{ 前缀按已输入 ID 过滤并给出正确插入范围', () => {
  const text = '式 \\eqref{eq:';
  const res = provideCompletions(ctx(text), FA);
  assert.equal(res.from, text.indexOf('eq:'), '替换范围应覆盖已输入的 eq:');
  assert.deepEqual(res.options.map((o) => o.label), ['eq:one']);
});

test('provideCompletions：\\ref 候选排除脚注，\\eqref 候选以公式为主', () => {
  const res = provideCompletions(ctx('\\ref{'), FA);
  const labels = res.options.map((o) => o.label);
  assert.ok(labels.includes('fig:one') && labels.includes('tab:one'));
  assert.ok(!labels.includes('eq:one'), '公式使用 eqref，普通 ref 仅匹配图表');
  assert.ok(!labels.includes('n1'), '脚注 ID 不作为 \\ref 候选');
});

test('provideCompletions：未触发 / 上下文无效时返回 null', () => {
  assert.equal(provideCompletions(ctx('普通文字'), FA), null);
  assert.equal(provideCompletions(ctx('已闭合 \\ref{fig:one}'), FA), null);
  assert.equal(provideCompletions(null, FA), null);
  assert.equal(provideCompletions({ text: 'x' }, FA), null);
  assert.equal(provideCompletions(ctx('\\ref{fig:'), null), null);
});

test('补全替换已有标识尾部和定界符，光标可落在完整引用之后', () => {
  for (const [text, pos, expected] of [
    ['图 \\ref{fig:ow}。', '图 \\ref{fig:o'.length, '图 \\ref{fig:one}。'],
    ['注[^n]。', '注[^n'.length, '注[^n1]。'],
  ]) {
    const result = provideCompletions({ text, pos }, FA);
    assert.ok(result.options.length);
    const output = text.slice(0, result.from) + result.options[0].apply + text.slice(result.to);
    assert.equal(output, expected);
  }
});

test('frontmatter 与行内代码中的引用示例不参与补全或缺失检查', () => {
  assert.equal(provideCompletions(ctx('---\nname: \\ref{fig:'), FA), null);
  assert.equal(provideCompletions(ctx('示例 `\\ref{fig:'), FA), null);
  assert.equal(analyzeMarkdown('示例 `\\ref{fig:missing}`').occurrences.length, 0);
});

test('provideCompletions：代码围栏内不触发', () => {
  const text = ['## 甲', '', FENCE + 'js', 'const x = \\ref{fig:', FENCE].join('\n');
  const pos = text.indexOf('\\ref{fig:') + '\\ref{fig:'.length;
  assert.equal(provideCompletions({ text, pos }, FA), null, '围栏内的 \\ref{ 不应触发补全');
});

// ---------------------------------------------------------------- 规模与边界

test('空输入与非字符串输入返回空结果', () => {
  for (const src of ['', null, undefined, 42]) {
    const r = analyzeMarkdown(src);
    assert.deepEqual(r.counts, { headings: 0, targets: 0, occurrences: 0, diagnostics: 0, truncated: false });
    assert.deepEqual(r.diagnostics, []);
  }
});

test('约 200KB 输入：耗时可控、诊断条数封顶并标记截断', () => {
  let big = '';
  for (let i = 0; i < 4000; i += 1) {
    big += '## 章节 ' + i + '\n\n段落 \\ref{fig:missing' + i + '} 与 [^n' + i + ']: 定义\n\n';
  }
  assert.ok(big.length > 190000, '样本大小 ' + big.length);
  const t0 = Date.now();
  const r = analyzeMarkdown(big);
  const dt = Date.now() - t0;
  assert.ok(dt < 2000, '耗时 ' + dt + 'ms（上限 2000ms）');
  assert.equal(r.diagnostics.length, MAX_DIAGNOSTICS);
  assert.equal(r.counts.truncated, true);
  assert.equal(r.counts.headings, 4000);
  assert.equal(r.counts.diagnostics, r.diagnostics.length);
});

test('超长单行：无灾难性回溯，耗时可控', () => {
  const line = '\u53c2\u89c1 \\ref{fig:a}'.repeat(8000);
  assert.ok(line.length > 100000);
  const t0 = Date.now();
  const r = analyzeMarkdown(line);
  const dt = Date.now() - t0;
  assert.ok(dt < 2000, '耗时 ' + dt + 'ms（上限 2000ms）');
  assert.equal(r.occurrences.length, 8000);
  assert.equal(r.diagnostics.length, MAX_DIAGNOSTICS);
});
