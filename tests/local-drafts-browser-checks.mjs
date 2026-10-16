import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';

const app = createApp();
const temp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-drafts-'));
const browser = new Chrome(findChrome(), temp);
const evaluate = async expression => {
  if (expression.includes('await ') && !expression.startsWith('(async()=>')) {
    expression = expression.startsWith('await ') || expression.includes(';') ? `(async()=>{${expression}})()` : `(async()=>(${expression}))()`;
  }
  const result = await browser.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const wait = async expression => {
  for (let n = 0; n < 300; n++) {
    try { if (await evaluate(`Boolean(${expression})`)) return; } catch (error) {
      if (!/navigated|context|Cannot find/.test(error.message)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timeout: ' + expression);
};
const reload = async () => {
  const previous = await evaluate('performance.timeOrigin');
  await browser.send('Page.reload');
  await wait(`performance.timeOrigin!==${previous} && window.mdDrafts && window.mdEditor`);
};
const openMenu = async () => {
  await evaluate(`document.querySelector('button[aria-label="打开 Markdown"]').click()`);
  await wait(`document.querySelector('#md-drafts-menu:not([hidden]) [data-draft-open]')`);
};
const accept = async text => {
  await wait(`document.querySelector('dialog[open]')`);
  assert.equal(await evaluate(`document.querySelector('dialog[open] p').textContent`), text);
  assert.equal(await evaluate(`!!document.querySelector('dialog[open] .primary') && !!document.querySelector('dialog[open] .template-confirm-cancel')`),true);
  await evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='删除').click()`);
  await wait(`!document.querySelector('dialog[open]')`);
};
try {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  await browser.start();
  // Seed the old session format before the application starts.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `if(!sessionStorage.getItem('test-seeded')){sessionStorage.setItem('test-seeded','1');sessionStorage.setItem('md2pdf:draft',JSON.stringify({md:'# 旧草稿',opts:{fontSize:'12'},savedAt:1}))}` });
  await browser.send('Page.navigate', { url });
  await wait('window.mdDrafts && window.mdEditor');
  await evaluate('mdDrafts.flush()');
  assert.equal(await evaluate('mdEditor.getValue()'), '# 旧草稿');
  assert.equal(await evaluate('document.querySelector("#options").elements.fontSize.value'), '12');
  assert.equal(await evaluate('(await mdDrafts.store.list()).length'), 1);
  const firstId = await evaluate('mdDrafts.current()');
  await evaluate(`mdEditor.setValue('# 改名后的标题'); await mdDrafts.flush()`);
  assert.deepEqual(await evaluate('(await mdDrafts.store.list()).map(d=>({id:d.id,title:d.title}))'), [{ id: firstId, title: '改名后的标题' }]);
  // Import creates a distinct document, persists the previous one, and uses filename only as fallback.
  await evaluate(`(()=>{const files=new DataTransfer();files.items.add(new File(['没有标题的正文'],'A.md',{type:'text/markdown'}));const input=document.querySelector('input[type=file]');input.files=files.files;input.dispatchEvent(new Event('change'))})()`);
  await wait(`mdDrafts.current()!==${JSON.stringify(firstId)}`);
  await evaluate('mdDrafts.flush()');
  const secondId = await evaluate('mdDrafts.current()');
  assert.notEqual(secondId, firstId);
  assert.equal(await evaluate('(await mdDrafts.store.get(mdDrafts.current())).title'), 'A');
  await evaluate(`mdEditor.setValue(${JSON.stringify('---\ntitle: B\n---\n# 其他标题')}); await mdDrafts.flush()`);
  assert.equal(await evaluate('mdDrafts.current()'), secondId);
  assert.equal(await evaluate('(await mdDrafts.store.get(mdDrafts.current())).title'), 'B');
  // A fresh browser session has no sessionStorage but shares durable IndexedDB.
  await evaluate('await mdDrafts.flush(); sessionStorage.removeItem("md2pdf:draft")');
  await reload();
  assert.equal(await evaluate('mdDrafts.current()'), secondId);
  assert.match(await evaluate('mdEditor.getValue()'), /title: B/);
  await openMenu();
  await evaluate(`document.querySelector('[data-draft-open="${firstId}"]').click()`);
  await wait(`window.mdDrafts.current()===${JSON.stringify(firstId)}`);
  assert.equal(await evaluate('mdEditor.getValue()'), '# 改名后的标题');
  assert.equal(await evaluate('document.querySelector("#options").elements.fontSize.value'), '12');
  // Cancel is a no-op. Current deletion closes the document and does not recreate it on reload.
  await openMenu();
  await evaluate(`document.querySelector('[data-draft-delete="${firstId}"]').click()`);
  await wait(`document.querySelector('dialog[open]')`);
  await evaluate(`document.querySelector('dialog[open] button').click()`);
  assert.equal(await evaluate('mdDrafts.current()'), firstId);
  await evaluate(`document.querySelector('[data-draft-delete="${firstId}"]').click()`);
  await accept('当前正在编辑“改名后的标题”，确认删除？');
  await wait('mdDrafts.current()===null && mdEditor.getValue()===""');
  await evaluate('mdDrafts.flush()');
  assert.equal(await evaluate(`!!(await mdDrafts.store.get(${JSON.stringify(firstId)}))`), false);
  await reload();
  assert.equal(await evaluate('mdEditor.getValue()'), '');
  // More than ten records: remove only the displayed snapshot, refill from hidden records.
  await evaluate(`for(let i=0;i<12;i++)await mdDrafts.openFile('# 文档'+i,'doc'+i+'.md'); await mdDrafts.flush()`);
  await openMenu();
  assert.equal(await evaluate('document.querySelectorAll("[data-draft-open]").length'), 10);
  const before = await evaluate('(await mdDrafts.store.list()).length');
  const tenth = await evaluate('[...document.querySelectorAll("[data-draft-open]")][9].dataset.draftOpen');
  const removing = await evaluate('(await mdDrafts.store.list())[1]');
  await evaluate(`document.querySelector('[data-draft-delete="${removing.id}"]').click()`);
  await accept(`确认删除草稿“${removing.title}”？`);
  await wait(`document.querySelectorAll('[data-draft-open]').length===10 && !document.querySelector('[data-draft-open="${removing.id}"]')`);
  assert.equal(await evaluate('(await mdDrafts.store.list()).length'), before - 1);
  assert.ok(await evaluate(`!!document.querySelector('[data-draft-open="${tenth}"]')`));
  const visible = await evaluate('[...document.querySelectorAll("[data-draft-open]")].map(b=>b.dataset.draftOpen)');
  const hidden = await evaluate(`(await mdDrafts.store.list()).filter(d=>!${JSON.stringify(visible)}.includes(d.id)).map(d=>d.id)`);
  assert.equal(hidden.length, 2);
  await evaluate(`document.querySelector('.md-drafts-clear').click()`);
  await accept('当前列表中的全部草稿，确认删除？');
  await wait('document.querySelectorAll("[data-draft-open]").length===2');
  assert.deepEqual((await evaluate('(await mdDrafts.store.list()).map(d=>d.id)')).sort(), hidden.sort());
  assert.equal(await evaluate('mdEditor.getValue()'), '');
  const other = hidden[0];
  const otherTitle = await evaluate(`(await mdDrafts.store.get(${JSON.stringify(other)})).title`);
  await evaluate(`document.querySelector('[data-draft-delete="${other}"]').click()`);
  await accept(`确认删除草稿“${otherTitle}”？`);
  await wait('document.querySelectorAll("[data-draft-open]").length===1');
  // Direct second-client writes exercise IDB transaction concurrency, not a mock store.
  assert.deepEqual(await evaluate(`(async()=>{
    const {openDraftStore}=await import('/draft-store.mjs');const other=await openDraftStore();
    const first=await other.save({id:crypto.randomUUID(),version:0,md:'# 并发',opts:{}});
    await mdDrafts.store.save({...first,md:'# 新版本'});
    let conflict=false,deleted=false;
    try{await other.save({...first,md:'# 旧版本'})}catch{conflict=true}
    const current=await other.get(first.id);await other.remove([current]);
    try{await mdDrafts.store.save({...current,md:'# 复活'})}catch{deleted=true}
    other.close();return {conflict,deleted};
  })()`), { conflict: true, deleted: true });
  // Mobile menu stays inside the visual viewport and names remain bounded with a full tooltip.
  await browser.send('Emulation.setDeviceMetricsOverride', { width:390, height:720, deviceScaleFactor:1, mobile:true });
  await evaluate(`document.querySelector('#md-drafts-menu').hidden=true;await mdDrafts.openFile('# '+ '超长草稿标题'.repeat(20),'long.md')`);
  await openMenu();
  assert.ok(await evaluate(`(()=>{const menu=document.querySelector('#md-drafts-menu'),r=menu.getBoundingClientRect(),v=visualViewport;const name=menu.querySelector('.md-draft-title');return r.left>=v.offsetLeft&&r.right<=v.offsetLeft+v.width+1&&r.top>=v.offsetTop&&r.bottom<=v.offsetTop+v.height+1&&name.scrollWidth>name.clientWidth&&menu.querySelector('[data-draft-open]').title.length>20})()`));
  assert.ok(await evaluate(`(()=>{const menu=document.querySelector('#md-drafts-menu'),row=menu.querySelector('.md-draft-row'),title=row.querySelector('.md-draft-title').getBoundingClientRect(),mark=row.querySelector('.md-draft-mark').getBoundingClientRect(),del=row.querySelector('.md-draft-delete').getBoundingClientRect();return menu.getBoundingClientRect().width<=276&&parseFloat(getComputedStyle(menu).fontSize)<=parseFloat(getComputedStyle(document.querySelector('.cm-content')).fontSize)&&Math.abs(title.top-mark.top)<1&&Math.abs(title.top-(del.top+parseFloat(getComputedStyle(row.querySelector('.md-draft-delete')).paddingTop)))<1&&Math.abs((title.left-mark.right)-(del.left-title.right))<1})()`));
  await evaluate(`document.querySelector('#md-drafts-menu').dispatchEvent(new PointerEvent('pointerleave',{pointerType:'touch'}))`);
  assert.equal(await evaluate(`document.querySelector('#md-drafts-menu').hidden`),false);
  await evaluate(`document.querySelector('#md-drafts-menu').dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}))`);
  assert.equal(await evaluate(`document.querySelector('#md-drafts-menu').hidden`),true);
  await openMenu();
  await evaluate(`document.querySelector('button[aria-label="打开 Markdown"]').click(); await mdDrafts.flush()`);
  assert.deepEqual(await evaluate(`(async()=>{
    const original=mdDrafts.store.save;const before=mdDrafts.current();const text=mdEditor.getValue();
    mdDrafts.store.save=async()=>{throw new Error('模拟存储额度不足')};
    let blocked=false;try{await mdDrafts.openFile('# 不应替换','fail.md')}catch{blocked=true}
    mdDrafts.store.save=original;return {blocked,same:mdDrafts.current()===before&&mdEditor.getValue()===text};
  })()`), {blocked:true,same:true});
  await evaluate(`(async()=>{const record=await mdDrafts.store.get(mdDrafts.current());await mdDrafts.store.remove([record]);const channel=new BroadcastChannel('md2pdf-drafts');channel.postMessage({changed:true});channel.close()})()`);
  await wait('mdDrafts.current()===null && mdEditor.getValue()===""');
  console.log('Local drafts: migration, durable recovery, stable identity, file import, settings, deletion/refill, concurrency and mobile menu passed');
} finally {
  await browser.stop();
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
