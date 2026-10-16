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
  const shortTemplateNames = { general: '通用文档', paper: '学术论文', gb: '国家标准', skill: '技能文档' };
  const templateOrder = ['general', 'paper', 'gb', 'skill'];
  let catalog = [];
  let revision = 0;
  let currentTemplateRefresh = 0;
  const rendered = new Map();
  const previewFrames = new Map();
  const previewChoices = new Map();

  function setStatus(message, error = false) {
    listStatus.textContent = message;
    listStatus.dataset.error = String(error);
  }

  function readDraft() {
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); }
    catch { return null; }
  }

  async function refreshCurrentTemplate() {
    const refresh = ++currentTemplateRefresh;
    const draft = readDraft();
    let type = draft?.previewType || '';
    if (!type && draft?.md) {
      try {
        const response = await fetch('/api/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ md: draft.md, opts: draft.opts?.type ? { type: draft.opts.type } : {} }),
        });
        if (response.ok) ({ type } = await response.json());
      } catch { /* 识别不可用时仍可浏览模板 */ }
    }
    if (refresh !== currentTemplateRefresh) return;
    const match = catalog.find(item => item.type === type && item.id === draft?.templateId)
      || catalog.find(item => item.type === type);
    for (const example of catalog) {
      example.current = example === match;
      const card = listEl.querySelector(`[data-id="${CSS.escape(example.id)}"]`);
      if (!card) continue;
      card.setAttribute('aria-current', String(example.current));
      card.dataset.currentTemplate = String(example.current);
      const badge = card.querySelector('.type-badge');
      badge.classList.toggle('is-current', example.current);
      badge.title = example.current ? `当前模板：${example.title || example.id}` : (example.title || example.id);
    }
  }

  function injectRevision(html, rev) {
    const cardCss = '@media screen { html.md2pdf-template-card, html.md2pdf-template-card body { overflow-anchor: none !important; } html.md2pdf-template-card body { padding: 12px 0 !important; } }';
    return String(html)
      .replace('style.textContent = PREVIEW_CSS;', `document.documentElement.classList.add('md2pdf-template-card'); style.textContent = PREVIEW_CSS + ${JSON.stringify(cardCss)};`)
      .replace('Math.min(1, (document.documentElement.clientWidth - 24) / page.offsetWidth)', '((document.documentElement.clientWidth - 24) / page.offsetWidth)')
      .replace("parent.postMessage({type:'md2pdf-ready'", "scrollTo(0, 0); parent.postMessage({type:'md2pdf-ready'")
      .replaceAll("type:'md2pdf-ready'", `type:'md2pdf-ready',revision:${rev}`)
      .replaceAll("type:'md2pdf-error'", `type:'md2pdf-error',revision:${rev}`);
  }

  function navigate(view, push = true) {
    const editorView = document.querySelector('[data-view="editor"]');
    if (view === 'editor' && !editorView) { location.assign('/'); return; }
    if (push) history.pushState({ ...(history.state || {}), md2pdfView: view }, '', location.pathname === '/app/' ? '/app/' : '/');
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
    if (view === 'templates') {
      if (!catalog.length) loadCatalog();
      else refreshCurrentTemplate();
    }
    if (view === 'editor') {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('md2pdf-editor-view'));
    }
  }

  document.addEventListener('click', async event => {
    const link = event.target.closest('[data-view-link]');
    if (!link) return;
    event.preventDefault();
    try { await window.mdDrafts?.flush(); } catch { return; }
    navigate(link.dataset.viewLink);
  });
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-create-template]');
    if (!button || button.disabled) return;
    const id = button.dataset.createTemplate;
    const meta = catalog.find(entry => entry.id === id);
    if (!meta || !await window.mdConfirmTemplate()) return;
    try { await createFromTemplate(meta); }
    catch (error) { button.title = error.message || '浏览器无法保存模板交接，请重试。'; }
  });
  async function createFromTemplate(meta) {
    await window.mdDrafts?.flush();
    const data = await loadExample(meta, false);
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({
      id: meta.id, md: data.md, type: data.type || meta.type || '',
      title: meta.title || '', replaceConfirmed: true,
    }));
    navigate('editor');
  }
  window.mdCreateFromTemplate = createFromTemplate;
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
    if (event.data.type === 'md2pdf-ready') {
      state.status.hidden = true;
      state.image.hidden = true;
      state.frame.style.opacity = '1';
    }
    else if (event.data.type === 'md2pdf-error') {
      state.status.hidden = false;
      state.status.textContent = event.data.error || '预览排版失败';
    }
  });
  if (location.pathname !== '/' && location.pathname !== '/app/') history.replaceState({ ...(history.state || {}), md2pdfView: 'templates' }, '', '/');

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
    create.disabled = false;
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
      'M3 3h14v14H3zM3 7h14M8 7v10',
      'M10.5 12h4M12.5 10v4',
    ]) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      icon.append(path);
    }
    create.append(icon);
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'template-preview-toggle';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', '实时预览');
    toggle.checked = previewChoices.get(example.id) ?? example.id === 'general';
    const hint = document.createElement('span');
    hint.className = 'template-preview-hint';
    hint.textContent = '实时预览 · 开启后可滚动查看全文';
    hint.id = `preview-hint-${example.id}`;
    toggle.setAttribute('aria-describedby', hint.id);
    toggleLabel.addEventListener('click', () => toggleLabel.classList.add('hint-dismissed'));
    toggleLabel.addEventListener('mouseleave', () => toggleLabel.classList.remove('hint-dismissed'));
    toggleLabel.append(toggle, hint);
    heading.append(badge, toggleLabel, create);

    const preview = document.createElement('div');
    preview.className = 'template-card-preview';
    const image = document.createElement('img');
    image.className = 'template-card-snapshot';
    image.src = `/template-previews/${example.id}.png`;
    image.alt = `模板首页：${example.title || example.id}`;
    image.decoding = 'async';
    image.loading = 'lazy';
    const status = document.createElement('p');
    status.className = 'template-preview-status';
    status.setAttribute('role', 'status');
    status.hidden = true;
    preview.append(image, status);
    item.append(heading, copy, preview);
    const card = { item, preview, image, frame: null, status, create, toggle, generation: 0 };
    toggle.addEventListener('change', () => {
      previewChoices.set(example.id, toggle.checked);
      updatePreview(example, card);
    });
    return card;
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
    for (const example of catalog) {
      const card = cards.get(example.id);
      if (card.toggle.checked) updatePreview(example, card);
    }
  }

  async function loadExample(example, live = true) {
    let data = rendered.get(example.id);
    if (!data) {
      const response = await fetch('/api/example?id=' + encodeURIComponent(example.id));
      if (!response.ok) throw new Error(`模板加载失败（${response.status}）`);
      data = await response.json();
      rendered.set(example.id, data);
    }
    if (!live || data.rendered) return data;
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

  async function updatePreview(example, card) {
    const generation = ++card.generation;
    if (card.frame) {
      previewFrames.delete(card.frame.contentWindow);
      card.frame.remove();
      card.frame = null;
    }
    card.image.hidden = false;
    card.status.hidden = true;
    if (!card.toggle.checked) return;
    card.status.hidden = false;
    card.status.textContent = '正在生成实时预览…';
    try {
      const data = await loadExample(example);
      if (generation !== card.generation || !card.toggle.checked) return;
      const frame = document.createElement('iframe');
      frame.className = 'template-card-frame';
      frame.title = `模板排版预览：${example.title || example.id}`;
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      // visibility:hidden 会阻塞 iframe 的分页；用透明度等待完成信号。
      frame.style.opacity = '0';
      card.frame = frame;
      card.preview.append(frame);
      const frameRevision = ++revision;
      previewFrames.set(frame.contentWindow, { revision: frameRevision, status: card.status, image: card.image, frame });
      frame.srcdoc = injectRevision(data.rendered.html, frameRevision);
    } catch (error) {
      if (generation !== card.generation) return;
      card.status.textContent = error.message || '实时预览加载失败，请重新开启';
    }
  }

  async function loadCatalog() {
    try {
    const response = await fetch('/api/examples');
      if (!response.ok) throw new Error(`模板目录加载失败（${response.status}）`);
      const data = await response.json();
      catalog = Array.isArray(data) ? data : data.examples || [];
      catalog.sort((a, b) => {
        const aIndex = templateOrder.indexOf(a.id);
        const bIndex = templateOrder.indexOf(b.id);
        return (aIndex < 0 ? templateOrder.length : aIndex) - (bIndex < 0 ? templateOrder.length : bIndex);
      });
      window.md2pdfTemplateTitles = Object.fromEntries(catalog.map(item => [item.id, item.title || item.id]));
      await refreshCurrentTemplate();
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
    history.replaceState({ ...(history.state || {}), md2pdfView: initial }, '', location.pathname === '/app/' ? '/app/' : '/');
    navigate(initial, false);
  });
})();
