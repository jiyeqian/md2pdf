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
  var ZOOM_MIN = 20, ZOOM_MAX = 200, ZOOM_STEP = 5, ZOOM_DEFAULT = 100;

  var workspace = document.querySelector('.workspace');
  var editorPanel = workspace && workspace.querySelector('.editor-panel');
  var previewPanel = workspace && workspace.querySelector('.preview-panel');
  if (!workspace || !editorPanel || !previewPanel) return;
  workspace.classList.add('md-editor-workspace');

  var previewFrame = document.querySelector('#preview');
  var toolbar, divider, editorFullscreenBtn, previewFullscreenBtn, syncInput;
  var basicWrap, basicButton, basicMenu;
  var editorModeBtn, previewModeBtn;
  var commandButtons = [];
  var ready = false;
  var dragging = false;
  var ratio = null;            // 编辑区占容器宽度的比例，null 表示用 CSS 默认
  var cursorTimer = null;
  var suppressUntil = 0;       // 预览→编辑器跳转期间，抑制光标回传，避免回环
  var currentType = 'general';
  var openMarkdownInput = null;
  var documentShortcut = null;
  var layoutRevision = 0;
  var pendingLayout = null;
  var lastEditorAnchor = null;
  var lastPreviewPosition = null;
  import('./workspace-navigation.mjs').then(function (module) { documentShortcut = module.documentShortcut; }).catch(function () { console.warn('文档快捷键模块加载失败'); });
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
    if (name !== 'find' && name !== 'replace' && name !== 'toggleSearch') focusEditor();
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
    indentMore: [{ d: 'M8 4h9M8 10h9M8 16h9M2 7l3 3-3 3' }],
    indentLess: [{ d: 'M8 4h9M8 10h9M8 16h9M5 7l-3 3 3 3' }],
    open: [{ d: 'M3 6h5l2 2h7v7H3z' }, { d: 'M3 6V4h5l2 2h5v2' }],
    save: [{ d: 'M4 3h10l3 3v11H4z' }, { d: 'M7 3v5h6V3M7 17v-6h7v6' }],
    undo: [{ d: 'M7 5.2 3.6 8.6 7 12' }, { d: 'M3.6 8.6H12a4.4 4.4 0 0 1 0 8.8H9.4' }],
    redo: [{ d: 'M13 5.2 16.4 8.6 13 12' }, { d: 'M16.4 8.6H8a4.4 4.4 0 0 0 0 8.8h2.6' }],
    find: [{ circle: [8.8, 8.8, 4.8] }, { d: 'M12.5 12.5 16.4 16.4' }],
    heading: [{ d: 'M3.5 5v10M10 5v10M3.5 10H10' }, { d: 'M13 9a2.5 2.5 0 0 1 5 0c0 1.5-2 2.5-5 6h5' }],
    heading1: [{ d: 'M3.5 5v10M10 5v10M3.5 10H10' }, { d: 'M13 9l2-2v8M13 15h4' }],
    heading3: [{ d: 'M3.5 5v10M10 5v10M3.5 10H10' }, { d: 'M13 7h4l-3 4h1a2 2 0 0 1 0 4h-2' }],
    bold: [{ d: 'M7 5.2h3.6a2.4 2.4 0 0 1 0 4.8H7z' }, { d: 'M7 10h4a2.4 2.4 0 0 1 0 4.8H7z' }],
    strikethrough: [{ d: 'M14 6c-1-2-7-2-7 1 0 1.5 2 2 3 2M7 14c1 2 7 2 7-1 0-1-1-1.5-2-2M3 10h14' }],
    rule: [{ d: 'M3 10h14' }],
    italic: [{ d: 'M9.6 5.2h4.4' }, { d: 'M6 14.8h4.4' }, { d: 'M11.6 5.2 8.4 14.8' }],
    link: [{ d: 'M8.4 11.6a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-1 1' }, { d: 'M11.6 8.4a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l1-1' }],
    quote: [{ d: 'M6.2 7.4h2.6v2.6a2.6 2.6 0 0 1-2.6 2.6' }, { d: 'M11.6 7.4h2.6v2.6a2.6 2.6 0 0 1-2.6 2.6' }],
    code: [{ d: 'M8.4 6.2 5 10l3.4 3.8' }, { d: 'M11.6 6.2 15 10l-3.4 3.8' }],
    codeblock: [{ rect: [4.2, 5.4, 11.6, 9.2], rx: 1.6 }, { d: 'M8.4 8.6 7 10l1.4 1.4' }, { d: 'M11.6 8.6 13 10l-1.4 1.4' }],
    table: [{ rect: [4.2, 5.4, 11.6, 9.2], rx: 1.6 }, { d: 'M4.2 9.5h11.6' }, { d: 'M9.7 5.4v9.2' }],
    figure: [{ d: 'M4.4 15.6V9.2' }, { d: 'M8.8 15.6V5.4' }, { d: 'M13.2 15.6v-4' }, { d: 'M3.4 16.6h13.2' }],
    footnote: [{ d: 'M4.4 7.8h8' }, { d: 'M4.4 10.9h8' }, { d: 'M4.4 14h5' }, { d: 'M13.8 5.4 15.6 4.4v5.4' }],

    formula: [{ d: 'M5 2h10M5 18h10M6 5h8l-4.5 5 4.5 5H6' }],
    // 基础格式（合并的标题 / 强调 / 列表 / 行内入口）与第二级面板使用。
    basicFormat: [{ d: 'M4 5.6h12' }, { d: 'M4 9.4h12' }, { d: 'M4 13.2h7' }],
    listStar: [{ circle: [3.6, 6, 1] }, { circle: [3.6, 10, 1] }, { circle: [3.6, 14, 1] }, { d: 'M7.4 6h9' }, { d: 'M7.4 10h9' }, { d: 'M7.4 14h9' }],
    listDash: [{ d: 'M2.6 6h2M2.6 10h2M2.6 14h2M7.4 6h9M7.4 10h9M7.4 14h9' }],
    listOl: [{ d: 'M3.2 5.6h1.3v3.2' }, { d: 'M3.2 14.6c1.6 0 1.6 1.3 0 1.3h1.6' }, { d: 'M7.4 6h9' }, { d: 'M7.4 10h9' }, { d: 'M7.4 14h9' }],
    inlineMath: [{ d: 'M6 5h8l-4.5 5 4.5 5H6' }],
    ref: [{ d: 'M3 4h9v11H3zM4 12l3-4 3 3' }, { d: 'M12 8h5m-2-2 2 2-2 2' }],
    noteref: [{ d: 'M4 5h7M4 9h7M4 13h5' }, { d: 'M12 10h5m-2-2 2 2-2 2' }],
    eqref: [{ d: 'M4 5h7l-4 5 4 5H4' }, { d: 'M12 10h5m-2-2 2 2-2 2' }],
    foldToggle: [{ d: 'M6.6 8.6 10 5.2l3.4 3.4' }, { d: 'M6.6 11.4 10 14.8l3.4-3.4' }],
    // Tabler arrows-exchange（24 网格）按 0.8333333333 缩放进 20 视图，路径数据未改动。
    unsync: [{ d: 'M7 12l-2 2a3 3 0 0 1-4-4l2-2M13 8l2-2a3 3 0 0 1 4 4l-2 2M7 3l1 2M12 15l1 2' }],
    sync: [{ d: 'M8 12l-2 2a3 3 0 0 1-4-4l3-3a3 3 0 0 1 4 0M12 8l2-2a3 3 0 0 1 4 4l-3 3a3 3 0 0 1-4 0M7 13l6-6' }],
    insert: [{ rect: [4, 4, 12, 12], rx: 2 }, { d: 'M10 7v6' }, { d: 'M7 10h6' }],
    templateGrid: [{ d: 'M3 3h14v14H3zM3 7h14M8 7v10' }, { d: 'M10.5 12h4M12.5 10v4' }],
    // 空白文档轮廓与加号。
    template: [{ d: 'M11.2 3.6H6.2a1.4 1.4 0 0 0-1.4 1.4v10a1.4 1.4 0 0 0 1.4 1.4h7.6a1.4 1.4 0 0 0 1.4-1.4V7.4z' }, { d: 'M11.2 3.6v3.8h3.4' }, { d: 'M7.8 11h4.4' }, { d: 'M10 8.8v4.4' }]
  };

  // SVG 文件图标：仅「参考文献」与「DOI 引用」两个按钮使用本地 SVG 资源，
  // 其余按钮仍走下面的内联路径图标，逻辑不受影响。
  var FILE_ICONS = {
    bibliography: { src: '/icons/bibtex.svg', label: 'BibTeX参考文献' },
    doi: { src: '/icons/doi.svg', label: 'DOI参考文献' }
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

  // 快捷键映射：仅登记真实存在的绑定（CodeMirror 内核或本模块拦截）。
  // 工具提示按平台显示 Mac（⌘/⌥/⇧）或 Windows（Ctrl/Alt/Shift）；无绑定的按钮只显示功能说明。
  // 无序 / 有序列表使用 Mod+Shift+8/9；Mod+Shift+7 保留为无序列表兼容键。
  // 行内代码 / 公式与引用块选用不与浏览器 / 系统保留键冲突的组合：⇧⌘E / ⇧⌘X / ⇧⌘. 。
  var SHORTCUTS = {
    undo: 'Mod-Z', redo: 'Mod-Shift-Z', find: 'Mod-F',
    bold: 'Mod-B', italic: 'Mod-I', link: 'Mod-K',
    strikethrough: 'Mod-Alt-S', codeblock: 'Mod-Alt-E', formula: 'Mod-Alt-M',
    code: 'Mod-Shift-E', 'inline-math': 'Mod-Shift-X', quote: 'Mod-Shift-.',
    h1: 'Mod-Alt-1', h2: 'Mod-Alt-2', h3: 'Mod-Alt-3',
    'ul-dash': 'Mod-Shift-8', ol: 'Mod-Shift-9'
  };
  var IS_MAC = (function () {
    try {
      var nav = typeof navigator !== 'undefined' ? navigator : null;
      var flag = nav && (nav.platform || nav.userAgent) || '';
      return /Mac|iPhone|iPad|iPod/i.test(flag);
    } catch (e) { return false; }
  })();
  function shortcutLabel(action) {
    var token = SHORTCUTS[action];
    if (!token) return '';
    if (action === 'redo' && !IS_MAC) return 'Ctrl+Y / Ctrl+Shift+Z';
    var parts = token.split('-');
    var mod = parts[0] === 'Mod';
    var alt = parts.indexOf('Alt') >= 0;
    var shift = parts.indexOf('Shift') >= 0;
    var key = parts[parts.length - 1];
    if (IS_MAC) {
      return (shift ? '⇧' : '') + (alt ? '⌥' : '') + (mod ? '⌘' : '') + key;
    }
    var names = [];
    if (mod) names.push('Ctrl');
    if (alt) names.push('Alt');
    if (shift) names.push('Shift');
    names.push(key);
    return names.join('+');
  }
  // 工具提示：有绑定 → 功能说明（快捷键）；否则 → 仅功能说明。
  function actionTitle(label, action) {
    var sc = action ? shortcutLabel(action) : '';
    return sc ? label + '（' + sc + '）' : label;
  }

  var HISTORY_ITEMS = [
    { icon: 'undo', label: '撤销', action: 'undo', command: 'undo' },
    { icon: 'redo', label: '重做', action: 'redo', command: 'redo' },
    { icon: 'find', label: '查找与替换', action: 'find', command: 'toggleSearch' }
  ];
  // 第一级只保留一个「基础格式」入口，展开第二级面板（标题 / 强调 / 列表 / 行内）。
  var BASIC_GROUPS = [
    { label: '标题', items: [
      { icon: 'heading1', label: '一级标题', action: 'h1', insert: 'h1' },
      { icon: 'heading', label: '二级标题', action: 'h2', insert: 'h2' },
      { icon: 'heading3', label: '三级标题', action: 'h3', insert: 'h3' }
    ] },
    { label: '强调', items: [
      { icon: 'bold', label: '粗体', action: 'bold', insert: 'bold' },
      { icon: 'italic', label: '斜体', action: 'italic', insert: 'italic' },
      { icon: 'strikethrough', label: '删除线', action: 'strikethrough', insert: 'strikethrough' },
      { icon: 'rule', label: '分割线', action: 'rule', insert: 'rule' }
    ] },
    { label: '列表', items: [
      { icon: 'listDash', label: '无序列表', action: 'ul-dash', insert: 'ul-dash' },
      { icon: 'listOl', label: '有序列表', action: 'ol', insert: 'ol' },
      { icon: 'indentMore', label: '右缩进', command: 'indentMore' },
      { icon: 'indentLess', label: '左缩进', command: 'indentLess' }
    ] },
    { label: '行内元素', items: [
      { icon: 'link', label: '链接', action: 'link', insert: 'link' },
      { icon: 'quote', label: '引用块', action: 'quote', insert: 'quote' },
      { icon: 'code', label: '行内代码', action: 'code', insert: 'code' },
      { icon: 'inlineMath', label: '行内公式', action: 'inline-math', insert: 'inline-math' }
    ] }
  ];
  // 复杂插入保留在第一级：代码块 / 表格 / 图片（图片模块挂载）/ 图表 / 脚注 / 文献 / 公式块。
  var INSERT_ITEMS = [
    { icon: 'table', label: '表格', insert: 'table' },
    { icon: 'figure', label: '图表', insert: 'figure' }
  ];
  var ACADEMIC_ITEMS = [
    { icon: 'footnote', label: '参考文献', insert: 'footnote' },
    { icon: 'bibliography', label: 'BibTeX参考文献', insert: 'bibliography' },
    { icon: 'doi', label: 'DOI参考文献' },
    { icon: 'ref', label: '图表引用', insert: 'ref' },
    { icon: 'eqref', label: '公式引用', insert: 'eqref' },
    { icon: 'noteref', label: '文献引用', insert: 'noteref' }
  ];
  // 图片按钮挂载点：图片模块只把按钮挂到这里（不改导入管线）；找不到时回落到工具条。
  var IMAGE_MOUNT_ATTR = 'data-md-wt-mount';

  // 顶部提示统一为「功能（快捷键）」或「功能」：不再保留各条目的冗长说明文案。
  function itemTitle(item) {
    return actionTitle(item.label, item.action);
  }

  function appendItem(group, item) {
    // 锚点项（从模板创建）：沿用图标按钮外观，但用 <a> 自带导航行为，
    // 不注册编辑器命令，也不参与启用/禁用（编辑器未就绪时也能进入模板库）。
    var button;
    if (item.href) {
      button = make('a', { class: 'md-wt-button', href: item.href, 'aria-label': item.label, title: item.hint || item.title || item.label });
      if (item.id) button.setAttribute('id', item.id);
      button.appendChild(iconSvg(item.icon));
    } else {
      button = iconButton(item.icon, item.label, itemTitle(item));
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

  // ---------------- 基础格式：第一级单入口 + 第二级多行面板 ----------------
  // 把标题 / 强调 / 列表 / 行内元素收敛到一个「基础格式」按钮；点击展开浅色多行面板。
  // 面板用 fixed 定位（不会撑高工具条、不被面板 overflow:hidden 裁剪），
  // 支持点击外部与 Esc 关闭、Esc 归还焦点、方向键导航。
  function buildBasicMenuRow(entry) {
    var row = make('div', { class: 'md-wt-menu-row', role: 'group', 'aria-label': entry.label });
    entry.items.forEach(function (item) {
      var button = make('button', { type: 'button', class: 'md-wt-button md-wt-menu-item', role: 'menuitem', title: itemTitle(item), 'aria-label': item.label, tabindex: '-1' });
      button.appendChild(iconSvg(item.icon));
      button.addEventListener('click', function () {
        if (item.command) runCommand(item.command); else runInsert(item.insert);
        closeBasicMenu(false); // 让 runInsert 的 focusEditor 保持焦点
      });
      commandButtons.push(button);
      row.appendChild(button);
    });
    return row;
  }

  function buildBasicFormatControl() {
    var group = make('div', { class: 'md-wt-group md-wt-group--format', role: 'group', 'aria-label': '基础格式' });
    basicWrap = make('div', { class: 'md-wt-basic' });
    basicButton = iconButton('basicFormat', '基础格式', actionTitle('基础格式'));
    basicButton.setAttribute('id', 'md-wt-basic-format');
    basicButton.setAttribute('aria-haspopup', 'true');
    basicButton.setAttribute('aria-expanded', 'false');
    basicButton.setAttribute('aria-controls', 'md-wt-basic-menu');
    basicMenu = make('div', { class: 'md-wt-basic-menu', role: 'menu', 'aria-label': '基础格式', id: 'md-wt-basic-menu' });
    basicMenu.hidden = true;
    BASIC_GROUPS.forEach(function (entry) { basicMenu.appendChild(buildBasicMenuRow(entry)); });
    basicButton.addEventListener('click', function (event) {
      event.preventDefault();
      if (basicMenu.hidden) openBasicMenu(); else closeBasicMenu(true);
    });
    basicMenu.addEventListener('keydown', onBasicMenuKeydown);
    basicWrap.appendChild(basicButton);
    basicWrap.appendChild(basicMenu);
    group.appendChild(basicWrap);
    commandButtons.push(basicButton);
    wireRovingTabindex(group);
    return group;
  }

  function menuItems() {
    return Array.prototype.slice.call(basicMenu.querySelectorAll('.md-wt-menu-item'));
  }

  function openBasicMenu() {
    basicMenu.hidden = false;
    basicButton.setAttribute('aria-expanded', 'true');
    basicWrap.classList.add('is-open');
    positionBasicMenu();
    var items = menuItems();
    if (items.length) items[0].focus();
  }

  function closeBasicMenu(restoreFocus) {
    if (!basicMenu || basicMenu.hidden) return;
    basicMenu.hidden = true;
    basicButton.setAttribute('aria-expanded', 'false');
    basicWrap.classList.remove('is-open');
    if (restoreFocus) basicButton.focus();
  }

  function positionBasicMenu() {
    if (!basicMenu || basicMenu.hidden) return;
    if (!basicButton.getBoundingClientRect || !basicMenu.getBoundingClientRect) return;
    var viewport = (typeof window !== 'undefined' && window.innerWidth) || 1024;
    var anchor = basicButton.getBoundingClientRect();
    var rect = basicMenu.getBoundingClientRect();
    var width = basicMenu.offsetWidth || (rect && rect.width) || 360;
    var left = Math.max(8, Math.min(anchor.left, viewport - width - 8));
    basicMenu.style.left = left + 'px';
    basicMenu.style.top = (anchor.bottom + 6) + 'px';
  }

  function onBasicMenuKeydown(event) {
    var items = menuItems();
    if (!items.length) return;
    var current = items.indexOf(document.activeElement);
    var next = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = current + 1;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = current - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') { event.preventDefault(); closeBasicMenu(true); return; }
    else if (event.key === 'Tab') { closeBasicMenu(false); return; }
    else return;
    event.preventDefault();
    if (next < 0) next = items.length - 1;
    if (next >= items.length) next = 0;
    items[next].focus();
  }

  function buildSyncButton() {
    // 带 aria-pressed 的图标开关按钮（有键盘语义），保留 #md-wt-sync 与 .checked 兼容访问器，
    // 不使用没有键盘语义的隐藏复选框冒充按钮。
    var button = iconButton('sync', '同步定位', '同步定位：按标题所在章节近似联动（点击开启 / 关闭）');
    button.setAttribute('id', 'md-wt-sync');
    function updateSync(on) {
      button.setAttribute('aria-pressed', String(on));
      button.textContent = '';
      button.appendChild(iconSvg(on ? 'sync' : 'unsync'));
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

    var files = make('div', { class: 'md-wt-group', role: 'group', 'aria-label': '打开与模板' });
    buildFileButtons(files);
    var createButton = makeFileButton('从模板创建 Markdown', 'templateGrid', function () {
      import('./document-create.mjs').then(function (module) { return module.openCreateMenu(createButton); }).catch(function (error) { fileStatus(error.message, true); });
    });
    createButton.setAttribute('id', 'create-markdown');
    files.appendChild(createButton);
    files.appendChild(makeFileButton('创建空文件', 'template', function () {
      window.mdCreateBlank().catch(function (error) { fileStatus(error.message, true); });
    }));
    toolbar.appendChild(files);
    toolbar.appendChild(buildGroup('撤销重做与查找替换', 'md-wt-group--history', HISTORY_ITEMS));
    var formatGroup = buildBasicFormatControl();
    appendItem(formatGroup, { icon: 'codeblock', label: '代码块', action: 'codeblock', insert: 'codeblock' });
    appendItem(formatGroup, { icon: 'formula', label: '公式块', action: 'formula', insert: 'formula' });
    toolbar.appendChild(formatGroup);
    toolbar.appendChild(buildGroup('插入', 'md-wt-group--insert', INSERT_ITEMS, 'images'));
    toolbar.appendChild(buildGroup('学术', 'md-wt-group--academic', ACADEMIC_ITEMS));

    var heading = editorPanel.querySelector('.panel-heading');
    // insertBefore(node, null/undefined) 追加到末尾，避免依赖 after()。
    if (heading) editorPanel.insertBefore(toolbar, heading.nextSibling);
    else editorPanel.insertBefore(toolbar, editorPanel.firstChild);

  }

  // 键盘工具条：左右方向键在按钮间移动，Home/End 到首尾。
  var ROVING_SELECTOR = 'button:not(.md-wt-menu-item), a.md-wt-button';
  function wireRovingTabindex(group) {
    var buttons = function () { return Array.prototype.filter.call(group.querySelectorAll(ROVING_SELECTOR), function (b) { return !b.disabled; }); };
    Array.prototype.forEach.call(group.querySelectorAll(ROVING_SELECTOR), function (b, i) { b.tabIndex = i === 0 ? 0 : -1; });
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
  //     按固定页面基准显示；iframe 回传适配后的实际比例，用户选择单独保留。
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
      var text = Math.round(percent) + '%';
      output.textContent = text;
      input.setAttribute('aria-valuetext', text);
      var minimum = Number(input.getAttribute('min'));
      var pos = clamp((percent - minimum) / (ZOOM_MAX - minimum) * 100, 0, 100);
      root.style.setProperty('--zoom-pos', pos + '%');
    }

    function set(percent) {
      var pct = clampZoom(percent);
      input.setAttribute('min', String(ZOOM_MIN));
      input.setAttribute('step', String(ZOOM_STEP));
      minLabel.textContent = ZOOM_MIN + '%';
      input.value = String(pct);
      render(pct);
      onZoom(pct);
    }

    input.addEventListener('pointerdown', function () { root.classList.remove('md-zoom-keyboard'); });
    input.addEventListener('pointerleave', function () { root.classList.remove('md-zoom-keyboard'); });
    input.addEventListener('keydown', function (event) {
      if (/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown)$/.test(event.key)) root.classList.add('md-zoom-keyboard');
      if (input.getAttribute('step') === 'any' && /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown)$/.test(event.key)) {
        event.preventDefault();
        set(Number(input.value) + (/^(ArrowLeft|ArrowDown)$/.test(event.key) ? -ZOOM_STEP : ZOOM_STEP));
      }
    });
    input.addEventListener('blur', function () { root.classList.remove('md-zoom-keyboard'); });
    input.addEventListener('input', function () { set(input.value); });
    input.addEventListener('change', function () {
      // iframe 回写实际比例后，松手不能把临时适配值变成用户期望值。
      if (input.getAttribute('step') !== 'any') set(input.value);
    });

    control.appendChild(input);
    control.appendChild(output);
    scale.appendChild(minLabel);
    scale.appendChild(maxLabel);
    root.appendChild(control);
    root.appendChild(scale);
    render(ZOOM_DEFAULT);
    function display(percent) {
      if (!isFinite(percent) || percent <= 0 || percent > ZOOM_MAX) return;
      var minimum = ZOOM_MIN;
      input.setAttribute('min', String(minimum));
      input.setAttribute('step', 'any');
      minLabel.textContent = minimum + '%';
      input.value = String(percent);
      render(percent);
    }
    return { root: root, input: input, output: output, set: set, display: display };
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

  // 标题和工具条使用同一列节奏；只更新几何量，不重新创建控件。
  function updatePanelGrid(panel) {
    var width = panel.clientWidth || panel.getBoundingClientRect().width;
    if (!width) return;
    var mobile = window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
    var tiny = window.matchMedia && window.matchMedia('(max-width: 390px)').matches;
    var button = 28;
    var inset = tiny ? 7 : mobile ? 8 : 10;
    var available = Math.max(button, width - inset * 2);
    var columns = Math.max(1, Math.round((available + 4) / (button + 4)));
    var gap = columns > 1 ? (available - columns * button) / (columns - 1) : 0;
    panel.style.setProperty('--panel-columns', String(columns));
    panel.style.setProperty('--panel-button', button + 'px');
    panel.style.setProperty('--panel-gap', gap + 'px');
    panel.style.setProperty('--panel-inset', inset + 'px');
    var empty = Math.max(0, available - button * 4 - gap * 2);
    var zoomWidth = Math.min(empty, empty * 0.3 + 62.334);
    panel.style.setProperty('--panel-zoom-width', zoomWidth + 'px');
    panel.style.setProperty('--panel-zoom-left', (inset + button + empty / 2) + 'px');
  }

  function updatePanelGrids() {
    updatePanelGrid(editorPanel);
    updatePanelGrid(previewPanel);
  }

  function observePanelGrids() {
    updatePanelGrids();
    if (window.ResizeObserver) {
      var observer = new window.ResizeObserver(updatePanelGrids);
      observer.observe(editorPanel);
      observer.observe(previewPanel);
    }
    window.addEventListener('resize', updatePanelGrids);
  }

  // 窄视口下按可见网页空间选择纵向面板高度；软键盘和浏览器地址栏变化时同步更新。
  var stackLayoutFrame = 0;
  function stackPanelMinimum(panel, bodySelector, minimumBodyHeight) {
    var body = panel.querySelector(bodySelector);
    var panelHeight = panel.getBoundingClientRect().height;
    var bodyHeight = body && body.getBoundingClientRect().height;
    if (!bodyHeight || !panelHeight) return 380;
    return Math.max(360, Math.ceil(panelHeight - bodyHeight + minimumBodyHeight));
  }

  function updateStackLayout() {
    var stacked = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
    if (!stacked || fullscreenMode()) {
      workspace.classList.remove('md-wt-stack-fit', 'md-wt-stack-scroll');
      return;
    }

    var viewportHeight = window.visualViewport && window.visualViewport.height || window.innerHeight;
    var topbar = document.querySelector('#app-topbar');
    var main = workspace.parentElement;
    var privacy = main && main.querySelector('.privacy');
    var mainStyle = main && window.getComputedStyle(main);
    var privacyStyle = privacy && window.getComputedStyle(privacy);
    var reserved = (topbar ? topbar.getBoundingClientRect().height : 0)
      + (mainStyle ? parseFloat(mainStyle.paddingTop) + parseFloat(mainStyle.paddingBottom) : 0);
    if (privacy && privacyStyle && !privacy.hidden) {
      reserved += privacy.getBoundingClientRect().height
        + parseFloat(privacyStyle.marginTop) + parseFloat(privacyStyle.marginBottom);
    }
    var available = Math.max(0, Math.floor(viewportHeight - reserved));
    var editorMinimum = stackPanelMinimum(editorPanel, '.cm-editor, #markdown', 180);
    var previewMinimum = stackPanelMinimum(previewPanel, '.preview-surface', 150);
    var minimum = Math.max(editorMinimum, previewMinimum);
    var fits = available >= minimum * 2 + 32;

    workspace.style.setProperty('--md-wt-stack-fit-height', available + 'px');
    workspace.style.setProperty('--md-wt-stack-panel-height', Math.max(minimum, available) + 'px');
    workspace.classList.toggle('md-wt-stack-fit', fits);
    workspace.classList.toggle('md-wt-stack-scroll', !fits);
  }

  function scheduleStackLayout() {
    if (stackLayoutFrame) return;
    stackLayoutFrame = window.requestAnimationFrame(function () {
      stackLayoutFrame = 0;
      updateStackLayout();
    });
  }

  function observeStackLayout() {
    updateStackLayout();
    window.addEventListener('resize', scheduleStackLayout);
    window.addEventListener('orientationchange', scheduleStackLayout);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleStackLayout);
    if (window.ResizeObserver) {
      var observer = new window.ResizeObserver(scheduleStackLayout);
      var topbar = document.querySelector('#app-topbar');
      var main = workspace.parentElement;
      var privacy = main && main.querySelector('.privacy');
      if (topbar) observer.observe(topbar);
      if (privacy) observer.observe(privacy);
      [editorPanel, previewPanel].forEach(function (panel) {
        Array.from(panel.children).forEach(function (child) {
          if (!child.classList.contains('cm-editor') && child.getAttribute('id') !== 'markdown'
            && !child.classList.contains('preview-surface')) observer.observe(child);
        });
      });
    }
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
    syncInput = buildSyncButton();
    syncInput.className += ' md-panel-sync';
    workspace.appendChild(syncInput);

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
      var offset = workspace.classList.contains('panels-reversed') ? rect.right - event.clientX : event.clientX - rect.left;
      var width = clamp(offset, MIN_EDITOR, rect.width - MIN_PREVIEW - DIVIDER);
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
      var step = workspace.classList.contains('panels-reversed') ? -24 : 24;
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
    if (mode === fullscreenMode()) return;
    var id = ++layoutRevision;
    clearTimeout(cursorTimer);
    suppressUntil = Date.now() + 1000;
    if (fullscreenMode() !== 'preview' && hasEditor() && window.mdEditor.captureViewport) lastEditorAnchor = window.mdEditor.captureViewport();
    var anchor = lastEditorAnchor;
    pendingLayout = { id: id, mode: mode, previous: fullscreenMode(), anchor: anchor };
    if (previewFrame && previewFrame.contentWindow) {
      previewFrame.contentWindow.postMessage({ type: 'md2pdf-capture-position', id: id }, '*');
      setTimeout(function () { finishFullscreen(id, null); }, 150);
    } else finishFullscreen(id, null);
  }

  function finishFullscreen(id, position) {
    if (!pendingLayout || pendingLayout.id !== id) return;
    var pending = pendingLayout;
    pendingLayout = null;
    if (pending.previous !== 'editor' && position) lastPreviewPosition = position;
    position = pending.previous === 'editor' ? lastPreviewPosition : position;
    var mode = pending.mode;
    var editorOn = mode === 'editor';
    var previewOn = mode === 'preview';
    workspace.classList.toggle(FOCUS_CLASS, editorOn);
    workspace.classList.toggle(PREVIEW_FOCUS_CLASS, previewOn);
    updateStackLayout();
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
    updatePanelModeButtons();
    if (editorOn) focusEditor();
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      if (id !== layoutRevision) return;
      updatePanelGrids();
      measureEditor();
      if (pending.anchor && window.mdEditor.restoreViewport) window.mdEditor.restoreViewport(pending.anchor);
      // 同步开启时，退出写作全屏以最新光标为准，不能恢复旧预览锚点。
      var followsCursor = syncInput && syncInput.checked && (pending.previous !== 'preview' || pending.mode === 'editor');
      if (!followsCursor && position && previewFrame.contentWindow) previewFrame.contentWindow.postMessage({ type: 'md2pdf-restore-position', position: position }, '*');
      if (syncInput && syncInput.checked) {
        if (position && Number.isSafeInteger(position.line) && position.line > 0 && pending.previous === 'preview' && pending.mode !== 'editor') {
          window.mdEditor.goToLine(position.line);
        } else if (pending.previous !== 'preview' || pending.mode === 'editor' || !position || !position.line) locateCurrentCursor(true);
      }
    }); });
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
    var button = make('button', { type: 'button', class: 'icon-button', 'data-panel-fullscreen': '', 'aria-pressed': 'false', 'aria-label': label, title: title });
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
    if (icon === 'save' || icon === 'open') button.title = label + '（' + (IS_MAC ? '⌘' : 'Ctrl+') + (icon === 'save' ? 'S' : 'O') + '）';
    button.addEventListener('click', action);
    return button;
  }

  function buildFileButtons(actions) {
    var input = make('input', { type: 'file', accept: '.md,.markdown,.mdown,text/markdown,text/plain', hidden: '' });
    openMarkdownInput = input;
    actions.appendChild(input);
    input.addEventListener('change', async function () {
      var file = input.files && input.files[0];
      input.value = ''; // 允许再次打开同一文件。
      if (!file) return;
      if (!/\.(md|markdown|mdown)$/i.test(file.name)) { fileStatus('请选择 Markdown 文件（.md）。', true); return; }
      try {
        var text = await file.text();
        if (!window.mdEditor || typeof window.mdEditor.setValue !== 'function') throw new Error('editor unavailable');
        text = text.replace(/^\uFEFF/, '');
        if (window.mdDrafts) await window.mdDrafts.openFile(text, file.name);
        else window.mdEditor.setValue(text);
        focusEditor();
      } catch (e) { fileStatus('无法读取 Markdown 文件，请重试。', true); }
    });
    var openButton = makeFileButton('打开 Markdown', 'open', function () {
      if (window.mdDrafts) window.mdDrafts.openMenu(openButton, input).catch(function (error) { fileStatus(error.message, true); });
      else input.click();
    });
    actions.appendChild(openButton);
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
  function updatePanelModeButtons() {
    var mode = fullscreenMode();
    if (editorModeBtn) editorModeBtn.title = mode ? '切换到预览' : '交换面板位置';
    if (previewModeBtn) previewModeBtn.title = mode ? '切换到 Markdown' : '交换面板位置';
    if (editorModeBtn) editorModeBtn.setAttribute('aria-label', 'Markdown（M）：' + editorModeBtn.title);
    if (previewModeBtn) previewModeBtn.setAttribute('aria-label', '预览（P）：' + previewModeBtn.title);
  }

  function switchPanelMode() {
    var mode = fullscreenMode();
    if (mode) { applyFullscreen(mode === 'editor' ? 'preview' : 'editor'); return; }
    var anchor = hasEditor() && window.mdEditor.captureViewport ? window.mdEditor.captureViewport() : null;
    if (!isNarrow()) {
      var rect = workspace.getBoundingClientRect();
      applyWidth(currentWidth(rect), rect.width, false);
    }
    workspace.classList.toggle('panels-reversed');
    requestAnimationFrame(function () {
      updatePanelGrids();
      measureEditor();
      if (anchor && window.mdEditor.restoreViewport) window.mdEditor.restoreViewport(anchor);
    });
  }

  function buildPanelModeButtons() {
    function attach(panel, text) {
      var heading = panel.querySelector('h2');
      if (!heading) return null;
      var button = make('button', { type: 'button', class: 'md-panel-mode' }, text);
      button.addEventListener('pointerdown', function (event) { event.preventDefault(); });
      button.addEventListener('click', switchPanelMode);
      heading.setAttribute('aria-label', text === 'M' ? 'Markdown' : '预览');
      heading.textContent = '';
      heading.appendChild(button);
      return button;
    }
    editorModeBtn = attach(editorPanel, 'M');
    previewModeBtn = attach(previewPanel, 'P');
    updatePanelModeButtons();
  }

  function buildFullscreenButtons() {
    var editorHeading = editorPanel.querySelector('.panel-heading');
    var previewHeading = previewPanel.querySelector('.panel-heading');
    var editorActions = editorHeading && editorHeading.querySelector('.panel-actions');
    var previewActions = previewHeading && previewHeading.querySelector('.panel-actions');

    editorFullscreenBtn = makeFullscreenButton('Markdown 全屏写作', '全屏写作（Esc 退出）');
    editorFullscreenBtn.addEventListener('click', function () { toggleFullscreen('editor'); });
    if (editorActions) {
      editorActions.appendChild(makeFileButton('下载 Markdown', 'save', saveMarkdown));
      editorActions.appendChild(editorFullscreenBtn);
    }
    var privacySave = document.querySelector('#privacy-save');
    if (privacySave) privacySave.addEventListener('click', saveMarkdown);

    previewFullscreenBtn = makeFullscreenButton('预览全屏', '全屏预览（Esc 退出）');
    previewFullscreenBtn.addEventListener('click', function () { toggleFullscreen('preview'); });
    if (previewActions) previewActions.appendChild(previewFullscreenBtn);
    var download = document.querySelector('#download');
    if (download) download.title = '下载 PDF（' + (IS_MAC ? '⌘P' : 'Ctrl+P') + '）';
    applyFullscreen(null); // 同步按钮初始 aria-pressed / title
  }

  // ---------------------------------------------------------------- 位置桥接
  function locateCurrentCursor(instant) {
    if (!hasEditor() || !previewFrame || !previewFrame.contentWindow) return;
    var line;
    try { line = window.mdEditor.getCursorLine(); } catch (e) { return; }
    if (!Number.isFinite(line)) return;
    postLocate(line, instant);
  }

  function postLocate(line, instant) {
    if (!previewFrame || !previewFrame.contentWindow) return;
    try { previewFrame.contentWindow.postMessage({ type: 'md2pdf-locate', line: line, instant: instant === true }, '*'); }
    catch (e) { /* 跨源异常忽略 */ }
  }

  function onCursor(event) {
    if (!ready || !syncInput || !syncInput.checked || fullscreenMode() === 'editor') return;
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
    // 基础格式面板属于编辑器上下文：焦点在菜单里时快捷键仍作用于编辑器选区。
    if (target.closest('.md-wt-basic-menu')) return true;
    if (target.closest('.md-wt-toolbar, .md-wt-details')) return false;
    var tag = (target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'SELECT') return false;
    if (tag === 'TEXTAREA') return target.id === 'markdown';
    return !!target.closest('.editor-panel');
  }

  // 物理键位判定：Shift 会改变 event.key（US 布局 ⇧7 → '&'、⇧. → '>'），
  // 因此数字与句点优先用 event.code，保证 Mac / Windows 各布局都命中同一动作。
  function digitFromEvent(event) {
    var match = /^Digit([0-9])$/.exec(event.code || '');
    if (match) return match[1];
    var key = event.key || '';
    return key >= '0' && key <= '9' ? key : null;
  }

  // 快捷键动作映射：沿用 CodeMirror / 浏览器既有约定（Mod+B/I/K；撤销重做与查找由内核 keymap
  // 提供），新增组合都刻意避开浏览器 / 系统保留键（Mod+L/P/T/W、⇧⌘4/5 截图、Firefox ⇧⌘M 等）。
  function shortcutAction(event) {
    var alt = event.altKey;
    var shift = event.shiftKey;
    var key = (event.key || '').toLowerCase();
    if (!alt && !shift) {
      if (key === 'b') return 'bold';
      if (key === 'i') return 'italic';
      if (key === 'k') return 'link';
      return null;
    }
    if (alt && !shift) {
      if (key === 's') return 'strikethrough';
      if (key === 'e') return 'codeblock';
      if (key === 'm') return 'formula';
      var digit = digitFromEvent(event);
      return digit === '1' || digit === '2' || digit === '3' ? 'h' + digit : null;
    }
    if (shift && !alt) {
      var shiftDigit = digitFromEvent(event);
      if (shiftDigit === '7') return 'ul-dash';
      if (shiftDigit === '8') return 'ul-dash';
      if (shiftDigit === '9') return 'ol';
      if (key === 'e') return 'code';
      if (key === 'x') return 'inline-math';
      if (key === '.' || key === '>' || event.code === 'Period') return 'quote';
      return null;
    }
    return null;
  }

  function onKeydown(event) {
    if (event.defaultPrevented) return;
    var docAction = documentShortcut && documentShortcut(event);
    if (docAction) { event.preventDefault(); runDocumentAction(docAction); return; }
    if (event.isComposing || event.keyCode === 229) return;   // 输入法组合中不拦截
    if (event.key === 'Escape' && basicMenu && !basicMenu.hidden) { event.preventDefault(); closeBasicMenu(true); return; }
    if (event.key === 'Escape' && fullscreenMode()) { applyFullscreen(null); return; }
    if (event.getModifierState && event.getModifierState('AltGraph')) return;
    if (!IS_MAC && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (event.key || '').toLowerCase() === 'y' && inEditorTarget(event.target)) {
      event.preventDefault();
      runCommand('redo');
      return;
    }
    var mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    var action = shortcutAction(event);
    if (!action) return;
    if (!hasTools() || !inEditorTarget(event.target)) return;
    event.preventDefault();
    runInsert(action);
  }

  function runDocumentAction(action) {
    if (action === 'save') saveMarkdown();
    else if (action === 'open' && openMarkdownInput) openMarkdownInput.click();
    else if (action === 'pdf') {
      var download = document.querySelector('#download');
      if (download && !download.disabled) download.click();
    }
  }
  window.addEventListener('message', function (event) {
    if (!previewFrame || event.source !== previewFrame.contentWindow || !event.data) return;
    if (event.data.type === 'md2pdf-position' && pendingLayout && event.data.id === pendingLayout.id) finishFullscreen(event.data.id, event.data.position);
    if (event.data.type === 'md2pdf-document-action' && ['save', 'open', 'pdf'].indexOf(event.data.action) >= 0) runDocumentAction(event.data.action);
  });

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
      if (!event.data) return;
      if (event.data.type === 'md2pdf-ready') sendPreviewZoom();
      else if (event.data.type === 'md2pdf-preview-zoom-state' && typeof event.data.zoom === 'number' && previewZoomControl) previewZoomControl.display(event.data.zoom);
    });
    function updateSearchButton() {
      var button = toolbar.querySelector('[aria-label="查找与替换"]');
      if (!button) return;
      var open = !!editorPanel.querySelector('.cm-search');
      button.setAttribute('aria-expanded', String(open));
      button.classList.toggle('is-active', open);
    }
    if (window.MutationObserver) new window.MutationObserver(updateSearchButton).observe(editorPanel, { childList: true, subtree: true });
    updateSearchButton();
    // 点击面板外部关闭「基础格式」面板；面板内部与触发器不触发。
    document.addEventListener('click', function (event) {
      if (!basicMenu || basicMenu.hidden) return;
      var target = event && event.target;
      if (basicWrap && basicWrap.contains && target && basicWrap.contains(target)) return;
      closeBasicMenu(false);
    });
    // 点击预览 iframe（独立文档）不会冒泡到父文档：窗口失焦时同样关闭面板。
    window.addEventListener('blur', function () { closeBasicMenu(false); });
    window.addEventListener('resize', function () {
      if (basicMenu && !basicMenu.hidden) positionBasicMenu();
      if (ratio == null || isNarrow() || fullscreenMode()) return;
      var rect = workspace.getBoundingClientRect();
      applyWidth(ratio * rect.width, rect.width, false);
    });
    // 已有 API 时立即就绪（脚本加载晚于内核的情况）。
    if (hasEditor() || hasTools()) onReady();
  }

  buildToolbar();
  buildDivider();
  buildFullscreenButtons();
  buildPanelModeButtons();
  buildZoomControls();
  restoreRatio();
  wireEvents();
  observePanelGrids();
  observeStackLayout();
  setEnabled(ready);
})();
