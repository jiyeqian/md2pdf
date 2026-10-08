import { PROFILES, PROFILE_NAMES, detectProfile } from './profiles.mjs';
import { SCHEME_NAMES } from './numbering.mjs';
import { splitFrontmatter } from './render.mjs';

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
  fontSize: 10.5, marginTop: 20, marginBottom: 18, marginLeft: 18, marginRight: 18,
};

export const TYPE_LABELS = { general: '通用文档', skill: '技能文档', readme: 'README', paper: '论文', gb: '国家标准' };
export const THEME_LABELS = { elegant: '雅致 · 墨蓝', minimal: '简洁 · 黑白', gb: '国家标准' };
export const SCHEME_LABELS = { arabic: '1 / 1.1', gb: 'GB 章条', cjk: '一、/（一）', chapter: '第 1 章' };
export const NUMBERING_LABELS = { auto: '自动识别', force: '强制编号', none: '不编号' };
export const MARGIN_OPTIONS = [{ value: '15', label: '15 · 紧凑' }, { value: '20', label: '20 · 标准' }, { value: '25', label: '25 · 宽松' }];
export const OPTION_LABELS = { type: '文档类型', theme: '主题', toc: '目录', fontSize: '字号', margin: '页边距', numbering: '章节编号', numberScheme: '编号方案', landscape: '页面方向' };
export const FONT_SIZE_RANGE = { min: 8, max: 24, step: 0.5 };
export const MARGIN_RANGE = { min: 10, max: 40 };

// HTTP 层接受的选项白名单（键名即前端控件名；margin 由前端展开成四个数值）
export const WEB_OPTION_SPEC = {
  enums: { type: PROFILE_NAMES.slice(), theme: Object.keys(THEME_LABELS), numbering: Object.keys(NUMBERING_LABELS), numberScheme: SCHEME_NAMES.slice() },
  booleans: ['toc', 'landscape'],
  numbers: { fontSize: [8, 24], marginTop: [10, 40], marginBottom: [10, 40], marginSide: [10, 40], marginLeft: [10, 40], marginRight: [10, 40] },
};

/**
 * 各类型「可以在线调整」的选项。
 * - 列出键 = 可调（值为可选值集合，或 true 表示任意合法值）；
 * - 未列出键 = 锁定：前端隐藏并说明，后端拒绝覆盖。
 * - 空类型 '' 表示「自动识别」阶段（尚未拿到服务端判定的类型），按最保守的非 GB 能力集渲染。
 */
const GENERAL_CAPS = { theme: ['elegant', 'minimal'], numberScheme: ['arabic', 'cjk', 'chapter'], numbering: ['auto', 'force', 'none'], toc: true, margin: true, fontSize: true };
const TYPE_CAPABILITIES = {
  general: GENERAL_CAPS,
  readme: GENERAL_CAPS,
  skill: GENERAL_CAPS,
  paper: { theme: ['elegant', 'minimal'], numberScheme: ['arabic', 'chapter'], numbering: ['auto', 'force', 'none'], toc: true, margin: true, fontSize: true },
  // GB：仅目录可调；主题 / 编号方案 / 编号行为 / 字号 / 版式全部锁定（应用内置国家标准模板）
  gb: { toc: true },
};
const AUTO_CAPABILITIES = GENERAL_CAPS;

const TYPE_NOTES = {
  general: ['不含其他类型特征时按通用文档排版；首段自动作为导语，标题层级自动编号。'],
  skill: ['frontmatter 含 name / description 时自动识别，报头带「技能文档」标识与元信息条。'],
  readme: ['文件名 README.md 自动识别（网页端没有文件名，请手动选择本类型），默认带目录，顶部徽章不参与图表编号。'],
  paper: ['frontmatter 含 abstract / keywords 自动识别，自动生成作者行、摘要与关键词。'],
  gb: [
    '国家标准版式应用内置国家标准模板：封面与页眉、GB 章条编号、订口式页边距均按模板输出，不能在线修改。',
    '标准号、发布日期、实施日期与发布单位取自文档自身 frontmatter —— 在线不合成任何元数据。',
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
export function policyForType(type = '') {
  const profile = PROFILES[type] || PROFILES.general;
  const caps = TYPE_CAPABILITIES[type] ?? AUTO_CAPABILITIES;
  const d = profile.defaults || {};
  const fixed = {
    theme: d.theme ?? WEB_BASELINE.theme,
    numberScheme: d.numberScheme ?? WEB_BASELINE.numberScheme,
    numbering: d.numbering ?? WEB_BASELINE.numbering,
    marginTop: d.marginTop ?? WEB_BASELINE.marginTop,
    marginBottom: d.marginBottom ?? WEB_BASELINE.marginBottom,
    marginLeft: d.marginLeft ?? d.marginSide ?? WEB_BASELINE.marginLeft,
    marginRight: d.marginRight ?? d.marginSide ?? WEB_BASELINE.marginRight,
  };
  const controls = {
    // 类型选择本身始终可调：它是决定其余控件是否可用的开关。
    type: { name: 'type', label: '文档类型', available: true, values: PROFILE_NAMES.slice(), allowEmpty: true, emptyValue: '', emptyLabel: '自动识别' },
    theme: control('theme', caps.theme, { kind: 'enum', fixedValue: fixed.theme, fixedLabel: THEME_LABELS[fixed.theme] || fixed.theme }),
    toc: control('toc', caps.toc, { kind: 'tri', allowEmpty: true, fixedValue: type ? Boolean(d.toc ?? WEB_BASELINE.toc) : false, triValues: ['true', 'false'] }),
    fontSize: control('fontSize', caps.fontSize, { kind: 'number', allowEmpty: true, unsettable: true, min: FONT_SIZE_RANGE.min, max: FONT_SIZE_RANGE.max, step: FONT_SIZE_RANGE.step, defaultValue: WEB_BASELINE.fontSize, fixedValue: d.fontSize ?? WEB_BASELINE.fontSize }),
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
    baseline: { ...WEB_BASELINE },
    policy: Object.fromEntries(PROFILE_NAMES.map(id => [id, policyForType(id)])),
    autoPolicy: policyForType(''),
  };
}

const ENUM_OPTION_KEYS = ['theme', 'numberScheme', 'numbering'];
const MARGIN_KEYS = ['margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginSide'];

/**
 * 依据「生效类型」校验 opts：每个被隐藏 / 锁定的控件都不接受覆盖请求。
 * 枚举取值必须落在该类型的允许集合内 —— 由此堵住各处不一致：
 *   - 非 gb 类型不得使用「gb 主题 / gb 编号方案」；
 *   - paper 等类型不得使用未开放的编号方案（如 cjk）；
 *   - gb 除 toc 外全部锁定（含字号与版式），固定值一律由内置国家标准模板给出。
 * @throws 带 status=400 的 Error
 */
export function assertOptionsAllowed(opts, type) {
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
  if (!caps.margin) {
    if (MARGIN_KEYS.some(present)) throw error400('国家标准文档的页边距应用内置国家标准模板，不能在线修改');
    if (present('landscape') && opts.landscape !== false) throw error400('国家标准文档固定为 A4 纵向，不支持切换页面方向');
  }
}

/**
 * 由 Markdown 原文与可选的显式类型判定「生效类型」。
 * 复用 render 的 frontmatter 解析与 profiles 的 detectProfile，不另起一套启发式判定。
 * 网页端无文件名，basename 固定为空（README 需显式选择类型）。
 */
export function resolveWebType(md, explicit = '') {
  const { fm } = splitFrontmatter(String(md ?? ''));
  return detectProfile({ basename: '', fm, explicit: explicit || undefined }).name;
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
 * 回显「生效选项」。顺序与 src/render.mjs 一致：显式 opts > profile defaults > 内置兜底。
 * 仅用于界面提示；真正决定排版的是 render 内部同一套顺序。
 */
export function effectiveOptions(opts = {}, type = 'general') {
  const d = (PROFILES[type] || PROFILES.general).defaults || {};
  const pick = (key, fallback) => opts[key] ?? d[key] ?? fallback;
  return {
    theme: pick('theme', WEB_BASELINE.theme),
    numberScheme: pick('numberScheme', WEB_BASELINE.numberScheme),
    numbering: pick('numbering', WEB_BASELINE.numbering),
    toc: pick('toc', WEB_BASELINE.toc),
    fontSize: pick('fontSize', WEB_BASELINE.fontSize),
    landscape: pick('landscape', false),
    marginTop: pick('marginTop', WEB_BASELINE.marginTop),
    marginBottom: pick('marginBottom', WEB_BASELINE.marginBottom),
    marginLeft: opts.marginLeft ?? d.marginLeft ?? opts.marginSide ?? d.marginSide ?? WEB_BASELINE.marginLeft,
    marginRight: opts.marginRight ?? d.marginRight ?? opts.marginSide ?? d.marginSide ?? WEB_BASELINE.marginRight,
  };
}
