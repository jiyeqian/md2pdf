#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildStatic } from '../src/static-build.mjs';
import { render } from '../src/render.mjs';
import { createApp, webDocument } from '../src/server.mjs';
import { attachSourcePositions } from '../src/editor-position.mjs';
import { syncGbExample } from './sync-gb-example.mjs';
import { VERSION } from '../src/version.mjs';
import { documentDownloadName } from '../web/editor-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
await syncGbExample(root,true);
const build = await buildStatic();
const tmp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-consistency-'));
const nativeFetch = globalThis.fetch;
// 只为 Node 中执行已构建的浏览器模块提供本地资源读取；不替代浏览器验收。
globalThis.fetch = async (input, init) => {
  const url = new URL(input);
  if (url.protocol !== 'file:') return nativeFetch(input, init);
  return new Response(await readFile(url));
};
const browserRender = (await import(pathToFileURL(path.join(build.directory, 'src/render.mjs')))).render;
const browser = await import(pathToFileURL(path.join(build.directory, 'runtime.mjs')));
const app = createApp({publicHost:'', lanHost:''});
const normalize = html => html.replaceAll(pathToFileURL(build.directory + '/').href, 'ROOT/').replaceAll(pathToFileURL(root).href, 'ROOT/').replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}/g, 'GENERATED_AT');
function sameHtml(actual, expected, label) {
  actual=normalize(actual);expected=normalize(expected);
  if(actual===expected)return;
  let i=0;while(i<actual.length&&actual[i]===expected[i])i++;
  throw new Error(`${label}: first difference at ${i}\nactual: ${actual.slice(Math.max(0,i-60),i+160)}\nexpected: ${expected.slice(Math.max(0,i-60),i+160)}`);
}
try {
  await new Promise((resolve,reject) => {app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal(execFileSync(process.execPath,['src/md2pdf.mjs','--version'],{cwd:root}).toString().trim(),VERSION);
  const nodeVersion = await (await nativeFetch(base+'/api/version')).json();
  const staticVersion = await (await browser.appFetch('/api/version')).json();
  assert.equal(nodeVersion.version,VERSION);assert.equal(staticVersion.version,VERSION);
  assert.equal(nodeVersion.commit,staticVersion.commit);
  for (const type of ['general','paper','gb','skill']) {
    const md = await readFile(path.join(root,'web/examples',type+'.md'),'utf8');
    const body = {md, opts:{type}};
    const opts = {type,pagedHtml:true};
    const core = await render(md,opts,{webSafe:true});
    const local = await browserRender(md,opts,{webSafe:true});
    sameHtml(local.pagedHtml,core.pagedHtml,type+': browser core');
    assert.deepEqual(local.printOptions,core.printOptions,type+': print configuration');
    const input = path.join(tmp,type+'.md'), output = path.join(tmp,type+'.html');
    await writeFile(input,md);
    execFileSync(process.execPath,['src/md2pdf.mjs',input,'--html-only','--type',type,'--paged-html=','-o',output],{cwd:root,stdio:'pipe'});
    // Web 安全渲染器将公式中的 & 序列化为 &amp;，浏览器文本等价。
    sameHtml((await readFile(output,'utf8')).replaceAll('&amp;','&'),core.pagedHtml.replaceAll('&amp;','&'),type+': CLI HTML');
    const response = await nativeFetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(response.status,200,type+': Node API');
    const online = await response.json();
    const offline = await (await browser.appFetch('/api/render',{body:JSON.stringify(body)})).json();
    sameHtml(offline.html,online.html,type+': preview');
    assert.deepEqual(offline.effective,online.effective,type+': effective options');
    assert.deepEqual(offline.policy,online.policy,type+': control policy');
    const automatic = {md,opts:{}};
    const autoNode = await (await nativeFetch(base+'/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(automatic)})).json();
    const autoStatic = await (await browser.appFetch('/api/preview',{body:JSON.stringify(automatic)})).json();
    sameHtml(autoStatic.html,autoNode.html,type+': single-call automatic preview');
    assert.deepEqual(autoStatic.effective,autoNode.effective,type+': automatic effective options');
    assert.deepEqual(autoStatic.resetOptions,autoNode.resetOptions,type+': reset controls');
    sameHtml(online.html,await webDocument(attachSourcePositions(core.pagedHtml,md),true,type),type+': prepared HTML');
    console.log(`✓ ${type}: CLI HTML、共用核心、Node API、静态预览与配置一致`);
  }
  for (const mode of ['continuous', 'page', 'odd-page']) {
    const md = `---\nchapter-start: ${mode}\n---\n# Pagination\n\n## First\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n<!-- pagebreak -->\n\nAfter manual break\n\n## Second\n\nEnd`;
    const body = {md, opts:{}};
    const online = await (await nativeFetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
    const offline = await (await browser.appFetch('/api/render',{body:JSON.stringify(body)})).json();
    sameHtml(offline.html, online.html, mode+': chapter/table preview');
    assert.equal(online.effective.chapterStart, mode);
    assert.deepEqual(offline.effective, online.effective);
    const core = await render(md, {pagedHtml:true}, {webSafe:true});
    const input=path.join(tmp,'pagination.md'), output=path.join(tmp,'pagination.html');
    await writeFile(input,md);
    execFileSync(process.execPath,['src/md2pdf.mjs',input,'--html-only','--paged-html=','-o',output],{cwd:root,stdio:'pipe'});
    sameHtml(await readFile(output,'utf8'), core.pagedHtml, mode+': chapter/table CLI');
    sameHtml(online.html,await webDocument(attachSourcePositions(core.pagedHtml,md),true,core.type),mode+': chapter/table prepared HTML');
  }
  console.log('✓ 章分页三种策略与表头运行时：CLI、Node、静态配置及 HTML 一致');
  for (const type of ['general','paper','gb','skill']) {
    const md='---\nfonts:\n  body: Arial\n  heading: Helvetica\n  western: Times New Roman\n  code: Menlo\n---\n# 字体一致性\n\n## 范围\n\n正文 ABC 123。`code`，x^{2}、H_{2}O、~~删除~~。';
    const body={md,opts:{type}},opts={type,pagedHtml:true};
    const core=await render(md,opts,{webSafe:true});
    const local=await browserRender(md,opts,{webSafe:true});
    sameHtml(local.pagedHtml,core.pagedHtml,type+': custom font core');
    assert.deepEqual(local.printOptions,core.printOptions);
    assert.match(core.html,/<sup class="md-superscript">2<\/sup>/);
    assert.match(core.html,/<sub class="md-subscript">2<\/sub>/);
    assert.match(core.html,/<del>删除<\/del>/);
    const response=await nativeFetch(base+'/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(response.status,200);
    const online=await response.json(),offline=await(await browser.appFetch('/api/preview',{body:JSON.stringify(body)})).json();
    sameHtml(offline.html,online.html,type+': custom font preview');
    assert.deepEqual(offline.effective.fonts,{body:'Arial',heading:'Helvetica',western:'Times New Roman',code:'Menlo'});
    assert.deepEqual(offline.effective.fonts,online.effective.fonts);
    const input=path.join(tmp,'fonts-'+type+'.md'),output=path.join(tmp,'fonts-'+type+'.html');
    await writeFile(input,md);
    execFileSync(process.execPath,['src/md2pdf.mjs',input,'--type',type,'--html-only','--paged-html=','-o',output],{cwd:root,stdio:'pipe'});
    sameHtml(await readFile(output,'utf8'),core.pagedHtml,type+': custom font CLI');
  }
  for(const type of ['general','paper','gb','skill']) {
    const md='---\nfonts: {heading: "", body: "", western: "", code: ""}\n---\n# 空字体一致性\n\n## 正文\n\n文字 ABC。',opts={type,pagedHtml:true};
    const core=await render(md,opts,{webSafe:true}),local=await browserRender(md,opts,{webSafe:true});
    sameHtml(local.pagedHtml,core.pagedHtml,type+': empty font core');
    const body={md,opts:{type}},response=await nativeFetch(base+'/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(response.status,200);
    const online=await response.json(),offline=await(await browser.appFetch('/api/preview',{body:JSON.stringify(body)})).json();
    sameHtml(offline.html,online.html,type+': empty font preview');
    assert.deepEqual(online.effective.fonts,{body:'',heading:'',western:'',code:''});
    assert.ok(!core.html.includes('MD2PDF User'));
    const input=path.join(tmp,'fonts-empty-'+type+'.md'),output=path.join(tmp,'fonts-empty-'+type+'.html');await writeFile(input,md);
    execFileSync(process.execPath,['src/md2pdf.mjs',input,'--type',type,'--html-only','--paged-html=','-o',output],{cwd:root,stdio:'pipe'});
    sameHtml(await readFile(output,'utf8'),core.pagedHtml,type+': empty font CLI');
  }
  console.log('✓ 四模板 fonts 映射、CLI HTML、Node 与静态预览及字体检查规则一致');
  {
    const md='---\n标准号: GB/T 39999—2026\n中文名称: 章节角色验收\ntoc: 2\n---\n## 目录 {role=toc}\n\n## 前言 {role=preface}\n\n## 范围\n\n引用[^r]，见 \\ref{sec:appendix}。\n\n## 方法 {nature=normative #sec:appendix role=appendix}\n\n### 子条\n\n## 参考文献 {role=bibliography}\n\n[^r]: 参考条目\n';
    const body={md,opts:{type:'gb'}},core=await render(md,{type:'gb',pagedHtml:true},{webSafe:true});
    const response=await nativeFetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(response.status,200);
    const online=await response.json(),offline=await(await browser.appFetch('/api/render',{body:JSON.stringify(body)})).json();
    sameHtml(online.html,offline.html,'GB sections Node/static');
    sameHtml((await browserRender(md,{type:'gb',pagedHtml:true},{webSafe:true})).pagedHtml,core.pagedHtml,'GB sections browser core');
    const input=path.join(tmp,'gb-sections.md'),output=path.join(tmp,'gb-sections.html');
    await writeFile(input,md);
    execFileSync(process.execPath,['src/md2pdf.mjs',input,'--html-only','--paged-html=','-o',output],{cwd:root,stdio:'pipe'});
    sameHtml(await readFile(output,'utf8'),core.pagedHtml,'GB sections CLI');
    assert.match(core.html,/A\.1　子条/);
    assert.equal((core.html.match(/class="references"/g)||[]).length,1);
    assert.ok(core.warnings.some(w=>w.includes('自定义名称')));
    console.log('✓ GB章节角色、自动附录、显式目次及文献：CLI、Node、静态一致');
  }
  for (const depth of [0,1,2,3]) {
    const md=`---\n标准号: GB/T 39999—2026\n中文名称: 目录命名验收\ntitle: 旧标题\nversion: v2\ntoc: ${depth}\n---\n## 目次 {role=toc}\n\n## 范围\n\n### 次级条\n\n#### 三级条\n\n##### 四级条\n`;
    const body={md,opts:{}};
    const response=await nativeFetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(response.status,200);
    const online=await response.json();
    const offline=await (await browser.appFetch('/api/render',{body:JSON.stringify(body)})).json();
    sameHtml(offline.html,online.html,`GB toc ${depth}`);
    assert.deepEqual(offline.effective,online.effective);
    assert.equal(online.effective.toc,depth!==0);
    if(depth)assert.equal(online.effective.tocDepth,depth);
    const core=await render(md,{pagedHtml:true},{webSafe:true});
    const input=path.join(tmp,'toc.md'),output=path.join(tmp,'toc.html');
    await writeFile(input,md);
    execFileSync(process.execPath,['src/md2pdf.mjs',input,'--html-only','--paged-html=','-o',output],{cwd:root,stdio:'pipe'});
    sameHtml(await readFile(output,'utf8'),core.pagedHtml,`CLI toc ${depth}`);
    if(depth===3)assert.match(core.html,/class="toc-level-2"/);
    const staticFiles=await import(pathToFileURL(path.join(build.directory,'editor-files.mjs')));
    assert.equal(staticFiles.documentDownloadName(md,new Date(),'pdf'),documentDownloadName(md,new Date(),'pdf'));
    assert.equal(documentDownloadName(md,new Date(),'pdf'),'目录命名验收_v2.pdf');
  }
  console.log('✓ GB目录0–3级、CLI/Node/静态内容及中文名称下载命名一致');
  {
    const md='---\n标准号: GB/T 39999—2026\n中文名称: 显式三级目录\ntoc: 1\n---\n## 目次 {role=toc}\n\n## 范围\n\n### 次级\n\n#### 三级\n';
    const opts={toc:true,tocDepth:3},body={md,opts};
    const response=await nativeFetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(response.status,200);
    const online=await response.json(),offline=await(await browser.appFetch('/api/render',{body:JSON.stringify(body)})).json();
    assert.equal(online.effective.tocDepth,3);
    sameHtml(offline.html,online.html,'explicit depth3 preview');
    const input=path.join(tmp,'explicit-toc.md'),output=path.join(tmp,'explicit-toc.html');
    await writeFile(input,md);
    execFileSync(process.execPath,['src/md2pdf.mjs',input,'--toc','--toc-depth','3','--html-only','--paged-html=','-o',output],{cwd:root,stdio:'pipe'});
    sameHtml(await readFile(output,'utf8'),(await render(md,{...opts,pagedHtml:true},{webSafe:true})).pagedHtml,'CLI explicit depth3');
  }
  for(const sort of ['auto','input','pinyin','alphabetical']) {
    const md=`# 索引排序验收\n\n## 范围 {#sec:scope}\n\n## 索引 {role=index}\n\n:::gb-index-section lang=zh sort=${sort}\n:::gb-index\n试验 | @sec:scope\n重庆 {sort-key="chong qing"} | @sec:scope\n刚度 | @sec:scope\n:::\n:::gb-index K\n控制 | @sec:scope\n:::\n:::`;
    const body={md,opts:{type:'gb',toc:false}};
    const core=await render(md,{...body.opts,pagedHtml:true},{webSafe:true});
    sameHtml((await browserRender(md,{...body.opts,pagedHtml:true},{webSafe:true})).pagedHtml,core.pagedHtml,'index '+sort+' browser core');
    const nodeResponse=await nativeFetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(nodeResponse.status,200);
    const online=await nodeResponse.json(),offline=await(await browser.appFetch('/api/render',{body:JSON.stringify(body)})).json();
    sameHtml(offline.html,online.html,'index '+sort+' preview');
    const input=path.join(tmp,'index.md'),output=path.join(tmp,'index.html');await writeFile(input,md);
    execFileSync(process.execPath,['src/md2pdf.mjs',input,'--type','gb','--no-toc','--html-only','--paged-html=','-o',output],{cwd:root,stdio:'pipe'});
    sameHtml(await readFile(output,'utf8'),core.pagedHtml,'index '+sort+' CLI');
  }
  console.log('✓ GB索引 auto/input/pinyin/alphabetical、强制分组及排序键：CLI、Node、静态一致');
  const invalid={md:'---\nfont-size: bad\n---\n# Invalid',opts:{}};
  const online=await nativeFetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(invalid)});
  const offline=await browser.appFetch('/api/render',{body:JSON.stringify(invalid)});
  assert.equal(offline.status,online.status);assert.deepEqual(await offline.json(),await online.json());
  console.log(`✓ 产品版本 v${VERSION}、提交号及非法配置诊断一致`);
  console.log('未覆盖：浏览器交互、缓存更新、真实 PDF 排版与书签、手机打印；请完成交接文档中的人工验收。');
} finally {
  globalThis.fetch = nativeFetch;
  await app.close();
  await rm(tmp,{recursive:true,force:true});
}
