import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { render } from '../src/render.mjs';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';
import { buildStatic } from '../src/static-build.mjs';

const out = path.resolve(process.env.MD2PDF_ACCEPTANCE_DIR || path.join(os.tmpdir(), 'md2pdf-minimal-theme-review'));
const temp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-minimal-'));
const app = createApp();
const chrome = new Chrome(findChrome(), temp);
const nativeFetch = globalThis.fetch;
const md = `---
title: 简洁主题 · 排版对照
theme: minimal
numbering: none
toc: true
---
# 简洁主题 · 排版对照

保留 Markdown 的结构，用字号、字重和留白表达层次。

## 正文与列表

这是**加粗**、*斜体*、~~删除线~~、\`行内代码\`和[链接](https://example.com)。

3. 从三开始
4. 下一项
   - 嵌套条目
   - 另一条目

- 普通条目
- [x] 已完成
- [ ] 待处理

> 引用保留一条细灰线，与正文保持区分。

## 表格与代码

| 项目 | 数值 |
| --- | ---: |
| 第一行 | 42 |
| 第二行 | 64 |
| 第三行 | 86 |

\`\`\`js
const message = "简洁";
console.log(message);
\`\`\`

---

保留公式 $E=mc^2$ 与脚注引用[^note]。

[^note]: 脚注正文保留引用和返回链接。
`;
const normalize = html => html.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}/g, 'GENERATED_AT');
const evaluate = async expression => {
  const result = await chrome.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
try {
  await mkdir(out, { recursive: true });
  const build = await buildStatic();
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    return url.protocol === 'file:' ? new Response(await readFile(url)) : nativeFetch(input, init);
  };
  const staticRuntime = await import(pathToFileURL(path.join(build.directory, 'runtime.mjs')));
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  await writeFile(path.join(out, 'sample.md'), md);
  await chrome.start();
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 1200, deviceScaleFactor: 1, mobile: false });
  let minimalBody;
  for (const theme of ['minimal', 'elegant']) {
    const source = md.replace('theme: minimal', `theme: ${theme}`);
    const opts = { type: 'general', theme };
    const core = await render(source, { ...opts, pagedHtml: true }, { webSafe: true });
    const body = /<main>([\s\S]*?)<\/main>/.exec(core.html)[1];
    if (theme === 'minimal') minimalBody = body;
    else assert.equal(body, minimalBody, 'theme changes preserve Markdown structure');
    const online = await (await nativeFetch(base + '/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ md: source, opts }) })).json();
    const offline = await (await staticRuntime.appFetch('/api/render', { body: JSON.stringify({ md: source, opts }) })).json();
    assert.equal(normalize(offline.html), normalize(online.html), `${theme}: static and server preview match`);
    const input = path.join(temp, theme + '.md');
    const cliHtml = path.join(out, theme + '-cli.html');
    await writeFile(input, source);
    execFileSync(process.execPath, ['src/md2pdf.mjs', input, '--html-only', '--type', 'general', '--theme', theme, '--paged-html=', '-o', cliHtml], { stdio: 'pipe' });
    assert.equal(normalize((await readFile(cliHtml, 'utf8')).replaceAll('&amp;', '&')), normalize(core.pagedHtml.replaceAll('&amp;', '&')), `${theme}: CLI and core HTML match`);
    await writeFile(path.join(out, theme + '.html'), online.html);
    await writeFile(path.join(out, theme + '.pdf'), await chrome.printHtml(online.html, { webSafe: true, waitPaged: true, outline: true }));
    await evaluate(`new Promise(resolve=>{const check=()=>document.getElementById('md2pdf-preview-screen')?document.fonts.ready.then(resolve):setTimeout(check,50);check()})`);
    if (theme === 'minimal') {
      const styles = await evaluate(`(()=>{const root=document.querySelector('.pagedjs_pages');const get=s=>getComputedStyle(root.querySelector(s));return {h2Border:get('h2').borderBottomStyle,h2Padding:get('h2').paddingLeft,em:get('em').fontStyle,ol:get('main ol:not(.references)').listStyleType,ul:get('main ul').listStyleType,start:root.querySelector('main ol').start,marker:getComputedStyle(root.querySelector('main ol li'),'::before').display,toc:get('.toc').borderTopStyle,code:get('pre').borderTopStyle,codeRadius:get('pre').borderRadius,row:get('tbody tr:nth-child(even)').backgroundColor,quote:get('blockquote').borderLeftWidth,checks:root.querySelectorAll('input[type=checkbox]').length,checked:root.querySelectorAll('input:checked').length,taskMarker:getComputedStyle(root.querySelector('input[type=checkbox]').parentElement).listStyleType,math:root.querySelectorAll('mjx-container').length}})()`);
      assert.deepEqual(styles, { h2Border: 'none', h2Padding: '0px', em: 'italic', ol: 'decimal', ul: 'disc', start: 3, marker: 'none', toc: 'solid', code: 'solid', codeRadius: '4px', row: 'rgba(0, 0, 0, 0)', quote: '3px', checks: 2, checked: 1, taskMarker: 'none', math: 1 });
      const details = await evaluate(`(()=>{const root=document.querySelector('.pagedjs_pages'),css=s=>getComputedStyle(root.querySelector(s));const items=Array.from(root.querySelectorAll('main ul > li')).filter(li=>!li.parentElement.closest('li'));const task=root.querySelector('input[type=checkbox]');return {inlineBorder:css('p code').borderTopWidth,inlineRadius:css('p code').borderRadius,codeInnerBorder:css('pre code').borderTopWidth,tocBackground:css('.toc').backgroundColor,headerTop:css('thead th').borderTopWidth,headerBottom:css('thead th').borderBottomWidth,bodyRule:css('tbody td').borderBottomWidth,tableBottom:css('table').borderBottomWidth,ruleColors:[css('thead th').borderTopColor,css('thead th').borderBottomColor,css('table').borderBottomColor],listLefts:items.map(li=>li.getBoundingClientRect().left),taskPosition:getComputedStyle(task).position,taskLeft:task.getBoundingClientRect().left,taskTextLeft:task.parentElement.getBoundingClientRect().left}})()`);
      assert.equal(details.inlineBorder, '1px');
      assert.equal(details.inlineRadius, '3px');
      assert.equal(details.codeInnerBorder, '0px');
      assert.equal(details.tocBackground, 'rgb(246, 246, 246)');
      assert.equal(details.headerTop, '2px');
      assert.equal(details.headerBottom, '1px');
      assert.equal(details.bodyRule, '0px');
      assert.equal(details.tableBottom, '2px');
      assert.deepEqual(details.ruleColors, ['rgb(184, 184, 184)', 'rgb(184, 184, 184)', 'rgb(184, 184, 184)']);
      assert.ok(details.listLefts.every(left=>Math.abs(left-details.taskTextLeft)<1),'task and unordered list text share the same left edge');
      const gaps = await evaluate(`(()=>{const table=document.querySelector('.pagedjs_pages table'),cells=Array.from(table.querySelectorAll('tbody tr')).map(row=>row.cells[0]);const text=cells.map(cell=>{const range=document.createRange();range.selectNodeContents(cell);return range.getBoundingClientRect()});return [text[0].top-table.querySelector('thead').getBoundingClientRect().bottom,...text.slice(1).map((r,i)=>r.top-text[i].bottom),table.getBoundingClientRect().bottom-text.at(-1).bottom]})()`);
      assert.ok(Math.max(...gaps)-Math.min(...gaps)<2,`table text gaps are balanced: ${gaps}`);
      console.log(`minimal table whitespace (px): ${gaps.map(gap=>gap.toFixed(1)).join(', ')}`);
      assert.equal(details.taskPosition, 'absolute');
      assert.ok(details.taskLeft<details.taskTextLeft,'checkbox occupies the marker column');
    }
    const clip = await evaluate(`(()=>{const r=document.querySelector('.pagedjs_page').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()`);
    const screenshot = await chrome.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
    await writeFile(path.join(out, theme + '.png'), Buffer.from(screenshot.data, 'base64'));
    console.log(`${theme}: CLI HTML, server/static preview, PDF and first-page screenshot passed`);
  }
  const longList = '# 跨页编号\n\n' + Array.from({ length: 60 }, (_, i) => `${i + 3}. 项目 ${i + 3}：跨页编号检查`).join('\n');
  const longPreview = await (await nativeFetch(base + '/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ md: longList, opts: { theme: 'minimal', numbering: 'none' } }) })).json();
  await chrome.printHtml(longPreview.html, { webSafe: true, waitPaged: true });
  const listPages = await evaluate(`Array.from(document.querySelectorAll('.pagedjs_pages main ol')).map(list=>({start:list.start,text:list.querySelector('li')?.textContent}))`);
  assert.ok(listPages.length > 1, 'ordered list spans multiple pages');
  for (const page of listPages) assert.equal(page.start, Number(/项目 (\d+)/.exec(page.text)[1]), 'native list numbering continues across pages');
  console.log('minimal: ordered list starts at 3 and continues across pages');
  console.log(`Review artifacts: ${out}`);
} finally {
  globalThis.fetch = nativeFetch;
  await chrome.stop();
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
