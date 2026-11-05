import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  const words = Array.from({ length: 1900 }, (_, i) => 'token' + i).join(' ');
  const md = '---\ntoc: false\n---\n# 同步验收\n\n## 一个长章\n\n重复段落。\n\n'
    + words + '\n\n重复段落。\n\n- outer **bold**\n  - inner [link](https://example.com)\n\n> 引用中的中文与 emoji 🚀。\n\n'
    + '表：验收表 {#tab:accept}\n\n| 项目 | 数值 |\n|---|---|\n' + Array.from({ length: 85 }, (_, i) => '| row' + i + ' | value' + i + ' |').join('\n')
    + '\n\n```js\nconst answer = 42;\n```\n\ninline $x^2$ after math.\n\n$$y=x+1$$\n\n'
    + '![像素图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==)\n\n'
    + '图：验收流程 {#fig:flow}\n\n```mermaid\ngraph LR\n A-->B\n```\n\n表：验收表\n\n## 参考文献 {role=bibliography}\n\n文献[^book]。\n\n[^book]: ordinary reference\n';
  await writeFile('/private/tmp/md2pdf-content-sync-acceptance.md', md);
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.navigate', { url });
  await wait('window.mdEditor && document.querySelector("#md-wt-sync")');
  await evaluate('mdEditor.setValue(' + JSON.stringify(md) + ')');
  await wait('window.__MD2PDF_PREVIEW_READY__ && document.querySelector("#preview").srcdoc.includes("token1899") && document.querySelector("#status").textContent.includes("预览已更新")');
  let session = await frame();
  const coverage = await evaluate(`(()=>{const map=JSON.parse(document.querySelector('script[data-md2pdf-content-map]').textContent);return map.map(item=>({id:item.id,kind:item.kind,tag:item.tag,from:item.from,text:item.text.slice(0,40),count:document.querySelectorAll('.pagedjs_pages [data-md2pdf-source-id="'+item.id+'"]').length}));})()`, session);
  assert.ok(coverage.find(item => item.text.startsWith('token0'))?.count > 1, 'a long paragraph has mapped fragments on several pages: ' + JSON.stringify(coverage.slice(0, 9)));
  assert.equal(coverage.filter(item => item.text === '重复段落。' && item.count === 1).length, 2, 'duplicate paragraphs retain distinct source identities');
  assert.ok(coverage.find(item => item.text === 'row84')?.count, 'last table row maps to source');
  assert.ok(coverage.some(item => item.kind === 'math' && item.count), 'formula object maps');
  assert.ok(coverage.some(item => item.kind === 'reference' && item.count), 'bibliography entry maps');
  for (const kind of ['code', 'diagram', 'image']) assert.ok(coverage.some(item => item.kind === kind && item.count), kind + ' maps');
  for (const tag of ['caption', 'figcaption']) assert.ok(coverage.some(item => item.tag === tag && item.count), tag + ' maps without consuming a later paragraph');
  assert.ok(coverage.find(item => item.text === '项目')?.count > 1, 'repeated table headers retain the original source identity');

  const locate = async (from, to = from) => {
    await evaluate(`document.dispatchEvent(new CustomEvent('md-preview-locate',{detail:{from:${from},to:${to},ratio:.3,reason:'cursor',instant:true}}))`);
    await wait('document.querySelector("[data-md2pdf-sync-highlight] > div")', session);
  };
  const target = md.indexOf('token1500');
  await locate(target, target + 9);
  const geometry = await evaluate(`(()=>{const part=[...document.querySelectorAll('.pagedjs_pages p[data-md2pdf-source-id]')].find(node=>node.textContent.includes('token1500'));const walker=document.createTreeWalker(part,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const index=node.data.indexOf('token1500');if(index<0)continue;const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+9);const rect=range.getBoundingClientRect(),mark=document.querySelector('[data-md2pdf-sync-highlight]>div').getBoundingClientRect();return {top:rect.top,left:rect.left,markTop:mark.top,markLeft:mark.left,height:innerHeight,page:part.closest('.pagedjs_page').dataset.pageNumber};}})()`, session);
  assert.ok(Math.abs(geometry.top - geometry.markTop) < 2 && Math.abs(geometry.left - geometry.markLeft) < 2, JSON.stringify(geometry));
  assert.ok(geometry.top >= 0 && geometry.top < geometry.height, 'requested character is visible');

  // Reverse activation uses a visible character, not the enclosing chapter heading.
  const selectionBefore = await evaluate('mdEditor.getSelection()');
  await evaluate(`(()=>{const mark=document.querySelector('[data-md2pdf-sync-highlight]>div').getBoundingClientRect();const target=document.elementFromPoint(mark.left+3,mark.top+3);target.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:mark.left+3,clientY:mark.top+3}));})()`, session);
  await wait('mdEditor.getSelection().from >= ' + target);
  const activated = await evaluate('mdEditor.getSelection().from');
  assert.ok(activated >= target && activated <= target + 9, 'preview double-click locates source characters: ' + activated);
  assert.notDeepEqual(await evaluate('mdEditor.getSelection()'), selectionBefore);
  await wait(`(()=>{const rect=mdEditor.coordsAtPos(${activated});const box=document.querySelector('.cm-scroller').getBoundingClientRect();return rect&&rect.top>=box.top&&rect.bottom<=box.bottom;})()`);

  // Native preview scrolling follows content without moving the edit cursor.
  const fixedCursor = await evaluate('mdEditor.getCursorPosition()');
  await evaluate('document.activeElement.blur(); window.__syncEvents=[];document.addEventListener("md-preview-content-source",event=>__syncEvents.push(event.detail))');
  await evaluate('dispatchEvent(new WheelEvent("wheel"));scrollBy(0,220)', session);
  await wait('window.__syncEvents.some(item=>item.reason==="scroll")');
  assert.equal(await evaluate('mdEditor.getCursorPosition()'), fixedCursor);

  // The flow copy retains mapping; mode switching does not render another PDF.
  await evaluate('document.querySelector("[data-preview-mode-toggle]").click()');
  await wait('document.documentElement.classList.contains("md2pdf-preview-flow")', session);
  await locate(md.indexOf('value84'), md.indexOf('value84') + 7);
  const flow = await evaluate(`(()=>{const node=[...document.querySelectorAll('#md2pdf-preview-flow td')].find(node=>node.textContent==='value84');const rect=node.getBoundingClientRect();return {mapped:node.hasAttribute('data-md2pdf-source-id'),top:rect.top,bottom:rect.bottom,height:innerHeight};})()`, session);
  assert.ok(flow.mapped && flow.top >= 0 && flow.bottom <= flow.height, JSON.stringify(flow));
  await browser.send('Page.captureScreenshot', { format: 'png' }).then(result => writeFile('/private/tmp/md2pdf-content-sync-browser.png', Buffer.from(result.data, 'base64')));

  // The newest selection replaces both the old native range and its mirror.
  await evaluate(`mdEditor.setSelection(${target},${target+9})`);
  await locate(target,target+9);
  const originalSelection = { from: target+9, to: target+9, text: '' };
  await evaluate(`document.querySelector('.preview-panel [data-panel-fullscreen]').click()`);
  await evaluate(`(()=>{const node=[...document.querySelectorAll('#md2pdf-preview-flow td')].find(node=>node.textContent==='value84');node.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));const range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));})()`, session);
  await wait("document.querySelector('.md-sync-highlight')?.textContent === 'value84'");
  await new Promise(resolve=>setTimeout(resolve,2200));
  assert.equal(await evaluate("document.querySelector('.md-sync-highlight')?.textContent"), 'value84', 'fullscreen source highlight persists beyond old timeout');
  assert.deepEqual(await evaluate('mdEditor.getSelection()'), originalSelection, 'preview selection collapses the old source range without moving its caret');
  assert.equal(await evaluate("!!document.querySelector('[data-md2pdf-sync-highlight]>div')",session),false,'preview selection removes old source mirror');
  await evaluate(`document.querySelector('.preview-panel [data-panel-fullscreen]').click()`);
  await new Promise(resolve=>setTimeout(resolve,250));
  for (let round=0;round<3;round++) {
    await evaluate(`document.querySelector('.editor-panel [data-panel-fullscreen]').click()`);
    await wait(`document.querySelector('.workspace').classList.contains('editor-focus')`);
    await new Promise(resolve=>setTimeout(resolve,150));
    await evaluate(`document.querySelector('.editor-panel .md-panel-mode').click()`);
    await wait(`document.querySelector('.workspace').classList.contains('preview-focus')`);
    await new Promise(resolve=>setTimeout(resolve,150));
    await new Promise(resolve=>setTimeout(resolve,250));
    assert.equal(await evaluate('getSelection().toString()',session),'value84','native preview selection survives M/P fullscreen swap');
    await evaluate(`document.querySelector('.preview-panel [data-panel-fullscreen]').click()`);
    await new Promise(resolve=>setTimeout(resolve,250));
    assert.equal(await evaluate('getSelection().toString()',session),'value84','native preview selection survives fullscreen exit');
    assert.equal(await evaluate("document.querySelector('.md-sync-highlight')?.textContent"),'value84','source mirror survives mode changes');
    assert.deepEqual(await evaluate('mdEditor.getSelection()'),originalSelection);
  }
  await evaluate(`mdEditor.setSelection(${target},${target+9})`);
  await locate(target,target+9);
  await wait('getSelection().isCollapsed',session);
  assert.equal(await evaluate("!!document.querySelector('.md-sync-highlight')"),false,'new source selection removes previous preview mirror');
  const selectedSource = await evaluate('mdEditor.getSelection()');
  for(let round=0;round<2;round++) {
    await evaluate(`document.querySelector('.editor-panel [data-panel-fullscreen]').click()`);
    await wait(`document.querySelector('.workspace').classList.contains('editor-focus')`);
    await new Promise(resolve=>setTimeout(resolve,150));
    await evaluate(`document.querySelector('.editor-panel .md-panel-mode').click()`);
    await wait(`document.querySelector('.workspace').classList.contains('preview-focus')`);
    await new Promise(resolve=>setTimeout(resolve,150));
    await evaluate(`document.querySelector('.preview-panel [data-panel-fullscreen]').click()`);
    await new Promise(resolve=>setTimeout(resolve,250));
    assert.deepEqual(await evaluate('mdEditor.getSelection()'),selectedSource,'source selection survives fullscreen round trip');
    assert.ok(await evaluate("!!document.querySelector('[data-md2pdf-sync-highlight]>div')",session),'preview mirror is redrawn after layout: '+JSON.stringify(await evaluate(`({selected:getSelection().toString(),overlay:document.querySelector('[data-md2pdf-sync-highlight]')?.outerHTML,y:scrollY})`,session)));
  }
  await new Promise(resolve=>setTimeout(resolve,2200));
  assert.ok(await evaluate("!!document.querySelector('[data-md2pdf-sync-highlight]>div')",session),'preview source-range mirror no longer expires');
  await evaluate(`document.querySelector('#md-wt-sync').checked=false`);
  await evaluate(`(()=>{const node=[...document.querySelectorAll('#md2pdf-preview-flow td')].find(node=>node.textContent==='value83');const range=document.createRange();range.selectNodeContents(node);getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));})()`, session);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.notEqual(await evaluate("document.querySelector('.md-sync-highlight')?.textContent"), 'value83', 'disabled sync ignores preview selection');

  // Disabled sync keeps each outline local; enabled sync aligns both panels.
  await evaluate(`document.querySelector('#preview-outline-toggle').click()`);
  await wait("document.querySelector('.md-preview-outline button[data-outline-index]')");
  await evaluate(`(()=>{const rows=[...document.querySelectorAll('.md-preview-outline button[data-outline-index]')];rows.find(node=>node.textContent.includes('一个长章')).click();})()`);
  const chapterOffset = md.indexOf('## 一个长章');
  const editorBefore = await evaluate(`document.querySelector('.cm-scroller').scrollTop`);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(await evaluate(`document.querySelector('.cm-scroller').scrollTop`), editorBefore, 'preview outline does not move editor with sync off');
  await wait(`(()=>{const h=[...document.querySelectorAll('#md2pdf-preview-flow h2')].find(node=>node.textContent.includes('一个长章'));return h&&Math.abs(h.getBoundingClientRect().top)<5;})()`,session);
  await evaluate(`document.querySelector('#editor-assistant-toggle').click()`);
  await wait("[...document.querySelectorAll('.md-pro-outline-item')].some(node=>node.textContent.includes('一个长章'))");
  await evaluate(`scrollTo(0,500)`, session);
  await evaluate(`(()=>{const rows=[...document.querySelectorAll('.md-pro-outline-item')];rows.find(node=>node.textContent.includes('一个长章')).click();})()`);
  await wait(`(()=>{const coords=mdEditor.coordsAtPos(${chapterOffset});const box=document.querySelector('.cm-scroller').getBoundingClientRect();return coords&&Math.abs(coords.top-box.top)<5;})()`);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(await evaluate('scrollY',session),500,'editor outline does not move preview with sync off');
  await evaluate(`document.querySelector('#md-wt-sync').checked=true`);
  await evaluate(`(()=>{const rows=[...document.querySelectorAll('.md-pro-outline-item')];rows.find(node=>node.textContent.includes('一个长章')).click();})()`);
  await wait(`(()=>{const h=[...document.querySelectorAll('#md2pdf-preview-flow h2')].find(node=>node.textContent.includes('一个长章'));return h&&Math.abs(h.getBoundingClientRect().top)<5;})()`,session);

  // Outline navigation owns subsequent M/P fullscreen positioning, not the old caret.
  await evaluate(`document.querySelector('.editor-panel [data-panel-fullscreen]').click()`);
  await wait(`document.querySelector('.workspace').classList.contains('editor-focus')`);
    await new Promise(resolve=>setTimeout(resolve,150));
  for(let round=0;round<2;round++) {
    await evaluate(`(()=>{const rows=[...document.querySelectorAll('.md-pro-outline-item')];rows.find(node=>node.textContent.includes('一个长章')).click();})()`);
    await wait(`(()=>{const coords=mdEditor.coordsAtPos(${chapterOffset});const box=document.querySelector('.cm-scroller').getBoundingClientRect();return coords&&Math.abs(coords.top-box.top)<5;})()`);
    await evaluate(`document.querySelector('.editor-panel .md-panel-mode').click()`);
    await wait(`document.querySelector('.workspace').classList.contains('preview-focus')`);
    await new Promise(resolve=>setTimeout(resolve,150));
    await wait(`(()=>{const h=[...document.querySelectorAll('#md2pdf-preview-flow h2')].find(node=>node.textContent.includes('一个长章'));return h&&Math.abs(h.getBoundingClientRect().top)<5;})()`,session);
    await evaluate(`(()=>{const rows=[...document.querySelectorAll('.md-preview-outline button[data-outline-index]')];rows.find(node=>node.textContent.includes('一个长章')).click();})()`);
    await evaluate(`document.querySelector('.preview-panel .md-panel-mode').click()`);
    await wait(`document.querySelector('.workspace').classList.contains('editor-focus')`);
    await new Promise(resolve=>setTimeout(resolve,150));
    await wait(`(()=>{const coords=mdEditor.coordsAtPos(${chapterOffset});const box=document.querySelector('.cm-scroller').getBoundingClientRect();return coords&&Math.abs(coords.top-box.top)<5;})()`);
  }
  await evaluate(`document.querySelector('.editor-panel [data-panel-fullscreen]').click()`);

  // Preview selection -> M/P -> a new source range -> immediate M/P must have one owner.
  for(const pause of [0,250]) {
    await evaluate(`document.querySelector('.preview-panel [data-panel-fullscreen]').click()`);
    await wait(`document.querySelector('.workspace').classList.contains('preview-focus')`);
    await new Promise(r=>setTimeout(r,150));
    await evaluate(`(()=>{const node=[...document.querySelectorAll('#md2pdf-preview-flow td')].find(n=>n.textContent==='value84');node.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));const range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));})()`,session);
    await wait("document.querySelector('.md-sync-highlight')?.textContent==='value84'");
    await evaluate(`document.querySelector('.preview-panel .md-panel-mode').click()`);
    await wait(`document.querySelector('.workspace').classList.contains('editor-focus')`);
    await new Promise(r=>setTimeout(r,150));
    await evaluate(`mdEditor.setSelection(${target},${target+9})`);
    if(pause) await new Promise(r=>setTimeout(r,pause));
    await evaluate(`document.querySelector('.editor-panel .md-panel-mode').click()`);
    await wait(`document.querySelector('.workspace').classList.contains('preview-focus')`);
    await new Promise(r=>setTimeout(r,300));
    assert.equal(await evaluate('getSelection().isCollapsed',session),true,'new source range clears old preview native selection across fullscreen');
    assert.ok(await evaluate("!!document.querySelector('[data-md2pdf-sync-highlight]>div')",session),'new source range keeps its preview mirror');
    assert.deepEqual(await evaluate('mdEditor.getSelection()'),{from:target,to:target+9,text:'token1500'});
    await evaluate(`document.querySelector('.preview-panel [data-panel-fullscreen]').click()`);
    await new Promise(r=>setTimeout(r,200));
  }

  // Outline -> preview selection -> M/P must reveal the mirrored range, even immediately.
  for(const pause of [0,150]) {
    await evaluate(`document.querySelector('.preview-panel [data-panel-fullscreen]').click()`);
    await wait(`document.querySelector('.workspace').classList.contains('preview-focus')`);
    await new Promise(r=>setTimeout(r,150));
    await evaluate(`(()=>{[...document.querySelectorAll('.md-preview-outline button[data-outline-index]')].find(n=>n.textContent.includes('一个长章')).click()})()`);
    await new Promise(r=>setTimeout(r,150));
    await evaluate(`(()=>{const node=[...document.querySelectorAll('#md2pdf-preview-flow p')].find(n=>n.textContent==='重复段落。');node.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));const range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));})()`,session);
    if(pause) await new Promise(r=>setTimeout(r,pause));
    await evaluate(`document.querySelector('.preview-panel .md-panel-mode').click()`);
    await wait(`document.querySelector('.workspace').classList.contains('editor-focus')`);
    await new Promise(r=>setTimeout(r,300));
    const visible=await evaluate(`(()=>{const mark=document.querySelector('.md-sync-highlight'),box=document.querySelector('.cm-scroller').getBoundingClientRect(),r=mark?.getBoundingClientRect();return {text:mark?.textContent,visible:!!r&&r.top>=box.top&&r.bottom<=box.bottom};})()`);
    assert.ok(visible.visible&&visible.text==='重复段落。',JSON.stringify({pause,visible}));
    await evaluate(`document.querySelector('.editor-panel [data-panel-fullscreen]').click()`);
    await new Promise(r=>setTimeout(r,150));
  }

  const gb = '---\ntype: gb\ngb-cover: false\n---\n# 名称\n\n## 范围\n\n:::gb-important\nRepeated\n:::\n\nRepeated\n\n甲[^@n]乙。\n\nH_{2}O and m^{2}\n\n[^@n]: 注内容\n';
  await evaluate('mdEditor.setValue(' + JSON.stringify(gb) + ')');
  await wait('window.__MD2PDF_PREVIEW_READY__ && document.querySelector("#preview").srcdoc.includes("gb-important-paragraph") && document.querySelector("#status").textContent.includes("预览已更新")');
  session = await frame();
  const repeated = await evaluate(`(()=>{const map=JSON.parse(document.querySelector('script[data-md2pdf-content-map]').textContent);return map.filter(item=>item.text==='Repeated').map(item=>({from:item.from,tag:document.querySelector('.pagedjs_pages [data-md2pdf-source-id="'+item.id+'"]')?.tagName}));})()`, session);
  assert.deepEqual(repeated.map(item => item.tag), ['SPAN', 'P'], 'transformed GB important text cannot claim the following identical paragraph');
  assert.notEqual(repeated[0].from, repeated[1].from);
  const scientific = await evaluate(`(()=>{const map=JSON.parse(document.querySelector('script[data-md2pdf-content-map]').textContent);return ['甲乙。','H2O and m2'].map(text=>{const item=map.find(item=>item.text===text);return !!item&&!!document.querySelector('.pagedjs_pages [data-md2pdf-source-id="'+item.id+'"]');});})()`, session);
  assert.deepEqual(scientific, [true, true], 'page-footnote calls and scripts preserve surrounding prose mapping');

  const paper = '---\ntype: paper\n---\n# Paper\n\n## 摘要 {role=abstract}\n\nAbstract text.\n\n## 关键词 {role=keywords}\n\nalpha **beta**; gamma.\n\n## Body\n\nFinal text.\n';
  await evaluate('mdEditor.setValue(' + JSON.stringify(paper) + ')');
  await wait('window.__MD2PDF_PREVIEW_READY__ && document.querySelector("#preview").srcdoc.includes("Abstract text.") && document.querySelector("#status").textContent.includes("预览已更新")');
  session = await frame();
  const keywords = await evaluate(`(()=>{const map=JSON.parse(document.querySelector('script[data-md2pdf-content-map]').textContent),item=map.find(item=>item.text==='alpha beta; gamma.');return item&&document.querySelector('.pagedjs_pages .keywords .summary-content')?.dataset.md2pdfSourceId===String(item.id);})()`, session);
  assert.equal(keywords, true, 'paper keyword paragraph maps after its paragraph wrapper is removed');
  console.log('PASS: bidirectional selection, two-sided outline alignment, character/selection, split paragraphs, duplicate text, nested content, table, formula, bibliography, reverse activation, scrolling and flow mapping at ' + url);
} finally {
  await browser.stop();
  if (app) await app.close();
  await rm(temp, { recursive: true, force: true });
}
