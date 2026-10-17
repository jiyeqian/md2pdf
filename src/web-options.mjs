import { PROFILES, PROFILE_NAMES, detectProfile } from './profiles.mjs';
import { SCHEME_NAMES } from './numbering.mjs';
import { parseFrontmatter, resolveDocumentOptions } from './config.mjs';
import { FEATURES } from './options.mjs';

/**
 * web-options —— 在线工作台的「选项策略」前端与后端共用同一份声明。
 *
 * 设计要点：
 *   1. **文档类型决定可用控件。** 每个类型声明哪些选项可以在线调整，其余视为锁定：
 *      前端隐藏控件并给出简短说明，后端收到被锁定的覆盖请求时显式报错（HTTP 400）。
 *      ——不做静默改写：静默丢弃会让用户以为改了生效，实际没生效。
 *   2. **GB 国家标准文档是受限类型。** 主题 / 编号方案 / 编号行为 / 字号 / 版式
 *      （页边距、纸张方向）应用内置国家标准模板，由源文档与 profile 决定，在线不可覆盖；
 *      封面与页眉信息取自文档 frontmatter，在线不合成任何元数据。
 *   3. **通用类型不能套用 GB 专属项。** gb 主题与 gb 编号方案只允许 gb 类型使用。
 */

export const POLICY_VERSION = 1;

// 与 src/render.mjs 的解析顺序一致：显式 opts > profile.defaults > 内置兜底。
// 只用于「把生效值回显给前端」，真正生效的仍然是 render 自己算的结果。
export const WEB_BASELINE = {
  theme: 'elegant', numberScheme: 'arabic', numbering: 'auto', toc: false,
  fontSize: 10.5, lineHeight: 1.9, marginTop: 20, marginBottom: 18, marginLeft: 18, marginRight: 18,
};

export const TYPE_LABELS = { general: '通用文档', skill: '技能文档', paper: '学术论文', gb: '国家标准' };
export const THEME_LABELS = { elegant: '雅致 · 墨蓝', minimal: '简洁 · 黑白', gb: '国家标准' };
export const SCHEME_LABELS = { arabic: '1 / 1.1', gb: 'GB 章条', cjk: '一、/（一）', chapter: '第 1 章' };
export const NUMBERING_LABELS = { auto: '自动识别', force: '强制编号', none: '不编号' };
export const MARGIN_OPTIONS = [{ value: '15', label: '15 · 紧凑' }, { value: '20', label: '20 · 标准' }, { value: '25', label: '25 · 宽松' }];
export const OPTION_LABELS = { type: '文档类型', theme: '主题', toc: '目录', fontSize: '字号', lineHeight: '行距', margin: '页边距', numbering: '章节编号', numberScheme: '编号方案', landscape: '页面方向' };
export const FONT_SIZE_RANGE = { min: 8, max: 24, step: 0.5 };
// 正文行距：有限数字 1.0–2.5（step 0.05），省略时保持正文默认 1.9。
export const LINE_HEIGHT_RANGE = { min: 1, max: 2.5, step: 0.05 };
// GB 国家标准版式的固定正文行距，须与 assets/themes/gb.css 的 body{line-height:1.62} 保持一致。
export const GB_LINE_HEIGHT = 1.62;
export const MARGIN_RANGE = { min: 10, max: 40 };

// HTTP 层接受的选项白名单（键名即前端控件名；margin 由前端展开成四个数值）
export const WEB_OPTION_SPEC = {
  enums: { type: PROFILE_NAMES.slice(), theme: Object.keys(THEME_LABELS), numbering: Object.keys(NUMBERING_LABELS), numberScheme: SCHEME_NAMES.slice() },
  booleans: ['toc', 'landscape'],
  numbers: { tocDepth: [1, 2], fontSize: [8, 24], lineHeight: [1, 2.5], marginTop: [10, 40], marginBottom: [10, 40], marginSide: [10, 40], marginLeft: [10, 40], marginRight: [10, 40] },
};

/**
 * 各类型「可以在线调整」的选项。
 * - 列出键 = 可调（值为可选值集合，或 true 表示任意合法值）；
 * - 未列出键 = 锁定：前端隐藏并说明，后端拒绝覆盖。
 * - 空类型 '' 表示「自动识别」阶段（尚未拿到服务端判定的类型），按最保守的非 GB 能力集渲染。
 */
const GENERAL_CAPS = { theme: ['elegant', 'minimal'], numberScheme: ['arabic', 'cjk', 'chapter'], numbering: ['auto', 'force', 'none'], toc: true, landscape: true, margin: true, fontSize: true, lineHeight: true };
const TYPE_CAPABILITIES = {
  general: GENERAL_CAPS,
  skill: GENERAL_CAPS,
  paper: { theme: ['elegant', 'minimal'], numberScheme: ['arabic', 'chapter'], numbering: ['auto', 'force', 'none'], toc: true, landscape: true, margin: true, fontSize: true, lineHeight: true },
  // GB：仅目录可调；主题 / 编号方案 / 编号行为 / 字号 / 版式全部锁定（应用内置国家标准模板）
  gb: { toc: true },
};
const AUTO_CAPABILITIES = GENERAL_CAPS;

const TYPE_NOTES = {
  general: ['不含其他类型特征时按通用文档排版；一级、二级标题之间的首段作为导言，标题层级自动编号。'],
  skill: ['frontmatter 含 name / description 时自动识别，报头带「技能文档」标识与元信息条。'],
  paper: ['frontmatter 含 abstract / keywords 自动识别，自动生成作者行、摘要与关键词。'],
  gb: [
    '国家标准版式应用内置国家标准模板：封面与页眉、GB 章条编号、订口式页边距均按模板输出，不能在线修改。',
    '标准元数据来自 frontmatter；缺失值按统一默认规则补全，disable: [gb-defaults] 可保持空白。',
    '如需「前言 / 引言 / 目次 / 附录 A」的编号规则，直接按 GB 结构书写标题即可。',
  ],
};

const error400 = message => Object.assign(new Error(message), { status: 400 });

export function optionValues(key, type = '') {
  const caps = TYPE_CAPABILITIES[type] ?? AUTO_CAPABILITIES;
  return caps[key] ?? null;
}

function control(name, allowed, meta) {
  return {
    name, label: OPTION_LABELS[name] || name,
    available: Array.isArray(allowed) ? allowed.length > 0 : allowed === true,
    values: Array.isArray(allowed) ? allowed.slice() : undefined,
    ...meta,
  };
}

/**
 * 某个类型的完整策略（前端据此显示/隐藏控件，测试据此断言约束）。
 * @param {string} type 生效类型；'' 表示自动识别阶段
 */
export function policyForType(type = '', effective = null) {
  const profile = PROFILES[type] || PROFILES.general;
  const caps = TYPE_CAPABILITIES[type] ?? AUTO_CAPABILITIES;
  const d = (profile.defaults) || {};
  const eff = effective || {};
  const pick = (key, fallback) => eff[key] ?? d[key] ?? fallback;
  // 生效值：显式/Web 覆盖 > frontmatter > profile 默认 > 全局兜底（与 render 一致）。
  // 传入 effective 时策略回显真实生效值（含 frontmatter），否则退回 profile 默认。
  const fixed = {
    theme: pick('theme', WEB_BASELINE.theme),
    numberScheme: pick('numberScheme', WEB_BASELINE.numberScheme),
    numbering: pick('numbering', WEB_BASELINE.numbering),
    marginTop: pick('marginTop', WEB_BASELINE.marginTop),
    marginBottom: pick('marginBottom', WEB_BASELINE.marginBottom),
    marginLeft: eff.marginLeft ?? d.marginLeft ?? d.marginSide ?? WEB_BASELINE.marginLeft,
    marginRight: eff.marginRight ?? d.marginRight ?? d.marginSide ?? WEB_BASELINE.marginRight,
  };
  const controls = {
    // 类型选择本身始终可调：它是决定其余控件是否可用的开关。
    type: { name: 'type', label: '文档类型', available: true, values: PROFILE_NAMES.slice(), allowEmpty: true, emptyValue: '', emptyLabel: '自动识别' },
    theme: control('theme', caps.theme, { kind: 'enum', fixedValue: fixed.theme, fixedLabel: THEME_LABELS[fixed.theme] || fixed.theme }),
    landscape: control('landscape', caps.landscape, { kind: 'boolean', allowEmpty: true, fixedValue: Boolean(pick('landscape', false)) }),
    toc: control('toc', caps.toc, { kind: 'tri', allowEmpty: true, fixedValue: type ? Boolean(pick('toc', WEB_BASELINE.toc)) : false, triValues: ['false', '1', '2'] }),
    fontSize: control('fontSize', caps.fontSize, { kind: 'number', allowEmpty: true, unsettable: true, min: FONT_SIZE_RANGE.min, max: FONT_SIZE_RANGE.max, step: FONT_SIZE_RANGE.step, defaultValue: WEB_BASELINE.fontSize, fixedValue: pick('fontSize', WEB_BASELINE.fontSize) }),
    lineHeight: control('lineHeight', caps.lineHeight, { kind: 'number', allowEmpty: true, unsettable: true, min: LINE_HEIGHT_RANGE.min, max: LINE_HEIGHT_RANGE.max, step: LINE_HEIGHT_RANGE.step, defaultValue: WEB_BASELINE.lineHeight, fixedValue: type === 'gb' ? GB_LINE_HEIGHT : pick('lineHeight', WEB_BASELINE.lineHeight) }),
    margin: control('margin', caps.margin, { kind: 'enum', allowEmpty: true, values: caps.margin ? MARGIN_OPTIONS.map(o => o.value) : [], fixedValue: `${fixed.marginTop} / ${fixed.marginBottom}`, fixedNote: `左右 ${fixed.marginLeft} / ${fixed.marginRight} mm` }),
    numbering: control('numbering', caps.numbering, { kind: 'enum', fixedValue: fixed.numbering, fixedLabel: NUMBERING_LABELS[fixed.numbering] || fixed.numbering }),
    numberScheme: control('numberScheme', caps.numberScheme, { kind: 'enum', fixedValue: fixed.numberScheme, fixedLabel: SCHEME_LABELS[fixed.numberScheme] || fixed.numberScheme }),
  };
  const lockedKeys = Object.values(controls).filter(c => c.name !== 'type' && !c.available).map(c => c.name);
  return {
    version: POLICY_VERSION,
    type: type || 'auto',
    label: TYPE_LABELS[type] || '自动识别',
    locked: type === 'gb',
    controls,
    lockedKeys,
    availableKeys: Object.values(controls).filter(c => c.available).map(c => c.name),
    notes: TYPE_NOTES[type] || ['文档类型尚未确定，先按通用文档的可选项显示；服务端返回识别结果后会自动适配。'],
    fixed,
    defaults: { ...d },
  };
}

export function webPolicyDocument() {
  const types = PROFILE_NAMES.map(id => ({ id, label: TYPE_LABELS[id] || id }));
  return {
    version: POLICY_VERSION,
    types,
    labels: { type: TYPE_LABELS, theme: THEME_LABELS, numberScheme: SCHEME_LABELS, numbering: NUMBERING_LABELS, option: OPTION_LABELS },
    marginOptions: MARGIN_OPTIONS,
    fontSize: { ...FONT_SIZE_RANGE, defaultValue: WEB_BASELINE.fontSize, unsettable: true },
    lineHeight: { ...LINE_HEIGHT_RANGE, defaultValue: WEB_BASELINE.lineHeight, unsettable: true, gbValue: GB_LINE_HEIGHT },
    baseline: { ...WEB_BASELINE },
    policy: Object.fromEntries(PROFILE_NAMES.map(id => [id, policyForType(id)])),
    autoPolicy: policyForType(''),
  };
}

const ENUM_OPTION_KEYS = ['theme', 'numberScheme', 'numbering'];
const MARGIN_KEYS = ['margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginSide'];

// frontmatter 里与「在线可调选项」同名的字段（kebab/camel 皆可），映射到运行时键名。
// 用于把 frontmatter 的配置一并纳入类型策略校验，防止绕过 Web 控件锁定（尤其是 GB 强制版式）。
const FM_OPTION_KEYS = {
  theme: 'theme',
  'number-scheme': 'numberScheme', numberScheme: 'numberScheme',
  numbering: 'numbering',
  'font-size': 'fontSize', fontSize: 'fontSize',
  'line-height': 'lineHeight', lineHeight: 'lineHeight',
  'margin-top': 'marginTop', marginTop: 'marginTop',
  'margin-bottom': 'marginBottom', marginBottom: 'marginBottom',
  'margin-left': 'marginLeft', marginLeft: 'marginLeft',
  'margin-right': 'marginRight', marginRight: 'marginRight',
  margin: 'margin',
  landscape: 'landscape',
  toc: 'toc',
  'toc-depth': 'tocDepth', tocDepth: 'tocDepth',
};

// enable/disable 列表里的功能名 → 运行时键名（仅取与策略校验相关的布尔项）。
const FM_FEATURE_KEYS = {
  footer: 'footer', meta: 'meta', lead: 'lead', toc: 'toc', outline: 'outline',
  'float-numbering': 'floatNumbering', 'gb-cover': 'gbCover', 'gb-defaults': 'gbDefaults',
  'link-urls': 'linkUrls', landscape: 'landscape',
};

function listify(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

/**
 * 抽取 frontmatter 中会与「类型策略」冲突的配置字段（含 enable/disable 功能开关）。
 * 只做只读映射：把文档声明过的覆盖项整理成运行时键名，交由 assertOptionsAllowed 统一校验。
 */
export function frontmatterOverrides(fm = {}) {
  const out = {};
  if (!fm || typeof fm !== 'object') return out;
  for (const [key, target] of Object.entries(FM_OPTION_KEYS)) {
    if (Object.hasOwn(fm, key) && fm[key] !== undefined) out[target] = fm[key];
  }
  for (const feature of listify(fm.enable)) {
    const target = FEATURES[feature.trim()];
    if (target && !Object.hasOwn(out, target)) out[target] = true;
  }
  for (const feature of listify(fm.disable)) {
    const target = FEATURES[feature.trim()];
    if (target && !Object.hasOwn(out, target)) out[target] = false;
  }
  return out;
}

/**
 * 依据「生效类型」校验覆盖项：每个被隐藏 / 锁定的控件都不接受覆盖请求。
 * 枚举取值必须落在该类型的允许集合内 —— 由此堵住各处不一致：
 *   - 非 gb 类型不得使用「gb 主题 / gb 编号方案」；
 *   - paper 等类型不得使用未开放的编号方案（如 cjk）；
 *   - gb 除 toc 外全部锁定（含字号与版式），固定值一律由内置国家标准模板给出。
 * frontmatter 的覆盖经 frontmatterOverrides 汇入 merged，与显式 opts 同等受约束，
 * 因此 GB 强制版式不会被 `enable: [landscape]` 之类的文档配置绕过。
 * @param {object} opts 显式覆盖（显式优先）
 * @param {string} type 生效类型
 * @param {object} [frontmatter] frontmatter 覆盖（frontmatterOverrides 的产物）
 * @throws 带 status=400 的 Error
 */
export function assertOptionsAllowed(opts, type, frontmatter = {}) {
  const merged = { ...frontmatter };
  for (const [key, value] of Object.entries(opts || {})) merged[key] = value;
  opts = merged;
  if (opts.tocDepth !== undefined && ![1, 2].includes(opts.tocDepth)) throw error400('目录层级只能为一级或二级');
  const present = key => Object.hasOwn(opts, key);
  const caps = TYPE_CAPABILITIES[type] ?? AUTO_CAPABILITIES;
  if (type !== 'gb') {
    if (opts.theme === 'gb') throw error400('「国家标准」主题仅用于国家标准（gb）类型的文档');
    if (opts.numberScheme === 'gb') throw error400('GB 章条编号方案仅用于国家标准（gb）类型的文档');
  }
  for (const key of ENUM_OPTION_KEYS) {
    if (!present(key)) continue;
    const allowed = caps[key];
    if (!allowed || !allowed.includes(opts[key])) {
      throw error400(type === 'gb'
        ? `国家标准文档的${OPTION_LABELS[key]}应用内置国家标准模板，不能在线修改`
        : `${OPTION_LABELS[key]}「${opts[key]}」不适用于${TYPE_LABELS[type] || type}文档`);
    }
  }
  if (present('fontSize') && !caps.fontSize) throw error400('国家标准文档的字号应用内置国家标准模板，不能在线修改');
  if (present('lineHeight') && !caps.lineHeight) throw error400('国家标准文档的行距应用内置国家标准模板，不能在线修改');
  if (!caps.margin) {
    if (MARGIN_KEYS.some(present)) throw error400('国家标准文档的页边距应用内置国家标准模板，不能在线修改');
    if (present('landscape') && opts.landscape !== false) throw error400('国家标准文档固定为 A4 纵向，不支持切换页面方向');
  }
}

/**
 * 由 Markdown 原文与可选的显式类型判定「生效类型」。
 * 复用 render 的 frontmatter 解析与 profiles 的 detectProfile，不另起一套启发式判定。
 * 网页端无文件名，basename 固定为空。
 */
export function resolveWebType(md, explicit = '') {
  const { fm } = parseFrontmatter(String(md ?? ''));
  // 与 render 一致：显式类型 > frontmatter.type > 自动探测。
  return detectProfile({ basename: '', fm, explicit: explicit || fm.type || undefined }).name;
}

/**
 * 把（前端/调用方）选择的选项按类型策略归一化：
 * 丢弃不可用控件上的残留值，避免「切换类型后带着不兼容的旧设置」。
 * 只做**前端可见性层面**的重置；后端仍用 assertOptionsAllowed 做强制校验。
 */
export function normalizeSelections(selections = {}, type = '') {
  const policy = policyForType(type);
  const out = { ...selections };
  for (const control of Object.values(policy.controls)) {
    if (control.name === 'type' || control.available) continue;
    // 被锁定的控件：清空选择（GB 由服务端固定，不需要也不允许客户端指定）
    out[control.name] = '';
  }
  // 可用控件上残留的不兼容取值也要清掉（例如 gb 主题、gb 编号方案）
  const allowedValues = {
    theme: policy.controls.theme.available ? policy.controls.theme.values : [],
    numberScheme: policy.controls.numberScheme.available ? policy.controls.numberScheme.values : [],
    numbering: policy.controls.numbering.available ? policy.controls.numbering.values : [],
  };
  for (const [key, values] of Object.entries(allowedValues)) {
    if (out[key] && values.length && !values.includes(out[key])) out[key] = '';
  }
  return out;
}

/**
 * 回显「生效选项」。顺序与 render 一致：显式 opts/Web 控件 > frontmatter > profile 默认 > 全局兜底。
 * 仅用于界面提示；真正决定排版的是 render 内部同一套顺序。
 * 传入 frontmatter 时回显会反映文档自身的配置（Web 未显式选择时不灌假覆盖）。
 */
export function effectiveOptions(opts = {}, type = 'general', fm = {}, positions = {}) {
  const effective = resolveDocumentOptions(opts, fm, PROFILES[type] || PROFILES.general, { positions });
  const keys = ['theme', 'numberScheme', 'numbering', 'toc', 'fontSize', 'lineHeight', 'landscape', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight'];
  const result = Object.fromEntries(keys.map(key => [key, effective[key]]));
  if (type === 'gb') result.lineHeight = GB_LINE_HEIGHT;
  return result;
}
