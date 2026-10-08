'use strict';

// md2pdf 示例库前端。
// 目录：GET /api/examples -> {examples:[{id,type,title,description}]}（也兼容直接返回数组）。
// 单条：GET /api/example?id=... -> {md,type,title}。
// 预览：POST /api/render {md,opts:{type}} -> {html,type,policy}。
// 浏览与预览只读，不写入编辑器草稿；「使用此示例」经 sessionStorage 交接并跳转。

const listEl = document.querySelector('#example-list');
const listStatus = document.querySelector('#list-status');
const detailTitle = document.querySelector('#detail-title');
const detailMeta = document.querySelector('#detail-meta');
const sourceType = document.querySelector('#source-type');
const useButton = document.querySelector('#use-example');
const source = document.querySelector('#example-source');
const iframe = document.querySelector('#example-preview');
const exampleEmpty = document.querySelector('#example-empty');
const previewState = document.querySelector('#preview-state');

const HANDOFF_KEY = 'md2pdf:handoff';
const DRAFT_KEY = 'md2pdf:draft';

let catalog = [];
let activeId = null;
let activeType = '';
let controller = null;
let revision = 0;
let previewRevision = -1;
let previewTimer;
let typeLabels = {};

function setListStatus(message, error = false) {
  listStatus.textContent = message;
  listStatus.dataset.error = String(error);
}
function setPreviewState(message, error = false) {
  previewState.textContent = message;
  previewState.dataset.error = String(error);
}
function typeLabel(type) { return typeLabels[type] || type || '自动识别'; }

function readDraftMd() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return '';
    const draft = JSON.parse(raw);
    return typeof draft.md === 'string' ? draft.md : '';
  } catch { return ''; }
}

function injectRevision(html, rev) {
  return String(html)
    .replaceAll("type:'md2pdf-ready'", `type:'md2pdf-ready',revision:${rev}`)
    .replaceAll("type:'md2pdf-error'", `type:'md2pdf-error',revision:${rev}`);
}

async function loadLabels() {
  try {
    const response = await fetch('/api/policy');
    if (!response.ok) return;
    const doc = await response.json();
    typeLabels = (doc && doc.labels && doc.labels.type) || {};
  } catch { /* 标签缺失时回退为类型 id */ }
}

async function loadCatalog() {
  const response = await fetch('/api/examples');
  if (!response.ok) throw new Error(`示例目录加载失败（${response.status}）`);
  const data = await response.json();
  if (Array.isArray(data)) return data;
  return Array.isArray(data && data.examples) ? data.examples : [];
}

function renderCards() {
  listEl.replaceChildren();
  for (const example of catalog) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'example-card';
    button.dataset.id = example.id;
    button.setAttribute('aria-pressed', 'false');

    const badge = document.createElement('span');
    badge.className = 'type-badge';
    badge.textContent = typeLabel(example.type);

    const title = document.createElement('h3');
    title.textContent = example.title || example.id;

    const summary = document.createElement('p');
    summary.textContent = example.description || example.summary || '';

    button.append(badge, title, summary);

    const tags = example.tags;
    if (Array.isArray(tags) && tags.length) {
      const tagList = document.createElement('ul');
      tagList.className = 'example-tags';
      for (const tag of tags) { const li = document.createElement('li'); li.textContent = tag; tagList.append(li); }
      button.append(tagList);
    }

    button.addEventListener('click', () => selectExample(example.id));
    item.append(button);
    listEl.append(item);
  }
  listEl.setAttribute('aria-busy', 'false');
}

async function selectExample(id) {
  activeId = id;
  for (const button of listEl.querySelectorAll('.example-card')) button.setAttribute('aria-pressed', String(button.dataset.id === id));
  const meta = catalog.find(entry => entry.id === id) || {};
  useButton.disabled = true;
  source.value = '';
  if (exampleEmpty) exampleEmpty.hidden = false;
  detailTitle.textContent = meta.title || id;
  detailMeta.textContent = meta.description || meta.summary || '';
  sourceType.textContent = typeLabel(meta.type);
  setPreviewState('正在加载源码…');

  revision++;
  controller?.abort();
  controller = new AbortController();
  const current = revision;
  try {
    const response = await fetch('/api/example?id=' + encodeURIComponent(id), { signal: controller.signal });
    if (!response.ok) throw new Error(`示例加载失败（${response.status}）`);
    const data = await response.json();
    if (current !== revision) return;
    source.value = typeof data.md === 'string' ? data.md : '';
    activeType = data.type || meta.type || '';
    sourceType.textContent = typeLabel(activeType);
    useButton.disabled = !source.value.trim();
    exampleEmpty.hidden = true;
    setPreviewState('正在排版预览…');

    previewRevision = -1;
    clearTimeout(previewTimer);
    const renderResponse = await fetch('/api/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ md: source.value, opts: activeType ? { type: activeType } : {} }),
      signal: controller.signal,
    });
    if (!renderResponse.ok) {
      const detail = await renderResponse.json().catch(() => ({}));
      throw new Error(detail.error || `预览失败（${renderResponse.status}）`);
    }
    const result = await renderResponse.json();
    if (current !== revision) return;
    previewRevision = current;
    iframe.srcdoc = injectRevision(result.html, current);
    setPreviewState('正在加载公式、图表与分页…');
    previewTimer = setTimeout(() => { if (current === revision) setPreviewState('排版等待超时，请重试。', true); }, 60000);
  } catch (error) {
    if (error.name !== 'AbortError' && current === revision) {
      setPreviewState(error.message, true);
      setListStatus(error.message, true);
    }
  }
}

window.addEventListener('message', event => {
  if (event.source !== iframe.contentWindow || !event.data || event.data.revision !== previewRevision || previewRevision !== revision) return;
  if (event.data.type === 'md2pdf-ready') { clearTimeout(previewTimer); setPreviewState('预览已更新'); }
  else if (event.data.type === 'md2pdf-error') { clearTimeout(previewTimer); setPreviewState(event.data.error || '预览排版失败。', true); }
});

useButton.addEventListener('click', () => {
  const md = source.value;
  if (!md.trim()) return;
  const existing = readDraftMd();
  if (existing.trim() && !window.confirm('编辑器中有草稿，使用该示例会将其替换，是否继续？')) return;
  const meta = catalog.find(entry => entry.id === activeId) || {};
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ md, type: activeType || meta.type || '', title: meta.title || '', replaceConfirmed: true }));
  } catch { setPreviewState('浏览器无法保存示例交接，请复制源码到编辑器。', true); return; }
  location.href = '/';
});

async function boot() {
  await loadLabels();
  try { catalog = await loadCatalog(); }
  catch (error) { setListStatus(error.message, true); listEl.setAttribute('aria-busy', 'false'); return; }
  if (!catalog.length) { setListStatus('暂无可用的示例。', true); listEl.setAttribute('aria-busy', 'false'); return; }
  renderCards();
  setListStatus(`共 ${catalog.length} 个示例`);
  selectExample(catalog[0].id);
}

boot();
