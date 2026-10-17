import { parseFrontmatter } from './config.mjs';
import { detectProfile, PROFILE_NAMES } from './profiles.mjs';
import { effectiveOptions, assertOptionsAllowed, frontmatterOverrides, policyForType } from './web-options.mjs';
import { sanitizeDownloadFileName } from '../web/editor-files.mjs';
const error = (status, message) => Object.assign(new Error(message), { status });

// —— 内嵌图片容量预算 ——
// 仅「Markdown 图片 token 且严格合法的内嵌 PNG/JPEG/GIF/WebP Base64 Data URL」才从正文字符预算中扣除。
// 代码围栏/缩进代码/行内代码里的“图片”不算图片（否则可借假图片绕过正文限额）；裸 Data URL、非图片 Data URL、
// 支持列表之外的类型或非法 Base64 一律照常计入正文预算，因此超限时会被拒绝而不是被排除。
const IMAGE_SINGLE_BYTES = 10 * 1024 * 1024;
const IMAGE_TOTAL_BYTES = 16 * 1024 * 1024;
// 严格形态：小写媒体类型 + ;base64, + 合法 Base64 载荷（4 字符一组，仅末尾可补 =，最多两个）。
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
// 只识别 Markdown 图片 token 形态 ![...](data:image/...)，不扫描裸 Data URL。
// 前缀用有界正则（alt 上限 1000）校验，配合 indexOf 顺序扫描避免病态回溯。
const IMAGE_PREFIX = /!\[[^\]]{0,1000}\]$/;

// 标记 fenced / indented 代码块与行内代码覆盖的字节，供预算扫描跳过。
function codeMask(src) {
  const n = src.length;
  const mask = new Uint8Array(n);
  let s = 0;
  for (let i = 0; i <= n; i++) {
    if (i !== n && src[i] !== '\n') continue;
    const line = src.slice(s, i);
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (open) {
      const marker = open[1];
      mask.fill(1, s, i);
      let closed = false;
      let j = i + 1;
      while (j <= n) {
        const nl = src.indexOf('\n', j);
        const end = nl === -1 ? n : nl;
        const body = src.slice(j, end);
        mask.fill(1, j, end);
        const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(body);
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length) { closed = true; j = end + 1; break; }
        if (nl === -1) { j = end + 1; break; }
        j = nl + 1;
      }
      i = closed ? j - 1 : n;
      s = i + 1;
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) mask.fill(1, s, i);
    s = i + 1;
  }
  // 行内代码：同长度的反引号 run 配对，忽略被代码块遮罩的位置。
  const pending = new Map();
  for (let idx = 0; idx < n;) {
    if (!mask[idx] && src[idx] === '`') {
      let k = idx; while (k < n && src[k] === '`') k++;
      const len = k - idx;
      if (pending.has(len)) { mask.fill(1, pending.get(len), k); pending.delete(len); }
      else pending.set(len, idx);
      idx = k;
    } else idx++;
  }
  return mask;
}

// 统计可扣除的图片字符数与解码字节数；解析失败时按“无图片”处理（全部计入正文，失败关闭）。
export function imageBudget(md) {
  const stats = { excluded: 0, totalBytes: 0, largestBytes: 0, images: 0 };
  if (!/data:image\//i.test(md)) return stats;
  let mask;
  try { mask = codeMask(md); } catch { return stats; }
  const n = md.length;
  const isBreak = c => c === 41 || c === 62 || c === 32 || c === 9 || c === 10 || c === 13; // ) > 空格/Tab/换行
  for (let u = md.indexOf('data:image/'); u !== -1; u = md.indexOf('data:image/', u + 11)) {
    // 向前回溯定位 ![...]( 前缀；若落在代码块/行内代码内则跳过。
    let q = u - 1;
    if (q >= 0 && md[q] === '<') q--;
    while (q >= 0 && (md[q] === ' ' || md[q] === '\t' || md[q] === '\n' || md[q] === '\r')) q--;
    if (q < 0 || md[q] !== '(') continue;
    const prefixStart = Math.max(0, q - 1005);
    const prefix = md.slice(prefixStart, q);
    const token = IMAGE_PREFIX.exec(prefix);
    if (!token) continue;
    let slashes = 0;
    for (let j = prefixStart + token.index - 1; j >= 0 && md[j] === '\\'; j--) slashes++;
    if (slashes % 2 || mask[prefixStart + token.index]) continue; // 位于代码块/行内代码内：不算图片
    // 向前截取 URL 直到分隔符（) > 空白）；再按严格 Base64 规则校验。
    let end = u;
    while (end < n && !isBreak(md.charCodeAt(end))) end++;
    const url = md.slice(u, end);
    // Require a complete image destination, not an unfinished or escaped prefix.
    if (md[u - 1] === '<') { if (md[end] !== '>') continue; end++; }
    if (!/^\s*(?:"[^"\n]*"|'[^'\n]*'|\([^\)\n]*\))?\s*\)/.test(md.slice(end))) continue;
    const parsed = IMAGE_DATA_URL.exec(url);
    if (!parsed) continue; // 非图片、非法 Base64 或长度不合法：照常计入正文
    const payload = parsed[2];
    if (payload.length === 0 || payload.length % 4 !== 0) continue;
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    const bytes = (payload.length / 4) * 3 - padding;
    if (bytes <= 0) continue;
    stats.images++;
    stats.totalBytes += bytes;
    stats.largestBytes = Math.max(stats.largestBytes, bytes);
    stats.excluded += url.length;
  }
  return stats;
}
const formatMiB = bytes => (bytes / (1024 * 1024)).toFixed(1); // 仅用于错误提示的粗略显示

export function validateInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['md', 'opts', 'filename'].includes(k))) throw error(400, '请求必须包含 md 和可选 opts');
  if (typeof body.md !== 'string' || !body.md.trim()) throw error(400, '请输入 Markdown 正文');
  // 合法内嵌图片的 Data URL 不计入正文字符预算；其余（含代码内假图片、非图片/非法 Data URL）照常计入。
  const images = imageBudget(body.md);
  if (images.largestBytes > IMAGE_SINGLE_BYTES) throw error(413, `单张图片约 ${formatMiB(images.largestBytes)} MiB，超过 10 MiB 上限，请压缩或降低分辨率后重试`);
  if (images.totalBytes > IMAGE_TOTAL_BYTES) throw error(413, `内嵌图片合计约 ${formatMiB(images.totalBytes)} MiB，超过 16 MiB 上限，请删减或压缩图片后重试`);
  const bodyChars = body.md.length - images.excluded;
  if (bodyChars > 200000 || body.md.split('\n').length > 5000 || (body.md.match(/^#{1,6}\s/gm) || []).length > 300 || (body.md.match(/^\s*```mermaid\b/gm) || []).length > 50) throw error(413, '文档过大或过于复杂');
  // TeX-generated URLs bypass the Markdown link renderer; omit resource/link macros in the web version.
  if (/\\(?:href|url|includegraphics|require|def|gdef|edef|xdef|newcommand|renewcommand|let|csname)\b/i.test(body.md)) throw error(400, '在线版本不支持公式中的链接、外部资源或自定义宏');
  const opts = body.opts ?? {};
  if (typeof opts !== 'object' || !opts || Array.isArray(opts)) throw error(400, 'opts 必须是对象');
  const enums = { type: ['general', 'skill', 'paper', 'gb'], theme: ['elegant', 'minimal', 'gb'], numbering: ['auto', 'force', 'none'], numberScheme: ['arabic', 'gb', 'cjk', 'chapter'] };
  if (opts.tocDepth !== undefined && ![1, 2].includes(opts.tocDepth)) throw error(400, '无效选项：tocDepth');
  const booleans = ['toc', 'landscape'];
  const numbers = { tocDepth: [1, 2], fontSize: [8, 24], lineHeight: [1, 2.5], marginTop: [10, 40], marginBottom: [10, 40], marginSide: [10, 40], marginLeft: [10, 40], marginRight: [10, 40] };
  for (const [key, value] of Object.entries(opts)) {
    if (Object.hasOwn(enums, key)) { if (!enums[key].includes(value)) throw error(400, `无效选项：${key}`); }
    else if (booleans.includes(key)) { if (typeof value !== 'boolean') throw error(400, `无效选项：${key}`); }
    else if (Object.hasOwn(numbers, key)) { if (typeof value !== 'number' || !Number.isFinite(value) || value < numbers[key][0] || value > numbers[key][1]) throw error(400, `无效选项：${key}`); }
    else throw error(400, `不支持的选项：${key}`);
  }
  // 可选：前端提交的下载基名（filename_version.pdf）。只接受字符串，服务端再次净化；
  // 非法 / 空值直接拒绝，避免把任意文本带进 Content-Disposition。
  let filename = '';
  if (body.filename !== undefined) {
    if (typeof body.filename !== 'string') throw error(400, 'filename 必须是字符串');
    filename = sanitizeDownloadFileName(body.filename, 'pdf');
    if (!filename) throw error(400, 'filename 非法');
  }
  return { md: body.md, opts: { ...opts, pagedHtml: true }, filename };
}


// 在线接口与静态适配器共用解析、优先级及可调选项校验。
export function resolveWebInput(body) {
  const { md, opts, filename } = validateInput(body);
  const { fm, positions } = parseFrontmatter(md);
  const explicitType = opts.type ?? fm.type;
  if (explicitType !== undefined && explicitType !== '' && !PROFILE_NAMES.includes(explicitType)) throw error(400, `未知文档类型：${explicitType}（可用：${PROFILE_NAMES.join(', ')}）`);
  const type = detectProfile({ basename:'', fm, explicit:explicitType || undefined }).name;
  const effective = effectiveOptions(opts, type, fm, positions);
  assertOptionsAllowed(opts, type, frontmatterOverrides(fm));
  return { md, opts, filename, type, effective, policy:policyForType(type, effective) };
}
