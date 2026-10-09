// md2pdf 编辑器 —— DOI 引用插入对话框
//
// 归属：工具条「DOI 引用」按钮的界面层。纯逻辑（规范化 / 扫描 / 插入计划 / 快照
// 守卫）全部来自 ./editor-doi-helpers.mjs，本文件只负责 DOM、网络与事务提交。
//
// 约定：
//   window.mdEditor  { getValue, getSelection, replaceRanges, setSelection, focus }
//   document 事件    md-editor-ready / md-editor-change(detail.value)
//   document 事件    md-doi-open（由工具条按钮派发，打开本对话框）
//
// 关键约束：
//   * 只在用户显式点击「解析并插入」后 fetch，绝不在输入/渲染时联网；
//   * 解析期间可取消（AbortController），迟到的响应绝不插入；
//   * 提交前做快照守卫，文档被改动时不覆盖用户内容，成功结果保留在对话框里；
//   * 引用标记与脚注定义合并为一次 replaceRanges ⇒ 只产生一步撤销。

import {
  normalizeDoi,
  validateManualBibtex,
  planCitation,
  checkSnapshot,
  scanFootnotes,
  pendingDoiOnly
} from './editor-doi-helpers.mjs';

var API_URL = '/api/doi';
var SOURCE_LABEL = { crossref: 'Crossref', datacite: 'DataCite' };
var ERROR_TEXT = {
  400: 'DOI 格式无法识别，请检查是否形如 10.xxxx/xxxx（也支持 doi.org 链接）。',
  404: '没有找到该 DOI 对应的文献，请核对后重试。',
  422: '该 DOI 的元数据不足以生成 BibTeX 条目，可改用「仅插入 DOI」或手动填写 BibTeX。',
  502: '文献服务返回异常，暂时无法解析，请稍后重试。',
  504: '文献服务响应超时，请稍后重试。'
};

var editor = null;      // window.mdEditor
var dialog = null;      // <dialog>
var els = null;         // 对话框内部元素
var statusEl = null;    // 持久状态行（不被应用状态覆盖）
var controller = null;  // 当前请求的 AbortController
var token = 0;          // 请求代号：只有最新一次请求可以写入界面
var opener = null;      // 打开对话框时的触发元素，用于焦点还原
var pendingTimer = 0;
var state = { snapshot: '', at: 0, doi: '', result: null, stale: false, statusAt: 0 };

// ------------------------------------------------------------------ 小工具

function getEditor() {
  if (editor && typeof editor.getValue === 'function') return editor;
  var candidate = typeof window !== 'undefined' ? window.mdEditor : null;
  editor = candidate && typeof candidate.getValue === 'function' ? candidate : null;
  return editor;
}

function el(tag, attrs, text) {
  var node = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function (key) {
    if (key === 'class') node.className = attrs[key];
    else if (key === 'text') node.textContent = attrs[key];
    else node.setAttribute(key, attrs[key]);
  });
  if (text != null) node.textContent = text;
  return node;
}

function setMessage(tone, text) {
  if (!els || !els.message) return;
  els.message.textContent = text || '';
  if (tone) els.message.setAttribute('data-tone', tone);
  else els.message.removeAttribute('data-tone');
  els.message.hidden = !text;
}

// 持久状态：与 .status-row 里的 #status 并列，不会被应用的 setStatus 覆盖。
function setStatus(tone, text) {
  if (!statusEl) return;
  statusEl.textContent = text || '';
  if (tone) {
    statusEl.setAttribute('data-tone', tone);
    state.statusAt = Date.now();
  } else {
    statusEl.removeAttribute('data-tone');
  }
}

function setBusy(busy) {
  if (!els) return;
  els.resolve.disabled = busy;
  els.resolve.textContent = busy ? '解析中…' : '解析并插入';
  els.doiInput.disabled = busy;
  els.manual.disabled = busy;
  els.onlyDoi.disabled = busy;
  els.manualInsert.disabled = busy;
  els.retry.disabled = busy;
  els.retry.hidden = true;
  els.recapture.hidden = true;
  if (busy) {
    els.loading.hidden = false;
    els.spinner.hidden = false;
    els.loadingText.hidden = false;
  } else {
    els.loading.hidden = true;
    els.spinner.hidden = true;
    els.loadingText.hidden = true;
  }
}

// ------------------------------------------------------------------ 对话框

function buildDialog() {
  if (dialog) return dialog;
  dialog = el('dialog', { class: 'md-doi-dialog', 'aria-labelledby': 'md-doi-title' });

  var form = el('form', { class: 'md-doi-form', novalidate: 'novalidate' });

  var head = el('div', { class: 'md-doi-dialog-head' });
  head.appendChild(el('h2', { id: 'md-doi-title', text: '按 DOI 插入参考文献' }));
  var close = el('button', { type: 'button', class: 'md-doi-dialog-close', 'aria-label': '关闭 DOI 引用对话框' }, '×');
  close.addEventListener('click', function () { closeDialog(); });
  head.appendChild(close);

  var body = el('div', { class: 'md-doi-dialog-body' });

  var field = el('label', { class: 'md-doi-field', for: 'md-doi-input' });
  field.appendChild(el('span', { text: 'DOI 或 DOI 链接' }));
  var input = el('input', {
    type: 'text',
    id: 'md-doi-input',
    name: 'doi',
    placeholder: '10.1038/nature14539 或 https://doi.org/10.1038/nature14539',
    autocomplete: 'off',
    spellcheck: 'false'
  });
  field.appendChild(input);
  body.appendChild(field);

  var hint = el('p', { class: 'md-doi-hint' }, '点击「解析并插入」后才会联网查询；引用插入到当前光标处，BibTeX 定义追加到文末，两者为同一次撤销。');
  body.appendChild(hint);

  var loading = el('p', { class: 'md-doi-message md-doi-loading', 'data-tone': 'busy', hidden: 'hidden' });
  var spinner = el('span', { class: 'md-doi-spinner', 'aria-hidden': 'true' });
  spinner.hidden = true;
  loading.appendChild(spinner);
  var loadingText = el('span', null, '正在向文献服务查询…');
  loadingText.hidden = true;
  loading.appendChild(loadingText);
  loading.hidden = true;
  body.appendChild(loading);

  var message = el('p', { class: 'md-doi-message', role: 'status', 'aria-live': 'polite' });
  message.hidden = true;
  body.appendChild(message);

  var manualBox = el('details', { class: 'md-doi-manual' });
  var manualSummary = el('summary', null, '解析失败？手动填写 BibTeX');
  manualBox.appendChild(manualSummary);
  var manualInner = el('div', { class: 'md-doi-manual-inner' });
  var manualField = el('label', { class: 'md-doi-field', for: 'md-doi-manual-input' });
  manualField.appendChild(el('span', { text: 'BibTeX 条目（@type{key, field = {value}, …}）' }));
  var manual = el('textarea', {
    id: 'md-doi-manual-input',
    spellcheck: 'false',
    placeholder: '@article{key,\n  title = {…},\n  author = {…},\n  year = {2024}\n}'
  });
  manualField.appendChild(manual);
  manualInner.appendChild(manualField);
  var manualError = el('p', { class: 'md-doi-message md-doi-message--manual', 'data-tone': 'error', role: 'alert' });
  manualError.hidden = true;
  manualInner.appendChild(manualError);
  manualBox.appendChild(manualInner);
  body.appendChild(manualBox);

  form.appendChild(head);
  form.appendChild(body);

  var actions = el('div', { class: 'md-doi-dialog-actions' });
  var resolve = el('button', { type: 'submit', class: 'md-doi-button md-doi-button--primary' }, '解析并插入');
  var onlyDoi = el('button', { type: 'button', class: 'md-doi-button', title: '不联网，只插入 doi:10.xxxx/… 形式的脚注定义' }, '仅插入 DOI');
  var retry = el('button', { type: 'button', class: 'md-doi-button' }, '重试解析');
  retry.hidden = true;
  var manualInsert = el('button', { type: 'button', class: 'md-doi-button' }, '插入手动 BibTeX');
  var recapture = el('button', { type: 'button', class: 'md-doi-button' }, '重新定位并插入');
  recapture.hidden = true;
  actions.appendChild(resolve);
  actions.appendChild(onlyDoi);
  actions.appendChild(retry);
  manualInner.appendChild(manualInsert);
  actions.appendChild(recapture);
  actions.appendChild(el('span', { class: 'md-doi-spacer' }));
  var cancel = el('button', { type: 'button', class: 'md-doi-button' }, '取消');
  cancel.addEventListener('click', function () { closeDialog(); });
  actions.appendChild(cancel);
  form.appendChild(actions);

  dialog.appendChild(form);

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submitResolve();
  });
  manual.addEventListener('input', function () {
    manualError.hidden = true;
    manualError.textContent = '';
  });
  onlyDoi.addEventListener('click', function () { insertWith(null, true); });
  retry.addEventListener('click', function () { submitResolve(); });
  manualInsert.addEventListener('click', function () { submitManual(); });
  recapture.addEventListener('click', function () { recaptureAndInsert(); });
  // Esc / 点击遮罩：由原生 <dialog> 处理 cancel，这里只负责取消在途请求。
  dialog.addEventListener('cancel', function () { abortRequest(); });
  dialog.addEventListener('close', function () { abortRequest(); });

  els = {
    form: form, input: input, message: message, spinner: spinner, loadingText: loadingText,
    loading: loading, manual: manual, manualError: manualError, manualBox: manualBox,
    resolve: resolve, onlyDoi: onlyDoi, retry: retry, manualInsert: manualInsert,
    recapture: recapture, cancel: cancel
  };
  els.doiInput = input;
  return dialog;
}

function mountDialog() {
  if (dialog && dialog.isConnected) return dialog;
  buildDialog();
  if (!dialog.isConnected && document.body) document.body.appendChild(dialog);
  ensureStatus();
  return dialog;
}

function ensureStatus() {
  if (statusEl && statusEl.isConnected) return statusEl;
  var row = document.querySelector('.status-row');
  if (!row) return null;
  statusEl = el('p', { class: 'md-doi-status', role: 'status', 'aria-live': 'polite' });
  row.appendChild(statusEl);
  return statusEl;
}

function captureSnapshot() {
  var api = getEditor();
  if (!api) return { snapshot: '', at: 0 };
  var sel = typeof api.getSelection === 'function' ? api.getSelection() : null;
  return {
    snapshot: api.getValue(),
    at: sel && Number.isFinite(sel.to) ? sel.to : api.getValue().length
  };
}

function open() {
  var node = mountDialog();
  if (!node) return;
  var api = getEditor();
  if (!api) {
    setMessage('error', '编辑器尚未就绪，请稍后再试。');
    if (typeof node.showModal === 'function') node.showModal();
    return;
  }
  opener = document.activeElement;
  var snap = captureSnapshot();
  state.snapshot = snap.snapshot;
  state.at = snap.at;
  state.doi = els.input.value;
  state.result = null;
  els.manual.value = '';
  state.stale = false;
  els.manualError.hidden = true;
  els.manualError.textContent = '';
  els.retry.hidden = true;
  els.recapture.hidden = true;
  setMessage('', '');
  setBusy(false);
  ensureStatus();
  if (typeof node.showModal === 'function') node.showModal();
  else node.setAttribute('open', '');
  els.input.focus();
  els.input.select();
}

function closeDialog() {
  abortRequest();
  if (dialog && dialog.open && typeof dialog.close === 'function') dialog.close();
  else if (dialog) dialog.removeAttribute('open');
  if (opener && typeof opener.focus === 'function') opener.focus();
  opener = null;
}

function abortRequest() {
  if (controller) {
    try { controller.abort(); } catch (e) { /* 忽略 */ }
    controller = null;
  }
  token += 1; // 让所有在途响应失效，迟到结果不再写界面
}

// ------------------------------------------------------------------ 解析请求

function errorTextFor(status, payload) {
  var body = payload && typeof payload.error === 'string' ? payload.error.trim() : '';
  var base = ERROR_TEXT[status] || '解析失败，请稍后重试。';
  return body && body.length <= 200 ? base + '（' + body + '）' : base;
}

function submitResolve() {
  var api = getEditor();
  if (!api) { setMessage('error', '编辑器尚未就绪，请稍后再试。'); return; }
  var raw = els.input.value;
  var doi = normalizeDoi(raw);
  if (!doi) {
    setMessage('error', '无法识别该 DOI，请检查输入（支持 10.xxxx/xxxx、doi: 前缀与 doi.org 链接）。');
    els.input.focus();
    return;
  }
  if (controller) return; // 已在解析中

  var mine = ++token;
  controller = new AbortController();
  var signal = controller.signal;
  state.doi = doi;
  els.manualError.hidden = true;
  setBusy(true);
  setMessage('busy', '');

  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ doi: doi }),
    signal: signal,
    credentials: 'same-origin'
  }).then(function (response) {
    return response.json().catch(function () { return null; }).then(function (payload) {
      return { status: response.status, ok: response.ok, payload: payload };
    });
  }).then(function (result) {
    if (mine !== token) return;              // 已取消 / 已被新请求取代
    controller = null;
    setBusy(false);
    if (!result.ok) {
      state.result = null;
      els.retry.hidden = false;
      setMessage('error', errorTextFor(result.status, result.payload));
      return;
    }
    var data = result.payload;
    if (!data || typeof data.bibtex !== 'string' || !data.bibtex.trim()) {
      state.result = null;
      els.retry.hidden = false;
      setMessage('error', '文献服务没有返回可用的 BibTeX，可改用「仅插入 DOI」或手动填写。');
      return;
    }
    state.result = { doi: data.doi || doi, bibtex: data.bibtex, warnings: data.warnings || [], source: data.source || '' };
    els.manual.value = data.bibtex;
    var where = SOURCE_LABEL[data.source] ? '（来源：' + SOURCE_LABEL[data.source] + '）' : '';
    commitResult('解析成功' + where);
  }).catch(function (error) {
    if (mine !== token) return;
    controller = null;
    setBusy(false);
    if (error && error.name === 'AbortError') return;   // 用户已取消，静默收尾
    state.result = null;
    els.retry.hidden = false;
    setMessage('error', '无法连接文献服务（' + ((error && error.message) || '网络错误') + '），可重试或手动填写 BibTeX。');
  });
}

// ------------------------------------------------------------------ 插入

function warningsText(warnings) {
  if (!warnings || !warnings.length) return '';
  return warnings.join('；');
}

// 把「引用 + 定义」作为一次事务提交；guard 失败时保留结果并提示。
function commitResult(prefix) {
  var api = getEditor();
  var current = api.getValue();
  var guard = checkSnapshot(state.snapshot, current);
  var warnings = state.result ? warningsText(state.result.warnings) : '';
  if (!guard.ok) {
    state.stale = true;
    els.recapture.hidden = false;
    els.retry.hidden = false;
    setMessage('warn', guard.message + (warnings ? ' 提示：' + warnings : ''));
    return;
  }
  var plan = planCitation({
    markdown: current,
    at: state.at,
    doi: state.doi,
    bibtex: state.result ? state.result.bibtex : null
  });
  if (!plan.ok) {
    setMessage('error', plan.message);
    els.retry.hidden = false;
    return;
  }
  applyPlan(api, plan);
  statusEl.removeAttribute('data-pending');
  var text = (prefix ? prefix + '。' : '') + plan.message;
  if (plan.warning) text += ' ' + plan.warning;
  if (warnings) text += ' 提示：' + warnings;
  setStatus(plan.warning || warnings ? 'warn' : 'ok', text);
  if (plan.warning) statusEl.setAttribute('data-pending', 'true');
  setMessage(plan.warning || warnings ? 'warn' : 'ok', text);
  closeDialog();
  warnPending(true);
}

// bibtex 为 null 时走「仅插入 DOI」。
function insertWith(bibtex, onlyDoi) {
  var api = getEditor();
  if (!api) { setMessage('error', '编辑器尚未就绪，请稍后再试。'); return; }
  if (onlyDoi) {
    var doi = normalizeDoi(els.input.value);
    if (!doi) {
      setMessage('error', '无法识别该 DOI，请先填写正确的 DOI 或 DOI 链接。');
      return;
    }
    state.doi = doi;
    state.result = null;
  }
  commitResult(onlyDoi ? '已跳过联网解析' : '');
}

function applyPlan(api, plan) {
  // 一次 dispatch ⇒ 引用与定义同属一步撤销。
  api.replaceRanges(plan.changes);
  if (plan.caret && typeof api.setSelection === 'function') {
    try { api.setSelection(plan.caret.from, plan.caret.to); } catch (e) { /* 忽略 */ }
  }
  if (typeof api.focus === 'function') {
    try { api.focus(); } catch (e) { /* 忽略 */ }
  }
}

function submitManual() {
  var api = getEditor();
  if (!api) { setMessage('error', '编辑器尚未就绪，请稍后再试。'); return; }
  var doi = normalizeDoi(els.input.value);
  if (!doi) {
    setMessage('error', '无法识别该 DOI，请先填写正确的 DOI 或 DOI 链接。');
    els.input.focus();
    return;
  }
  var check = validateManualBibtex(els.manual.value, doi);
  if (!check.ok) {
    els.manualError.hidden = false;
    els.manualError.textContent = check.error;
    els.manual.focus();
    return;
  }
  els.manualError.hidden = true;
  els.manualError.textContent = '';
  state.doi = doi;
  state.result = {
    doi: doi,
    bibtex: els.manual.value.trim(),
    warnings: check.warning ? [check.warning] : [],
    source: 'manual'
  };
  commitResult('已使用手动 BibTeX');
}

// 快照过期后用户确认：重新捕获文档与光标，再用保留的结果插入。
function recaptureAndInsert() {
  var api = getEditor();
  if (!api) return;
  var snap = captureSnapshot();
  state.snapshot = snap.snapshot;
  state.at = snap.at;
  state.stale = false;
  els.recapture.hidden = true;
  commitResult('已按当前位置重新插入');
}

// ------------------------------------------------- 未著录（仅 DOI）提示

// 纯本地扫描，不发任何网络请求；结果写入持久状态行，不会被应用状态冲掉。
function warnPending(now) {
  if (pendingTimer) clearTimeout(pendingTimer);
  var run = function () {
    pendingTimer = 0;
    var api = getEditor();
    if (!api) return;
    if (!ensureStatus()) return;
    var pending = pendingDoiOnly(scanFootnotes(api.getValue()));
    if (!pending.length) {
      if (statusEl.getAttribute('data-pending') === 'true') {
        setStatus('', ''); statusEl.removeAttribute('data-pending');
      }
      return;
    }
    statusEl.setAttribute('data-pending', 'true');
    // 刚刚插入产生的提示更具体，2 秒内不覆盖
    if (Date.now() - state.statusAt < 2000) return;
    setStatus('warn', '有 ' + pending.length + ' 处引用只写入了 DOI、尚未著录为 BibTeX（' +
      pending.slice(0, 3).map(function (def) { return '[^' + def.id + ']'; }).join('、') +
      (pending.length > 3 ? ' 等' : '') + '），预览与导出的参考文献里只会显示 DOI。');
  };
  if (now) run();
  else pendingTimer = setTimeout(run, 400);
}

// ------------------------------------------------------------------ 启动

function onEditorReady() {
  mountDialog();
  ensureStatus();
  warnPending(true);
}

if (typeof document !== 'undefined') {
  document.addEventListener('md-doi-open', open);
  document.addEventListener('md-editor-ready', onEditorReady);
  document.addEventListener('md-editor-change', function () { warnPending(false); });
  if (getEditor()) onEditorReady();
}

if (typeof window !== 'undefined') {
  window.mdDoiCitation = { open: open, close: closeDialog };
}

