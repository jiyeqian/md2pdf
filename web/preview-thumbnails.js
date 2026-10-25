(function () {
  'use strict';
  const preview = document.querySelector('#preview');
  if (!preview) return;
  let readyRevision = -1;
  const managers = new Set();
  const MAX_VISIBLE = 12, MAX_IN_FLIGHT = 2;

  // Runs only in an opaque-origin sandbox. Document HTML never enters the workspace DOM.
  function thumbnailRuntime(token, maxVisible) {
    const rows = [], wanted = new Set();
    let revision = -1, observer, metadata = [], queued = false;
    const list = document.querySelector('#pages');
    function send(type, extra) { parent.postMessage(Object.assign({type, token, revision}, extra), '*'); }
    function refresh() {
      queued = false;
      const height = innerHeight;
      const visible = rows.map((row, index) => ({index, rect: row.getBoundingClientRect()}))
        .filter(item => item.rect.bottom >= -height && item.rect.top <= height * 2)
        .sort((a, b) => Math.abs(a.rect.top) - Math.abs(b.rect.top)).slice(0, maxVisible);
      wanted.clear(); visible.forEach(item => wanted.add(item.index));
      rows.forEach((row, index) => { if (!wanted.has(index)) row.querySelector('.page-copy').replaceChildren(); });
      send('md2pdf-thumbnails-want', {indices: Array.from(wanted).filter(index => !rows[index].querySelector('.page-copy').childElementCount)});
    }
    function schedule() { if (!queued) {queued = true; requestAnimationFrame(refresh);} }
    addEventListener('message', event => {
      const data = event.data;
      if (event.source !== parent || !data || data.token !== token) return;
      if (data.type === 'md2pdf-thumbnails-init' && Number.isSafeInteger(data.revision) && Array.isArray(data.pages)) {
        revision = data.revision; metadata = data.pages; document.documentElement.classList.toggle("md2pdf-preview-flow", data.flow === true);
        document.querySelector('#document-styles').textContent = data.styles;
        Object.entries(data.typography || {}).forEach(([name, value]) => document.body.style.setProperty(name, value));
        list.replaceChildren(); rows.length = 0;
        if (observer) observer.disconnect();
        observer = new IntersectionObserver(schedule, {rootMargin: '100% 0px'});
        metadata.forEach((size, index) => {
          const row = document.createElement('button'); row.type = 'button'; row.className = 'thumbnail';
          row.setAttribute('aria-label', '第 ' + (index + 1) + ' 页');
          const copy = document.createElement('div'); copy.className = 'page-copy';
          const label = document.createElement('span'); label.className = 'number'; label.textContent = String(index + 1);
          row.append(copy, label); list.append(row); rows.push(row);
          row.addEventListener('click', () => {rows.forEach(other => other.removeAttribute('aria-current')); row.setAttribute('aria-current', 'page'); send('md2pdf-thumbnails-select', {index});});
          observer.observe(row);
        });
        sizeRows();
      } else if (data.type === 'md2pdf-thumbnails-deliver' && data.revision === revision && Number.isSafeInteger(data.index) && wanted.has(data.index)) {
        const copy = rows[data.index]?.querySelector('.page-copy');
        if (copy) { copy.innerHTML = data.html; sizeRows(); }
      }
    });
    function sizeRows() {
      const width = Math.max(1, document.documentElement.clientWidth - 24);
      rows.forEach((row, index) => {
        const size = metadata[index], scale = width / size.width;
        row.style.width = width + 'px';
        row.querySelector('.page-copy').style.height = size.height * scale + 'px';
        const page = row.querySelector('.pagedjs_page, #md2pdf-preview-flow');
        if (page) {page.style.transform = 'scale(' + scale + ')'; page.style.transformOrigin = 'top left';}
      });
      schedule();
    }
    addEventListener('resize', sizeRows);
    addEventListener('scroll', schedule, {passive: true});
    document.addEventListener('click', event => {if (event.target.closest('a')) event.preventDefault();});
    document.addEventListener('keydown', event => {if (event.key === 'Escape' && !event.isComposing) {event.preventDefault(); send('md2pdf-thumbnails-close');}});
    send('md2pdf-thumbnails-frame-ready');
  }
  function frameDocument(token) {
    const nonce = crypto.randomUUID().replaceAll('-', '');
    const policy = "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'unsafe-inline'; img-src data: blob: https: http:; font-src data: blob: https: http:; base-uri 'none'; form-action 'none'";
    return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + policy + '"><style id="document-styles"></style><style>'
      + 'html,body{margin:0!important;padding:0!important;background:#f4f6f9!important}#pages{padding:12px;display:block!important}.thumbnail{position:relative;display:block;padding:0;margin:0 0 12px;border:0;background:transparent;cursor:pointer;color:#35445a}.page-copy{position:relative;overflow:hidden;background:white;box-shadow:0 1px 4px #0003;pointer-events:none}.page-copy>.pagedjs_page,.page-copy>#md2pdf-preview-flow{position:absolute!important;top:0;left:0;margin:0!important;zoom:1!important;box-shadow:none!important;display:block!important}.number{display:block;font:12px/24px sans-serif;text-align:center}.thumbnail[aria-current]>.page-copy{outline:2px solid #8da2bb;outline-offset:2px}.pagedjs_pages{display:block!important}.page-copy>#md2pdf-preview-flow{display:block!important}'
      + '</style></head><body><nav id="pages" aria-label="页面缩略图"></nav><script nonce="' + nonce + '">(' + thumbnailRuntime.toString() + ')(' + JSON.stringify(token) + ',' + MAX_VISIBLE + ');</script></body></html>';
  }
  function create(container) {
    let active = false, frame = null, session = '', revision = -1, initialized = false, frameReady = false;
    let wanted = [], pending = new Map(), metadata = null, sequence = 0;
    function send(type, extra = {}) { preview.contentWindow?.postMessage({type, revision, request: session + ':' + (++sequence), ...extra}, '*'); }
    function dispose() {
      frame?.remove(); frame = null; session = ''; initialized = false; frameReady = false;
      pending.clear(); wanted = []; metadata = null;
    }
    function build() {
      dispose(); if (!active || readyRevision < 0) return;
      revision = readyRevision; session = crypto.randomUUID();
      frame = document.createElement('iframe'); frame.title = '页面缩略图';
      frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('referrerpolicy', 'no-referrer');
      Object.assign(frame.style, {border: '0', width: '100%', height: '100%', display: 'block', flex: '1', minHeight: '0'});
      frame.srcdoc = frameDocument(session); container.append(frame);
      send('md2pdf-thumbnails-meta');
    }
    function initFrame() {
      if (!frameReady || !metadata || initialized) return;
      initialized = true;
      frame.contentWindow.postMessage({type: 'md2pdf-thumbnails-init', token: session, revision, ...metadata}, '*');
    }
    function pump() {
      if (!active || !initialized) return;
      for (const index of wanted) {
        if (pending.size >= MAX_IN_FLIGHT) break;
        if (pending.has(index)) continue;
        const request = session + ':' + (++sequence); pending.set(index, request);
        send('md2pdf-thumbnails-page', {index, request});
      }
    }
    function onMessage(event) {
      const data = event.data;
      if (!active || !frame || !data) return;
      if (event.source === frame.contentWindow) {
        if (data.token !== session) return;
        if (data.type === 'md2pdf-thumbnails-frame-ready') {frameReady = true; initFrame(); return;}
        if (data.revision !== revision || !initialized) return;
        if (data.type === 'md2pdf-thumbnails-close') {window.dispatchEvent(new CustomEvent('md-preview-sidebar-close')); return;}
        if (data.type === 'md2pdf-thumbnails-want' && Array.isArray(data.indices)) {
          wanted = [...new Set(data.indices)].filter(index => Number.isSafeInteger(index) && index >= 0 && index < metadata.pages.length).slice(0, MAX_VISIBLE);
          pump();
        } else if (data.type === 'md2pdf-thumbnails-select' && Number.isSafeInteger(data.index) && data.index >= 0 && data.index < metadata.pages.length) send('md2pdf-thumbnails-locate', {index: data.index});
        return;
      }
      if (event.source !== preview.contentWindow || data.revision !== revision || typeof data.request !== 'string' || !data.request.startsWith(session + ':')) return;
      if (data.type === 'md2pdf-thumbnails-meta' && !metadata && Array.isArray(data.pages) && typeof data.styles === 'string') {
        if (!data.pages.every(page => Number.isFinite(page.width) && page.width > 0 && Number.isFinite(page.height) && page.height > 0)) return;
        metadata = {pages: data.pages, styles: data.styles, typography: data.typography, flow: data.flow}; initFrame();
      } else if (data.type === 'md2pdf-thumbnails-page' && pending.get(data.index) === data.request && typeof data.html === 'string') {
        pending.delete(data.index);
        if (wanted.includes(data.index)) frame.contentWindow.postMessage({type: 'md2pdf-thumbnails-deliver', token: session, revision, index: data.index, html: data.html}, '*');
        wanted = wanted.filter(index => index !== data.index); pump();
      }
    }
    addEventListener('message', onMessage);
    const api = {setActive(value) {
      const next = value === true; if (next === active) return;
      active = next;
      if (active) build(); else dispose();
    }, refresh(force = false) {if (active && (force || !frame || revision !== readyRevision)) build();}};
    managers.add(api); return api;
  }
  addEventListener('message', event => {
    if (event.source === preview.contentWindow && event.data?.type === 'md2pdf-thumbnail-mode' && event.data.revision === readyRevision) managers.forEach(manager => manager.refresh(true));
    if (event.source === preview.contentWindow && event.data?.type === 'md2pdf-ready' && Number.isSafeInteger(event.data.revision)) {
      readyRevision = event.data.revision; managers.forEach(manager => manager.refresh());
    }
  });
  window.addEventListener('md-preview-ready', () => queueMicrotask(() => managers.forEach(manager => manager.refresh())));
  preview.addEventListener('load', () => {readyRevision = -1; managers.forEach(manager => manager.refresh());});
  window.mdPreviewThumbnails = {create};
})();
