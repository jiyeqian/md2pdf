'use strict';

const appFetch = (...args) => window.__MD2PDF_STATIC_BASE__ ? import('./runtime-request.mjs').then(runtime => runtime.appFetch(...args)) : fetch(...args);

// md2pdf 在线工作台前端。
// 选项策略来自 GET /api/policy（src/web-options.mjs 的 webPolicyDocument），
// 自动预览通过 /api/preview 一次识别并渲染；显式模板使用 /api/render。
// 控件按「生效类型」显示/隐藏：不可用的选项被隐藏并清除，避免把不兼容的旧设置发给服务端。

const editor = document.querySelector('#markdown');
const form = document.querySelector('#options');
const preview = document.querySelector('#preview');
const statusEl = document.querySelector('#status');
const download = document.querySelector('#download');
const countEl = document.querySelector('#count');
const emptyPreview = document.querySelector('#empty-preview');
const configErrorsEl = document.querySelector('#config-errors');
const topExamplesLink = document.querySelector('#examples-link-top');
const currentTemplateEl = document.querySelector('#current-template');
function trackUsage(event, properties) {
  try { window.md2pdfAnalytics?.track(event, properties); } catch { /* 统计不得影响文档操作。 */ }
}
let previewTelemetry;
function finishPreviewTelemetry(success) {
  const sample = previewTelemetry;
  if (!sample || sample.revision !== revision) return;
  previewTelemetry = null;
  const ms = Math.max(0, Date.now() - sample.started);
  trackUsage('preview_finished', {
    success, duration: ms < 1000 ? 'lt1s' : ms < 3000 ? '1to3s' : ms < 10000 ? '3to10s' : ms < 30000 ? '10to30s' : 'gte30s',
    length: sample.length, template: sample.template,
  });
}

const DRAFT_KEY = 'md2pdf:draft';
const HANDOFF_KEY = 'md2pdf:handoff';
let localDrafts = null;
let applyingDraft = false;
let previewMode = 'paged';
const CONTROL_ORDER = ['type', 'theme', 'landscape', 'toc', 'numbering', 'fontSize', 'margin', 'lineHeight'];

// ---------- 选项模型：范围滑块 + 「标题编号」合并菜单 ----------
// 范围控件（字号 / 边距 / 行距）：number 输入是唯一取值来源，range 仅是同一取值的快捷输入。
// 空字符串 = 跟随文档（省略该项，交给模板默认）——未显式操作时绝不写入隐式覆盖。
const RANGE_CONTROLS = ['fontSize', 'margin', 'lineHeight'];
// 后端未提供元数据时的兜底范围（与 src/web-options.mjs 的默认值保持一致；行距正文默认 1.9）。
const RANGE_FALLBACK = {
  fontSize: { min: 8, max: 24, step: 0.5, defaultValue: 10.5 },
  margin: { min: 10, max: 40, step: 1, defaultValue: 20 },
  lineHeight: { min: 1, max: 2.5, step: 0.05, defaultValue: 1.9 },
};
const HEADING_SCHEMES = ['arabic', 'cjk', 'chapter'];
const HEADING_SCHEME_LABELS = { arabic: '数字编号', cjk: '中文编号', chapter: '章节编号' };
// 范围控件的单位与无障碍标签：触发器默认「跟随文档」，显式值形如「12 pt / 25 mm / 2.1 倍」。
const RANGE_META = {
  fontSize: { unit: 'pt', label: '字号' },
  margin: { unit: 'mm', label: '页边距' },
  lineHeight: { unit: '倍', label: '行距' },
};

function isRangeControl(name) { return RANGE_CONTROLS.includes(name); }

// 解析某范围控件的可用区间与模板默认值；后端元数据缺失时回退到兜底范围。
function resolveRange(name, control) {
  const fallback = RANGE_FALLBACK[name] || { min: 0, max: 1, step: 0.1, defaultValue: 0 };
  const num = value => { if (value === null || value === undefined || value === '') return undefined; const n = Number(value); return Number.isFinite(n) ? n : undefined; };
  return {
    min: num(control && control.min) ?? fallback.min,
    max: num(control && control.max) ?? fallback.max,
    step: num(control && control.step) ?? fallback.step,
    defaultValue: num(control && control.defaultValue) ?? num(control && control.fixedValue) ?? fallback.defaultValue,
  };
}

// 范围取值的归一化：空 = 跟随文档（不发送）；其余必须是有限正数。
function rangeOptionValue(name, raw) {
  if (raw === '' || raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

// 控件的允许取值：null = 整组不可用；undefined = 任意合法值；数组 = 允许集合。
function allowedControlValues(control) {
  if (!control || control.available === false) return null;
  return Array.isArray(control.values) ? control.values : undefined;
}

// 「标题编号」菜单项：把 numbering + numberScheme 两个旧控件收敛成一个选择。
// 跟随文档 = 省略两项；不编号 = numbering none；自动编号 = numbering auto（省略方案）；
// force 的三种方案分别对应 arabic / cjk / chapter，并按当前类型能力过滤。
function headingChoices(controls = {}) {
  const entries = [['', '跟随文档']];
  const numbering = allowedControlValues(controls.numbering);
  if (numbering === null) return entries;
  const schemes = allowedControlValues(controls.numberScheme);
  const has = (list, value) => list === undefined || list.includes(value);
  if (has(numbering, 'none')) entries.push(['none', '不加编号']);
  if (has(numbering, 'auto')) entries.push(['auto', '自动编号']);
  if (has(numbering, 'force') && schemes !== null) {
    for (const scheme of HEADING_SCHEMES) if (has(schemes, scheme)) entries.push(['force:' + scheme, HEADING_SCHEME_LABELS[scheme]]);
  }
  return entries;
}

// 菜单值 → {numbering, numberScheme}（省略未选中的维度）。
function decodeHeadingToken(token) {
  const value = String(token || '');
  if (value === 'none' || value === 'auto') return { numbering: value };
  const [numbering, scheme] = value.split(':');
  if (numbering === 'force' && HEADING_SCHEMES.includes(scheme)) return { numbering: 'force', numberScheme: scheme };
  return {};
}

// 草稿 → 菜单值：兼容旧草稿的 numbering + numberScheme 两字段，也接受已存的合并 token。
function headingDraftToken(numbering, numberScheme) {
  const value = String(numbering || '');
  if (value.startsWith('force:')) return value;
  if (value === 'none' || value === 'auto') return value;
  if (value === 'force') return 'force:' + (HEADING_SCHEMES.includes(numberScheme) ? numberScheme : 'arabic');
  return '';
}

// 发送前按当前类型能力过滤，避免把切换类型后残留的不兼容取值发给后端。
function headingOptionsFromToken(token, controls = {}) {
  const decoded = decodeHeadingToken(token);
  const out = {};
  const numbering = allowedControlValues(controls.numbering);
  if (decoded.numbering && (numbering === undefined || (Array.isArray(numbering) && numbering.includes(decoded.numbering)))) out.numbering = decoded.numbering;
  if (decoded.numberScheme) {
    const schemes = allowedControlValues(controls.numberScheme);
    if (schemes === undefined || (Array.isArray(schemes) && schemes.includes(decoded.numberScheme))) out.numberScheme = decoded.numberScheme;
  }
  return out;
}

// 合并菜单可用性：numbering 不可用（GB 锁定）时整组隐藏。
function headingAvailable(controls = {}) {
  return allowedControlValues(controls.numbering) !== null;
}

let timer;
let controller;
let revision = 0;
let downloading = false;
let initialized = false;
let previewTimer;
let previewRevision = -1;
let previewWait = null;

function previewVisible() {
  if (document.visibilityState !== 'visible' || !preview?.isConnected) return false;
  const rect = preview.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
}

function updatePreviewVisibility(force = false) {
  if (!previewWait || previewWait.revision !== previewRevision || previewRevision !== revision) return;
  const visible = previewVisible();
  if (visible === previewWait.visible && force !== true) return;
  previewWait.budget.setVisible(visible, Date.now());
  previewWait.visible = visible;
  preview.contentWindow?.postMessage({ type: 'md2pdf-visibility', revision: previewRevision, visible }, '*');
  if (visible) {
    setStatus('正在加载公式、图表与分页…');
  } else {
    setStatus('预览已生成，滚动到预览区域后继续排版。');
  }
}

function armPreviewWait(current) {
  clearTimeout(previewTimer);
  const budget = new VisibleTimeBudget(60000);
  previewWait = { revision: current, visible: false, budget };
  const tick = () => {
    if (!previewWait || previewWait.revision !== current || current !== revision) return;
    updatePreviewVisibility();
    if (previewWait.budget.expired(Date.now())) {
      finishPreviewTelemetry(false);
      setStatus('排版等待超时，请修改内容或重试。', true);
      previewWait = null;
      return;
    }
    previewTimer = setTimeout(tick, 1000);
  };
  const visible = previewVisible();
  budget.setVisible(visible, Date.now());
  previewWait.visible = visible;
  preview.contentWindow?.postMessage({ type: 'md2pdf-visibility', revision: current, visible }, '*');
  if (!visible) setStatus('预览已生成，滚动到预览区域后继续排版。');
  previewTimer = setTimeout(tick, 1000);
}

document.addEventListener('visibilitychange', updatePreviewVisibility);
preview.addEventListener('load', () => updatePreviewVisibility(true));
window.addEventListener('scroll', updatePreviewVisibility, true);
window.addEventListener('resize', updatePreviewVisibility);
window.visualViewport?.addEventListener('resize', updatePreviewVisibility);
let policyDoc = null;
let currentPolicy = null;
let previewResetOptions = [];
let renderedTemplateType = '';
// 上次成功渲染：是否已有一份可用预览，以及当前配置是否无效（无效时禁止导出 PDF）。
let hasPreview = false;
let configInvalid = false;

// ---------- 浏览器会话存储（草稿与选项） ----------
function readStore(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function writeStore(key, value) { try { value == null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); return true; } catch { return false; } }
function readFormOptions() {
  const opts = {};
  for (const name of CONTROL_ORDER) { const field = form.elements[name]; if (field) opts[name] = field.value; }
  return opts;
}
function saveDraft() {
  if (!editor || !initialized || applyingDraft) return;
  if (localDrafts) { localDrafts.schedule(); return; }
  const previousDraft = readDraft();
  const templateId = previousDraft?.md === editor.value ? previousDraft.templateId : window.currentTemplateId;
  const saved = writeStore(DRAFT_KEY, JSON.stringify({ md: editor.value, opts: readFormOptions(), templateId, previewType: renderedTemplateType, savedAt: Date.now() }));
  let warning = document.getElementById('draft-warning');
  if (!saved && !warning) {
    warning = document.createElement('p');
    warning.id = 'draft-warning';
    warning.className = 'draft-warning';
    warning.setAttribute('role', 'alert');
    const footer = document.querySelector('.preview-footer');
    if (footer) footer.after(warning);
  }
  if (warning) {
    warning.hidden = saved;
    warning.textContent = saved ? '' : '当前修改未保存：浏览器存储额度不足或被禁用。请复制并保存 Markdown 源码后再刷新或离开；刷新可能恢复旧草稿。';
  }
}
function readDraft() {
  const raw = readStore(DRAFT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function captureDraft() {
  return { md: editor.value, opts: readFormOptions(), templateId: window.currentTemplateId || '', previewType: renderedTemplateType };
}
function applyDraft(record) {
  applyingDraft = true;
  try {
    for (const name of CONTROL_ORDER) if (form.elements[name]) form.elements[name].value = '';
    window.currentTemplateId = record.templateId || '';
    renderedTemplateType = record.previewType || '';
    renderedEffective = {};
    previewResetOptions = [];
    if (policyDoc) applyPolicy(policyDoc.policy?.[record.opts?.type] || policyDoc.autoPolicy);
    applyStoredOptions(record.opts);
    editor.value = record.md;
    if (currentTemplateEl) currentTemplateEl.textContent = '';
    clearConfigErrors();
    hasPreview = false;
    preview.removeAttribute('srcdoc');
    if (emptyPreview) emptyPreview.hidden = false;
    updateOptionTriggers();
    updateCount();
    if (initialized) schedulePreview();
  } finally { applyingDraft = false; }
}
window.mdCreateBlank = async () => {
  if (localDrafts) await localDrafts.createBlank();
  else { saveDraft(); applyDraft({ md: '', opts: {} }); saveDraft(); }
  window.mdEditor?.focus();
};
function reportDraft(message, error) {
  const node = document.querySelector('#draft-save-status');
  if (node) { node.textContent = message; node.dataset.error = String(!!error); }
}
function readHandoff() {
  const raw = readStore(HANDOFF_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

let previewMissingFonts = [];
function setStatus(message, error = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  if (previewMissingFonts.length) {
    const link = document.createElement('a');
    link.href = './gb-fonts.html';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '未能加载字体：' + previewMissingFonts.join('、') + '。';
    statusEl.replaceChildren(link);
  }
  statusEl.dataset.error = String(error);
}

// ---------- 配置错误提示（预览区顶部，iframe 之外） ----------
// 用 textContent 写入，绝不拼接 HTML —— 错误文案来自服务端，避免 XSS；提示不进 PDF。
function jumpToLine(line) {
  const api = window.mdEditor;
  if (api && typeof api.goToLine === 'function') { try { api.goToLine(line); } catch { /* 忽略 */ } }
  if (api && typeof api.focus === 'function') { try { api.focus(); } catch { /* 忽略 */ } }
}

function clearConfigErrors() {
  configInvalid = false;
  if (!configErrorsEl) { updateCount(); return; }
  configErrorsEl.hidden = true;
  const list = configErrorsEl.querySelector('.config-errors-list');
  if (list && typeof list.replaceChildren === 'function') list.replaceChildren();
  updateCount();
}

function showConfigErrors(errors, hadPreview = hasPreview) {
  configInvalid = true;
  if (configErrorsEl) {
    const list = configErrorsEl.querySelector('.config-errors-list');
    if (list) {
      list.replaceChildren();
      for (const item of errors) {
        if (!item || typeof item !== 'object') continue;
        const li = document.createElement('li');
        // 有原始行号时给出可点击的跳转按钮（第 N 行），点击定位正文并聚焦编辑器。
        if (Number.isSafeInteger(item.line) && item.line > 0) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'config-error-jump';
          button.textContent = `第 ${item.line} 行`;
          button.addEventListener('click', () => jumpToLine(item.line));
          li.append(button);
        }
        const message = document.createElement('span');
        message.className = 'config-error-message';
        message.textContent = String(item.message || '配置无效');
        li.append(message);
        list.append(li);
      }
    }
    configErrorsEl.hidden = false;
  }
  updateCount();
}

function updateCount() {
  if (countEl) countEl.textContent = `${editor.value.length.toLocaleString('zh-CN')} 字符`;
  download.disabled = downloading || !editor.value.trim() || configInvalid;
}

// 下载按钮加载态：只改状态属性与标签文本，保留内联 SVG 图标不被 textContent 抹除。
const downloadLabel = download ? download.querySelector('.btn-label') : null;
function setDownloadState(loading) {
  if (!download) return;
  download.dataset.state = loading ? 'loading' : 'idle';
  download.setAttribute('aria-busy', loading ? 'true' : 'false');
  if (downloadLabel) downloadLabel.textContent = loading ? '正在导出…' : '下载 PDF';
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
  return values.map(value => [value, value]);
}

// 按策略调整控件：不可用 → 隐藏并清空；可用 → 恢复「跟随文档」并过滤合规取值。
function applyPolicy(policy) {
  if (!policy || !policy.controls) return;
  currentPolicy = policy;
  window.mdEffectiveTemplateType = policy.type;
  document.dispatchEvent(new CustomEvent('md-document-type', { detail: { type: policy.type } }));
  const controls = policy.controls;
  for (const [name, control] of Object.entries(controls)) {
    if (name === 'type') continue;
    if (name === 'numberScheme') continue; // 已合并进「标题编号」菜单，不再单独渲染
    if (name === 'numbering') { applyHeadingControl(control, controls); continue; }
    if (isRangeControl(name)) { applyRangeControl(name, control); continue; }
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
      if (field.value === 'true') field.value = '1';
      fillSelect(field, [['false', '隐藏目录'], ['1', '一级目录'], ['2', '二级目录'], ['3', '三级目录']], '跟随文档');
    } else if (control.kind === 'number') {
      if (control.min != null) field.min = control.min;
      if (control.max != null) field.max = control.max;
      if (control.step != null) field.step = control.step;
      field.placeholder = '默认';
    }
  }
  updateOptionTriggers();
  saveDraft();
}

// 「标题编号」：按类型能力重建合并后的选项；GB 锁定则整组隐藏并清空。
function applyHeadingControl(control, controls) {
  const field = form.elements.numbering;
  const wrap = controlWrap('numbering');
  if (!field) return;
  if (!headingAvailable(controls)) {
    if (wrap) wrap.hidden = true;
    field.value = '';
    return;
  }
  if (wrap) wrap.hidden = false;
  fillSelect(field, headingChoices(controls), undefined);
}

// 范围控件：同步 min/max/step；未显式设置时仅在滑块上呈现模板默认，绝不写入 number 取值。
function applyRangeControl(name, control) {
  const field = form.elements[name];
  const wrap = controlWrap(name);
  if (!field) return;
  if (control.available === false) {
    if (wrap) wrap.hidden = true;
    const popover = wrap && wrap.querySelector('details.range-pop');
    if (popover) popover.open = false;
    field.value = '';
    const group = controlWrap(name);
    if (group) group.classList.remove('is-default');
    return;
  }
  if (wrap) wrap.hidden = false;
  const range = resolveRange(name, control);
  rangeMeta[name] = range;
  field.min = range.min; field.max = range.max; field.step = range.step; field.placeholder = '默认';
  updateRangeScale(name, range);
  const slider = rangeSlider(name);
  if (slider) { slider.min = range.min; slider.max = range.max; slider.step = range.step; }
  if (field.value === '') showRangeDefault(name, range);
  else reflectRangeValue(name, field.value);
}

const rangeMeta = {};
let renderedEffective = {};
function rangeSlider(name) { const group = controlWrap(name); return group ? group.querySelector('[data-range-slider="' + name + '"]') : null; }
function rangeScale(name) { const group = controlWrap(name); return group ? group.querySelector('[data-range-scale="' + name + '"]') : null; }
// 直尺端点：把策略区间显示在刻度条左右两侧（字号 8/24、边距 10/40、行距 1/2.5）。
function updateRangeScale(name, range) {
  const scale = rangeScale(name);
  if (!scale) return;
  const min = scale.querySelector('.ruler-label--min');
  const max = scale.querySelector('.ruler-label--max');
  if (min) min.textContent = String(range.min);
  if (max) max.textContent = String(range.max);
}
function rangeSummary(name) { const group = controlWrap(name); return group ? group.querySelector('summary.range-trigger') : null; }
function updateOrientationTrigger() {
  const field = form.elements.landscape;
  const trigger = form.querySelector('[data-orientation-toggle]');
  if (!field || !trigger) return;
  const landscape = field.value === '' ? Boolean(renderedEffective.landscape) : field.value === 'true';
  trigger.setAttribute('aria-pressed', String(landscape));
  trigger.title = landscape ? '切换为纵向排版' : '切换为横向排版';
  trigger.setAttribute('aria-label', trigger.title);
  trigger.classList.toggle('is-explicit', field.value !== '');
  trigger.disabled = currentPolicy?.controls.landscape?.available === false;
  const page = trigger.querySelector('[data-orientation-page]');
  if (page) for (const [key, value] of Object.entries(landscape ? { x: 3, y: 6, width: 18, height: 12 } : { x: 6, y: 3, width: 12, height: 18 })) page.setAttribute(key, value);
}
function updateOptionTriggers() {
  updateOrientationTrigger();
  for (const name of ['type', 'theme', 'toc', 'numbering']) {
    const wrap = controlWrap(name);
    const trigger = wrap && wrap.querySelector('[data-option-trigger]');
    const field = form.elements[name];
    if (!trigger || !field) continue;
    const option = Array.from(field.options).find(item => item.value === field.value);
    const label = { type: '模板', theme: '主题', toc: '目录', numbering: '编号' }[name];
    let text = option ? option.textContent : field.value || '跟随文档';
    if (field.value === '') {
      let effective = renderedEffective[name];
      if (name === 'type') effective = currentPolicy && currentPolicy.type;
      if (name === 'toc' && typeof effective === 'boolean') effective = effective ? `${renderedEffective.tocDepth || 1}级目录` : '关闭';
      if (effective !== undefined) text += `（当前 ${effective}）`;
    }
    trigger.title = `${label}：${text}`;
    trigger.setAttribute('aria-label', trigger.title);
    trigger.classList.toggle('is-explicit', field.value !== '');
    if (wrap.hidden) { const details = wrap.querySelector('details'); if (details) details.open = false; }
    renderOptionMenu(name);
  }
}
function renderOptionMenu(name, focusSelected = false) {
  const wrap = controlWrap(name);
  const menu = wrap && wrap.querySelector('[data-option-menu]');
  const field = form.elements[name];
  if (!menu || !field) return;
  const activeValue = document.activeElement && document.activeElement.getAttribute('data-option-value');
  const hadFocus = menu.contains && menu.contains(document.activeElement);
  let focusButton;
  menu.replaceChildren();
  for (const option of Array.from(field.options)) {
    if (option.disabled || option.hidden) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option-choice';
    button.textContent = option.textContent;
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', String(option.value === field.value));
    button.setAttribute('data-option-value', option.value);
    button.tabIndex = option.value === field.value ? 0 : -1;
    button.addEventListener('click', () => {
      field.value = option.value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      const details = wrap.querySelector('details');
      if (details) details.open = false;
      const trigger = wrap.querySelector('[data-option-trigger]');
      if (trigger) trigger.focus();
    });
    button.addEventListener('keydown', event => {
      const buttons = Array.from(menu.querySelectorAll('.option-choice'));
      let index = buttons.indexOf(button);
      if (event.key === 'ArrowDown') index = (index + 1) % buttons.length;
      else if (event.key === 'ArrowUp') index = (index + buttons.length - 1) % buttons.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = buttons.length - 1;
      else return;
      event.preventDefault();
      for (const item of buttons) item.tabIndex = -1;
      buttons[index].tabIndex = 0;
      buttons[index].focus();
    });
    menu.appendChild(button);
    if ((focusSelected && option.value === field.value) || (hadFocus && option.value === activeValue)) focusButton = button;
  }
  if (focusButton) focusButton.focus();
}
function currentRange(name) { return rangeMeta[name] || resolveRange(name, null); }
// 紧凑触发器文案：空值 = 跟随文档；显式值带单位（12 pt / 25 mm / 2.1 倍）。
function updateRangeTrigger(name) {
  const summary = rangeSummary(name);
  if (!summary) return;
  const meta = RANGE_META[name] || { unit: '', label: name };
  const field = form.elements[name];
  const raw = field ? field.value : '';
  const text = raw === '' ? '跟随文档' : `${raw} ${meta.unit}`.trim();
  let effective = renderedEffective[name];
  if (name === 'margin') {
    const sides = ['marginTop', 'marginBottom', 'marginLeft', 'marginRight'].map(key => renderedEffective[key]);
    if (sides.every(value => value !== undefined)) effective = sides.every(value => value === sides[0]) ? sides[0] : sides.join(' / ');
  }
  summary.title = `${meta.label}：${text}${raw === '' && effective !== undefined ? `（当前 ${effective} ${meta.unit}）` : ''}`;
  summary.classList.toggle('is-explicit', raw !== '');
  const bubble = controlWrap(name).querySelector('[data-range-value="' + name + '"]');
  const slider = rangeSlider(name);
  if (bubble && slider) {
    bubble.textContent = `${slider.value} ${meta.unit}`;
    const ratio = Math.max(0, Math.min(1, (Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min))));
    const width = slider.clientWidth || 0;
    bubble.style.left = `${(slider.offsetLeft || 0) + 4 + ratio * Math.max(0, width - 8)}px`;
  }
  summary.setAttribute('aria-label', `${meta.label}：${text}`);
}
function showRangeDefault(name, range) {
  const slider = rangeSlider(name);
  const effective = name === 'margin' ? renderedEffective.marginTop : renderedEffective[name];
  if (slider) slider.value = String(Number.isFinite(Number(effective)) ? effective : range.defaultValue);
  const group = controlWrap(name);
  if (group) group.classList.add('is-default');
  updateRangeTrigger(name);
}
function reflectRangeValue(name, value) {
  const slider = rangeSlider(name);
  if (slider && value !== '') slider.value = String(value);
  const group = controlWrap(name);
  if (group) group.classList.remove('is-default');
  updateRangeTrigger(name);
}

function applyStoredOptions(stored) {
  if (!stored) return;
  const adjusted = { ...stored };
  if (adjusted.type === 'readme') adjusted.type = 'general';
  if (adjusted.toc === 'true') adjusted.toc = '1';
  // 旧草稿存的是分开的 numbering / numberScheme，这里合并回菜单 token 后再恢复。
  if ('numbering' in adjusted || 'numberScheme' in adjusted) {
    adjusted.numbering = headingDraftToken(adjusted.numbering, adjusted.numberScheme);
    delete adjusted.numberScheme;
  }
  for (const [name, value] of Object.entries(adjusted)) {
    const field = form.elements[name];
    if (!field || typeof value !== 'string') continue;
    if (field.tagName === 'SELECT') {
      const allowed = Array.from(field.options).map(option => option.value);
      if (!allowed.includes(value)) continue;
    }
    field.value = value;
    // 显式草稿值：同步滑块并退出「默认」态（空值保持默认显示）。
    if (isRangeControl(name) && value !== '') reflectRangeValue(name, value);
  }
}

// 只收集「当前策略下可用」的取值；空值表示跟随文档，不发送。
function collectedOptions() {
  const options = {};
  const controls = (currentPolicy && currentPolicy.controls) || {};
  const available = name => {
    if (name === 'numbering') return headingAvailable(controls);
    const control = controls[name];
    return !control || control.available !== false;
  };
  for (const name of CONTROL_ORDER) {
    if (name === 'type' || !available(name)) continue;
    const field = form.elements[name];
    if (!field) continue;
    const value = field.value;
    if (value === '') continue;
    if (name === 'margin') { const n = rangeOptionValue(name, value); if (n !== undefined) { options.marginTop = options.marginBottom = options.marginLeft = options.marginRight = n; } }
    else if (name === 'fontSize' || name === 'lineHeight') { const n = rangeOptionValue(name, value); if (n !== undefined) options[name] = n; }
    else if (name === 'landscape') options.landscape = value === 'true';
    else if (name === 'toc') { options.toc = value !== 'false'; if (options.toc) options.tocDepth = Number(value); }
    else if (name === 'numbering') Object.assign(options, headingOptionsFromToken(value, controls));
    else options[name] = value;
  }
  const explicit = form.elements.type.value;
  if (explicit) options.type = explicit;
  return options;
}

// ---------- 网络 ----------
async function request(url, body, signal) {
  const response = await appFetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal,
    ...(['/api/render', '/api/preview'].includes(url) && window.__MD2PDF_STATIC_BASE__ ? { md2pdfConsumer: 'editor' } : {}),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const failure = new Error(detail.error || `请求失败（${response.status}）`);
    failure.status = response.status;
    failure.code = detail.code;
    failure.fonts = detail.fonts;
    // 配置错误：保留逐条行号信息，供顶部提示条展示与跳转。
    if (Array.isArray(detail.configErrors)) failure.configErrors = detail.configErrors;
    throw failure;
  }
  return response;
}

function injectRevision(html, rev) {
  return String(html)
    .replace('var MD2PDF_PREVIEW_REVISION = 0;', `var MD2PDF_PREVIEW_REVISION = ${rev};`)
    .replace('var MD2PDF_PREVIEW_MANAGED = false;', 'var MD2PDF_PREVIEW_MANAGED = true;')
    .replace('var MD2PDF_PREVIEW_FLOW = false;', `var MD2PDF_PREVIEW_FLOW = ${previewMode === 'flow'};`)
    .replaceAll("type:'md2pdf-ready'", `type:'md2pdf-ready',revision:${rev}`)
    .replaceAll("type:'md2pdf-error'", `type:'md2pdf-error',revision:${rev}`)
    .replaceAll("type:'md2pdf-source'", `type:'md2pdf-source',revision:${rev}`)
    .replaceAll("type:'md2pdf-exit-fullscreen'", `type:'md2pdf-exit-fullscreen',revision:${rev}`)
    .replaceAll("type:'md2pdf-open-repo'", `type:'md2pdf-open-repo',revision:${rev}`)
    .replaceAll("type:'md2pdf-preview-pointerdown'", `type:'md2pdf-preview-pointerdown',revision:${rev}`);
}

// ---------- 预览（保留原有防抖 450ms 与 revision 竞态保护） ----------
function schedulePreview() {
  revision++;
  previewRevision = -1;
  previewWait = null;
  clearTimeout(timer);
  clearTimeout(previewTimer);
  controller?.abort();
  updateCount();
  setStatus('等待更新…');
  timer = setTimeout(renderPreview, 450);
}

async function renderPreview() {
  if (!window.__MD2PDF_STATIC_BASE__ && !navigator.onLine) {
    setStatus('当前离线，预览与 PDF 导出需要联网。');
    return;
  }
  const current = revision;
  if (!form.reportValidity()) { setStatus('请检查排版选项。', true); return; }
  if (!editor.value.trim()) {
    preview.removeAttribute('srcdoc');
    renderedTemplateType = '';
    hasPreview = false;
    clearConfigErrors();
    if (emptyPreview) emptyPreview.hidden = false;
    previewMissingFonts = [];
    setStatus('输入 Markdown 即可开始排版。');
    saveDraft();
    return;
  }
  const activeController = new AbortController();
  controller = activeController;
  const size = editor.value.length;
  previewTelemetry = { revision: current, started: Date.now(),
    length: size < 1000 ? 'lt1k' : size < 10000 ? '1kto10k' : size < 50000 ? '10kto50k' : 'gte50k',
    template: form.elements.type.value || 'general' };
  setStatus('正在生成预览…');
  try {
    const explicit = form.elements.type.value;
    if (explicit && policyDoc && policyDoc.policy && policyDoc.policy[explicit]) {
      applyPolicy(policyDoc.policy[explicit]);
    }
    if (current !== revision || activeController.signal.aborted) return;
    // 自动识别时不回填 type：让服务端按 frontmatter / 自动探测决定类型，避免灌入假的显式值。
    const opts = collectedOptions();
    const response = await request(explicit ? '/api/render' : '/api/preview', { md: editor.value, opts }, activeController.signal);
    const result = await response.json();
    if (current !== revision || activeController.signal.aborted) return;
    renderedEffective = result.effective || {};
    previewResetOptions = result.resetOptions || [];
    document.dispatchEvent(new CustomEvent('md-document-diagnostics', { detail: { source:editor.value, authorDiagnostics:result.authorDiagnostics || [] } }));
    renderedTemplateType = result.type || result.effective?.type || '';
    if (previewTelemetry?.revision === current) previewTelemetry.template = renderedTemplateType || 'general';
    if (result.policy) applyPolicy(result.policy);
    if (currentTemplateEl) {
      const labels = policyDoc?.labels?.type || {};
      const effectiveTemplate = renderedTemplateType;
      const currentId = window.currentTemplateId;
      const title = currentId && (window.md2pdfTemplateTitles || {})[currentId];
      currentTemplateEl.textContent = title ? ` · ${title}` : effectiveTemplate ? ` · ${labels[effectiveTemplate] || effectiveTemplate}` : '';
    }
    if (emptyPreview) emptyPreview.hidden = true;
    // 成功渲染：清除上次的配置错误提示并恢复导出按钮（修正后自动恢复）。
    hasPreview = true;
    clearConfigErrors();
    previewRevision = current;
    preview.srcdoc = injectRevision(result.html, current);
    saveDraft();
    setStatus('正在加载公式、图表与分页…');
    armPreviewWait(current);
  } catch (error) {
    // 乱序响应：已被更新的请求取代（Abort 或 revision 落后）时直接忽略，不让陈旧失败覆盖新成功。
    if (error.name === 'AbortError' || current !== revision) return;
    finishPreviewTelemetry(false);
    if (Array.isArray(error.configErrors) && error.configErrors.length) {
      // 配置无效：保留上次成功预览（不重置 iframe），列出错误行号，禁止导出 PDF。
      showConfigErrors(error.configErrors, hasPreview);
      setStatus(hasPreview ? '配置无效 · 显示上次成功预览' : '配置无效：请修正文档配置后重试。', true);
    } else {
      setStatus(error.message, true);
    }
  }
}

window.addEventListener('message', event => {
  if (event.source !== preview.contentWindow || !event.data || event.data.revision !== previewRevision) return;
  // 跨 sandbox iframe 预览的 pointerdown 不会冒泡到父文档：预览内按下指针时由其上报，关闭已打开的调整浮层。
  if (event.data.type === 'md2pdf-preview-pointerdown') { closeRangePopovers(); return; }
  if (event.data.type === 'md2pdf-exit-fullscreen') {
    document.dispatchEvent(new CustomEvent('md-preview-exit-fullscreen'));
    return;
  }
  // 受控外链：预览里点可信落款链接时，父窗口只打开固定官方仓库地址。
  // 消息不含任何 URL 参数；仅在确有用户激活（真实点击）时打开，避免无交互弹出。
  if (event.data.type === 'md2pdf-open-repo') {
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    const opened = window.open('https://github.com/jiyeqian/md2pdf', '_blank', 'noopener,noreferrer');
    // 若浏览器拦截弹窗（返回 null），给出可手动打开的提示（仅在此时改一次状态）。
    if (!opened && statusEl) {
      setStatus('若新标签页未打开，请点击：');
      const link = document.createElement('a');
      link.href = 'https://github.com/jiyeqian/md2pdf';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'md2pdf GitHub 仓库';
      statusEl.append(link);
    }
    return;
  }
  if (previewRevision !== revision) return;
  if (event.data.type === 'md2pdf-ready') {
    previewMissingFonts = Array.isArray(event.data.fonts) ? event.data.fonts.filter(font => typeof font === 'string') : [];
    sendPreviewMode();
    window.__MD2PDF_PREVIEW_READY__ = true;
    window.dispatchEvent(new Event('md-preview-ready'));
    finishPreviewTelemetry(true);
    clearTimeout(previewTimer);
    previewWait = null;
    if (!downloading) setStatus(previewResetOptions.length ? `预览已更新 · 已按模板重置不适用选项：${[...new Set(previewResetOptions.map(key => policyDoc?.labels?.option?.[key] || key))].join('、')}` : '预览已更新');
  } else if (event.data.type === 'md2pdf-source' && Number.isSafeInteger(event.data.line) && event.data.line > 0 && event.data.line <= editor.value.split('\n').length) {
    document.dispatchEvent(new CustomEvent('md-preview-source', { detail: { line: event.data.line } }));
  } else if (event.data.type === 'md2pdf-error') {
    window.__MD2PDF_PREVIEW_ERROR__ = true;
    window.dispatchEvent(new Event('md-preview-error'));
    finishPreviewTelemetry(false);
    clearTimeout(previewTimer);
    previewWait = null;
    setStatus(event.data.error || '预览排版失败。', true);
  }
});

// ---------- 启动 ----------
async function loadPolicy() {
  const response = await appFetch('/api/policy');
  if (!response.ok) throw new Error(`选项策略加载失败（${response.status}）`);
  policyDoc = await response.json();
}

async function loadDefaultExample() {
  const startedAt = revision;
  try {
    const response = await appFetch('/api/example');
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
  let draft = readDraft();
  let blank = false;
  if (window.indexedDB) {
    try {
      const { initializeLocalDrafts } = await import('./local-drafts.mjs');
      localDrafts = await initializeLocalDrafts({ capture: captureDraft, apply: applyDraft, legacy: draft,
        mirror: value => writeStore(DRAFT_KEY, JSON.stringify(value)), report: reportDraft });
      draft = localDrafts.restored;
      blank = localDrafts.blank;
    } catch { reportDraft('本地草稿存储不可用，当前仅保留会话草稿。请及时下载 Markdown。', true); }
  } else reportDraft('此浏览器不支持本地草稿保存，请及时下载 Markdown。', true);
  const handoff = readHandoff();
  try { await loadPolicy(); }
  catch (error) { setStatus(error.message, true); }
  if (policyDoc && policyDoc.autoPolicy) applyPolicy(policyDoc.autoPolicy);

  // 优先恢复持久草稿；存储不可用时保持原有会话恢复。
  if (revision === startedAt && draft && typeof draft.md === 'string' && (draft.md.trim() || localDrafts)) {
    editor.value = draft.md;
    renderedTemplateType = typeof draft.previewType === 'string' ? draft.previewType : '';
    applyStoredOptions(draft.opts);
    const restoredType = form.elements.type.value;
    if (restoredType && policyDoc && policyDoc.policy && policyDoc.policy[restoredType]) applyPolicy(policyDoc.policy[restoredType]);
    if (draft.templateId) window.currentTemplateId = draft.templateId;
  }

  // 显式「使用此示例」经由 sessionStorage 交接；已有草稿需确认才替换。
  if (revision === startedAt && handoff && typeof handoff.md === 'string') {
    writeStore(HANDOFF_KEY, null);
    if (handoff.replaceConfirmed || await window.mdConfirmTemplate()) {
      if (localDrafts) {
        await localDrafts.replace({ md: handoff.md, opts: handoff.type ? { type: handoff.type } : {}, templateId: handoff.id || '', previewType: '' });
      } else editor.value = handoff.md;
      window.currentTemplateId = handoff.id || '';
      if (handoff.type) {
        if (policyDoc && policyDoc.policy && policyDoc.policy[handoff.type]) applyPolicy(policyDoc.policy[handoff.type]);
        form.elements.type.value = handoff.type;
      }
      setStatus('已载入示例，正在排版…');
    } else {
      setStatus('已保留当前草稿。');
    }
  } else if (!editor.value.trim() && !blank && !draft) {
    await loadDefaultExample();
  }
  if (currentTemplateEl && window.currentTemplateId) currentTemplateEl.dataset.templateId = window.currentTemplateId;

  initialized = true;
  if (localDrafts) window.mdDrafts = localDrafts;
  window.__MD2PDF_APP_READY__ = true;
  window.dispatchEvent(new Event('md-app-ready'));
  saveDraft();
  editor.placeholder = '在此输入 Markdown…';
  updateCount();
  if (editor.value.trim()) schedulePreview();
  else setStatus('输入 Markdown 即可开始排版。');
}

// ---------- 事件 ----------
editor.addEventListener('input', () => { if (applyingDraft) return; saveDraft(); schedulePreview(); });
// 滑块 ↔ 数值输入双向同步：任一控件变化都写回另一个；空值回到「默认」态（省略选项）。
function syncRangeFromEvent(target) {
  if (!target || !target.getAttribute) return;
  const sliderName = target.getAttribute('data-range-slider');
  if (sliderName) { const number = form.elements[sliderName]; if (number) number.value = target.value; reflectRangeValue(sliderName, target.value); return; }
  const numberName = target.getAttribute('data-range-number');
  if (numberName) { if (target.value === '') showRangeDefault(numberName, currentRange(numberName)); else reflectRangeValue(numberName, target.value); }
}
function sendPreviewMode() {
  preview.contentWindow?.postMessage({ type: 'md2pdf-preview-mode', mode: previewMode, revision: previewRevision }, '*');
}
form.querySelector('[data-preview-mode-toggle]')?.addEventListener('click', () => {
  previewMode = previewMode === 'paged' ? 'flow' : 'paged';
  const trigger = form.querySelector('[data-preview-mode-toggle]');
  trigger.setAttribute('aria-pressed', String(previewMode === 'flow'));
  trigger.title = previewMode === 'flow' ? '切换为分页浏览' : '切换为流式浏览';
  trigger.setAttribute('aria-label', trigger.title);
  trigger.querySelector('[data-preview-mode-icon]').setAttribute('d', previewMode === 'flow'
    ? 'M5 2h14v20H5zM8 6h8M8 10h8M8 14h8M8 18h8'
    : 'M5 2h14v8H5zM5 14h14v8H5zM8 5h8M8 17h8');
  sendPreviewMode();
});
preview.addEventListener('load', sendPreviewMode);
form.querySelector('[data-orientation-toggle]')?.addEventListener('click', () => {
  if (currentPolicy?.controls.landscape?.available === false) return;
  const field = form.elements.landscape;
  const landscape = field.value === '' ? Boolean(renderedEffective.landscape) : field.value === 'true';
  field.value = String(!landscape);
  field.dispatchEvent(new Event('input', { bubbles: true }));
});
form.addEventListener('input', event => { syncRangeFromEvent(event.target); updateOptionTriggers(); saveDraft(); schedulePreview(); });
// 「恢复默认」：清空取值 = 省略覆盖，交给模板默认（含不对称的默认页边距）。
form.addEventListener('click', event => {
  const button = event.target && event.target.closest ? event.target.closest('[data-range-default]') : null;
  if (!button) return;
  const name = button.getAttribute('data-range-default');
  const field = form.elements[name];
  if (!field) return;
  field.value = '';
  showRangeDefault(name, currentRange(name));
  saveDraft();
  schedulePreview();
});
// 调整浮层：互斥打开、点击外部关闭、Esc 关闭并把焦点交还触发器。
// 自动刷新预览只更新触发器文案与滑块取值，不重建浮层，因此在调整过程中不会被关闭或抢焦点。
function closeRangePopovers(except) {
  for (const details of form.querySelectorAll('details.range-pop[open]')) if (details !== except) details.open = false;
}
function positionRangePopover(details) {
  const panel = details.querySelector('.range-popover');
  if (!panel) return;
  const anchor = details.getBoundingClientRect();
  const width = panel.getBoundingClientRect().width;
  const left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12));
  panel.style.left = `${left - anchor.left}px`;
  panel.style.right = 'auto';
}
for (const name of RANGE_CONTROLS) {
  const slider = rangeSlider(name);
  const wrap = controlWrap(name);
  if (!slider || !wrap) continue;
  let dragging = false;
  slider.addEventListener('pointerdown', () => { dragging = true; wrap.classList.add('range-adjusting'); updateRangeTrigger(name); });
  const end = () => { dragging = false; wrap.classList.remove('range-adjusting'); };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  slider.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) wrap.classList.add('range-adjusting');
  });
  slider.addEventListener('blur', end);
  slider.addEventListener('input', () => { if (dragging) wrap.classList.add('range-adjusting'); });
}
for (const details of form.querySelectorAll('details.range-pop')) {
  details.addEventListener('toggle', () => {
    if (details.open) { closeRangePopovers(details); const trigger = details.querySelector('[data-option-trigger]'); if (trigger) renderOptionMenu(trigger.getAttribute('data-option-trigger'), true); positionRangePopover(details); const slider = details.querySelector('[data-range-slider]'); if (slider) updateRangeTrigger(slider.getAttribute('data-range-slider')); }
    else { const wrap = details.closest('[data-control]'); if (wrap) wrap.classList.remove('range-adjusting'); }
  });
}
window.addEventListener('resize', () => {
  const open = form.querySelector('details.range-pop[open]');
  if (open) positionRangePopover(open);
});
document.addEventListener('click', event => {
  const open = form.querySelector('details.range-pop[open]');
  if (!open || open.contains(event.target)) return;
  open.open = false;
});
// 兜底：跨 sandbox iframe 预览未就绪或未上报 pointerdown 时，点击预览会让父文档失焦且 activeElement 落到 iframe。
// 仅在焦点确实进入预览时关闭浮层——正在编辑浮层（焦点在其内部元素）或切换到其它窗口/应用时不会误关。
window.addEventListener('blur', () => {
  if (document.activeElement !== preview) return;
  closeRangePopovers();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const open = form.querySelector('details.range-pop[open]');
  if (!open) return;
  open.open = false;
  const summary = open.querySelector('summary.range-trigger');
  if (summary) summary.focus();
});
form.addEventListener('submit', event => event.preventDefault());
form.elements.type.addEventListener('change', () => {
  const value = form.elements.type.value;
  if (value) trackUsage('template_selected', { template: value, theme: form.elements.theme.value || 'elegant' });
  if (!value && policyDoc && policyDoc.autoPolicy) applyPolicy(policyDoc.autoPolicy);
  else if (value && policyDoc && policyDoc.policy && policyDoc.policy[value]) applyPolicy(policyDoc.policy[value]);
});
topExamplesLink?.addEventListener('click', saveDraft);
// 「从模板创建」由 editor-workspace.js 动态注入到 Markdown 工具条，加载期 querySelector
// 可能取不到：改用事件委托 + pagehide 兜底，确保离开页面前草稿与选项一定落盘。
document.addEventListener('click', event => {
  const target = event.target;
  const link = target && target.closest ? target.closest('#browse-examples, #examples-link-top') : null;
  if (link) saveDraft();
}, true);
window.addEventListener('md2pdf-template-created', async () => {
  const handoff = readHandoff();
  if (!handoff || typeof handoff.md !== 'string') return;
  try {
    if (localDrafts) {
      await localDrafts.replace({ md: handoff.md, opts: handoff.type ? { type: handoff.type } : {}, templateId: handoff.id || '', previewType: '' });
    } else editor.value = handoff.md;
  } catch { setStatus('草稿保存失败，已保留当前文档。', true); return; }
  writeStore(HANDOFF_KEY, null);
  window.currentTemplateId = handoff.id || '';
  trackUsage('template_selected', { template: handoff.type || handoff.id, theme: form.elements.theme.value || 'elegant' });
  if (handoff.type) {
    if (policyDoc?.policy?.[handoff.type]) applyPolicy(policyDoc.policy[handoff.type]);
    form.elements.type.value = handoff.type;
  }
  if (!localDrafts) writeStore(DRAFT_KEY, JSON.stringify({ md: handoff.md, opts: readFormOptions(), templateId: handoff.id, savedAt: Date.now() }));
  saveDraft();
  if (currentTemplateEl && handoff.title) currentTemplateEl.textContent = ` · ${handoff.title}`;
  updateCount();
  schedulePreview();
  setStatus('已从模板创建，正在排版…');
});
window.addEventListener('pagehide', saveDraft);
window.addEventListener('pagehide', () => { localDrafts?.flush().catch(() => {}); });

// 与 Markdown 下载共用命名：把浏览器端算出的基名随请求发送，PDF 与 Markdown 同文档同版本
// 得到完全一致的基名（无版本时共享同一浏览器时间戳）。失败时留空，由服务端自行推导。
async function downloadNameFor(md, ext) {
  try {
    const files = await import('./editor-files.mjs');
    return files.documentDownloadName(md, new Date(), ext, form.elements.type.value);
  } catch { return ''; }
}

download.addEventListener('click', async () => {
  if (!window.__MD2PDF_STATIC_BASE__ && !navigator.onLine) {
    setStatus('PDF 导出需要联网。'); return;
  }
  // 双重检查：按钮在配置无效时已被禁用，这里再挡一次，避免旧事件/程序化触发绕过。
  if (configInvalid) {
    setStatus('配置无效 · 无法生成 PDF，请先修正文档配置。', true);
    if (configErrorsEl) configErrorsEl.hidden = false;
    return;
  }
  if (!form.reportValidity()) return;
  const exportMethod = window.__MD2PDF_STATIC_BASE__ ? 'browser-print' : 'server-pdf';
  trackUsage('export_started', { method: exportMethod });
  downloading = true;
  updateCount();
  setDownloadState(true);
  setStatus('正在生成 PDF，复杂文档可能需要稍等。');
  const exportRevision = revision;
  const exportMd = editor.value;
  const exportOptions = collectedOptions();
  let exportName = '';
  try {
    if (!exportOptions.type) {
      // 自动识别时按探测结果过滤不兼容取值，但不回填 type —— 类型由服务端按 frontmatter 决定。
      const resolved = await (await request('/api/resolve', { md: exportMd, opts: {} })).json();
      for (const key of Object.keys(exportOptions)) {
        const control = resolved.policy.controls[key.startsWith('margin') ? 'margin' : key];
        if (control && (control.available === false || (!key.startsWith('margin') && Array.isArray(control.values) && !control.values.includes(exportOptions[key])))) delete exportOptions[key];
      }
    }
    exportName = await downloadNameFor(exportMd, 'pdf');
    const pdfBody = { md: exportMd, opts: exportOptions };
    if (exportName) pdfBody.filename = exportName;
    if (window.__MD2PDF_STATIC_BASE__) {
      const runtime = await import('./runtime-request.mjs');
      await window.mdExportWithFontConsent(allowFontFallback => runtime.exportPdf({ md:exportMd, opts:exportOptions, filename:exportName, allowFontFallback }));
      setStatus('已打开打印，请另存为 PDF。');
      return;
    }
    const response = await window.mdExportWithFontConsent(allowFontFallback => request('/api/pdf', { ...pdfBody, allowFontFallback }));
    const blob = await response.blob();
    const anchor = document.createElement('a');
    const disposition = response.headers.get('Content-Disposition') || '';
    const marker = "filename*=UTF-8''";
    const at = disposition.indexOf(marker);
    const encoded = at >= 0 ? disposition.slice(at + marker.length) : '';
    const decoded = encoded ? decodeURIComponent(encoded) : '';
    anchor.download = decoded || exportName || 'document.pdf';
    if (window.mdAppShell?.offerFile(new File([blob], anchor.download, { type: 'application/pdf' }))) {
      setStatus(revision === exportRevision ? 'PDF 已生成，请选择下载或分享。' : 'PDF 已生成（期间编辑未包含），请选择下载或分享。');
      return;
    }
    const url = URL.createObjectURL(blob);
    anchor.href = url;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    if (revision !== exportRevision) setStatus('PDF 已生成并开始下载（导出的是开始导出时的版本，期间编辑未包含）。');
    else setStatus('PDF 已生成，下载已开始。');
  } catch (error) {
    if (error.code === 'EXPORT_CANCELLED') { setStatus('已取消 PDF 下载。'); return; }
    // 下载请求同样可能因文档配置错误被拒：提示行号并禁用后续导出，Markdown 下载不受影响。
    trackUsage('export_failed', { method: exportMethod, code: error.status === 504 ? 'timeout' : error.status === 503 ? 'unavailable' : 'failed' });
    if (Array.isArray(error.configErrors) && error.configErrors.length) {
      showConfigErrors(error.configErrors, hasPreview);
      setStatus('配置无效 · 无法生成 PDF，请先修正文档配置。', true);
    } else {
      setStatus(error.message, true);
    }
  } finally {
    downloading = false;
    setDownloadState(false);
    updateCount();
  }
});

// 纯函数出口：供前端测试在 vm 内真实执行后读取选项模型（只读、无副作用）。
window.md2pdfOptions = { headingChoices, headingDraftToken, decodeHeadingToken, headingOptionsFromToken, headingAvailable, resolveRange, rangeOptionValue, RANGE_FALLBACK };

// 配置错误提示出口：供前端测试在 vm 内直接驱动提示条 / 导出禁用逻辑。
window.md2pdfConfigErrors = {
  showConfigErrors, clearConfigErrors, jumpToLine,
  isInvalid: () => configInvalid, hasPreview: () => hasPreview,
  setPreviewState: (value) => { hasPreview = !!value; },
};

boot();

window.addEventListener('online', () => { if (initialized) schedulePreview(); });
