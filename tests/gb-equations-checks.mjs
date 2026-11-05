import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGbEquations, finalizeGbEquations, GB_EQUATION_CSS } from '../src/gb-equations.mjs';

test('retains MathJax tags and builds aligned symbol definitions', () => {
  const input = '<div class="gb-equation"><p>$$a=b\\label{eq:one}$$</p>\n<p>式中：\n$a$ | **长度**\n$b_1$ | 中文释义，内容较长</p>\n</div>';
  const output = applyGbEquations(input);
  assert.match(output, /\$\$a=b\\label\{eq:one\}\$\$/);
  assert.match(output, /gb-equation-legend-title">式中：/);
  assert.match(output, /<table class="gb-equation-legend" role="presentation">/);
  assert.match(output, /<td class="gb-equation-symbol">\$b_1\$/);
  assert.equal((output.match(/gb-equation-dash/g) || []).length, 2);
  assert.match(GB_EQUATION_CSS, /\.gb-equation-definition \{ overflow-wrap: anywhere/);
});

test('preserves inline markup and safe escaped input', () => {
  const input = '<div class="gb-equation"><p>$$x$$</p><p>式中：</p><p>$x$ | <em>长度</em> &lt;script&gt;alert(1)&lt;/script&gt;</p></div>';
  const output = applyGbEquations(input);
  assert.match(output, /<em>长度<\/em> &lt;script&gt;/);
  assert.doesNotMatch(output, /<script>/);
});

test('leaves malformed blocks, ordinary prose and fenced examples untouched', () => {
  for (const input of [
    '<div class="gb-equation"><p>$$x$$</p><p>式中：\nx 没有分隔符</p></div>',
    '<div class="gb-equation"><p>$x$</p><p>式中：\nx | 释义</p></div>',
    '<p>式中：\nx | 释义</p>',
    '<pre><code>&lt;div class="gb-equation"&gt;</code></pre>',
  ]) assert.equal(applyGbEquations(input), input);
});

test('reference vector bank covers standard digits and published appendix letters without external fonts',async()=>{
  const {readFile}=await import('node:fs/promises');
  const bank=JSON.parse(await readFile(new URL('../assets/gb-equation-glyphs.json',import.meta.url),'utf8'));
  for(const key of [...'0123456789ABCD','open','close','decimal','ellipsis']){
    assert.ok(bank.glyphs[key]?.paths.length,key);
    for(const path of bank.glyphs[key].paths)assert.match(path,/^[MLCQZmlcqz\d.,+\s-]+$/);
  }
  assert.equal(bank.source,'GB/T 47036—2026');
  assert.match(finalizeGbEquations.toString(),/numberLeft-2\.7\*pxPerPt/);
});
