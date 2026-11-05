/* One workspace controller; panels move between same-origin documents. */
(function () {
  'use strict';
  function popupRelay(channel, origin) {
    addEventListener('message', function (event) {
      if (event.source === opener && event.origin === origin && event.data?.type === 'md2pdf-window-forward' && event.data.channel === channel) {
        const frame = document.getElementById(event.data.frame);
        if (frame?.tagName === 'IFRAME') frame.contentWindow?.postMessage(event.data.payload, '*');
        return;
      }
      const frame = [...document.querySelectorAll('iframe[id]')].find(node => node.contentWindow === event.source);
      if (frame && opener && !opener.closed) opener.postMessage({ type: 'md2pdf-window-message', channel, frame: frame.id, payload: event.data }, origin);
    });
  }

  function create({ workspace, editorPanel, previewPanel, preview, onLayout, onMode, onError, beforeMove, floating }) {
    const hosts = window.mdWorkspaceHosts;
    const root = document, panels = [editorPanel, previewPanel];
    const homes = panels.map(panel => { const marker = document.createComment('panel home'); panel.before(marker); return marker; });
    const requests = new Map(), waiters = new Set();
    let popup = null, popupDoc = null, popupSpace = null, channel = '', role = null;
    let active = false, busy = false, operation = 0, sequence = 0, monitor = 0;
    let cached = null, position = null, pendingRestore = null, restoring = false;
    let opacity = null, restoreTicket = null;
    function showPreview() { const wasRestoring = restoring; if (opacity !== null) preview.style.opacity = opacity; opacity = null; restoreTicket = null; restoring = false; if (wasRestoring) changed(); }
    let positionRevision = -1;
    const state = () => window.mdPreviewController?.state() || { revision: -1, previewRevision: -1, ready: false, empty: true };
    function error(message) { onError(message); }
    function changed() {
      onMode({ active, busy: busy || restoring, role });
      document.dispatchEvent(new CustomEvent('md-window-layout'));
    }
    function validPopup() { try { return popup && !popup.closed && popup.document === popupDoc && popup.opener === window; } catch { return false; } }
    function postFrame(frame, data) {
      const view = frame?.ownerDocument?.defaultView;
      if (!frame?.contentWindow) return;
      if (view === window) frame.contentWindow.postMessage(data, '*');
      else if (view === popup && validPopup()) popup.postMessage({ type: 'md2pdf-window-forward', channel, frame: frame.id, payload: data }, location.origin);
    }
    hosts.frameTransport = postFrame;

    function capture() {
      const current = state();
      if (!current.ready) return Promise.resolve(null);
      const id = 'window-' + (++sequence);
      return new Promise(resolve => {
        const timeout = setTimeout(() => { requests.delete(id); resolve(null); }, 2500);
        requests.set(id, { revision: current.previewRevision, resolve: result => { clearTimeout(timeout); resolve(result); } });
        postFrame(preview, { type: 'md2pdf-transfer-capture', id, revision: current.previewRevision });
      });
    }
    function fallback() {
      const current = state();
      if (current.empty) { cached = null; position = null; positionRevision = -1; return { html: '', revision: -1, position: null }; }
      // A layout interrupted by a browser close has one retry in the surviving
      // iframe. Never revive an old snapshot as the new revision's result.
      if (cached && (cached.revision === current.previewRevision || current.previewRevision < 0)) return { ...cached, position: positionRevision === cached.revision ? position : cached.position };
      return { html: preview.getAttribute('srcdoc') || '', revision: current.previewRevision, position };
    }
    function waitForReady(id) {
      if (state().ready || state().empty) return Promise.resolve(true);
      return new Promise(resolve => {
        const finish = value => { clearTimeout(timer); window.removeEventListener('md-preview-ready', ready); waiters.delete(finish); resolve(value); };
        const ready = () => finish(operation === id && validPopup());
        const timer = setTimeout(() => finish(false), 60000);
        waiters.add(finish);
        window.addEventListener('md-preview-ready', ready);
      });
    }

    function movePanel(panel, target, snapshot) {
      const owner = target.ownerDocument;
      if (panel.ownerDocument === owner) return;
      beforeMove?.();
      const editorAnchor = window.mdEditor?.getScrollAnchor?.();
      const isPreview = panel === previewPanel;
      if (isPreview) {
        if (snapshot?.revision >= 0) { if (opacity === null) opacity = preview.style.opacity; preview.style.opacity = '0'; }
        preview.remove();
      }
      owner.adoptNode(panel);
      if (target === workspace) homes[panels.indexOf(panel)].after(panel);
      else target.appendChild(panel);
      if (isPreview) {
        owner.adoptNode(preview);
        preview.setAttribute('srcdoc', snapshot?.html || '');
        panel.querySelector('.preview-surface').prepend(preview);
        pendingRestore = snapshot?.position || position;
        restoring = true;
        window.mdPreviewController?.rehost(snapshot?.revision);
      } else {
        window.mdEditor?.setDocumentRoot?.(owner);
        for (const node of floating?.() || []) if (node && !panel.contains(node)) owner.body.appendChild(owner.adoptNode(node));
        owner.defaultView.requestAnimationFrame(() => owner.defaultView.requestAnimationFrame(() => {
          if (panel.ownerDocument !== owner) return;
          window.mdEditor?.requestMeasure?.();
          const outline = snapshot?.position?.outline;
          if (Number.isSafeInteger(outline)) window.mdEditor?.revealPosition?.(outline, 0, false);
          else if (editorAnchor) window.mdEditor?.revealPosition?.(editorAnchor.from, editorAnchor.ratio, false);
        }));
      }
      panel.classList.add('md-independent-pane');
      document.dispatchEvent(new CustomEvent('md-panel-host-change', { detail: { panel, document: owner } }));
    }
    function putHome(panel, index, snapshot) {
      movePanel(panel, workspace, snapshot);
      if (homes[index].nextSibling !== panel) homes[index].after(panel);
      panel.classList.remove('md-independent-pane');
    }
    function finishExit(snapshot, close) {
      ++operation;
      busy = false;
      for (let index = 0; index < panels.length; index++) putHome(panels[index], index, snapshot || fallback());
      workspace.classList.remove('md-independent-workspace');
      active = false; role = null;
      clearInterval(monitor); monitor = 0;
      const oldPopup = popup, oldDoc = popupDoc;
      popup = null; popupDoc = null; popupSpace = null;
      if (oldDoc) hosts.remove(oldDoc);
      for (const finish of [...waiters]) finish(false);
      for (const request of requests.values()) request.resolve(null);
      requests.clear();
      changed(); onLayout();
      hosts.postPreview({ type: 'md2pdf-window-position-stream', revision: state().previewRevision, enabled: false });
      if (close && oldPopup && !oldPopup.closed) { try { oldPopup.close(); } catch { /* Already navigating. */ } }
    }
    function exit(immediate = false, close = true) {
      if (!popup) return;
      if (immediate) { finishExit(fallback(), close); return; }
      if (busy) { finishExit(fallback(), close); return; }
      busy = true; changed();
      const id = ++operation;
      capture().then(snapshot => {
        if (operation === id) finishExit(snapshot && state().ready && snapshot.revision === state().previewRevision ? snapshot : fallback(), close);
      });
    }

    function setupPopup(win) {
      const doc = win.document;
      doc.open(); doc.write('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>md2pdf</title></head><body></body></html>'); doc.close();
      const base = doc.createElement('base'); base.href = location.href; doc.head.append(base);
      const sheets = [];
      for (const node of root.querySelectorAll('head link[rel="stylesheet"],head style')) {
        const copy = node.cloneNode(true);
        if (copy.tagName === 'LINK') {
          copy.href = node.href;
          sheets.push(new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('stylesheet timeout')), 15000);
            copy.addEventListener('load', () => { clearTimeout(timer); resolve(); });
            copy.addEventListener('error', () => { clearTimeout(timer); reject(new Error('stylesheet unavailable')); });
          }));
        }
        doc.head.append(copy);
      }
      doc.documentElement.style.cssText = root.documentElement.style.cssText;
      const shell = doc.createElement('main'); shell.className = 'workspace md-editor-workspace md-independent-workspace'; shell.id = 'independent-workspace';
      shell.style.cssText = 'padding:0;margin:0;max-width:none;';
      shell.innerHTML = '<p class="md-independent-wait" role="status">正在准备独立窗口…</p>';
      const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.className = 'icon-button md-independent-cancel'; cancel.textContent = '×'; cancel.setAttribute('aria-label', '退出全屏'); cancel.title = '退出全屏'; cancel.addEventListener('click', () => exit(true)); shell.append(cancel);
      doc.body.append(shell);
      const script = doc.createElement('script'); script.textContent = '(' + popupRelay.toString() + ')(' + JSON.stringify(channel) + ',' + JSON.stringify(location.origin) + ');'; doc.body.append(script);
      hosts.add(doc);
      win.addEventListener('pagehide', () => { if (popup === win) exit(true); });
      win.addEventListener('resize', () => { if (popup === win) { onLayout(); document.dispatchEvent(new CustomEvent('md-window-layout')); } });
      doc.addEventListener('visibilitychange', () => document.dispatchEvent(new CustomEvent('md-window-layout')));
      return { doc, shell, stylesReady: Promise.all(sheets) };
    }

    async function open(nextRole) {
      if (popup) { try { popup.focus(); } catch { /* Closing. */ } return; }
      let win;
      try { win = window.open('about:blank', '_blank', 'popup=yes,width=1100,height=850'); } catch { /* Browser policy. */ }
      if (!win) { error('浏览器阻止了独立窗口，请允许此站点弹出窗口后重试。'); return; }
      popup = win;
      channel = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
      const id = ++operation;
      busy = true;
      try {
        const setup = setupPopup(win); popupDoc = setup.doc; popupSpace = setup.shell;
        changed();
        monitor = setInterval(() => { if (!validPopup()) exit(true); }, 500);
        await setup.stylesReady;
        if (operation !== id || !validPopup()) return;
        if (!(await waitForReady(id)) || operation !== id || !validPopup()) {
          if (operation === id) { error('预览尚未就绪，已保留当前布局，请稍后重试。'); exit(true); }
          return;
        }
        let snapshot = await capture();
        if (operation !== id || !validPopup()) return;
        if (!state().empty && (!snapshot || !state().ready || snapshot.revision !== state().previewRevision)) {
          error('预览正在更新，已保留当前布局，请在更新完成后重试。'); exit(true); return;
        }
        snapshot ||= fallback();
        role = nextRole === 'editor' ? 'editor' : 'preview';
        popupSpace.replaceChildren();
        workspace.classList.add('md-independent-workspace');
        active = true;
        const detached = role === 'editor' ? editorPanel : previewPanel;
        movePanel(detached, popupSpace, snapshot);
        panels.forEach(panel => panel.classList.add('md-independent-pane'));
        busy = false; changed(); onLayout();
        win.focus();
      } catch (exception) {
        if (operation !== id) return;
        error('无法建立独立窗口，已恢复普通布局。');
        exit(true);
      }
    }
    async function swap() {
      if (!active || busy || restoring || !validPopup()) return;
      busy = true; changed();
      const id = ++operation;
      const snapshot = await capture();
      if (operation !== id || !validPopup()) return;
      if ((!snapshot || !state().ready || snapshot.revision !== state().previewRevision) && !state().empty) { busy = false; changed(); error('预览正在更新，请稍后交换窗口。'); return; }
      const next = role === 'editor' ? 'preview' : 'editor';
      const detached = next === 'editor' ? editorPanel : previewPanel;
      const local = next === 'editor' ? previewPanel : editorPanel;
      movePanel(local, workspace, snapshot || fallback());
      movePanel(detached, popupSpace, snapshot || fallback());
      role = next; busy = false; changed(); onLayout();
    }

    window.addEventListener('message', event => {
      const data = event.data;
      if (event.source === popup && event.origin === location.origin && data?.type === 'md2pdf-window-message' && data.channel === channel && validPopup()) {
        const frame = popupDoc.getElementById(data.frame);
        if (frame?.tagName === 'IFRAME' && typeof data.payload?.type === 'string' && data.payload.type.startsWith('md2pdf-')) {
          window.dispatchEvent(new MessageEvent('message', { data: data.payload, source: frame.contentWindow, origin: 'null' }));
        }
        return;
      }
      if (event.source !== preview.contentWindow || !data) return;
      if (data.type === 'md2pdf-position-restored' && state().ready && data.revision === state().previewRevision && restoreTicket && data.id === restoreTicket.id && data.revision === restoreTicket.revision) { showPreview(); return; }
      if (data.type === 'md2pdf-transfer-snapshot' || data.type === 'md2pdf-transfer-error') {
        const request = requests.get(data.id);
        if (!request || data.revision !== request.revision) return;
        requests.delete(data.id);
        const result = data.type === 'md2pdf-transfer-snapshot' && typeof data.html === 'string'
          && state().ready && data.revision === state().previewRevision ? data : null;
        if (result && data.revision === state().previewRevision) { cached = result; position = data.position; positionRevision = data.revision; }
        request.resolve(result);
      } else if (data.type === 'md2pdf-position' && data.id === 'window-position' && data.position && data.revision === state().previewRevision) { position = data.position; positionRevision = data.revision; }
      else if (data.type === 'md2pdf-content-source' && ['scroll', 'activate'].includes(data.reason) && data.revision === state().previewRevision) { position = { ...position, from: data.from, anchorRatio: data.ratio, offset: 0, ratio: 0, line: 0 }; positionRevision = data.revision; }
    });
    window.addEventListener('md-preview-ready', () => {
      hosts.postPreview({ type: 'md2pdf-window-position-stream', revision: state().previewRevision, enabled: !!popup });
      if (pendingRestore) {
        const desired = pendingRestore; pendingRestore = null;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (Number.isSafeInteger(desired.revision) && desired.revision !== state().previewRevision) { showPreview(); return; }
          restoreTicket = { id: 'window-restore-' + (++sequence), revision: state().previewRevision };
          hosts.postPreview({ type: 'md2pdf-restore-position', id: restoreTicket.id, position: desired });
        }));
      } else showPreview();
      if (popup) capture();
    }, true);
    window.addEventListener('pagehide', () => { if (popup) finishExit(fallback(), true); });
    document.addEventListener('md-window-layout', () => {
      if (popup && state().ready) postFrame(preview, { type: 'md2pdf-capture-position', id: 'window-position' });
    });
    return { open, swap, exit: () => exit(), get active() { return active; }, get busy() { return busy || restoring; }, get restoring() { return restoring; },
      get popup() { return popup; }, get role() { return role; }, get preparing() { return !!popup && !active; } };
  }
  window.mdIndependentWorkspace = { create };
})();
