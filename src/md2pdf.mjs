#!/usr/bin/env node
/**
 * md2pdf —— 把 Markdown 排成优雅的 A4 PDF（无头 Chrome + CDP）
 *
 * 用法：md2pdf <file.md> [file2.md ...] [选项]
 *
 * 选项：
 *   -o, --output <path>   输出路径（多文件时为输出目录）
 *       --theme <name>    elegant（默认）| minimal
 *       --title <text>    覆盖标题（默认取 frontmatter.title，其次正文首个 H1，其次文件名）
 *       --kicker <text>   报头小标题（如"专利实务 · 技能文档"）
 *       --enable <names>  开启功能（逗号分隔）
 *       --disable <names> 关闭功能（如 meta,lead）
 *   -t, --toc             生成目录（取自 H2）
 *       --enable link-urls 正文链接后附 URL
 *       --enable landscape 横向页面
 *       --font-size <pt>  正文字号，默认 10.5
 *       --margin <mm>     页边距，默认 20（上下同为 18/20，左右同值）；可写 "20,18"
 *       --disable footer  不输出整个页脚
 *       --footer-left  <text>   页脚左文字（默认空）
 *       --footer-right <text>   页脚右文字（默认空）
 *       --footer-center <text> 页脚中间文字（默认页码）
 *       --colophon <text> 文末左侧落款（默认仓库口号，右侧为生成时间）
 *       --bibliography-title <text> 参考文献章节标题
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
const VERSION = '1.15.2';

const HELP = `
md2pdf ${VERSION} — Markdown 转 PDF

用法
  md2pdf <文件...> [选项]
  md2pdf webapp [--port <端口>]  默认 3000，仅本机访问
  md2pdf skill install --help   查看具体用法

选项
  -o, --output <路径>        输出路径，默认与输入同目录、同名 .pdf
      --type <名称>          模板类型：${PROFILE_NAMES.join('、')}；默认自动识别
      --theme <名称>         主题：elegant、minimal；默认 elegant
      --title <文字>         文档标题
      --kicker <文字>        报头小标题
      --font-size <pt>       正文字号，默认 10.5
      --line-height <倍数>   正文行距，默认 1.9
      --margin <mm>          页边距，支持“上下,左右”
      --numbering <模式>     章节编号：auto、force、none；默认 auto
      --number-scheme <名称> 编号方案：${SCHEME_NAMES.join('、')}；默认 arabic
  -t, --toc                  显示目录
      --toc-depth <层级>     目录深度：1、2；默认 1
      --header-{left,center,right} <文字>
      --footer-{left,center,right} <文字>
      --colophon-{left,center,right} <文字>
      --bibliography-title <文字>
                             参考文献标题，默认“参考文献”
      --enable/disable <功能列表>
                             启用/禁用功能
                             启用/禁用多项功能，以英文逗号分隔，候选功能：
                             header、footer、colophon、meta、lead、toc、
                             outline、float-numbering、link-urls、landscape、
                             gb-cover、gb-defaults
      --open                 生成后打开 PDF
      --keep-html            保留中间 HTML
      --paged-html [路径]    输出分页 HTML，默认与输入同名 .html
      --html-only            仅生成 HTML
  -h, --help                 显示帮助
  -v, --version              显示版本

规则
  配置优先级：命令行 → frontmatter → 模板默认 → 全局默认。
  文档配置也可写入 frontmatter；同层矛盾配置报错。
  文字参数必须有值；"" 表示清空，不再继承低优先级配置。
  {left,center,right} 表示三个独立选项，如 --header-left。
  --enable/disable 表示 --enable 或 --disable。
  页眉、页脚、落款默认启用；导语默认关闭。
  页眉默认空且不占空间，页脚默认居中页码，落款默认左侧品牌、右侧生成时间。
  参考文献自动生成；国标模板遵循固定版式。

示例
  md2pdf notes.md
  md2pdf notes.md --theme minimal --enable toc --open
  md2pdf notes.md --header-left "内部资料" --disable lead
  md2pdf a.md b.md -o ./output/
  md2pdf webapp --port 8765
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

// 统一的错误输出：ConfigError 带 frontmatter 行号，其余给可读消息；不写任何无效输出。
function reportConfigError(e, input) {
  const errs = e && Array.isArray(e.configErrors) ? e.configErrors : null;
  if (errs && errs.length) {
    for (const c of errs) {
      const loc = [input, c && c.line, c && c.column].filter(v => v !== undefined && v !== null && v !== '').join(':');
      console.error(`✗ ${loc ? loc + ' ' : ''}${(c && c.message) || '配置无效'}`);
    }
    return;
  }
  console.error(`✗ ${input ? input + '：' : ''}${e.message}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'webapp') { const { runWebapp } = await import('./webapp.mjs'); await runWebapp(args.slice(1)); return; }
  if (args[0] === 'skill') { await installSkill(args.slice(1)); return; }
  let opts;
  try { opts = parseArgs(expandArgs(args)); }
  catch (e) { reportConfigError(e); process.exitCode = 1; return; }
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
        reportConfigError(e, input);
        failed = true;
      }
    }
  } finally {
    if (chrome) await chrome.stop();
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
  if (failed) process.exitCode = 1;
}

main().catch(e => { reportConfigError(e); process.exit(1); });
