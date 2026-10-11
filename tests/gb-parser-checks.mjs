import assert from 'node:assert/strict';
import { render } from '../src/render.mjs';
import { parseArgs } from '../src/options.mjs';
const source = '---\n标准号: "GB/T 1—2020"\n---\n\n## 5.4.3 源编号\n正文。';
assert.equal(parseArgs(['--no-gb-defaults']).gbDefaults, false);
const normal = await render(source, {type: 'gb', numbering: 'none'}, {filename: 'test.md'});
assert.ok(normal.html.includes('国家市场监督管理总局'));
const strict = await render(source, {type: 'gb', numbering: 'none', gbDefaults: false}, {filename: 'test.md'});
assert.ok(!strict.html.includes('国家市场监督管理总局'));
assert.ok(!strict.html.includes('国家标准化管理委员会'));
assert.ok(strict.html.includes('<div class="cover-head"></div>'));
assert.ok(strict.html.includes('5.4.3 源编号'));
const observed = await render('---\n标准号: "GB/T 1—2020"\n发布单位: ["历史机构"]\n中文名称: "源名称"\n---\n\n## 1 范围', {type: 'gb', numbering: 'none', gbDefaults: false}, {filename: 'test.md'});
assert.ok(observed.html.includes('历史机构'));
assert.ok(observed.html.includes('源名称'));
assert.ok(!observed.html.includes('国家标准化管理委员会'));
console.log('GB parser consumer checks passed');

const quoted = await render('---\n标准号: "GB/T 1—2020"\n发布单位: ["甲机构", "乙机构"]\n中文名称: "含\\"引号的名称"\n---\n\n## 1 范围', {type: 'gb', numbering: 'none', gbDefaults: false}, {filename: 'test.md'});
assert.ok(quoted.html.includes('>甲机构</div>'));
assert.ok(quoted.html.includes('>乙机构</div>'));
assert.ok(!quoted.html.includes('>\"甲机构\"</div>'));

const image = await render('---\n标准号: GB/T 1—2020\n---\n\n![页面证据](image.png)', {type: 'gb', numbering: 'none', gbDefaults: false, floatNumbering: false}, {filename: 'test.md'});
assert.ok(!image.html.includes('<figcaption>图 1：'));
assert.ok(image.html.includes('<img'));
assert.equal(parseArgs(['--no-float-numbering']).floatNumbering, false);

const fallback = await render('---\n标准号:\ngb_source_cover: true\n---\n\n![原始封面](cover.png)', {type: 'gb', numbering: 'none', gbDefaults: false, floatNumbering: false}, {filename: 'test.md'});
assert.ok(!fallback.html.includes('<section class="cover">'));
assert.ok(fallback.html.includes('cover.png'));
assert.equal(parseArgs(['--no-gb-cover']).gbCover, false);

assert.ok(fallback.html.includes('body, main { page: gb-body; }'));
assert.ok(fallback.html.includes('main > section:first-child { break-before: auto; }'));

assert.ok(!fallback.html.includes('<header class="masthead">'));
