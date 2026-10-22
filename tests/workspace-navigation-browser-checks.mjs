import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { enhancePreview } from '../src/preview.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';
const app = createApp();
const temp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-navigation-'));
const browser = new Chrome(findChrome(), temp);
try {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  await browser.start();
  const send = (method, params, sessionId) => {
    if (!sessionId) return browser.send(method, params);
    const id = ++browser.id;
    return new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(new Error(method+' session timeout')),20000);
      browser.pending.set(id,{resolve:message=>{clearTimeout(timer);message.error?reject(new Error(message.error.message)):resolve(message.result)},reject});
      browser.ws.send(JSON.stringify({id,method,params,sessionId}));
    });
  };
  const evaluate = async (expression, sessionId) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true }, sessionId);
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = expression => (console.log('waiting:', expression), evaluate(`new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(${expression}){clearInterval(timer);resolve(true)}else if(++n>150){clearInterval(timer);reject(new Error('timeout'))}},100)})`));
  await browser.send('Page.navigate', {url});
  await wait('window.mdEditor');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#examples-link-top [data-nav-icon=templates]')).display`),'block');
  assert.equal(await evaluate(`document.querySelector('#editor-link-top').getAttribute('aria-current')`),'page');
  const md = '# 验收\n\n'+Array.from({length:30},(_,i)=>'## 章节'+i+'\n\n正文内容。\n\n').join('');
  await evaluate(`mdEditor.setValue(${JSON.stringify(md)})`);
  await wait('document.querySelector("#preview").srcdoc.length>100');
  await evaluate(`new Promise(resolve=>setTimeout(resolve,500))`);
  // A deterministic paginated fixture isolates navigation from the pagination engine.
  const fixture = enhancePreview('<!doctype html><html><body><div class="pagedjs_pages">'+Array.from({length:10},(_,i)=>'<div class="pagedjs_page" style="width:700px;height:1000px"><h2 data-md2pdf-source-line="'+(i*5+3)+'">章节'+i+'</h2></div>').join('')+'</div></body></html>');
  await evaluate(`document.querySelector('#preview').srcdoc=${JSON.stringify(fixture)}`);
  await evaluate(`new Promise(resolve=>setTimeout(resolve,500))`);
  await evaluate(`window.downloads=[];document.addEventListener('click',e=>{if(e.target.tagName==='A'&&e.target.download){downloads.push(e.target.download);e.preventDefault()}},true);
    window.opens=0;document.querySelector('input[type=file]').addEventListener('click',e=>{opens++;e.preventDefault()});
    window.pdfClicks=0;document.querySelector('#download').addEventListener('click',e=>{pdfClicks++;e.stopImmediatePropagation()},true);`);
  for (const [key, counter] of [['s','downloads.length'],['o','opens'],['p','pdfClicks']]) {
    assert.equal(await evaluate(`(()=>{const e=new KeyboardEvent('keydown',{key:'${key}',ctrlKey:true,bubbles:true,cancelable:true});document.dispatchEvent(e);return e.defaultPrevented})()`),true);
    await wait(counter + '>0');
  }
  const targets = (await browser.send('Target.getTargets')).targetInfos;
  const frame = targets.find(target=>target.type==='iframe');
  assert.ok(frame, JSON.stringify(targets));
  const {sessionId:executionContextId}=await browser.send('Target.attachToTarget',{targetId:frame.targetId,flatten:true});
  assert.equal(await evaluate(`(()=>{const e=new KeyboardEvent('keydown',{key:'s',metaKey:true,bubbles:true,cancelable:true});document.dispatchEvent(e);return e.defaultPrevented})()`,executionContextId),true);
  await wait('downloads.length===2');
  await evaluate(`document.querySelector('.md-panel-sync').click();document.querySelector('.cm-scroller').scrollTop=500;window.editorAnchor=mdEditor.captureViewport()`);
  const position = await evaluate(`(()=>{scrollTo(0,1400);const node=Array.from(document.querySelectorAll('[data-md2pdf-source-line]')).find(node=>node.getBoundingClientRect().top>=0);window.positionNode=node;return node.getBoundingClientRect().top/document.documentElement.clientWidth})()`,executionContextId);
  await evaluate(`document.querySelector('.preview-panel button[aria-label="预览全屏"]').click()`);
  await wait('document.querySelector(".workspace").classList.contains("preview-focus")');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.md-panel-sync')).display`),'none');
  await evaluate(`new Promise(resolve=>setTimeout(resolve,400))`);
  const fullPosition = await evaluate(`positionNode.getBoundingClientRect().top/document.documentElement.clientWidth`,executionContextId);
  assert.ok(Math.abs(fullPosition-position)<0.05, 'preview logical anchor preserved on fullscreen entry');
  assert.equal(await evaluate(`document.querySelector('.md-panel-sync').getAttribute('aria-pressed')`),'false');
  await evaluate(`document.querySelector('.preview-panel button[aria-label="退出预览全屏"]').click()`);
  await wait('!document.querySelector(".workspace").classList.contains("preview-focus")');
  await evaluate(`new Promise(resolve=>setTimeout(resolve,400))`);
  const restored = await evaluate(`positionNode.getBoundingClientRect().top/document.documentElement.clientWidth`,executionContextId);
  assert.ok(Math.abs(restored-position)<0.05, 'preview logical anchor preserved on fullscreen exit');
  assert.equal(await evaluate(`mdEditor.captureViewport().from===editorAnchor.from`),true);
  assert.equal(await evaluate(`document.querySelector('.md-panel-sync').getAttribute('aria-pressed')`),'false');
  await evaluate(`document.querySelector('.md-panel-sync').click();document.querySelector('.editor-panel button[aria-label="Markdown 全屏写作"]').click()`);
  await wait('document.querySelector(".workspace").classList.contains("editor-focus")');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.md-panel-sync')).display`),'none');
  await evaluate(`mdEditor.goToLine(33)`);
  await evaluate(`new Promise(resolve=>setTimeout(resolve,700))`);
  await evaluate(`document.querySelector('.editor-panel button[aria-label="退出 Markdown 全屏"]').click()`);
  await wait('!document.querySelector(".workspace").classList.contains("editor-focus")');
  await evaluate(`new Promise(resolve=>setTimeout(resolve,500))`);
  assert.equal(await evaluate('mdEditor.getCursorLine()'),33);
  assert.equal(await evaluate(`document.querySelector('.md2pdf-preview-target')?.getAttribute('data-md2pdf-source-line')`,executionContextId),'33');
  assert.ok(Math.abs(await evaluate(`document.querySelector('[data-md2pdf-source-line="33"]').getBoundingClientRect().top`,executionContextId)) < 3, 'return from writing fullscreen aligns visible preview with latest H2');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.md-panel-sync')).display`),'flex');
  assert.match(await evaluate(`document.querySelector('[data-control=type] [data-option-trigger=type]').getAttribute('aria-label')`),/^模板/);
  // Effective frontmatter type, not a template origin ID, controls the library.
  await evaluate(`mdEditor.setValue(${JSON.stringify('---\ntype: paper\n---\n# 测试')})`);
  await wait('document.querySelector("#status").textContent === "预览已更新"');
  await browser.send('Page.navigate',{url:url+'/examples'});
  await wait('document.querySelector(".example-card[aria-current=true]")');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.example-card')).map(card=>card.dataset.id).join(',')`),'general,paper,gb,skill');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#examples-link-top [data-nav-icon=templates]')).display`),'block');
  assert.equal(await evaluate(`document.querySelector('#examples-link-top').getAttribute('aria-current')`),'page');
  assert.equal(await evaluate(`document.querySelector('.example-card[aria-current=true]').dataset.currentTemplate`),'true');
  assert.equal(await evaluate(`document.querySelector('.example-card[aria-current=true] .type-badge').textContent`),'学术论文');
  await wait('document.querySelector(".example-card[data-id=general] iframe")');
  await wait('document.querySelector(".example-card[data-id=general] .template-card-snapshot").hidden');
  assert.equal(await evaluate(`document.querySelectorAll('.example-card iframe').length`),1);
  assert.equal(await evaluate(`document.querySelectorAll('.template-card-snapshot').length`),4);
  assert.equal(await evaluate(`document.querySelectorAll('.template-preview-toggle input:checked').length`),1);
  await evaluate(`document.querySelector('.example-card[data-id=general] .template-preview-toggle input').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.example-card iframe').length`),0,'turning preview off destroys the iframe');
  assert.equal(await evaluate(`document.querySelector('.example-card[data-id=general] .template-card-snapshot').hidden`),false);
  await evaluate(`document.querySelector('.example-card[data-id=general] .template-preview-toggle input').click()`);
  await wait('document.querySelector(".example-card[data-id=general] iframe")');
  await wait('document.querySelector(".example-card[data-id=general] .template-card-snapshot").hidden');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.template-preview-toggle input')).paddingLeft`),'0px','switch does not inherit text-input padding');
  let liveGeometry;
  for (const target of (await browser.send('Target.getTargets')).targetInfos.filter(target=>target.type==='iframe')) {
    const {sessionId}=await browser.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    const geometry=await evaluate(`(()=>{if(!document.documentElement.classList.contains('md2pdf-template-card'))return null;const pages=document.querySelectorAll('.pagedjs_page'),first=pages[0].getBoundingClientRect();return {top:first.top,left:first.left,width:first.width,viewportWidth:document.documentElement.clientWidth,viewportHeight:innerHeight,secondTop:pages[1]?.getBoundingClientRect().top,scrollY}})()`,sessionId);
    await browser.send('Target.detachFromTarget',{sessionId});
    if(geometry)liveGeometry=geometry;
  }
  assert.ok(liveGeometry,'inspect the actual live card document');
  assert.ok(Math.abs(liveGeometry.top-12)<1 && Math.abs(liveGeometry.left-12)<1,JSON.stringify(liveGeometry));
  assert.ok(Math.abs(liveGeometry.width-liveGeometry.viewportWidth+24)<1,JSON.stringify(liveGeometry));
  assert.equal(liveGeometry.scrollY,0);
  assert.ok(liveGeometry.secondTop>liveGeometry.viewportHeight,'the second page remains below the card viewport');
  for (const id of ['paper','gb','skill']) {
    await evaluate(`document.querySelector('.example-card[data-id=${id}]').scrollIntoView();document.querySelector('.example-card[data-id=${id}] .template-preview-toggle input').click()`);
    await wait(`document.querySelector('.example-card[data-id=${id}] .template-card-snapshot').hidden`);
    assert.equal(await evaluate(`document.querySelector('.example-card[data-id=${id}] iframe').style.opacity`),'1');
    await evaluate(`document.querySelector('.example-card[data-id=${id}] .template-preview-toggle input').click()`);
    assert.equal(await evaluate(`document.querySelector('.example-card[data-id=${id}] iframe') === null`),true);
  }
  const cardGeometry = await evaluate(`(()=>{const card=document.querySelector('.example-card'), preview=card.querySelector('.template-card-preview'), frame=preview.querySelector('iframe'), style=getComputedStyle(frame);return {width:card.clientWidth,height:parseFloat(getComputedStyle(preview).height),top:parseFloat(style.top),left:parseFloat(style.left),frameWidth:parseFloat(style.width),frameHeight:parseFloat(style.height)}})()`);
  assert.ok(Math.abs(cardGeometry.height-((cardGeometry.width-24)*297/210+24))<1,'template preview height fits one A4 page and equal gray margins');
  assert.deepEqual([cardGeometry.top,cardGeometry.left,cardGeometry.frameWidth],[0,0,cardGeometry.width]);
  assert.ok(Math.abs(cardGeometry.frameHeight-cardGeometry.height)<=1,'preview frame clips before the second page');
  assert.match(await evaluate(`document.querySelector('.example-card[aria-current=true] .type-badge').title`),/^当前模板：/);
  assert.ok(await evaluate(`document.querySelector('.example-card[aria-current=true] .type-badge').classList.contains('is-current')`));
  await evaluate(`document.querySelector('#editor-link-top').click()`);
  await wait('document.querySelector("[data-view=editor]").hidden === false');
  await evaluate(`mdEditor.setValue(${JSON.stringify('---\ntype: skill\n---\n# 测试')})`);
  await wait('JSON.parse(sessionStorage.getItem("md2pdf:draft") || "{}").previewType === "skill"');
  assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('md2pdf:draft')).previewType`),'skill');
  await evaluate(`document.querySelector('#examples-link-top').click()`);
  await wait('document.querySelector(".example-card[aria-current=true]")?.dataset.id === "skill"');
  assert.equal(await evaluate(`document.querySelector('.example-card[aria-current=true] .type-badge').textContent`),'技能文档');
  assert.equal(await evaluate(`Promise.all(Array.from(document.querySelectorAll('.template-card-snapshot'),img=>fetch(img.src).then(async response=>response.ok&&response.headers.get('content-type').startsWith('image/png')&&(await response.arrayBuffer()).byteLength>1000))).then(results=>results.every(Boolean))`),true);
  await evaluate(`window.mdConfirmTemplate=async()=>true;document.querySelector('.example-card[data-id=paper] [data-create-template]').click()`);
  await wait('JSON.parse(sessionStorage.getItem("md2pdf:draft") || "{}").templateId === "paper" && document.querySelector("[data-view=editor]").hidden === false');
  assert.equal(await evaluate(`document.querySelector('.example-card[data-id=paper] iframe') === null`),true,'creating from a static card does not require its live preview');

  // Vertical panels use the whole visible workspace when there is enough room,
  // otherwise each panel is a viewport-sized page with a compact sync row.
  await evaluate(`mdEditor.setValue(${JSON.stringify('# Long layout fixture\n\n'+Array.from({length:500},(_,i)=>'Line '+i+' — enough text to exercise editor scrolling.').join('\n'))})`);
  await browser.send('Emulation.setDeviceMetricsOverride',{width:800,height:1200,deviceScaleFactor:1,mobile:false});
  await wait('document.querySelector(".workspace").classList.contains("md-wt-stack-fit")');
  const fitGeometry=await evaluate(`(()=>{const w=document.querySelector('.workspace'),e=document.querySelector('.editor-panel').getBoundingClientRect(),p=document.querySelector('.preview-panel').getBoundingClientRect();return {height:w.getBoundingClientRect().height,editor:e.height,preview:p.height,bottom:p.bottom,viewport:innerHeight,mode:w.classList.contains('md-wt-stack-fit')}})()`);
  assert.ok(fitGeometry.mode && Math.abs(fitGeometry.editor-fitGeometry.preview)<1,JSON.stringify(fitGeometry));
  assert.ok(fitGeometry.bottom<=fitGeometry.viewport+1,JSON.stringify(fitGeometry));

  await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await wait('document.querySelector(".workspace").classList.contains("md-wt-stack-scroll")');
  const phoneGeometry=await evaluate(`(()=>{const w=document.querySelector('.workspace'),e=document.querySelector('.editor-panel').getBoundingClientRect(),p=document.querySelector('.preview-panel').getBoundingClientRect(),s=document.querySelector('.md-panel-sync').getBoundingClientRect();return {editor:e.height,preview:p.height,gap:p.top-e.bottom,sync:s.height,viewport:visualViewport.height,document:document.documentElement.scrollHeight,panelCss:getComputedStyle(document.querySelector('.editor-panel')).height}})()`);
  assert.ok(Math.abs(phoneGeometry.editor-phoneGeometry.preview)<1,JSON.stringify(phoneGeometry));
  assert.ok(Math.abs(phoneGeometry.gap-32)<1 && Math.abs(phoneGeometry.sync-30)<1,JSON.stringify(phoneGeometry));
  assert.ok(phoneGeometry.document>phoneGeometry.viewport,JSON.stringify(phoneGeometry));
  assert.ok(await evaluate(`document.querySelector('.cm-scroller').scrollHeight>document.querySelector('.cm-scroller').clientHeight`),'long document should scroll inside the editor panel');

  await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:720,deviceScaleFactor:1,mobile:true});
  await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  const keyboardGeometry=await evaluate(`({viewport:visualViewport.height,panel:parseFloat(getComputedStyle(document.querySelector('.editor-panel')).height)})`);
  assert.ok(keyboardGeometry.viewport<phoneGeometry.viewport && keyboardGeometry.panel<phoneGeometry.editor,JSON.stringify({phoneGeometry,keyboardGeometry}));

  await evaluate(`document.querySelector('.md-panel-mode').click()`);
  assert.ok(await evaluate(`document.querySelector('.workspace').classList.contains('panels-reversed')`),'M/P must keep exchange available in vertical layout');
  assert.ok(await evaluate(`document.querySelector('.editor-panel').getBoundingClientRect().top>document.querySelector('.preview-panel').getBoundingClientRect().top`),'exchange should reverse the vertical panel order');
  await evaluate(`document.querySelector('.editor-panel button[aria-label="Markdown 全屏写作"]').click()`);
  await wait('document.querySelector(".workspace").classList.contains("editor-focus")');
  assert.equal(await evaluate(`document.querySelector('.workspace').classList.contains('md-wt-stack-scroll')`),false,'fullscreen must bypass stacked panel sizing');
  await evaluate(`document.querySelector('.editor-panel button[aria-label="退出 Markdown 全屏"]').click()`);
  await wait('!document.querySelector(".workspace").classList.contains("editor-focus")');
  assert.ok(await evaluate(`document.querySelector('.workspace').classList.contains('md-wt-stack-scroll')`),'exit fullscreen should restore visible-height mode');
  await evaluate(`document.querySelector('.preview-panel button[aria-label="预览全屏"]').click()`);
  await wait('document.querySelector(".workspace").classList.contains("preview-focus")');
  assert.equal(await evaluate(`document.querySelector('.workspace').classList.contains('md-wt-stack-scroll')`),false);
  await evaluate(`document.querySelector('.preview-panel button[aria-label="退出预览全屏"]').click()`);
  await wait('!document.querySelector(".workspace").classList.contains("preview-focus")');

  await browser.send('Emulation.setDeviceMetricsOverride',{width:1200,height:800,deviceScaleFactor:1,mobile:false});
  await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  const horizontalGeometry=await evaluate(`(()=>{const w=document.querySelector('.workspace'),e=document.querySelector('.editor-panel').getBoundingClientRect(),p=document.querySelector('.preview-panel').getBoundingClientRect();return {stack:w.classList.contains('md-wt-stack-fit')||w.classList.contains('md-wt-stack-scroll'),sameRow:Math.abs(e.top-p.top)<1,sameHeight:Math.abs(e.height-p.height)<1,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
  assert.deepEqual(horizontalGeometry,{stack:false,sameRow:true,sameHeight:true,overflow:false});
  await browser.send('Emulation.clearDeviceMetricsOverride');
  console.log('Chromium: document/iframe navigation, template selection, stacked viewport sizing, fullscreens, and horizontal layout passed');
} catch (error) {
  try { console.log(await browser.send('Runtime.evaluate',{expression:`JSON.stringify({status:document.querySelector('#status')?.textContent,editor:!!window.mdEditor,preview:document.querySelector('#preview')?.srcdoc.slice(-100)})`,returnByValue:true})); } catch {}
  throw error;
} finally {
  await browser.stop();
  await app.close();
  await rm(temp,{recursive:true,force:true});
}
