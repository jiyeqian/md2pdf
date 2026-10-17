/* WebApp 共用安装与缓存；主屏模式按需适配视口和文件分享。 */
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
  function updateMode() {
    root.classList.toggle('app-standalone', standalone());
    if (standalone()) {
      document.querySelector('meta[name="viewport"]').content = 'width=device-width,initial-scale=1,viewport-fit=cover';
      measure();
    }
  }
  function resume() {
    if (!standalone() || document.visibilityState === 'hidden') return;
    measure();
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
  const footer = window.mdFooterStatus;
  async function applyUpdate() {
    await footer.saveAndUpdate(async()=>{
      reloadForUpdate = true;
      if (registration?.waiting) registration.waiting.postMessage({ type:'APP_ACTIVATE' });
      else location.reload();
    });
  }
  function updateAvailable() { footer.set('update','update',applyUpdate); }
  function requestStatus() { navigator.serviceWorker.controller?.postMessage({ type:'APP_STATUS' }); }
  async function checkUpdate() {
    if (!registration || !navigator.onLine || checking) return;
    checking = true;
    try { await registration.update(); footer.clear('check'); if (registration.waiting) updateAvailable(); }
    catch { footer.set('check','checkError',checkUpdate); }
    finally { checking = false; }
  }
  function retryPrepare() {
    if (!navigator.serviceWorker.controller) return prepareApp();
    footer.set('cache','preparing');
    navigator.serviceWorker.controller.postMessage({type:'APP_PREPARE'});
  }
  let listening = false;
  async function prepareApp() {
    if (window.__MD2PDF_STATIC_BASE__) return;
    if (!window.isSecureContext || !('serviceWorker' in navigator)) {
      footer.set('cache','unsupported'); return;
    }
    if (!listening) {
      listening = true;
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'APP_ERROR') {footer.set('cache','retry',retryPrepare);return;}
        if (event.data?.type !== 'APP_STATUS') return;
        if (registration?.waiting || event.data.pinned !== event.data.cache) updateAvailable();
        else footer.clear('update');
        if (event.data.ready) footer.clear('cache');
        else footer.set('cache','retry',retryPrepare);
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadForUpdate) location.reload();
        else requestStatus();
      });
    }
    footer.set('cache','preparing');
    try {
      registration = await navigator.serviceWorker.register('/service-worker.js', { scope:'/', updateViaCache:'none' });
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && registration.waiting) updateAvailable();
          if (worker.state === 'redundant') footer.set('cache','retry',retryPrepare);
        });
      });
      if (registration.waiting) updateAvailable();
      requestStatus();
    } catch { footer.set('cache','retry',retryPrepare); }
  }
  window.addEventListener('online', checkUpdate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { checkUpdate(); requestStatus(); }
  });
  prepareApp();
  window.mdAppShell = { standalone, offerFile };
  display.addEventListener?.('change', updateMode);
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  window.addEventListener('pageshow', resume);
  document.addEventListener('visibilitychange', resume);
  updateMode();
})();
