/**
 * md2pdf 静态校验（不需要浏览器）
 *
 * 用法：node ci/checks.mjs [项目根]
 *
 * 校验对象是"会真正影响输出"的约定，而不是文件是否存在这类表面项：
 *   1. 版本号一致（package.json ↔ src 里的 VERSION）
 *   2. 模板占位符闭合：shell.html / base.css 里的 {{X}} 必须都有替换逻辑，
 *      且 src 里声明的每个占位符都真的出现在模板中（防拼错、防上次那种
 *      "{{TITLE}} 出现两次只替换一处" 的 bug）
 *   3. 主题 CSS 里用到的每个 var(--x) 都有定义（抓住拼错的变量名）
 *   4. CLI 冒烟：--help / --version
 *   5. 端到端渲染到 HTML 并断言关键结构存在（表格 / 代码块 / 引用 /
 *      嵌套列表 / 目录 / 链接 URL / 分节 / 无占位符残留 / 无 undefined）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv[2] || path.join(HERE, '..'));

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fail++; console.error(`  \u2717 ${name}${detail ? ' — ' + detail : ''}`); }
};
const read = p => fs.readFileSync(p, 'utf8');
const readIf = p => (fs.existsSync(p) ? read(p) : '');

const srcFile = path.join(ROOT, 'src', 'md2pdf.mjs');
const shellFile = path.join(ROOT, 'assets', 'shell.html');
const baseCssFile = path.join(ROOT, 'assets', 'base.css');
const themeDir = path.join(ROOT, 'assets');
const themes = fs.readdirSync(themeDir).filter(f => /^theme-.+\.css$/.test(f)).sort()
  .map(f => path.join(themeDir, f));

console.log(`校验目标：${ROOT}`);

/* ---------- 1. 版本号一致 ---------- */
const src = ['md2pdf.mjs', 'render.mjs', 'chrome.mjs', 'options.mjs'].map(f => read(path.join(ROOT, 'src', f))).join('\n');
const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
const vMatch = /const VERSION = '([^']+)'/.exec(src);
ok('版本号：src 中声明 VERSION', !!vMatch, '未找到 const VERSION');
if (vMatch) {
  ok('版本号：package.json 与 VERSION 一致', pkg.version === vMatch[1],
    `package.json=${pkg.version} src=${vMatch[1]}`);
}

/* ---------- 2. 模板占位符闭合 ---------- */
const shell = read(shellFile);
const baseCss = read(baseCssFile);
const ph = s => [...new Set(s.match(/\{\{[A-Z_]+\}\}/g) || [])];

// src 中 fill 映射的 key（形如 '{{TITLE}}': ...）
const declared = new Set([...src.matchAll(/'\{\{([A-Z_]+)\}\}'\s*:/g)].map(m => `{{${m[1]}}}`));
// src 中针对 CSS 的 replace('\{\{X\}\}' ...)
const cssDeclared = new Set([...src.matchAll(/\\\{\\\{([A-Z_]+)\\\}\\\}/g)].map(m => `{{${m[1]}}}`));

const shellPh = ph(shell);
const cssPh = ph(baseCss);

ok('占位符：shell.html 全部有替换逻辑',
  shellPh.every(x => declared.has(x)),
  '未覆盖：' + shellPh.filter(x => !declared.has(x)).join(', '));
ok('占位符：css 占位符全部有替换逻辑',
  cssPh.every(x => cssDeclared.has(x)),
  '未覆盖：' + cssPh.filter(x => !cssDeclared.has(x)).join(', '));
ok('占位符：src 声明的 shell 占位符都出现在模板中',
  [...declared].every(x => shell.includes(x)),
  '模板里没有：' + [...declared].filter(x => !shell.includes(x)).join(', '));
// 注意：占位符**允许**出现多次（{{TITLE}} 在 <title> 与 <h1> 各一次），
// 所以这里不能断言"唯一"，要断言"替换是全量的"——否则会退回旧 bug：
// 用 String.replace 只替换第一处，正文标题变成字面量 {{TITLE}}。
ok('占位符：替换是全量的（不依赖占位符只出现一次）',
  /\.split\(\s*k\s*\)\.join\(\s*v\s*\)/.test(src) && !/\.replace\(\s*'\\\{\\\{/.test(src),
  '期望使用 split/join 全量替换，且不得对占位符用单次 replace');

/* ---------- 3. 主题变量都有定义 ---------- */
const defs = new Set([...baseCss.matchAll(/--([a-z-]+)\s*:/g)].map(m => m[1]));
for (const t of themes) {
  const css = readIf(t);
  const name = path.basename(t);
  if (!css) { ok(`主题 ${name} 存在`, false); continue; }
  for (const m of css.matchAll(/--([a-z-]+)\s*:/g)) defs.add(m[1]);
}
for (const t of themes) {
  const css = readIf(t);
  const name = path.basename(t);
  const used = [...new Set([...css.matchAll(/var\(--([a-z-]+)\)/g)].map(m => m[1]))];
  const missing = used.filter(v => !defs.has(v));
  ok(`主题 ${name}：var(--x) 全部有定义`, missing.length === 0, '未定义：' + missing.join(', '));
}

/* ---------- 4. CLI 冒烟 ---------- */
const nodeBin = process.execPath;
const run = (args, cwd) => spawnSync(nodeBin, [path.join(ROOT, 'src', 'md2pdf.mjs'), ...args],
  { cwd: cwd || ROOT, encoding: 'utf8' });

const help = run(['--help']);
ok('CLI：--help 退出码 0 且含用法', help.status === 0 && /md2pdf/.test(help.stdout),
  `status=${help.status}`);
const ver = run(['--version']);
ok('CLI：--version 输出与 package.json 一致', ver.stdout.trim() === pkg.version,
  `输出=${ver.stdout.trim()} package.json=${pkg.version}`);

/* ---------- 4b. 文档类型 Profile ---------- */
// type ↔ template ↔ example 一一对应（重构约定：每类文档 templates/ 有骨架、examples/ 有完整样例）
const TYPE_FILES = {
  general: ['templates/general.md', 'examples/general.md'],
  skill: ['templates/skill.md', 'examples/skill.md'],
  readme: ['templates/readme.md', 'examples/README.md'],
  paper: ['templates/paper.md', 'examples/paper.md'],
  gb: ['templates/gb.md', 'examples/gb.md'],
};
for (const [t, [tpl, ex]] of Object.entries(TYPE_FILES)) {
  ok(`对应关系：${t} → ${tpl} + ${ex}`,
    fs.existsSync(path.join(ROOT, tpl)) && fs.existsSync(path.join(ROOT, ex)));
}
// readme 样例自身就是 examples 导览：应同时覆盖五个类型的介绍
const exReadme = readIf(path.join(ROOT, 'examples', 'README.md'));
ok('对应关系：examples/README.md 介绍全部五类示例',
  ['general.md', 'skill.md', 'paper.md', 'gb.md', 'templates'].every(k => exReadme.includes(k)));

// gb 结构化元数据（对齐 SAMR 平台字段）：模板收录 + HTML meta 透传
const SAMR_KEYS = ['标准状态', '标准性质', '标准类别', '标准计划', '国际标准分类号', '中国标准分类号', '全部代替标准', '归口单位', '执行单位', '主管部门', '采标国际标准', '采标英文名称', '采标中文名称', '采标程度', '起草单位', '起草人'];
const gbTplFm = readIf(path.join(ROOT, 'templates', 'gb.md')).match(/(^|\n)---\n[\s\S]*?\n---/) || [''];
ok('gb 元数据：模板 frontmatter 收录 SAMR 全部字段（键名与平台一致）',
  SAMR_KEYS.every(k => gbTplFm[0].includes(k + ':')));
ok('gb 元数据：模板字段不采用注释形式（留空即可）',
  !/^#\s*[^:\n]+:\s*\S/m.test(gbTplFm[0]));
const tmpOut = (n) => path.join(os.tmpdir(), 'md2pdf-ci-' + n + '.html');
const rSkill = run(['skill/SKILL.md', '--html-only', '-o', tmpOut('skill')]);
ok('profile：SKILL.md 自动探测为 skill', rSkill.status === 0 && /<div class="kicker">技能文档<\/div>/.test(readIf(tmpOut('skill'))),
  `status=${rSkill.status}`);
const rForce = run(['examples/general.md', '--html-only', '--type', 'skill', '-o', tmpOut('force')]);
ok('profile：--type skill 强制生效', rForce.status === 0 && /<div class="kicker">技能文档<\/div>/.test(readIf(tmpOut('force'))),
  `status=${rForce.status}`);
const rBad = run(['examples/general.md', '--html-only', '--type', 'nope', '-o', tmpOut('bad')]);
ok('profile：未知 --type 报错且退出非 0', rBad.status !== 0 && /未知文档类型/.test(rBad.stderr || ''),
  `status=${rBad.status}`);

// readme profile：默认加目录 + 徽章不编号（真实插图仍编号）
const rmDir = path.join(os.tmpdir(), 'md2pdf-ci-readme');
fs.mkdirSync(rmDir, { recursive: true });
const realImg = 'file://' + path.join(ROOT, 'examples', 'control-loop.png');
fs.writeFileSync(path.join(rmDir, 'README.md'), [
  '# 示例项目', '',
  '![build](https://img.shields.io/badge/build-passing-green)', '',
  '## 安装', '',
  '## 用法', '',
  '![架构图](' + realImg + ')', ''
].join('\n'));
const rReadme = run([path.join(rmDir, 'README.md'), '--html-only', '-o', path.join(rmDir, 'out.html')]);
const readmeHtml = readIf(path.join(rmDir, 'out.html'));
ok('profile：README.md 自动探测为 readme（默认加目录）',
  rReadme.status === 0 && /class="toc"/.test(readmeHtml), `status=${rReadme.status}`);
ok('profile：readme 徽章不编号（不包 figure）',
  /<img[^>]*shields\.io/.test(readmeHtml) && !/<figure[^>]*><img[^>]*shields\.io/.test(readmeHtml));
ok('profile：readme 真实插图仍编号（图 N）',
  /<figcaption>图 \d+：架构图<\/figcaption>/.test(readmeHtml));

// paper profile：frontmatter abstract/keywords → 报头三件套（作者/摘要/关键词）
const ppDir = path.join(os.tmpdir(), 'md2pdf-ci-paper');
fs.mkdirSync(ppDir, { recursive: true });
fs.writeFileSync(path.join(ppDir, 'paper.md'), [
  '---', 'title: 抓取控制研究', 'author: 张三，李四', 'affiliation: 清华大学',
  'abstract: 本文提出一种方法。', 'keywords: 深度学习；抓取控制', '---', '',
  '## 引言', '', '正文。', ''
].join('\n'));
const rPaper = run([path.join(ppDir, 'paper.md'), '--html-only', '-o', path.join(ppDir, 'out.html')]);
const paperHtml = readIf(path.join(ppDir, 'out.html'));
ok('profile：frontmatter 含 abstract → paper（作者行）',
  rPaper.status === 0 && /<p class="authors">[\s\S]*张三/.test(paperHtml), `status=${rPaper.status}`);
ok('profile：paper 摘要块', /<div class="abstract">[\s\S]*摘要[\s\S]*<\/div>/.test(paperHtml));
ok('profile：paper 关键词行', /<div class="keywords">[\s\S]*关键词[\s\S]*<\/div>/.test(paperHtml));

// gb profile：frontmatter 标准号 → gb（封面 / 章条 / 附录字母 / 前言豁免 / 目次标题）
const gbDir = path.join(os.tmpdir(), 'md2pdf-ci-gb');
fs.mkdirSync(gbDir, { recursive: true });
fs.writeFileSync(path.join(gbDir, 'gb.md'), [
  '---', '标准号: GB/T 99999—2026', 'title: 测试标准', '发布日期: 2026-01-01', '实施日期: 2026-07-01',
  '标准状态: 现行', '中国标准分类号: J 28', '全部代替标准: GB/T 99999-2015', '归口单位: 全国×××标准化技术委员会', '采标国际标准: ISO 99999:2025', '采标英文名称: Test adopted standard', '---', '',
  '## 前言', '', '前言内容。', '',
  '## 范围', '', '本文件规定了……', '',
  '## 附录 A（规范性）测试方法', '', '### 测试条件', '', '环境温度 25 ℃。', '',
  '## 参考文献', '', '结束。', ''
].join('\n'));
const rGb = run([path.join(gbDir, 'gb.md'), '--html-only', '-o', path.join(gbDir, 'out.html')]);
const gbHtml = readIf(path.join(gbDir, 'out.html'));
ok('profile：frontmatter 标准号 → gb（含封面）',
  rGb.status === 0 && /<section class="cover">/.test(gbHtml) && /GB\/T 99999/.test(gbHtml), `status=${rGb.status}`);
ok('gb：前言不编号，范围从 1 起',
  /<h2[^>]*>前言<\/h2>/.test(gbHtml) && /<h2[^>]*>1 范围<\/h2>/.test(gbHtml));
ok('gb：附录用字母（附录 A 下为 A.1）',
  /<h3[^>]*>A\.1 /.test(gbHtml) && /<h2[^>]*>参考文献<\/h2>/.test(gbHtml));
ok('gb：目次标题为「目次」', /<div class="toc-title">目次<\/div>/.test(gbHtml));

// Paged.js（P3.1，GB 专用分页）：接管分页后才有奇偶页眉 / 分节页码 / 目次真实页码
ok('Paged：gb 渲染注入 Paged.js（仅 gb）', /pagedjs\/paged\.polyfill\.min\.js/.test(gbHtml), 'status=' + rGb.status);
ok('Paged：gb 分页完成标志接线（__md2pdfPagedReady）', /__md2pdfPagedReady/.test(gbHtml) && /__md2pdfPagedReady === true/.test(src));
ok('Paged：gb 目次条目带点线填充（toc-dots）', /class="toc-dots"/.test(gbHtml));
ok('Paged：目次页码用 target-counter 真实填入', /target-counter\(attr\(href\),\s*page/.test(gbHtml));
ok('Paged：前置部分条目用罗马页码（toc-front）', /class="toc-front"/.test(gbHtml));
ok('Paged：前言/引言标记 unnumbered front（各自起新页）', /<h2[^>]*class="[^"]*unnumbered front/.test(gbHtml));
ok('Paged：正文首章标记 body-start（阿拉伯页码重新计数）', /class="[^"]*body-start/.test(gbHtml));
ok('Paged：页眉标准号奇偶分侧（@page :left margin box）', /@page gb-body:left/.test(gbHtml) && /@page gb-front:left/.test(gbHtml));
ok('Paged：gb 不输出文末落款（干扰命名页分页）', !/class="colophon"/.test(gbHtml));
ok('Paged：边距为四值语法（左宽右窄，gb 默认 25/19/20/25）',
  /margin: 25mm 19mm 20mm 25mm/.test(gbHtml));
ok('gb 元数据：结构化字段随 HTML 透传（<meta name="gb:…">）',
  /<meta name="gb:归口单位"/.test(gbHtml) && /<meta name="gb:标准状态"/.test(gbHtml));
// 页码分侧（奇数页靠右/偶数页靠左，仿正式发布版）
ok('页码：gb 页码分侧（奇数页 @bottom-right / 偶数页 @bottom-left）',
  /@page\s+gb-body:right\s*\{\s*@bottom-right\s*\{\s*content:\s*counter\(page\)/.test(gbHtml) &&
  /@page\s+gb-front:left\s*\{\s*@bottom-left\s*\{\s*content:\s*counter\(page,\s*upper-roman\)/.test(gbHtml) &&
  !/@bottom-center\s*\{\s*content:\s*counter/.test(gbHtml));

/* ---------- --paged-html：分页 HTML ---------- */
// CI 无浏览器：用 --html-only 走纯 HTML 路径（--paged-html 的分页注入在 --html-only 下同样生效）
const rPaged = run(['examples/general.md', '--html-only', '--paged-html', '-o', path.join(os.tmpdir(), 'md2pdf-ci-paged.html')]);
const pagedHtml = readIf(path.join(os.tmpdir(), 'md2pdf-ci-paged.html'));
ok('paged-html：产出含 Paged.js 与页码/总页数的分页 HTML',
  rPaged.status === 0 && /paged\.polyfill\.min\.js/.test(pagedHtml) && /counter\(pages\)/.test(pagedHtml),
  'status=' + rPaged.status);
ok('paged-html：gb 样例同样注入 Paged.js',
  (() => {
    const o = path.join(os.tmpdir(), 'md2pdf-ci-paged-gb.html');
    const r = run(['examples/gb.md', '--html-only', '--paged-html', '-o', o]);
    return r.status === 0 && /paged\.polyfill\.min\.js/.test(readIf(o));
  })());

// 封面版式（P3.1b）：GB 标志、横线、小标宋名称字体
ok('封面：gb 引用内置 GB 标志（gb-logo.svg，描迹矢量）', /gb-logo\.svg/.test(gbHtml) && !/gb-logo\.png/.test(gbHtml));
ok('封面：机构块「发布」为独立小字并悬挂于两行名称分界（cover-org-pub）', /cover-org-pub/.test(gbHtml) && /发 布/.test(gbHtml));
ok('封面：标准块下方与机构块上方各有一根横线（cover-rule ×1 + 日期行下边线）',
  (gbHtml.match(/cover-rule/g) || []).length >= 2 && /border-bottom:\s*1pt solid/.test(gbHtml));
ok('封面：标准名称用小标宋（--font-title）', /--font-title/.test(gbHtml) && /var\(--font-title\)/.test(gbHtml));

/* ---------- 5. 端到端渲染（HTML 阶段） ---------- */
const demo = path.join(ROOT, 'examples', 'general.md');
ok('示例文档存在', fs.existsSync(demo) && readIf(demo).length > 100);

if (fs.existsSync(demo)) {
  const outHtml = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'md2pdf-ci-')), 'out.html');
  const r = run(['examples/general.md', '--html-only', '--toc', '--link-urls', '-o', outHtml]);
  ok('渲染：--html-only 执行成功', r.status === 0, (r.stderr || '').trim());
  const html = readIf(outHtml);
  ok('渲染：产出非空 HTML', html.length > 2000, `${html.length} 字节`);
  ok('profile：general.md 自动探测为 general（无技能 kicker）', !/技能文档/.test(html));

  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  ok('渲染：首行 H1 提升为报头标题', !!h1 && h1[1].includes('仿生机械手控制方案'),
    h1 ? h1[1].slice(0, 40) : '无 H1');
  ok('渲染：导语被标记', /class="lead"/.test(html));
  ok('渲染：表格已生成', /<table[\s>]/.test(html));
  ok('渲染：代码块已生成', /<pre><code/.test(html));
  ok('渲染：代码块高亮（hljs）', /class="hljs/.test(html) && /hljs-keyword/.test(html));
  ok('渲染：引用块已生成', /<blockquote>/.test(html));
  ok('渲染：有序与无序列表都在', /<ol>/.test(html) && /<ul>/.test(html));
  ok('渲染：H2 已分节', /<section>/.test(html));
  ok('渲染：--toc 生效', /class="toc"/.test(html));
  ok('渲染：目录项是可点击内链', /<li(?: class="toc-level-[01]")?><a href="#sec-\d+">/.test(html));
  const tocIds = [...html.matchAll(/<a href="#(sec-\d+)"/g)].map(m => m[1]);
  const h2Ids = [...html.matchAll(/<h2 id="(sec-\d+)"/g)].map(m => m[1]);
  ok('渲染：目录锚点与标题 id 一一对应',
    tocIds.length > 1 && tocIds.every(id => h2Ids.includes(id)),
    `目录 ${tocIds.join(',')} → 标题 ${h2Ids.join(',')}`);
  ok('渲染：标题 id 不重复', new Set(h2Ids).size === h2Ids.length);
  ok('渲染：--link-urls 生效', /class="link-url"/.test(html));
  ok('渲染：无占位符残留', !/\{\{[A-Z_]+\}\}/.test(html));
  ok('渲染：非 gb 类型不注入 Paged.js（行为零回归）', !/pagedjs/.test(html));
  ok('封面：非 gb 类型不引用 GB 标志', !/gb-logo\./.test(html));
  ok('gb 元数据：非 gb 类型不透传 gb: meta', !/<meta name="gb:/.test(html));
  ok('渲染：无 undefined/NaN 泄漏', !/undefined|NaN/.test(html));
  ok('渲染：页脚页码模板交给浏览器而非 HTML',
    !/class="pageNumber"/.test(html));
  ok('渲染：数学公式注入 MathJax（demo 含公式）',
    /MathJax/.test(html) && /tex-svg\.js/.test(html));
  ok('数学：MathJax 启用公式编号与引用（tags: all）', /tags:\s*["']all["']/.test(src));
  ok('数学：demo 含公式编号与引用（\\label / \\eqref）',
    /\\label\{eq:/.test(readIf(demo)) && /\\eqref\{eq:/.test(readIf(demo)));
  ok('数学：公式未被 markdown 转义破坏（保留 \\, 与 \\\\）',
    /\\,/.test(html) && /\\\\/.test(html));
  ok('图表：图片自动编号为题注（图 N：…）', /<figcaption>图 \d+：/.test(html));
  ok('图表：表格自动编号为题注（表 N：…）', /<caption>表 \d+：/.test(html));
  ok('图表：\\ref{} 引用解析为编号（无残留命令）', !/\\ref\{/.test(html));
  ok('图表：正文引用为指向图/表的超链接',
    /<a href="#fig-\d+"[^>]*>\d+<\/a>/.test(html) && /<a href="#tab-\d+"[^>]*>\d+<\/a>/.test(html));
  ok('图表：mermaid 代码块转为图并注入 Mermaid', /<pre class="mermaid">/.test(html) && /mermaid\.min\.js/.test(html));
  ok('图表：mermaid 用主题变量（theme: base + themeVariables）',
    /theme:\s*"base"/.test(src) && /themeVariables/.test(src) && /--font-body/.test(src));
  ok('图表：mermaid / 图片 / 矢量图统一编号（≥3 个图）', (html.match(/<figure class="fig"/g) || []).length >= 3);
  ok('图表：矢量图（.svg）纳入编号', /<figure class="fig" id="fig-\d+"><img[^>]*\.svg/.test(html));
  ok('渲染：BibTeX 脚注按 GB/T 7714 渲染（含 [J]/[M]）',
    /\[J\]/.test(html) && /\[M\]/.test(html));
  ok('渲染：脚注引用为可点击上标（fnref → #fn-N）',
    /class="fnref"/.test(html) && /href="#fn-\d+"/.test(html));
  ok('渲染：脚注编号可反向跳回原文（fnref-back → #fnref-N）',
    /class="fnref-back"/.test(html) && /href="#fnref-\d+"/.test(html));

  // 参考文献按正文「首次引用顺序」自动编号（类 LaTeX）：demo 中 Hogan 最先被引，故排在 Åström 前；
  // 且 md2pdf 在 md 里定义在最前，却因最后才被引而排在末尾。
  const refsBlock = html.slice(html.indexOf('参考文献</h2>'));
  const hoganPos = refsBlock.indexOf('Impedance Control');
  const astromPos = refsBlock.indexOf('Feedback Systems');
  ok('参考文献：按正文首次引用顺序编号（Hogan 先于 Åström）',
    hoganPos >= 0 && astromPos >= 0 && hoganPos < astromPos);
  ok('参考文献：定义顺序不影响展示（md2pdf 定义在前、展示在末）',
    refsBlock.indexOf('md2pdf:') > refsBlock.indexOf('机械工程学报'));

  // 章节编号：force 模式为 H2 加层次编号（demo 默认「一、二、三」会被覆盖为「1、2、3」）
  const outNum = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'md2pdf-ci-')), 'num.html');
  const rNum = run(['examples/general.md', '--html-only', '--numbering', 'force', '-o', outNum]);
  const numHtml = readIf(outNum);
  ok('编号：force 模式加层次编号（H2→1/2、H3→2.1）', rNum.status === 0 && /<h2[^>]*>1 总体指标/.test(numHtml) && /<h2[^>]*>2 控制流程/.test(numHtml) && /<h3[^>]*>2\.1 /.test(numHtml));
  ok('编号：auto 模式自动加编号（demo 无编号）', /<h2[^>]*>1 总体指标/.test(html) && /<h3[^>]*>2\.1 /.test(html));
  ok('编号：参考文献章节纳入编号体系', /<h2[^>]*>\d+ 参考文献/.test(html));

  // 编号方案（--number-scheme）：arabic / gb / cjk / chapter
  const outSch = (n) => path.join(os.tmpdir(), 'md2pdf-ci-sch-' + n + '.html');
  const rCjk = run(['examples/general.md', '--html-only', '--numbering', 'force', '--number-scheme', 'cjk', '-o', outSch('cjk')]);
  const cjkHtml = readIf(outSch('cjk'));
  ok('编号：scheme=cjk → 一、/（一）',
    rCjk.status === 0 && /<h2[^>]*>一、总体指标/.test(cjkHtml) && /<h3[^>]*>（一）/.test(cjkHtml),
    `status=${rCjk.status}`);
  const rCh = run(['examples/general.md', '--html-only', '--numbering', 'force', '--number-scheme', 'chapter', '-o', outSch('chapter')]);
  ok('编号：scheme=chapter → 第1章',
    rCh.status === 0 && /<h2[^>]*>第1章 总体指标/.test(readIf(outSch('chapter'))),
    `status=${rCh.status}`);
  const rGb = run(['examples/general.md', '--html-only', '--numbering', 'force', '--number-scheme', 'gb', '-o', outSch('gb')]);
  ok('编号：scheme=gb → 章条点分（与 arabic 同形）',
    rGb.status === 0 && /<h2[^>]*>1 总体指标/.test(readIf(outSch('gb'))),
    `status=${rGb.status}`);
  const rBadSch = run(['examples/general.md', '--html-only', '--numbering', 'force', '--number-scheme', 'nope', '-o', outSch('bad')]);
  ok('编号：未知 --number-scheme 报错且退出非 0',
    rBadSch.status !== 0 && /未知编号方案/.test(rBadSch.stderr || ''),
    `status=${rBadSch.status}`);
}

/* ---------- PDF 书签（outline） ---------- */
// 书签由 Chrome 的 printToPDF 参数生成，CI 里没有浏览器，渲不出 PDF 也就断言不到
// /Outlines 本身 —— 所以这里只钉"接线"（有开关 ≠ 真的接到 main）。
ok('书签：printToPDF 传入 generateDocumentOutline',
  /generateDocumentOutline:\s*true/.test(src));
ok('书签：默认开启，可 --no-outline 关闭',
  /outline:\s*true,/.test(src) && /case '--no-outline': o\.outline = false/.test(src));
ok('书签：开关从 main 传到 chrome.print',
  /outline:\s*opts\.outline\s*[,}]/.test(src),
  '有 --no-outline 分支但没传进渲染，等于没接');
ok('书签：老版本 Chrome 不认参数时退回无书签渲染',
  /generateDocumentOutline: true \}\);[\s\S]{0,320}printToPDF', base\)/.test(src),
  '直接抛错会让老版本 Chrome 上整个转换失败');
ok('书签：帮助文本写明 --no-outline', /--no-outline\s+不生成 PDF 书签/.test(src));

/* ---------- 7. shell 里「多字节字符紧跟裸变量」的坑 ---------- */
// 实测：macOS 自带的 bash 3.2（/bin/sh）会把这个字符的首字节并进变量名 ——
//   sh -c 'R=abc; echo "X：$R（y）"'   →   X：<乱码>y）
// 变量展开成空、还吐出半个字符的字节。相邻处必须写 ${VAR}。
const SHELL_FILES = ['bin/md2pdf', 'ci/validate.sh'];
const bareThenCjk = /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]|\$[0-9@*#?!][^\x00-\x7F]/;
for (const f of SHELL_FILES) {
  const text = readIf(path.join(ROOT, f));
  if (!text) continue;
  const hits = [];
  text.split('\n').forEach((line, i) => {
    const m = bareThenCjk.exec(line);
    if (m) hits.push(`${f}:${i + 1} ${m[0]}`);
  });
  ok(`${path.basename(f)}：非 ASCII 字符前的变量用 \${VAR}`, hits.length === 0,
    hits.join(' | ') + '  → 应写成 ${VAR}');
}

/* ---------- 8. 技能说明书（Agent 那一层的分发） ---------- */
// 技能包只是"说明书"，实现是 CLI —— 两层各自分发。说明书必须随仓库走，
// 否则换了机器装好命令，Agent 仍然不认识它。
const skillMd = readIf(path.join(ROOT, 'skill', 'SKILL.md'));
const installSkill = readIf(path.join(ROOT, 'src', 'install-skill.mjs'));
ok('技能：skill/SKILL.md 存在（说明书随仓库分发）', skillMd.length > 0);
if (skillMd) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd);
  ok('技能：有 YAML frontmatter', !!fm);
  const fmName = fm ? (/^name:\s*(\S+)\s*$/m.exec(fm[1]) || [])[1] : undefined;
  ok('技能：frontmatter name 为 md-to-pdf（与技能目录名一致）',
    fmName === 'md-to-pdf', `name=${fmName}`);
  ok('技能：frontmatter 有 description',
    !!(fm && /^description:\s*\S/m.test(fm[1])));
}
ok('技能：npm 不再自动安装说明书', !pkg.scripts?.postinstall);
ok('技能：显式安装实现随包分发', installSkill.length > 0);
ok('技能：npm 包会把 skill/ 一并发布（files 含 skill）',
  Array.isArray(pkg.files) && pkg.files.includes('skill'),
  'files 不含 skill 的话，装出来的包里没有 SKILL.md，显式安装无源可复制');

/* ---------- 汇总 ---------- */
console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
