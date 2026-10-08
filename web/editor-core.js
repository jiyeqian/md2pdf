// md2pdf web editor — core (CodeMirror 6).
//
// Load order (all `defer`): editor-vendor.js -> editor-core.js -> editor-pro.js
// -> editor-workspace.js -> app.js.
//
// Contract:
// * The legacy textarea `#markdown` stays the canonical value holder. It is only
//   hidden after the enhanced editor initializes successfully; otherwise it is
//   left untouched as a plain fallback.
// * Programmatic writes to `textarea.value` are mirrored into CodeMirror through
//   an instance-level property override that calls the native descriptor, so no
//   recursion occurs.
// * Typed CodeMirror changes write back to the textarea via the native setter and
//   dispatch a bubbling `input` event, so app.js keeps working unchanged.
// * Document CustomEvents: `md-editor-ready` (once, no detail),
//   `md-editor-change` ({value}), `md-editor-cursor` ({line}).
// * Public API: window.mdEditor (see API below). No eval, no unsafe HTML.
//
// The file is a classic script (no import/export) and a valid ES module so the
// pure helpers below can be unit-tested under Node via dynamic import.

(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Pure helpers (exposed for tests; no DOM access).
  // ---------------------------------------------------------------------------

  function clamp(value, min, max) {
    if (typeof value !== 'number' || Number.isNaN(value)) return min;
    return Math.min(Math.max(Math.trunc(value), min), max);
  }

  // Clamp an arbitrary (from, to) pair into [0, length] and order it.
  function normalizeRange(length, from, to) {
    const max = Math.max(0, Number(length) || 0);
    let a = clamp(Number(from), 0, max);
    let b = to === undefined || to === null ? a : clamp(Number(to), 0, max);
    if (a > b) { const t = a; a = b; b = t; }
    return { from: a, to: b };
  }

  // 1-based line number containing `offset`; counts \n. Offset clamped to text.
  function offsetToLine(text, offset) {
    const source = typeof text === 'string' ? text : '';
    const at = clamp(Number(offset), 0, source.length);
    let line = 1;
    for (let i = 0; i < at; i++) if (source.charCodeAt(i) === 10) line++;
    return line;
  }

  // Character offset of the start of 1-based `line` (clamped to line count).
  function lineToOffset(text, line) {
    const source = typeof text === 'string' ? text : '';
    const total = source.length ? source.split('\n').length : 1;
    const target = clamp(Number(line), 1, total);
    if (target <= 1) return 0;
    let seen = 1;
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) {
        seen++;
        if (seen === target) return i + 1;
      }
    }
    return source.length;
  }

  function lineCount(text) {
    const source = typeof text === 'string' ? text : '';
    if (!source.length) return 1;
    let count = 1;
    for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) count++;
    return count;
  }

  const helpers = { clamp, normalizeRange, offsetToLine, lineToOffset, lineCount };
  global.mdEditorCoreHelpers = helpers;

  // ---------------------------------------------------------------------------
  // Browser-only initialization.
  // ---------------------------------------------------------------------------

  if (!global.document || typeof global.document.querySelector !== 'function') return;

  function boot() {
    const textarea = global.document.querySelector('#markdown');
    const V = global.MDEditorVendor;
    if (!textarea || !V || !V.EditorView) return; // keep the plain textarea fallback

    // Only one instance per page.
    if (global.mdEditor && global.mdEditor.__mounted) return;

    const doc = global.document;
    const host = doc.createElement('div');
    const toolbar = doc.createElement('div');
    const editorHost = doc.createElement('div');
    host.className = 'md-editor';
    toolbar.className = 'md-editor-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '编辑器工具栏');
    editorHost.className = 'md-editor-host';

    const completionCompartment = new V.Compartment();
    let completionProvider = null;
    let view = null;
    let ready = false;
    let lastCursorLine = -1;

    // ---- completion bridge (setCompletions API) ----
    function completionSource(context) {
      if (!completionProvider) return null;
      const text = context.state.doc.toString();
      let result;
      try { result = completionProvider({ text, pos: context.pos }); }
      catch { return null; }
      if (!result || typeof result !== 'object' || !Array.isArray(result.options)) return null;
      const options = result.options
        .filter(option => option && typeof option.label === 'string')
        .map(option => {
          const mapped = { label: option.label };
          if (option.type !== undefined) mapped.type = option.type;
          if (option.detail !== undefined) mapped.detail = option.detail;
          if (typeof option.apply === 'string') mapped.apply = option.apply;
          return mapped;
        });
      if (!options.length) return null;
      const from = Number.isFinite(result.from) ? clamp(result.from, 0, text.length) : context.pos;
      const to = Number.isFinite(result.to) ? clamp(result.to, from, text.length) : context.pos;
      // The provider filters IDs; the replacement range may include a closing delimiter.
      return { from, to, options, filter: false };
    }

    // ---- default Markdown language (with fenced code highlighting) ----
    const sqlLanguage = V.sql().language;
    const codeLanguageNames = {
      md: V.markdownLanguage, markdown: V.markdownLanguage,
      js: V.javascriptLanguage, javascript: V.javascriptLanguage, node: V.javascriptLanguage, mjs: V.javascriptLanguage, cjs: V.javascriptLanguage,
      jsx: V.jsxLanguage, ts: V.typescriptLanguage, typescript: V.typescriptLanguage, tsx: V.tsxLanguage,
      html: V.htmlLanguage, htm: V.htmlLanguage, xml: V.xmlLanguage, svg: V.xmlLanguage,
      css: V.cssLanguage, json: V.jsonLanguage, jsonc: V.jsonLanguage,
      py: V.pythonLanguage, python: V.pythonLanguage,
      java: V.javaLanguage, cpp: V.cppLanguage, 'c++': V.cppLanguage, c: V.cppLanguage, h: V.cppLanguage, hpp: V.cppLanguage,
      rust: V.rustLanguage, rs: V.rustLanguage, php: V.phpLanguage,
      sql: sqlLanguage, yaml: V.yamlLanguage, yml: V.yamlLanguage,
    };
    function codeLanguageFor(info) {
      const name = String(info || '').toLowerCase();
      return codeLanguageNames[name] || null;
    }

    const markdownSupport = V.markdown({ base: V.markdownLanguage, codeLanguages: codeLanguageFor });

    const highlightStyle = V.HighlightStyle.define([
      { tag: V.tags.heading, color: '#233e60', fontWeight: '700' },
      { tag: V.tags.strong, fontWeight: '700' },
      { tag: V.tags.emphasis, fontStyle: 'italic' },
      { tag: V.tags.strikethrough, textDecoration: 'line-through' },
      { tag: V.tags.link, color: '#42648b', textDecoration: 'underline' },
      { tag: V.tags.url, color: '#8290a2' },
      { tag: V.tags.monospace, color: '#9a3b5c' },
      { tag: V.tags.keyword, color: '#8a4baf' },
      { tag: V.tags.string, color: '#2f7a4f' },
      { tag: V.tags.comment, color: '#8290a2', fontStyle: 'italic' },
      { tag: V.tags.number, color: '#b1650a' },
      { tag: V.tags.bool, color: '#b1650a' },
      { tag: V.tags.typeName, color: '#1f6f8b' },
      { tag: V.tags.quote, color: '#63798f', fontStyle: 'italic' },
      { tag: V.tags.list, color: '#42648b' },
    ]);

    const theme = V.EditorView.theme({
      '&': { height: '100%', fontSize: '13px', backgroundColor: '#fff', color: '#35445a' },
      '.cm-scroller': { fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,"PingFang SC","Microsoft YaHei",monospace', lineHeight: '1.8', overflow: 'auto' },
      '.cm-content': { padding: '18px 20px', caretColor: '#233e60' },
      '.cm-gutters': { backgroundColor: '#f7f8fa', color: '#9aa6b6', border: 'none', borderRight: '1px solid #edf0f4' },
      '.cm-activeLine': { backgroundColor: '#f4f7fb' },
      '.cm-activeLineGutter': { backgroundColor: '#eef2f8', color: '#42648b' },
      '.cm-selectionBackground, ::selection': { backgroundColor: '#cfe0f4' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#233e60' },
      '&.cm-focused .cm-selectionBackground, &.cm-focused ::selection': { backgroundColor: '#bcd6f2' },
      '.cm-foldPlaceholder': { backgroundColor: '#eef2f8', border: '1px solid #dbe4f0', color: '#42648b', padding: '0 6px', borderRadius: '4px' },
    }, { dark: false });

    // ---- textarea bridge ----
    const nativeValue = Object.getOwnPropertyDescriptor(global.HTMLTextAreaElement.prototype, 'value');

    function writeTextarea(value) {
      if (nativeValue && nativeValue.set && textarea.value !== value) nativeValue.set.call(textarea, value);
    }

    function emitInput() {
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function emitChange(value) {
      doc.dispatchEvent(new CustomEvent('md-editor-change', { detail: { value } }));
    }

    function emitCursor(line) {
      if (line === lastCursorLine) return;
      lastCursorLine = line;
      doc.dispatchEvent(new CustomEvent('md-editor-cursor', { detail: { line } }));
    }

    // Replace the whole document. `resetHistory` builds a fresh state (clears
    // undo history) for programmatic load/restore; used by setValue and by
    // external textarea writes.
    function setDocument(text, resetHistory, notifyInput = true) {
      const next = typeof text === 'string' ? text : String(text == null ? '' : text);
      if (!view) return;
      if (resetHistory) {
        const state = V.EditorState.create({ doc: next, extensions: extensions });
        view.setState(state);
        writeTextarea(next);
        emitChange(next);
        emitCursor(1);
        if (notifyInput) emitInput();
      } else {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
      }
    }

    // ---- update listener ----
    const updateListener = V.EditorView.updateListener.of(function (update) {
      if (update.docChanged) {
        const value = update.state.doc.toString();
        writeTextarea(value);
        emitChange(value);
        emitInput();
      }
      emitCursor(update.state.doc.lineAt(update.state.selection.main.head).number);
    });

    const keymap = V.keymap.of([
      ...V.closeBracketsKeymap,
      ...V.defaultKeymap,
      ...V.searchKeymap,
      ...V.historyKeymap,
      ...V.foldKeymap,
      ...V.completionKeymap,
      V.indentWithTab,
    ]);

    let extensions = [
      V.EditorState.phrases.of({
        'Find': '查找内容', 'Replace': '替换为', 'next': '下一处', 'previous': '上一处',
        'all': '选择全部', 'match case': '区分大小写', 'regexp': '正则表达式',
        'by word': '完整词', 'replace': '替换当前', 'replace all': '全部替换',
        'close': '关闭查找', 'No matches found': '未找到匹配内容',
        'Fold line': '折叠行', 'Unfold line': '展开行', 'folded code': '已折叠内容',
        'Completions': '补全建议',
      }),
      V.lineNumbers(),
      V.highlightActiveLineGutter(),
      V.highlightActiveLine(),
      V.highlightSpecialChars(),
      V.history(),
      V.drawSelection(),
      V.dropCursor(),
      V.rectangularSelection(),
      V.crosshairCursor(),
      V.indentOnInput(),
      V.bracketMatching(),
      V.closeBrackets(),
      V.highlightSelectionMatches(),
      completionCompartment.of(V.autocompletion({ override: [completionSource], activateOnTyping: true })),
      markdownSupport,
      V.syntaxHighlighting(V.defaultHighlightStyle, { fallback: true }),
      V.syntaxHighlighting(highlightStyle),
      V.EditorView.lineWrapping,
      V.EditorView.contentAttributes.of({
        'aria-label': 'Markdown 正文编辑器',
        'aria-multiline': 'true',
        'spellcheck': 'false',
        'autocapitalize': 'off',
      }),
      theme,
      updateListener,
      keymap,
    ];

    // ---- public API ----
    const commands = {
      undo: function () { return V.undo(view); },
      redo: function () { return V.redo(view); },
      find: function () { return V.openSearchPanel(view); },
      replace: function () { return V.openSearchPanel(view); },
      fold: function () { return V.foldCode(view); },
      unfold: function () { return V.unfoldCode(view); },
    };

    function runCommand(name) {
      const command = commands[name];
      if (!command) return false;
      try { return command() !== false; } catch { return false; }
    }

    const api = {
      __mounted: true,
      getValue: function () { return view.state.doc.toString(); },
      setValue: function (text) { setDocument(text, true); },
      focus: function () { view.focus(); },
      getSelection: function () {
        const range = view.state.selection.main;
        return { from: range.from, to: range.to, text: view.state.sliceDoc(range.from, range.to) };
      },
      replaceSelection: function (text) {
        const range = view.state.selection.main;
        view.dispatch({ changes: { from: range.from, to: range.to, insert: String(text == null ? '' : text) } });
      },
      replaceRange: function (from, to, text) {
        const range = normalizeRange(view.state.doc.length, from, to);
        view.dispatch({ changes: { from: range.from, to: range.to, insert: String(text == null ? '' : text) } });
      },
      replaceRanges: function (changes) {
        view.dispatch({ changes: changes.map(function (change) {
          const range = normalizeRange(view.state.doc.length, change.from, change.to);
          return { from: range.from, to: range.to, insert: String(change.insert) };
        }) });
      },
      setSelection: function (from, to) {
        const range = normalizeRange(view.state.doc.length, from, to === undefined ? from : to);
        view.dispatch({ selection: { anchor: range.from, head: range.to }, scrollIntoView: true });
      },
      goToLine: function (line) {
        const target = clamp(Number(line), 1, view.state.doc.lines);
        const info = view.state.doc.line(target);
        view.dispatch({ selection: { anchor: info.from }, scrollIntoView: true });
      },
      getCursorLine: function () { return view.state.doc.lineAt(view.state.selection.main.head).number; },
      runCommand: runCommand,
      setCompletions: function (provider) {
        completionProvider = typeof provider === 'function' ? provider : null;
        view.dispatch({ effects: completionCompartment.reconfigure(V.autocompletion({ override: completionProvider ? [completionSource] : [], activateOnTyping: true })) });
      },
    };

    // ---- toolbar (accessible Chinese labels) ----
    const toolbarButtons = [
      { label: '撤销', command: 'undo' },
      { label: '重做', command: 'redo' },
      { label: '查找', command: 'find' },
      { label: '替换', command: 'replace' },
      { label: '折叠', command: 'fold' },
      { label: '展开', command: 'unfold' },
    ];
    for (const item of toolbarButtons) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'md-editor-button';
      button.textContent = item.label;
      button.setAttribute('aria-label', item.label);
      button.addEventListener('click', function () { runCommand(item.command); if (item.command !== 'find' && item.command !== 'replace') view.focus(); });
      toolbar.append(button);
    }

    // ---- mount ----
    try {
      view = new V.EditorView({
        state: V.EditorState.create({ doc: textarea.value, extensions: extensions }),
        parent: editorHost,
      });
    } catch (error) {
      // Leave the textarea as the fallback; do not hide it.
      if (global.console && global.console.warn) global.console.warn('[md2pdf] 编辑器初始化失败，已回退到纯文本编辑区：', error);
      return;
    }

    host.append(toolbar, editorHost);
    // Search fields otherwise commit on keyup/change, missing paste and IME input updates.
    editorHost.addEventListener('input', function (event) {
      if (event.target.matches('.cm-search input.cm-textfield')) event.target.dispatchEvent(new Event('change'));
    });
    textarea.parentNode.insertBefore(host, textarea.nextSibling);

    // Install the value bridge before hiding, so any later writes are captured.
    if (nativeValue && nativeValue.get && nativeValue.set) {
      Object.defineProperty(textarea, 'value', {
        configurable: true,
        enumerable: true,
        get: function () { return nativeValue.get.call(this); },
        set: function (next) {
          const text = typeof next === 'string' ? next : String(next == null ? '' : next);
          nativeValue.set.call(this, text);
          // Native textarea.value assignments are silent; boot's revision guards depend on that.
          if (view && view.state.doc.toString() !== text) setDocument(text, true, false);
        },
      });
    }

    textarea.classList.add('md-editor-source');
    textarea.hidden = true;

    global.mdEditor = api;
    ready = true;

    // Announce readiness after the remaining deferred scripts (pro/workspace/app)
    // have executed and attached their listeners.
    setTimeout(function () {
      if (ready) doc.dispatchEvent(new CustomEvent('md-editor-ready'));
    }, 0);
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
