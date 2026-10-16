/* 主屏 App 的视口与文件操作；普通浏览器继续沿用原来的编辑和下载流程。 */
(() => {
  const root = document.documentElement;
  const display = window.matchMedia('(display-mode: standalone)');
  const standalone = () => display.matches || navigator.standalone === true;
  let frame = 0, fileDialog;
  function measure() {
    frame = 0;
    if (!standalone()) return;
    const view = window.visualViewport;
    root.style.setProperty('--app-view-height', (view?.height || innerHeight) + 'px');
    root.style.setProperty('--app-view-top', (view?.offsetTop || 0) + 'px');
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(measure); }
  function network() {
    if (!standalone() && location.pathname !== '/app/') return;
    let notice = document.querySelector('#app-network-status');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'app-network-status';
      notice.setAttribute('role', 'status');
      notice.textContent = '网络已断开，可继续编辑和保存草稿；预览与 PDF 导出需要联网。';
      document.body.append(notice);
    }
    notice.hidden = navigator.onLine;
  }
  function updateMode() {
    root.classList.toggle('app-standalone', standalone());
    if (standalone()) {
      document.querySelector('meta[name="viewport"]').content = 'width=device-width,initial-scale=1,viewport-fit=cover';
      measure();
      network();
    } else {
      document.querySelector('#app-network-status')?.remove();
    }
  }
  function resume() {
    if (!standalone() || document.visibilityState === 'hidden') return;
    measure();
    network();
    window.mdEditor?.requestMeasure();
    window.dispatchEvent(new Event('resize'));
  }
  function offerFile(file) {
    // 分享需要安全上下文和一次新点击；PDF 异步生成后不能依赖最初点击的激活状态。
    if (!standalone() || !window.isSecureContext || typeof navigator.share !== 'function'
      || typeof navigator.canShare !== 'function') return false;
    try { if (!navigator.canShare({ files: [file] })) return false; }
    catch { return false; }
    if (fileDialog) fileDialog.close();
    const dialog = document.createElement('dialog');
    fileDialog = dialog;
    dialog.className = 'template-confirm';
    dialog.setAttribute('aria-label', '保存或分享文件');
    const name = document.createElement('p');
    name.className = 'app-file-name';
    name.textContent = file.name;
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const actions = document.createElement('div');
    actions.className = 'template-confirm-actions app-file-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'template-confirm-cancel';
    cancel.textContent = '取消';
    const save = document.createElement('a');
    const url = URL.createObjectURL(file);
    save.href = url;
    save.download = file.name;
    save.className = 'template-confirm-cancel';
    save.textContent = '下载文件';
    const share = document.createElement('button');
    share.type = 'button';
    share.className = 'primary';
    share.textContent = '分享…';
    cancel.addEventListener('click', () => dialog.close());
    share.addEventListener('click', async () => {
      try {
        await navigator.share({ files: [file], title: file.name });
        dialog.close();
      } catch (error) {
        if (error.name !== 'AbortError') status.textContent = '分享未完成，可以选择下载文件。';
      }
    });
    dialog.addEventListener('close', () => {
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (fileDialog === dialog) fileDialog = null;
      dialog.remove();
    }, { once: true });
    actions.append(cancel, save, share);
    dialog.append(name, status, actions);
    document.body.append(dialog);
    dialog.showModal();
    share.focus();
    return true;
  }
  let registration, reloadForUpdate = false, checking = false;
  const appEntry = () => location.pathname === '/app/';
  function cacheNotice(message, label, action) {
    let notice = document.querySelector('#app-cache-status');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'app-cache-status';
      notice.setAttribute('role', 'status');
      document.body.append(notice);
    }
    notice.replaceChildren(document.createTextNode(message));
    if (label) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await action(); }
        catch { cacheNotice('操作未完成，当前文档已保留。', '重试', action); }
      });
      notice.append(button);
    }
    notice.hidden = false;
  }
  async function applyUpdate() {
    if (!window.mdDrafts) throw new Error('草稿尚未就绪');
    await window.mdDrafts.flush();
    reloadForUpdate = true;
    if (registration.waiting) registration.waiting.postMessage({ type:'APP_ACTIVATE' });
    else location.replace('/app/');
  }
  function updateAvailable() {
    cacheNotice('新版已准备好。', '保存草稿并更新', applyUpdate);
  }
  function requestStatus() {
    navigator.serviceWorker.controller?.postMessage({ type:'APP_STATUS' });
  }
  async function checkUpdate() {
    if (!registration || !navigator.onLine || checking) return;
    checking = true;
    try { await registration.update(); if (registration.waiting) updateAvailable(); }
    catch { /* 保留已缓存的版本，联网后再检查。 */ }
    finally { checking = false; }
  }
  async function prepareApp() {
    if (!appEntry()) return;
    if (!window.isSecureContext || !('serviceWorker' in navigator)) {
      cacheNotice('离线启动需要受信任的 HTTPS 地址。'); return;
    }
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'APP_ERROR') {
        cacheNotice('离线资源未保存，请联网后重试，并检查浏览器可用空间。', '重试', () => {
          navigator.serviceWorker.controller?.postMessage({ type:'APP_PREPARE' });
          cacheNotice('正在准备离线编辑…');
        }); return;
      }
      if (event.data?.type !== 'APP_STATUS') return;
      if (registration?.waiting || event.data.pinned !== event.data.cache) { updateAvailable(); return; }
      if (event.data.ready) {
        cacheNotice('离线编辑已就绪。');
        const notice = document.querySelector('#app-cache-status');
        setTimeout(() => { if (notice.textContent === '离线编辑已就绪。') notice.hidden = true; }, 4000);
      } else {
        cacheNotice('离线资源不完整。', '重新准备', () => {
          navigator.serviceWorker.controller?.postMessage({ type:'APP_PREPARE' });
          cacheNotice('正在准备离线编辑…');
        });
      }
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadForUpdate) location.replace('/app/');
      else requestStatus();
    });
    cacheNotice('正在准备离线编辑…');
    try {
      registration = await navigator.serviceWorker.register('/app/service-worker.js', { scope:'/app/', updateViaCache:'none' });
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && registration.waiting) updateAvailable();
          if (worker.state === 'redundant') cacheNotice('离线准备未完成，联网后可重试。', '重试', () => prepareApp());
        });
      });
      if (registration.waiting) updateAvailable();
      else requestStatus();
    } catch { cacheNotice('离线准备未完成，联网后可重试。', '重试', () => prepareApp()); }
  }
  // 兼容之前从首页添加的主屏图标，等草稿恢复并写入后才迁移入口。
  window.addEventListener('md-app-ready', async () => {
    if (standalone() && location.pathname === '/' && window.isSecureContext && window.mdDrafts) {
      try { await window.mdDrafts.flush(); location.replace('/app/'); }
      catch { cacheNotice('草稿尚未保存，请稍后重新打开主屏 App。'); }
    }
  });
  window.addEventListener('online', checkUpdate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { checkUpdate(); requestStatus(); }
  });
  if (appEntry()) document.querySelector('.brand-icon')?.setAttribute('href', '/app/');
  prepareApp();
  window.mdAppShell = { standalone, offerFile };
  display.addEventListener?.('change', updateMode);
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  window.addEventListener('pageshow', resume);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', network);
  window.addEventListener('offline', network);
  updateMode();
  if (appEntry()) network();
})();
