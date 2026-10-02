// Real Chromium acceptance checks; kept separate from browser-free CLI validation.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';

const out = path.resolve(process.env.MD2PDF_ACCEPTANCE_DIR || path.join(os.tmpdir(), 'md2pdf-web-acceptance'));
await mkdir(out, { recursive: true });
const app = createApp();
const temp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-browser-check-'));
const previewBrowser = new Chrome(findChrome(), temp);
try {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const post = (route, body) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const [type, example] of [['general', 'general.md'], ['skill', 'skill.md'], ['readme', 'README.md'], ['paper', 'paper.md'], ['gb', 'gb.md']]) {
    const md = await readFile(new URL('../examples/' + example, import.meta.url), 'utf8');
    const response = await post('/api/pdf', { md, opts: { type, toc: true } });
    assert.equal(response.status, 200, `${type}: ${response.status === 200 ? '' : await response.text()}`);
    const pdf = Buffer.from(await response.arrayBuffer());
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const text = pdf.toString('latin1');
    assert.ok(/\/Outlines\s+\d+\s+0\s+R/.test(text), `${type} bookmarks missing`);
    assert.ok(/\/Subtype\s*\/Link/.test(text), `${type} links missing`);
    const file = path.join(out, type + '.pdf');
    await writeFile(file, pdf);
    const info = spawnSync('pdfinfo', [file], { encoding: 'utf8' });
    if (!info.error) { assert.equal(info.status, 0); console.log(`${type}: ${info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]} pages, bookmarks and links OK`); }
    else console.log(`${type}: PDF, bookmarks and links OK (pdfinfo unavailable)`);
    if (type === 'general') {
      const rendered = await post('/api/render', { md, opts: {} });
      assert.equal(rendered.status, 200);
      const { html } = await rendered.json();
      await previewBrowser.start();
      await previewBrowser.printHtml(html, { webSafe: true, waitMath: true, waitMermaid: true, waitPaged: true });
      const result = await previewBrowser.send('Runtime.evaluate', { expression: `JSON.stringify({pages:document.querySelectorAll('.pagedjs_page').length, math:document.querySelectorAll('mjx-container').length, diagrams:document.querySelectorAll('.mermaid svg').length, refs:document.querySelectorAll('sup.fnref a').length, errors:document.querySelectorAll('[data-mjx-error]').length, images:[...document.querySelectorAll('img')].every(img=>img.complete&&img.naturalWidth>0), footers:[...document.querySelectorAll('.web-page-number')].map(el=>el.textContent)})`, returnByValue: true });
      const counts = JSON.parse(result.result.value);
      assert.ok(counts.pages > 0 && counts.math > 0 && counts.diagrams > 0 && counts.refs > 0, JSON.stringify(counts));
      assert.equal(counts.errors, 0, 'MathJax reported invalid math');
      assert.equal(counts.images, true, 'Embedded images failed to decode');
      assert.deepEqual(counts.footers, Array.from({length:counts.pages},(_,i)=>`${i+1} / ${counts.pages}`));
      console.log('general preview:', JSON.stringify(counts));
    }
  }
  // A failed graph must fail the export, and the next valid document must still print.
  const invalid = await post('/api/pdf', { md: '# Invalid\n\n```mermaid\nthis is not valid mermaid\n```' });
  assert.equal(invalid.status, 500);
  const recovery = await post('/api/pdf', { md: '# Recovery\n\n## Section\n\nNormal text' });
  assert.equal(recovery.status, 200);
  console.log('invalid Mermaid fails explicitly; subsequent PDF export recovers');
  console.log('Acceptance artifacts:', out);
} finally {
  await previewBrowser.stop();
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
