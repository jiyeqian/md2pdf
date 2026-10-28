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

test('positions a leader between the typeset formula and its original tag', () => {
  const rect = (left, right, top = 10, height = 20) => ({ left, right, top, height, width: right - left });
  const row = { getBoundingClientRect: () => rect(180, 280) };
  const label = { getBoundingClientRect: () => rect(420, 450) };
  const svg = { querySelectorAll: selector => selector.includes('mlabeledtr') ? [row] : [label] };
  const children = [];
  const container = {
    style: {}, getBoundingClientRect: () => rect(100, 500, 0, 40),
    querySelector: () => svg,
    appendChild: node => children.push(node),
  };
  globalThis.document = {
    querySelectorAll: selector => selector === '.gb-equation-leader' ? children : [container],
    createElement: () => ({ style: {}, setAttribute(name, value) { this[name] = value; } }),
  };
  try {
    finalizeGbEquations();
    assert.equal(children.length, 1);
    assert.equal(children[0].style.left, '188px');
    assert.equal(children[0].style.width, '128px');
    assert.equal(children[0].style.display, 'block');
    assert.equal(children[0].style.overflow, 'hidden');
    assert.equal(children[0]['aria-hidden'], 'true');
  } finally { delete globalThis.document; }
});
