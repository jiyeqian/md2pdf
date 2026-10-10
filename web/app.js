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
const topExamplesLink = document.querySelector('#examples-link-top');

const DRAFT_KEY = 'md2pdf:draft';
const HANDOFF_KEY = 'md2pdf:handoff';
const CONTROL_ORDER = ['type', 'theme', 'toc', 'fontSize', 'margin', 'lineHeight', 'numbering'];

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
const HEADING_SCHEME_LABELS = { arabic: '数字编号 · 1 / 1.1', cjk: '中文编号 · 一、/（一）', chapter: '章节编号 · 第 1 章' };
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
let policyDoc = null;
let currentPolicy = null;
let resolveCache = { key: null, result: null };

// ---------- 浏览器会话存储（草稿与选项） ----------
function readStore(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function writeStore(key, value) { try { value == null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); return true; } catch { return false; } }
function readFormOptions() {
  const opts = {};
  for (const name of CONTROL_ORDER) { const field = form.elements[name]; if (field) opts[name] = field.value; }
  return opts;
}
function saveDraft() {
  if (!editor || !initialized) return;
  const saved = writeStore(DRAFT_KEY, JSON.stringify({ md: editor.value, opts: readFormOptions(), savedAt: Date.now() }));
  let warning = document.getElementById('draft-warning');
  if (!saved && !warning) {
    warning = document.createElement('p');
    warning.id = 'draft-warning';
    warning.className = 'draft-warning';
    warning.setAttribute('role', 'alert');
    document.querySelector('.status-row').after(warning);
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

function updateCount() {
  if (countEl) countEl.textContent = `${editor.value.length.toLocaleString('zh-CN')} 字符`;
  download.disabled = downloading || !editor.value.trim();
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
      fillSelect(field, [['true', '显示'], ['false', '隐藏']], '跟随文档');
    } else if (control.kind === 'number') {
      if (control.min != null) field.min = control.min;
      if (control.max != null) field.max = control.max;
      if (control.step != null) field.step = control.step;
      field.placeholder = '默认';
    }
  }
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
  updateRangeNote(name, control);
  const slider = rangeSlider(name);
  if (slider) { slider.min = range.min; slider.max = range.max; slider.step = range.step; }
  if (field.value === '') showRangeDefault(name, range);
  else reflectRangeValue(name, field.value);
}

const rangeMeta = {};
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
function rangeNote(name) { const group = controlWrap(name); return group ? group.querySelector('[data-range-note="' + name + '"]') : null; }
function currentRange(name) { return rangeMeta[name] || resolveRange(name, null); }
// 紧凑触发器文案：空值 = 跟随文档；显式值带单位（12 pt / 25 mm / 2.1 倍）。
function updateRangeTrigger(name) {
  const summary = rangeSummary(name);
  if (!summary) return;
  const meta = RANGE_META[name] || { unit: '', label: name };
  const field = form.elements[name];
  const raw = field ? field.value : '';
  const text = raw === '' ? '跟随文档' : `${raw} ${meta.unit}`.trim();
  summary.textContent = text;
  summary.setAttribute('aria-label', `${meta.label}：${text}`);
}
// 浮层内的模板默认说明：边距明确四边数值（fixedValue 上下、fixedNote 左右），
// 避免把统一的 20 误当成四边默认；并说明调整会把四边统一为同一数值。
function updateRangeNote(name, control) {
  const note = rangeNote(name);
  if (!note) return;
  const range = currentRange(name);
  if (name === 'margin') {
    const sides = control && control.fixedValue ? String(control.fixedValue) : '';
    const sideNote = control && control.fixedNote ? String(control.fixedNote) : '';
    note.textContent = `模板默认：上下 ${sides || range.defaultValue} mm${sideNote ? ' · ' + sideNote : ''}。调整后四边统一为同一数值。`;
  } else if (name === 'fontSize') {
    note.textContent = `模板默认 ${range.defaultValue} pt；调整仅覆盖正文字号。`;
  } else if (name === 'lineHeight') {
    note.textContent = `模板默认 ${range.defaultValue} 倍；调整仅覆盖正文行距。`;
  } else {
    note.textContent = '';
  }
}
function showRangeDefault(name, range) {
  const slider = rangeSlider(name);
  if (slider) slider.value = String(range.defaultValue);
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
    else if (name === 'toc') options.toc = value === 'true';
    else if (name === 'numbering') Object.assign(options, headingOptionsFromToken(value, controls));
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
    .replaceAll("type:'md2pdf-source'", `type:'md2pdf-source',revision:${rev}`)
    .replaceAll("type:'md2pdf-exit-fullscreen'", `type:'md2pdf-exit-fullscreen',revision:${rev}`)
    .replaceAll("type:'md2pdf-open-repo'", `type:'md2pdf-open-repo',revision:${rev}`)
    .replaceAll("type:'md2pdf-preview-pointerdown'", `type:'md2pdf-preview-pointerdown',revision:${rev}`);
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
    previewRevision = current;
    preview.srcdoc = injectRevision(result.html, current);
    setStatus('正在加载公式、图表与分页…');
    previewTimer = setTimeout(() => { if (current === revision) setStatus('排版等待超时，请修改内容或重试。', true); }, 60000);
  } catch (error) {
    if (error.name !== 'AbortError' && current === revision) setStatus(error.message, true);
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
// 滑块 ↔ 数值输入双向同步：任一控件变化都写回另一个；空值回到「默认」态（省略选项）。
function syncRangeFromEvent(target) {
  if (!target || !target.getAttribute) return;
  const sliderName = target.getAttribute('data-range-slider');
  if (sliderName) { const number = form.elements[sliderName]; if (number) number.value = target.value; reflectRangeValue(sliderName, target.value); return; }
  const numberName = target.getAttribute('data-range-number');
  if (numberName) { if (target.value === '') showRangeDefault(numberName, currentRange(numberName)); else reflectRangeValue(numberName, target.value); }
}
form.addEventListener('input', event => { syncRangeFromEvent(event.target); saveDraft(); schedulePreview(); });
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
for (const details of form.querySelectorAll('details.range-pop')) {
  details.addEventListener('toggle', () => {
    if (details.open) { closeRangePopovers(details); positionRangePopover(details); }
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
window.addEventListener('pagehide', saveDraft);

download.addEventListener('click', async () => {
  if (!form.reportValidity()) return;
  downloading = true;
  updateCount();
  setDownloadState(true);
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
    setDownloadState(false);
    updateCount();
  }
});

// 纯函数出口：供前端测试在 vm 内真实执行后读取选项模型（只读、无副作用）。
window.md2pdfOptions = { headingChoices, headingDraftToken, decodeHeadingToken, headingOptionsFromToken, headingAvailable, resolveRange, rangeOptionValue, RANGE_FALLBACK };

boot();
