'use strict';

// md2pdf 在线工作台前端。
// 选项策略来自 GET /api/policy（src/web-options.mjs 的 webPolicyDocument），
// 自动识别走 POST /api/resolve，渲染走 POST /api/render（返回 {html,type,policy}）。
// 控件按「生效类型」显示/隐藏：不可用的选项被隐藏并清除，避免把不兼容的旧设置发给服务端。

const editor = document.querySelector('#markdown');
const form = document.querySelector('#options');
const preview = document.querySelector('#preview');
const statusEl = document.querySelector('#status');
const download = document.querySelector('#download');
const countEl = document.querySelector('#count');
const emptyPreview = document.querySelector('#empty-preview');
const documentType = document.querySelector('#document-type');
const fixedRules = document.querySelector('#fixed-rules');
const browseExamples = document.querySelector('#browse-examples');
const topExamplesLink = document.querySelector('#examples-link-top');

const DRAFT_KEY = 'md2pdf:draft';
const HANDOFF_KEY = 'md2pdf:handoff';
const CONTROL_ORDER = ['type', 'theme', 'toc', 'fontSize', 'margin', 'numbering', 'numberScheme'];

let timer;
let controller;
let revision = 0;
let downloading = false;
let initialized = false;
let previewTimer;
let previewRevision = -1;
let policyDoc = null;
let currentPolicy = null;
let resolveCache = { key: null, result: null };

// ---------- 浏览器会话存储（草稿与选项），失败时静默降级 ----------
function readStore(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function writeStore(key, value) { try { value == null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); } catch { /* 隐私模式等：忽略 */ } }
function readFormOptions() {
  const opts = {};
  for (const name of CONTROL_ORDER) { const field = form.elements[name]; if (field) opts[name] = field.value; }
  return opts;
}
function saveDraft() {
  if (!editor || !initialized) return;
  writeStore(DRAFT_KEY, JSON.stringify({ md: editor.value, opts: readFormOptions(), savedAt: Date.now() }));
}
function readDraft() {
  const raw = readStore(DRAFT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function readHandoff() {
  const raw = readStore(HANDOFF_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function setStatus(message, error = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.error = String(error);
}

function typeLabel(type) { return (policyDoc && policyDoc.labels && policyDoc.labels.type && policyDoc.labels.type[type]) || type || '自动识别'; }

function updateCount() {
  if (countEl) countEl.textContent = `${editor.value.length.toLocaleString('zh-CN')} 字符`;
  download.disabled = downloading || !editor.value.trim();
}

// ---------- 选项策略 ----------
function controlWrap(name) { return form.querySelector('[data-control="' + name + '"]'); }

function fillSelect(select, entries, emptyLabel) {
  const previous = select.value;
  select.replaceChildren();
  if (emptyLabel !== undefined) { const option = document.createElement('option'); option.value = ''; option.textContent = emptyLabel; select.append(option); }
  for (const [value, label] of entries) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
  const allowed = Array.from(select.options).map(option => option.value);
  select.value = allowed.includes(previous) ? previous : '';
}

function enumEntries(name, control) {
  const labels = (policyDoc && policyDoc.labels) || {};
  const values = control.values || [];
  if (name === 'theme') return values.map(value => [value, (labels.theme && labels.theme[value]) || value]);
  if (name === 'numbering') return values.map(value => [value, (labels.numbering && labels.numbering[value]) || value]);
  if (name === 'numberScheme') return values.map(value => [value, (labels.numberScheme && labels.numberScheme[value]) || value]);
  if (name === 'margin') {
    const options = (policyDoc && policyDoc.marginOptions) || [];
    return values.map(value => { const found = options.find(item => item.value === value); return [value, found ? found.label : value]; });
  }
  return values.map(value => [value, value]);
}

// 按策略调整控件：不可用 → 隐藏并清空；可用 → 恢复「跟随文档」并过滤合规取值。
function applyPolicy(policy) {
  if (!policy || !policy.controls) return;
  currentPolicy = policy;
  document.dispatchEvent(new CustomEvent('md-document-type', { detail: { type: policy.type } }));
  for (const [name, control] of Object.entries(policy.controls)) {
    if (name === 'type') continue;
    const field = form.elements[name];
    const wrap = controlWrap(name);
    if (!field) continue;
    const available = control.available !== false;
    if (!available) {
      if (wrap) wrap.hidden = true;
      field.value = '';
      continue;
    }
    if (wrap) wrap.hidden = false;
    if (control.kind === 'enum' && field.tagName === 'SELECT') {
      // 空值 = 跟随文档（不发送覆盖），始终保留该选项。
      fillSelect(field, enumEntries(name, control), '跟随文档');
    } else if (control.kind === 'tri' && field.tagName === 'SELECT') {
      fillSelect(field, [['true', '显示'], ['false', '隐藏']], '跟随文档');
    } else if (control.kind === 'number') {
      if (control.min != null) field.min = control.min;
      if (control.max != null) field.max = control.max;
      if (control.step != null) field.step = control.step;
      field.placeholder = '默认';
    }
  }
  renderFixedRules(policy);
  saveDraft();
}

function renderFixedRules(policy) {
  const lines = [];
  for (const [name, control] of Object.entries(policy.controls || {})) {
    if (name === 'type' || control.available !== false) continue;
    const label = control.label || name;
    let fixed = control.fixedLabel || control.fixedValue || '固定';
    if (name === 'margin' && control.fixedNote) fixed = fixed + '；' + control.fixedNote;
    lines.push(label + '：' + fixed + '（固定）');
  }
  let text;
  if (policy.locked) text = '国家标准模板固定规则：' + lines.join('；') + '。';
  else if (lines.length) text = '固定规则：' + lines.join('；') + '。';
  else text = '当前文档类型下所有选项均可在线调整。';
  const notes = (policy.notes || []).join(' ');
  if (notes) text += ' ' + notes;
  if (fixedRules) { fixedRules.textContent = text; fixedRules.hidden = false; }
}

function applyStoredOptions(stored) {
  for (const [name, value] of Object.entries(stored || {})) {
    const field = form.elements[name];
    if (!field || typeof value !== 'string') continue;
    if (field.tagName === 'SELECT') {
      const allowed = Array.from(field.options).map(option => option.value);
      if (!allowed.includes(value)) continue;
    }
    field.value = value;
  }
}

// 只收集「当前策略下可用」的取值；空值表示跟随文档，不发送。
function collectedOptions() {
  const options = {};
  const controls = (currentPolicy && currentPolicy.controls) || {};
  const available = name => { const control = controls[name]; return !control || control.available !== false; };
  for (const name of CONTROL_ORDER) {
    if (name === 'type' || !available(name)) continue;
    const field = form.elements[name];
    if (!field) continue;
    const value = field.value;
    if (value === '') continue;
    if (name === 'margin') { const n = Number(value); if (Number.isFinite(n)) { options.marginTop = options.marginBottom = options.marginLeft = options.marginRight = n; } }
    else if (name === 'fontSize') { const n = Number(value); if (Number.isFinite(n) && n > 0) options.fontSize = n; }
    else if (name === 'toc') options.toc = value === 'true';
    else options[name] = value;
  }
  const explicit = form.elements.type.value;
  if (explicit) options.type = explicit;
  return options;
}

// ---------- 网络 ----------
async function request(url, body, signal) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `请求失败（${response.status}）`);
  }
  return response;
}

function injectRevision(html, rev) {
  return String(html)
    .replaceAll("type:'md2pdf-ready'", `type:'md2pdf-ready',revision:${rev}`)
    .replaceAll("type:'md2pdf-error'", `type:'md2pdf-error',revision:${rev}`)
    .replaceAll("type:'md2pdf-source'", `type:'md2pdf-source',revision:${rev}`);
}

async function resolveDocument(signal) {
  const key = editor.value;
  if (resolveCache.key === key && resolveCache.result) return resolveCache.result;
  const response = await request('/api/resolve', { md: editor.value, opts: {} }, signal);
  const result = await response.json();
  resolveCache = { key, result };
  return result;
}

// ---------- 预览（保留原有防抖 450ms 与 revision 竞态保护） ----------
function schedulePreview() {
  revision++;
  previewRevision = -1;
  clearTimeout(timer);
  clearTimeout(previewTimer);
  controller?.abort();
  updateCount();
  setStatus('等待更新…');
  timer = setTimeout(renderPreview, 450);
}

async function renderPreview() {
  const current = revision;
  if (!form.reportValidity()) { setStatus('请检查排版选项。', true); return; }
  if (!editor.value.trim()) {
    preview.removeAttribute('srcdoc');
    if (emptyPreview) emptyPreview.hidden = false;
    setStatus('输入 Markdown 即可开始排版。');
    return;
  }
  controller = new AbortController();
  setStatus('正在生成预览…');
  try {
    const explicit = form.elements.type.value;
    let type = explicit;
    if (!explicit) {
      // 自动模式：先轻量识别类型，按识别结果适配控件，再渲染，避免发送被禁用的旧设置。
      let resolved = null;
      try { resolved = await resolveDocument(controller.signal); }
      catch (error) { if (error.name === 'AbortError') throw error; }
      if (current !== revision) return;
      if (resolved && resolved.policy) applyPolicy(resolved.policy);
      if (resolved && resolved.type) type = resolved.type;
    } else if (policyDoc && policyDoc.policy && policyDoc.policy[explicit]) {
      applyPolicy(policyDoc.policy[explicit]);
    }
    const opts = collectedOptions();
    if (!explicit && type) opts.type = type;
    const response = await request('/api/render', { md: editor.value, opts }, controller.signal);
    const result = await response.json();
    if (current !== revision) return;
    if (result.policy) applyPolicy(result.policy);
    if (emptyPreview) emptyPreview.hidden = true;
    if (documentType) documentType.textContent = typeLabel(result.type || type) + ' · A4';
    previewRevision = current;
    preview.srcdoc = injectRevision(result.html, current);
    setStatus('正在加载公式、图表与分页…');
    previewTimer = setTimeout(() => { if (current === revision) setStatus('排版等待超时，请修改内容或重试。', true); }, 60000);
  } catch (error) {
    if (error.name !== 'AbortError' && current === revision) setStatus(error.message, true);
  }
}

window.addEventListener('message', event => {
  if (event.source !== preview.contentWindow || !event.data || event.data.revision !== previewRevision || previewRevision !== revision) return;
  if (event.data.type === 'md2pdf-ready') {
    clearTimeout(previewTimer);
    if (!downloading) setStatus('预览已更新');
  } else if (event.data.type === 'md2pdf-source' && Number.isSafeInteger(event.data.line) && event.data.line > 0 && event.data.line <= editor.value.split('\n').length) {
    document.dispatchEvent(new CustomEvent('md-preview-source', { detail: { line: event.data.line } }));
  } else if (event.data.type === 'md2pdf-error') {
    clearTimeout(previewTimer);
    setStatus(event.data.error || '预览排版失败。', true);
  }
});

// ---------- 启动 ----------
async function loadPolicy() {
  const response = await fetch('/api/policy');
  if (!response.ok) throw new Error(`选项策略加载失败（${response.status}）`);
  policyDoc = await response.json();
}

async function loadDefaultExample() {
  const startedAt = revision;
  try {
    const response = await fetch('/api/example');
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (startedAt !== revision) return;
    if (typeof result.md === 'string') editor.value = result.md;
    if (result.type && policyDoc && policyDoc.policy && policyDoc.policy[result.type]) applyPolicy(policyDoc.policy[result.type]);
    setStatus('已载入默认示例。');
  } catch {
    if (startedAt === revision) setStatus('示例加载失败，请直接输入 Markdown。', true);
  }
}

async function boot() {
  const startedAt = revision;
  const draft = readDraft();
  const handoff = readHandoff();
  try { await loadPolicy(); }
  catch (error) { setStatus(error.message, true); }
  if (policyDoc && policyDoc.autoPolicy) applyPolicy(policyDoc.autoPolicy);

  // 恢复会话草稿（浏览示例库返回或刷新后仍在）。
  if (revision === startedAt && draft && typeof draft.md === 'string') {
    editor.value = draft.md;
    applyStoredOptions(draft.opts);
    const restoredType = draft.opts && draft.opts.type;
    if (restoredType && policyDoc && policyDoc.policy && policyDoc.policy[restoredType]) applyPolicy(policyDoc.policy[restoredType]);
  }

  // 显式「使用此示例」经由 sessionStorage 交接；已有草稿需确认才替换。
  if (revision === startedAt && handoff && typeof handoff.md === 'string') {
    writeStore(HANDOFF_KEY, null);
    const hasDraft = editor.value.trim().length > 0;
    if (handoff.replaceConfirmed || !hasDraft || window.confirm('使用示例会替换编辑器中的当前草稿，是否继续？')) {
      editor.value = handoff.md;
      if (handoff.type) {
        if (policyDoc && policyDoc.policy && policyDoc.policy[handoff.type]) applyPolicy(policyDoc.policy[handoff.type]);
        form.elements.type.value = handoff.type;
      }
      setStatus('已载入示例，正在排版…');
    } else {
      setStatus('已保留当前草稿。');
    }
  } else if (!editor.value.trim()) {
    await loadDefaultExample();
  }

  initialized = true;
  saveDraft();
  editor.placeholder = '在此输入 Markdown…';
  updateCount();
  if (editor.value.trim()) schedulePreview();
  else setStatus('输入 Markdown 即可开始排版。');
}

// ---------- 事件 ----------
editor.addEventListener('input', () => { saveDraft(); schedulePreview(); });
form.addEventListener('input', () => { saveDraft(); schedulePreview(); });
form.addEventListener('submit', event => event.preventDefault());
form.elements.type.addEventListener('change', () => {
  const value = form.elements.type.value;
  if (!value && policyDoc && policyDoc.autoPolicy) applyPolicy(policyDoc.autoPolicy);
  else if (value && policyDoc && policyDoc.policy && policyDoc.policy[value]) applyPolicy(policyDoc.policy[value]);
});
for (const link of [browseExamples, topExamplesLink]) link?.addEventListener('click', saveDraft);
window.addEventListener('pagehide', saveDraft);

download.addEventListener('click', async () => {
  if (!form.reportValidity()) return;
  downloading = true;
  updateCount();
  download.textContent = '正在导出…';
  setStatus('正在生成 PDF，复杂文档可能需要稍等。');
  const exportRevision = revision;
  const exportMd = editor.value;
  const exportOptions = collectedOptions();
  try {
    if (!exportOptions.type) {
      const resolved = await (await request('/api/resolve', { md: exportMd, opts: {} })).json();
      exportOptions.type = resolved.type;
      for (const key of Object.keys(exportOptions)) {
        if (key === 'type') continue;
        const control = resolved.policy.controls[key.startsWith('margin') ? 'margin' : key];
        if (control && (control.available === false || (!key.startsWith('margin') && Array.isArray(control.values) && !control.values.includes(exportOptions[key])))) delete exportOptions[key];
      }
    }
    const response = await request('/api/pdf', { md: exportMd, opts: exportOptions });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const disposition = response.headers.get('Content-Disposition') || '';
    const marker = "filename*=UTF-8''";
    const at = disposition.indexOf(marker);
    const encoded = at >= 0 ? disposition.slice(at + marker.length) : '';
    const decoded = encoded ? decodeURIComponent(encoded) : '';
    anchor.download = decoded || 'document.pdf';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    if (revision !== exportRevision) setStatus('PDF 已生成并开始下载（导出的是开始导出时的版本，期间编辑未包含）。');
    else setStatus('PDF 已生成，下载已开始。');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    downloading = false;
    download.textContent = '下载 PDF ↓';
    updateCount();
  }
});

boot();
