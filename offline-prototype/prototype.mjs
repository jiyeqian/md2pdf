import { render } from './src/render.mjs';
const source = document.querySelector('#source');
const preview = document.querySelector('#preview');
const status = document.querySelector('#status');
const saved = document.querySelector('#saved');
const print = document.querySelector('#print');
let restored = false;
let revision = 0, renderedRevision = -1, db, saveTimer, renderBusy = false;
const say = (text, error = false) => { status.textContent = text; status.dataset.error = String(error); };
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('md2pdf-offline-prototype', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他原型页面后重试。'));
  });
}
function store(mode, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode);
    const drafts = tx.objectStore('drafts');
    const request = mode === 'readonly' ? drafts.get('current') : drafts.put(value, 'current');
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
async function save() {
  if (!db) { saved.textContent = '草稿保存不可用，请下载 Markdown 备份。'; return; }
  const current = revision;
  try { await store('readwrite', source.value); if (current === revision) saved.textContent = '草稿已保存到此原型的浏览器存储。'; }
  catch { saved.textContent = '草稿保存失败，请下载 Markdown 备份。'; }
}
source.addEventListener('input', () => {
  revision++; print.disabled = true;
  saved.textContent = '正在保存草稿…';
  clearTimeout(saveTimer); saveTimer = setTimeout(save, 350);
});
function waitReady(frame, current) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const poll = () => {
      if (current !== revision) { reject(new Error('文档已变化，请重新预览。')); return; }
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      if (win?.__md2pdfPagedReady === true && win.__md2pdfMathReady !== false && win.__md2pdfMermaidReady !== false && doc?.querySelector('.pagedjs_page')) {
        resolve({ pages:doc.querySelectorAll('.pagedjs_page').length, milliseconds:Math.round(performance.now() - start) }); return;
      }
      if (performance.now() - start > 60000) { reject(new Error('排版超过 60 秒，请检查文档或离线资源。')); return; }
      setTimeout(poll, 100);
    };
    poll();
  });
}
async function updatePreview() {
  if (renderBusy) return;
  renderBusy = true; print.disabled = true;
  const current = revision;
  say('正在本地排版…');
  const started = performance.now();
  try {
    const result = await render(source.value, { pagedHtml:true }, { filename:'document.md', webSafe:true });
    const policy = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
    const loaded = new Promise(resolve => preview.addEventListener('load', resolve, { once:true }));
    preview.srcdoc = (result.pagedHtml || result.html).replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`);
    // 等本次文档真正加载，避免读到上一次 iframe 的完成标记。
    await loaded;
    const metrics = await waitReady(preview, current);
    renderedRevision = current; print.disabled = false;
    say(`离线排版完成 · ${metrics.pages} 页 · ${Math.round(performance.now() - started)} ms`);
  } catch (error) { say(error.message, true); }
  finally { renderBusy = false; }
}
print.addEventListener('click', () => {
  if (renderedRevision !== revision) { say('请先更新预览。'); return; }
  preview.contentWindow.focus(); preview.contentWindow.print();
});
document.querySelector('#render').addEventListener('click', updatePreview);
document.querySelector('#save').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([source.value], { type:'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'offline-document.md'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
async function confirmReplace() {
  if (!source.value) return true;
  const dialog = document.createElement('dialog');
  dialog.innerHTML = '<p>替换原型中的当前文档？请先下载需要保留的 Markdown。</p><form method="dialog"><button value="cancel">取消</button> <button value="replace">确认替换</button></form>';
  document.body.append(dialog);
  return new Promise(resolve => {
    dialog.addEventListener('close', () => { const confirmed = dialog.returnValue === 'replace'; dialog.remove(); resolve(confirmed); }, { once:true });
    dialog.showModal();
  });
}
async function loadExample() {
  const id = document.querySelector('#example').value;
  if (!await confirmReplace()) return;
  if (id === 'long-table') {
    source.value = '# 长表格分页检查\n\n| 序号 | 中文内容 | 数值 |\n| --- | --- | --- |\n' + Array.from({length:160}, (_, i) => `| ${i+1} | 中文长表格跨页内容 | ${i*1.25} |`).join('\n');
  } else {
    const response = await fetch('./web/examples/' + id + '.md');
    if (!response.ok) throw new Error('示例读取失败');
    source.value = await response.text();
  }
  revision++; await save(); await updatePreview();
}
document.querySelector('#load').addEventListener('click', () => loadExample().catch(error => say(error.message, true)));
document.querySelector('#file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  if (!await confirmReplace()) return;
  source.value = await file.text(); revision++; await save(); await updatePreview();
});
async function prepareCache() {
  const cacheStatus = document.querySelector('#cache');
  if (!isSecureContext || !('serviceWorker' in navigator)) { cacheStatus.textContent = '离线启动需要可信 HTTPS 或 localhost。当前仍可本地排版。'; return; }
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js', { updateViaCache:'none' });
    const report = () => { cacheStatus.textContent = registration.waiting ? '新版已下载，关闭全部原型窗口后重新打开即可更新。' : '完整离线资源已就绪。'; };
    navigator.serviceWorker.addEventListener('controllerchange', report);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') report();
        if (worker.state === 'redundant') cacheStatus.textContent = '离线资源准备失败，请联网后重新打开。';
      });
    });
    if (registration.active) report();
  } catch { cacheStatus.textContent = '离线资源准备失败，请联网后重新打开。'; }
}
prepareCache();
try { db = await database(); const draft = await store('readonly'); if (typeof draft === 'string') { source.value = draft; restored = true; } }
catch { saved.textContent = '浏览器存储不可用，请及时下载备份。'; }
if (!restored) { const response = await fetch('./web/examples/general.md'); if (response.ok) source.value = await response.text(); }
await save();
await updatePreview();
