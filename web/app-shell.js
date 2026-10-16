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
    if (!standalone()) return;
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
})();
