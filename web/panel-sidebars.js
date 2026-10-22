(function () {
  'use strict';
  const sidebars = [];
  const preview = document.querySelector('#preview');
  function create({ panel, title, id, width = 260, button, content }) {
    const actions = panel.querySelector('.panel-actions');
    const main = panel.querySelector('.preview-surface') || panel.querySelector('.md-editor') || panel.querySelector('#markdown');
    const dock = document.createElement('div'); dock.className = 'md-panel-body';
    main.before(dock); dock.append(main);
    button = button || document.createElement('button');
    button.type = 'button'; button.className = 'icon-button md-sidebar-toggle';
    button.id = id + '-toggle'; button.title = title; button.setAttribute('aria-label', title);
    button.setAttribute('aria-controls', id); button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M14 3v18M6 8h5M6 12h5M6 16h3"/></svg>';
    const place = () => { const full = actions.querySelector('[data-panel-fullscreen]'); if (full && button.nextElementSibling !== full) actions.insertBefore(button, full); };
    actions.append(button); new MutationObserver(place).observe(actions, { childList: true }); place();
    const element = document.createElement('aside'); element.id = id; element.className = 'md-panel-sidebar'; element.hidden = true;
    element.setAttribute('aria-label', title);
    const header = document.createElement('div'); header.className = 'md-sidebar-header';
    const label = document.createElement('strong'); label.textContent = title;
    const closeButton = document.createElement('button'); closeButton.type = 'button'; closeButton.className = 'md-sidebar-close'; closeButton.textContent = '×'; closeButton.setAttribute('aria-label', '关闭' + title);
    header.append(label, closeButton);
    const body = document.createElement('div'); body.className = 'md-sidebar-content'; if (content) body.append(content);
    const resize = document.createElement('div'); resize.className = 'md-sidebar-resize'; resize.tabIndex = 0; resize.setAttribute('role', 'separator'); resize.setAttribute('aria-orientation', 'vertical'); resize.setAttribute('aria-label', '调整' + title + '宽度');
    let preferred = width;
    try { preferred = Number(localStorage.getItem('md2pdf.sidebar.' + id)) || width; } catch (_) {}
    function fit() {
      const panelWidth = panel.clientWidth;
      const maximum = Math.max(0, panelWidth * .5);
      const actual = Math.min(Math.max(200, preferred), maximum);
      const nextWidth = actual + 'px';
      if (element.style.width !== nextWidth) element.style.width = nextWidth;
      resize.setAttribute('aria-valuenow', String(Math.round(actual))); resize.setAttribute('aria-valuemin', String(Math.min(200, maximum))); resize.setAttribute('aria-valuemax', String(Math.round(maximum)));
    }
    function remember(next) { preferred = Math.max(200, Math.min(next, panel.clientWidth * .5)); fit(); try { localStorage.setItem('md2pdf.sidebar.' + id, String(preferred)); } catch (_) {} }
    function notify() { if (preview?.contentWindow) preview.contentWindow.postMessage({ type: 'md2pdf-sidebar-open', open: sidebars.some(s => s.isOpen()) }, '*'); }
    const api = { element, body, content: body, button, isOpen: () => !element.hidden,
      open() { element.hidden = false; button.setAttribute('aria-expanded', 'true'); fit(); notify(); },
      close() { element.hidden = true; button.setAttribute('aria-expanded', 'false'); notify(); },
      toggle() { api.isOpen() ? api.close() : api.open(); } };
    button.addEventListener('click', api.toggle); closeButton.addEventListener('click', () => { api.close(); button.focus(); });
    resize.addEventListener('pointerdown', event => {
      if (matchMedia('(max-width: 600px)').matches || event.button !== 0) return;
      event.preventDefault(); resize.setPointerCapture(event.pointerId);
      const startX = event.clientX, startWidth = element.getBoundingClientRect().width;
      const move = e => remember(startWidth + startX - e.clientX);
      const end = () => { resize.removeEventListener('pointermove', move); resize.removeEventListener('pointerup', end); resize.removeEventListener('pointercancel', end); };
      resize.addEventListener('pointermove', move); resize.addEventListener('pointerup', end); resize.addEventListener('pointercancel', end);
    });
    resize.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); remember(preferred + (e.key === 'ArrowLeft' ? 10 : -10)); } });
    element.append(resize, header, body); dock.append(element); sidebars.push(api); new ResizeObserver(fit).observe(panel); new MutationObserver(fit).observe(panel, { childList: true, subtree: true }); fit(); return api;
  }
  function closeAll() { const open = sidebars.filter(s => s.isOpen()); open.forEach(s => s.close()); return open.length > 0; }
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && closeAll()) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  window.mdPanelSidebars = { create, closeAll };
  const panel = document.querySelector('.preview-panel');
  if (!panel || !preview) return;
  const outline = create({ panel, title: '大纲', id: 'preview-outline', width: 240 });
  const list = document.createElement('nav'); list.className = 'md-preview-outline'; list.setAttribute('aria-label', '预览标题'); outline.body.append(list);
  let items = [], currentIndex = -1;
  const collapsedOutlinePaths = new Set();
  function showCurrent() {
    const current = list.querySelector('[aria-current="location"]');
    if (!current || !outline.isOpen()) return;
    const box = outline.body.getBoundingClientRect(), row = current.getBoundingClientRect();
    if (row.top < box.top) outline.body.scrollTop += row.top - box.top;
    else if (row.bottom > box.bottom) outline.body.scrollTop += row.bottom - box.bottom;
  }
  outline.button.addEventListener('click', showCurrent);
  function select(index) {
    currentIndex = index;
    const buttons = list.querySelectorAll('button[data-outline-index]');
    buttons.forEach(button => { const current = Number(button.dataset.outlineIndex) === index; button.classList.toggle('is-current', current); if (current) button.setAttribute('aria-current', 'location'); else button.removeAttribute('aria-current'); });
  }
  function render(headings) {
    list.replaceChildren(); items = headings;
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'md-sidebar-empty'; empty.textContent = '暂无标题'; list.append(empty); return; }
    const stack = [{ level: 0, container: list, key: '' }];
    const pathOccurrences = new Map();
    items.forEach((item, index) => {
      while (stack.length > 1 && stack[stack.length - 1].level >= item.level) stack.pop();
      const parent = stack[stack.length - 1];
      const baseKey = JSON.stringify([parent.key, item.level, item.text]);
      const occurrence = pathOccurrences.get(baseKey) || 0; pathOccurrences.set(baseKey, occurrence + 1);
      const key = JSON.stringify([baseKey, occurrence]);
      const row = document.createElement('div'); row.className = 'md-outline-row';
      const label = document.createElement('div'); label.className = 'md-outline-label';
      const disclosure = document.createElement('button'); disclosure.type = 'button'; disclosure.className = 'md-outline-disclosure'; disclosure.style.visibility = 'hidden'; disclosure.textContent = '⌄';
      disclosure.setAttribute('aria-label', '折叠或展开：' + item.text);
      const button = document.createElement('button'); button.type = 'button'; button.dataset.outlineIndex = String(index); button.textContent = item.text; button.title = item.text;
      button.addEventListener('click', () => { preview.contentWindow.postMessage({ type: 'md2pdf-outline-locate', index }, '*'); select(index); });
      label.append(disclosure, button); row.append(label); parent.container.append(row);
      const children = document.createElement('div'); children.className = 'md-outline-children'; row.append(children);
      function updateExpanded() { const expanded = !collapsedOutlinePaths.has(key); children.hidden = !expanded; disclosure.setAttribute('aria-expanded', String(expanded)); disclosure.textContent = expanded ? '⌄' : '›'; }
      disclosure.addEventListener('click', () => { if (collapsedOutlinePaths.has(key)) collapsedOutlinePaths.delete(key); else collapsedOutlinePaths.add(key); updateExpanded(); });
      updateExpanded();
      if (parent.disclosure) parent.disclosure.style.visibility = '';
      stack.push({ level: item.level, container: children, key, disclosure });
    });
    select(currentIndex);
  }
  render([]);
  window.addEventListener('message', event => {
    if (event.source !== preview.contentWindow || !event.data) return;
    const data = event.data;
    if (data.type === 'md2pdf-outline' && Array.isArray(data.headings)) render(data.headings.filter(h => h && typeof h.text === 'string' && Number.isInteger(h.level) && h.level >= 1 && h.level <= 6).map(h => ({ text: h.text, level: h.level })));
    else if (data.type === 'md2pdf-outline-current' && Number.isSafeInteger(data.index)) select(data.index);
    else if (data.type === 'md2pdf-sidebar-escape') closeAll();
  });
  preview.addEventListener('load', () => preview.contentWindow.postMessage({ type: 'md2pdf-sidebar-open', open: sidebars.some(s => s.isOpen()) }, '*'));
})();
