import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILE_NAMES } from './profiles.mjs';
import { SCHEME_NAMES } from './numbering.mjs';
const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
function listThemes() {
  try {
    return readdirSync(ASSETS).filter(f => /^theme-.+\.css$/.test(f)).map(f => f.slice(6, -4)).sort();
  } catch { return []; }
}

export function expandArgs(argv) {
  const out = [];
  for (const a of argv) {
    const m = /^(--[a-z][a-z-]*)=(.*)$/i.exec(a);
    if (m && !['--output', '--footer-left', '--footer-right'].includes(m[1])) {
      const falsey = /^(false|0|no)$/i.test(m[2]);
      out.push(falsey ? `--no-${m[1].slice(2)}` : m[1]);
      if (!falsey && m[2] !== '') out.push(m[2]);
    } else out.push(a);
  }
  return out;
}

export function parseArgs(argv) {
  const o = {
    inputs: [], theme: undefined, fontSize: 10.5,
    // 页边距三态：undefined 时回落到 profile 默认，再回落到内置（20/18/18/18）
    marginTop: undefined, marginBottom: undefined,
    marginSide: undefined, marginLeft: undefined, marginRight: undefined,
    footer: true, footerLeft: '', footerRight: '',
    meta: true, lead: undefined, toc: undefined, linkUrls: false, outline: true, bibliography: 'footnote',
    numbering: undefined,
    gbDefaults: true,
    gbCover: true,
    floatNumbering: true,
    numberScheme: undefined,
    type: '',
    landscape: false, keepHtml: false, htmlOnly: false, open: false, help: false,
    pagedHtml: false, pagedHtmlPath: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '-o': case '--output': o.output = next(); break;
      case '--theme': o.theme = next(); break;
      case '--type': o.type = next(); break;
      case '--title': o.title = next(); break;
      case '--kicker': o.kicker = next(); break;
      case '--no-float-numbering': o.floatNumbering = false; break;
      case '--no-gb-cover': o.gbCover = false; break;
      case '--no-gb-defaults': o.gbDefaults = false; break;
      case '--no-meta': o.meta = false; break;
      case '--no-lead': o.lead = false; break;
      case '-t': case '--toc': o.toc = true; break;
      case '--link-urls': o.linkUrls = true; break;
      case '--landscape': o.landscape = true; break;
      case '--font-size': o.fontSize = parseFloat(next()); break;
      case '--margin': {
        // "上下" 或 "上下,左右"；左右同值（分侧边距只在 profile / 内部使用）
        const v = next(); const m = String(v).split(',').map(s => parseFloat(s.trim()));
        o.marginTop = m[0]; o.marginBottom = m[0];
        o.marginSide = m[1] ?? m[0];
        o.marginLeft = undefined; o.marginRight = undefined;
        break;
      }
      case '--no-footer': o.footer = false; break;
      case '--footer-left': o.footerLeft = next(); break;
      case '--footer-right': o.footerRight = next(); break;
      case '--colophon': o.colophon = next(); break;
      case '--keep-html': o.keepHtml = true; break;
      case '--paged-html': {
        // 可带输出路径；不带值时路径缺省为同名 .html
        const n = argv[i + 1];
        o.pagedHtml = true;
        if (n && !n.startsWith('-')) { o.pagedHtmlPath = n; i++; }
        break;
      }
      case '--html-only': o.htmlOnly = true; break;
      case '--no-html-only': o.htmlOnly = false; break;
      case '--open': o.open = true; break;
      case '--no-open': o.open = false; break;
      case '--no-toc': o.toc = false; break;
      case '--outline': o.outline = true; break;
      case '--no-outline': o.outline = false; break;
      case '--bibliography': {
        const n = argv[i + 1];
        if (n && ['footnote', 'bib'].includes(n)) { o.bibliography = n; i++; }
        else o.bibliography = 'footnote';
        break;
      }
      case '--numbering': o.numbering = next(); break;
      case '--number-scheme': o.numberScheme = next(); break;
      case '--no-bibliography': o.bibliography = false; break;
      case '--no-landscape': o.landscape = false; break;
      case '--no-link-urls': o.linkUrls = false; break;
      case '--no-keep-html': o.keepHtml = false; break;
      case '--version': o.version = true; break;
      default:
        if (a.startsWith('-')) { console.warn(`md2pdf: 忽略未知选项 ${a}`); }
        else o.inputs.push(a);
    }
  }
  return o;
}


export const defaultOptions = () => parseArgs([]);
