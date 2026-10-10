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
  var EDITOR_BASE_FONT = 13;               // 与 editor-core 主题 '&': { fontSize: '13px' } 对齐
  var ZOOM_MIN = 50, ZOOM_MAX = 150, ZOOM_STEP = 5, ZOOM_DEFAULT = 100;

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
  var cmEditor = null;                     // CodeMirror 根元素；缩放只改它的 font-size，不动渲染字号
  var markdownZoom = ZOOM_DEFAULT;         // 百分比
  var previewZoom = ZOOM_DEFAULT;          // 百分比，发往 iframe；与 Markdown 缩放相互独立
  var markdownZoomControl = null, previewZoomControl = null;

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
  // 分组：撤销重做/查找替换 · 文字格式 · 插入 · 学术 · 视图。
  // 每个控件都是固定紧凑尺寸的 SVG 图标按钮：title 显示功能与快捷键，
  // aria-label 为中文，:focus-visible 有可见焦点环。图片按钮由图片模块挂到
  // 插入组的挂载点上，本模块不参与图片导入管线。
  // 图标：路径 / 圆 / 矩形描述，统一 20×20 线性描边，颜色随文字（currentColor）。
  // 默认开启的同步定位是一个带 aria-pressed 的图标开关按钮。
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    open: [{ d: 'M3 6h5l2 2h7v7H3z' }, { d: 'M3 6V4h5l2 2h5v2' }],
    save: [{ d: 'M4 3h10l3 3v11H4z' }, { d: 'M7 3v5h6V3M7 17v-6h7v6' }],
    undo: [{ d: 'M7 5.2 3.6 8.6 7 12' }, { d: 'M3.6 8.6H12a4.4 4.4 0 0 1 0 8.8H9.4' }],
    redo: [{ d: 'M13 5.2 16.4 8.6 13 12' }, { d: 'M16.4 8.6H8a4.4 4.4 0 0 0 0 8.8h2.6' }],
    find: [{ circle: [8.8, 8.8, 4.8] }, { d: 'M12.5 12.5 16.4 16.4' }],
    heading: [{ d: 'M3.5 5v10M10 5v10M3.5 10H10' }, { d: 'M13 9a2.5 2.5 0 0 1 5 0c0 1.5-2 2.5-5 6h5' }],
    bold: [{ d: 'M7 5.2h3.6a2.4 2.4 0 0 1 0 4.8H7z' }, { d: 'M7 10h4a2.4 2.4 0 0 1 0 4.8H7z' }],
    italic: [{ d: 'M9.6 5.2h4.4' }, { d: 'M6 14.8h4.4' }, { d: 'M11.6 5.2 8.4 14.8' }],
    link: [{ d: 'M8.4 11.6a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-1 1' }, { d: 'M11.6 8.4a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l1-1' }],
    quote: [{ d: 'M6.2 7.4h2.6v2.6a2.6 2.6 0 0 1-2.6 2.6' }, { d: 'M11.6 7.4h2.6v2.6a2.6 2.6 0 0 1-2.6 2.6' }],
    code: [{ d: 'M8.4 6.2 5 10l3.4 3.8' }, { d: 'M11.6 6.2 15 10l-3.4 3.8' }],
    codeblock: [{ rect: [4.2, 5.4, 11.6, 9.2], rx: 1.6 }, { d: 'M8.4 8.6 7 10l1.4 1.4' }, { d: 'M11.6 8.6 13 10l-1.4 1.4' }],
    table: [{ rect: [4.2, 5.4, 11.6, 9.2], rx: 1.6 }, { d: 'M4.2 9.5h11.6' }, { d: 'M9.7 5.4v9.2' }],
    figure: [{ d: 'M4.4 15.6V9.2' }, { d: 'M8.8 15.6V5.4' }, { d: 'M13.2 15.6v-4' }, { d: 'M3.4 16.6h13.2' }],
    footnote: [{ d: 'M4.4 7.8h8' }, { d: 'M4.4 10.9h8' }, { d: 'M4.4 14h5' }, { d: 'M13.8 5.4 15.6 4.4v5.4' }],

    formula: [{ d: 'M6 5.2h8L9.6 10l4.4 4.8H6' }],
    foldToggle: [{ d: 'M6.6 8.6 10 5.2l3.4 3.4' }, { d: 'M6.6 11.4 10 14.8l3.4-3.4' }],
    // Tabler arrows-exchange（24 网格）按 0.8333333333 缩放进 20 视图，路径数据未改动。
    unsync: [{ d: 'M7 7h8l-3-3M13 13H5l3 3M3 3l14 14' }],
    sync: [{ g: 'scale(0.8333333333)', d: 'M7 10h14l-4 -4M17 14h-14l4 4' }],
    insert: [{ rect: [4, 4, 12, 12], rx: 2 }, { d: 'M10 7v6' }, { d: 'M7 10h6' }],
    // 从模板创建：文档轮廓（折角）+ 加号，与其它按钮同为 20×20 线性描边。
    template: [{ d: 'M11.2 3.6H6.2a1.4 1.4 0 0 0-1.4 1.4v10a1.4 1.4 0 0 0 1.4 1.4h7.6a1.4 1.4 0 0 0 1.4-1.4V7.4z' }, { d: 'M11.2 3.6v3.8h3.4' }, { d: 'M7.8 11h4.4' }, { d: 'M10 8.8v4.4' }]
  };

  // SVG 文件图标：仅「参考文献」与「DOI 引用」两个按钮使用本地 SVG 资源，
  // 其余按钮仍走下面的内联路径图标，逻辑不受影响。
  var FILE_ICONS = {
    bibliography: { src: '/icons/bibtex.svg', label: 'BibTeX 参考文献' },
    doi: { src: '/icons/doi.svg', label: 'DOI 引用' }
  };

  function iconSvg(name) {
    var iconFile = FILE_ICONS[name];
    if (iconFile) {
      var img = document.createElement('img');
      img.setAttribute('class', 'md-wt-icon');
      img.setAttribute('src', iconFile.src);
      img.setAttribute('alt', '');
      img.setAttribute('aria-hidden', 'true');
      return img;
    }
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'md-wt-icon');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    (ICONS[name] || []).forEach(function (shape) {
      var parent = svg;
      if (shape.g) {
        parent = document.createElementNS(SVG_NS, 'g');
        parent.setAttribute('transform', shape.g);
        svg.appendChild(parent);
      }
      var node;
      if (shape.circle) {
        node = document.createElementNS(SVG_NS, 'circle');
        node.setAttribute('cx', shape.circle[0]);
        node.setAttribute('cy', shape.circle[1]);
        node.setAttribute('r', shape.circle[2]);
      } else if (shape.rect) {
        node = document.createElementNS(SVG_NS, 'rect');
        node.setAttribute('x', shape.rect[0]);
        node.setAttribute('y', shape.rect[1]);
        node.setAttribute('width', shape.rect[2]);
        node.setAttribute('height', shape.rect[3]);
        if (shape.rx != null) node.setAttribute('rx', shape.rx);
      } else {
        node = document.createElementNS(SVG_NS, 'path');
        node.setAttribute('d', shape.d);
      }
      node.setAttribute('fill', 'none');
      node.setAttribute('stroke', 'currentColor');
      node.setAttribute('stroke-width', '1.4');
      node.setAttribute('stroke-linecap', 'round');
      node.setAttribute('stroke-linejoin', 'round');
      parent.appendChild(node);
    });
    return svg;
  }

  function iconButton(name, label, title) {
    var button = make('button', { type: 'button', class: 'md-wt-button', title: title, 'aria-label': label });
    button.appendChild(iconSvg(name));
    return button;
  }

  var HISTORY_ITEMS = [
    { icon: 'undo', label: '撤销', hint: '撤销（Ctrl/⌘+Z）', command: 'undo' },
    { icon: 'redo', label: '重做', hint: '重做（Ctrl/⌘+Shift+Z）', command: 'redo' },
    { icon: 'find', label: '查找与替换', hint: '查找与替换（Ctrl/⌘+F）', command: 'find' }
  ];
  var FORMAT_ITEMS = [
    { icon: 'heading', label: '二级标题', hint: '插入二级标题（H2 / ## 小节）', insert: 'heading' },
    { icon: 'bold', label: '粗体', hint: '粗体（Ctrl/⌘+B）', insert: 'bold' },
    { icon: 'italic', label: '斜体', hint: '斜体（Ctrl/⌘+I）', insert: 'italic' }
  ];
  var INSERT_ITEMS = [
    { icon: 'link', label: '链接', hint: '链接（Ctrl/⌘+K）', insert: 'link' },
    { icon: 'quote', label: '引用', hint: '引用块 > …', insert: 'quote' },
    { icon: 'code', label: '行内代码', hint: '行内代码（反引号包裹）', insert: 'code' },
    { icon: 'codeblock', label: '代码块', hint: '插入带语言标识的代码块', insert: 'codeblock' },
    { icon: 'table', label: '表格', hint: '插入 Markdown 表格', insert: 'table' },
    { icon: 'figure', label: '图表', hint: '图表块（自动编号 图 N）', insert: 'figure' }
  ];
  var ACADEMIC_ITEMS = [
    { icon: 'footnote', label: '脚注', hint: '脚注定义 [^id]', insert: 'footnote' },
    { icon: 'bibliography', label: 'BibTeX 参考文献', hint: '插入 BibTeX 条目（自动著录为参考文献）', insert: 'bibliography' },
    { icon: 'doi', label: 'DOI 引用', hint: '按 DOI 或 DOI 链接查询文献，插入引用与 BibTeX 定义' },
    { icon: 'formula', label: '公式', hint: '行内或独立公式', insert: 'formula' }
  ];
  var SNIPPETS = [
    { name: 'gb-scope', label: '标准范围（gb-scope）' },
    { name: 'gb-terms', label: '标准术语（gb-terms）' },
    { name: 'gb-appendix', label: '标准附录（gb-appendix）' },
    { name: 'skill', label: '技能文档（skill）' }
  ];

  // 图片按钮挂载点：图片模块只把按钮挂到这里（不改导入管线）；找不到时回落到工具条。
  var IMAGE_MOUNT_ATTR = 'data-md-wt-mount';

  function appendItem(group, item) {
    // 锚点项（从模板创建）：沿用图标按钮外观，但用 <a> 自带导航行为，
    // 不注册编辑器命令，也不参与启用/禁用（编辑器未就绪时也能进入模板库）。
    var button;
    if (item.href) {
      button = make('a', { class: 'md-wt-button', href: item.href, 'aria-label': item.label, title: item.hint });
      if (item.id) button.setAttribute('id', item.id);
      button.appendChild(iconSvg(item.icon));
    } else {
      button = iconButton(item.icon, item.label, item.hint);
      if (item.insert) button.addEventListener('click', function () { runInsert(item.insert); });
      // DOI 按钮由 web/editor-doi.js 实现界面：这里只派发事件，不耦合实现。
      else if (item.icon === 'doi') button.addEventListener('click', function () {
        document.dispatchEvent(new CustomEvent('md-doi-open'));
      });
      else if (item.command) button.addEventListener('click', function () { runCommand(item.command); });
      commandButtons.push(button);
    }
    group.appendChild(button);
    return button;
  }

  function buildGroup(label, className, items, mount) {
    var group = make('div', { class: 'md-wt-group ' + className, role: 'group', 'aria-label': label });
    items.forEach(function (item) {
      appendItem(group, item);
      // 图片按钮紧跟「表格」之后，位于「图表」之前。
      if (mount && item.insert === 'table') {
        group.appendChild(make('span', { class: 'md-wt-mount', 'data-md-wt-mount': mount }));
      }
    });
    wireRovingTabindex(group);
    return group;
  }

  function buildSyncButton() {
    // 带 aria-pressed 的图标开关按钮（有键盘语义），保留 #md-wt-sync 与 .checked 兼容访问器，
    // 不使用没有键盘语义的隐藏复选框冒充按钮。
    var button = iconButton('sync', '同步定位', '同步定位：按标题所在章节近似联动（点击开启 / 关闭）');
    button.setAttribute('id', 'md-wt-sync');
    function updateSync(on) {
      button.setAttribute('aria-pressed', String(on));
      button.textContent = '';
      button.appendChild(iconSvg(on ? 'unsync' : 'sync'));
      button.title = on ? '断开同步定位' : '开启同步定位';
    }
    updateSync(true); // 默认开启；图标表示点击后的动作。
    Object.defineProperty(button, 'checked', {
      configurable: true,
      get: function () { return button.getAttribute('aria-pressed') === 'true'; },
      set: function (value) { updateSync(!!value); }
    });
    button.addEventListener('click', function () {
      var on = button.getAttribute('aria-pressed') !== 'true';
      updateSync(on);
      if (on) locateCurrentCursor();
    });
    commandButtons.push(button);
    return button;
  }

  function buildToolbar() {
    toolbar = make('div', { class: 'md-wt-toolbar', role: 'toolbar', 'aria-label': 'Markdown 格式与操作工具条', 'aria-orientation': 'horizontal' });

    toolbar.appendChild(buildGroup('撤销重做与查找替换', 'md-wt-group--history', HISTORY_ITEMS));
    toolbar.appendChild(buildGroup('文字格式', 'md-wt-group--format', FORMAT_ITEMS));
    toolbar.appendChild(buildGroup('插入', 'md-wt-group--insert', INSERT_ITEMS, 'images'));
    toolbar.appendChild(buildGroup('学术', 'md-wt-group--academic', ACADEMIC_ITEMS));

    var view = make('div', { class: 'md-wt-group md-wt-group--view', role: 'group', 'aria-label': '视图' });
    var foldButton = iconButton('foldToggle', '折叠或展开', '折叠 / 展开当前位置（Ctrl+Shift+[ / ]；Mac：⌘+Option+[ / ]）');
    foldButton.addEventListener('click', function () { runCommand('toggleFold'); });
    commandButtons.push(foldButton);
    view.appendChild(foldButton);
    syncInput = buildSyncButton();
    view.appendChild(syncInput);
    wireRovingTabindex(view);
    toolbar.appendChild(view);

    var heading = editorPanel.querySelector('.panel-heading');
    // insertBefore(node, null/undefined) 追加到末尾，避免依赖 after()。
    if (heading) editorPanel.insertBefore(toolbar, heading.nextSibling);
    else editorPanel.insertBefore(toolbar, editorPanel.firstChild);

    buildSnippetDetails();
  }

  function buildSnippetDetails() {
    details = make('details', { class: 'md-wt-details' });
    details.appendChild(make('summary', null, '更多插入（专业片段）'));

    var body = make('div', { class: 'md-wt-snippets' });
    snippetSelect = make('select', { id: 'md-wt-snippet', 'aria-label': '专业片段' });
    snippetSelect.appendChild(make('option', { value: '' }, '选择片段类型…'));
    SNIPPETS.forEach(function (item) { snippetSelect.appendChild(make('option', { value: item.name }, item.label)); });
    insertSnippetBtn = iconButton('insert', '插入所选专业片段', '插入所选专业片段');
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
    var buttons = function () { return Array.prototype.filter.call(group.querySelectorAll('button, a.md-wt-button'), function (b) { return !b.disabled; }); };
    Array.prototype.forEach.call(group.querySelectorAll('button, a.md-wt-button'), function (b, i) { b.tabIndex = i === 0 ? 0 : -1; });
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

  // ---------------------------------------------------------------- 缩放（Markdown / 预览）
  // 两侧 panel-heading 各放一个缩放滑块，互不影响：
  //   * Markdown 缩放只改 .cm-editor 的显示字号（基准 13px × 比例），不动文档渲染
  //     字号、工具栏与标题栏；CodeMirror 活动时用 requestMeasure 重算度量，
  //     编辑器未挂载则回退到 textarea 字号。
  //   * 预览缩放通过 postMessage 把百分比发进 iframe，由 src/preview.mjs 在
  //     自适应 fit() 结果上再乘 zoom/100；100% 即原始效果。
  // 共享外观类 .ruler-control / .ruler-scale / .ruler-slider 由 app.css 统一提供，
  // 本模块只负责容器布局与数值 bubble 的定位。
  function clampZoom(value) {
    var n = Number(value);
    if (!isFinite(n)) return ZOOM_DEFAULT;
    n = Math.round(n / ZOOM_STEP) * ZOOM_STEP;
    return clamp(n, ZOOM_MIN, ZOOM_MAX);
  }

  // 复用 app.css 的共享直尺结构：.ruler-control（轨道行）内放滑块与数值 bubble，
  // 下面是 .ruler-scale（与轨道端点对齐的最小最大值）。
  function makeZoomControl(label, onZoom) {
    var root = make('div', { class: 'md-wt-zoom', role: 'group', 'aria-label': label });
    var control = make('div', { class: 'ruler-control' });
    var input = make('input', {
      type: 'range', class: 'ruler-slider',
      min: String(ZOOM_MIN), max: String(ZOOM_MAX), step: String(ZOOM_STEP),
      'aria-label': label, 'aria-valuetext': ZOOM_DEFAULT + '%',
    });
    input.value = String(ZOOM_DEFAULT);
    var output = make('output', { class: 'md-wt-zoom-value', 'aria-hidden': 'true' }, ZOOM_DEFAULT + '%');
    var scale = make('div', { class: 'ruler-scale', 'aria-hidden': 'true' });
    var minLabel = make('span', { class: 'ruler-label ruler-label--min' }, ZOOM_MIN + '%');
    var maxLabel = make('span', { class: 'ruler-label ruler-label--max' }, ZOOM_MAX + '%');

    function render(percent) {
      output.textContent = percent + '%';
      input.setAttribute('aria-valuetext', percent + '%');
      var pos = (percent - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN) * 100;
      root.style.setProperty('--zoom-pos', pos + '%');
    }

    function set(percent) {
      var pct = clampZoom(percent);
      input.value = String(pct);
      render(pct);
      onZoom(pct);
    }

    input.addEventListener('input', function () { set(input.value); });
    input.addEventListener('change', function () { set(input.value); });

    control.appendChild(input);
    control.appendChild(output);
    scale.appendChild(minLabel);
    scale.appendChild(maxLabel);
    root.appendChild(control);
    root.appendChild(scale);
    render(ZOOM_DEFAULT);
    return { root: root, input: input, output: output, set: set };
  }

  // 只用现有 window.mdEditor 接口；缺失时退回厂商 EditorView.findFromDOM，
  // 避免去改 editor-core。字体尺寸变化后由 CodeMirror 重新度量，
  // 保证选中高亮、光标与滚动位置对齐。
  function measureEditor() {
    try {
      if (window.mdEditor && typeof window.mdEditor.requestMeasure === 'function') { window.mdEditor.requestMeasure(); return; }
      var V = window.MDEditorVendor;
      if (cmEditor && V && V.EditorView && typeof V.EditorView.findFromDOM === 'function') {
        var view = V.EditorView.findFromDOM(cmEditor);
        if (view && typeof view.requestMeasure === 'function') view.requestMeasure();
      }
    } catch (e) { /* 度量失败不影响缩放显示 */ }
  }

  function applyMarkdownZoom(percent) {
    markdownZoom = clampZoom(percent);
    var size = (EDITOR_BASE_FONT * markdownZoom / 100) + 'px';
    cmEditor = editorPanel.querySelector('.cm-editor');
    var target = cmEditor || editorPanel.querySelector('textarea');
    if (target && target.style) target.style.fontSize = size;
    measureEditor();
  }

  function sendPreviewZoom() {
    if (!previewFrame || !previewFrame.contentWindow) return;
    try { previewFrame.contentWindow.postMessage({ type: 'md2pdf-preview-zoom', zoom: previewZoom }, '*'); }
    catch (e) { /* 跨源异常忽略 */ }
  }

  function buildZoomControls() {
    var editorHeading = editorPanel.querySelector('.panel-heading');
    var previewHeading = previewPanel.querySelector('.panel-heading');
    markdownZoomControl = makeZoomControl('Markdown 缩放', function (pct) { applyMarkdownZoom(pct); });
    previewZoomControl = makeZoomControl('排版预览缩放', function (pct) { previewZoom = clampZoom(pct); sendPreviewZoom(); });
    insertZoom(editorHeading, markdownZoomControl);
    insertZoom(previewHeading, previewZoomControl);
  }

  function insertZoom(heading, control) {
    if (!heading || !control) return;
    var actions = heading.querySelector('.panel-actions');
    heading.insertBefore(control.root, actions || null);
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
      editorFullscreenBtn.textContent = '';
      editorFullscreenBtn.appendChild(fullscreenIcon(editorOn));
      editorFullscreenBtn.setAttribute('aria-label', editorOn ? '退出 Markdown 全屏' : 'Markdown 全屏写作');
      editorFullscreenBtn.title = editorOn ? '退出全屏（Esc）' : '全屏写作（Esc 退出）';
    }
    if (previewFullscreenBtn) {
      previewFullscreenBtn.setAttribute('aria-pressed', String(previewOn));
      previewFullscreenBtn.textContent = '';
      previewFullscreenBtn.appendChild(fullscreenIcon(previewOn));
      previewFullscreenBtn.setAttribute('aria-label', previewOn ? '退出预览全屏' : '预览全屏');
      previewFullscreenBtn.title = previewOn ? '退出全屏（Esc）' : '全屏预览（Esc 退出）';
    }
    if (editorOn) focusEditor();
  }

  function toggleFullscreen(mode) {
    applyFullscreen(nextFullscreenMode(fullscreenMode(), mode));
  }

  function fullscreenIcon(shrink) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'btn-icon');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', shrink ? 'M3.5 7.5h4v-4M16.5 7.5h-4v-4M3.5 12.5h4v4M16.5 12.5h-4v4' : 'M7.5 3.5H4.5v3M12.5 3.5h3v3M7.5 16.5H4.5v-3M12.5 16.5h3v-3');
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

  function fileStatus(message, error) {
    var status = document.querySelector('#status');
    if (status) { status.textContent = message; status.setAttribute('data-error', String(!!error)); }
  }

  function makeFileButton(label, icon, action) {
    var button = make('button', { type: 'button', class: 'icon-button', 'aria-label': label, title: label });
    button.appendChild(iconSvg(icon));
    button.addEventListener('click', action);
    return button;
  }

  function buildFileButtons(actions) {
    var input = make('input', { type: 'file', accept: '.md,.markdown,.mdown,text/markdown,text/plain', hidden: '' });
    actions.appendChild(input);
    input.addEventListener('change', async function () {
      var file = input.files && input.files[0];
      input.value = ''; // 允许再次打开同一文件。
      if (!file) return;
      if (!/\.(md|markdown|mdown)$/i.test(file.name)) { fileStatus('请选择 Markdown 文件（.md）。', true); return; }
      try {
        var text = await file.text();
        if (!window.mdEditor || typeof window.mdEditor.setValue !== 'function') throw new Error('editor unavailable');
        window.mdEditor.setValue(text.replace(/^\uFEFF/, ''));
        focusEditor();
      } catch (e) { fileStatus('无法读取 Markdown 文件，请重试。', true); }
    });
    actions.appendChild(makeFileButton('打开 Markdown 文件', 'open', function () { input.click(); }));
  }

  async function saveMarkdown() {
    if (!window.mdEditor || typeof window.mdEditor.getValue !== 'function') return;
    var text = window.mdEditor.getValue();
    var files = await import('./editor-files.mjs');
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = make('a', { href: url, download: files.markdownDownloadName(text) });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // 在两侧 panel-heading 的动作区注入全屏按钮：Markdown 侧位于最右，
  // 预览侧追加在下载按钮之后，全屏始终位于该栏最右。
  function buildFullscreenButtons() {
    var editorHeading = editorPanel.querySelector('.panel-heading');
    var previewHeading = previewPanel.querySelector('.panel-heading');
    var editorActions = editorHeading && editorHeading.querySelector('.panel-actions');
    var previewActions = previewHeading && previewHeading.querySelector('.panel-actions');

    editorFullscreenBtn = makeFullscreenButton('Markdown 全屏写作', '全屏写作（Esc 退出）');
    editorFullscreenBtn.addEventListener('click', function () { toggleFullscreen('editor'); });
    if (editorActions) {
      buildFileButtons(editorActions);
      var templateLink = appendItem(editorActions, { icon: 'template', label: '从模板创建', hint: '从模板创建', href: '/examples', id: 'browse-examples' });
      templateLink.className = 'icon-button';
      editorActions.appendChild(makeFileButton('保存 Markdown 文件', 'save', saveMarkdown));
      editorActions.appendChild(editorFullscreenBtn);
    }

    previewFullscreenBtn = makeFullscreenButton('预览全屏', '全屏预览（Esc 退出）');
    previewFullscreenBtn.addEventListener('click', function () { toggleFullscreen('preview'); });
    if (previewActions) previewActions.appendChild(previewFullscreenBtn);
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
    applyMarkdownZoom(markdownZoom); // 编辑器就绪后套用当前缩放（含 textarea 兜底）
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
    // 预览就绪后重新下发当前缩放：iframe 重载会丢失状态；只接受预览窗口的消息。
    window.addEventListener('message', function (event) {
      if (!previewFrame || event.source !== previewFrame.contentWindow) return;
      if (!event.data || event.data.type !== 'md2pdf-ready') return;
      sendPreviewZoom();
    });
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
  buildZoomControls();
  restoreRatio();
  wireEvents();
  setEnabled(ready);
})();
