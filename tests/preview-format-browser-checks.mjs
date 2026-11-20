import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';

const app = process.argv[2] ? null : createApp();
const temp = await mkdtemp('/private/tmp/md2pdf-content-sync-');
const browser = new Chrome(findChrome(), temp);
try {
  if (app) await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = process.argv[2] || 'http://127.0.0.1:' + app.server.address().port;
  await browser.start();
  const send = (method, params, sessionId) => {
    if (!sessionId) return browser.send(method, params);
    const id = ++browser.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(method + ' timed out')), 40000);
      browser.pending.set(id, { resolve: result => { clearTimeout(timer); result.error ? reject(new Error(result.error.message)) : resolve(result.result); }, reject });
      browser.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  };
  const evaluate = async (expression, sessionId) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression, sessionId) => {
    for (let n = 0; n < 300; n++) {
      if (await evaluate('Boolean(' + expression + ')', sessionId)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('timeout: ' + expression);
  };
  const frame = async () => {
    for (const target of (await browser.send('Target.getTargets')).targetInfos.filter(target => target.type === 'iframe')) {
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      if (await evaluate('typeof window.__md2pdfPreviewSnapshot === "function"', sessionId)) return sessionId;
      await browser.send('Target.detachFromTarget', { sessionId });
    }
    throw new Error('preview frame missing');
  };
  const md = '---\ntoc: false\n---\n# 格式测试\n\n' + Array.from({ length: 40 }, (_, i) => '段落' + i + ' ' + '内容'.repeat(70)).join('\n\n') + '\n\n重复文字\n\n重复文字\n\n跨段选择';
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.navigate', { url });
  await wait('window.mdEditor && document.querySelector("#md-wt-sync")');
  await evaluate('mdEditor.setValue(' + JSON.stringify(md) + ')');
  try { await wait('window.__MD2PDF_PREVIEW_READY__ && document.querySelector("#preview").srcdoc.includes("重复文字")'); } catch (error) { console.error(await evaluate('({status:document.querySelector("#status").textContent,value:mdEditor.getValue(),src:document.querySelector("#preview").srcdoc.length,ready:window.__MD2PDF_PREVIEW_READY__,error:window.__MD2PDF_PREVIEW_ERROR__})')); throw error; }
  await evaluate('document.querySelector("#md-wt-sync").checked=false');
  let session = await frame();
  const beforeTop = await evaluate(`(()=>{const nodes=[...document.querySelectorAll('.pagedjs_pages p[data-md2pdf-source-id]')].filter(n=>n.textContent==='重复文字');nodes[1].scrollIntoView({block:'center',behavior:'instant'});return nodes[1].getBoundingClientRect().top;})()`, session);
  const select = async (second) => evaluate(`(()=>{const nodes=[...document.querySelectorAll('.pagedjs_pages p[data-md2pdf-source-id]')].filter(n=>n.textContent==='重复文字');const node=nodes[${second}].firstChild;const r=document.createRange();r.setStart(node,0);r.setEnd(node,node.length);getSelection().removeAllRanges();getSelection().addRange(r);nodes[${second}].dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:20,clientY:20}));})()`, session);
  await select(1);
  await wait('document.querySelector(".md-preview-format-menu button:not(:disabled)")');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.md-preview-format-menu button')].map(b=>({label:b.getAttribute('aria-label'),width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height}))`), [{label:'粗体',width:30,height:30},{label:'斜体',width:30,height:30},{label:'删除线',width:30,height:30}], 'same icon order and button size as editor selection toolbar');
  const selectedRect = await evaluate(`(()=>{const r=getSelection().getRangeAt(0).getClientRects()[0];return {left:r.left,top:r.top,bottom:r.bottom}})()`, session);
  const geometry = await evaluate(`(()=>{const f=document.querySelector('#preview'),fr=f.getBoundingClientRect(),m=document.querySelector('.md-preview-format-menu').getBoundingClientRect();return {viewport:{top:visualViewport.offsetTop,height:visualViewport.height},frame:{left:fr.left,top:fr.top,width:fr.width,height:fr.height,offsetWidth:f.offsetWidth,offsetHeight:f.offsetHeight,clientLeft:f.clientLeft,clientTop:f.clientTop},menu:{left:m.left,top:m.top,bottom:m.bottom}}})()`);
  const sx=geometry.frame.width/geometry.frame.offsetWidth, sy=geometry.frame.height/geometry.frame.offsetHeight;
  assert.ok(Math.abs(geometry.menu.left-(geometry.frame.left+(geometry.frame.clientLeft+selectedRect.left)*sx))<1, 'menu aligns with the selection, not the context-menu pointer');
  const selectionTop = geometry.frame.top + (geometry.frame.clientTop + selectedRect.top) * sy;
  const selectionBottom = geometry.frame.top + (geometry.frame.clientTop + selectedRect.bottom) * sy;
  const menuHeight = geometry.menu.bottom - geometry.menu.top;
  const minTop = geometry.viewport.top + 4;
  const maxTop = geometry.viewport.top + geometry.viewport.height - menuHeight - 4;
  const above = selectionTop - menuHeight - 8;
  const expectedTop = Math.max(minTop, Math.min(above >= minTop ? above : selectionBottom + 8, maxTop));
  assert.ok(Math.abs(geometry.menu.top - expectedTop) < 1, 'menu uses the editor gap and viewport bounds');
  const previewIcons = await evaluate(`Array.from(document.querySelectorAll('.md-preview-format-menu button')).map(b=>({icon:b.firstElementChild.outerHTML,width:b.firstElementChild.getBoundingClientRect().width,height:b.firstElementChild.getBoundingClientRect().height}))`);
  await evaluate(`mdEditor.setSelection(mdEditor.getValue().indexOf('重复文字'),mdEditor.getValue().indexOf('重复文字')+4)`);
  await wait(`document.querySelector('.md-quick-actions:not(.md-preview-format-menu):not([hidden]) svg')`);
  assert.deepEqual(await evaluate(`['粗体','斜体','删除线'].map(label=>{const e=document.querySelector('.md-quick-actions:not(.md-preview-format-menu) [aria-label="'+label+'"]');return {icon:e.firstElementChild.outerHTML,width:e.firstElementChild.getBoundingClientRect().width,height:e.firstElementChild.getBoundingClientRect().height}})`), previewIcons, 'preview icons match editor selection icons');
  await browser.send('Page.captureScreenshot',{format:'png'}).then(result=>writeFile('/private/tmp/md2pdf-format-before.png',Buffer.from(result.data,'base64')));
  await evaluate(`const original=mdEditor.replaceRange;mdEditor.replaceRange=function(...args){mdEditor.replaceRange=original;setTimeout(()=>original.apply(mdEditor,args),600)};window.__coverAtReplacement=null;new MutationObserver(()=>{const cover=document.querySelector('[data-md2pdf-format-cover]');window.__coverAtReplacement=!!cover&&getComputedStyle(cover).opacity==='1';}).observe(document.querySelector('#preview'),{attributes:true,attributeFilter:['srcdoc']});document.querySelector('.md-preview-format-menu button').click()`);
  await wait('document.querySelector("[data-md2pdf-format-cover]") && getComputedStyle(document.querySelector("[data-md2pdf-format-cover]")).opacity==="1"');
  await browser.send('Page.captureScreenshot',{format:'png'}).then(result=>writeFile('/private/tmp/md2pdf-format-cover.png',Buffer.from(result.data,'base64')));
  await wait('mdEditor.getValue().includes("<strong>重复文字</strong>")');
  assert.equal(await evaluate('mdEditor.getValue()'), md.replace('重复文字\n\n跨段', '<strong>重复文字</strong>\n\n跨段'));
  await wait('window.__MD2PDF_PREVIEW_READY__');
  session = await frame();
  await wait('getSelection().toString() === \"重复文字\"', session);
  assert.equal(await evaluate('getSelection().toString()', session), '重复文字', 'formatted selection is restored');
  assert.equal(await evaluate('window.__coverAtReplacement'), true, 'visible snapshot covers the preview when srcdoc is replaced');
  await wait('!document.querySelector("[data-md2pdf-format-cover]")');
  await browser.send('Page.captureScreenshot',{format:'png'}).then(result=>writeFile('/private/tmp/md2pdf-format-after.png',Buffer.from(result.data,'base64')));
  const afterTop = await evaluate(`(()=>{const nodes=[...document.querySelectorAll('.pagedjs_pages p[data-md2pdf-source-id]')].filter(n=>n.textContent==='重复文字');return nodes[1].getBoundingClientRect().top;})()`, session);
  assert.ok(Math.abs(afterTop - beforeTop) < 25, 'formatting restores the preview scroll anchor: ' + JSON.stringify({beforeTop,afterTop}));
  await evaluate('mdEditor.runCommand("undo")');
  assert.equal(await evaluate('mdEditor.getValue()'), md, 'formatting is one undo transaction');
  await wait('window.__MD2PDF_PREVIEW_READY__');
  session = await frame();
  await evaluate(`(()=>{const nodes=[...document.querySelectorAll('.pagedjs_pages p[data-md2pdf-source-id]')].filter(n=>n.textContent==='重复文字');const r=document.createRange();r.setStart(nodes[0].firstChild,0);r.setEnd(nodes[1].firstChild,2);getSelection().removeAllRanges();getSelection().addRange(r);nodes[1].dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:20,clientY:20}));})()`, session);
  await assertNoFormatMenu('cross-paragraph selection');
  async function assertNoFormatMenu(label) {
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(await evaluate('!!document.querySelector(".md-preview-format-menu")'), false, label);
    assert.equal(await evaluate('!!document.querySelector(' + JSON.stringify('[aria-label="预览格式"]') + ')', session), false, label + ' iframe');
  }
  const fixtures = [
    ['bold', 'abc', '<strong>abc</strong>', 0, 'abc'], ['italic', 'abc', '<em>abc</em>', 1, 'abc'], ['strike', 'abc', '<del>abc</del>', 2, 'abc'],
    ['nested', '**abc**', '<strong><em>abc</em></strong>', 1, '<strong>abc</strong>'],
  ];
  for (const [label, source, expected, button, toggledOff] of fixtures) {
    await evaluate('mdEditor.setValue(' + JSON.stringify(source) + ')');
    await wait('window.__MD2PDF_PREVIEW_READY__ && document.querySelector("#preview").srcdoc.includes("abc")');
    session = await frame();
    const open = async () => {
      await evaluate(`(()=>{const p=document.querySelector('.pagedjs_pages p[data-md2pdf-format-source-id]');const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let n;while((n=walker.nextNode())&&!n.data.includes('abc')){}const i=n.data.indexOf('abc'),r=document.createRange();r.setStart(n,i);r.setEnd(n,i+3);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:innerWidth-2,clientY:innerHeight-2}));})()`, session);
      await wait('document.querySelector(".md-preview-format-menu")');
      assert.equal(await evaluate('(()=>{const r=document.querySelector(".md-preview-format-menu").getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight})()'), true, label + ' menu remains in viewport');
      assert.equal(await evaluate('document.querySelectorAll(".md-preview-format-menu button")[' + button + '].disabled'), false, label + ' enabled');
      await evaluate('document.querySelectorAll(".md-preview-format-menu button")[' + button + '].click()');
    };
    await open();
    await wait('mdEditor.getValue()===' + JSON.stringify(expected));
    await wait('window.__MD2PDF_PREVIEW_READY__');
    session = await frame();
    await wait('getSelection().toString()==="abc"', session);
    await open();
    await wait('mdEditor.getValue()===' + JSON.stringify(toggledOff));
    assert.equal(await evaluate('mdEditor.getValue()'), toggledOff, label + ' toggles off');
  }
  // Mixed inline styles and reverse drag use rendered coordinates, not text lookup in source.
  for (const [source, start, end, button, expected, reverse] of [
    ['这里是**普通文字**', 0, 3, 0, '<strong>这里是普通文字</strong>', false],
    ['**普通文字**', 0, 2, 0, '普通<strong>文字</strong>', true],
    ['这里是**普通文字**', 1, 5, 0, '这<strong>里是普通文字</strong>', true],
    ['*中文*相邻', 0, 4, 1, '<em>中文相邻</em>', true],
    ['~~中文~~相邻', 0, 4, 2, '<del>中文相邻</del>', true],
    ['*中文*', 0, 1, 1, '中<em>文</em>', true],
    ['~~中文~~', 0, 1, 2, '中<del>文</del>', true],
    ['**a *b* c**', 2, 3, 0, '<strong>a </strong><em>b</em><strong> c</strong>', true],
    ['你好，世界', 2, 5, 0, '你好<strong>，世界</strong>', false],
  ]) {
    await evaluate('mdEditor.setValue(' + JSON.stringify(source) + ')');
    await wait('mdPreviewController.state().ready && mdPreviewController.state().previewRevision === mdPreviewController.state().revision');
    session = await frame();
    await evaluate(`(()=>{const p=document.querySelector('.pagedjs_pages p[data-md2pdf-format-source-id]');const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);const nodes=[];let n;while((n=w.nextNode()))nodes.push(n);function at(i,start){for(const n of nodes){if(i<n.length || (!start && i===n.length))return [n,i];i-=n.length}throw Error('selection offset')}const a=at(${start},true),b=at(${end},false);const sel=getSelection();sel.removeAllRanges();sel.setBaseAndExtent(...(${reverse}?[b[0],b[1],a[0],a[1]]:[a[0],a[1],b[0],b[1]]));p.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:30,clientY:30}));})()`, session);
    await wait('document.querySelector(".md-preview-format-menu")');
    assert.equal(await evaluate('document.querySelectorAll(".md-preview-format-menu button")[' + button + '].disabled'), false, source + ' selection enabled');
    await evaluate('document.querySelectorAll(".md-preview-format-menu button")[' + button + '].click()');
    await wait('mdEditor.getValue()===' + JSON.stringify(expected));
    await wait('mdPreviewController.state().ready && mdPreviewController.state().previewRevision === mdPreviewController.state().revision');
  }
  const referenceDoc = await readFile(new URL('../web/examples/general.md', import.meta.url), 'utf8');
  for (const [label, selector, mode, expected] of [
    ['text before footnote', 'sup.fnref', 'before', true],
    ['whole footnote', 'sup.fnref', 'whole', true],
    ['partial footnote', 'sup.fnref', 'partial', false],
    ['paragraph with figure reference', 'a.ref[href^="#fig-"]', 'paragraph', true],
  ]) {
    await evaluate('mdEditor.setValue(' + JSON.stringify(referenceDoc) + ')');
    await wait('mdPreviewController.state().ready && mdPreviewController.state().previewRevision === mdPreviewController.state().revision');
    session = await frame();
    await evaluate(`(()=>{const atom=document.querySelector('.pagedjs_pages p[data-md2pdf-format-source-id] ${selector}');if(!atom)throw Error('missing ${label}');const p=atom.closest('p'),r=document.createRange();if('${mode}'==='paragraph')r.selectNodeContents(p);else if('${mode}'==='before'){const n=p.firstChild;r.setStart(n,0);r.setEnd(n,Math.min(4,n.length));}else{const w=document.createTreeWalker(atom,NodeFilter.SHOW_TEXT),n=w.nextNode();r.setStart(n,0);r.setEnd(n,'${mode}'==='partial'?1:n.length);}getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:30,clientY:30}));})()`, session);
    if (expected) {
      await wait('document.querySelector(".md-preview-format-menu button:not(:disabled)")');
      const original = label === 'text before footnote' ? '仿生机械' : label === 'whole footnote' ? '[^hogan1985]' : '抓取过程的状态转移如图 \\ref{fig:flow} 所示：';
      await evaluate('document.querySelector(".md-preview-format-menu button").click()');
      await wait('mdEditor.getValue()===' + JSON.stringify(referenceDoc.replace(label === 'text before footnote' ? '\n\n' + original : original, label === 'text before footnote' ? '\n\n<strong>' + original + '</strong>' : '<strong>' + original + '</strong>')));
    } else await assertNoFormatMenu(label);
  }
  for (const [label, source] of [
    ['equation reference outside selection', '普通文字 $\\eqref{eq:test}$ 后续文字。\n\n$$\nx=1\\label{eq:test}\n$$'],
    ['GB footnote outside selection', '---\ntype: gb\n---\n# 测试\n\n普通文字[^@n]后续文字。\n\n[^@n]: 脚注'],
  ]) for (const whole of [false, true]) {
    await evaluate('mdEditor.setValue(' + JSON.stringify(source) + ')');
    await wait('mdPreviewController.state().ready && mdPreviewController.state().previewRevision === mdPreviewController.state().revision');
    session = await frame();
    await evaluate(`(()=>{const p=[...document.querySelectorAll('.pagedjs_pages p[data-md2pdf-format-source-id]')].find(p=>p.textContent.startsWith('普通文字'));if(!p)throw Error('missing ${label}');const r=document.createRange();r.setStart(p.firstChild,0);if (${whole}) r.selectNodeContents(p); else r.setEnd(p.firstChild,4);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:30,clientY:30}));})()`, session);
    await wait('document.querySelector(".md-preview-format-menu")');
    assert.equal(await evaluate('document.querySelector(".md-preview-format-menu button").disabled'), false, label);
    await evaluate('document.querySelector(".md-preview-format-menu button").click()');
    try { await wait('mdEditor.getValue()===' + JSON.stringify(source.replace(/普通文字.*?。/, paragraph => whole ? '<strong>' + paragraph + '</strong>' : paragraph.replace('普通文字','<strong>普通文字</strong>')))); } catch (error) { console.error(label, await evaluate(`({status:document.querySelector('#status').textContent,state:mdPreviewController.state(),cover:!!document.querySelector('[data-md2pdf-format-cover]'),value:mdEditor.getValue()})`)); throw error; }
  }
  const linkTarget = 'https://cnb.cool/jiyeqian/md2pdf';
  const linkParagraph = '所用工具 [md2pdf](' + linkTarget + ') 即本项目[^md2pdf]。';
  const linkSuffix = '\n\n[^md2pdf]: 项目说明';
  for (const [whole, button, tag] of [[false, 0, 'strong'], [true, 0, 'strong'], [true, 1, 'em'], [true, 2, 'del']]) {
    const source = linkParagraph + linkSuffix;
    if (await evaluate('mdEditor.getValue()') !== source) {
      await evaluate('mdEditor.setValue(' + JSON.stringify(source) + ')');
    }
    await wait('mdPreviewController.state().ready && mdPreviewController.state().previewRevision === mdPreviewController.state().revision');
    session = await frame();
    await evaluate(`(()=>{const p=[...document.querySelectorAll('.pagedjs_pages p')].find(p=>p.textContent.startsWith('所用工具'));const r=document.createRange();if (${whole}) r.selectNodeContents(p);else {r.setStart(p.firstChild,0);r.setEnd(p.firstChild,4);}getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:30,clientY:30}));})()`, session);
    await wait('document.querySelector(".md-preview-format-menu button:not(:disabled)")');
    await evaluate('document.querySelectorAll(".md-preview-format-menu button")[' + button + '].click()');
    const expected = (whole ? '<' + tag + '>' + linkParagraph + '</' + tag + '>' : linkParagraph.replace('所用工具', '<strong>所用工具</strong>')) + linkSuffix;
    await wait('mdEditor.getValue()===' + JSON.stringify(expected));
    await wait('mdPreviewController.state().ready && mdPreviewController.state().previewRevision === mdPreviewController.state().revision');
    session = await frame();
    assert.equal(await evaluate(`[...document.querySelectorAll('.pagedjs_pages p a')].find(a=>a.textContent==='md2pdf')?.getAttribute('href')`, session), linkTarget);
  }
  const gbDoc = '---\ntype: gb\n---\n# 国标格式测试\n\n重复文字\n\n:::gb-note\n重复文字\n:::\n\n脚注[^@n]。\n\n[^@n]: 脚注\n\n重复文字';
  await evaluate('mdEditor.setValue(' + JSON.stringify(gbDoc) + ')');
  await wait('mdPreviewController.state().ready && mdPreviewController.state().previewRevision === mdPreviewController.state().revision');
  session = await frame();
  await evaluate(`(()=>{const nodes=[...document.querySelectorAll('.pagedjs_pages p[data-md2pdf-format-source-id]')].filter(n=>n.textContent==='重复文字');if(nodes.length!==2)throw Error('GB provenance mismatch: '+nodes.length);const p=nodes[1],r=document.createRange();r.setStart(p.firstChild,0);r.setEnd(p.firstChild,p.firstChild.length);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:30,clientY:30}));})()`,session);
  await wait('document.querySelector(".md-preview-format-menu button:not(:disabled)")');
  await evaluate('document.querySelector(".md-preview-format-menu button").click()');
  await wait('mdEditor.getValue()===' + JSON.stringify(gbDoc.replace(/重复文字$/, '<strong>重复文字</strong>')));
  await wait('mdPreviewController.state().ready && mdPreviewController.state().previewRevision === mdPreviewController.state().revision');
  session = await frame();
  await wait('getSelection().toString()==="重复文字"', session);
  await evaluate('mdEditor.runCommand("undo")');
  assert.equal(await evaluate('mdEditor.getValue()'), gbDoc, 'GB formatting is one undo transaction');
  await evaluate('mdEditor.setValue("这里是**普通文字**")');
  await wait('mdPreviewController.state().ready && mdPreviewController.state().previewRevision === mdPreviewController.state().revision');
  session = await frame();
  await evaluate(`(()=>{const p=document.querySelector('.pagedjs_pages p[data-md2pdf-format-source-id]'),r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:30,clientY:30}));})()`,session);
  await wait('document.querySelector(".md-preview-format-menu")');
  assert.equal(await evaluate('document.querySelector(".md-preview-format-menu button").disabled'),false,'equivalent element-boundary selection stays editable');
  await evaluate('document.querySelector(".md-preview-format-menu button").click()');
  await wait('mdEditor.getValue()==="<strong>这里是普通文字</strong>"');
  const mixedDoc = '# 混合文档\n\n正文可编辑\n\n- 列表\n\n| 甲 | 乙 |\n| --- | --- |\n| 一 | 二 |\n\n包含公式 $x$ 与引用[^a]。\n\n[^a]: 脚注\n';
  await evaluate('mdEditor.setValue(' + JSON.stringify(mixedDoc) + ')');
  await wait('mdPreviewController.state().ready && mdPreviewController.state().previewRevision === mdPreviewController.state().revision');
  session = await frame();
  await evaluate(`(()=>{const p=[...document.querySelectorAll('.pagedjs_pages p[data-md2pdf-format-source-id]')].find(x=>x.textContent==='正文可编辑');const r=document.createRange();r.setStart(p.firstChild,0);r.setEnd(p.firstChild,p.firstChild.length);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:30,clientY:30}));})()`,session);
  await wait('document.querySelector(".md-preview-format-menu")');
  assert.equal(await evaluate('document.querySelector(".md-preview-format-menu button").disabled'),false,'unrelated structures do not disable safe paragraph');
  await evaluate('document.querySelector(".md-preview-format-menu button").click()');
  await wait('mdEditor.getValue()===' + JSON.stringify(mixedDoc.replace('正文可编辑','<strong>正文可编辑</strong>')));
  for (const [label, source, selector] of [
    ['table', '| abc | x |\n|---|---|\n| def | y |', '.pagedjs_pages td'],
    ['forged', '<p data-md2pdf-format-source-id="0">abc</p>\n\nordinary', '.pagedjs_pages p'],
  ]) {
    await evaluate('mdEditor.setValue(' + JSON.stringify(source) + ')');
    await wait('window.__MD2PDF_PREVIEW_READY__');
    session = await frame();
    await evaluate(`(()=>{let node;if(${JSON.stringify(label)}==='forged'){const w=document.createTreeWalker(document.querySelector('.pagedjs_pages'),NodeFilter.SHOW_TEXT);while((node=w.nextNode())&&!node.data.includes('data-md2pdf-format-source-id')){}}else node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.textContent.trim());if(!node)throw Error('test target missing');const r=document.createRange();r.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(r);(node.nodeType===3?node.parentElement:node).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:30,clientY:30}));})()`, session);
    await assertNoFormatMenu(label);
    assert.equal(await evaluate('mdEditor.getValue()'), source);
  }
  await evaluate('mdEditor.setValue("abc")');
  await wait('window.__MD2PDF_PREVIEW_READY__');
  session = await frame();
  await evaluate(`(()=>{const p=document.querySelector('.pagedjs_pages p[data-md2pdf-format-source-id]');const r=document.createRange();r.setStart(p.firstChild,0);r.setEnd(p.firstChild,p.firstChild.length);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:30,clientY:30}));})()`, session);
  await wait('document.querySelector(".md-preview-format-menu button:not(:disabled)")');
  await evaluate(`window.__oldPostPreview=mdWorkspaceHosts.postPreview;mdWorkspaceHosts.postPreview=data=>data.type==='md2pdf-transfer-capture'?undefined:window.__oldPostPreview(data);document.querySelector('.md-preview-format-menu button').click()`);
  await wait('mdEditor.getValue()==="<strong>abc</strong>"');
  assert.equal(await evaluate('!!document.querySelector("[data-md2pdf-format-cover]")'), false, 'a timed-out snapshot does not block a validated edit');
  console.log('preview formatting browser checks passed');
} finally {
  await browser.stop();
  if (app) await app.close();
  await rm(temp, { recursive: true, force: true });
}
