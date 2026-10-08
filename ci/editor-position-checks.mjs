// 位置关联与工作台外壳的结构性检查（无需浏览器）：
//   * src/editor-position.mjs 的 Markdown/渲染标题匹配（真实 render 输出 + 构造用例）；
//   * web/editor-workspace.js 的语法与关键契约（new Function 仅编译不执行）；
//   * web/editor-workspace.css 的结构性断言（选择器/断点/状态）。
// 真实浏览器中的拖拽、专注与消息桥接由根应用的浏览器验收覆盖，不在此处声称通过。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { attachSourcePositions, parseMarkdownHeadings } from '../src/editor-position.mjs';
import { render } from '../src/render.mjs';

const BT = String.fromCharCode(96);        // 反引号，避免在测试源码中写出围栏字面量
const FENCE = BT + BT + BT;
const ATTR_RE = / data-md2pdf-source-line="(\d+)"/g;

// 解析渲染 HTML 中 h2–h6 的层级、内部文本与已标注行号。
function renderedHeadings(html) {
  const out = [];
  const re = /<h([2-6])([^>]*)>([\s\S]*?)<\/h\1>/g;
  let m;
  while ((m = re.exec(html))) {
    const attr = /data-md2pdf-source-line="(\d+)"/.exec(m[2]);
    out.push({ level: Number(m[1]), attrs: m[2], text: m[3].replace(/<[^>]*>/g, ''), line: attr ? Number(attr[1]) : null });
  }
  return out;
}
function linesOf(md, html) {
  return { mdHeads: parseMarkdownHeadings(md), rendered: renderedHeadings(attachSourcePositions(html, md)) };
}

test('parseMarkdownHeadings：ATX 层级与 1 基行号', () => {
  const md = ['---', 'title: x', '---', '# 标题', '## 甲', '正文', '### 乙', '#### 丙'].join('\n');
  assert.deepEqual(parseMarkdownHeadings(md).map(h => [h.level, h.text, h.line]), [
    [1, '标题', 4], [2, '甲', 5], [3, '乙', 7], [4, '丙', 8],
  ]);
});

test('parseMarkdownHeadings：跳过 frontmatter 与代码围栏（反引号 / 波浪号）', () => {
  const md = [
    '---', 'title: x', '---',
    '# 真标题', '',
    FENCE, '## 假标题（围栏内）', FENCE, '',
    '~~~', '### 假标题（波浪号围栏内）', '~~~', '',
    '## 真二级',
  ].join('\n');
  assert.deepEqual(parseMarkdownHeadings(md).map(h => [h.level, h.text, h.line]), [
    [1, '真标题', 4], [2, '真二级', 14],
  ]);
});

test('parseMarkdownHeadings：setext 标题', () => {
  const md = ['标题一', '=====', '', '标题二', '---', '', '~~~', '## x', '~~~'].join('\n');
  assert.deepEqual(parseMarkdownHeadings(md).map(h => [h.level, h.text, h.line]), [
    [1, '标题一', 1], [2, '标题二', 4],
  ]);
});

test('剥离渲染编号前缀：阿拉伯 / 附录字母 / 第X章 / 中文 / 括号', () => {
  const cases = [
    ['## 总体设计', '<h2 id="sec-1">1 总体设计</h2>'],
    ['### 模块划分', '<h3>1.2 模块划分</h3>'],
    ['#### 接口', '<h4>A.1.3 接口</h4>'],
    ['## 概述', '<h2>第 1 章 概述</h2>'],
    ['### 术语', '<h3>（一）术语</h3>'],
    ['#### 符号', '<h4>（2）符号</h4>'],
  ];
  for (const [md, html] of cases) {
    const found = renderedHeadings(attachSourcePositions(html, md)).find(h => h.line != null);
    assert.ok(found, '未匹配：' + md);
    assert.equal(found.line, 1, md);
  }
});

test('Markdown 自带编号走原文匹配（不误剥离）', () => {
  const md = ['## 1. 概述', '## 3 个要点'].join('\n');
  const html = '<h2>1. 概述</h2><h2>1 3 个要点</h2>';
  assert.deepEqual(linesOf(md, html).rendered.map(h => h.line), [1, 2]);
});

test('Unicode / 实体 / 行内标记：顺序匹配', () => {
  const md = ['## 中文标题 · emoji 🚀 · café', '## **加粗** 与 ' + BT + 'code' + BT + ' 与 [链接](https://x)'].join('\n');
  const html = ['<h2>1 中文标题 · emoji 🚀 · café</h2>', '<h2>2 <strong>加粗</strong> 与 <code>code</code> 与 <a href="u">链接</a></h2>'].join('\n');
  assert.deepEqual(linesOf(md, html).rendered.map(h => h.line), [1, 2]);
});

test('实体与全角字符：&amp; 与全角Ａ', () => {
  assert.equal(linesOf('## A & B 全角Ａ', '<h2>1 A &amp; B 全角Ａ</h2>').rendered[0].line, 1);
});

test('层级不一致不标注；文本不匹配不臆造行号', () => {
  const md = ['## 甲', '## 乙'].join('\n');
  const html = ['<h3>1 甲</h3>', '<h2>2 完全不同的标题</h2>', '<h2>3 乙</h2>'].join('\n');
  assert.deepEqual(linesOf(md, html).rendered.map(h => h.line), [null, null, 2]);
});

test('围栏与转义内容不当作标题，不注入属性', () => {
  const md = ['## 真标题', '', FENCE, '## 假标题', FENCE].join('\n');
  const escaped = '<pre><code>&lt;h2&gt;1 真标题&lt;/h2&gt;</code></pre>';
  const out = attachSourcePositions('<h2>1 真标题</h2>\n' + escaped, md);
  assert.equal(renderedHeadings(out)[0].line, 1);
  assert.ok(out.includes(escaped), '转义源码不得被改写');
  assert.equal((out.match(/data-md2pdf-source-line/g) || []).length, 1);
});

test('保留原有属性与内部内容，除新增属性外逐字节一致', () => {
  const html = '<h2 id="sec-1" class="unnumbered">1 甲</h2>';
  const out = attachSourcePositions(html, '## 甲');
  assert.equal(out, '<h2 id="sec-1" class="unnumbered" data-md2pdf-source-line="1">1 甲</h2>');
  assert.equal(out.replace(ATTR_RE, ''), html);
});

test('幂等：重复调用不再新增属性', () => {
  const md = ['## 甲', '### 乙'].join('\n');
  const html = '<h2>1 甲</h2><h3>1.1 乙</h3>';
  const once = attachSourcePositions(html, md);
  assert.equal(attachSourcePositions(once, md), once);
});

test('无匹配标题或非字符串输入', () => {
  assert.equal(attachSourcePositions('<h2>1 甲</h2>', '# 标题'), '<h2>1 甲</h2>');
  assert.equal(attachSourcePositions('<p>x</p>', '## 甲'), '<p>x</p>');
  assert.throws(() => attachSourcePositions(null, '## 甲'), TypeError);
  assert.throws(() => attachSourcePositions('<h2>1 甲</h2>', null), TypeError);
});

test('真实 render 输出：编号标题映射到源行号', async () => {
  const md = ['# 文档', '', '## 总体指标', '', '正文', '', '### 子项', '', '## 小结'].join('\n');
  const rendered = await render(md, { pagedHtml: true }, { webSafe: true });
  const html = rendered.pagedHtml || rendered.html;
  const found = renderedHeadings(attachSourcePositions(html, md)).filter(h => h.line != null);
  // 生成编号（1 总体指标 / 1.1 子项 / 2 小结）剥离后匹配；合成标题（如参考文献）不标注。
  assert.deepEqual(found.map(h => h.line).sort((a, b) => a - b), [3, 7, 9]);
  for (const h of found) {
    const mdText = parseMarkdownHeadings(md).find(x => x.line === h.line);
    assert.ok(mdText && h.text.includes(mdText.text), '标注行号应与标题文本对应：' + h.text);
  }
});

// ------------------------------------------------------------- 工作台外壳
const wsJs = await readFile(new URL('../web/editor-workspace.js', import.meta.url), 'utf8');
const wsCss = await readFile(new URL('../web/editor-workspace.css', import.meta.url), 'utf8');

test('editor-workspace.js 语法有效（仅编译，不执行）', () => {
  assert.doesNotThrow(() => new Function(wsJs));
});

test('editor-workspace.js 关键契约齐备', () => {
  for (const token of [
    'md-editor-ready', 'md-editor-cursor', 'md-preview-source', 'md-document-type',
    'window.mdEditor', 'window.mdEditorTools', "type: 'md2pdf-locate'",
    "RATIO_KEY = 'md2pdf:editor-ratio'", 'aria-orientation', 'editor-focus',
    'setPointerCapture', 'ArrowLeft', 'Home', 'End',
  ]) assert.ok(wsJs.includes(token), '缺少：' + token);
});

test('editor-workspace.js：普通按钮均为 type=button，且不使用浏览器全屏 API', () => {
  const created = (wsJs.match(/make\('button'/g) || []).length;
  const typed = (wsJs.match(/make\('button', \{ type: 'button'/g) || []).length;
  assert.ok(created >= 4, '工具栏按钮数量偏少：' + created);
  assert.equal(created, typed, '存在未显式声明 type=button 的按钮');
  assert.ok(!/requestFullscreen|fullscreenElement|exitFullscreen/.test(wsJs), '不得调用浏览器全屏 API');
});

test('editor-workspace.css：三栏/分隔条/断点/专注状态齐备且括号平衡', () => {
  for (const token of [
    '.workspace.md-editor-workspace', '--md-wt-divider', '--md-wt-editor-width',
    'grid-template-columns: minmax(300px', 'minmax(380px',
    '.md-wt-divider', 'max-width: 900px', '.editor-focus',
  ]) assert.ok(wsCss.includes(token), '缺少：' + token);
  assert.ok(/max-width:\s*900px[\s\S]*?\.md-wt-divider\s*\{\s*display:\s*none/.test(wsCss), '窄屏应隐藏分隔条');
  const open = (wsCss.match(/\{/g) || []).length;
  const close = (wsCss.match(/\}/g) || []).length;
  assert.equal(open, close, 'CSS 花括号不平衡');
});
