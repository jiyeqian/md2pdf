import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILE_NAMES } from './profiles.mjs';
import { SCHEME_NAMES } from './numbering.mjs';
import { ConfigError } from './config.mjs';

const THEMES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/themes');
export function listThemes() {
  try {
    return readdirSync(THEMES).filter(f => /\.css$/.test(f)).map(f => f.replace(/\.css$/, '')).sort();
  } catch { return []; }
}

/**
 * 功能开关名（enable/disable 统一命名）→ 渲染选项键。
 * 这些是「文档型」开关：CLI 与 frontmatter 都可控制。
 */
export const FEATURES = {
  header: 'header',
  colophon: 'colophonEnabled',
  footer: 'footer',
  meta: 'meta',
  lead: 'lead',
  toc: 'toc',
  outline: 'outline',
  'float-numbering': 'floatNumbering',
  'gb-cover': 'gbCover',
  'gb-defaults': 'gbDefaults',
  'link-urls': 'linkUrls',
  landscape: 'landscape',
};

/**
 * 运行型开关：仅 CLI 可 enable/disable，frontmatter 不得控制。
 */
export const RUNTIME_FEATURES = {
  'keep-html': 'keepHtml',
  'html-only': 'htmlOnly',
  'open': 'open',
  'paged-html': 'pagedHtml',
};

/**
 * 全局渲染默认值（合并的最低层）。这里是「默认渲染」的单一声明，
 * 由 config.mjs 的 resolveDocumentOptions 在合并时兜底 —— defaultOptions() 本身保持稀疏。
 */
export const GLOBAL_OPTION_DEFAULTS = {
  theme: 'elegant',
  fontSize: 10.5,
  lineHeight: 1.9,
  numbering: 'auto',
  numberScheme: 'arabic',
  tocDepth: 1,
  marginTop: 20,
  marginBottom: 18,
  marginLeft: 18,
  marginRight: 18,
  header: true,
  colophonEnabled: true,
  footer: true,
  meta: true,
  lead: false,
  outline: true,
  floatNumbering: true,
  gbCover: true,
  gbDefaults: true,
  toc: false,
  linkUrls: false,
  landscape: false,
  bibliography: 'footnote',
  bibliographyTitle: '参考文献',
};

/**
 * 兼容旧写法：把 --flag=true/false 归一成 --enable/--disable flag。
 * 其余 --key=value 原样透传（parseArgs 原生支持 equals 语法）。
 */
export function expandArgs(argv) {
  const out = [];
  for (const a of argv) {
    const m = /^--([a-z][a-z0-9-]*)=(.*)$/i.exec(a);
    if (m && m[1] !== 'colophon' && (FEATURES[m[1]] !== undefined || RUNTIME_FEATURES[m[1]] !== undefined)) {
      const truthy = /^(true|1|yes|on)$/i.test(m[2]);
      const falsey = /^(false|0|no|off)$/i.test(m[2]);
      if (truthy || falsey) { out.push(truthy ? '--enable' : '--disable', m[1]); continue; }
    }
    out.push(a);
  }
  return out;
}

const NUMBERING_MODES = ['auto', 'force', 'none'];

export function parseArgs(argv) {
  const o = {
    inputs: [],
    // 运行默认（不参与渲染合并的显式层）
    help: false, version: false,
    open: false, keepHtml: false, htmlOnly: false, pagedHtml: false, pagedHtmlPath: '',
  };
  const warnings = [];
  o.warnings = warnings;
  const seen = new Map();

  const err = (message, field) => new ConfigError(message, [{ message, field: field || null }]);
  const put = (key, value, label = key) => {
    if (seen.has(key) && seen.get(key) !== value) {
      throw err(`选项 ${label} 重复且取值冲突（${seen.get(key)} ≠ ${value}）`, key);
    }
    seen.set(key, value);
    o[key] = value;
  };
  const warn = msg => { warnings.push(msg); console.warn('md2pdf: ' + msg); };

  const featErr = name => err(
    `未知功能名：${name}（可用：${[...Object.keys(FEATURES), ...Object.keys(RUNTIME_FEATURES)].join(', ')}）`, name);
  const setFeature = (name, value) => {
    const key = FEATURES[name] !== undefined ? FEATURES[name]
      : RUNTIME_FEATURES[name] !== undefined ? RUNTIME_FEATURES[name] : null;
    if (key === null) throw featErr(name);
    put(key, value, `--${name}`);
  };
  const setFeatureList = (raw, value, optName) => {
    const list = String(raw).split(',').map(s => s.trim()).filter(Boolean);
    if (!list.length) throw err(`选项 ${optName} 需要至少一个功能名`, optName);
    for (const n of list) setFeature(n, value);
  };
  const enumError = (label, value, allowed) => err(`未知${label}：${value}（可用：${allowed.join(', ')}）`, label);
  const boolFrom = (raw, label) => {
    if (/^(true|1|yes|on)$/i.test(raw)) return true;
    if (/^(false|0|no|off)$/i.test(raw)) return false;
    throw err(`选项 ${label} 需要布尔值（收到：${raw}）`, label);
  };
  const numberFrom = (raw, label, { min = null } = {}) => {
    const v = raw === undefined || raw === '' ? NaN : Number(String(raw).trim());
    if (!Number.isFinite(v)) throw err(`选项 ${label} 需要数值（收到：${raw === undefined ? '（缺值）' : raw}）`, label);
    if (min != null && v < min) throw err(`选项 ${label} 的数值过小：${v}（最小 ${min}）`, label);
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let name = a;
    let eq;
    const em = /^--([a-z][a-z0-9-]*)=(.*)$/i.exec(a);
    if (em) { name = '--' + em[1]; eq = em[2]; }

    // 取参数值：equals 优先；空格语法下不吞下一个选项（除非是负数值）
    const takeValue = (label, { numeric = false } = {}) => {
      if (eq !== undefined) return eq;
      const nv = argv[i + 1];
      const looksOption = nv === undefined || (nv.startsWith('-') && !(numeric && /^-?\d/.test(nv)));
      if (looksOption) throw err(`选项 ${label} 缺少参数值`, label);
      i++;
      return nv;
    };

    switch (name) {
      case '-h': case '--help': o.help = true; break;
      case '--version': o.version = true; break;
      case '-o': case '--output': o.output = takeValue('--output'); break;

      case '--enable': setFeatureList(takeValue('--enable'), true, '--enable'); break;
      case '--disable': setFeatureList(takeValue('--disable'), false, '--disable'); break;

      // 便利入口 / 正向开关（隐藏兼容别名）
      case '-t': case '--toc': setFeature('toc', eq !== undefined ? boolFrom(eq, '--toc') : true); break;
      case '--no-toc': o.toc = false; setFeature('toc', false); break;
      case '--outline': setFeature('outline', eq !== undefined ? boolFrom(eq, '--outline') : true); break;
      case '--no-outline': o.outline = false; setFeature('outline', false); break;
      case '--link-urls': setFeature('link-urls', eq !== undefined ? boolFrom(eq, '--link-urls') : true); break;
      case '--no-link-urls': setFeature('link-urls', false); break;
      case '--landscape': setFeature('landscape', eq !== undefined ? boolFrom(eq, '--landscape') : true); break;
      case '--no-landscape': setFeature('landscape', false); break;
      case '--no-footer': setFeature('footer', false); break;
      case '--no-meta': setFeature('meta', false); break;
      case '--no-lead': setFeature('lead', false); break;
      case '--no-float-numbering': setFeature('float-numbering', false); break;
      case '--no-gb-cover': setFeature('gb-cover', false); break;
      case '--no-gb-defaults': setFeature('gb-defaults', false); break;

      // 运行型开关（仅 CLI）
      case '--keep-html': put('keepHtml', eq !== undefined ? boolFrom(eq, '--keep-html') : true, '--keep-html'); break;
      case '--no-keep-html': put('keepHtml', false, '--no-keep-html'); break;
      case '--html-only': put('htmlOnly', eq !== undefined ? boolFrom(eq, '--html-only') : true, '--html-only'); break;
      case '--no-html-only': put('htmlOnly', false, '--no-html-only'); break;
      case '--open': put('open', eq !== undefined ? boolFrom(eq, '--open') : true, '--open'); break;
      case '--no-open': put('open', false, '--no-open'); break;
      case '--paged-html': {
        put('pagedHtml', true, '--paged-html');
        if (eq !== undefined) { if (eq) put('pagedHtmlPath', eq, '--paged-html'); }
        else {
          const nv = argv[i + 1];
          if (nv !== undefined && !nv.startsWith('-')) { put('pagedHtmlPath', nv, '--paged-html'); i++; }
        }
        break;
      }
      case '--no-paged-html': put('pagedHtml', false, '--no-paged-html'); break;

      // 文本
      case '--title': put('title', takeValue('--title'), '--title'); break;
      case '--kicker': put('kicker', takeValue('--kicker'), '--kicker'); break;
      case '--colophon': put('colophonLeft', takeValue('--colophon'), '--colophon'); break;
      case '--header-left': put('headerLeft', takeValue('--header-left'), '--header-left'); break;
      case '--header-center': put('headerCenter', takeValue('--header-center'), '--header-center'); break;
      case '--header-right': put('headerRight', takeValue('--header-right'), '--header-right'); break;
      case '--colophon-left': put('colophonLeft', takeValue('--colophon-left'), '--colophon-left'); break;
      case '--colophon-center': put('colophonCenter', takeValue('--colophon-center'), '--colophon-center'); break;
      case '--colophon-right': put('colophonRight', takeValue('--colophon-right'), '--colophon-right'); break;
      case '--footer-left': put('footerLeft', takeValue('--footer-left'), '--footer-left'); break;
      case '--footer-center': put('footerCenter', takeValue('--footer-center'), '--footer-center'); break;
      case '--footer-right': put('footerRight', takeValue('--footer-right'), '--footer-right'); break;
      case '--bibliography-title': put('bibliographyTitle', takeValue('--bibliography-title'), '--bibliography-title'); break;

      // 数值
      case '--font-size': put('fontSize', numberFrom(takeValue('--font-size', { numeric: true }), '--font-size', { min: 0.1 }), '--font-size'); break;
      case '--line-height': put('lineHeight', numberFrom(takeValue('--line-height', { numeric: true }), '--line-height', { min: 0.1 }), '--line-height'); break;
      case '--toc-depth': {
        const v = numberFrom(takeValue('--toc-depth', { numeric: true }), '--toc-depth', { min: 1 });
        if (v !== 1 && v !== 2) throw err('选项 --toc-depth 只能为 1 或 2', '--toc-depth');
        put('tocDepth', v, '--toc-depth');
        break;
      }
      case '--margin': {
        const raw = String(takeValue('--margin', { numeric: true })).split(',').map(s => s.trim());
        const top = numberFrom(raw[0], '--margin', { min: 0 });
        const side = raw[1] !== undefined ? numberFrom(raw[1], '--margin', { min: 0 }) : top;
        put('marginTop', top, '--margin');
        put('marginBottom', top, '--margin');
        put('marginSide', side, '--margin');
        break;
      }
      case '--margin-top': put('marginTop', numberFrom(takeValue('--margin-top', { numeric: true }), '--margin-top', { min: 0 }), '--margin-top'); break;
      case '--margin-bottom': put('marginBottom', numberFrom(takeValue('--margin-bottom', { numeric: true }), '--margin-bottom', { min: 0 }), '--margin-bottom'); break;
      case '--margin-left': put('marginLeft', numberFrom(takeValue('--margin-left', { numeric: true }), '--margin-left', { min: 0 }), '--margin-left'); break;
      case '--margin-right': put('marginRight', numberFrom(takeValue('--margin-right', { numeric: true }), '--margin-right', { min: 0 }), '--margin-right'); break;
      case '--margin-side': put('marginSide', numberFrom(takeValue('--margin-side', { numeric: true }), '--margin-side', { min: 0 }), '--margin-side'); break;

      // 枚举
      case '--theme': {
        const v = takeValue('--theme');
        const allowed = listThemes();
        if (!allowed.includes(v)) throw enumError('主题', v, allowed);
        put('theme', v, '--theme');
        break;
      }
      case '--type': {
        const v = takeValue('--type');
        if (!PROFILE_NAMES.includes(v)) throw enumError('文档类型', v, PROFILE_NAMES);
        put('type', v, '--type');
        break;
      }
      case '--numbering': {
        const v = takeValue('--numbering');
        if (!NUMBERING_MODES.includes(v)) throw enumError('编号模式', v, NUMBERING_MODES);
        put('numbering', v, '--numbering');
        break;
      }
      case '--number-scheme': {
        const v = takeValue('--number-scheme');
        if (!SCHEME_NAMES.includes(v)) throw enumError('编号方案', v, SCHEME_NAMES);
        put('numberScheme', v, '--number-scheme');
        break;
      }

      case '--bibliography': {
        let v = eq;
        if (v === undefined) {
          const nv = argv[i + 1];
          if (nv !== undefined && ['footnote', 'bib'].includes(nv)) { v = nv; i++; }
        }
        if (v === undefined) v = 'footnote';
        if (!['footnote', 'bib'].includes(v)) throw enumError('参考文献模式', v, ['footnote', 'bib']);
        put('bibliography', v, '--bibliography');
        warn('--bibliography 已废弃：参考文献始终自动处理，请使用 --bibliography-title 设置标题');
        break;
      }
      case '--no-bibliography':
        warn('--no-bibliography 已废弃：参考文献始终自动处理，无法再关闭');
        break;

      default:
        if (a === '-') o.inputs.push(a);
        else if (a.startsWith('-')) throw err(`未知选项：${a}`, a);
        else o.inputs.push(a);
    }
  }
  return o;
}

export const defaultOptions = () => parseArgs([]);
