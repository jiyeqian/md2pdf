import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Chrome, findChrome } from '../src/chrome.mjs';
import { render } from '../src/render.mjs';
import { createApp } from '../src/server.mjs';
import { buildStatic } from '../src/static-build.mjs';

// Deliberately save the rendered inputs, PDF and measurements for human review.
const out = '/private/tmp/md2pdf-gb-ef-review';
const temp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-gb-ef-'));
const nativeFetch = globalThis.fetch;
const app = createApp();
const chrome = new Chrome(findChrome(), temp);
const normalize = html => html.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}/g, 'GENERATED_AT').replaceAll('&amp;', '&').replace(/ data-md2pdf-source-line="\d+"/g,'');
const evaluate = async expression => {
  const result = await chrome.send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const run = (command, args) => execFileSync(command, args, { encoding:'utf8', maxBuffer:16 * 1024 * 1024 });
const near = (actual, expected, tolerance, what) => assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual}, expected ${expected} ± ${tolerance}`);
const px = mm => mm * 96 / 25.4;
const pt = size => size * 96 / 72;

try {
  await mkdir(out, { recursive:true });
  const md = await readFile(new URL('./fixtures/gb-ef.md', import.meta.url), 'utf8');
  const input = path.join(out, 'gb-ef.md');
  await writeFile(input, md);
  const build = await buildStatic();
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    return url.protocol === 'file:' ? new Response(await readFile(url)) : nativeFetch(input, init);
  };
  const staticRuntime = await import(pathToFileURL(path.join(build.directory, 'runtime.mjs')));
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const opts = { type:'gb' };
  const core = await render(md, { ...opts, pagedHtml:true }, { webSafe:true });
  const body = JSON.stringify({ md, opts });
  const nodeResponse = await nativeFetch(base + '/api/render', { method:'POST', headers:{'Content-Type':'application/json'}, body });
  const staticResponse = await staticRuntime.appFetch('/api/render', { body });
  assert.equal(nodeResponse.status, 200, await nodeResponse.clone().text());
  assert.equal(staticResponse.status, 200, await staticResponse.clone().text());
  const node = await nodeResponse.json();
  const offline = await staticResponse.json();
  assert.equal(normalize(node.html), normalize(offline.html), 'Node/static HTML');
  assert.equal(normalize(/<main>([\s\S]*?)<\/main>/.exec(core.html)[1]), normalize(/<main>([\s\S]*?)<\/main>/.exec(node.html)[1]), 'core/Node body');
  const cliHtml = path.join(out, 'gb-ef-cli.html');
  execFileSync(process.execPath, ['src/md2pdf.mjs', input, '--html-only', '--type', 'gb', '--paged-html=', '-o', cliHtml], { stdio:'pipe' });
  assert.equal(normalize(await readFile(cliHtml, 'utf8')), normalize(core.pagedHtml), 'CLI/core paged HTML');
  await writeFile(path.join(out, 'gb-ef-node.html'), node.html);
  await writeFile(path.join(out, 'gb-ef-static.html'), offline.html);

  await chrome.start();
  const sources = [
    ['cli', () => chrome.print(cliHtml, { ...core.printOptions, waitPaged:true })],
    ['node', async () => { const response = await nativeFetch(base + '/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body}); assert.equal(response.status,200, 'Node PDF endpoint'); return Buffer.from(await response.arrayBuffer()); }],
    ['static', async () => { const document = await staticRuntime.renderDocument({md,opts},false); return chrome.printHtml(document.html,{...core.printOptions,webSafe:true,waitPaged:true}); }],
  ];
  const extracted = [];
  for (const [name, print] of sources) {
    const pdfPath = path.join(out, `gb-ef-${name}.pdf`);
    await writeFile(pdfPath, await print());
    const info = run('pdfinfo', [pdfPath]);
    const size = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info);
    assert.ok(size, `${name}: PDF size`);
    near(+size[1],210/25.4*72,1,`${name}: A4 width`);
    near(+size[2],297/25.4*72,1,`${name}: A4 height`);
    const fonts = run('pdffonts', [pdfPath]);
    for (const font of ['FZSSK--GBK1-0','FZHTK--GBK1-0','FZXBSK--GBK1-0']) assert.ok(fonts.includes(font), `${name}: embedded ${font}`);
    assert.ok(fonts.split('\n').filter(line=>line.includes('--GBK1-0')).every(line=>/yes\s+yes\s+yes/.test(line)), `${name}: required font subsets embedded`);
    await writeFile(path.join(out, `gb-ef-${name}-fonts.txt`), fonts);
    const text = run('pdftotext', ['-layout', pdfPath, '-']);
    await writeFile(path.join(out, `gb-ef-${name}.txt`), text);
    extracted.push(text);
    for (const marker of ['FOREWORD_MARK', 'INTRO_MARK', 'BODY_START', 'FOOTNOTEMARK', 'NOTE_MARK', 'EXAMPLE_MARK', 'TABLE_NOTE_MARK', 'APPENDIX_MARK', 'INDEX_MARK','IMPORTANTMARK','FIGURENOTEMARK','FIGUREFOOTMARK','TABLEFOOTMARK']) {
      assert.ok(text.includes(marker), `${name}: missing ${marker}`);
    }
    const pages = text.split('\f').filter(p => p.trim());
    const bodyPage = pages.findIndex(p => p.includes('BODY_START'));
    assert.ok(bodyPage > 0 && (bodyPage + 1) % 2 === 1, `${name}: body starts on a physical odd page`);
    const contents = pages.find(p => p.includes('目') && p.includes('次') && p.includes('范围'));
    assert.ok(contents, `${name}: contents page`);
    assert.match(contents, /前言[^\n]*\b[IVXLCDM]+\b/, `${name}: contents Roman page`);
    assert.match(contents, /范围[^\n]*\b1\s*$/m, `${name}: contents body page 1`);
    assert.match(pages[bodyPage], /(?:^|\n)\s*1\s*(?:\n|$)/, `${name}: body footer starts at 1`);
  }
  assert.equal(extracted[0], extracted[1], 'CLI/Node PDF extracted text and pagination');
  assert.equal(extracted[1], extracted[2], 'Node/static PDF extracted text and pagination');

  await chrome.send('Emulation.setEmulatedMedia', {media:'print'});
  // The last print leaves the static preview DOM available for actual computed-style checks.
  const state = await evaluate(`(() => {
    const pages = [...document.querySelectorAll('.pagedjs_page')];
    const zoom = pages[0].getBoundingClientRect().width / pages[0].offsetWidth;
    const rect = e => { const r = e.getBoundingClientRect(); return {x:r.x/zoom,y:r.y/zoom,width:r.width/zoom,height:r.height/zoom,right:r.right/zoom,bottom:r.bottom/zoom}; };
    const style = e => ({size:parseFloat(getComputedStyle(e).fontSize),family:getComputedStyle(e).fontFamily});
    const firstText = (root, tag, text) => [...root.querySelectorAll(tag)].find(e => e.textContent.trim().includes(text));
    return {
      error:window.__md2pdfPagedError || null,
      cover:Object.fromEntries(['head','stdno','sup','rule','date-rule','org-names','org-pub'].map(name=>[name,rect(document.querySelector('.pagedjs_pages .cover-'+name))])),
      publish:[...document.querySelectorAll('.pagedjs_pages .cover-org-pub > span')].map(rect),
      pages:pages.map((p,i) => ({number:i+1,blank:p.classList.contains('pagedjs_blank_page'),name:p.className,
        box:rect(p.querySelector('.pagedjs_pagebox') || p),area:rect(p.querySelector('.pagedjs_area')),
        text:p.querySelector('.pagedjs_page_content')?.innerText || '',
        header:p.querySelector('.gb-fixed-header') && {text:p.querySelector('.gb-fixed-header').textContent,box:rect(p.querySelector('.gb-fixed-header')),...style(p.querySelector('.gb-fixed-header'))},
        footer:p.querySelector('.gb-fixed-page-number') && {text:p.querySelector('.gb-fixed-page-number').textContent,box:rect(p.querySelector('.gb-fixed-page-number')),...style(p.querySelector('.gb-fixed-page-number'))},
        margins:[...p.querySelectorAll('.pagedjs_margin-content')].map(e => ({text:e.innerText,after:getComputedStyle(e,'::after').content,visibility:getComputedStyle(e).visibility})),
        tables:[...p.querySelectorAll('table')].map(t => ({head:t.tHead?.innerText || '',rows:[...t.querySelectorAll('tbody tr')].map(r=>r.innerText)}))})),
      endLine:(()=>{const e=document.querySelector('.pagedjs_pages .gb-end-line');return e&&{box:rect(e),page:pages.indexOf(e.closest('.pagedjs_page'))+1,previous:e.previousElementSibling?.textContent};})(),
      back:(()=>{const e=document.querySelector('.pagedjs_pages .gb-back-standard');return e&&{box:rect(e),size:style(e).size};})(),
      toc:[...document.querySelectorAll('.pagedjs_pages .toc a')].map(a=>({text:a.innerText,href:a.getAttribute('href')})),
      semantic:Object.fromEntries(['term-number','term-name','term-definition','note','example','source','unit','subfigure','table-note'].map(name=>{const e=document.querySelector('.pagedjs_pages .gb-'+name); return [name,e&&{text:e.innerText,html:e.innerHTML,...style(e)}]})),
      index:(()=>{const e=document.querySelector('.pagedjs_pages .gb-index-entries li');return e&&{marker:getComputedStyle(e,'::before').display,term:rect(e.querySelector('.gb-index-term')),dots:rect(e.querySelector('.gb-index-dots')),area:rect(e.closest('.pagedjs_area'))};})(),
      diagram:(()=>{const e=document.querySelector('.pagedjs_pages .fig svg .nodeLabel');return e&&style(e);})(),
      styles:{title:style(document.querySelector('.pagedjs_pages .gb-body-title')), body:style(firstText(document,'.pagedjs_pages p','BODY_START')),
        chapter:style(firstText(document,'.pagedjs_pages h2','范围')),
        toc:style(document.querySelector('.pagedjs_pages .toc-title')),
        preface:style(firstText(document,'.pagedjs_pages h2','前言')),
        reference:style(firstText(document,'.pagedjs_pages h2','参考文献'))}
    };
  })()`);
  await writeFile(path.join(out, 'gb-ef-browser.json'), JSON.stringify(state, null, 2));
  assert.equal(state.error, null, 'Paged.js completed');
  // Cover geometry is tested against PDF ink in gb-cover-e5-checks.mjs;
  // line boxes no longer represent the annotated character edges.
  assert.ok(state.pages.at(-1).name.includes('gb-back-cover'), 'back cover is the last sheet, without a trailing empty page');
  assert.ok(state.pages.length >= 7, 'covers front matter, multi-page body and back matter');
  assert.equal(state.index.marker,'none','index has no list marker');
  near(state.index.term.x,state.index.area.x,1,'index begins at the type area edge');
  assert.ok(state.index.dots.bottom>state.index.term.y && state.index.dots.bottom<=state.index.term.bottom,'index leader aligns within its text line');
  near(state.diagram.size,pt(7.5),.1,'diagram text font');
  near(state.styles.title.size, pt(16), 0.15, 'body title font size');
  near(state.styles.body.size, pt(10.5), 0.15, 'body font size');
  for (const [role, size] of Object.entries({'term-number':10.5,'term-name':10.5,'term-definition':10.5,note:9,example:9,source:10.5,unit:9,subfigure:9,'table-note':9})) {
    assert.ok(state.semantic[role], `semantic block ${role}`);
    near(state.semantic[role].size, pt(size), 0.15, `${role} font size`);
  }
  assert.equal(state.semantic['term-number'].text.trim(), '3.1');
  assert.match(state.semantic['term-name'].html, /测试术语　verification term/i);
  assert.match(state.semantic['term-definition'].text, /用于验证排版的术语定义/);
  assert.match(state.semantic.note.html, /gb-label/);
  assert.match(state.semantic.example.html, /gb-label/);
  near(state.styles.chapter.size, pt(10.5), 0.15, 'chapter font size');
  near(state.styles.toc.size, pt(16), 0.15, 'contents title font size');
  near(state.styles.preface.size, pt(16), 0.15, 'foreword title font size');
  near(state.styles.reference.size, pt(10.5), 0.15, 'references title font size');
  assert.ok(state.endLine?.previous?.includes('INDEX_MARK'), 'end line stays with the final content');
  near(state.endLine.box.width, px(165/4), 1, 'end-line width');
  near(state.back.size,pt(14),.1,'back-cover standard font');
  const bodyPage = state.pages.find(p => p.text.includes('BODY_START'));
  assert.ok(bodyPage && bodyPage.number % 2 === 1, 'body starts on odd physical page');
  for (const page of state.pages.filter(p => !p.blank && p.number >= bodyPage.number && !p.name.includes('gb-back-cover'))) {
    near(page.box.width, px(210), 1, `page ${page.number} width`);
    near(page.box.height, px(297), 1, `page ${page.number} height`);
    const left = page.area.x - page.box.x;
    const right = page.box.right - page.area.right;
    near(left, px(page.number % 2 ? 25 : 20), 1.5, `page ${page.number} left margin`);
    near(right, px(page.number % 2 ? 20 : 25), 1.5, `page ${page.number} right margin`);
    assert.ok(page.header?.text.includes('39999'), `page ${page.number} standard header`);
    near(page.header.box.y-page.box.y,px(25),.6,`page ${page.number} header top`);
    near(page.footer.box.bottom-page.box.y,px(277),.6,`page ${page.number} footer bottom`);
    near(page.header.size,pt(10.5),.1,'header font');
    near(page.footer.size,pt(9),.1,'footer font');
  }
  for (const title of ['前言', '引言', '范围', '附录', '参考文献', '索引']) assert.ok(state.toc.some(item => item.text.includes(title)), `contents links ${title}`);
  assert.match(state.toc.find(item=>item.text.includes('附录检查表'))?.text || '', /表 A\.1/);
  const tables = state.pages.flatMap(p => p.tables).filter(t => t.rows.some(row => row.includes('GBROW_')));
  assert.ok(tables.length > 1, 'long table crosses pages');
  assert.ok(tables.every(t => t.head.includes('记录编号')), 'continuation table repeats its header');
  const rows = tables.flatMap(t => t.rows);
  for (let i = 1; i <= 100; i++) {
    const marker = `GBROW_${String(i).padStart(3, '0')}`;
    assert.equal(rows.filter(row => row.includes(marker)).length, 1, `${marker} exactly once`);
  }
  const printable = await staticRuntime.renderDocument({md,opts},false);
  const missingFontHtml = printable.html.replace('local("FZHTK--GBK1-0"), local("方正黑体_GBK")', 'local("MD2PDF Nonexistent GB Font")');
  for (const webSafe of [true,false]) await assert.rejects(chrome.printHtml(missingFontHtml,{...core.printOptions,webSafe,waitPaged:true}),/Document rendering failed/,'missing required local font must fail');
  const overlong = await staticRuntime.renderDocument({md:md.replace(/^发布日期:.*$/m,'').replace(/^实施日期:.*$/m,'').replace('国家标准排版综合验收方法','超长标准名称'.repeat(80)),opts},false);
  await assert.rejects(chrome.printHtml(overlong.html,{...core.printOptions,webSafe:true,waitPaged:true}),/Document rendering failed/,'overlong cover must not overlap issuer when dates absent');
  for (const [label, invalidMd] of [
    ['overwide standard number',md.replace('GB/T 39999—2026','GB/T '+'9'.repeat(180)+'—2026')],
    ['overlapping dates',md.replace('2026-01-01','D'.repeat(40)).replace('2026-07-01','D'.repeat(40))],
  ]) {
    const invalid=await staticRuntime.renderDocument({md:invalidMd,opts},false);
    await assert.rejects(chrome.printHtml(invalid.html,{...core.printOptions,webSafe:true,waitPaged:true}),/Document rendering failed/,label);
  }
  console.log(`PASS: CLI/core/Node/static, GB E/F browser and PDF checks; artifacts: ${out}`);
} finally {
  globalThis.fetch = nativeFetch;
  await chrome.stop();
  await app.close();
  await rm(temp, { recursive:true, force:true });
}
