#!/usr/bin/env node
/**
 * pdf-links.mjs —— 解析 PDF 的链接注解与命名目标，判断内链是否真的能跳。
 *
 * 与 inspect-pdf.mjs 同样的纯 Node 思路：只解未压缩的字典，但额外做三件事：
 *   1. 收集 /Dests 名字字典（catalog /Dests 或 /Names/Dests 名字树）；
 *   2. 把每个 /Link 注解归类为 internal / uri / none；
 *   3. 校验 internal 目标指向的确实是一个存在的 Page 对象。
 *
 *   node ci/pdf-links.mjs <file.pdf> [<file.pdf> ...]
 *
 * 有 qpdf 时先用 qpdf --qdf 展开对象流，兼容性最好；没有也能读 Chrome/Skia
 * 直接产出的未压缩文件。
 */
import { readFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hasQpdf = (() => { try { execFileSync('qpdf', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

export function analyze(file) {
  let buf = readFileSync(file);
  let tmp = null;
  if (hasQpdf) {
    tmp = mkdtempSync(path.join(tmpdir(), 'md2pdf-links-'));
    const qdf = path.join(tmp, 'out.pdf');
    execFileSync('qpdf', ['--qdf', '--object-streams=disable', file, qdf]);
    buf = readFileSync(qdf);
  }
  const s = buf.toString('latin1');

  const objs = new Map();
  for (const m of s.matchAll(/(?:^|[\s>])(\d+)\s+(\d+)\s+obj\b/g)) if (!objs.has(+m[1])) objs.set(+m[1], m.index + m[0].length);
  const body = n => { const st = objs.get(n); if (st == null) return ''; const en = s.indexOf('endobj', st); return s.slice(st, en < 0 ? Math.min(st + 4000, s.length) : en); };
  const dict = (b, key) => { const m = new RegExp('/' + key + '\\s+(\\d+)\\s+0\\s+R').exec(b); return m ? +m[1] : null; };

  // 真正的页对象：/Type /Page 或 /Pages 树的叶子
  const pageObjs = new Set();
  const kids = (num, seen = new Set()) => {
    if (num == null || seen.has(num)) return;
    seen.add(num);
    const b = body(num);
    if (/\/Type\s*\/Page\b/.test(b)) { pageObjs.add(num); return; }
    const arr = /\/Kids\s*\[([^\]]*)\]/.exec(b);
    if (arr) for (const m of arr[1].matchAll(/(\d+)\s+\d+\s+R/g)) kids(+m[1], seen);
  };
  let catalogNum = null;
  for (const n of objs.keys()) if (/\/Type\s*\/Catalog/.test(body(n))) { catalogNum = n; break; }
  if (catalogNum != null) kids(dict(body(catalogNum), 'Pages'));

  // 命名目标：catalog /Dests（字典或名字树）
  const names = new Map();
  const collectDests = (num, seen = new Set()) => {
    if (num == null || seen.has(num)) return;
    seen.add(num);
    const b = body(num);
    for (const m of b.matchAll(/\/([^\s/\[\]<>()]+)\s*\[\s*(\d+)\s+\d+\s+R/g)) if (!names.has(m[1])) names.set(m[1], +m[2]);
    const nm = dict(b, 'Names');
    if (nm != null) {
      const arr = /\/Names\s*\[([^\]]*)\]/.exec(body(nm));
      if (arr) for (const m of arr[1].matchAll(/\(((?:\\.|[^)])*)\)\s*(\d+)\s+\d+\s+R/g)) if (!names.has(m[1])) names.set(m[1], +m[2]);
    }
  };
  if (catalogNum != null) collectDests(dict(body(catalogNum), 'Dests'));

  const annotationPages = new Map();
  for (const page of pageObjs) {
    const pageBody = body(page);
    const inline = /\/Annots\s*\[([^\]]*)\]/.exec(pageBody);
    const indirect = dict(pageBody, 'Annots');
    const annotations = inline?.[1] || (indirect == null ? '' : body(indirect));
    for (const ref of annotations.matchAll(/(\d+)\s+\d+\s+R/g)) annotationPages.set(+ref[1], page);
  }
  const links = [];
  for (const n of objs.keys()) {
    const b = body(n);
    if (!/\/Subtype\s*\/Link/.test(b)) continue;
    const uriM = /\/URI\s*\(((?:\\.|[^)])*)\)/.exec(b);
    const nameM = /\/Dest\s*\/([^\s/\[\]<>()]+)/.exec(b);
    const arrM = /\/Dest\s*\[\s*(\d+)\s+\d+\s+R/.exec(b);
    const goTo = /\/S\s*\/GoTo[\s\S]{0,300}?\/D\s*(?:\[\s*(\d+)\s+\d+\s+R|\/([^\s/\[\]<>()]+))/.exec(b);
    const link = { obj: n, sourcePage: annotationPages.get(n), kind: 'none', target: null, ref: null, page: undefined };
    if (uriM) { link.kind = 'uri'; link.target = uriM[1].replace(/\\([()\\])/g, '$1'); }
    else if (nameM) { link.kind = 'internal'; link.ref = nameM[1]; link.target = nameM[1]; }
    else if (arrM) { link.kind = 'internal'; link.ref = 'page#' + arrM[1]; link.page = +arrM[1]; }
    else if (goTo) { link.kind = 'internal'; if (goTo[2]) { link.ref = goTo[2]; link.target = goTo[2]; } else { link.ref = 'page#' + goTo[1]; link.page = +goTo[1]; } }
    if (link.page === undefined && link.ref && !link.ref.startsWith('page#')) {
      const p = names.get(link.ref);
      link.page = p === undefined ? null : p;
      link.dangling = p === undefined || !pageObjs.has(p);
    } else if (link.page !== undefined) {
      link.dangling = !pageObjs.has(link.page);
    }
    links.push(link);
  }

  if (tmp) rmSync(tmp, { recursive: true, force: true });
  if (!pageObjs.size) throw new Error('无法解析 PDF 页树，请安装 qpdf 或使用 Chrome 生成的 PDF');
  return { file, pageCount: pageObjs.size, pageObjs: [...pageObjs].sort((a, b) => a - b), names, links, catalog: catalogNum, qdf: hasQpdf };
}

export function summarize(r) {
  const internal = r.links.filter(l => l.kind === 'internal');
  return {
    pageCount: r.pageCount,
    namedDestinations: r.names.size,
    total: r.links.length,
    internal: internal.length,
    crossPage: internal.filter(l => l.sourcePage != null && l.page != null && l.sourcePage !== l.page).length,
    uri: r.links.filter(l => l.kind === 'uri').length,
    none: r.links.filter(l => l.kind === 'none').length,
    dangling: internal.filter(l => l.dangling),
    pages: [...new Set(internal.map(l => l.page).filter(p => p != null))].sort((a, b) => a - b),
    refs: internal.map(l => ({ ref: l.ref, page: l.page })),
    uris: r.links.filter(l => l.kind === 'uri').map(l => l.target),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('用法：node ci/pdf-links.mjs <file.pdf> ...'); process.exit(2); }
  for (const f of files) {
    const s = summarize(analyze(f));
    console.log('\n' + path.basename(f) + '  ' + s.pageCount + ' 页  链接 ' + s.total + '（内链 ' + s.internal + ' / 外链 ' + s.uri + ' / 无目标 ' + s.none + '）  命名目标 ' + s.namedDestinations);
    if (s.dangling.length) process.exitCode = 1;
    if (s.dangling.length) console.log('  ✗ 悬空内链：' + s.dangling.map(d => d.ref + '→obj' + d.page).join(', '));
    console.log('  内链落点页对象：' + s.pages.join(','));
    if (s.uris.length) console.log('  外链：' + s.uris.join(', '));
  }
}
