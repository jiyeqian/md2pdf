/**
 * config-checks —— frontmatter 解析与配置合并的单元校验（不依赖浏览器 / render）
 *
 * 覆盖：解析形态与源行号、YAML 语法/重复键、文本/数值/枚举类型校验、
 * enable/disable 冲突与未知功能名、kebab/camel 同层别名、普通元数据放行、
 * 原型污染防护、bibliography 废弃语义、GB 强制版式、优先级与空串清空。
 *
 * 运行：node --test tests/config-checks.mjs   或   node tests/config-checks.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, validateFrontmatter, resolveDocumentOptions, ConfigError } from '../src/config.mjs';

const FM = (yaml, tail = '\n# 标题\n\n正文') => '---\n' + yaml + '\n---' + tail;

const throws = (fn, re) => assert.throws(fn, e => {
  assert.ok(e instanceof ConfigError, '应为 ConfigError');
  assert.equal(e.status, 400);
  assert.ok(Array.isArray(e.configErrors) && e.configErrors.length > 0);
  for (const c of e.configErrors) {
    assert.ok('message' in c && 'line' in c && 'column' in c && 'field' in c);
  }
  if (re) assert.match(e.message, re);
  return true;
});

const general = (extra = {}) => ({ name: 'general', defaults: {}, ...extra });

test('parseFrontmatter：返回 fm / body / positions，行号准确', () => {
  const src = FM('title: "示例"\nfont-size: 12\n描述: 普通');
  const { fm, body, positions } = parseFrontmatter(src);
  assert.equal(fm.title, '示例');
  assert.equal(fm['font-size'], 12);
  assert.equal(fm['描述'], '普通');
  assert.equal(body, '# 标题\n\n正文');
  assert.deepEqual(positions.title, { line: 2, column: 1 });
  assert.deepEqual(positions['font-size'], { line: 3, column: 1 });
  assert.deepEqual(positions['描述'], { line: 4, column: 1 });
});

test('parseFrontmatter：无 frontmatter 时返回空 fm 与原 body', () => {
  const src = '# 标题\n\n正文';
  const r = parseFrontmatter(src);
  assert.deepEqual(r.fm, {});
  assert.equal(r.body, src);
  assert.deepEqual(r.positions, {});
});

test('YAML 重复字段：即使取值相同也报错并给出行号', () => {
  throws(() => parseFrontmatter(FM('title: 甲\ntitle: 甲')), /重复字段/);
  try {
    parseFrontmatter(FM('a: 1\nb: 2\na: 1'));
  } catch (e) {
    assert.equal(e.configErrors[0].line, 4);
    assert.equal(e.configErrors[0].field, 'a');
  }
});

test('YAML 语法错误：抛 ConfigError 且 message 为中文', () => {
  throws(() => parseFrontmatter('---\nfoo: [unclosed\n---\n# x'), /frontmatter/);
});

test('文本字段严格 string：null / 列表 / 对象 / 数值均报错', () => {
  throws(() => parseFrontmatter(FM('colophon: null')), /colophon/);
  throws(() => parseFrontmatter(FM('title: [a, b]')), /title/);
  throws(() => parseFrontmatter(FM('kicker: {a: 1}')), /kicker/);
  throws(() => parseFrontmatter(FM('footer-left: 123')), /footer-left/);
});

test('文本字段显式空串合法：清空且阻止低层回退', () => {
  const r = parseFrontmatter(FM('colophon: ""'));
  assert.equal(r.config.colophonLeft, '');
  const resolved = resolveDocumentOptions({}, r.fm, general({ defaults: { colophon: '低层' } }));
  assert.equal(resolved.colophonLeft, '');
});

test('数值字段不能为空 / 非法值报错，合法数值通过', () => {
  throws(() => parseFrontmatter(FM('font-size: ""')), /font-size/);
  throws(() => parseFrontmatter(FM('font-size: abc')), /font-size/);
  throws(() => parseFrontmatter(FM('toc-depth: 4')), /toc-depth/);
  assert.equal(parseFrontmatter(FM('font-size: 12')).config.fontSize, 12);
  assert.equal(parseFrontmatter(FM('line-height: 1.6')).config.lineHeight, 1.6);
});

test('枚举字段不能为空 / 未知报错，合法通过', () => {
  throws(() => parseFrontmatter(FM('theme: ""')), /theme/);
  throws(() => parseFrontmatter(FM('theme: nope')), /未知主题/);
  throws(() => parseFrontmatter(FM('numbering: nope')), /未知编号模式/);
  throws(() => parseFrontmatter(FM('number-scheme: nope')), /未知编号方案/);
  assert.equal(parseFrontmatter(FM('numbering: force')).config.numbering, 'force');
});

test('enable/disable：未知功能名与运行型开关均报错，冲突报错并含字段名', () => {
  throws(() => parseFrontmatter(FM('enable: [nope]')), /未知功能名/);
  throws(() => parseFrontmatter(FM('enable: [keep-html]')), /不能由 frontmatter 控制/);
  throws(() => parseFrontmatter(FM('disable: meta')), /必须为功能名列表/);
  throws(() => parseFrontmatter(FM('enable: [footer]\ndisable: [footer]')), /footer/);
  throws(() => parseFrontmatter(FM('footer: true\ndisable: [footer]')), /footer/);
  assert.equal(parseFrontmatter(FM('footer: false\ndisable: [footer]')).config.footer, false);
  assert.equal(parseFrontmatter(FM('enable: [toc, outline]')).config.outline, true);
});

test('同层 kebab 与 camelCase 别名：同值放行，异值冲突', () => {
  assert.equal(parseFrontmatter(FM('font-size: 12\nfontSize: 12')).config.fontSize, 12);
  throws(() => parseFrontmatter(FM('font-size: 12\nfontSize: 14')), /fontSize/);
  throws(() => parseFrontmatter(FM('float-numbering: true\nfloatNumbering: false')), /floatNumbering/);
});

test('普通元数据不受配置校验：null / 列表 / 对象都保留', () => {
  const r = parseFrontmatter(FM('author: null\nkeywords: [甲, 乙]\nmetaData: {a: 1}\n描述: 中文说明'));
  assert.equal(r.fm.author, null);
  assert.deepEqual(r.fm.keywords, ['甲', '乙']);
  assert.deepEqual(r.fm.metaData, { a: 1 });
  assert.equal(r.fm['描述'], '中文说明');
});

test('GB / skill 元数据保护：中文键、数组、多行块标量', () => {
  const r = parseFrontmatter(FM('标准号: "GB/T 39999—2026"\n发布单位:\n  - 甲单位\n  - 乙单位\ndescription: |\n  第一行\n  第二行'));
  assert.equal(r.fm['标准号'], 'GB/T 39999—2026');
  assert.deepEqual(r.fm['发布单位'], ['甲单位', '乙单位']);
  assert.equal(r.fm.description, '第一行\n第二行\n');
});

test('frontmatter 内 HTML 注释与 # 注释被忽略', () => {
  const src = '---\n# 注释行\n<!-- 说明：不算配置 -->\ntitle: "保留"\n---\n# 标题';
  const r = parseFrontmatter(src);
  assert.equal(r.fm.title, '保留');
  assert.equal(r.config.title, '保留');
});

test('安全：__proto__ / constructor / prototype 不污染原型', () => {
  parseFrontmatter(FM('__proto__: {polluted: yes}\nconstructor: 1\nprototype: 2\nname: ok'));
  assert.equal({}.polluted, undefined);
  const r = parseFrontmatter(FM('__proto__: {polluted: yes}\nname: ok'));
  assert.equal(r.fm.name, 'ok');
  assert.ok(!Object.prototype.hasOwnProperty.call(r.fm, '__proto__'));
});

test('bibliography：bib 取值被消费，false 视为废弃且不关闭', () => {
  assert.equal(parseFrontmatter(FM('bibliography: bib')).config.bibliography, 'bib');
  const warnings = [];
  const r = parseFrontmatter(FM('bibliography: false'));
  const resolved = resolveDocumentOptions({}, r.fm, general(), { warnings });
  assert.equal(resolved.bibliography, 'footnote');
  assert.ok(warnings.some(w => w.includes('bibliography')));
  throws(() => parseFrontmatter(FM('bibliography: nope')), /bibliography/);
});

test('合并优先级：explicit > fm > profile.defaults > 全局默认', () => {
  const fm = parseFrontmatter(FM('theme: minimal\nfont-size: 12')).fm;
  const profile = general({ defaults: { theme: 'gb', fontSize: 20, lineHeight: 1.5 } });
  const resolved = resolveDocumentOptions({ fontSize: 18 }, fm, profile);
  assert.equal(resolved.fontSize, 18);      // explicit 胜出
  assert.equal(resolved.theme, 'minimal');  // fm 覆盖 profile
  assert.equal(resolved.lineHeight, 1.5);   // profile 覆盖全局
  assert.equal(resolved.marginLeft, 18);    // 全局默认
  assert.equal(resolved.outline, true);
  assert.equal(resolved.bibliographyTitle, '参考文献');
});

test('页边距：四边显式与 marginSide 分层，低层简写不覆盖高层显式', () => {
  const resolved = resolveDocumentOptions(
    { marginSide: 30 },
    parseFrontmatter(FM('margin-left: 40')).fm,
    general({ defaults: { marginLeft: 25, marginTop: 25 } }));
  assert.equal(resolved.marginLeft, 30);   // explicit 简写胜过 fm 四边
  assert.equal(resolved.marginTop, 25);    // profile
  assert.equal(resolved.marginBottom, 18); // 全局
});

test('GB 强制版式：无导语无落款，不被 enable/disable 或 FM 绕过', () => {
  const fm = parseFrontmatter(FM('lead: true\ncolophon: "落款"')).fm;
  const resolved = resolveDocumentOptions({ lead: true, colophon: '显式落款' }, fm,
    { name: 'gb', gbDoc: true, defaults: { theme: 'gb', lead: false } });
  assert.equal(resolved.lead, false);
  assert.equal(resolved.colophonLeft, '');
});

test('运行字段透传：frontmatter 不能控制 keep-html / open / output', () => {
  const r = parseFrontmatter(FM('open: true\nkeepHtml: true\noutput: /tmp/x.pdf'));
  const resolved = resolveDocumentOptions({ inputs: ['a.md'], htmlOnly: true }, r.fm, general());
  assert.equal(resolved.open, false);
  assert.equal(resolved.keepHtml, false);
  assert.equal(resolved.htmlOnly, true);
  assert.equal(resolved.output, undefined);
  assert.deepEqual(resolved.inputs, ['a.md']);
});

test('默认渲染：validateFrontmatter 复用同一套校验', () => {
  assert.equal(validateFrontmatter({ 'font-size': 12 }).fontSize, 12);
  assert.throws(() => validateFrontmatter({ colophon: null }), /colophon/);
});

test('数值字段：数字字符串的 Infinity / -Infinity / NaN / 溢出必须报错并给出行号', () => {
  for (const raw of ['"Infinity"', '"-Infinity"', '"NaN"', '.inf', '.nan', '1e999']) {
    let err = null;
    try { parseFrontmatter(FM(`font-size: ${raw}`)); } catch (e) { err = e; }
    assert.ok(err instanceof ConfigError, `应拒绝 font-size: ${raw}`);
    assert.equal(err.status, 400);
    assert.equal(err.configErrors[0].line, 2, `应给出源行号（font-size: ${raw}）`);
  }
  // 合法（有限）数字字符串仍被消费，未被误伤
  assert.equal(parseFrontmatter(FM('font-size: "12"')).config.fontSize, 12);
  assert.equal(parseFrontmatter(FM('line-height: "1.6"')).config.lineHeight, 1.6);
});

test('frontmatter 根必须为映射：序列 / 标量报错并带位置，空文档与仅注释允许 {}', () => {
  for (const yaml of ['- list', 'foo', '42']) {
    let err = null;
    try { parseFrontmatter(FM(yaml)); } catch (e) { err = e; }
    assert.ok(err instanceof ConfigError, `应拒绝非映射根：${yaml}`);
    assert.equal(err.status, 400);
    assert.match(err.message, /根必须是字段映射/);
    assert.equal(err.configErrors[0].line, 2);
    assert.equal(err.configErrors[0].column, 1);
  }
  assert.deepEqual(parseFrontmatter('---\n---\n# x').fm, {});
  assert.deepEqual(parseFrontmatter('---\n# 只有注释\n<!-- 说明 -->\n---\n# x').fm, {});
});

test('别名安全：循环自引用报 ConfigError(400)，不是原生 RangeError', () => {
  let err = null;
  try { parseFrontmatter(FM('metadata: &a [*a]')); } catch (e) { err = e; }
  assert.ok(err instanceof ConfigError, '应为 ConfigError');
  assert.ok(!(err instanceof RangeError), '不得为原生 RangeError');
  assert.equal(err.status, 400);
  assert.match(err.message, /循环引用/);
});

test('别名安全：合法别名可复用，别名炸弹被限制为 ConfigError(400)', () => {
  const reused = parseFrontmatter(FM('meta1: &a {x: 1}\nmeta2: *a'));
  assert.deepEqual(reused.fm.meta1, { x: 1 });
  assert.deepEqual(reused.fm.meta2, { x: 1 });
  assert.ok(!Object.prototype.hasOwnProperty.call(reused.fm, '__proto__'));

  const bomb = [
    'a: &a ["x","x","x","x","x","x","x","x","x"]',
    'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
    'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
    'd: [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
  ].join('\n');
  let err = null;
  try { parseFrontmatter(FM(bomb)); } catch (e) { err = e; }
  assert.ok(err instanceof ConfigError, '别名炸弹应为 ConfigError');
  assert.ok(!(err instanceof RangeError), '不得为原生 RangeError');
  assert.equal(err.status, 400);
});

test('修复后普通元数据保持：null / 合法多行 / 数组不被破坏', () => {
  const r = parseFrontmatter(FM('author: null\nkeywords: [甲, 乙]\ndescription: |\n  第一行\n  第二行'));
  assert.equal(r.fm.author, null);
  assert.deepEqual(r.fm.keywords, ['甲', '乙']);
  assert.equal(r.fm.description, '第一行\n第二行\n');
});

test('vendored YAML has verified provenance and no declared runtime dependencies', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(packageJson.dependencies || {}).length, 0);
  const provenance = JSON.parse(await readFile(new URL('../vendor/yaml/provenance.json', import.meta.url), 'utf8'));
  assert.equal(provenance.version, '2.8.1');
  assert.equal(provenance.license, 'ISC');
  const bundle = await readFile(new URL('../vendor/yaml/yaml.mjs', import.meta.url));
  assert.equal(createHash('sha256').update(bundle).digest('hex'), provenance.sha256);
  assert.match(await readFile(new URL('../vendor/yaml/LICENSE', import.meta.url), 'utf8'), /Permission to use/);
});

test('vendored parser runs from an isolated directory without node_modules', async t => {
  const { mkdtemp, copyFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const dir = await mkdtemp(join(tmpdir(), 'md2pdf-yaml-isolated-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, 'yaml.mjs');
  await copyFile(new URL('../vendor/yaml/yaml.mjs', import.meta.url), target);
  const yaml = await import(pathToFileURL(target).href);
  assert.deepEqual(yaml.parseDocument('title: "验收"\nenable: [outline]').toJS(), {title:'验收', enable:['outline']});
  assert.ok(yaml.isMap(yaml.parseDocument('title: x').contents));
  assert.ok(yaml.isSeq(yaml.parseDocument('- x').contents));
});


test('colophon-enabled aliases the legacy camelCase flag without changing precedence', () => {
  for (const key of ['colophon-enabled', 'colophonEnabled']) {
    const parsed = parseFrontmatter(FM(key + ': false'));
    assert.equal(resolveDocumentOptions({}, parsed.fm).colophonEnabled, false);
    assert.equal(resolveDocumentOptions({ colophonEnabled: true }, parsed.fm).colophonEnabled, true);
  }
  assert.throws(() => resolveDocumentOptions({}, { 'colophon-enabled': false, colophonEnabled: true }), /冲突/);
});


test('keywords and tags require string lists with source field diagnostics', () => {
  for (const field of ['keywords', 'tags']) {
    assert.deepEqual(parseFrontmatter(FM(field + ': [甲, 乙]')).fm[field], ['甲', '乙']);
    assert.deepEqual(parseFrontmatter(FM(field + ': []')).fm[field], []);
    for (const value of ['旧字符串', 'null', 'true', '[甲, 1]', '[甲, null]', '{a: b}']) {
      assert.throws(() => parseFrontmatter(FM(field + ': ' + value)), error => error instanceof ConfigError && error.configErrors[0].field === field && error.configErrors[0].line === 2);
    }
    assert.throws(() => validateFrontmatter({[field]:'旧字符串'}), ConfigError);
  }
});
