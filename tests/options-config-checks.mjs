/**
 * options-config-checks —— CLI 解析（options.mjs）与配置合并接线的单元校验。
 *
 * 覆盖：defaultOptions 稀疏、显式渲染值、enable/disable 列表与可重复、
 * 隐藏兼容别名、--key=value（含空串与 -abc）、缺值不吞下一选项、重复取值冲突、
 * 未知选项 / 枚举 / 数值报错、运行型开关、expandArgs、以及 resolveDocumentOptions 的
 * explicit>fm 优先级与 GB 强制版式。
 *
 * 运行：node --test tests/options-config-checks.mjs   或   node tests/options-config-checks.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, expandArgs, defaultOptions, GLOBAL_OPTION_DEFAULTS } from '../src/options.mjs';
import { parseFrontmatter, resolveDocumentOptions, ConfigError } from '../src/config.mjs';

const throws = (fn, re) => assert.throws(fn, e => {
  assert.ok(e instanceof ConfigError, '应为 ConfigError');
  assert.equal(e.status, 400);
  if (re) assert.match(e.message, re);
  return true;
});

test('defaultOptions 稀疏：不提前灌渲染默认，只有运行字段', () => {
  const o = defaultOptions();
  for (const k of ['theme', 'footer', 'meta', 'lead', 'toc', 'outline', 'fontSize', 'lineHeight', 'landscape', 'bibliography']) {
    assert.ok(!Object.prototype.hasOwnProperty.call(o, k), 'defaultOptions 不应含 ' + k);
  }
  assert.deepEqual(o.inputs, []);
  assert.equal(o.help, false);
  assert.equal(o.htmlOnly, false);
});

test('parseArgs：只记录显式渲染值与运行默认', () => {
  const o = parseArgs(['a.md', 'b.md', '--theme', 'minimal', '--font-size', '12', '--title', '标题']);
  assert.deepEqual(o.inputs, ['a.md', 'b.md']);
  assert.equal(o.theme, 'minimal');
  assert.equal(o.fontSize, 12);
  assert.equal(o.title, '标题');
  assert.ok(!Object.prototype.hasOwnProperty.call(o, 'footer'));
  assert.equal(o.help, false);
});

test('enable/disable：逗号分隔、可重复，功能名映射到选项', () => {
  assert.deepEqual(
    (({ footer, toc, meta, lead }) => ({ footer, toc, meta, lead }))(parseArgs(['--enable', 'footer,toc', '--disable', 'meta,lead'])),
    { footer: true, toc: true, meta: false, lead: false });
  const o = parseArgs(['--enable', 'footer', '--enable', 'outline', '--disable', 'landscape']);
  assert.equal(o.footer, true);
  assert.equal(o.outline, true);
  assert.equal(o.landscape, false);
  assert.equal(parseArgs(['--enable', 'gb-cover,gb-defaults']).gbCover, true);
  assert.equal(parseArgs(['--disable', 'link-urls']).linkUrls, false);
});

test('隐藏兼容别名：旧 --no-* 与正向开关仍可用', () => {
  assert.equal(parseArgs(['--no-meta']).meta, false);
  assert.equal(parseArgs(['--no-lead']).lead, false);
  assert.equal(parseArgs(['--no-footer']).footer, false);
  assert.equal(parseArgs(['--no-float-numbering']).floatNumbering, false);
  assert.equal(parseArgs(['--no-gb-cover']).gbCover, false);
  assert.equal(parseArgs(['--no-gb-defaults']).gbDefaults, false);
  assert.equal(parseArgs(['--no-outline']).outline, false);
  assert.equal(parseArgs(['--outline']).outline, true);
  assert.equal(parseArgs(['-t']).toc, true);
  assert.equal(parseArgs(['--toc']).toc, true);
  assert.equal(parseArgs(['--link-urls']).linkUrls, true);
  assert.equal(parseArgs(['--landscape']).landscape, true);
  assert.equal(parseArgs(['--no-landscape']).landscape, false);
});

test('运行型开关：仅 CLI 可控，保留原模式', () => {
  assert.equal(parseArgs(['--keep-html']).keepHtml, true);
  assert.equal(parseArgs(['--html-only']).htmlOnly, true);
  assert.equal(parseArgs(['--no-html-only']).htmlOnly, false);
  assert.equal(parseArgs(['--open']).open, true);
  assert.equal(parseArgs(['--paged-html', 'out.html']).pagedHtmlPath, 'out.html');
  assert.equal(parseArgs(['--paged-html']).pagedHtml, true);
  assert.equal(parseArgs(['--enable', 'keep-html']).keepHtml, true);
  assert.equal(parseArgs(['--disable', 'open']).open, false);
});

test('--key=value：支持含空串与以 - 开头的值', () => {
  assert.equal(parseArgs(['--title=']).title, '');
  assert.equal(parseArgs(['--title=-abc']).title, '-abc');
  assert.equal(parseArgs(['--header-left=']).headerLeft, '');
  assert.equal(parseArgs(['--theme=minimal']).theme, 'minimal');
  assert.equal(parseArgs(['--enable=toc,outline']).outline, true);
});

test('缺值不吞下一选项；纯缺值报错', () => {
  throws(() => parseArgs(['--title', '--theme', 'minimal']), /缺少参数值/);
  throws(() => parseArgs(['--title']), /缺少参数值/);
  throws(() => parseArgs(['--header-left', '--open']), /缺少参数值/);
});

test('重复取值：一致允许，矛盾报错', () => {
  assert.equal(parseArgs(['--title', 'a', '--title', 'a']).title, 'a');
  throws(() => parseArgs(['--title', 'a', '--title', 'b']), /冲突/);
  throws(() => parseArgs(['--font-size', '12', '--font-size', '13']), /冲突/);
});

test('未知选项 / 枚举 / 数值无效均报错', () => {
  throws(() => parseArgs(['--nope']), /未知选项/);
  throws(() => parseArgs(['--theme', 'nope']), /未知主题/);
  throws(() => parseArgs(['--type', 'nope']), /未知文档类型/);
  throws(() => parseArgs(['--number-scheme', 'nope']), /未知编号方案/);
  throws(() => parseArgs(['--numbering', 'nope']), /未知编号模式/);
  throws(() => parseArgs(['--font-size', 'abc']), /数值/);
  throws(() => parseArgs(['--font-size']), /缺少参数值|数值/);
  throws(() => parseArgs(['--enable', 'nope']), /未知功能名/);
});

test('页边距：--margin 上下/左右，四边显式设置', () => {
  const o = parseArgs(['--margin', '20,18']);
  assert.equal(o.marginTop, 20);
  assert.equal(o.marginBottom, 20);
  assert.equal(o.marginSide, 18);
  const q = parseArgs(['--margin-top', '30', '--margin-left', '25', '--margin-right', '19', '--margin-bottom', '20']);
  assert.equal(q.marginTop, 30);
  assert.equal(q.marginLeft, 25);
  assert.equal(q.marginRight, 19);
  assert.equal(q.marginBottom, 20);
});

test('expandArgs：--flag=true/false 归一为 enable/disable，其余透传', () => {
  assert.deepEqual(expandArgs(['--toc=false']), ['--disable', 'toc']);
  assert.deepEqual(expandArgs(['--outline=true']), ['--enable', 'outline']);
  assert.deepEqual(expandArgs(['--title=x']), ['--title=x']);
  assert.equal(parseArgs(expandArgs(['--toc=false'])).toc, false);
});

test('bibliography 废弃：--no-bibliography 不关闭，--bibliography=bib 被消费', () => {
  const o = parseArgs(['--no-bibliography']);
  assert.notEqual(o.bibliography, false);
  assert.ok(o.warnings.some(w => w.includes('bibliography')));
  assert.equal(parseArgs(['--bibliography=bib']).bibliography, 'bib');
});

test('浏览器解析全链路：parseArgs(expandArgs(argv)) 保持可用', () => {
  const o = parseArgs(expandArgs(['doc.md', '--theme=minimal', '--enable=footer,toc', '--title=hi', '--html-only']));
  assert.equal(o.theme, 'minimal');
  assert.equal(o.footer, true);
  assert.equal(o.toc, true);
  assert.equal(o.title, 'hi');
  assert.equal(o.htmlOnly, true);
  assert.deepEqual(o.inputs, ['doc.md']);
});

test('resolveDocumentOptions：CLI 显式值胜出，空串清空并阻断 fm 回退', () => {
  const fm = parseFrontmatter('---\nheader-left: "文档落款"\nfooter-center: "内部资料"\n---\n# 标题').fm;
  const resolved = resolveDocumentOptions(parseArgs(['doc.md', '--header-left', '']), fm, { name: 'general', defaults: {} });
  assert.equal(resolved.headerLeft, '');
  assert.equal(resolved.footerCenter, '内部资料');
  assert.equal(resolved.keepHtml, false);
});

test('resolveDocumentOptions：全局默认与 GB 强制版式', () => {
  const resolved = resolveDocumentOptions({}, {}, { name: 'general', defaults: {} });
  assert.equal(resolved.fontSize, 10.5);
  assert.equal(resolved.lineHeight, 1.9);
  assert.equal(resolved.marginTop, 20);
  assert.equal(resolved.marginBottom, 18);
  assert.equal(resolved.marginLeft, 18);
  assert.equal(resolved.bibliography, 'footnote');
  assert.equal(resolved.bibliographyTitle, undefined);
  assert.equal(resolved.outline, true);
  assert.equal(resolved.toc, false);
  assert.equal(resolved.numberScheme, 'arabic');
  assert.equal(GLOBAL_OPTION_DEFAULTS.outline, true);

  const gb = resolveDocumentOptions(parseArgs(['--enable', 'lead']), {}, { name: 'gb', gbDoc: true, defaults: { lead: false } });
  assert.equal(gb.lead, false);
  assert.equal(gb.colophonEnabled, false);
});
