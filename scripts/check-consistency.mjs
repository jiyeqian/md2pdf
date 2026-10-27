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
import { VERSION } from '../src/version.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
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
    const md = `---\nchapter-start: ${mode}\n---\n# Pagination\n\n## First\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n## Second\n\nEnd`;
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
