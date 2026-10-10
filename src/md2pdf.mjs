#!/usr/bin/env node
/**
 * md2pdf —— 把 Markdown 排成优雅的 A4 PDF（无头 Chrome + CDP）
 *
 * 用法：md2pdf <file.md> [file2.md ...] [选项]
 *
 * 选项：
 *   -o, --output <path>   输出 PDF（单文件时可用；多文件时忽略）
 *       --theme <name>    elegant（默认）| minimal
 *       --title <text>    覆盖标题（默认取正文首个 H1，其次 frontmatter.title，其次文件名）
 *       --kicker <text>   报头小标题（如"专利实务 · 技能文档"）
 *       --no-meta         不生成元信息条
 *       --no-lead         首段不作为导语放大
 *   -t, --toc             生成目录（取自 H2）
 *       --link-urls       正文链接后附 URL
 *       --landscape       横向页面
 *       --font-size <pt>  正文字号，默认 10.5
 *       --margin <mm>     页边距，默认 20（上下同为 18/20，左右同值）；可写 "20,18"
 *       --no-footer       不输出页脚页码
 *       --footer-left  <text>   页脚左文字（默认空）
 *       --footer-right <text>   页脚右文字（默认空）
 *       --colophon <text> 文末落款（默认：来源文件名）
 *       --keep-html       保留中间 HTML，便于调样式
 *       --open            完成后打开 PDF
 *   -h, --help
 *
 * 环境变量：
 *   MD2PDF_CHROME  指定 Chrome/Edge/Chromium 可执行文件路径
 *   MD2PDF_WS=mini 强制使用内置 WebSocket 实现（Node < 22 时自动启用）
 */

import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { installSkill } from './install-skill.mjs';
import { PROFILE_NAMES } from './profiles.mjs';
import { SCHEME_NAMES } from './numbering.mjs';
import { parseArgs, expandArgs } from './options.mjs';
import { render } from './render.mjs';
import { Chrome, findChrome } from './chrome.mjs';
const VERSION = '1.14.4';

const HELP = `
md2pdf ${VERSION} —— Markdown → 优雅 PDF

  md2pdf <file.md> [file2.md ...] [选项]
  md2pdf webapp [--port <端口>]（默认 3000，仅本机访问）
  md2pdf skill install --target <codex|workbuddy|codebuddy|claude|agents> [--force]
  md2pdf skill install --dir <技能目录> [--force]

选项：
  -o, --output <path>      输出路径（默认与输入同目录同名 .pdf）
      --theme <name>       elegant（默认，墨蓝+古铜）| minimal（黑白公文）
      --type <name>       文档类型（默认自动探测）：${PROFILE_NAMES.join('|')}
      --title <text>       覆盖标题
      --kicker <text>      报头小标题
      --no-float-numbering 不为源图像/表格添加自动编号和题注
      --no-gb-cover        不生成 GB 封面（使用原始封面图或无封面文件）
      --no-gb-defaults     GB 封面缺失字段保持空白，不补默认机构或类别
      --no-meta            不生成元信息条
      --no-lead            首段不作为导语
  -t, --toc                在文首插入目录页（取自二级标题，可点击跳转）
      --no-outline         不生成 PDF 书签（默认生成，阅读器侧边栏按标题成树）
      --bibliography [footnote|bib]  将脚注收集为「参考文献」章节（默认 footnote；bib 为未来支持）
      --numbering <mode>    章节编号：auto（默认，识别到已有编号则不动）| force（强制）| none（不加）
      --number-scheme <n>  编号方案：${SCHEME_NAMES.join('|')}（默认 arabic）；配合 --numbering force 使用
      --link-urls          正文链接后附 URL
      --landscape          横向
      --font-size <pt>     正文字号（默认 10.5）
      --margin <mm>        页边距（默认 20；可写 "20,18" = 上下,左右；gb 类型默认 25/20/25/19）
      --no-footer          不要页脚页码
      --footer-left/--footer-right <text>
      --colophon <text>    文末落款
      --keep-html          保留中间 HTML
      --paged-html [path]  输出分页 HTML：浏览器打开与 PDF 同款分页/页码
                           （Paged.js；gb 类型含封面/奇偶页眉；缺省路径 = 同名 .html）
      --html-only          只生成 HTML，不启动浏览器（调试样式 / CI 校验用）
      --open               完成后打开 PDF
  -h, --help

示例：
  md2pdf SKILL.md
  md2pdf notes.md --theme minimal --toc --open
  md2pdf a.md b.md -o /tmp/   # 多文件时 -o 视为输出目录
`;

async function renderOne(mdPath, opts, chrome, tmpRoot) {
  const res = await render(await readFile(mdPath, 'utf8'), opts, { filename: mdPath });
  if (opts.htmlOnly) return { ...res, html: res.pagedHtml ?? res.html };
  const tmpDir = await mkdtemp(path.join(tmpRoot, 'doc-'));
  const htmlPath = path.join(tmpDir, 'index.html');
  try {
    await writeFile(htmlPath, res.html, 'utf8');
    const buf = await chrome.print(htmlPath, res.printOptions);
    if (opts.keepHtml) await writeFile(mdPath.replace(/\.md$/i, '.html'), res.html, 'utf8');
    if (opts.pagedHtml && res.pagedHtml) {
      const pagedPath = opts.pagedHtmlPath || mdPath.replace(/\.md$/i, '.html');
      await mkdir(path.dirname(pagedPath), { recursive: true });
      await writeFile(pagedPath, res.pagedHtml, 'utf8');
    }
    return { title: res.title, buf, type: res.type };
  } finally { await rm(tmpDir, { recursive: true, force: true }); }
}

/* ---------------- main ---------------- */

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function resolveOutput(mdPath, opts) {
  const ext = opts.htmlOnly ? '.html' : '.pdf';
  if (!opts.output) return mdPath.replace(/\.md$/i, ext);
  const o = path.resolve(opts.output);
  if (opts.inputs.length > 1 || isDir(o) || o.endsWith(path.sep)) {
    return path.join(o, path.basename(mdPath, path.extname(mdPath)) + ext);
  }
  return o;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'webapp') { const { runWebapp } = await import('./webapp.mjs'); await runWebapp(args.slice(1)); return; }
  if (args[0] === 'skill') { await installSkill(args.slice(1)); return; }
  const opts = parseArgs(expandArgs(args));
  if (opts.help) { console.log(HELP); return; }
  if (opts.version) { console.log(VERSION); return; }
  if (!opts.inputs.length) { console.log(HELP); process.exitCode = 1; return; }

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-'));
  // --html-only 不需要浏览器（CI / 调样式时用）
  const chrome = opts.htmlOnly ? null : new Chrome(findChrome(), tmpRoot);
  let failed = false;
  try {
    if (chrome) await chrome.start();
    for (const input of opts.inputs) {
      const mdPath = path.resolve(input);
      if (!existsSync(mdPath)) { console.error(`✗ 找不到文件：${input}`); failed = true; continue; }
      try {
        const res = await renderOne(mdPath, opts, chrome, tmpRoot);
        const out = resolveOutput(mdPath, opts);
        await mkdir(path.dirname(out), { recursive: true });
        if (opts.htmlOnly) {
          await writeFile(out, res.html, 'utf8');
          console.log(`✓ ${path.basename(out)}  (HTML ${(res.html.length / 1024).toFixed(0)} KB，type=${res.type})`);
          continue;
        }
        const buf = res.buf;
        await writeFile(out, buf);
        let pages = '';
        const info = spawnSync('pdfinfo', [out], { encoding: 'utf8' });
        if (info.status === 0) {
          const m = /Pages:\s+(\d+)/.exec(info.stdout);
          if (m) pages = `，${m[1]} 页`;
        }
        console.log(`✓ ${path.basename(out)}  (${(buf.length / 1024).toFixed(0)} KB${pages}，type=${res.type})`);
        if (opts.open) {
          const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
          spawn(cmd, [out], { stdio: 'ignore' });
        }
      } catch (e) {
        console.error(`✗ ${input}：${e.message}`);
        failed = true;
      }
    }
  } finally {
    if (chrome) await chrome.stop();
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('md2pdf 失败：', e.message); process.exit(1); });
