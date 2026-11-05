import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';

const app = process.argv[2] ? null : createApp();
const temp = await mkdtemp('/private/tmp/md2pdf-independent-');
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
      browser.pending.set(id, { resolve: message => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolve(message.result); }, reject });
      browser.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  };
  const evaluate = async (expression, sessionId) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, sessionId);
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression, sessionId) => {
    for (let n = 0; n < 400; n++) {
      if (await evaluate('Boolean(' + expression + ')', sessionId)) return;
      await new Promise(resolve => setTimeout(resolve, 75));
    }
    const status = await evaluate('(window.mdWorkspaceHosts?.query("#status") || document.querySelector("#status"))?.textContent', sessionId).catch(() => 'closed');
    const mode = await evaluate('window.mdPreviewController?.state()', sessionId).catch(() => null);
    throw new Error('timeout: ' + expression + ' / ' + status + ' / ' + JSON.stringify(mode));
  };
  const targetSession = async type => {
    for (let attempt = 0; attempt < 60; attempt++) {
    const targets = (await browser.send('Target.getTargets')).targetInfos.filter(target => target.type === (type === 'thumbnail' ? 'iframe' : type));
    for (const target of targets) {
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      let match = await evaluate(type === 'page' ? '!!document.querySelector("#independent-workspace")' : type === 'thumbnail' ? '!!document.querySelector("#pages")' : 'typeof __md2pdfPreviewSnapshot === "function"', sessionId).catch(() => false);
      if (match && type !== 'page') {
        const probe = target.targetId + ':' + Date.now();
        await evaluate(`parent.postMessage({type:'md2pdf-test-frame-probe',probe:${JSON.stringify(probe)}},'*')`, sessionId);
        await new Promise(resolve => setTimeout(resolve, 50));
        match = await evaluate(`window.frameProbes.includes(${JSON.stringify(probe)})`);
      }
      if (match) return { sessionId, targetId: target.targetId };
      await browser.send('Target.detachFromTarget', { sessionId });
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(type + ' target missing');
  };
  const ready = () => wait('window.__MD2PDF_PREVIEW_READY__ && mdPreviewController.state().ready && mdWorkspaceHosts.query("#status").dataset.error!=="true"');
  const idle = () => wait('window.mdWindowMode.active && !mdWindowMode.busy');
  const normal = () => wait('!mdWindowMode.active && !mdWindowMode.popup && document.querySelector(".editor-panel") && document.querySelector(".preview-panel")');
  const fixture = '# 双窗口验收\n\n## 第一章\n\n' + Array.from({ length: 65 }, (_, i) => '段落 ' + i + '：同一份文档与排版任务。 '.repeat(8)).join('\n\n') + '\n\n## 最后\n\nLAST_CONTENT';
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.navigate', { url });
  await wait('window.mdEditor && window.mdWindowMode && window.mdPreviewController');
  await evaluate(`window.frameProbes=[];window.addEventListener('message',event=>{if(event.data?.type==='md2pdf-test-frame-probe'&&['#preview','.md-preview-thumbnails iframe'].some(selector=>event.source===mdWorkspaceHosts.query(selector)?.contentWindow))frameProbes.push(event.data.probe);})`);
  await evaluate('window.fixture=' + JSON.stringify(fixture) + ';mdEditor.setValue(fixture)');
  await ready();
  assert.equal(await evaluate('document.querySelectorAll("[data-panel-independent]").length'), 2);
  assert.equal(await evaluate('[...document.querySelectorAll("[data-panel-independent]")].every(button=>button.nextElementSibling.matches("[data-panel-fullscreen]"))'), true);

  // Existing fullscreen stays within one window, with only its exit action.
  await evaluate('document.querySelector(".editor-panel [data-panel-fullscreen]").click()');
  await wait('document.querySelector(".workspace").classList.contains("editor-focus")');
  assert.equal(await evaluate('[...document.querySelectorAll("[data-panel-independent]")].every(button=>button.hidden)'), true);
  await evaluate('document.querySelector(".editor-panel .md-panel-mode").click()');
  await wait('document.querySelector(".workspace").classList.contains("preview-focus")');
  await evaluate('document.querySelector(".preview-panel [data-panel-fullscreen]").click()');
  await wait('!document.querySelector(".workspace").classList.contains("preview-focus")');

  await evaluate('window.realOpen=window.open;window.open=()=>null;document.querySelector(".preview-panel [data-panel-independent]").click();window.open=realOpen');
  assert.equal(await evaluate('mdWindowMode.active'), false);
  assert.match(await evaluate('document.querySelector("#status").textContent'), /阻止/);
  const initialFrame = await targetSession('iframe');
  console.log('capture prerequisites', await evaluate('({scripts:document.querySelectorAll("script").length,runtime:!!document.querySelector("script[data-md2pdf-preview-enhance]"),map:!!document.querySelector("script[data-md2pdf-content-map]")})', initialFrame.sessionId));
  // Fault-inject the existing font-warning protocol, rather than change local fonts.
  const fontRevision = await evaluate('mdPreviewController.state().previewRevision');
  await evaluate(`window.__md2pdfFontError={fonts:['md2pdf-window-missing-font']};parent.postMessage({type:'md2pdf-ready',revision:${fontRevision},fonts:['md2pdf-window-missing-font']},'*')`, initialFrame.sessionId);
  await evaluate('window.sameEditor=mdEditor;window.sameFrame=document.querySelector("#preview");window.renderTasks=0;new MutationObserver(()=>{if(new DOMParser().parseFromString(sameFrame.srcdoc,"text/html").querySelector("script[src]"))renderTasks++}).observe(sameFrame,{attributes:true,attributeFilter:["srcdoc"]});window.originalWidth=document.querySelector(".editor-panel").getBoundingClientRect().width;document.querySelector(".preview-panel [data-panel-independent]").click()');
  console.log('open preview window');
  await idle();
  await ready();
  let popup = await targetSession('page');
  assert.equal(await evaluate('!!document.querySelector(".preview-panel") && !document.querySelector(".editor-panel")', popup.sessionId), true);
  assert.equal(await evaluate('mdEditor===sameEditor && mdWorkspaceHosts.query("#preview")===sameFrame'), true);
  assert.equal(await evaluate('renderTasks'), 0, 'opening uses an already-computed result');
  let frame = await targetSession('iframe');
  assert.equal(await evaluate('typeof window.PagedPolyfill', frame.sessionId), 'undefined', 'moving a completed preview does not load Paged.js');
  assert.equal(await evaluate('document.querySelectorAll(".pagedjs_page").length>1', frame.sessionId), true);
  const pageGeometry = await evaluate('(()=>{const panel=document.querySelector(".preview-panel").getBoundingClientRect();return {left:panel.left,right:innerWidth-panel.right,top:panel.top,bottom:innerHeight-panel.bottom};})()', popup.sessionId);
  assert.ok(Object.values(pageGeometry).every(value => Math.abs(value - 12) < 2), JSON.stringify(pageGeometry));
  assert.match(await evaluate('document.querySelector("#status").textContent', popup.sessionId), /md2pdf-window-missing-font/);
  await send('Page.captureScreenshot', { format: 'png' }, popup.sessionId).then(result => writeFile('/private/tmp/md2pdf-independent-preview.png', Buffer.from(result.data, 'base64')));
  await evaluate('document.querySelector("#preview-outline-toggle").click()', popup.sessionId);
  await wait('document.querySelectorAll(".md-preview-outline button[data-outline-index]").length>0', popup.sessionId);
  await evaluate('document.querySelector("#preview-outline-tab-thumbnails").click()', popup.sessionId);
  await wait('document.querySelector(".md-preview-thumbnails iframe")', popup.sessionId);
  let thumbnail = await targetSession('thumbnail');
  await wait('document.querySelectorAll(".page-copy .pagedjs_page").length>0', thumbnail.sessionId);

  await evaluate('mdEditor.setValue(fixture+"\\n\\nREMOTE_UPDATE")');
  await ready();
  assert.equal(await evaluate('renderTasks'), 1, 'content edits run one preview task');
  frame = await targetSession('iframe');
  assert.equal(await evaluate('document.querySelector(".pagedjs_pages").textContent.includes("REMOTE_UPDATE")', frame.sessionId), true);

  await evaluate('document.querySelector(".editor-panel .md-panel-mode").click()');
  console.log('swap to popup editor');
  await wait('mdWindowMode.role==="editor" && !mdWindowMode.busy');
  await ready();
  assert.equal(await evaluate('!!document.querySelector(".editor-panel") && !document.querySelector(".preview-panel")', popup.sessionId), true);
  assert.equal(await evaluate('renderTasks'), 1, 'role swap does not render again');
  assert.equal(await evaluate('mdEditor===sameEditor && mdEditor.getDocumentRoot()===mdWindowMode.popup.document'), true);
  assert.equal(await evaluate('document.querySelector("#preview-outline-tab-thumbnails").getAttribute("aria-selected")'), 'true', 'sidebar view survives role exchange');
  await wait('document.querySelector(".md-preview-thumbnails iframe")');
  thumbnail = await targetSession('thumbnail');
  await wait('document.querySelectorAll(".page-copy .pagedjs_page").length>0', thumbnail.sessionId);
  await evaluate('document.querySelector("#preview-outline-toggle").click()');
  await evaluate('mdEditor.setSelection(mdEditor.getValue().indexOf("REMOTE_UPDATE"),mdEditor.getValue().indexOf("REMOTE_UPDATE")+6)');
  frame = await targetSession('iframe');
  await wait('document.querySelector("[data-md2pdf-sync-highlight]>div")', frame.sessionId);
  await evaluate('mdEditor.setSelection(mdEditor.getValue().length)');
  await evaluate('document.querySelector(".cm-content").focus()', popup.sessionId);
  await send('Input.insertText', { text: '\n\nPOPUP_TYPED' }, popup.sessionId);
  await wait('mdEditor.getValue().includes("POPUP_TYPED")');
  await ready();
  await evaluate('mdEditor.runCommand("undo")');
  await wait('!mdEditor.getValue().includes("POPUP_TYPED")');
  await ready();

  // Shared menus/dialogs live in the same document as their trigger.
  await evaluate('document.querySelector("button[aria-label=\\"基础格式\\"]").click()', popup.sessionId);
  assert.equal(await evaluate('!!document.querySelector(".md-wt-basic-menu:not([hidden])")', popup.sessionId), true);
  await evaluate('document.querySelector("button[aria-label=\\"查找与替换\\"]").click()', popup.sessionId);
  assert.equal(await evaluate('!!document.querySelector(".cm-search")', popup.sessionId), true);
  await send('Page.captureScreenshot', { format: 'png' }, popup.sessionId).then(result => writeFile('/private/tmp/md2pdf-independent-editor.png', Buffer.from(result.data, 'base64')));

  await evaluate('document.querySelector("button[aria-label=\\"从模板创建 Markdown\\"]").click()', popup.sessionId);
  await wait('document.querySelector("#md-create-menu [data-template-id=general]")', popup.sessionId);
  await evaluate('window.dialogChoice=mdConfirmTemplate();true');
  await wait('document.querySelector("dialog[open].template-confirm")', popup.sessionId);
  await evaluate('document.querySelector("dialog[open] .template-confirm-cancel").click()', popup.sessionId);
  assert.equal(await evaluate('dialogChoice'), false);
  assert.equal(await evaluate('mdEditor.getValue().includes("REMOTE_UPDATE")'), true);
  await evaluate(`(()=>{const input=document.querySelector('input[type=file][accept*="markdown"]'),files=new DataTransfer();files.items.add(new File(['# Different file\\n\\n## Body\\n\\nOPENED_FROM_POPUP'],'different.md',{type:'text/markdown'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`, popup.sessionId);
  await wait('mdEditor.getValue().includes("OPENED_FROM_POPUP")'); await ready();

  // Close returns the same live editor, current source and normal pane width.
  await send('Page.close', {}, popup.sessionId);
  console.log('close popup');
  await normal();
  await ready();
  assert.equal(await evaluate('mdEditor===sameEditor && mdEditor.getDocumentRoot()===document'), true);
  assert.equal(await evaluate('mdEditor.getValue().includes("OPENED_FROM_POPUP")'), true);
  assert.ok(await evaluate('Math.abs(document.querySelector(".editor-panel").getBoundingClientRect().width-originalWidth)<2'));

  await evaluate('document.querySelector(".editor-panel [data-panel-independent]").click()');
  await idle();
  popup = await targetSession('page');
  await send('Page.reload', {}, popup.sessionId).catch(() => {});
  await normal();
  await ready();
  await evaluate('document.querySelector(".preview-panel [data-panel-independent]").click();document.querySelector(".preview-panel [data-panel-independent]").click()');
  await idle(); await ready();
  const pages = (await browser.send('Target.getTargets')).targetInfos.filter(target => target.type === 'page' && target.url === 'about:blank');
  assert.equal(pages.length, 1, 'repeated clicks cannot create another independent view');

  // A capture from the previous document cannot overwrite a newer edit.
  await evaluate(`window.normalTransport=mdWorkspaceHosts.frameTransport;mdWorkspaceHosts.frameTransport=(frame,data)=>{if(data.type==='md2pdf-transfer-capture')setTimeout(()=>normalTransport(frame,data),120);else normalTransport(frame,data)};mdWindowMode.swap();mdEditor.setValue(fixture+'\\n\\nRACE_LATEST');`);
  await wait('!mdWindowMode.busy'); await ready();
  assert.equal(await evaluate('mdWindowMode.role'), 'preview');
  await evaluate('mdWorkspaceHosts.frameTransport=normalTransport');
  frame = await targetSession('iframe');
  assert.equal(await evaluate('document.querySelector(".pagedjs_pages").textContent.includes("RACE_LATEST")', frame.sessionId), true);

  // Position reports include keyboard/programmatic scrolling, even with sync off.
  await evaluate('document.querySelector("#md-wt-sync").checked=false;window.lastWindowPosition=null;window.addEventListener("message",event=>{if(event.data?.type==="md2pdf-position"&&event.data.id==="window-position")lastWindowPosition=event.data.position})');
  await evaluate('scrollTo(0,1500)', frame.sessionId);
  await wait('lastWindowPosition?.from > 500');
  const beforeClose = await evaluate('lastWindowPosition.from');
  popup = await targetSession('page');
  await send('Page.close', {}, popup.sessionId);
  await normal(); await ready(); await wait('!mdWindowMode.restoring');
  frame = await targetSession('iframe');
  await evaluate('window.afterClosePosition=null;window.addEventListener("message",event=>{if(event.data?.id==="after-close-position")afterClosePosition=event.data.position});mdWorkspaceHosts.postPreview({type:"md2pdf-capture-position",id:"after-close-position"})');
  await wait('afterClosePosition');
  assert.ok(Math.abs(await evaluate('afterClosePosition.from') - beforeClose) < 100, 'forced close restores the latest reading position');

  await evaluate('document.querySelector(".preview-panel [data-panel-independent]").click()');
  await idle(); await ready();
  await evaluate('document.querySelector(".editor-panel [data-panel-fullscreen]").click()');
  await normal(); await ready();

  // Clearing and disconnecting a popup must not resurrect an older document.
  await evaluate('document.querySelector(".preview-panel [data-panel-independent]").click()');
  await idle(); await ready(); popup = await targetSession('page');
  await evaluate('mdEditor.setValue("")');
  await wait('mdPreviewController.state().empty');
  await send('Page.close', {}, popup.sessionId);
  await normal();
  assert.equal(await evaluate('mdEditor.getValue()'), '');
  assert.equal(await evaluate('document.querySelector("#preview").getAttribute("srcdoc") || ""'), '');
  await evaluate('mdEditor.setValue("# Reconnected\\n\\nContent after clearing.")'); await ready();
  await evaluate('document.querySelector(".editor-panel [data-panel-independent]").click()'); await idle();
  popup = await targetSession('page');
  await evaluate('mdEditor.setSelection(mdEditor.getValue().length)');
  await evaluate('document.querySelector(".cm-content").focus()', popup.sessionId);
  await send('Input.insertText', { text: '\n\nCLOSE_BEFORE_DEBOUNCE' }, popup.sessionId);
  await send('Page.close', {}, popup.sessionId);
  await normal(); await ready();
  assert.equal(await evaluate('mdEditor.getValue().includes("CLOSE_BEFORE_DEBOUNCE")'), true);
  frame = await targetSession('iframe');
  assert.equal(await evaluate('document.querySelector(".pagedjs_pages").textContent.includes("CLOSE_BEFORE_DEBOUNCE")', frame.sessionId), true, 'closing a timer host cannot lose its queued preview');
  await evaluate('document.querySelector(".editor-panel [data-panel-independent]").click()'); await idle();
  popup = await targetSession('page');
  await evaluate('window.opener=null', popup.sessionId);
  await normal(); await ready();
  const screenshot = await browser.send('Page.captureScreenshot', { format: 'png' });
  await writeFile('/private/tmp/md2pdf-independent-windows.png', Buffer.from(screenshot.data, 'base64'));
  console.log('PASS: window/fullscreen entries, blocked popup, computed preview transfer, one render task, role swaps, editor typing/undo, menus, close/reopen/reload and layout recovery at ' + url);
} finally {
  await browser.stop();
  if (app) await app.close();
  await rm(temp, { recursive: true, force: true });
}
