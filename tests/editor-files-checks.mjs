import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownDownloadName } from '../web/editor-files.mjs';
const date = new Date(2026, 9, 10, 9, 8, 7);
test('download names use the first H1 and local timestamp', () => {
  assert.equal(markdownDownloadName('## 小节\n# 文档标题\n# 第二标题', date), '文档标题_20261010_090807.md');
  assert.equal(markdownDownloadName('正文\n## 小节', date), 'md2pdf_document_20261010_090807.md');
});
test('ignore code blocks and front matter, accept Setext H1', () => {
  assert.equal(markdownDownloadName('---\n# 元数据\n---\n```md\n# 代码\n```\n标题\n===', date), '标题_20261010_090807.md');
  assert.equal(markdownDownloadName('~~~\n# 代码\n~~~\n# 真标题 ###', date), '真标题_20261010_090807.md');
});
test('sanitize unsafe filename characters', () => {
  assert.equal(markdownDownloadName('# 标题/测试:例子?', date), '标题_测试_例子__20261010_090807.md');
});
