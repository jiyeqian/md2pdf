// A manual update must wait for the complete, hash-checked worker installation.
export function waitForInstallation(worker, timeout = 120000, activation = false) {
  const ready = () => worker?.state === 'activated' || (!activation && worker?.state === 'installed');
  if (!worker || ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', changed);
      error ? reject(error) : resolve();
    };
    const changed = () => {
      if (worker.state === 'redundant') finish(new Error('新版资源安装失败'));
      else if (ready()) finish();
    };
    const timer = setTimeout(() => finish(new Error('新版资源安装超时')), timeout);
    worker.addEventListener('statechange', changed);
    changed();
  });
}

export function workerStatus(worker, type, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (error, value) => {
      clearTimeout(timer);
      channel.port1.close(); channel.port2.close();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('版本状态获取超时')), timeout);
    channel.port1.onmessage = event => finish(null, event.data);
    try { worker.postMessage({type}, [channel.port2]); }
    catch (error) { finish(error); }
  });
}

export function bindManualUpdate({ getRegistration, statusType, applyUpdate,
  window: win = window, document: doc = document, queryStatus = workerStatus, activation = false }) {
  const footer = win.mdFooterStatus;
  let busy = false, noticeTimer;
  async function check() {
    if (busy) return;
    busy = true;
    clearTimeout(noticeTimer);
    footer.set('manual', 'checking');
    try {
      if (!win.navigator.onLine) throw new Error('当前离线');
      const registration = await getRegistration();
      if (!registration) throw new Error('更新服务不可用');
      await registration.update();
      await waitForInstallation(registration.installing || registration.waiting || registration.active, 120000, activation);
      const worker = registration.waiting || registration.active;
      if (!worker) throw new Error('更新服务尚未就绪');
      const data = await queryStatus(worker, statusType);
      if (!data.ready) throw new Error('资源尚未准备完成');
      const current = data.current ?? data.cache;
      if (!current || !data.pinned) throw new Error('版本状态无效');
      if (registration.waiting || current !== data.pinned) {
        footer.clear('manual');
        await applyUpdate();
      } else {
        footer.clear('check');
        footer.set('manual', 'latest');
        noticeTimer = setTimeout(() => footer.clear('manual'), 3000);
      }
    } catch { footer.set('manual', 'checkError', check); }
    finally { busy = false; }
  }
  doc.querySelector('.brand-icon')?.addEventListener('click', event => {
    event.preventDefault();
    void check();
  });
  return check;
}
