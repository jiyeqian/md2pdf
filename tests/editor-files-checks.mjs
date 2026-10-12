import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownDownloadName, documentDownloadName, firstHeadingTitle, frontmatterVersion, sanitizeDownloadFileName } from '../web/editor-files.mjs';

const date = new Date(2026, 9, 10, 9, 8, 7); // 20261010_090807
const stamp = '20261010_090807';

test('download names use the first H1 and a local timestamp when no version', () => {
  assert.equal(markdownDownloadName('## 小节\n# 文档标题\n# 第二标题', date), '文档标题_' + stamp + '.md');
  assert.equal(markdownDownloadName('正文\n## 小节', date), 'md2pdf_设置一级标题为文档标题_' + stamp + '.md');
});

test('frontmatter version wins over the timestamp and keeps quotes / numeric scalars', () => {
  assert.equal(markdownDownloadName('---\nversion: 1.2.3\n---\n# 标题', date), '标题_1.2.3.md');
  assert.equal(markdownDownloadName("---\nversion: '1.2.3'\n---\n# 标题", date), '标题_1.2.3.md');
  assert.equal(markdownDownloadName('---\nversion: "2.0"\n---\n# 标题', date), '标题_2.0.md');
  assert.equal(markdownDownloadName('---\nversion: 2026\n---\n# 标题', date), '标题_2026.md');
});

test('empty / object / list versions are invalid and fall back to the timestamp', () => {
  for (const fm of ['---\nversion:\n---\n', '---\nversion: {major: 1}\n---\n', '---\nversion: [1, 2]\n---\n']) {
    assert.equal(markdownDownloadName(fm + '# 标题', date), '标题_' + stamp + '.md', fm);
  }
  assert.equal(frontmatterVersion('---\nversion: [1, 2]\n---\n# 标题'), '');
});

test('unsafe version characters are sanitized, never dropped silently', () => {
  assert.equal(markdownDownloadName('---\nversion: "1/2"\n---\n# 标题', date), '标题_1_2.md');
});

test('ignore code blocks and front matter, accept Setext H1', () => {
  assert.equal(markdownDownloadName('~~~md\n# 代码\n~~~\n标题\n===', date), '标题_' + stamp + '.md');
  assert.equal(markdownDownloadName('~~~\n# 代码\n~~~\n# 真标题 ###', date), '真标题_' + stamp + '.md');
});

test('sanitize unsafe filename characters', () => {
  assert.equal(markdownDownloadName('# 标题/测试:例子?', date), '标题_测试_例子__' + stamp + '.md');
});

test('Markdown and PDF share the same basename for the same document and version', () => {
  const md = '---\nversion: v3\n---\n# 共享标题';
  const base = '共享标题_v3';
  assert.equal(markdownDownloadName(md, date), base + '.md');
  assert.equal(documentDownloadName(md, date, 'pdf'), base + '.pdf');
  assert.equal(firstHeadingTitle(md), '共享标题');
});

test('sanitizeDownloadFileName keeps a base name, forces the extension and rejects unsafe input', () => {
  assert.equal(sanitizeDownloadFileName('报告_v1.pdf', 'pdf'), '报告_v1.pdf');
  assert.equal(sanitizeDownloadFileName('报告_v1', 'pdf'), '报告_v1.pdf');
  assert.equal(sanitizeDownloadFileName('../secret', 'pdf'), 'secret.pdf');
  assert.equal(sanitizeDownloadFileName('a/b/c.md', 'pdf'), 'c.md.pdf');
  assert.equal(sanitizeDownloadFileName('bad' + String.fromCharCode(0) + 'name', 'pdf'), '');
  assert.equal(sanitizeDownloadFileName('', 'pdf'), '');
  assert.equal(sanitizeDownloadFileName(42, 'pdf'), '');
});

test('sanitizeDownloadFileName 的控制字符拒绝无状态：同一换行输入连续两次结果一致', () => {
  const dirty = 'a' + String.fromCharCode(10) + 'b.pdf';
  assert.equal(sanitizeDownloadFileName(dirty, 'pdf'), '');
  assert.equal(sanitizeDownloadFileName(dirty, 'pdf'), '', '第二次调用不得因 lastIndex 残留而不同');
  // 纯净名在前、脏名在后、再纯净：全局正则的 lastIndex 问题会在此暴露。
  assert.equal(sanitizeDownloadFileName('ok.pdf', 'pdf'), 'ok.pdf');
  assert.equal(sanitizeDownloadFileName(dirty, 'pdf'), '');
  assert.equal(sanitizeDownloadFileName('ok2.pdf', 'pdf'), 'ok2.pdf');
});

test('sanitizeDownloadFileName 限长不截断扩展名、不劈开代理对', () => {
  const long = 'x'.repeat(400) + '.pdf';
  const out = sanitizeDownloadFileName(long, 'pdf');
  assert.ok(out.length <= 200, '长度应受限：' + out.length);
  assert.ok(out.endsWith('.pdf'), '扩展名必须完整保留');

  const emoji = '😀'.repeat(200) + '.pdf';
  const trimmed = sanitizeDownloadFileName(emoji, 'pdf');
  assert.ok(trimmed.endsWith('.pdf'), 'emoji 名称同样保留扩展名');
  const stem = trimmed.slice(0, -4);
  const last = stem.charCodeAt(stem.length - 1);
  assert.ok(!(last >= 0xd800 && last <= 0xdbff), '不得以孤立的高代理结尾（半个字符）');
});

test('frontmatterVersion：带注释的引号标量正确取值，不被误算成下划线包裹', () => {
  assert.equal(frontmatterVersion('---\nversion: "1.2.3" # comment\n---\n# T'), '1.2.3');
  assert.equal(frontmatterVersion("---\nversion: '1.2.3' # comment\n---\n# T"), '1.2.3');
  assert.equal(frontmatterVersion('---\nversion: 1.2.3 # note\n---\n# T'), '1.2.3');
  // 单引号内 '' 表示一个撇号；双引号反斜杠转义解码后仍做文件系统净化。
  assert.equal(frontmatterVersion("---\nversion: 'it''s'\n---\n# T"), "it's");
  assert.equal(frontmatterVersion('---\nversion: "a\\"b"\n---\n# T'), 'a_b');
});

test('frontmatterVersion：只认顶层 version，嵌套 other.version 不参与', () => {
  assert.equal(frontmatterVersion('---\nother:\n  version: 9\n---\n# T'), '');
  assert.equal(frontmatterVersion('---\nversion: 2\nother:\n  version: 9\n---\n# T'), '2');
});

test('frontmatterVersion：null / 布尔 / 对象 / 列表 / 块 / 未闭合一律非法', () => {
  for (const raw of ['null', '~', 'true', 'False', '{major: 1}', '[1, 2]', '|', '>', "'1.2.3", '"1.2.3']) {
    assert.equal(frontmatterVersion('---\nversion: ' + raw + '\n---\n# T'), '', raw);
  }
  // 未闭合 front matter（缺少结束分隔符）也返回空。
  assert.equal(frontmatterVersion('---\nversion: 1.2.3\n# T'), '');
  assert.equal(frontmatterVersion('---\nversion: {a: 1}\n---\n# T'), '');
});

test('frontmatter title takes precedence over H1 for both download formats', () => {
  for (const heading of ['', '\n# 正文标题']) {
    const md = '---\ntitle: "元数据标题" # 文档标题\nversion: v2\n---\n正文' + heading;
    assert.equal(markdownDownloadName(md, date), '元数据标题_v2.md');
    assert.equal(documentDownloadName(md, date, 'pdf'), '元数据标题_v2.pdf');
  }
});

test('invalid or nested frontmatter title falls back to H1 or the default title', () => {
  for (const field of ['title:', 'title: null', 'title: {}', 'metadata:\n  title: 嵌套标题']) {
    const md = '---\n' + field + '\nversion: v2\n---\n';
    assert.equal(markdownDownloadName(md + '# 正文标题', date), '正文标题_v2.md');
    assert.equal(documentDownloadName(md, date, 'pdf'), 'md2pdf_设置一级标题为文档标题_v2.pdf');
  }
  assert.equal(markdownDownloadName('---\ntitle: "标题/测试"\nversion: v2\n---\n', date), '标题_测试_v2.md');
});

test('分隔符容忍行尾空白 / CR，标题与版本仍正确解析（兼容成熟服务端配置）', () => {
  // 成熟 YAML 解析器允许分隔符后跟空白；浏览器侧只做同样的小幅容忍，不引入完整 YAML。
  const md = '---  \r\ntitle: "带空白的标题"\r\nversion: v1\r\n---  \r\n# 正文标题';
  assert.equal(markdownDownloadName(md, date), '带空白的标题_v1.md');
  assert.equal(documentDownloadName(md, date, 'pdf'), '带空白的标题_v1.pdf');
  assert.equal(firstHeadingTitle(md), '正文标题');
  assert.equal(frontmatterVersion(md), 'v1');
});

test('title 显式空字符串视为清空：下载名回落到一级标题 / 默认标题', () => {
  assert.equal(markdownDownloadName('---\ntitle: ""\nversion: v2\n---\n# 正文标题', date), '正文标题_v2.md');
  assert.equal(documentDownloadName('---\ntitle: ""\nversion: v2\n---\n', date, 'pdf'), 'md2pdf_设置一级标题为文档标题_v2.pdf');
});
