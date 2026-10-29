import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { Chrome, findChrome } from '../src/chrome.mjs';
import { finalizeGbTableRules } from '../src/gb-table-rules.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'gb-table-rules-'));
const chrome = new Chrome(findChrome(), temp);
try {
  await chrome.start();
  const html = `<!doctype html><html lang="en"><style>
    @page { size: A4; margin: 0 } body { margin: 0 }
    .pagedjs_pagebox { position: relative; width: 210mm; height: 297mm; }
    table { border-collapse: collapse; width: 150mm; margin: 20mm; border: 1pt solid black }
    td, th { border: .5pt solid black; height: 12mm }
    .gb-vector-rules, .gb-vector-rules th, .gb-vector-rules td { border-color: transparent }
  </style><div class="pagedjs_page"><div class="pagedjs_pagebox"><table id="table"><caption>Caption</caption><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td rowspan="2">C</td><td>D</td></tr><tr><td>E</td></tr><tr class="gb-table-notes"><td colspan="2">note</td></tr></tbody><tfoot><tr><td colspan="2">footnote</td></tr></tfoot></table><table class="gb-equation-legend"><tr><td>Legend</td></tr></table></div></div><script>
    const finalize = ${finalizeGbTableRules};
    const table = document.querySelector('#table');
    const before = table.getBoundingClientRect().toJSON();
    finalize();
    const first = document.querySelector('[data-gb-table-rules]').outerHTML;
    finalize();
    const svg = document.querySelector('[data-gb-table-rules]');
    const bounds = element => { const r = element.getBoundingClientRect(), t = table.getBoundingClientRect(); return [r.left-t.left,r.top-t.top,r.right-t.left,r.bottom-t.top] };
    window.result = { before, after: table.getBoundingClientRect().toJSON(), count: document.querySelectorAll('[data-gb-table-rules]').length, first, second: svg.outerHTML, paths: [...svg.querySelectorAll('path')].map(p => ({ d:p.getAttribute('d'), width:+p.getAttribute('stroke-width') })), head: bounds(table.querySelector('thead')), note: bounds(table.querySelector('.gb-table-notes')), foot: bounds(table.querySelector('tfoot tr')), cells: [...table.querySelectorAll('td,th')].map(bounds), legend: document.querySelector('.gb-equation-legend').classList.contains('gb-vector-rules') };
  </script></html>`;
  const pdf = await chrome.printHtml(html, {});
  const result = (await chrome.send('Runtime.evaluate', { expression: 'window.result', returnByValue: true })).result.value;
  assert.equal(result.count, 1); assert.equal(result.first, result.second); assert.equal(result.legend, false);
  for (const key of ['x', 'y', 'width', 'height']) assert.equal(result.before[key], result.after[key]);
  assert.equal(result.paths.length, 6); // two merged grid paths and outer, header, note, foot frames
  const horizontal = [...result.paths[0].d.matchAll(/M([\d.]+) ([\d.]+)H([\d.]+)/g)].map(m => m.slice(1).map(Number));
  const splitY = result.cells[4][1];
  const split = horizontal.filter(([, y]) => Math.abs(y - splitY) < .03);
  assert.equal(split.length, 1);
  assert.ok(Math.abs(split[0][0] - result.cells[4][0]) < .03, 'rowspan must not acquire a horizontal edge');
  const near = (a, b) => assert.ok(Math.abs(a-b)<0.03, `${a} != ${b}`);
  for (const [pathItem, expected] of [[result.paths[3],result.head], [result.paths[4],result.note], [result.paths[5],result.foot]]) {
    const nums = pathItem.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    for (const [a,b] of [[nums[0],expected[0]],[nums[1],expected[1]],[nums[2],expected[2]],[nums[3],expected[3]]]) near(a,b);
  }
  const pdfPath = path.join(temp, 'rules.pdf');
  await writeFile(pdfPath, pdf);
  const check = spawnSync(process.env.PYTHON || 'python3', ['-c', `from pypdf import PdfReader
import sys
p=PdfReader(sys.argv[1]).pages[0]
states=[float(v.get_object()['/LW']) for v in p['/Resources']['/ExtGState'].values() if '/LW' in v.get_object()]
assert any(abs(w * .75 - .327)<.001 for w in states), states
assert any(abs(w * .75 - .764)<.001 for w in states), states
print('PDF stroke widths (pt):', sorted(round(w * .75, 3) for w in states))`, pdfPath], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr + check.stdout);
  console.log(check.stdout.trim());
  console.log('GB table rules: layout, reentry, frame bounds and legend checks passed');
} finally { await chrome.stop(); await rm(temp, { recursive: true, force: true }); }
