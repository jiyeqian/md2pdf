/**
 * config —— frontmatter 解析与文档级配置合并（唯一事实来源）
 *
 * 职责：
 *   1. parseFrontmatter(src)：解析 YAML frontmatter，返回 { fm, body, positions }。
 *      YAML 语法错误 / 重复键 / 配置字段类型或取值无效 / 启用-禁用冲突都在此抛 ConfigError。
 *   2. resolveDocumentOptions(explicit, fm, profile, context)：按
 *      显式(CLI/Web) > frontmatter > 文档类型默认 > 全局默认 合并出「生效选项」。
 *   3. validateFrontmatter(fm, positions)：对已有 fm 做同一套校验（供调用方复用）。
 *
 * 命名约定：配置字段在 frontmatter 中同时接受 kebab-case（与 CLI 同名，如 font-size）
 * 与历史 camelCase（fontSize）；同一层两种写法取值一致时允许，矛盾时报错。
 * 普通元数据字段（name / author / 标准号 / description …）不做配置校验，原样保留，
 * 允许 null / 列表 / 对象。
 *
 * 安全：解析结果经 sanitize 深拷贝，剔除 __proto__ / prototype / constructor，
 * 防止 YAML 反序列化污染原型；解析设置 maxAliasCount 上限，避免别名炸弹。
 */
import { TEXT_FIELDS, NUMBER_FIELDS, BOOL_FIELDS, CONTROL_FIELDS, SPECIAL_FIELDS, CONFIG_FIELDS, FM_ALIASES, NUMBERING_VALUES, BIBLIOGRAPHY_VALUES } from './frontmatter-fields.mjs';
import * as YAML from '../vendor/yaml/yaml.mjs';
import { GLOBAL_OPTION_DEFAULTS, FEATURES, RUNTIME_FEATURES, listThemes } from './options.mjs';
import { PROFILE_NAMES } from './profiles.mjs';
import { SCHEME_NAMES } from './numbering.mjs';

/* ---------------- 错误 ---------------- */

/**
 * 配置错误：CLI / Web 统一消费。
 * - status 固定 400（Web 直接用；CLI 据此返回非零退出码）
 * - configErrors: [{ message, line, column, field }]，line 为源文件 1 基行号
 */
export class ConfigError extends Error {
  constructor(message, configErrors = [], status = 400) {
    super(message);
    this.name = 'ConfigError';
    this.status = status;
    const list = Array.isArray(configErrors) && configErrors.length ? configErrors : [{}];
    this.configErrors = list.map(e => ({
      message: e.message != null ? e.message : message,
      line: e.line != null ? e.line : null,
      column: e.column != null ? e.column : null,
      field: e.field != null ? e.field : null,
    }));
  }
}

const cfgError = (message, field, pos) => new ConfigError(message, [{
  message, field,
  line: pos && pos.line != null ? pos.line : null,
  column: pos && pos.column != null ? pos.column : null,
}]);

const fmtValue = v => {
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '列表';
  if (v && typeof v === 'object') return '对象';
  if (v === null || v === undefined) return '空值';
  return String(v);
};
const typeName = v => {
  if (v === null || v === undefined) return '空值';
  if (Array.isArray(v)) return '列表';
  if (typeof v === 'object') return '对象';
  if (typeof v === 'string') return '字符串';
  if (typeof v === 'number') return '数值';
  if (typeof v === 'boolean') return '布尔值';
  return typeof v;
};

/* ---------------- 字段表 ---------------- */

const ENUM_FIELDS = {
  theme: { label: '主题', values: () => listThemes() },
  type: { label: '文档类型', values: () => PROFILE_NAMES.slice() },
  numbering: { label: '编号模式', values: () => NUMBERING_VALUES.slice() },
  numberScheme: { label: '编号方案', values: () => SCHEME_NAMES.slice() },
};
export function frontmatterValueCatalog() {
  return Object.fromEntries(Object.entries(ENUM_FIELDS).map(([key, definition]) => [key, definition.values()]));
}

const canonicalField = raw => {
  if (!raw) return null;
  if (CONFIG_FIELDS.has(raw)) return raw;
  for (const [canon, aliases] of Object.entries(FM_ALIASES)) {
    if (aliases.includes(raw)) return canon;
  }
  return null;
};

const MERGE_KEYS = [
  ...TEXT_FIELDS,
  ...BOOL_FIELDS,
  ...Object.keys(ENUM_FIELDS),
  'fontSize', 'lineHeight', 'tocDepth', 'bibliography',
];

/* ---------------- 值规范化 ---------------- */

const toNumber = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    // 数字字符串同样必须有限：否决 Infinity / -Infinity / NaN / 1e999 等
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const toBool = (v, rawKey, canon, pos) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number' && (v === 1 || v === 0)) return v === 1;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off'].includes(s)) return false;
  }
  throw cfgError(`字段 ${rawKey} 需要布尔值（当前：${typeName(v)}）`, canon, pos);
};

const coerceText = (v, rawKey, canon, pos) => {
  if (typeof v !== 'string') {
    throw cfgError(`字段 ${rawKey} 必须为字符串（当前：${typeName(v)}）`, canon, pos);
  }
  return v;
};

const coerceNumber = (v, rawKey, canon, pos) => {
  const n = toNumber(v);
  if (n === null) {
    throw cfgError(`字段 ${rawKey} 需要数值${v === '' || v == null ? '（不能为空）' : `（当前：${typeName(v)}）`}`, canon, pos);
  }
  const spec = NUMBER_FIELDS[canon] || {};
  if (spec.min != null && n < spec.min) throw cfgError(`字段 ${rawKey} 的数值过小：${n}（最小 ${spec.min}）`, canon, pos);
  if (spec.enum && !spec.enum.includes(n)) throw cfgError(`字段 ${rawKey} 取值无效：${n}（可用：${spec.enum.join('、')}）`, canon, pos);
  return n;
};

const coerceEnum = (v, rawKey, canon, pos) => {
  const spec = ENUM_FIELDS[canon];
  const allowed = spec.values();
  if (typeof v !== 'string' || v.trim() === '') {
    throw cfgError(`字段 ${rawKey} 不能为空（可用：${allowed.join('、')}）`, canon, pos);
  }
  const s = v.trim();
  if (!allowed.includes(s)) throw cfgError(`未知${spec.label}：${s}（可用：${allowed.join('、')}）`, canon, pos);
  return s;
};

const coerceBoolField = (v, rawKey, canon, pos, tocDepthSink) => {
  if (canon === 'toc') {
    // 兼容 Web 三态：false / 1 / 2（2 同时把目录深度设为二级）
    if (typeof v === 'number' && (v === 0 || v === 1 || v === 2)) {
      if (v === 2 && tocDepthSink) tocDepthSink(2);
      return v !== 0;
    }
    if (typeof v === 'string' && ['0', '1', '2'].includes(v.trim())) {
      const n = Number(v.trim());
      if (n === 2 && tocDepthSink) tocDepthSink(2);
      return n !== 0;
    }
  }
  return toBool(v, rawKey, canon, pos);
};

const coerceBibliography = (v, rawKey, canon, pos, warnings) => {
  if (v === true) return 'footnote';
  if (v === false) {
    warnings.push('字段 bibliography 已废弃：参考文献始终自动处理，不再支持关闭');
    return 'footnote';
  }
  if (BIBLIOGRAPHY_VALUES.includes(v)) return v;
  throw cfgError(`字段 ${rawKey} 取值无效（可用：footnote、bib）`, canon, pos);
};

/* ---------------- 分层摄入（校验 + 冲突检测） ---------------- */

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * 把「原始一层」（frontmatter 对象 / CLI 选项 / profile.defaults）规范化为
 * 规范 camelCase 的字段对象，并做同层冲突检测。
 * @returns {{ fields: object, warnings: string[] }}
 */
function ingestLayer(raw, opts = {}) {
  const { positions = {}, allowRuntimeFeatures = false, warnings = [] } = opts;
  const fields = {};
  const enableList = [];
  const disableList = [];
  const posOf = key => positions[key] || { line: null, column: null };

  const setField = (key, value, rawKey) => {
    if (hasOwn(fields, key) && fields[key] !== value) {
      throw cfgError(
        `字段 ${key} 存在冲突：同时设置为 ${fmtValue(fields[key])} 与 ${fmtValue(value)}（来源字段 ${rawKey}）`,
        key, posOf(rawKey));
    }
    fields[key] = value;
  };

  const setMargin = (value, rawKey) => {
    const pos = posOf(rawKey);
    let top, side;
    if (typeof value === 'number') { top = value; side = value; }
    else if (typeof value === 'string' && value.trim() !== '') {
      const parts = value.split(',').map(s => s.trim());
      const t = toNumber(parts[0]);
      const s = parts[1] !== undefined ? toNumber(parts[1]) : t;
      if (t === null || s === null) throw cfgError(`字段 ${rawKey} 需要「上下」或「上下,左右」数值`, 'margin', pos);
      top = t; side = s;
    } else {
      throw cfgError(`字段 ${rawKey} 需要「上下」或「上下,左右」数值`, 'margin', pos);
    }
    if (top < 0 || side < 0) throw cfgError(`字段 ${rawKey} 的边距不能为负`, 'margin', pos);
    setField('marginTop', top, rawKey);
    setField('marginBottom', top, rawKey);
    setField('marginSide', side, rawKey);
  };

  const readFeatureList = (rawKey, value, pos) => {
    if (!Array.isArray(value)) {
      throw cfgError(`字段 ${rawKey} 必须为功能名列表`, rawKey, pos);
    }
    return value.map(item => {
      if (typeof item !== 'string' || item.trim() === '') {
        throw cfgError(`字段 ${rawKey} 的列表项必须是非空功能名`, rawKey, pos);
      }
      const name = item.trim();
      if (FEATURES[name] !== undefined) return name;
      if (RUNTIME_FEATURES[name] !== undefined) {
        if (!allowRuntimeFeatures) {
          throw cfgError(`运行操作 ${name} 不能由 frontmatter 控制`, rawKey, pos);
        }
        return name;
      }
      const known = [...Object.keys(FEATURES), ...Object.keys(RUNTIME_FEATURES)];
      throw cfgError(`未知功能名：${name}（可用：${known.join('、')}）`, rawKey, pos);
    });
  };

  for (const [rawKey, rawValue] of Object.entries(raw || {})) {
    const canon = canonicalField(rawKey);
    if (canon === null) continue; // 普通元数据：不参与配置
    const pos = posOf(rawKey);
    if (canon === 'enable' || canon === 'disable') {
      const names = readFeatureList(rawKey, rawValue, pos);
      (canon === 'enable' ? enableList : disableList).push(...names.map(n => [n, rawKey]));
      continue;
    }
    if (TEXT_FIELDS.includes(canon)) { setField(canon, coerceText(rawValue, rawKey, canon, pos), rawKey); continue; }
    if (canon in NUMBER_FIELDS) { setField(canon, coerceNumber(rawValue, rawKey, canon, pos), rawKey); continue; }
    if (BOOL_FIELDS.includes(canon)) {
      setField(canon, coerceBoolField(rawValue, rawKey, canon, pos, d => setField('tocDepth', d, rawKey)), rawKey);
      continue;
    }
    if (canon in ENUM_FIELDS) { setField(canon, coerceEnum(rawValue, rawKey, canon, pos), rawKey); continue; }
    if (canon === 'margin') { setMargin(rawValue, rawKey); continue; }
    if (canon === 'bibliography') { setField(canon, coerceBibliography(rawValue, rawKey, canon, pos, warnings), rawKey); continue; }
  }

  for (const [name, rawKey] of enableList) {
    const key = FEATURES[name] || RUNTIME_FEATURES[name];
    if (hasOwn(fields, key) && fields[key] !== true) {
      throw cfgError(`字段 ${key} 存在冲突：已禁用又被启用（功能 ${name}）`, key, posOf(rawKey));
    }
    fields[key] = true;
  }
  for (const [name, rawKey] of disableList) {
    const key = FEATURES[name] || RUNTIME_FEATURES[name];
    if (hasOwn(fields, key) && fields[key] !== false) {
      throw cfgError(`字段 ${key} 存在冲突：已启用又被禁用（功能 ${name}）`, key, posOf(rawKey));
    }
    fields[key] = false;
  }

  return { fields, warnings };
}

/* ---------------- frontmatter 解析 ---------------- */

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

// 别名展开后的结构边界：防止循环引用 / 超深嵌套 / 节点爆炸拖垮进程。
const MAX_FM_DEPTH = 64;
const MAX_FM_NODES = 10000;

/**
 * 深拷贝解析结果并剔除危险键。
 * 用祖先栈检测循环引用（允许别名在非祖先分支上合法复用），
 * 并对嵌套深度与访问节点数设上限，超限抛 ConfigError（status 400）而非原生 RangeError。
 */
function sanitize(root) {
  const ancestors = new Set();
  let nodes = 0;

  const walk = (value, depth) => {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Date) return value;
    if (ancestors.has(value)) {
      throw cfgError('frontmatter 含循环引用（别名自引用），已拒绝解析', null, null);
    }
    if (depth > MAX_FM_DEPTH) {
      throw cfgError('frontmatter 嵌套层级过深，已超出安全限制', null, null);
    }
    if (++nodes > MAX_FM_NODES) {
      throw cfgError('frontmatter 结构过大（节点数超出安全限制）', null, null);
    }
    ancestors.add(value);
    let out;
    if (Array.isArray(value)) {
      out = value.map(item => walk(item, depth + 1));
    } else {
      out = {};
      for (const k of Object.keys(value)) {
        if (DANGEROUS_KEYS.has(k)) continue;
        out[k] = walk(value[k], depth + 1);
      }
    }
    ancestors.delete(value);
    return out;
  };

  return walk(root, 0);
}

const stripHtmlComments = text => text.replace(/<!--[\s\S]*?-->/g, s => s.replace(/[^\n]/g, ' '));

function lineColAt(text, offset) {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') { line++; last = i; }
  }
  return { line, column: offset - last };
}

function yamlError(issues, yamlText) {
  const errors = issues.map(issue => {
    const lp = issue.linePos && issue.linePos[0];
    const rel = lp ? lp.line : null;
    const line = rel != null ? rel + 1 : null;
    const column = lp ? lp.col : null;
    let field = null;
    let message;
    if (issue.code === 'DUPLICATE_KEY' && rel != null) {
      const text = (yamlText.split('\n')[rel - 1] || '').trim();
      field = text.split(':')[0].trim() || null;
      message = `frontmatter 存在重复字段${field ? '：' + field : ''}（第 ${line} 行）`;
    } else {
      message = `frontmatter 解析失败（第 ${line != null ? line : '?'} 行，第 ${column != null ? column : '?'} 列）`;
    }
    return { message, line, column, field };
  });
  return new ConfigError(errors[0].message, errors);
}

/**
 * 解析 Markdown 源：抽取 YAML frontmatter。
 * @param {string} src
 * @returns {{ fm: object, body: string, positions: object }}
 * @throws {ConfigError}
 */
export function parseFrontmatter(src) {
  const text = src == null ? '' : String(src);
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { fm: {}, body: text, positions: {}, config: {} };

  const body = text.slice(m[0].length);
  const yamlText = stripHtmlComments(m[1]);
  const doc = YAML.parseDocument(yamlText, { uniqueKeys: true, maxAliasCount: 100 });

  if (doc.errors && doc.errors.length) throw yamlError(doc.errors, yamlText);

  const positions = {};
  const contents = doc.contents;

  // frontmatter 根必须是字段映射：空文档 / 仅注释视为 {}；非空标量或列表报错并给出源位置。
  if (contents != null && !YAML.isMap(contents)) {
    const kind = YAML.isSeq(contents) ? '列表' : '标量';
    let pos = null;
    if (contents.range) {
      const { line, column } = lineColAt(yamlText, contents.range[0]);
      pos = { line: line + 1, column };
    }
    throw cfgError(
      `frontmatter 根必须是字段映射（mapping），当前为${kind}${pos ? `（第 ${pos.line} 行）` : ''}`,
      null, pos);
  }

  if (contents && Array.isArray(contents.items)) {
    for (const item of contents.items) {
      const rawKey = item.key && item.key.value != null ? String(item.key.value) : '';
      if (!rawKey) continue;
      if (item.key && item.key.range) {
        const { line, column } = lineColAt(yamlText, item.key.range[0]);
        positions[rawKey] = { line: line + 1, column };
      } else {
        positions[rawKey] = { line: null, column: null };
      }
    }
  }

  // 别名展开显式设限：toJS 超限时抛 ReferenceError，这里统一转成 ConfigError(400)。
  let raw;
  try {
    raw = doc.toJS ? doc.toJS({ mapAsMap: false, maxAliasCount: 100 }) : {};
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw cfgError('frontmatter 结构过于复杂（别名展开超出安全限制）', null, null);
  }
  const fm = sanitize(raw);
  const plainFm = (fm && typeof fm === 'object' && !Array.isArray(fm)) ? fm : {};

  const { fields, warnings } = ingestLayer(plainFm, { positions });
  return { fm: plainFm, body, positions, config: fields, warnings };
}

/**
 * 对已有 frontmatter 对象做同一套校验（不重复解析 YAML）。
 * @returns {object} 规范化后的 camelCase 配置字段
 * @throws {ConfigError}
 */
export function validateFrontmatter(fm, positions = {}) {
  return ingestLayer(fm, { positions }).fields;
}

/* ---------------- 合并生效选项 ---------------- */

/**
 * 合并「生效选项」。优先级：explicit(CLI/Web) > fm > profile.defaults > 全局默认。
 * 每层先校验再合并；CLI 无法掩盖 frontmatter 的无效配置（frontmatter 校验在合并前先跑）。
 * 国家标准（profile.gbDoc）固定版式在此强制：无导语、无落款，不受 enable/disable 或 FM 影响。
 *
 * @param {object} explicit 显式选项（parseArgs 结果或 Web 控件）
 * @param {object} fm       解析后的 frontmatter 原始对象
 * @param {object} profile  文档类型（detectProfile 结果）
 * @param {object} [context] { positions?, warnings? }
 * @returns {object} 生效选项（含运行字段透传）
 */
export function resolveDocumentOptions(explicit = {}, fm = {}, profile = null, context = {}) {
  const prof = profile || { name: 'general', defaults: {} };
  const warnings = context.warnings || [];

  const explicitIngest = ingestLayer(explicit, { allowRuntimeFeatures: true, warnings });
  const fmIngest = ingestLayer(fm, { positions: context.positions || {}, warnings });
  const profileIngest = ingestLayer(prof.defaults || {}, { allowRuntimeFeatures: true, warnings });
  const e = explicitIngest.fields;
  const f = fmIngest.fields;
  const p = profileIngest.fields;

  // 类型固定版式在共享层校验，CLI 与 Web 不得各自放宽。
  for (const [layer, source] of [[e, null], [f, fm]]) {
    const reject = (key, message) => {
      const rawKey = source && Object.keys(source).find(k => canonicalField(k) === key);
      throw cfgError(message, key, rawKey ? context.positions?.[rawKey] : null);
    };
    if (prof.gbDoc) {
      for (const key of ['theme', 'numberScheme', 'numbering', 'fontSize', 'lineHeight', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginSide', 'headerLeft', 'headerCenter', 'headerRight']) {
        if (hasOwn(layer, key)) reject(key, `国家标准的 ${key} 使用固定版式，不能覆盖`);
      }
      if (layer.landscape === true) reject('landscape', '国家标准固定为 A4 纵向，不能开启横向');
    } else {
      if (layer.theme === 'gb') reject('theme', '国家标准主题仅适用于 gb 文档类型');
      if (layer.numberScheme === 'gb') reject('numberScheme', 'GB 编号方案仅适用于 gb 文档类型');
      if (prof.name === 'paper' && layer.numberScheme === 'cjk') reject('numberScheme', '学术论文不支持中文编号方案');
    }
  }

  const pick = key => {
    if (hasOwn(e, key)) return e[key];
    if (hasOwn(f, key)) return f[key];
    if (hasOwn(p, key)) return p[key];
    return GLOBAL_OPTION_DEFAULTS[key];
  };

  const out = {};
  for (const key of MERGE_KEYS) out[key] = pick(key);

  // 文档版本仅作落款中栏的缺省值，不覆盖显式空串或类型固定版式。
  if (out.colophonCenter === undefined && (typeof fm.version === 'string' || (typeof fm.version === 'number' && Number.isFinite(fm.version)))) {
    out.colophonCenter = String(fm.version);
  }

  // 页边距：四边与简写 marginSide 分层取值，且低层简写不得覆盖高层显式四边。
  const pickSide = side => {
    const order = [
      [e, side], [e, 'marginSide'],
      [f, side], [f, 'marginSide'],
      [p, side], [p, 'marginSide'],
      [GLOBAL_OPTION_DEFAULTS, side], [GLOBAL_OPTION_DEFAULTS, 'marginSide'],
    ];
    for (const [layer, key] of order) {
      if (hasOwn(layer, key) && layer[key] !== undefined) return layer[key];
    }
    return undefined;
  };
  out.marginTop = pick('marginTop');
  out.marginBottom = pick('marginBottom');
  out.marginLeft = pickSide('marginLeft');
  out.marginRight = pickSide('marginRight');

  // 国家标准固定版式：无导语、无落款，不可被 enable/disable 或 FM 绕过。
  if (prof.gbDoc) {
    out.lead = false;
    out.colophonEnabled = false;
    out.colophonLeft = '';
    out.colophonCenter = '';
    out.colophonRight = '';
  }

  out.type = prof.name;

  // 运行字段透传（仅来自 explicit；frontmatter 不可控制）
  out.inputs = Array.isArray(explicit.inputs) ? explicit.inputs.slice() : [];
  out.output = explicit.output;
  out.help = explicit.help === true;
  out.version = explicit.version === true;
  out.open = hasOwn(e, 'open') ? e.open : explicit.open === true;
  out.keepHtml = hasOwn(e, 'keepHtml') ? e.keepHtml : explicit.keepHtml === true;
  out.htmlOnly = hasOwn(e, 'htmlOnly') ? e.htmlOnly : explicit.htmlOnly === true;
  out.pagedHtml = hasOwn(e, 'pagedHtml') ? e.pagedHtml : explicit.pagedHtml === true;
  out.pagedHtmlPath = typeof explicit.pagedHtmlPath === 'string' ? explicit.pagedHtmlPath : '';

  return out;
}
