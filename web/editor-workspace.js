'use strict';

// md2pdf 工作台：编辑布局与预览位置关联
//
// 归属：本模块只负责「工作台外壳」——格式工具条、可拖拽分隔条、全屏（Markdown /
// 预览）模式，以及编辑器与预览之间的按章节位置桥接。编辑器内核（window.mdEditor）与专业
// 助手（window.mdEditorTools）由其它模块提供，本模块通过约定 API 调用，不修改它们。
//
// 约定：
//   window.mdEditor        {getValue,setValue,focus,getSelection,replaceSelection,
//                           replaceRange,setSelection,goToLine,getCursorLine,runCommand}
//   window.mdEditorTools   {insert(name)}
//   document 事件          md-editor-ready / md-editor-change / md-editor-cursor(detail.line)
//                          md-document-type(detail.type)
//                          md-preview-source(detail.line)  —— 由根应用校验 event.source 后派发
//   预览定位消息           parent -> iframe {type:'md2pdf-locate', line}
//                          iframe -> parent {type:'md2pdf-source', line}（由根应用转成上面的自定义事件）

(function () {
  if (window.__mdpdfWorkspace) return;
  window.__mdpdfWorkspace = true;

  var RATIO_KEY = 'md2pdf:editor-ratio';   // 与草稿键 md2pdf:draft 分离
  var FOCUS_CLASS = 'editor-focus';         // Markdown 全屏（原「专注写作」）
  var PREVIEW_FOCUS_CLASS = 'preview-focus'; // 预览全屏
  var MIN_EDITOR = 300;                    // 与 app.css 的 minmax(300px, …) 对齐
  var MIN_PREVIEW = 380;                   // 与 app.css 的 minmax(380px, …) 对齐
  var DIVIDER = 10;                        // 与 CSS 变量 --md-wt-divider 对齐
  var CURSOR_DEBOUNCE = 200;

  var workspace = document.querySelector('.workspace');
  var editorPanel = workspace && workspace.querySelector('.editor-panel');
  var previewPanel = workspace && workspace.querySelector('.preview-panel');
  if (!workspace || !editorPanel || !previewPanel) return;
  workspace.classList.add('md-editor-workspace');

  var previewFrame = document.querySelector('#preview');
  var toolbar, divider, editorFullscreenBtn, previewFullscreenBtn, syncInput, snippetSelect, insertSnippetBtn, details;
  var commandButtons = [];
  var ready = false;
  var dragging = false;
  var ratio = null;            // 编辑区占容器宽度的比例，null 表示用 CSS 默认
  var cursorTimer = null;
  var suppressUntil = 0;       // 预览→编辑器跳转期间，抑制光标回传，避免回环
  var currentType = 'general';

  // ---------------------------------------------------------------- 工具
  function make(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) for (var key in attrs) {
      if (key === 'class') node.className = attrs[key];
      else if (key === 'text') node.textContent = attrs[key];
      else node.setAttribute(key, attrs[key]);
    }
    if (text != null) node.textContent = text;
    return node;
  }
  function readStore(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  function writeStore(key, value) { try { value == null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); } catch (e) { /* 隐私模式等：忽略 */ } }
  function hasEditor() { return !!(window.mdEditor && typeof window.mdEditor.runCommand === 'function'); }
  function hasTools() { return !!(window.mdEditorTools && typeof window.mdEditorTools.insert === 'function'); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function isNarrow() { return window.matchMedia && window.matchMedia('(max-width: 900px)').matches; }

  function focusEditor() { if (hasEditor()) { try { window.mdEditor.focus(); } catch (e) { /* 忽略 */ } } }

  function runInsert(name) {
    if (!hasTools()) return;
    try { window.mdEditorTools.insert(name); } catch (e) { /* 片段失败不应中断界面 */ }
    focusEditor();
  }
  function runCommand(name) {
    if (!hasEditor()) return;
    try { window.mdEditor.runCommand(name); } catch (e) { /* 忽略 */ }
    if (name !== 'find' && name !== 'replace') focusEditor();
  }

  function setEnabled(on) {
    for (var i = 0; i < commandButtons.length; i++) commandButtons[i].disabled = !on;
    if (syncInput) syncInput.disabled = !on;
  }

  // ---------------------------------------------------------------- 工具条
  // 名称与顺序：常用格式 → 撤销/重做/查找/折叠 → 专注写作。
  var FORMAT_BUTTONS = [
    { name: 'heading', label: '标题', hint: '插入标题片段（## 小节）' },
    { name: 'bold', label: '粗体', hint: '粗体（Ctrl/⌘+B）' },
    { name: 'italic', label: '斜体', hint: '斜体（Ctrl/⌘+I）' },
    { name: 'link', label: '链接', hint: '链接（Ctrl/⌘+K）' },
    { name: 'code', label: '行内代码', hint: '行内代码（反引号包裹）' },
    { name: 'codeblock', label: '代码块', hint: '插入带语言标识的代码块' },
    { name: 'quote', label: '引用', hint: '引用块 > …' },
    { name: 'table', label: '表格', hint: '插入 Markdown 表格' },
    { name: 'footnote', label: '脚注', hint: '脚注定义 [^id]' },
    { name: 'bibliography', label: '参考文献', hint: '插入 BibTeX 条目（自动著录）' },
    { name: 'formula', label: '公式', hint: '行内或独立公式' },
    { name: 'figure', label: '图表', hint: '图片 / 图表（自动编号 图 N）' }
  ];
  var HISTORY_BUTTONS = [
    { command: 'undo', label: '撤销', hint: '撤销（Ctrl/⌘+Z）' },
    { command: 'redo', label: '重做', hint: '重做（Ctrl/⌘+Shift+Z）' },
    { command: 'find', label: '查找', hint: '查找 / 替换（Ctrl/⌘+F）' },
    { command: 'replace', label: '替换', hint: '查找并替换正文' },
    { command: 'fold', label: '折叠', hint: '折叠当前标题' },
    { command: 'unfold', label: '展开', hint: '展开当前标题' }
  ];
  var SNIPPETS = [
    { name: 'gb-scope', label: '标准范围（gb-scope）' },
    { name: 'gb-terms', label: '标准术语（gb-terms）' },
    { name: 'gb-appendix', label: '标准附录（gb-appendix）' },
    { name: 'skill', label: '技能文档（skill）' }
  ];

  function buildToolbar() {
    toolbar = make('div', { class: 'md-wt-toolbar', role: 'toolbar', 'aria-label': 'Markdown 格式与操作工具条', 'aria-orientation': 'horizontal' });

    var formatGroup = make('div', { class: 'md-wt-group', role: 'group', 'aria-label': '插入格式' });
    FORMAT_BUTTONS.forEach(function (item) {
      var button = make('button', { type: 'button', class: 'md-wt-button', title: item.hint, 'aria-label': item.label }, item.label);
      button.addEventListener('click', function () { runInsert(item.name); });
      commandButtons.push(button);
      formatGroup.appendChild(button);
    });

    var historyGroup = make('div', { class: 'md-wt-group', role: 'group', 'aria-label': '编辑历史与查找' });
    HISTORY_BUTTONS.forEach(function (item) {
      var button = make('button', { type: 'button', class: 'md-wt-button', title: item.hint, 'aria-label': item.label }, item.label);
      button.addEventListener('click', function () { runCommand(item.command); });
      commandButtons.push(button);
      historyGroup.appendChild(button);
    });

    var spacer = make('span', { class: 'md-wt-spacer', 'aria-hidden': 'true' });

    syncInput = make('input', { type: 'checkbox', id: 'md-wt-sync', class: 'md-wt-sync-input' });
    syncInput.checked = true; // 默认开启（按章节近似定位）；回环由 suppressUntil 抑制
    syncInput.addEventListener('change', function () {
      if (syncInput.checked) locateCurrentCursor();
    });
    var syncLabel = make('label', { class: 'md-wt-sync', for: 'md-wt-sync', title: '按标题所在章节近似定位光标位置，不逐行或逐像素同步' });
    syncLabel.appendChild(syncInput);
    syncLabel.appendChild(make('span', null, '同步定位（按章节）'));

    toolbar.appendChild(formatGroup);
    toolbar.appendChild(historyGroup);
    toolbar.appendChild(spacer);
    toolbar.appendChild(syncLabel);

    var heading = editorPanel.querySelector('.panel-heading');
    if (heading && heading.nextSibling) editorPanel.insertBefore(toolbar, heading.nextSibling);
    else if (heading) heading.after(toolbar);
    else editorPanel.insertBefore(toolbar, editorPanel.firstChild);

    wireRovingTabindex(formatGroup);
    wireRovingTabindex(historyGroup);

    buildSnippetDetails();
  }

  function buildSnippetDetails() {
    details = make('details', { class: 'md-wt-details' });
    details.appendChild(make('summary', null, '更多插入（专业片段）'));

    var body = make('div', { class: 'md-wt-snippets' });
    snippetSelect = make('select', { id: 'md-wt-snippet', 'aria-label': '专业片段' });
    snippetSelect.appendChild(make('option', { value: '' }, '选择片段类型…'));
    SNIPPETS.forEach(function (item) { snippetSelect.appendChild(make('option', { value: item.name }, item.label)); });
    insertSnippetBtn = make('button', { type: 'button', class: 'md-wt-button', title: '插入所选专业片段' }, '插入片段');
    insertSnippetBtn.addEventListener('click', function () {
      if (snippetSelect.value) runInsert(snippetSelect.value);
    });
    commandButtons.push(insertSnippetBtn);

    var hint = make('p', { class: 'md-wt-hint' }, '插入的是 Markdown 源码片段，不是版式控件；编号、目录与页式仍由文档类型和排版选项决定。');
    body.appendChild(snippetSelect);
    body.appendChild(insertSnippetBtn);
    body.appendChild(hint);
    details.appendChild(body);
    toolbar.after(details);
  }

  // 键盘工具条：左右方向键在按钮间移动，Home/End 到首尾。
  function wireRovingTabindex(group) {
    var buttons = function () { return Array.prototype.filter.call(group.querySelectorAll('button'), function (b) { return !b.disabled; }); };
    Array.prototype.forEach.call(group.querySelectorAll('button'), function (b, i) { b.tabIndex = i === 0 ? 0 : -1; });
    group.addEventListener('keydown', function (event) {
      var key = event.key;
      if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return;
      var list = buttons();
      if (!list.length) return;
      var current = list.indexOf(document.activeElement);
      if (current < 0) current = 0;
      var next = key === 'ArrowRight' ? current + 1 : key === 'ArrowLeft' ? current - 1 : key === 'Home' ? 0 : list.length - 1;
      next = clamp(next, 0, list.length - 1);
      event.preventDefault();
      list.forEach(function (b, i) { b.tabIndex = i === next ? 0 : -1; });
      list[next].focus();
    });
  }

  // ---------------------------------------------------------------- 分隔条
  function buildDivider() {
    divider = make('div', {
      class: 'md-wt-divider', role: 'separator', tabindex: '0',
      'aria-orientation': 'vertical', 'aria-label': '调整编辑区与预览区宽度',
      'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '50',
      'aria-valuetext': '编辑区 50%',
    });
    workspace.insertBefore(divider, previewPanel);

    divider.addEventListener('pointerdown', function (event) {
      if (fullscreenMode()) return;
      dragging = true;
      try { divider.setPointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
      divider.classList.add('md-wt-dragging');
      event.preventDefault();
    });
    divider.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      var rect = workspace.getBoundingClientRect();
      var width = clamp(event.clientX - rect.left, MIN_EDITOR, rect.width - MIN_PREVIEW - DIVIDER);
      applyWidth(width, rect.width, true);
    });
    function stopDrag(event) {
      if (!dragging) return;
      dragging = false;
      try { divider.releasePointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
      divider.classList.remove('md-wt-dragging');
    }
    divider.addEventListener('pointerup', stopDrag);
    divider.addEventListener('pointercancel', stopDrag);
    divider.addEventListener('keydown', function (event) {
      var rect = workspace.getBoundingClientRect();
      var current = currentWidth(rect);
      var step = 24;
      if (event.key === 'ArrowLeft') { applyWidth(current - step, rect.width, true); event.preventDefault(); }
      else if (event.key === 'ArrowRight') { applyWidth(current + step, rect.width, true); event.preventDefault(); }
      else if (event.key === 'Home') { applyWidth(MIN_EDITOR, rect.width, true); event.preventDefault(); }
      else if (event.key === 'End') { applyWidth(rect.width - MIN_PREVIEW - DIVIDER, rect.width, true); event.preventDefault(); }
    });
  }

  function currentWidth(rect) {
    var editorRect = editorPanel.getBoundingClientRect();
    return editorRect.width || (MIN_EDITOR + MIN_PREVIEW) / 2;
  }

  function applyWidth(width, containerWidth, persist) {
    var bounded = clamp(Math.round(width), MIN_EDITOR, Math.max(MIN_EDITOR, containerWidth - MIN_PREVIEW - DIVIDER));
    workspace.style.setProperty('--md-wt-editor-width', bounded + 'px');
    ratio = containerWidth > 0 ? bounded / containerWidth : null;
    var percent = containerWidth > 0 ? Math.round((bounded / containerWidth) * 100) : 0;
    divider.setAttribute('aria-valuenow', String(percent));
    divider.setAttribute('aria-valuetext', '编辑区 ' + percent + '%');
    if (persist && ratio != null) writeStore(RATIO_KEY, ratio.toFixed(4));
  }

  function restoreRatio() {
    var stored = parseFloat(readStore(RATIO_KEY));
    if (!Number.isFinite(stored) || stored <= 0.1 || stored >= 0.9) return;
    var rect = workspace.getBoundingClientRect();
    if (rect.width <= 0) { ratio = stored; return; }
    applyWidth(stored * rect.width, rect.width, false);
  }

  // ---------------------------------------------------------------- 全屏（Markdown / 预览）
  // 两种全屏共用同一固定 viewport 面板模式：只切换工作区状态类，互斥，
  // 且不触碰 iframe 的 srcdoc 或编辑器实例，因此进出全屏都不重载、不丢状态。
  function nextFullscreenMode(current, requested) {
    return current === requested ? null : requested;
  }

  function fullscreenMode() {
    if (workspace.classList.contains(FOCUS_CLASS)) return 'editor';
    if (workspace.classList.contains(PREVIEW_FOCUS_CLASS)) return 'preview';
    return null;
  }

  function applyFullscreen(mode) {
    var editorOn = mode === 'editor';
    var previewOn = mode === 'preview';
    workspace.classList.toggle(FOCUS_CLASS, editorOn);
    workspace.classList.toggle(PREVIEW_FOCUS_CLASS, previewOn);
    if (editorFullscreenBtn) {
      editorFullscreenBtn.setAttribute('aria-pressed', String(editorOn));
      editorFullscreenBtn.setAttribute('aria-label', editorOn ? '退出 Markdown 全屏' : 'Markdown 全屏写作');
      editorFullscreenBtn.title = editorOn ? '退出全屏（Esc）' : '全屏写作（Esc 退出）';
    }
    if (previewFullscreenBtn) {
      previewFullscreenBtn.setAttribute('aria-pressed', String(previewOn));
      previewFullscreenBtn.setAttribute('aria-label', previewOn ? '退出预览全屏' : '预览全屏');
      previewFullscreenBtn.title = previewOn ? '退出全屏（Esc）' : '全屏预览（Esc 退出）';
    }
    if (editorOn) focusEditor();
  }

  function toggleFullscreen(mode) {
    applyFullscreen(nextFullscreenMode(fullscreenMode(), mode));
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function fullscreenIcon() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'btn-icon');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M7.5 3.5H4.5v3M12.5 3.5h3v3M7.5 16.5H4.5v-3M12.5 16.5h3v-3');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.4');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  function makeFullscreenButton(label, title) {
    var button = make('button', { type: 'button', class: 'icon-button', 'aria-pressed': 'false', 'aria-label': label, title: title });
    button.appendChild(fullscreenIcon());
    return button;
  }

  // 在两侧 panel-heading 的动作区注入全屏按钮；Markdown 侧位于最右，
  // 预览侧置于下载按钮之前（下载仍是该栏最右的主操作）。
  function buildFullscreenButtons() {
    var editorHeading = editorPanel.querySelector('.panel-heading');
    var previewHeading = previewPanel.querySelector('.panel-heading');
    var editorActions = editorHeading && editorHeading.querySelector('.panel-actions');
    var previewActions = previewHeading && previewHeading.querySelector('.panel-actions');

    editorFullscreenBtn = makeFullscreenButton('Markdown 全屏写作', '全屏写作（Esc 退出）');
    editorFullscreenBtn.addEventListener('click', function () { toggleFullscreen('editor'); });
    if (editorActions) editorActions.appendChild(editorFullscreenBtn);

    previewFullscreenBtn = makeFullscreenButton('预览全屏', '全屏预览（Esc 退出）');
    previewFullscreenBtn.addEventListener('click', function () { toggleFullscreen('preview'); });
    if (previewActions) {
      var downloadBtn = previewActions.querySelector('#download');
      if (downloadBtn) previewActions.insertBefore(previewFullscreenBtn, downloadBtn);
      else previewActions.appendChild(previewFullscreenBtn);
    }
    applyFullscreen(null); // 同步按钮初始 aria-pressed / title
  }

  // ---------------------------------------------------------------- 位置桥接
  function locateCurrentCursor() {
    if (!hasEditor() || !previewFrame || !previewFrame.contentWindow) return;
    var line;
    try { line = window.mdEditor.getCursorLine(); } catch (e) { return; }
    if (!Number.isFinite(line)) return;
    postLocate(line);
  }

  function postLocate(line) {
    if (!previewFrame || !previewFrame.contentWindow) return;
    try { previewFrame.contentWindow.postMessage({ type: 'md2pdf-locate', line: line }, '*'); }
    catch (e) { /* 跨源异常忽略 */ }
  }

  function onCursor(event) {
    if (!ready || !syncInput || !syncInput.checked) return;
    if (Date.now() < suppressUntil) return;      // 由预览跳转引发，不回传
    var line = event.detail && event.detail.line;
    if (!Number.isFinite(line)) return;
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(function () { postLocate(line); }, CURSOR_DEBOUNCE);
  }

  function onPreviewSource(event) {
    if (!hasEditor()) return;
    var line = event.detail && event.detail.line;
    if (!Number.isFinite(line) || line < 1) return;
    suppressUntil = Date.now() + 600;
    try { window.mdEditor.goToLine(line); } catch (e) { return; }
    focusEditor();
  }

  // ---------------------------------------------------------------- 快捷键
  function inEditorTarget(target) {
    if (!target || !target.closest) return false;
    if (target.closest('.md-wt-toolbar, .md-wt-details')) return false;
    var tag = (target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'SELECT') return false;
    if (tag === 'TEXTAREA') return target.id === 'markdown';
    return !!target.closest('.editor-panel');
  }

  function onKeydown(event) {
    if (event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;   // 输入法组合中不拦截
    if (event.key === 'Escape' && fullscreenMode()) { applyFullscreen(null); return; }
    var mod = event.ctrlKey || event.metaKey;
    if (!mod || event.altKey || event.shiftKey) return;
    var key = (event.key || '').toLowerCase();
    if (key !== 'b' && key !== 'i' && key !== 'k') return;
    if (!hasTools() || !inEditorTarget(event.target)) return;
    event.preventDefault();
    runInsert(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'link');
  }

  // Escape in the sandboxed iframe cannot bubble into the parent document.
  document.addEventListener('md-preview-exit-fullscreen', function () {
    if (fullscreenMode() === 'preview') applyFullscreen(null);
  });

  // ---------------------------------------------------------------- 事件装配
  function onReady() {
    if (ready) return;
    ready = true;
    setEnabled(true);
  }

  function wireEvents() {
    document.addEventListener('md-editor-ready', onReady);
    document.addEventListener('md-editor-cursor', onCursor);
    document.addEventListener('md-preview-source', onPreviewSource);
    document.addEventListener('md-document-type', function (event) {
      var type = event.detail && event.detail.type;
      if (typeof type === 'string' && type) { currentType = type; workspace.setAttribute('data-document-type', type); }
    });
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('resize', function () {
      if (ratio == null || isNarrow()) return;
      var rect = workspace.getBoundingClientRect();
      applyWidth(ratio * rect.width, rect.width, false);
    });
    // 已有 API 时立即就绪（脚本加载晚于内核的情况）。
    if (hasEditor() || hasTools()) onReady();
  }

  buildToolbar();
  buildDivider();
  buildFullscreenButtons();
  restoreRatio();
  wireEvents();
  setEnabled(ready);
})();
