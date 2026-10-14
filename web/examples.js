'use strict';

// 模板库与编辑器共用 / 页面，模板视图通过 history.state 导航。
const HANDOFF_KEY = 'md2pdf:handoff';
const DRAFT_KEY = 'md2pdf:draft';
const root = document.querySelector('.template-library-page');
if (root) {
  const listEl = root.querySelector('#example-list');
  const listStatus = root.querySelector('#list-status');
  const detailTitle = root.querySelector('#detail-title');
  const detailMeta = root.querySelector('#detail-meta');
  const sourceType = root.querySelector('#source-type');
  const useButton = root.querySelector('#use-example');
  const source = root.querySelector('#example-source');
  const iframe = root.querySelector('#example-preview');
  const exampleEmpty = root.querySelector('#example-empty');
  const previewState = root.querySelector('#preview-state');
  const search = root.querySelector('#template-search');
  const listBack = root.querySelector('#template-list-back');
  let catalog = [];
  let activeId = '';
  let activeType = '';
  let controller;
  let revision = 0;
  let typeLabels = {};
  const rendered = new Map();

  function setStatus(message, error = false) { listStatus.textContent = message; listStatus.dataset.error = String(error); }
  function setPreviewState(message, error = false) { previewState.textContent = message; previewState.dataset.error = String(error); }
  function readDraft() { try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; } }
  function injectRevision(html, rev) {
    return String(html).replaceAll("type:'md2pdf-ready'", `type:'md2pdf-ready',revision:${rev}`).replaceAll("type:'md2pdf-error'", `type:'md2pdf-error',revision:${rev}`);
  }

  function navigate(view, push = true) {
    if (push) history.pushState({ ...(history.state || {}), md2pdfView: view }, '', '/');
    if (root.hidden) root.hidden = false;
    document.querySelectorAll('[data-view="editor"], .template-library-view, .template-library-page > .topbar').forEach(el => {
      const show = view === 'templates' ? el.matches('.template-library-view, .template-library-page > .topbar') : el.matches('[data-view="editor"]');
      el.hidden = !show;
    });
    document.body.classList.toggle('show-template-library', view === 'templates');
    if (view === 'templates' && !catalog.length) loadCatalog();
    if (view === 'editor') { window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('md2pdf-editor-view')); }
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-view-link]');
    if (!link) return;
    event.preventDefault();
    navigate(link.dataset.viewLink);
  });
  root.addEventListener('click', event => {
    const back = event.target.closest('[data-view-link="editor"]');
    if (back) { event.preventDefault(); navigate('editor'); }
  });
  listBack.addEventListener('click', () => document.body.classList.remove('template-detail-open'));
  root.addEventListener('click', event => {
    if (event.target.closest('.example-card') && matchMedia('(max-width: 760px)').matches) { document.body.classList.add('template-detail-open'); listBack.hidden = false; }
  });
  window.addEventListener('md2pdf-editor-view', () => {
    const handoff = (() => { try { return JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null'); } catch { return null; } })();
    if (handoff?.md) window.dispatchEvent(new Event('md2pdf-template-created'));
  });
  window.addEventListener('popstate', event => navigate(event.state?.md2pdfView === 'templates' ? 'templates' : 'editor', false));
  if (location.pathname !== '/') {
    history.replaceState({ ...(history.state || {}), md2pdfView: 'templates' }, '', '/');
    root.hidden = false;
    root.querySelector('.template-library-view').hidden = false;
    root.querySelector('.topbar').hidden = false;
  }

  function renderCards() {
    const query = search.value.trim().toLocaleLowerCase();
    listEl.replaceChildren();
    const visible = catalog.filter(item => `${item.title} ${item.description} ${(item.tags || []).join(' ')}`.toLocaleLowerCase().includes(query));
    for (const example of visible) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'example-card'; button.dataset.id = example.id;
      button.setAttribute('aria-pressed', String(example.id === activeId));
      if (example.current) button.dataset.currentTemplate = 'true';
      const badge = document.createElement('span'); badge.className = 'type-badge'; badge.textContent = example.current ? '当前模板' : '模板';
      const title = document.createElement('h3'); title.textContent = example.title || example.id;
      const summary = document.createElement('p'); summary.textContent = example.description || '';
      button.append(badge, title, summary);
      button.addEventListener('click', () => selectTemplate(example.id));
      li.append(button); listEl.append(li);
    }
    listEl.setAttribute('aria-busy', 'false');
  }

  async function loadCatalog() {
    try {
      const [response, policyResponse] = await Promise.all([fetch('/api/examples'), fetch('/api/policy')]);
      if (!response.ok) throw new Error(`模板目录加载失败（${response.status}）`);
      const data = await response.json();
      catalog = Array.isArray(data) ? data : data.examples || [];
      window.md2pdfTemplateTitles = Object.fromEntries(catalog.map(item => [item.id, item.title || item.id]));
      if (policyResponse.ok) typeLabels = (await policyResponse.json()).labels?.type || {};
      const draft = readDraft();
      if (draft?.md) {
        try {
          const resolved = await fetch('/api/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ md: draft.md, opts: draft.opts?.type ? { type: draft.opts.type } : {} }) });
          const { type } = await resolved.json();
          const match = catalog.find(item => item.type === type && item.id === draft.templateId) || catalog.find(item => item.type === type);
          if (match) match.current = true;
        } catch { /* 识别不可用时仍可浏览模板 */ }
      }
      renderCards();
      setStatus(`${catalog.length} 个模板`);
      const preferred = catalog.find(item => item.current) || catalog[0];
      if (preferred) selectTemplate(preferred.id);
    } catch (error) { setStatus(error.message, true); listEl.setAttribute('aria-busy', 'false'); }
  }

  async function selectTemplate(id) {
    const meta = catalog.find(item => item.id === id);
    if (!meta) return;
    activeId = id;
    document.body.classList.add('template-detail-open');
    listBack.hidden = !matchMedia('(max-width: 760px)').matches;
    renderCards();
    detailTitle.textContent = meta.title || id;
    detailMeta.textContent = meta.description || '';
    useButton.disabled = true;
    if (exampleEmpty) exampleEmpty.hidden = false;
    const current = ++revision;
    controller?.abort(); controller = new AbortController();
    setPreviewState(rendered.has(id) ? '正在加载预览…' : '正在生成预览…');
    try {
      let data = rendered.get(id);
      if (!data) {
        const response = await fetch('/api/example?id=' + encodeURIComponent(id), { signal: controller.signal });
        if (!response.ok) throw new Error(`模板加载失败（${response.status}）`);
        data = await response.json();
        if (current !== revision) return;
        const renderResponse = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ md: data.md, opts: data.type ? { type: data.type } : {} }), signal: controller.signal });
        if (!renderResponse.ok) { const detail = await renderResponse.json().catch(() => ({})); throw new Error(detail.error || `预览失败（${renderResponse.status}）`); }
        data.rendered = await renderResponse.json();
        rendered.set(id, data);
      }
      if (current !== revision) return;
      source.value = data.md || ''; activeType = data.type || meta.type || '';
      sourceType.textContent = typeLabels[activeType] || activeType || '模板';
      useButton.disabled = !source.value.trim();
      if (exampleEmpty) exampleEmpty.hidden = true;
      iframe.srcdoc = injectRevision(data.rendered.html, current);
      setPreviewState('正在加载公式、图表与分页…');
      setTimeout(() => { if (current === revision && previewState.textContent.startsWith('正在加载')) setPreviewState('预览加载较慢，请稍后重试。', true); }, 60000);
    } catch (error) { if (error.name !== 'AbortError' && current === revision) setPreviewState(error.message, true); }
  }

  window.addEventListener('message', event => {
    if (event.source !== iframe.contentWindow || !event.data || event.data.revision !== revision) return;
    if (event.data.type === 'md2pdf-ready') setPreviewState('预览已更新');
    else if (event.data.type === 'md2pdf-error') setPreviewState(event.data.error || '预览排版失败。', true);
  });
  search.addEventListener('input', renderCards);
  useButton.addEventListener('click', async () => {
    if (!source.value.trim() || !await window.mdConfirmTemplate()) return;
    const meta = catalog.find(entry => entry.id === activeId) || {};
    try {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ id: activeId, md: source.value, type: activeType || meta.type || '', title: meta.title || '', replaceConfirmed: true }));
      navigate('editor');
      window.dispatchEvent(new Event('md2pdf-template-created'));
    } catch { setPreviewState('浏览器无法保存模板交接，请复制源码到编辑器。', true); }
  });
  document.querySelector('#examples-link-top')?.addEventListener('click', event => { event.preventDefault(); navigate('templates'); });
  window.addEventListener('DOMContentLoaded', () => {
    const requestedTemplateView = new URLSearchParams(location.search).get('view') === 'templates';
    const initial = requestedTemplateView || history.state?.md2pdfView === 'templates' ? 'templates' : 'editor';
    root.hidden = false;
    history.replaceState({ ...(history.state || {}), md2pdfView: initial }, '', '/');
    if (initial === 'editor') root.querySelector('.template-library-view').hidden = true;
    navigate(initial, false);
  });
}
