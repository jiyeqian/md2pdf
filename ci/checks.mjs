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
const themes = ['elegant', 'minimal'].map(t => path.join(ROOT, 'assets', `theme-${t}.css`));

console.log(`校验目标：${ROOT}`);

/* ---------- 1. 版本号一致 ---------- */
const src = read(srcFile);
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

/* ---------- 5. 端到端渲染（HTML 阶段） ---------- */
const demo = path.join(ROOT, 'examples', 'demo.md');
ok('示例文档存在', fs.existsSync(demo) && readIf(demo).length > 100);

if (fs.existsSync(demo)) {
  const outHtml = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'md2pdf-ci-')), 'out.html');
  const r = run(['examples/demo.md', '--html-only', '--toc', '--link-urls', '-o', outHtml]);
  ok('渲染：--html-only 执行成功', r.status === 0, (r.stderr || '').trim());
  const html = readIf(outHtml);
  ok('渲染：产出非空 HTML', html.length > 2000, `${html.length} 字节`);

  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  ok('渲染：首行 H1 提升为报头标题', !!h1 && h1[1].includes('仿生机械手控制方案'),
    h1 ? h1[1].slice(0, 40) : '无 H1');
  ok('渲染：导语被标记', /class="lead"/.test(html));
  ok('渲染：表格已生成', /<table>/.test(html));
  ok('渲染：代码块已生成', /<pre><code/.test(html));
  ok('渲染：引用块已生成', /<blockquote>/.test(html));
  ok('渲染：有序与无序列表都在', /<ol>/.test(html) && /<ul>/.test(html));
  ok('渲染：H2 已分节', /<section>/.test(html));
  ok('渲染：--toc 生效', /class="toc"/.test(html));
  ok('渲染：目录项是可点击内链', /<li><a href="#sec-\d+">/.test(html));
  const tocIds = [...html.matchAll(/<a href="#(sec-\d+)"/g)].map(m => m[1]);
  const h2Ids = [...html.matchAll(/<h2 id="(sec-\d+)"/g)].map(m => m[1]);
  ok('渲染：目录锚点与标题 id 一一对应',
    tocIds.length > 1 && tocIds.every(id => h2Ids.includes(id)),
    `目录 ${tocIds.join(',')} → 标题 ${h2Ids.join(',')}`);
  ok('渲染：标题 id 不重复', new Set(h2Ids).size === h2Ids.length);
  ok('渲染：--link-urls 生效', /class="link-url"/.test(html));
  ok('渲染：无占位符残留', !/\{\{[A-Z_]+\}\}/.test(html));
  ok('渲染：无 undefined/NaN 泄漏', !/undefined|NaN/.test(html));
  ok('渲染：页脚页码模板交给浏览器而非 HTML',
    !/class="pageNumber"/.test(html));
}

/* ---------- 6. 安装渠道一致 ---------- */
// 安装入口是唯一的分发路径，改仓库地址/接口时最怕文档漂移 —— 这里做双向对齐。
const installSh = readIf(path.join(ROOT, 'install.sh'));
const readme = readIf(path.join(ROOT, 'README.md'));

const repoM = /REPO_URL="\$\{MD2PDF_SRC:-([^}"]+)\}"/.exec(installSh);
ok('安装：install.sh 声明了仓库基址', !!repoM, '未找到 REPO_URL 定义');
if (repoM) {
  const repo = repoM[1];
  ok('安装：通过归档接口下载（/-/git/archive/）',
    installSh.includes('$REPO_URL/-/git/archive/'),
    '注意：网页 /-/raw/ 是 SPA 只返回 HTML 壳，必须用 /-/git/raw/ 或 /-/git/archive/');
  ok('安装：README 的一行安装命令指向同一仓库',
    readme.includes(`${repo}/-/git/raw/`), `期望含 ${repo}/-/git/raw/`);
  ok('安装：README 中的仓库地址与 install.sh 一致',
    readme.includes(repo), repo);
}
ok('安装：远程安装写 .install-meta（--upgrade 的来源记录）',
  /\.install-meta/.test(installSh));
ok('安装：有防误删保护', /拒绝安装到/.test(installSh));
ok('安装：软链不可用时写转发脚本而非复制启动器',
  /转发脚本/.test(installSh),
  '复制的启动器会按自身路径反推项目根，指向错误');
ok('安装：.install-meta 记录命令落点',
  /echo "bin=\$BIN_DIR" >>/.test(installSh),
  '不记的话，升级会重新选目录，用 PREFIX 装的命令就会漂走');
ok('CLI：--upgrade 把命令落点回传为 MD2PDF_BIN_DIR（精确目录）',
  /env\.MD2PDF_BIN_DIR = /.test(src),
  'bin= 记的是精确目录；当 PREFIX 传回去会被再拼一层 /bin，每升级一次多一层');
ok('CLI：--upgrade 不把 bin= 当 PREFIX 传',
  !/env\.PREFIX = meta\.bin/.test(src),
  '这一行是 v1.2.1–v1.3.0 的漂移 bug 根源');
ok('安装：支持 MD2PDF_BIN_DIR 精确落点（且优先于 PREFIX）',
  /if \[ -n "\$MD2PDF_BIN_DIR" \]/.test(installSh) && /BIN_DIR="\$MD2PDF_BIN_DIR"/.test(installSh),
  '没有精确落点的入口，升级只能靠拼前缀，语义必然出错');
ok('安装：PREFIX 语义是「前缀」（命令装在 <dir>/bin）',
  /BIN_DIR="\$PREFIX\/bin"/.test(installSh),
  'PREFIX 不拼 /bin 的话，与 .install-meta 的 bin= 就会混为一谈');
ok('CLI：历史遗留的多层 /bin 会被收敛',
  /function collapseBinSuffix/.test(src) && /collapseBinSuffix\(meta\.bin\)/.test(src),
  '已中招的安装（bin=/usr/local/bin/bin/bin）要能自愈，不能越升越深');
ok('安装：同时支持 curl 与 wget', /curl/.test(installSh) && /wget/.test(installSh));

ok('CLI：帮助文本包含 --upgrade', /--upgrade\s+从安装来源/.test(src));
ok('CLI：--upgrade 有参数解析分支', /case '--upgrade'/.test(src));
ok('CLI：--upgrade 已接到 main（光有 case 不算）',
  /if \(opts\.upgrade\) \{\s*await doUpgrade\(\)/.test(src),
  '必须有 opts.upgrade → doUpgrade() 的调用');
ok('CLI：--upgrade 在非安装目录下会提示 git pull（不静默失败）',
  /git 工作副本/.test(src));

/* ---------- PDF 书签（outline） ---------- */
// 书签由 Chrome 的 printToPDF 参数生成，CI 里没有浏览器，渲不出 PDF 也就断言不到
// /Outlines 本身 —— 所以这里只钉"接线"（有开关 ≠ 真的接到 main）。
ok('书签：printToPDF 传入 generateDocumentOutline',
  /generateDocumentOutline:\s*true/.test(src));
ok('书签：默认开启，可 --no-outline 关闭',
  /outline:\s*true,/.test(src) && /case '--no-outline': o\.outline = false/.test(src));
ok('书签：开关从 main 传到 chrome.print',
  /outline:\s*opts\.outline\s*\}/.test(src),
  '有 --no-outline 分支但没传进渲染，等于没接');
ok('书签：老版本 Chrome 不认参数时退回无书签渲染',
  /generateDocumentOutline: true \}\);[\s\S]{0,160}printToPDF', base\)/.test(src),
  '直接抛错会让老版本 Chrome 上整个转换失败');
ok('书签：帮助文本写明 --no-outline', /--no-outline\s+不生成 PDF 书签/.test(src));

/* ---------- 7. shell 里「多字节字符紧跟裸变量」的坑 ---------- */
// 实测：macOS 自带的 bash 3.2（/bin/sh）会把这个字符的首字节并进变量名 ——
//   sh -c 'R=abc; echo "X：$R（y）"'   →   X：<乱码>y）
// 变量展开成空、还吐出半个字符的字节。相邻处必须写 ${VAR}。
const SHELL_FILES = ['install.sh', 'uninstall.sh', 'bin/md2pdf', 'ci/validate.sh'];
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
ok('技能：skill/SKILL.md 存在（说明书随仓库分发）', skillMd.length > 0);
if (skillMd) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd);
  ok('技能：有 YAML frontmatter', !!fm);
  const fmName = fm ? (/^name:\s*(\S+)\s*$/m.exec(fm[1]) || [])[1] : undefined;
  ok('技能：frontmatter name 为 md-to-pdf（与技能目录名一致）',
    fmName === 'md-to-pdf', `name=${fmName}`);
  ok('技能：frontmatter 有 description',
    !!(fm && /^description:\s*\S/m.test(fm[1])));
  ok('技能：install.sh 会把它装进技能目录',
    /skill\/SKILL\.md/.test(installSh) && /skills\/md-to-pdf/.test(installSh),
    '期望 install.sh 同时引用 skill/SKILL.md 与 skills/md-to-pdf');
  ok('技能：install.sh 提供 MD2PDF_SKILL 开关与 MD2PDF_SKILL_DIR 落点',
    /\$\{MD2PDF_SKILL:-/.test(installSh) && /MD2PDF_SKILL_DIR/.test(installSh));
  ok('技能：说明书里的一行安装命令指向同一仓库',
    repoM ? skillMd.includes(`${repoM[1]}/-/git/raw/`) : false,
    repoM ? `期望含 ${repoM[1]}/-/git/raw/` : '');
  ok('技能：install.sh 把技能目录写进 .install-meta',
    /echo "skill=\$SKILL_DIR" >>/.test(installSh),
    '不记下来的话 --upgrade 不知道技能该更新到哪');
  ok('技能：--upgrade 会把技能目录传回安装脚本',
    /env\.MD2PDF_SKILL_DIR = meta\.skill/.test(src),
    '缺这一步，升级后技能会停在旧版（或被装到默认位置）');
}

/* ---------- 汇总 ---------- */
console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
