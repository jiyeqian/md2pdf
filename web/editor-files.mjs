// 统一的下载命名：filename_version.ext。
// 标题优先取 front matter 的 title，其次正文首个一级标题（ATX / Setext）；没有有效标题时
// 回落到 md2pdf_设置一级标题为文档标题。版本优先取 front matter 的 version 标量；缺失 /
// 空 / 非法（对象 / 列表 / 纯符号）时回落到本地时间戳 YYYYMMDD_HHmmss。
// Markdown 与 PDF 共用本模块，保证同一文档 / 版本得到完全相同的基名。

// 控制字符探测必须是非全局正则：全局 /g 的 .test 会推进 lastIndex，
// 导致对同一输入连续调用得到不同结果（sanitizeDownloadFileName 的已知 bug）。
const CONTROL = /[\u0000-\u001f\u007f]/;
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const TITLE_FALLBACK = 'md2pdf_设置一级标题为文档标题';
const MAX_STEM = 100;
const MAX_VERSION = 40;
const MAX_NAME = 200;

function stripBom(text) {
  return String(text == null ? '' : text).replace(/^\uFEFF/, '');
}

// 限长截断：不劈开代理对（emoji 等 BMP 外字符），并去掉截断后残留的尾点 / 空白。
function clampUnicode(text, max) {
  const value = String(text == null ? '' : text);
  if (max <= 0) return '';
  if (value.length <= max) return value;
  let cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // 高代理：去掉半个字符
  return cut.replace(/[.\s]+$/, '');
}

// 单个文件系统 / 控制字符安全的名称片段：非法字符换下划线，去掉首尾的点与空白，限长。
function sanitizeStem(text) {
  const cleaned = String(text == null ? '' : text).replace(ILLEGAL, '_');
  return clampUnicode(cleaned.replace(/^[.\s]+|[.\s]+$/g, ''), MAX_STEM).trim();
}

function sanitizeVersion(text) {
  const cleaned = String(text == null ? '' : text).replace(ILLEGAL, '_');
  return clampUnicode(cleaned.replace(/^[.\s]+|[.\s]+$/g, ''), MAX_VERSION).trim();
}

// front matter 起始分隔符：容忍行尾空白（与成熟 YAML 解析器保持一致），仅认顶层 ---/+++。
function isFenceDelimiter(line) {
  return /^(?:---|\+\+\+)\s*$/.test(line == null ? '' : String(line));
}

/**
 * 正文首个一级标题（忽略 front matter 与围栏代码块），ATX 与 Setext 都支持。
 * 只返回标题文本，不做文件名转义；未找到时返回 ''。
 */
export function firstHeadingTitle(markdown) {
  const lines = stripBom(markdown).split(/\r?\n/);
  let fence = null;
  let frontMatter = isFenceDelimiter(lines[0]);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (frontMatter) {
      if (i > 0 && /^(---|\.\.\.|\+\+\+)\s*$/.test(line)) frontMatter = false;
      continue;
    }
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) fence = null;
      continue;
    }
    if (marker) { fence = marker[1]; continue; }
    const atx = /^ {0,3}#\s+(.+?)\s*$/.exec(line);
    if (atx) return atx[1].replace(/\s+#+\s*$/, '').trim();
    if (/^ {0,3}\S/.test(line) && /^ {0,3}=+\s*$/.test(lines[i + 1] || '')) return line.trim();
  }
  return '';
}

// 去掉标量外层的引号：单引号用 '' 表示一个撇号；双引号支持 \" \\ \n \t \r 反斜杠转义。
// 引号未闭合（含到行尾仍未收尾）返回 null，视为非法。
function unquoteScalar(text) {
  const quote = text[0];
  let out = '';
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") {
        if (text[i + 1] === "'") { out += "'"; i++; continue; } // '' → 字面撇号
        return out;                                               // 收尾
      }
      out += ch;
    } else if (ch === '\\') {
      const next = text[i + 1];
      if (next === undefined) return null;
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
      i++;
    } else if (ch === '"') {
      return out;
    } else {
      out += ch;
    }
  }
  return null; // 引号未闭合
}

// 极小的单行 YAML 标量解析（不引入 YAML 依赖）：剥离行内注释与引号，
// 拒绝对象 / 列表 / 锚点 / 别名 / 块标量 / null / 布尔；不可用时返回 null。
function parseFrontmatterScalar(raw) {
  let text = String(raw == null ? '' : raw).trim();
  if (!text) return null;
  const first = text[0];
  if (first === '"' || first === "'") {
    const unquoted = unquoteScalar(text);
    if (unquoted === null) return null;
    text = unquoted.trim();
  } else {
    // 未加引号的块 / 对象 / 列表 / 锚点 / 别名：非法。
    if (first === '{' || first === '[' || first === '&' || first === '*' || first === '|' || first === '>') return null;
    // 行内注释：从「行首或空白 + #」开始。
    const comment = text.search(/(^|[ \t])#/);
    if (comment >= 0) text = text.slice(0, comment).trim();
  }
  if (!text) return null;
  if (text[0] === '{' || text[0] === '[') return null;       // 引号包裹的对象 / 列表同样拒绝
  if (/^(?:null|~|true|false)$/i.test(text)) return null;      // null / 布尔不是版本号
  return text;
}

/**
 * front matter 的顶层 title / version 标量：支持带引号（'1.2.3' / "1.2.3"，含转义）与未加引号的
 * 数字 / 文本，并正确剥离行内注释；只认顶层键（嵌套字段不算）。
 * 缺失 / 未闭合 front matter / 对象 / 列表 / 块 / null / 布尔一律返回 ''（调用方采用回退值）。
 */
function frontmatterScalar(markdown, key) {
  const lines = stripBom(markdown).split(/\r?\n/);
  const open = lines[0];
  if (!isFenceDelimiter(open)) return '';
  let raw = null;
  let closed = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^(---|\.\.\.|\+\+\+)\s*$/.test(line)) { closed = true; break; }
    // 只读取顶层字段，忽略嵌套元数据。
    const match = /^(title|version)[ \t]*:[ \t]*(.*)$/.exec(line);
    if (match && match[1] === key && raw === null) raw = match[2];
  }
  if (!closed || raw === null) return ''; // front matter 未闭合 / 无指定顶层字段
  return parseFrontmatterScalar(raw) || '';
}

export function frontmatterVersion(markdown) {
  return sanitizeVersion(frontmatterScalar(markdown, 'version'));
}

/**
 * 计算下载基名：filename_version.ext。
 * @param {string} markdown 文档源码
 * @param {Date} [date] 版本缺省时用于时间戳（本地时间 YYYYMMDD_HHmmss）
 * @param {string} [ext] 扩展名（不含点），默认 md
 * @returns {string}
 */
export function documentDownloadName(markdown, date = new Date(), ext = 'md') {
  const title = sanitizeStem(frontmatterScalar(markdown, 'title')) || sanitizeStem(firstHeadingTitle(markdown)) || TITLE_FALLBACK;
  const version = frontmatterVersion(markdown) || timestamp(date);
  const suffix = String(ext == null ? '' : ext).replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'md';
  return title + '_' + version + '.' + suffix;
}

// 兼容旧调用：Markdown 下载名。
export function markdownDownloadName(markdown, date = new Date()) {
  return documentDownloadName(markdown, date, 'md');
}

function timestamp(date) {
  const pad = n => String(n).padStart(2, '0');
  return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '_' + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}

/**
 * 服务端校验 / 规范化客户端提交的下载名：只保留基名，剔除控制与非法字符，
 * 保证扩展名正确并限长；非法 / 空输入返回 ''（调用方回落到服务端自行计算的名称）。
 */
export function sanitizeDownloadFileName(name, ext = 'pdf') {
  if (typeof name !== 'string' || !name) return '';
  if (CONTROL.test(name)) return ''; // 非全局：同一输入连续调用结果稳定
  const base = name.split(/[\\/]/).pop();
  const cleaned = base.replace(ILLEGAL, '_').replace(/^[.\s]+/, '').trim();
  if (!cleaned) return '';
  const suffix = String(ext == null ? '' : ext).replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'pdf';
  const dotSuffix = '.' + suffix;
  // 扩展名单独保留：长度上限只作用于主干，绝不截断 .pdf 或劈开代理对。
  const hasExt = new RegExp('\\.' + suffix + '$', 'i').test(cleaned);
  const stem = hasExt ? cleaned.slice(0, cleaned.length - dotSuffix.length) : cleaned;
  const tail = hasExt ? cleaned.slice(cleaned.length - dotSuffix.length) : dotSuffix;
  const bounded = clampUnicode(stem, Math.max(0, MAX_NAME - tail.length));
  return (bounded || 'document') + tail;
}
