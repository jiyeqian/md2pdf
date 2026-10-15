'use strict';

// 模板库与编辑器共用 / 页面，模板视图通过 history.state 导航。
(() => {
  const HANDOFF_KEY = 'md2pdf:handoff';
  const DRAFT_KEY = 'md2pdf:draft';
  const root = document.querySelector('.template-library-page');
  if (!root) return;

  const listEl = root.querySelector('#example-list');
  const listStatus = root.querySelector('#list-status');
  const viewLabel = document.querySelector('#app-view-label');
  const viewLink = document.querySelector('#examples-link-top');
  const templateNavIcon = viewLink.querySelector('[data-nav-icon="templates"]');
  const editorNavIcon = viewLink.querySelector('[data-nav-icon="editor"]');
  const shortTemplateNames = { general: '机械方案', skill: '日志分析', paper: '仿生抓取', gb: '国家标准' };
  let catalog = [];
  let revision = 0;
  const rendered = new Map();
  const previewFrames = new Map();

  function setStatus(message, error = false) {
    listStatus.textContent = message;
    listStatus.dataset.error = String(error);
  }

  function readDraft() {
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); }
    catch { return null; }
  }

  function injectRevision(html, rev) {
    return String(html)
      .replaceAll("type:'md2pdf-ready'", `type:'md2pdf-ready',revision:${rev}`)
      .replaceAll("type:'md2pdf-error'", `type:'md2pdf-error',revision:${rev}`);
  }

  function navigate(view, push = true) {
    const editorView = document.querySelector('[data-view="editor"]');
    if (view === 'editor' && !editorView) { location.assign('/'); return; }
    if (push) history.pushState({ ...(history.state || {}), md2pdfView: view }, '', '/');
    const libraryView = root.querySelector('.template-library-view');
    if (editorView) editorView.hidden = view === 'templates';
    root.hidden = view !== 'templates';
    libraryView.hidden = view !== 'templates';
    viewLabel.textContent = view === 'templates' ? '模板库' : '编辑器';
    viewLink.setAttribute('aria-label', view === 'templates' ? '返回编辑器' : '模板库');
    viewLink.title = view === 'templates' ? '返回编辑器' : '模板库';
    viewLink.dataset.viewLink = view === 'templates' ? 'editor' : 'templates';
    templateNavIcon.hidden = view === 'templates';
    editorNavIcon.hidden = view !== 'templates';
    document.body.classList.toggle('show-template-library', view === 'templates');
    if (view === 'templates' && !catalog.length) loadCatalog();
    if (view === 'editor') {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('md2pdf-editor-view'));
    }
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('[data-view-link]');
    if (!link) return;
    event.preventDefault();
    navigate(link.dataset.viewLink);
  });
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-create-template]');
    if (!button || button.disabled) return;
    const id = button.dataset.createTemplate;
    const data = rendered.get(id);
    if (!data?.md || !await window.mdConfirmTemplate()) return;
    const meta = catalog.find(entry => entry.id === id) || {};
    try {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({
        id,
        md: data.md,
        type: data.type || meta.type || '',
        title: meta.title || '',
        replaceConfirmed: true,
      }));
      navigate('editor');
    } catch {
      button.title = '浏览器无法保存模板交接，请复制模板内容到编辑器。';
    }
  });
  window.addEventListener('md2pdf-editor-view', () => {
    let handoff;
    try { handoff = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null'); }
    catch { handoff = null; }
    if (handoff?.md) window.dispatchEvent(new Event('md2pdf-template-created'));
  });
  window.addEventListener('popstate', event => navigate(event.state?.md2pdfView === 'templates' ? 'templates' : 'editor', false));
  window.addEventListener('message', event => {
    const state = previewFrames.get(event.source);
    if (!state || event.data?.revision !== state.revision) return;
    if (event.data.type === 'md2pdf-ready') state.status.hidden = true;
    else if (event.data.type === 'md2pdf-error') {
      state.status.hidden = false;
      state.status.textContent = event.data.error || '预览排版失败';
    }
  });
  if (location.pathname !== '/') history.replaceState({ ...(history.state || {}), md2pdfView: 'templates' }, '', '/');

  function createCard(example) {
    const item = document.createElement('li');
    item.className = 'example-card';
    item.dataset.id = example.id;
    item.setAttribute('aria-current', String(Boolean(example.current)));
    item.dataset.currentTemplate = String(Boolean(example.current));

    const heading = document.createElement('div');
    heading.className = 'panel-heading example-card-heading';
    const copy = document.createElement('div');
    copy.className = 'example-card-copy';
    const badge = document.createElement('span');
    badge.className = 'type-badge';
    const templateName = shortTemplateNames[example.id] || Array.from(example.title || example.id).slice(0, 4).join('');
    badge.textContent = templateName;
    badge.title = example.current ? `当前模板：${example.title || example.id}` : (example.title || example.id);
    if (example.current) badge.classList.add('is-current');
    const title = document.createElement('h3');
    title.textContent = example.title || example.id;
    title.title = title.textContent;
    const summary = document.createElement('p');
    summary.textContent = example.description || '';
    summary.title = summary.textContent;
    copy.append(title, summary);

    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'icon-button template-create-button';
    create.dataset.createTemplate = example.id;
    create.disabled = true;
    create.setAttribute('aria-label', '从该模板创建');
    create.title = '从该模板创建';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.classList.add('btn-icon');
    icon.setAttribute('viewBox', '0 0 20 20');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.6');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    for (const d of [
      'M11.2 3.6H6.2a1.4 1.4 0 0 0-1.4 1.4v10a1.4 1.4 0 0 0 1.4 1.4h7.6a1.4 1.4 0 0 0 1.4-1.4V7.4z',
      'M11.2 3.6v3.8h3.4',
      'M7.8 11h4.4',
      'M10 8.8v4.4',
    ]) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      icon.append(path);
    }
    create.append(icon);
    heading.append(badge, create);

    const preview = document.createElement('div');
    preview.className = 'template-card-preview';
    const frame = document.createElement('iframe');
    frame.className = 'template-card-frame';
    frame.title = `模板排版预览：${example.title || example.id}`;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    const status = document.createElement('p');
    status.className = 'template-preview-status';
    status.setAttribute('role', 'status');
    status.textContent = '正在生成预览…';
    preview.append(frame, status);
    item.append(heading, copy, preview);
    return { item, frame, status, create };
  }

  function renderCards() {
    listEl.replaceChildren();
    const cards = new Map();
    for (const example of catalog) {
      const card = createCard(example);
      cards.set(example.id, card);
      listEl.append(card.item);
    }
    listEl.setAttribute('aria-busy', 'false');
    renderPreviews(cards);
  }

  async function loadExample(example) {
    const cached = rendered.get(example.id);
    if (cached) return cached;
    const response = await fetch('/api/example?id=' + encodeURIComponent(example.id));
    if (!response.ok) throw new Error(`模板加载失败（${response.status}）`);
    const data = await response.json();
    const renderResponse = await fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ md: data.md, opts: data.type ? { type: data.type } : {} }),
    });
    if (!renderResponse.ok) {
      const detail = await renderResponse.json().catch(() => ({}));
      throw new Error(detail.error || `预览失败（${renderResponse.status}）`);
    }
    data.rendered = await renderResponse.json();
    rendered.set(example.id, data);
    return data;
  }

  async function renderPreviews(cards) {
    let next = 0;
    async function worker() {
      while (next < catalog.length) {
        const example = catalog[next++];
        const card = cards.get(example.id);
        try {
          const data = await loadExample(example);
          const frameRevision = ++revision;
          previewFrames.set(card.frame.contentWindow, { revision: frameRevision, status: card.status });
          card.frame.srcdoc = injectRevision(data.rendered.html, frameRevision);
          card.create.disabled = !data.md?.trim();
          card.status.hidden = false;
          card.status.textContent = '正在排版预览…';
        } catch (error) {
          if (error.name !== 'AbortError') card.status.textContent = error.message || '预览加载失败';
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, catalog.length) }, worker));
  }

  async function loadCatalog() {
    try {
    const response = await fetch('/api/examples');
      if (!response.ok) throw new Error(`模板目录加载失败（${response.status}）`);
      const data = await response.json();
      catalog = Array.isArray(data) ? data : data.examples || [];
      window.md2pdfTemplateTitles = Object.fromEntries(catalog.map(item => [item.id, item.title || item.id]));
      const draft = readDraft();
      if (draft?.md) {
        try {
          const resolved = await fetch('/api/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ md: draft.md, opts: draft.opts?.type ? { type: draft.opts.type } : {} }),
          });
          const { type } = await resolved.json();
          const match = catalog.find(item => item.type === type && item.id === draft.templateId)
            || catalog.find(item => item.type === type);
          if (match) match.current = true;
        } catch { /* 识别不可用时仍可浏览模板 */ }
      }
      setStatus(`${catalog.length} 个模板`);
      renderCards();
    } catch (error) {
      setStatus(error.message, true);
      listEl.setAttribute('aria-busy', 'false');
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const requestedTemplateView = window.__MD2PDF_INITIAL_VIEW__ === 'templates'
      || new URLSearchParams(location.search).get('view') === 'templates';
    const initial = requestedTemplateView || history.state?.md2pdfView === 'templates' ? 'templates' : 'editor';
    history.replaceState({ ...(history.state || {}), md2pdfView: initial }, '', '/');
    navigate(initial, false);
  });
})();
