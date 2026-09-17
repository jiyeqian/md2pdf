#!/usr/bin/env node
/**
 * inspect-pdf —— 读出 PDF 的书签树（/Outlines）与链接注解，用来验证渲染结果。
 *
 * CI 里没有浏览器，渲不出 PDF，所以 outline 相关的断言只能钉"接线"；
 * 真正的书签结构要靠这个脚本在看得到 Chrome 的机器上验一遍。
 *
 *   node ci/inspect-pdf.mjs out.pdf
 *
 * 纯 Node 实现：只解析未压缩的对象字典，不依赖任何 PDF 库。
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('用法：node ci/inspect-pdf.mjs <file.pdf>');
  process.exit(2);
}

const buf = readFileSync(file);
const s = buf.toString('latin1');

// ---- 对象号 → 字节偏移 ----
const objs = new Map();
for (const m of s.matchAll(/(?:^|[\s>])(\d+)\s+(\d+)\s+obj\b/g)) objs.set(+m[1], m.index + m[0].length);
const body = n => {
  const start = objs.get(n);
  if (start == null) return '';
  const end = s.indexOf('endobj', start);
  return s.slice(start, end < 0 ? Math.min(start + 2000, s.length) : end);
};
const ref = (b, key) => {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(b);
  return m ? +m[1] : null;
};

// Chrome 写 UTF-16BE（带 FEFF BOM）的十六进制串，也可能是字面串
const title = b => {
  const m = /\/Title\s*(<([0-9A-Fa-f\s]+)>|\(([^)]*)\))/.exec(b);
  if (!m) return '(无标题)';
  if (m[3] != null) return m[3].replace(/\\([()\\])/g, '$1');
  const hex = m[2].replace(/\s+/g, '');
  const bytes = Buffer.from(hex, 'hex');
  if (hex.toLowerCase().startsWith('feff')) return bytes.swap16().toString('utf16le').replace(/^\uFEFF/, '');
  const t = bytes.toString('utf16le');
  return t.includes('\uFFFD') ? bytes.swap16().toString('utf16le') : t;
};
const dest = b => {
  const named = /\/Dest\s*\/([^\s/<>[\]]+)/.exec(b);
  if (named) return `→ /${named[1]}`;
  if (/\/Dest\s*\[/.test(b)) return '→ 页码';
  return '(无跳转目标)';
};

// ---- 汇总 ----
const linkAnnots = (s.match(/\/Subtype\s*\/Link/g) || []).length;
const innerDests = (s.match(/\/Dest\s*\//g) || []).length;
const uriDests = (s.match(/\/URI\s*\(/g) || []).length;

let catalogNum = null;
for (const n of objs.keys()) if (/\/Type\s*\/Catalog/.test(body(n))) { catalogNum = n; break; }
const outlineRef = catalogNum ? ref(body(catalogNum), 'Outlines') : null;
const useOutlines = /\/PageMode\s*\/UseOutlines/.test(s);

console.log(`${basename(file)}  ${(buf.length / 1024).toFixed(0)} KB`);
console.log(`书签根对象：${outlineRef ? `/Outlines ${outlineRef} 0 R` : '无'}`);
console.log(`打开时展开书签栏（/PageMode /UseOutlines）：${useOutlines ? '是' : '否'}`);
console.log(`链接注解：${linkAnnots} 个（内链 ${innerDests}，外链 ${uriDests}）`);

if (!outlineRef) {
  console.log('\n书签树：无（渲染时用了 --no-outline，或该书签未被 Chrome 支持）');
  process.exit(1);
}

console.log('\n书签树：');
const seen = new Set();
const walk = (num, depth) => {
  let cur = num;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const b = body(cur);
    console.log(`${'    '.repeat(depth)}· ${title(b)}   ${dest(b)}`);
    const first = ref(b, 'First');
    if (first) walk(first, depth + 1);
    cur = ref(b, 'Next');
  }
};
const firstRef = ref(body(outlineRef), 'First') || outlineRef;
if (!ref(body(outlineRef), 'First')) console.log('  （根对象下没有条目）');
walk(firstRef, 0);
