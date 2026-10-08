/**
 * md2pdf 专业辅助 · 纯解析模块
 *
 * 只做文本分析，不触碰 DOM / window，可在 Node（测试）与浏览器（ES module）共用。
 * 关注四件事：
 *   1. 章节大纲（忽略 frontmatter 与围栏代码块里的伪标题）
 *   2. 交叉引用目标与出现位置（\ref{} / \eqref{} / \label{} / {#fig:} / {#tab:}）
 *   3. 脚注与 BibTeX 定义、引用
 *   4. 缺失目标、重复 ID、手写章节号不一致等提示（提示不等于标准合规结论）
 *
 * 设计约束：
 *   - 所有正则逐行执行，不做跨行回溯匹配，长文档不会挂起。
 *   - 全文只扫描一遍（split + 单趟循环），复杂度 O(字符数)。
 *   - 用户内容只作为纯文本处理，本模块不产生任何 HTML。
 */

/** 反引号用码点构造，避免源文件里出现裸反引号字符。 */
const TICK = String.fromCharCode(96);

/** 诊断条数上限：超出后只保留计数，避免超长文档把面板撑爆。 */
export const MAX_DIAGNOSTICS = 200;
/** 建议的标签 ID 形态（与渲染层 {#fig:x} / {#tab:x} 一致）。允许 Unicode，但会给出提示。 */
export const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
export const ID_ANY_SHAPE = /^[^\s{}[\]()#<>]+$/;

// 渲染器（src/render.mjs）实际支持的交叉引用目标形态（窄口径，不声称任何标准合规）：
//   图 / 表：{#fig:id} / {#tab:id}，名称取 [\w.-]+（ASCII 字母数字与 _ . -），
//   公式：\label{...}，由 MathJax 解析，仅能通过 \eqref{} 引用（\ref{} 不会解析公式）。
const FLOAT_ID_RE = /^(?:fig|tab):[A-Za-z0-9_.-]+$/;
const EQUATION_ID_RE = /^\S+$/;

const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const FENCE_RE = new RegExp('^ {0,3}(' + TICK + '{3,}|~{3,})(.*)$');
const TRAILING_HASHES = /[ \t]+#+[ \t]*$/;
const REF_RE = /\\(eq)?ref\{([^{}\n]*)\}/g;
const LABEL_RE = /\\label\{([^{}\n]*)\}/g;
const ID_MARK_RE = /\{#([^{}\n]*)\}/g;
// 独立实例：titleFromLine 会复用正则，若共用同一个 global 正则会重置外层 exec 循环的 lastIndex。
const ID_MARK_STRIP_RE = /\{#[^{}\n]*\}/g;
const FOOTNOTE_RE = /\[\^([^\]\n]+)\]/g;
const CAPTION_PREFIX = /^[ \t]*(图|表)[ \t]*[：:][ \t]*/;
const MANUAL_NUMBER_RE = /^[ \t]*(?:第[ \t]*([0-9]+)[ \t]*[章节条]|附录[ \t]*([A-Za-z])|([0-9]+(?:\.[0-9]+)*)(?=[ \t、.．])|([一二三四五六七八九十百]+)[ \t]*、)/;

function emptyResult() {
  return {
    headings: [],
    targets: [],
    targetById: new Map(),
    occurrences: [],
    footnotes: [],
    figures: [],
    tables: [],
    equations: [],
    diagnostics: [],
    counts: { headings: 0, targets: 0, occurrences: 0, diagnostics: 0, truncated: false },
  };
}

function splitLines(source) {
  const lines = [];
  let start = 0;
  for (;;) {
    let end = source.indexOf('\n', start);
    if (end === -1) end = source.length;
    lines.push({ text: source.slice(start, end), start: start, line: lines.length + 1 });
    if (end === source.length) break;
    start = end + 1;
  }
  return lines;
}

/** frontmatter 只认文件第一行的 --- ... ---（或 +++ ... +++）。 */
function frontmatterRange(lines) {
  if (!lines.length) return null;
  const first = lines[0].text.trim();
  if (first !== '---' && first !== '+++') return null;
  for (let i = 1; i < lines.length; i += 1) {
    const t = lines[i].text.trim();
    if (t === '---' || t === '...') return { from: 0, to: i };
    if (first === '+++' && t === '+++') return { from: 0, to: i };
  }
  return null;
}

function fenceInfo(line) {
  const m = FENCE_RE.exec(line);
  if (!m) return null;
  return { char: m[1][0], len: m[1].length, rest: m[2] };
}

/**
 * 围栏状态机，返回 'open' / 'close' / null。
 * 开围栏：反引号信息串里不得再含反引号；
 * 闭围栏：同字符、长度不短于开围栏、其后只有空白。
 */
function fenceTransition(line, open) {
  const info = fenceInfo(line);
  if (!info) return null;
  if (!open) {
    if (info.char === TICK && info.rest.indexOf(TICK) >= 0) return null;
    return 'open';
  }
  if (info.char !== open.char || info.len < open.len) return null;
  if (info.rest.trim() !== '') return null;
  return 'close';
}

/**
 * 从题注 / 图片行里取出可读标题（纯文本，不保留 Markdown 记号）。
 * 标签常写在 alt 内部（![说明 {#fig:x}](a.png)），所以先按标签截断，再剥掉残缺的链接记号。
 */
function titleFromLine(line, label) {
  let s = line;
  const at = s.indexOf(label);
  if (at >= 0) s = s.slice(0, at);
  s = s.replace(ID_MARK_STRIP_RE, '');
  s = s.replace(CAPTION_PREFIX, '');
  s = s.replace(/^[ \t]*!?\[/, '');
  s = s.replace(/\*+/g, '').replace(/[ \t]+$/, '');
  s = s.trim();
  return s.length > 120 ? s.slice(0, 117) + '…' : s;
}

function manualNumber(text) {
  const m = MANUAL_NUMBER_RE.exec(text);
  if (!m) return null;
  let digits = m[3] || null;
  if (!digits && m[1]) digits = m[1];
  let parts = null;
  if (digits) {
    parts = digits.split('.').map(function (part) {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : null;
    });
    if (parts.some(function (p) { return p === null; })) parts = null;
  }
  return { parts: parts, appendix: m[2] ? m[2].toUpperCase() : null, cjk: m[4] || null };
}

function pushTarget(result, target) {
  const existing = result.targetById.get(target.id);
  if (existing) existing.duplicates += 1;
  else result.targetById.set(target.id, Object.assign({}, target, { duplicates: 1 }));
  result.targets.push(target);
}

function addDiagnostic(result, diag) {
  if (result.diagnostics.length >= MAX_DIAGNOSTICS) {
    result.counts.truncated = true;
    return;
  }
  result.diagnostics.push(diag);
}

// ------------------------------------------------- 行内代码屏蔽（保留字符偏移）

/**
 * 返回行内所有成对反引号区间的 [start, end) 列表（码点单位，与切片一致）。
 * 同长度反引号配对，LIFO 匹配最近的同长开引号；未闭合的反引号按字面量处理（不屏蔽）。
 * 复杂度与行的反引号数量线性相关，不随行长平方增长。
 */
function inlineCodeRanges(line) {
  const runs = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    if (line[i] !== TICK) { i += 1; continue; }
    let j = i;
    while (j < n && line[j] === TICK) j += 1;
    runs.push({ start: i, end: j, len: j - i });
    i = j;
  }
  const openByLen = new Map();
  const ranges = [];
  for (const run of runs) {
    const stack = openByLen.get(run.len);
    if (stack && stack.length) {
      ranges.push([stack.pop(), run.end]);
    } else if (stack) {
      stack.push(run.start);
    } else {
      openByLen.set(run.len, [run.start]);
    }
  }
  return ranges;
}

/** 把行内代码区间替换为等长空格，保持原始字符偏移（诊断 location 仍指向真实文本）。 */
function maskInlineCode(line) {
  const ranges = inlineCodeRanges(line);
  if (!ranges.length) return line;
  const chars = line.split('');
  for (const range of ranges) {
    for (let k = range[0]; k < range[1]; k += 1) chars[k] = ' ';
  }
  return chars.join('');
}

/**
 * 光标之前是否处于未闭合的行内代码（用于抑制补全）。
 * 只看前缀：光标在闭合反引号之前也算在代码内，符合编辑时的直觉。
 */
function inInlineCodeAt(line, pos) {
  let open = 0;
  let i = 0;
  const n = line.length;
  while (i < pos) {
    if (line[i] !== TICK) { i += 1; continue; }
    let j = i;
    while (j < n && line[j] === TICK) j += 1;
    const run = j - i;
    if (open === 0) open = run;
    else if (run === open) open = 0;
    i = j;
  }
  return open !== 0;
}

/** 位置 index 是否被前置的奇数个反斜杠转义（\ref 视为字面示例，不参与诊断）。 */
function isEscapedAt(line, index) {
  let n = 0;
  for (let i = index - 1; i >= 0 && line[i] === '\\'; i -= 1) n += 1;
  return n % 2 === 1;
}

// ------------------------------------------------ 渲染器交叉引用支持判定

function isSupportedFloatId(id) { return FLOAT_ID_RE.test(id); }
function isSupportedEquationId(id) { return EQUATION_ID_RE.test(id); }
function isSupportedFootnoteId(id) { return typeof id === 'string' && id.length > 0 && id.indexOf(']') === -1; }

/** 该引用出现（\ref / \eqref）能否被渲染器解析到目标。 */
function isResolvableRef(occ, target) {
  if (occ.kind === 'eqref') return target.kind === 'equation' && isSupportedEquationId(occ.id);
  return (target.kind === 'figure' || target.kind === 'table') && isSupportedFloatId(occ.id);
}

/** 补全候选：eqref 仅公式；ref 仅渲染器支持的图 / 表。 */
function isCompletionTarget(target, mode) {
  if (mode === 'eqref') return target.kind === 'equation' && isSupportedEquationId(target.id);
  return (target.kind === 'figure' || target.kind === 'table') && isSupportedFloatId(target.id);
}

function reportDiagnostics(result) {
  const seen = new Map();
  for (const target of result.targets) {
    if (seen.has(target.id)) {
      addDiagnostic(result, {
        severity: 'warning',
        code: 'duplicate-id',
        id: target.id,
        line: target.line,
        message: 'ID 重复定义：' + target.id + '（首次在第 ' + seen.get(target.id).line + ' 行）',
      });
    } else seen.set(target.id, target);
  }
  for (const occ of result.occurrences) {
    if (occ.kind === 'footnote-ref') continue;
    const refName = occ.kind === 'eqref' ? '\\eqref' : '\\ref';
    const target = result.targetById.get(occ.id);
    if (!target) {
      // 完全没有定义：缺失
      addDiagnostic(result, {
        severity: 'warning',
        code: 'missing-target',
        id: occ.id,
        line: occ.line,
        message: refName + '{' + occ.id + '} 没有对应的定义',
      });
    } else if (!isResolvableRef(occ, target)) {
      // 有定义但渲染器解析不到（锚点 / 非 ASCII 图·表 ID / 用 \ref 引公式）：不受支持
      addDiagnostic(result, {
        severity: 'info',
        code: 'unsupported-ref',
        id: occ.id,
        line: occ.line,
        message: refName + '{' + occ.id + '} 的目标不是渲染器支持的交叉引用'
          + '（图/表用 fig:/tab: 加 ASCII 名称；公式用 \\eqref）',
      });
    }
  }
  for (const target of result.targets) {
    // 通用锚点（非 fig:/tab:）与形态非法的图 / 表 ID，无法被渲染器解析为交叉引用。
    if (target.kind === 'anchor'
      || ((target.kind === 'figure' || target.kind === 'table') && !isSupportedFloatId(target.id))) {
      addDiagnostic(result, {
        severity: 'info',
        code: 'unsupported-target',
        id: target.id,
        line: target.line,
        message: 'ID ' + target.id + ' 不是渲染器支持的交叉引用目标'
          + '（图/表需 fig:/tab: 加 ASCII 名称）；自动补全不会列出',
      });
    }
    if (ID_ANY_SHAPE.test(target.id) && !ID_SHAPE.test(target.id)) {
      addDiagnostic(result, {
        severity: 'info',
        code: 'unicode-id',
        id: target.id,
        line: target.line,
        message: 'ID 含非 ASCII 字符：' + target.id + '（建议改用 ASCII，部分工具链不接受）',
      });
    }
  }
}

/**
 * 手写章节号一致性提示。
 * 仅当正文里确实出现过形如 3.1 的手写编号后才启用比对；
 * 中文序号与附录字母只做标记，不做数值推断。
 * 这是书写一致性提示，不代表任何标准符合性结论。
 */
function reportHeadingNumbers(result) {
  const headings = result.headings;
  const numbered = headings.some(function (h) { return h.manual && h.manual.parts; });
  if (!numbered) return;
  const counters = [];
  for (const heading of headings) {
    const depth = heading.level - 1;
    if (depth < 1) continue;
    counters[depth] = (counters[depth] || 0) + 1;
    counters.length = depth + 1;
    const manual = heading.manual;
    const parts = manual && manual.parts;
    const expected = counters.slice(1, depth + 1);
    if (parts && expected.length === depth && Array.from(expected).every(Number.isInteger)) {
      if (parts.length !== depth || parts.some((part, index) => part !== expected[index])) {
        addDiagnostic(result, {
          severity: 'info',
          code: 'heading-number',
          line: heading.line,
          message: '手写章节号与顺序不一致：' + heading.text.slice(0, 40)
            + '（按顺序应为 ' + expected.join('.') + '）',
        });
      }
    } else if (parts) {
      // 顶层号（如 3）出现在二级标题上，层级无法确定，不推断。
      continue;
    } else if (manual === null) {
      addDiagnostic(result, {
        severity: 'info',
        code: 'heading-number-missing',
        line: heading.line,
        message: '同级标题缺少手写章节号：' + heading.text.slice(0, 40),
      });
    }
  }
}

function finalizeCounts(result) {
  result.counts = {
    headings: result.headings.length,
    targets: result.targets.length,
    occurrences: result.occurrences.length,
    diagnostics: result.diagnostics.length,
    truncated: result.counts.truncated,
  };
  return result;
}

/**
 * 主入口：分析 Markdown 源码。
 * @param {string} source
 * @returns {object} 解析结果
 */
export function analyzeMarkdown(source) {
  const result = emptyResult();
  if (typeof source !== 'string' || source === '') return result;

  const lines = splitLines(source);
  const fm = frontmatterRange(lines);
  let fence = null;
  let equationIndex = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const row = lines[i];
    const raw = row.text;
    if (fm && i >= fm.from && i <= fm.to) continue;

    const transition = fenceTransition(raw, fence);
    if (transition === 'open') { fence = fenceInfo(raw); continue; }
    if (transition === 'close') { fence = null; continue; }
    if (fence) continue;

    // 行内代码替换为等长空格：只用于扫描，偏移与 raw 一致；正文展示仍用 raw。
    const scan = maskInlineCode(raw);

    const h = HEADING_RE.exec(raw);
    if (h) {
      const content = h[2] || '';
      let text = content.replace(TRAILING_HASHES, '').trim();
      let id = null;
      const mark = /\{#([^{}\n]*)\}/.exec(maskInlineCode(content));
      if (mark) { id = mark[1].trim(); text = content.slice(0, mark.index).trim(); }
      result.headings.push({
        line: row.line,
        offset: row.start,
        level: h[1].length,
        text: text,
        id: id,
        manual: manualNumber(text),
      });
    }

    REF_RE.lastIndex = 0;
    let m;
    while ((m = REF_RE.exec(scan)) !== null) {
      // 被反斜杠转义的字面示例（\ref）不计入引用诊断
      if (isEscapedAt(raw, m.index)) continue;
      const id = m[2].trim();
      if (!id) continue;
      result.occurrences.push({
        id: id, kind: m[1] ? 'eqref' : 'ref', line: row.line, offset: row.start + m.index,
      });
    }

    LABEL_RE.lastIndex = 0;
    while ((m = LABEL_RE.exec(scan)) !== null) {
      if (isEscapedAt(raw, m.index)) continue;
      const id = m[1].trim();
      if (!id) continue;
      equationIndex += 1;
      result.equations.push({ id: id, line: row.line, number: equationIndex });
      pushTarget(result, {
        id: id, kind: 'equation', line: row.line, offset: row.start + m.index,
        title: '公式 ' + equationIndex,
      });
    }

    ID_MARK_RE.lastIndex = 0;
    while ((m = ID_MARK_RE.exec(scan)) !== null) {
      const id = m[1].trim();
      if (!id) continue;
      const kind = id.indexOf('fig:') === 0 ? 'figure' : id.indexOf('tab:') === 0 ? 'table' : 'anchor';
      const target = {
        id: id, kind: kind, line: row.line, offset: row.start + m.index,
        title: titleFromLine(raw, m[0]) || id,
      };
      if (kind === 'figure') result.figures.push(target);
      else if (kind === 'table') result.tables.push(target);
      pushTarget(result, target);
    }

    FOOTNOTE_RE.lastIndex = 0;
    while ((m = FOOTNOTE_RE.exec(scan)) !== null) {
      const id = m[1].trim();
      if (!id) continue;
      // 定义判定依据原始行：行首须只有空白（行内代码已屏蔽，不会误判）
      const isDefinition = /^[ \t]*$/.test(raw.slice(0, m.index))
        && raw[m.index + m[0].length] === ':';
      if (isDefinition) {
        const body = raw.slice(m.index + m[0].length + 1).trim();
        result.footnotes.push({ id: id, line: row.line, offset: row.start + m.index, body: body });
        pushTarget(result, {
          id: id, kind: 'footnote', line: row.line, offset: row.start + m.index,
          title: body.slice(0, 120) || '脚注',
        });
      } else {
        result.occurrences.push({
          id: id, kind: 'footnote-ref', line: row.line, offset: row.start + m.index,
        });
      }
    }
  }

  reportDiagnostics(result);
  reportHeadingNumbers(result);
  return finalizeCounts(result);
}

// ---------------------------------------------------------------- 标识符

/** 把任意文本压成安全的 ASCII 标签片段；空结果回落到 fallback。 */
export function slugify(text, fallback) {
  const base = String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || fallback;
}

/**
 * 在 taken（ID 集合）里挑一个不冲突的标识符：base、base-2、base-3 …
 * taken 可以是 Set 或数组。返回的 ID 一定不在 taken 中。
 */
export function uniqueId(base, taken) {
  const used = taken instanceof Set ? taken : new Set(taken || []);
  const stem = base || 'x';
  if (!used.has(stem)) return stem;
  let n = 2;
  while (used.has(stem + '-' + n)) n += 1;
  return stem + '-' + n;
}

// ---------------------------------------------------------------- 片段

const FENCE = TICK + TICK + TICK;

/**
 * 工具栏片段库。text 里的占位符形如 {{title}} / {{id}}，由 renderSnippet 填充。
 * 只使用项目已支持的语法（\ref{}、\eqref{}、\label{}、{#fig:}、{#tab:}、[^id]: 与 BibTeX）。
 * wrap 类片段（加粗 / 斜体 / 行内代码）不产生整段文本，由编辑器做包裹操作。
 */
export const SNIPPETS = {
  heading: { title: '标题', text: '## {{title}}\n' },
  bold: { title: '加粗', wrap: '**', placeholder: '加粗文字' },
  italic: { title: '斜体', wrap: '*', placeholder: '斜体文字' },
  code: { title: '行内代码', wrap: TICK, placeholder: 'code' },
  link: { title: '链接', text: '[{{title}}]({{url}})', defaults: { url: 'https://' } },
  quote: { title: '引用块', text: '> {{title}}\n' },
  table: {
    title: '表格',
    // id 已含 tab: 命名空间（idPrefix），模板不再补前缀，保证回显 ID 与渲染器目标 ID 一致
    text: '表：{{title}} {#{{id}}}\n\n| 列 A | 列 B |\n| --- | --- |\n| | |\n',
    idPrefix: 'tab:',
    idFrom: 'title',
  },
  footnote: {
    title: '脚注引用',
    text: '[^{{id}}]\n\n[^{{id}}]: {{note}}\n',
    idPrefix: 'note-',
    defaults: { note: '注释内容' },
  },
  bibliography: {
    title: '参考文献（BibTeX 脚注）',
    // 合法 BibTeX：外层条目花括号 + 各字段值花括号；{{{x}}} 中只有内层 {{x}} 被替换，
    // 外层花括号原样保留，替换后即 @article{..., author = {...}, ...}
    text: '[^{{id}}]\n\n[^{{id}}]: @article{{{id}},\n'
      + '  author = {{{author}}},\n  title = {{{title}}},\n'
      + '  journal = {{{journal}}},\n  year = {{{year}}},\n  }\n',
    idPrefix: 'ref-',
    defaults: {
      author: '张三 and 李四', title: '文献标题', journal: '期刊名称', year: '2026',
    },
  },
  formula: {
    title: '公式',
    // 公式命名空间为 eq:（MathJax \label / \eqref），ID 已含前缀，模板不再补
    text: '$$\n\\begin{aligned}\nx &= y \\\\\n\\end{aligned}\n\\label{{{id}}}\n$$\n'
      + '\n如式 $\\eqref{{{id}}}$ 所示。\n',
    idPrefix: 'eq:',
  },
  figure: {
    title: '图（题注 + 标签）',
    // 图命名空间为 fig:（渲染器 {#fig:id} / \ref），ID 已含前缀，模板不再补
    text: '图：{{title}} {#{{id}}}\n\n' + FENCE + 'mermaid\ngraph LR\n  A[开始] --> B[结束]\n' + FENCE
      + '\n\n如图 \\ref{{{id}}} 所示。\n',
    idPrefix: 'fig:',
    idFrom: 'title',
  },
  'gb-scope': {
    title: 'GB · 范围',
    text: '## 范围\n\n本文件规定了{{subject}}的术语和定义、技术要求与试验方法。\n\n本文件适用于{{subject}}。\n',
    defaults: { subject: '本文件规定的对象' },
  },
  'gb-terms': {
    title: 'GB · 术语和定义',
    text: '## 术语和定义\n\n下列术语和定义适用于本文件。\n\n### {{title}}\n\n{{definition}}\n',
    defaults: { title: '术语', definition: '术语定义' },
  },
  'gb-appendix': {
    title: 'GB · 附录',
    text: '## 附录 {{letter}}（规范性）{{title}}\n\n{{content}}\n',
    defaults: { letter: 'A', title: '附录标题', content: '附录内容' },
  },
  skill: {
    title: '技能文档 · 章节骨架',
    text: '## 何时使用\n\n- {{title}}\n\n## 快速开始\n\n' + FENCE + 'bash\n{{title}} --help\n' + FENCE
      + '\n\n## 常用参数\n\n| 参数 | 说明 |\n| --- | --- |\n| ' + TICK + '--flag' + TICK + ' | 说明 |\n',
    defaults: { title: '命令名' },
  },
};

export const SNIPPET_NAMES = Object.keys(SNIPPETS);

/** 该片段是否需要生成 ID（表格 / 图 / 公式 / 脚注 / 文献需要）。 */
function snippetNeedsId(snippet) {
  return typeof snippet.idPrefix === 'string' && snippet.idPrefix.length > 0;
}

/**
 * 渲染片段。
 * @param {string} name SNIPPETS 的键
 * @param {object} [values] 占位符取值，如 { title: '总体指标' }
 * @param {object} [options]
 * @param {Set<string>|string[]} [options.taken] 已占用的 ID，必要时自动去重
 * @returns {{text: string, id: string|null}} 渲染后的文本与实际使用的 ID
 */
export function renderSnippet(name, values, options) {
  const snippet = SNIPPETS[name];
  if (!snippet) throw new Error('未知片段：' + name);
  const opts = options || {};
  const merged = Object.assign({}, snippet.defaults || {}, values || {});
  let id = null;
  if (snippetNeedsId(snippet)) {
    const source = snippet.idFrom ? merged[snippet.idFrom] : null;
    const stem = snippet.idPrefix + slugify(source || name, 'item');
    id = uniqueId(stem, opts.taken || []);
    merged.id = id;
  }
  let text = snippet.text != null ? snippet.text : '';
  text = text.replace(/\{\{(\w+)\}\}/g, function (whole, key) {
    const v = merged[key];
    return v == null || v === '' ? whole : String(v);
  });
  return { text: text, id: id };
}

// ---------------------------------------------------------------- 补全

const COMPLETION_TRIGGERS = [
  { mode: 'footnote', re: /\[\^([^\]\n]*)$/, close: ']' },
  // 组 1 是可选的 eq，组 2 才是用户输入的 ID；不能把组 1 当作已输入前缀
  { mode: 'ref', re: /\\(eq)?ref\{([^{}\n]*)$/, close: '}' },
];

/** 光标是否位于围栏代码 / frontmatter / 行内代码中（此时不提供补全）。 */
function isSuppressedContext(text, pos) {
  const before = text.slice(0, pos);
  const lines = before.split('\n');
  // frontmatter：光标仍在其中（含尚未闭合）
  const first = lines.length ? lines[0].trim() : '';
  if (first === '---' || first === '+++') {
    let end = -1;
    for (let i = 1; i < lines.length; i += 1) {
      const t = lines[i].trim();
      if (t === '---' || t === '...' || (first === '+++' && t === '+++')) { end = i; break; }
    }
    if (end === -1 || end === lines.length - 1) return true;
  }
  // 围栏：光标之前的行决定当前是否处于围栏代码块内
  let fence = null;
  for (let i = 0; i < lines.length - 1; i += 1) {
    const transition = fenceTransition(lines[i], fence);
    if (transition === 'open') fence = fenceInfo(lines[i]);
    else if (transition === 'close') fence = null;
  }
  if (fence) return true;
  const cursorLine = lines[lines.length - 1] || '';
  if (fenceInfo(cursorLine)) {
    const transition = fenceTransition(cursorLine, fence);
    if (transition === 'open' || transition === 'close') return true;
  }
  const lineStart = before.lastIndexOf('\n') + 1;
  return inInlineCodeAt(cursorLine, pos - lineStart);
}

/**
 * 补全提供器：脚注定义 ID、\ref{}（图/表）与 \eqref{}（公式）目标。
 * 候选只包含渲染器能真正解析的交叉引用目标，锚点与非法 ID 不会出现。
 * @param {{text: string, pos: number}} context 文本与光标位置
 * @param {object} analysis analyzeMarkdown 的结果
 * @returns {null | {from: number, options: Array}} 补全结果；options 为空数组表示触发了但无可选项
 */
export function provideCompletions(context, analysis) {
  if (!context || typeof context.text !== 'string') return null;
  if (typeof context.pos !== 'number') return null;
  if (!analysis || !Array.isArray(analysis.targets)) return null;
  const text = context.text;
  const pos = context.pos;
  if (pos < 0 || pos > text.length) return null;
  const before = text.slice(0, pos);
  for (const trigger of COMPLETION_TRIGGERS) {
    const m = trigger.re.exec(before);
    if (!m) continue;
    if (isSuppressedContext(text, pos)) return null;
    let mode;
    let typed;
    if (trigger.mode === 'ref') {
      mode = m[1] ? 'eqref' : 'ref';
      typed = m[2] || '';
    } else {
      mode = trigger.mode;
      typed = m[1] || '';
    }
    const from = pos - typed.length;
    const base = mode === 'footnote'
      ? footnoteOptions(analysis, typed)
      : refOptions(analysis, typed, mode);
    // 同时替换已有尾部与定界符，使补全后的光标落在完整引用之外。
    const suffix = (trigger.close === '}' ? /^[\w.:-]*\}/ : /^[\w.:-]*\]/).exec(text.slice(pos));
    const to = pos + (suffix ? suffix[0].length : 0);
    const options = base.map(function (option) { return Object.assign({}, option, { apply: option.apply + trigger.close }); });
    return { from: from, to: to, options: options };
  }
  return null;
}

function footnoteOptions(analysis, typed) {
  const lower = typed.toLowerCase();
  const options = [];
  for (const note of analysis.footnotes) {
    if (!isSupportedFootnoteId(note.id)) continue;
    if (lower && note.id.toLowerCase().indexOf(lower) !== 0) continue;
    options.push({
      label: note.id,
      type: 'footnote',
      detail: firstLine(note.body) || '脚注',
      apply: note.id,
    });
  }
  return options;
}
function refOptions(analysis, typed, mode) {
  const lower = typed.toLowerCase();
  const options = [];
  for (const target of analysis.targets) {
    if (!isCompletionTarget(target, mode)) continue;
    if (lower && target.id.toLowerCase().indexOf(lower) !== 0) continue;
    options.push({
      label: target.id,
      type: target.kind,
      detail: target.title || target.id,
      apply: target.id,
    });
  }
  return options;
}
function firstLine(text) {
  const s = String(text == null ? '' : text).split('\n')[0].trim();
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}
