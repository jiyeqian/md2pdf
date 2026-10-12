// Targeted real-Chromium checks, separate from the browser-free editor tests.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Chrome, findChrome } from '../src/chrome.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-fold-browser-'));
const browser = new Chrome(findChrome(), temp);
try {
  await browser.start();
  const errors = [];
  browser.ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  await browser.send('Runtime.enable');
  const frame = await browser.send('Page.getFrameTree');
  await browser.send('Page.setDocumentContent', { frameId: frame.frameTree.frame.id,
    html: '<!doctype html><html><body><textarea id="markdown"></textarea></body></html>' });
  for (const file of ['editor-vendor.js', 'editor-core.js']) {
    const source = await readFile(new URL('../web/' + file, import.meta.url), 'utf8');
    const result = await browser.send('Runtime.evaluate', { expression: source });
    assert.equal(result.exceptionDetails, undefined, file + ' initialization');
  }
  async function evaluate(expression) {
    const result = await browser.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  assert.equal(await evaluate('!!window.mdEditor'), true);
  const source = '---\n标准号: GB/T 1\n发布单位:\n  - 单位一\n  - 单位二\n---\n\n正文\n\n' +
    '[^one]: @article{one,\n  title = {一},\n  year = {2021}\n  }\n\n' +
    '[^two]: @article{two,\n  title = {二},\n  year = {2022}\n  }\n\n末尾正文';
  await evaluate(`mdEditor.setValue(${JSON.stringify(source)});
    window.foldView = MDEditorVendor.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const snapshot = () => evaluate(`({
    lines: [...document.querySelectorAll('.cm-content .cm-line')].map(el => el.textContent),
    placeholders: [...document.querySelectorAll('.cm-foldPlaceholder')].map(el => el.textContent),
    groups: document.querySelectorAll('.md-bibliography-fold').length,
    source: mdEditor.getValue()
  })`);
  const foldLine = async number => {
    assert.equal(await evaluate(`mdEditor.goToLine(${number}); mdEditor.runCommand('fold')`), true);
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  };
  await foldLine(3);
  assert.ok((await snapshot()).lines.includes('发布单位:…'));
  await foldLine(1);
  let state = await snapshot();
  assert.ok(state.lines[0].includes('frontmatter'));
  assert.equal(state.lines.filter(line => line === '---').length, 0, 'closing delimiter stays hidden');
  assert.equal(state.lines.filter(line => line.includes('单位一')).length, 0);
  await evaluate(`document.querySelector('.cm-foldPlaceholder').click()`);
  state = await snapshot();
  assert.ok(state.lines.includes('发布单位:…'), 'inner array fold survives outer expansion');
  await foldLine(10);
  state = await snapshot();
  assert.ok(state.lines.includes('[^one]: @article{one,…'));
  assert.equal(state.lines.filter(line => line.trim() === '}').length, 1, 'only unfolded second entry has a closing brace');
  assert.equal(state.groups, 1);
  await evaluate(`document.querySelector('.md-bibliography-fold').click()`);
  state = await snapshot();
  assert.ok(state.lines.includes('参考文献 · 2 条 …'), 'whole group is one display row');
  assert.equal(state.lines.filter(line => /\[\^(?:one|two)\]/.test(line)).length, 0);
  assert.equal(state.lines.filter(line => line.trim() === '}').length, 0);
  await evaluate(`[...document.querySelectorAll('.cm-foldPlaceholder')].find(el => el.textContent.includes('参考文献')).click()`);
  state = await snapshot();
  assert.ok(state.lines.includes('[^one]: @article{one,…'), 'first-entry fold survives group expansion');
  assert.equal(state.groups, 1);
  // Native buttons support keyboard activation, not only pointer clicks.
  await evaluate(`[...document.querySelectorAll('.cm-foldPlaceholder')].find(el => el.textContent === '…' && el.closest('.cm-line').textContent.startsWith('[^one]')).focus()`);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  state = await snapshot();
  assert.equal(state.lines.filter(line => line.trim() === '}').length, 2);
  assert.equal(state.source, source);
  assert.deepEqual(errors, []);
  if (process.env.MD2PDF_FOLD_SCREENSHOT) {
    await foldLine(1);
    await evaluate(`document.querySelector('.md-bibliography-fold').click()`);
    const screenshot = await browser.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(process.env.MD2PDF_FOLD_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }
  console.log('Chromium: YAML outer/inner, BibTeX individual/group, one-row display, keyboard expansion and unchanged source passed');
} finally {
  await browser.stop();
  await rm(temp, { recursive: true, force: true });
}
