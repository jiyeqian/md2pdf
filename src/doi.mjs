// DOI -> BibTeX 解析（无 LLM，仅访问固定的 Crossref / DataCite HTTPS 接口）。
// 两个导出：
//   normalizeDoi(input) -> 规范化并校验 DOI（无效抛 status=400 的中文错误）
//   createDoiResolver(options) -> { resolve(input) }
//
// 设计要点：
//  - 只访问固定的 HTTPS 上游主机，DOI 路径整体百分号编码，绝不使用用户提供的任意主机；
//  - fetch 使用 redirect:'error'、无凭证、响应体上限 512KB，请求与读体共享同一超时；
//  - Crossref 404 时才回退 DataCite；其它上游错误直接失败（不做无界重试）；
//  - 缺失必需字段（标题/年份/类型）抛 422，缺人少卷等只记为中文 warnings，绝不臆造数据。

const CROSSREF_HOST = 'api.crossref.org';
const DATACITE_HOST = 'api.datacite.org';
const MAX_INPUT = 512;
const MAX_BODY = 512 * 1024;
const DOI_LINK_HOSTS = new Set(['doi.org', 'dx.doi.org', 'www.doi.org']);
const DOI_RE = /^10\.\d{4,9}\/\S+$/i;
const BAD_CHARS_RE = /[\u0000-\u001f\u007f\s]/;

const CROSSREF_TYPES = {
  'journal-article': 'article',
  'proceedings-article': 'inproceedings',
  book: 'book',
};
const DATACITE_TYPES = {
  journalarticle: 'article',
  conferencepaper: 'inproceedings',
  book: 'book',
};

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ---------------------------------------------------------------- normalize

export function normalizeDoi(input) {
  if (typeof input !== 'string') throw fail(400, 'DOI 必须是字符串');
  if (input.length > MAX_INPUT) throw fail(400, 'DOI 过长（超过 512 个字符）');
  let s = input.trim();
  if (!s) throw fail(400, '无效的 DOI：输入为空');
  if (/[\u0000-\u001f\u007f]/.test(s)) throw fail(400, 'DOI 不能包含控制字符');

  // 去掉可选的 doi: / DOI: 前缀
  s = s.replace(/^doi:\s*/i, '').trim();

  // https://doi.org/... 或 dx.doi.org 链接
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    let url;
    try {
      url = new URL(s);
    } catch {
      throw fail(400, '无效的 DOI 链接');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw fail(400, '仅支持 http(s) 的 DOI 链接');
    }
    if (!DOI_LINK_HOSTS.has(url.hostname.toLowerCase())) {
      throw fail(400, '仅支持 doi.org 或 dx.doi.org 的 DOI 链接');
    }
    if (url.port) throw fail(400, 'DOI 链接不能包含自定义端口');
    if (url.username || url.password) throw fail(400, 'DOI 链接不能包含用户名或密码');
    if (url.search) throw fail(400, 'DOI 链接不能包含查询参数');
    if (url.hash) throw fail(400, 'DOI 链接不能包含片段标识');
    let path = url.pathname.replace(/^\//, '');
    try {
      path = decodeURIComponent(path);
    } catch {
      throw fail(400, 'DOI 链接包含非法的百分号编码');
    }
    s = path.trim();
  }

  if (BAD_CHARS_RE.test(s)) throw fail(400, 'DOI 不能包含空白或控制字符');
  if (!DOI_RE.test(s)) throw fail(400, 'DOI 格式无效，应为 10.xxxx/xxxx 的形式');
  // 保留原始大小写（仅在比较/缓存时小写化），不擅自裁剪合法尾随字符。
  return s;
}

// ---------------------------------------------------------------- fetch

async function readCapped(res, ctx) {
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value && typeof value.byteLength === 'number' ? value.byteLength : value.length;
      if (total > MAX_BODY) {
        try { ctx.controller.abort(); } catch { /* ignore */ }
        throw fail(502, '上游返回的响应体过大');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
  }
  const text = typeof res.text === 'function' ? await res.text() : '';
  if (Buffer.byteLength(text) > MAX_BODY) {
    try { ctx.controller.abort(); } catch { /* ignore */ }
    throw fail(502, '上游返回的响应体过大');
  }
  return text;
}

// 请求单个固定接口；返回 { notFound:true } 或 { data }。
async function requestJson(url, ctx) {
  const remaining = ctx.deadline - Date.now();
  if (remaining <= 0) throw fail(504, '请求上游超时');

  let settled = false;
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      if (settled) return;
      ctx.timedOut = true;
      try { ctx.controller.abort(); } catch { /* ignore */ }
      reject(fail(504, '请求上游超时'));
    }, remaining);
  });

  const work = (async () => {
    let res;
    try {
      res = await ctx.fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        signal: ctx.controller.signal,
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      if (ctx.timedOut || (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR'))) {
        throw fail(504, '请求上游超时');
      }
      throw fail(502, '无法访问上游服务');
    }
    if (!res || typeof res.status !== 'number') throw fail(502, '上游返回了无效的响应');
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw fail(502, '上游服务返回错误（HTTP ' + res.status + '）');
    const text = await readCapped(res, ctx);
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw fail(502, '上游返回的数据无法解析为 JSON');
    }
    return { data };
  })();

  try {
    return await Promise.race([work, timeout]);
  } finally {
    settled = true;
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- metadata parsing

function firstString(v) {
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === 'string' && item.trim()) return item;
    }
    return null;
  }
  return typeof v === 'string' && v.trim() ? v : null;
}

function yearFromParts(obj) {
  const y = obj && Array.isArray(obj['date-parts']) && obj['date-parts'][0] && obj['date-parts'][0][0];
  return Number.isInteger(y) ? y : null;
}

function yearFromDateString(s) {
  const m = /(\d{4})/.exec(String(s || ''));
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isInteger(y) ? y : null;
}

function mapType(source, rawType) {
  const key = String(rawType || '').trim().toLowerCase();
  const table = source === 'datacite' ? DATACITE_TYPES : CROSSREF_TYPES;
  const mapped = table[key];
  if (mapped) return mapped;
  throw fail(422, '不支持的文献类型：' + (rawType || '（缺失）') + '（仅支持期刊论文、会议论文与图书）');
}

function crossrefAuthors(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    const family = typeof a.family === 'string' ? a.family.trim() : '';
    const given = typeof a.given === 'string' ? a.given.trim() : '';
    if (family || given) out.push({ family, given });
    else {
      const literal = (typeof a.name === 'string' && a.name) || (typeof a.literal === 'string' && a.literal) || '';
      if (literal.trim()) out.push({ literal: literal.trim() });
    }
  }
  return out;
}

function dataciteAuthors(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const family = typeof c.familyName === 'string' ? c.familyName.trim() : '';
    const given = typeof c.givenName === 'string' ? c.givenName.trim() : '';
    if (family || given) { out.push({ family, given }); continue; }
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    if (!name) continue;
    if (c.nameType === 'Personal' && name.includes(',')) {
      const idx = name.indexOf(',');
      out.push({ family: name.slice(0, idx).trim(), given: name.slice(idx + 1).trim() });
    } else {
      out.push({ literal: name });
    }
  }
  return out;
}

function crossrefYear(m) {
  const candidates = [m.issued, m['published-print'], m['published-online'], m.published];
  for (const c of candidates) {
    const y = yearFromParts(c);
    if (y) return y;
  }
  return null;
}

function parseCrossref(data, inputDoi) {
  const m = data && data.message;
  if (!m || typeof m !== 'object') throw fail(502, 'Crossref 返回的数据结构异常');
  const page = firstString(m.page);
  return {
    rawType: typeof m.type === 'string' ? m.type : '',
    title: firstString(m.title) || '',
    authors: crossrefAuthors(m.author),
    year: crossrefYear(m),
    venue: firstString(m['container-title']),
    publisher: firstString(m.publisher),
    address: firstString(m['publisher-location']),
    volume: firstString(m.volume),
    number: firstString(m.issue),
    pages: page ? page.replace(/(\d)\s*-\s*(\d)/g, '$1--$2') : null,
    doi: firstString(m.DOI) || inputDoi,
    url: firstString(m.URL),
  };
}

function parseDataCite(data, inputDoi) {
  const a = data && data.data && data.data.attributes;
  if (!a || typeof a !== 'object') throw fail(502, 'DataCite 返回的数据结构异常');
  let year = Number.isInteger(a.publicationYear) ? a.publicationYear : null;
  if (!year && Array.isArray(a.dates)) {
    const ordered = a.dates.slice().sort((x, y) => (x && x.dateType === 'Issued' ? -1 : 0) - (y && y.dateType === 'Issued' ? -1 : 0));
    for (const d of ordered) {
      if (!d || d.dateType !== 'Issued') continue;
      const y = yearFromDateString(d && d.date);
      if (y) { year = y; break; }
    }
  }
  const container = a.container && typeof a.container === 'object' ? a.container : {};
  const firstPage = firstString(container.firstPage);
  const lastPage = firstString(container.lastPage);
  let pages = null;
  if (firstPage && lastPage && firstPage !== lastPage) pages = firstPage + '--' + lastPage;
  else if (firstPage) pages = firstPage;
  return {
    rawType: a.types && DATACITE_TYPES[String(a.types.resourceType || '').toLowerCase()]
      ? a.types.resourceType : (a.types && a.types.resourceTypeGeneral) || '',
    title: (Array.isArray(a.titles) && a.titles[0] && firstString(a.titles[0].title)) || firstString(a.title) || '',
    authors: dataciteAuthors(a.creators),
    year,
    venue: firstString(container.title),
    publisher: firstString(a.publisher),
    address: null,
    volume: firstString(container.volume),
    number: firstString(container.issue),
    pages,
    doi: firstString(a.doi) || inputDoi,
    url: firstString(a.url),
  };
}

// ---------------------------------------------------------------- BibTeX

// 按 $...$ 数学区间保护 TeX：数学内不转义，数学外转义 BibTeX 危险字符。
// 保留花括号（大小写保护）与已有的反斜杠命令；不破坏标题中的 TeX。
function texEscapeText(s) {
  const str = String(s).replace(/[\u0000-\u001f\u007f]/g, ' ');
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') { i++; continue; }
    if (str[i] === '{') depth++;
    if (str[i] === '}' && --depth < 0) throw fail(422, '元数据包含不匹配的花括号，请手动填写 BibTeX');
  }
  if (depth) throw fail(422, '元数据包含不匹配的花括号，请手动填写 BibTeX');
  let out = '';
  let math = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '\\') {
      out += c + (str[i + 1] || '');
      i++;
      continue;
    }
    if (c === '$') { math ^= 1; out += c; continue; }
    if (!math && (c === '&' || c === '%' || c === '#' || c === '_')) { out += '\\' + c; continue; }
    out += c;
  }
  return out;
}

// 去掉 HTML 标记与基础实体，得到安全的纯文本（不注入 HTML）。
function cleanTitle(raw) {
  if (typeof raw !== 'string') return '';
  const hadMarkup = /<[^>]*>|&(amp|lt|gt|quot|#39);/.test(raw);
  let s = raw.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return { title: s, hadMarkup };
}

function asciiSlug(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 40);
}

function hash36(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function makeKey(doi, year, authors, title) {
  const fam = asciiSlug(authors && authors[0] && (authors[0].family || authors[0].literal));
  const base = (fam + (year ? String(year) : '')).replace(/[^a-z0-9]/g, '');
  const stem = base.length >= 3 ? base : 'ref';
  return stem + '_' + hash36(String(doi).toLowerCase());
}

function formatAuthor(a) {
  if (a.literal) return '{' + texEscapeText(a.literal) + '}';
  const fam = (a.family || '').trim();
  const given = (a.given || '').trim();
  if (fam && given) return texEscapeText(fam) + ', ' + texEscapeText(given);
  return texEscapeText(fam || given || '');
}

function formatBibtex(type, key, fields) {
  const body = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => '  ' + k + ' = {' + v + '}');
  return '@' + type + '{' + key + ',\n' + body.join(',\n') + '\n}\n';
}

function validYear(y) {
  return Number.isInteger(y) && y > 1450 && y < 3000;
}

function finish(source, meta, inputDoi) {
  const type = mapType(source, meta.rawType);

  const cleaned = cleanTitle(meta.title);
  if (!cleaned.title) throw fail(422, '提供方元数据缺少有效标题，无法生成 BibTeX');

  const warnings = [];
  if (cleaned.hadMarkup) warnings.push('标题中的标记已转换为纯文本');

  const year = validYear(meta.year) ? meta.year : null;
  if (!year) throw fail(422, '提供方元数据缺少出版年份，无法生成 BibTeX');

  const authors = (Array.isArray(meta.authors) ? meta.authors : []).map(formatAuthor).filter(Boolean);
  if (!authors.length) warnings.push('缺少作者信息（已省略 author 字段）');
  if (type !== 'book' && !meta.venue) warnings.push(type === 'article' ? '缺少期刊名称' : '缺少会议论文集名称');
  if (type === 'book' && !meta.publisher) warnings.push('缺少出版者');
  if (type === 'article' && !meta.volume) warnings.push('缺少卷号');
  if (!meta.pages) warnings.push('缺少页码');

  const metaDoi = typeof meta.doi === 'string' && DOI_RE.test(meta.doi.trim()) ? meta.doi.trim() : inputDoi;
  if (metaDoi.toLowerCase() !== inputDoi.toLowerCase()) throw fail(502, '提供方返回了不同 DOI 的文献信息');
  const url = typeof meta.url === 'string' && /^https?:\/\//i.test(meta.url) ? meta.url : 'https://doi.org/' + metaDoi;

  const fields = { title: texEscapeText(cleaned.title) };
  if (authors.length) fields.author = authors.join(' and ');
  fields.year = String(year);
  if (type === 'article' && meta.venue) fields.journal = texEscapeText(meta.venue);
  if (type === 'inproceedings' && meta.venue) fields.booktitle = texEscapeText(meta.venue);
  if (meta.publisher) fields.publisher = texEscapeText(meta.publisher);
  if (meta.address) fields.address = texEscapeText(meta.address);
  if (meta.volume) fields.volume = texEscapeText(String(meta.volume));
  if (meta.number) fields.number = texEscapeText(String(meta.number));
  if (meta.pages) fields.pages = texEscapeText(String(meta.pages));
  fields.doi = texEscapeText(metaDoi);
  fields.url = texEscapeText(url);

  const key = makeKey(metaDoi, year, meta.authors, cleaned.title);
  const bibtex = formatBibtex(type, key, fields);
  return { doi: metaDoi, bibtex, warnings, source };
}

// ---------------------------------------------------------------- resolver

async function resolveDoi(doi, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const ctx = { fetchImpl, controller, deadline, timedOut: false };
  const outer = setTimeout(() => {
    ctx.timedOut = true;
    try { controller.abort(); } catch { /* ignore */ }
  }, timeoutMs);
  try {
    const encoded = encodeURIComponent(doi);
    const cr = await requestJson('https://' + CROSSREF_HOST + '/works/' + encoded, ctx);
    if (!cr.notFound) return finish('crossref', parseCrossref(cr.data, doi), doi);

    const dc = await requestJson('https://' + DATACITE_HOST + '/dois/' + encoded, ctx);
    if (dc.notFound) throw fail(404, '未找到该 DOI 对应的元数据：' + doi);
    return finish('datacite', parseDataCite(dc.data, doi), doi);
  } finally {
    clearTimeout(outer);
  }
}

export function createDoiResolver({ fetchImpl = globalThis.fetch, timeoutMs = 10000, cacheLimit = 100 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('createDoiResolver 需要可用的 fetch 实现');
  const cache = new Map();
  const inflight = new Map();

  async function resolve(input) {
    const doi = normalizeDoi(input);
    const key = doi.toLowerCase();
    if (cache.has(key)) return cache.get(key);
    if (inflight.has(key)) return inflight.get(key);

    const pending = (async () => {
      const result = await resolveDoi(doi, fetchImpl, timeoutMs);
      if (cacheLimit > 0) {
        if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value);
        cache.set(key, result);
      }
      return result;
    })();
    inflight.set(key, pending);
    try {
      return await pending;
    } finally {
      inflight.delete(key);
    }
  }

  return { resolve };
}
