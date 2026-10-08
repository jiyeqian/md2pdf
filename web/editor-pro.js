// md2pdf web editor — 专业助手（ES module）
//
// 归属：本模块只提供「专业写作辅助」：编辑器标题下方的可折叠面板（大纲 / 引用与
// 章节检查 / 状态）以及 window.mdEditorTools.insert(name) 插入工具。
// 依赖：纯分析模块 editor-analysis.mjs、编辑器内核 window.mdEditor。不修改二者。
//
// 约定（内核 editor-core.js）：
//   window.mdEditor {getValue,setValue,focus,getSelection,replaceSelection,
//                    replaceRange,setSelection,goToLine,getCursorLine,runCommand,setCompletions}
//   document 事件 md-editor-ready、md-editor-change(detail.value)、md-document-type(detail.type)
//
// 重要：所有编辑动作只用可撤销的 replaceRange / replaceSelection，绝不调用 setValue
//       （setValue 会重建编辑器状态、清空撤销历史）。

import {
  analyzeMarkdown,
  renderSnippet,
  provideCompletions,
} from './editor-analysis.mjs';

const MAX_OUTLINE = 150;        // 大纲最多渲染条目
const MAX_DIAGNOSTICS = 50;     // 诊断最多渲染条目
const ANALYZE_DEBOUNCE = 200;   // 输入后分析节流（ms）

const NO_COMPLIANCE = '本面板仅做 Markdown 书写一致性检查（大纲、引用目标、手写章节号），不对任何标准的符合性作结论。';
const GB_ADVISORY = '手写章节号提示为书写一致性建议，仅供参考；不会改动你的原文。';

const TYPE_LABELS = {
  auto: '自动识别', general: '通用文档', readme: 'README', skill: '技能文档',
  paper: '论文', gb: '国家标准', '': '自动识别',
};

// 片段：插入时的可选默认占位值与插入后要选中的占位正文。
const BLOCK_VALUES = {
  table: { title: '表格标题' },
  figure: { title: '图题' },
  'gb-scope': { subject: '本文件规定的对象' },
  'gb-terms': { title: '术语', definition: '术语定义' },
  'gb-appendix': { letter: 'A', title: '附录标题', content: '附录内容' },
  skill: { title: '命令名' },
};
const BLOCK_SELECT = {
  table: '表格标题', figure: '图题', 'gb-scope': '本文件规定的对象',
  'gb-terms': '术语', 'gb-appendix': '附录标题', skill: '命令名', formula: null,
};

const HEADING_MARK = /^(#{1,6})[ \t]+/;

let api = null;
let initialized = false;
let latestAnalysis = null;
let currentType = '';
let renderTimer = null;
let panel = null;
let refs = null;

// ------------------------------------------------------------------ 基础工具

function getApi() {
  if (api && api.__mounted) return api;
  const candidate = typeof window !== 'undefined' ? window.mdEditor : null;
  if (candidate && candidate.__mounted) api = candidate;
  return api;
}

function analyzeValue(value) {
  try { return analyzeMarkdown(value == null ? '' : String(value)); }
  catch (err) { return null; }
}

function coreHelpers() {
  return (typeof window !== 'undefined' && window.mdEditorCoreHelpers) || null;
}

function frontmatterOf(text) {
  const m = /^(?:---|\+\+\+)\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text || '');
  return m ? m[1] : null;
}

// 显式表单值优先；缺失时退回到内容标记（仅作建议，不代表任何符合性结论）。
function inferType(value, explicit) {
  if (explicit) return explicit;
  const text = value || '';
  const fm = frontmatterOf(text);
  if (fm && /^\s*name\s*:/m.test(fm)) return 'skill';
  if (/GB\/T\s|标准号|^#\s*前言/m.test(text)) return 'gb';
  if (/^#\s*README\b/m.test(text) || /\bREADME\b/.test(text)) return 'readme';
  if (/(?:^|\n)#\s/m.test(text) && /摘要|关键词|Abstract|参考文献/.test(text)) return 'paper';
  return 'general';
}

function formTypeValue() {
  if (typeof document === 'undefined') return '';
  const field = document.querySelector('#options select[name="type"]');
  return field && typeof field.value === 'string' ? field.value : '';
}

// 当前文档中已占用的 ID（定义 + 脚注），供插入时去重。
function collectTaken() {
  const editor = getApi();
  if (!editor) return new Set();
  const analysis = analyzeValue(editor.getValue());
  const taken = new Set();
  if (analysis) {
    for (const target of analysis.targets) taken.add(target.id);
    for (const note of analysis.footnotes) taken.add(note.id);
  }
  return taken;
}

function selectRange(from, to) {
  const editor = getApi();
  if (!editor) return;
  editor.setSelection(from, to);
  editor.focus();
}

// ---------------------------------------------------------------- 编辑动作
// 全部走 replaceRange / replaceSelection，保证单步可撤销。

function wrapSelection(sel, open, close, placeholder) {
  const editor = getApi();
  if (sel.text) {
    editor.replaceRange(sel.from, sel.to, open + sel.text + close);
    selectRange(sel.from + open.length, sel.from + open.length + sel.text.length);
  } else {
    editor.replaceRange(sel.from, sel.from, open + placeholder + close);
    selectRange(sel.from + open.length, sel.from + open.length + placeholder.length);
  }
}

function insertLink(sel) {
  const editor = getApi();
  const url = 'https://';
  if (sel.text) {
    editor.replaceRange(sel.from, sel.to, '[' + sel.text + '](' + url + ')');
    const start = sel.from + 1 + sel.text.length + 2;
    selectRange(start, start + url.length);
  } else {
    const rendered = renderSnippet('link', { title: '链接文字' });
    editor.replaceRange(sel.from, sel.from, rendered.text);
    selectRange(sel.from + 1, sel.from + 1 + '链接文字'.length);
  }
}

// 标题 / 引用块：按行变换（不依赖 renderSnippet，避免把记号塞进段落中间）。
function transformLines(sel, kind) {
  const editor = getApi();
  const H = coreHelpers();
  if (!H) return;
  const value = editor.getValue();
  const startLine = H.offsetToLine(value, sel.from);
  let endLine = H.offsetToLine(value, sel.to);
  if (sel.to > sel.from && sel.to === H.lineToOffset(value, endLine)) endLine -= 1;
  if (endLine < startLine) endLine = startLine;

  const lines = value.split('\n');
  const block = lines.slice(startLine - 1, endLine);
  const quoting = kind === 'quote'
    && block.some(function (line) { return /^\s*>\s?/.test(line); });

  const transformed = block.map(function (line) {
    if (kind === 'heading') {
      return HEADING_MARK.test(line)
        ? '## ' + line.replace(HEADING_MARK, '')
        : '## ' + line;
    }
    return quoting ? line.replace(/^\s*>\s?/, '') : '> ' + line;
  });

  const from = H.lineToOffset(value, startLine);
  const lastStart = H.lineToOffset(value, endLine);
  const to = lastStart + (lines[endLine - 1] == null ? 0 : lines[endLine - 1].length);

  editor.replaceRange(from, to, transformed.join('\n'));
  if (sel.to > sel.from) {
    selectRange(from, from + transformed.join('\n').length);
  } else {
    const marker = kind === 'heading' ? 3 : 2; // '## ' / '> '
    selectRange(from + marker, from + marker);
  }
}

function insertBlock(name, sel) {
  const editor = getApi();
  const rendered = renderSnippet(name, BLOCK_VALUES[name] || {}, { taken: collectTaken() });
  editor.replaceRange(sel.from, sel.to, rendered.text);
  const body = BLOCK_SELECT[name];
  if (body) {
    const at = rendered.text.indexOf(body);
    if (at >= 0) selectRange(sel.from + at, sel.from + at + body.length);
    else selectRange(sel.from, sel.from);
  } else {
    selectRange(sel.from, sel.from);
  }
}

function insertCodeBlock(sel) {
  const editor = getApi();
  const body = sel.text || '代码内容';
  const longest = (body.match(/`+/g) || []).reduce((n, run) => Math.max(n, run.length), 2);
  const fence = '`'.repeat(longest + 1);
  const before = editor.getValue().slice(0, sel.from);
  const prefix = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const opening = prefix + fence + 'text\n';
  editor.replaceRange(sel.from, sel.to, opening + body + '\n' + fence + '\n\n');
  selectRange(sel.from + opening.length, sel.from + opening.length + body.length);
}

// 脚注 / 参考文献：光标处插入引用，文末追加定义，不覆盖既有文本。
function insertDefinition(name, sel, bodyText) {
  const editor = getApi();
  const rendered = renderSnippet(name, name === 'footnote' ? { note: bodyText } : {}, { taken: collectTaken() });
  const parts = rendered.text.split('\n\n');
  const reference = parts[0].replace(/\s+$/, '') + ' ';
  const definition = parts.slice(1).join('\n\n').replace(/\n?$/, '\n');

  const before = editor.getValue();
  const atRef = sel.to;
  const after = before.slice(0, atRef) + reference + before.slice(atRef);
  const prefix = after.endsWith('\n\n') ? '' : after.endsWith('\n') ? '\n' : '\n\n';
  const at = after.length;
  // Both insertions share one transaction, including when the cursor is mid-document.
  if (atRef === before.length) editor.replaceRange(atRef, atRef, reference + prefix + definition);
  else editor.replaceRanges([
    { from: atRef, to: atRef, insert: reference },
    { from: before.length, to: before.length, insert: prefix + definition },
  ]);

  const defStart = at + prefix.length;
  const bodyAt = definition.indexOf(bodyText);
  if (bodyAt >= 0) selectRange(defStart + bodyAt, defStart + bodyAt + bodyText.length);
  else selectRange(atRef + reference.length, atRef + reference.length);
}

// 技能片段：只插入正文章节骨架，绝不把 frontmatter 塞进文档中间或重复插入。
function insertSkill(sel) {
  const editor = getApi();
  const value = editor.getValue();
  const rendered = renderSnippet('skill', BLOCK_VALUES.skill, {});
  let text = rendered.text;

  const hasFrontmatter = frontmatterOf(value) !== null;
  const atStart = sel.from === 0 && sel.to === 0;
  if (!hasFrontmatter && atStart) {
    text = '---\nname: 技能名称\ndescription: 一句话说明技能用途\n---\n\n' + text;
  } else if (!hasFrontmatter) {
    if (window.console && window.console.info) {
      window.console.info('[md2pdf] 技能片段未插入 frontmatter：YAML 头只能位于文件首行，当前光标不在文档开头。请在首行手动补上 --- name/description ---。');
    }
  }

  editor.replaceRange(sel.from, sel.to, text);
  const at = text.indexOf('命令名');
  if (at >= 0) selectRange(sel.from + at, sel.from + at + '命令名'.length);
  else selectRange(sel.from, sel.from);
}

function insert(name) {
  const editor = getApi();
  if (!editor || typeof name !== 'string') return false;
  const sel = editor.getSelection();
  try {
    switch (name) {
      case 'bold': wrapSelection(sel, '**', '**', '加粗文字'); break;
      case 'italic': wrapSelection(sel, '*', '*', '斜体文字'); break;
      case 'code': wrapSelection(sel, '\u0060', '\u0060', 'code'); break;
      case 'link': insertLink(sel); break;
      case 'heading': transformLines(sel, 'heading'); break;
      case 'quote': transformLines(sel, 'quote'); break;
      case 'footnote': insertDefinition('footnote', sel, '注释内容'); break;
      case 'bibliography': insertDefinition('bibliography', sel, '文献标题'); break;
      case 'skill': insertSkill(sel); break;
      case 'codeblock': insertCodeBlock(sel); break;
      default: insertBlock(name, sel); break;
    }
  } catch (err) {
    if (window.console && window.console.warn) window.console.warn('[md2pdf] 插入失败：', name, err);
    return false;
  }
  scheduleAnalysis();
  return true;
}

// ------------------------------------------------------------------- 面板 UI

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function buildPanel() {
  const editorPanel = document.querySelector('.editor-panel');
  if (!editorPanel) return false;

  const details = el('details', 'md-pro-panel');
  const summary = el('summary', 'md-pro-summary');
  summary.append(el('span', 'md-pro-summary-title', '专业助手 · 大纲与引用检查'));
  const meta = el('span', 'md-pro-summary-meta', '');
  summary.append(meta);
  details.append(summary);

  const body = el('div', 'md-pro-body');
  const status = el('p', 'md-pro-status', '');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const typeLine = el('p', 'md-pro-type', '');
  const note = el('p', 'md-pro-note', NO_COMPLIANCE);

  const outlineSection = el('section', 'md-pro-section');
  const outlineHead = el('div', 'md-pro-section-head');
  outlineHead.append(el('h3', null, '文档大纲'), el('span', 'md-pro-count', ''));
  const outlineList = el('div', 'md-pro-outline');
  outlineSection.append(outlineHead, outlineList);

  const diagSection = el('section', 'md-pro-section');
  const diagHead = el('div', 'md-pro-section-head');
  diagHead.append(el('h3', null, '引用与章节检查'), el('span', 'md-pro-count', ''));
  const diagList = el('div', 'md-pro-diags');
  const diagNote = el('p', 'md-pro-note md-pro-advisory', GB_ADVISORY);
  diagSection.append(diagHead, diagList, diagNote);

  body.append(typeLine, status, note, outlineSection, diagSection);
  details.append(body);

  // 点击按钮时不让面板抢走编辑器选区。
  details.addEventListener('mousedown', function (event) {
    if (event.target && event.target.closest('button')) event.preventDefault();
  });

  const heading = editorPanel.querySelector('.panel-heading');
  const toolbar = editorPanel.querySelector('.md-wt-toolbar');
  if (toolbar) toolbar.insertAdjacentElement('afterend', details);
  else if (heading) heading.insertAdjacentElement('afterend', details);
  else editorPanel.insertBefore(details, editorPanel.firstChild);

  panel = details;
  refs = {
    meta: meta,
    status: status,
    typeLine: typeLine,
    outlineCount: outlineHead.querySelector('.md-pro-count'),
    outlineList: outlineList,
    diagCount: diagHead.querySelector('.md-pro-count'),
    diagList: diagList,
    diagNote: diagNote,
  };
  return true;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function renderOutline(analysis) {
  const list = refs.outlineList;
  clear(list);
  const headings = analysis ? analysis.headings : [];
  const shown = headings.slice(0, MAX_OUTLINE);
  if (!shown.length) {
    list.append(el('p', 'md-pro-empty', '暂无标题。用“## 标题”或工具栏“标题”按钮添加章节。'));
  } else {
    for (const heading of shown) {
      const level = Math.min(Math.max(heading.level, 1), 6);
      const button = el('button', 'md-pro-outline-item md-pro-lv' + level);
      button.type = 'button';
      button.title = '跳到第 ' + heading.line + ' 行';
      button.textContent = 'H' + heading.level + '  ' + (heading.text || '(无标题)');
      button.addEventListener('click', function () {
        const editor = getApi();
        if (editor) { editor.goToLine(heading.line); editor.focus(); }
      });
      list.append(button);
    }
  }
  refs.outlineCount.textContent = headings.length + ' 条'
    + (headings.length > MAX_OUTLINE ? '（显示前 ' + MAX_OUTLINE + '）' : '');
}

function renderDiagnostics(analysis) {
  const list = refs.diagList;
  clear(list);
  const diagnostics = analysis ? analysis.diagnostics : [];
  const shown = diagnostics.slice(0, MAX_DIAGNOSTICS);
  let advisory = false;
  if (!shown.length) {
    list.append(el('p', 'md-pro-empty', '未发现引用或章节号问题。'));
  } else {
    for (const diag of shown) {
      const severity = diag.severity === 'warning' ? 'warning' : 'info';
      if (diag.code === 'heading-number' || diag.code === 'heading-number-missing') advisory = true;
      const row = el('div', 'md-pro-diag md-pro-diag-' + severity);
      const line = Number.isFinite(diag.line) && diag.line > 0 ? diag.line : null;
      if (line) {
        const button = el('button', 'md-pro-diag-link');
        button.type = 'button';
        button.title = '跳到第 ' + line + ' 行';
        button.textContent = diag.message;
        button.addEventListener('click', function () {
          const editor = getApi();
          if (editor) { editor.goToLine(line); editor.focus(); }
        });
        row.append(button);
        row.append(el('span', 'md-pro-diag-line', '第 ' + line + ' 行'));
      } else {
        row.append(el('span', 'md-pro-diag-text', diag.message));
      }
      list.append(row);
    }
  }
  refs.diagCount.textContent = diagnostics.length + ' 条'
    + (diagnostics.length > MAX_DIAGNOSTICS ? '（显示前 ' + MAX_DIAGNOSTICS + '）' : '');
  refs.diagNote.hidden = !advisory;
}

function render() {
  if (!panel || !refs) return;
  const analysis = latestAnalysis;
  const counts = analysis ? analysis.counts : { headings: 0, targets: 0, occurrences: 0, diagnostics: 0, truncated: false };
  refs.typeLine.textContent = '文档类型：' + (TYPE_LABELS[currentType] || currentType || '自动识别');
  refs.status.textContent = '标题 ' + counts.headings + ' · 引用目标 ' + counts.targets
    + ' · 引用出现 ' + counts.occurrences + ' · 检查项 ' + counts.diagnostics
    + (counts.truncated ? '（诊断已截断）' : '');
  refs.meta.textContent = (TYPE_LABELS[currentType] || currentType || '自动识别') + ' · ' + counts.diagnostics + ' 项检查';
  renderOutline(analysis);
  renderDiagnostics(analysis);
}

function scheduleAnalysis() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(function () {
    const editor = getApi();
    if (!editor) return;
    latestAnalysis = analyzeValue(editor.getValue());
    if (!currentType) currentType = inferType(editor.getValue(), formTypeValue());
    render();
  }, ANALYZE_DEBOUNCE);
}

// --------------------------------------------------------------------- 初始化

function init() {
  if (initialized) return;
  const editor = getApi();
  if (!editor) return;
  initialized = true;

  if (!buildPanel()) return;

  const value = editor.getValue();
  latestAnalysis = analyzeValue(value);
  currentType = inferType(value, formTypeValue());

  // 补全使用「当前文本」实时分析，避免节流导致候选过期。
  if (typeof editor.setCompletions === 'function') {
    editor.setCompletions(function (context) {
      latestAnalysis = analyzeValue(context.text);
      return provideCompletions(context, latestAnalysis);
    });
  }

  document.addEventListener('md-editor-change', function (event) {
    const next = event && event.detail ? event.detail.value : null;
    scheduleAnalysis();
    if (typeof next === 'string') latestAnalysis = analyzeValue(next); // 立即反映当前值
  });
  document.addEventListener('md-document-type', function (event) {
    const type = event && event.detail ? event.detail.type : '';
    if (typeof type === 'string') { currentType = type; render(); }
  });

  render();
  scheduleAnalysis();
}

if (typeof window !== 'undefined') {
  // 工具条接口：尽早暴露，实际动作在编辑器就绪后生效。
  window.mdEditorTools = window.mdEditorTools || {};
  window.mdEditorTools.insert = insert;
}

if (typeof document !== 'undefined') {
  document.addEventListener('md-editor-ready', init);
  // 内核可能已就绪（脚本加载顺序不同）：立即尝试。
  if (getApi()) init();
}
