// md2pdf web editor — DOI 引用插入的纯逻辑（无 DOM、无网络、可单测）
//
// 归属：把「DOI 规范化 / 脚注扫描与去重 / 插入计划」做成纯函数，供 editor-doi.js
// （对话框 UI）与 ci/editor-doi-checks.mjs 共用。本模块不碰 DOM、不发请求、
// 不直接改文档——只产出「一次事务」的 change 列表。
//
// 依赖：无（不 import 其它模块，便于在 Node 里直接单测）。

// ------------------------------------------------------------------ DOI 规范化

// 输入形式：bare / doi: / https://doi.org/ / http(s)://dx.doi.org/
const DOI_PREFIX_RE = /^doi:\s*/i;
export function normalizeDoi(input) {
  if (typeof input !== 'string' || input.length > 512) return null;
  let value = input.trim().replace(DOI_PREFIX_RE, '').trim();
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) ||
          !['doi.org', 'dx.doi.org', 'www.doi.org'].includes(url.hostname.toLowerCase()) ||
          url.username || url.password || url.port || url.search || url.hash) return null;
      value = decodeURIComponent(url.pathname.slice(1));
    } catch { return null; }
  }
  if (/[\s\u0000-\u001f\u007f]/.test(value) || !/^10\.\d{4,9}\/\S+$/.test(value)) return null;
  return value.toLowerCase();
}

/** 显示用：只做前缀清理与配对括号剥离，不做小写化（DOI 后缀理论上可含大写）。 */
export function displayDoi(input) {
  const normalized = normalizeDoi(input);
  if (normalized) return normalized;
  const trimmed = String(input == null ? '' : input).trim().replace(DOI_PREFIX_RE, '').trim();
  return trimmed;
}

// ---------------------------------------------------------------- BibTeX 解析

export function parseBibtex(bibtex) {
  const text = String(bibtex ?? '').trim();
  if (!text || text.length > 20000) return null;
  const entry = /^@([a-z]+)\s*\{\s*([^,\s{}]+)\s*,/i.exec(text);
  if (!entry) return null;
  const fields = {};
  let pos = entry[0].length;
  while (pos < text.length) {
    while (/[\s,]/.test(text[pos] || '') && pos < text.length) pos++;
    if (text[pos] === '}') return text.slice(pos + 1).trim() || !Object.keys(fields).length ? null :
      { type: entry[1].toLowerCase(), key: entry[2], fields, raw: text };
    const field = /^([a-z][a-z0-9_-]*)\s*=\s*/i.exec(text.slice(pos));
    if (!field) return null;
    pos += field[0].length;
    let value = '';
    if (text[pos] === '{' || text[pos] === '"') {
      const quoted = text[pos++] === '"';
      let depth = 1;
      const start = pos;
      while (pos < text.length) {
        if (text[pos] === '\\') { pos += 2; continue; }
        if (quoted ? text[pos] === '"' : text[pos] === '}') {
          if (--depth === 0) break;
        } else if (!quoted && text[pos] === '{') depth++;
        pos++;
      }
      if (pos >= text.length) return null;
      value = text.slice(start, pos++);
    } else {
      const bare = /^[^,}\s]+/.exec(text.slice(pos));
      if (!bare) return null;
      value = bare[0]; pos += value.length;
    }
    const name = field[1].toLowerCase();
    if (fields[name] !== undefined) return null;
    fields[name] = value.replace(/\\([&%#_{}])/g, '$1').trim();
    while (/\s/.test(text[pos] || '') && pos < text.length) pos++;
    if (text[pos] !== ',' && text[pos] !== '}') return null;
  }
  return null;
}

/** 取 BibTeX 的 doi 字段并规范化；没有或非法返回 null。 */
export function bibtexDoi(bibtex) {
  const parsed = parseBibtex(bibtex);
  if (!parsed) return null;
  return normalizeDoi(parsed.fields.doi || '');
}

/**
 * 校验手动填写的 BibTeX：非空、合法；若带 doi 字段则必须与请求的 DOI 一致。
 * 尊重原 DOI 身份——不匹配就报错，绝不把别的 DOI 写进来，也绝不自动补字段。
 */
export function validateManualBibtex(bibtex, expectedDoi) {
  const raw = String(bibtex == null ? '' : bibtex).trim();
  if (!raw) return { ok: false, error: '请填写 BibTeX 条目内容。' };
  const parsed = parseBibtex(raw);
  if (!parsed) return { ok: false, error: 'BibTeX 格式无效：需要一个 @type{key, field = {value}, …} 条目。' };
  const want = normalizeDoi(expectedDoi || '');
  const got = parsed.fields.doi ? normalizeDoi(parsed.fields.doi) : null;
  if (parsed.fields.doi && !got) {
    return { ok: false, error: `BibTeX 的 doi 字段无法识别（${parsed.fields.doi}），请修正或删除该字段。` };
  }
  if (want && got && got !== want) {
    return { ok: false, error: `BibTeX 的 doi 字段（${got}）与本次请求的 DOI（${want}）不一致，请修正后再插入。` };
  }
  const warnings = [];
  if (want && !got) warnings.push('手动条目没有 doi 字段，之后无法自动识别为同一文献');
  for (const [field, label] of [['title', '标题'], ['author', '作者'], ['year', '年份']]) {
    if (!parsed.fields[field]) warnings.push('手动条目缺少' + label);
  }
  return { ok: true, warning: warnings.length ? warnings.join('；') : undefined, parsed };
}

// ---------------------------------------------------------------- 代码区遮罩

/**
 * 返回与原文等长的遮罩串：围栏代码块、缩进代码块、行内代码的位置换成空格
 * （换行保留）。扫描脚注/DOI 时不会把代码示例当成真实定义，且所有偏移量与
 * 原文一一对应。
 */
export function maskCode(markdown) {
  const text = String(markdown == null ? '' : markdown);
  const out = text.split('');
  const blank = (from, to) => {
    for (let i = Math.max(0, from); i < Math.min(out.length, to); i++) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };
  const lines = text.split('\n');
  let offset = 0;
  let inFence = false;
  let fenceMark = '';
  for (const line of lines) {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (inFence) {
      blank(offset, offset + line.length);
      if (fence && fence[1][0] === fenceMark[0] && fence[1].length >= fenceMark.length) inFence = false;
    } else if (fence) {
      blank(offset, offset + fence[0].length);
      inFence = true;
      fenceMark = fence[1];
    } else if (/^(?: {4}|\t)/.test(line)) {
      blank(offset, offset + line.length);
    }
    offset += line.length + 1;
  }
  // 行内代码：`x` / ``x``
  const inline = /(`+)([\s\S]*?)\1(?!`)/g;
  let m;
  while ((m = inline.exec(text)) !== null) blank(m.index, m.index + m[0].length);
  return out.join('');
}

// -------------------------------------------------------------- 脚注定义扫描

// 定义须顶格（与 src/render.mjs 的 /^\[\^([^\]]+)\]:/ 一致）
const DEF_LINE_RE = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
const REF_RE = /\[\^([^\]\s]+)\]/g;
const DOI_ONLY_RE = /^\s*doi\s*:\s*(\S+)\s*$/i;

/**
 * 扫描脚注定义与引用（代码区已遮罩）。
 * 返回 { definitions, referenced, taken }；definitions 每项含
 * { id, start, end, body, kind, doi, bibtex }，kind ∈ bibtex | doi-only | plain。
 * taken 含「已定义 + 已引用」的 ID，生成新 ID 时都要避开。
 */
export function scanFootnotes(markdown) {
  const text = String(markdown == null ? '' : markdown);
  const masked = maskCode(text);
  const lines = text.split('\n');
  const maskedLines = masked.split('\n');
  // 每行的起始偏移，避免在扫描过程中手工累加（累加容易差一位）。
  const starts = new Array(lines.length);
  let cursor = 0;
  for (let i = 0; i < lines.length; i += 1) { starts[i] = cursor; cursor += lines[i].length + 1; }

  const definitions = [];
  const referenced = [];

  for (let i = 0; i < lines.length; i += 1) {
    const def = DEF_LINE_RE.exec(maskedLines[i]);
    if (def) {
      const start = starts[i];
      // 续行判定与 src/render.mjs 一致：缩进的非空行属于同一条定义。
      // 这里读原始行（不用遮罩行），否则 4 空格缩进的 BibTeX 字段会被误当空行。
      let last = i;                       // 最后一条属于本定义的行
      const bodyParts = [DEF_LINE_RE.exec(lines[i])[2]];
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j];
        // 空行只有在已经吃到续行之后才属于本条定义，否则那是「定义之间的分隔空行」，
        // 吃掉它会让替换范围吞掉下一条定义前面的空行。
        if (/^\s*$/.test(next) && /^[ \t]+\S/.test(lines[j + 1] || '')) { bodyParts.push(''); last = j; continue; }
        if (/^[ \t]+\S/.test(next)) { bodyParts.push(next.trim()); last = j; continue; }
        break;
      }
      const end = Math.min(starts[last] + lines[last].length, text.length);
      const body = bodyParts.join('\n').replace(/\s+$/, '');
      const doiOnly = DOI_ONLY_RE.exec(body);
      const isBibtex = /^\s*@/.test(body);
      definitions.push({
        id: def[1],
        start,
        end,
        body,
        kind: isBibtex ? 'bibtex' : (doiOnly ? 'doi-only' : 'plain'),
        doi: isBibtex ? bibtexDoi(body) : (doiOnly ? normalizeDoi(doiOnly[1]) : null),
        bibtex: isBibtex ? body : null,
      });
      i = last;
      continue;
    }
    REF_RE.lastIndex = 0;
    let ref;
    while ((ref = REF_RE.exec(maskedLines[i])) !== null) referenced.push(ref[1]);
  }

  const taken = new Set();
  for (const d of definitions) taken.add(d.id);
  for (const id of referenced) taken.add(id);
  return { definitions, referenced, taken };
}

/** 找出已存在的、同一文献的定义（BibTeX 的 doi 字段或仅 DOI 的定义）。 */
export function findExistingForDoi(scan, doi) {
  const want = normalizeDoi(doi || '');
  if (!want) return null;
  for (const def of scan.definitions) {
    if (def.doi && def.doi === want) return def;
  }
  return null;
}

/** 所有「只写了 DOI、尚未著录」的脚注定义（编辑器内提示用，不发网络请求）。 */
export function pendingDoiOnly(scan) {
  return scan.definitions.filter(def => def.kind === 'doi-only' && def.doi);
}

/** 带 doi 字段但缺 author/title 的半成品 BibTeX 定义。 */
export function pendingIncompleteBibtex(scan) {
  return scan.definitions.filter(def => {
    if (def.kind !== 'bibtex') return false;
    return !(def.bibtex && /\bauthor\b/i.test(def.bibtex) && /\btitle\b/i.test(def.bibtex));
  });
}

// ------------------------------------------------------------------ ID 生成

// 生成的 ID 必须是纯 ASCII，且不把 DOI 的斜杠等字符带进来
function idStem(doi) {
  const tail = String(doi || '').replace(/^10\.\d{4,9}\//, '');
  const words = tail.split(/[^A-Za-z0-9]+/).filter(Boolean).slice(0, 3);
  const stem = words.map(w => w.toLowerCase()).join('-').slice(0, 24).replace(/^-+|-+$/g, '');
  return 'ref-doi-' + (stem || 'item');
}

/** 在 taken（Set 或数组）里挑一个不冲突的 ASCII 脚注 ID。 */
export function uniqueDoiId(doi, taken) {
  const used = taken instanceof Set ? taken : new Set(taken || []);
  const stem = idStem(doi);
  if (!used.has(stem)) return stem;
  let n = 2;
  while (used.has(stem + '-' + n)) n += 1;
  return stem + '-' + n;
}

// ---------------------------------------------------------------- 插入计划

// 引用标记后补一个空格
function referenceText(id) { return '[^' + id + '] '; }

/** 仅插入 DOI 时的脚注定义正文（md2pdf 的 doi: 脚注约定）。 */
export function doiOnlyBody(doi) {
  return 'doi:' + displayDoi(doi);
}

// 定义块的续行必须缩进，否则 src/render.mjs 的脚注解析会把后续行当成正文，
// BibTeX 就断成半截。缩进 4 空格，与项目内 BibTeX 片段风格一致。
const INDENT = '    ';

/** 把 BibTeX 正文格式化成「首行顶格 + 续行缩进」的定义体（不含 [^id]: 前缀）。 */
export function formatDefinitionBody(bibtex) {
  const lines = String(bibtex == null ? '' : bibtex).replace(/\s+$/, '').split('\n');
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
  return lines.map((line, i) => (i === 0 ? line : (line.trim() ? INDENT + line : line))).join('\n');
}

/**
 * 定义块前面需要补几个换行：Markdown 脚注定义与正文之间留一个空行才成块，
 * 但文档末尾已经有换行时不要重复加。
 * @param position 定义将要插入的位置（在 text 中的偏移）
 */
function leadingBreaks(text, position) {
  let n = 0;
  for (let i = position - 1; i >= 0 && text[i] === '\n'; i -= 1) n += 1;
  return '\n'.repeat(Math.max(0, 2 - n));
}

// 引用之前的定义替换会让引用右移，这里补偿长度差
function deltaBefore(changes, position) {
  let delta = 0;
  for (const change of changes) {
    if (change.from >= position) continue;
    delta += change.insert.length - (change.to - change.from);
  }
  return delta;
}

/**
 * 计算「一次事务」的插入计划（纯函数，不改文档）。
 *
 * @param {object} input
 *   markdown  打开对话框那一刻的 getValue() 快照
 *   at        引用插入位置（捕获的选区终点 sel.to）
 *   doi       DOI 或 DOI URL
 *   bibtex    解析出的 BibTeX；null / 空 表示「仅插入 DOI」
 * @returns 失败 { ok:false, reason, message }；成功 { ok:true, action, id, doi,
 *          changes, caret, message, warning }。action ∈ reuse | upgrade | insert。
 *
 * 引用与定义合并在同一个 changes 数组里，内核一次性 dispatch ⇒ 只产生一步撤销。
 */
export function planCitation(input) {
  const markdown = String(input && input.markdown != null ? input.markdown : '');
  const want = normalizeDoi(input && input.doi);
  if (!want) return { ok: false, reason: 'invalid-doi', message: '无法识别该 DOI，请检查输入（支持 10.xxxx/xxx 与 doi.org 链接）。' };

  const scan = scanFootnotes(markdown);
  const existing = findExistingForDoi(scan, want);
  const bibtex = input && input.bibtex ? String(input.bibtex).trim() : '';
  const at = Math.max(0, Math.min(markdown.length, Number(input && input.at) || 0));
  const useBibtex = !!bibtex;

  if (scan.definitions.some(def => at > def.start && at < def.end)) {
    return { ok: false, reason: 'inside-definition', message: '请把光标移到正文后再插入引用。' };
  }

  // 已有完整 BibTeX（或本来就只想要 DOI）：只补引用标记，绝不重复定义、
  // 也绝不覆盖已有的有效 BibTeX。
  if (existing && !(existing.kind === 'doi-only' && useBibtex)) {
    const prefix = scan.definitions.some(def => at === def.end) ? '\n\n' : '';
    const reference = prefix + referenceText(existing.id);
    return {
      ok: true,
      action: 'reuse',
      id: existing.id,
      doi: existing.doi,
      changes: [{ from: at, to: at, insert: reference }],
      caret: { from: at + reference.length, to: at + reference.length },
      message: '该 DOI 已在文档中著录（' + existing.id + '），只补了一个引用标记。',
    };
  }

  const id = existing ? existing.id : uniqueDoiId(want, scan.taken);
  const reference = referenceText(id);
  const body = useBibtex ? formatDefinitionBody(bibtex) : doiOnlyBody(want);
  const definition = '[^' + id + ']: ' + body + '\n';

  // 复用仅 DOI 的定义时只换正文，块前后的空行原样保留。
  const definitionInsert = existing ? definition : leadingBreaks(markdown, markdown.length) + definition;
  let changes;
  let referenceFrom = at;
  if (existing && at > existing.start && at < existing.end) {
    return { ok: false, message: '请把光标移到正文后再插入引用。' };
  }
  if (!existing && at === markdown.length) {
    // 文档末尾：引用 + 分隔 + 定义合并成一次插入（一个变更 ⇒ 一个位置）
    changes = [{ from: at, to: at, insert: reference + leadingBreaks(markdown + reference, at + reference.length) + definition }];
  } else if (existing) {
    // 同一事务里替换定义正文并插入引用
    changes = [
      { from: at, to: at, insert: reference },
      { from: existing.start, to: existing.end, insert: definition },
    ];
  } else {
    changes = [
      { from: at, to: at, insert: reference },
      { from: markdown.length, to: markdown.length, insert: definitionInsert },
    ];
  }
  changes.sort((a, b) => a.from - b.from || a.to - b.to);

  const caretAt = referenceFrom + reference.length + deltaBefore(changes, referenceFrom);
  return {
    ok: true,
    action: existing ? 'upgrade' : 'insert',
    id,
    doi: want,
    changes,
    caret: { from: caretAt, to: caretAt },
    message: existing
      ? '已复用未著录的脚注 ' + existing.id + ' 并补全 BibTeX 著录。'
      : '已插入引用 ' + id + (useBibtex ? ' 与 BibTeX 定义。' : ' 与 DOI 脚注定义。'),
    warning: useBibtex ? null : '该引用只写入了 DOI，尚未著录为 BibTeX：预览与导出的参考文献里只会显示 DOI。',
  };
}

// ---------------------------------------------------------------- 快照守卫

/** 文档快照守卫：解析期间文档被改动时，不覆盖用户的新内容。 */
export function checkSnapshot(before, after) {
  if (String(before) === String(after)) return { ok: true };
  return {
    ok: false,
    message: '解析期间文档已被修改，为避免覆盖你的改动，本次未插入。请确认位置后重试插入。',
  };
}

/** 把 changes 应用到纯字符串上（测试与守卫用的参考实现）。 */
export function applyChanges(markdown, changes) {
  const text = String(markdown == null ? '' : markdown);
  const sorted = changes.slice().sort((a, b) => a.from - b.from || a.to - b.to);
  let out = '';
  let cursor = 0;
  for (const change of sorted) {
    const from = Math.max(cursor, Math.min(text.length, change.from));
    const to = Math.max(from, Math.min(text.length, change.to));
    out += text.slice(cursor, from) + String(change.insert);
    cursor = to;
  }
  return out + text.slice(cursor);
}