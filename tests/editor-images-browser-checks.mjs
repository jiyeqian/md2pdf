import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Chrome, findChrome } from '../src/chrome.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-images-browser-'));
const browser = new Chrome(findChrome(), temp);
try {
  await browser.start();
  await browser.send('Runtime.enable');
  const frame = await browser.send('Page.getFrameTree');
  await browser.send('Page.setDocumentContent', { frameId: frame.frameTree.frame.id, html: '<!doctype html><html><body><textarea id="markdown"></textarea></body></html>' });
  const css = await readFile(new URL('../web/editor-images.css', import.meta.url), 'utf8');
  async function evaluate(expression) {
    const result = await browser.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  await evaluate(`document.head.appendChild(document.createElement('style')).textContent = ${JSON.stringify(css)}`);
  for (const file of ['editor-vendor.js', 'editor-core.js', 'editor-images.js']) {
    await evaluate(await readFile(new URL('../web/' + file, import.meta.url), 'utf8'));
  }
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII=';
  const source = '前\n![图](' + url + ')\n后';
  await evaluate(`mdEditor.setValue(${JSON.stringify(source)}); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const snap = () => evaluate(`({text: document.querySelector('.cm-content').innerText, value: mdEditor.getValue(), expanded: document.querySelector('.md-image-fold')?.getAttribute('aria-expanded')})`);
  let state = await snap();
  assert.equal(state.value, source);
  assert.equal(state.expanded, 'false');
  assert.ok(!state.text.includes('base64'));
  await evaluate(`document.querySelector('.md-image-fold').focus()`);
  for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.equal((await snap()).expanded, 'true');
  assert.equal(await evaluate(`document.querySelector('.md-image-fold-thumbnail').complete && document.querySelector('.md-image-fold-thumbnail').naturalWidth > 0`), true);
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate(`(() => { const r = document.querySelector('.md-image-fold-thumbnail').getBoundingClientRect(); return r.height <= 180 && r.width <= 320; })()`), true);
  for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  assert.equal((await snap()).expanded, 'false');
  const start = source.indexOf(url);
  await evaluate(`mdEditor.setSelection(${start + 2});`);
  assert.ok(!(await snap()).text.includes('base64'), 'selection within image data does not reveal it');
  await evaluate(`mdEditor.setSelection(${start - 1}, ${start + 2});`);
  assert.ok(!(await snap()).text.includes('base64'), 'overlapping selection does not reveal it');
  await evaluate(`mdEditor.replaceRange(0, 1, '改');`);
  assert.equal((await snap()).value, source.replace('前', '改'));
  await evaluate(`mdEditor.setValue(${JSON.stringify(source)}); mdEditor.replaceRange(${start}, ${start + url.length}, '');`);
  assert.equal((await snap()).value, source.replace(url, ''));
  await evaluate(`mdEditor.runCommand('undo')`);
  assert.equal((await snap()).value, source, 'undo restores the image data');
  await evaluate(`mdEditor.setValue(${JSON.stringify(source)});`);
  assert.equal((await snap()).value, source, 'save/readback through editor value preserves the original');
  await evaluate(`window.savedSyntaxTree = MDEditorVendor.syntaxTree; MDEditorVendor.syntaxTree = () => ({ length: 0 }); mdEditor.setValue(${JSON.stringify(source)}); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  assert.ok(!(await snap()).text.includes('base64'), 'unparsed image data stays hidden');
  await evaluate(`MDEditorVendor.syntaxTree = window.savedSyntaxTree`);
  const examples = '`![x](' + url + ')`\n```md\n![x](' + url + ')\n```\n' + url;
  await evaluate(`mdEditor.setValue(${JSON.stringify(examples)}); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  assert.equal(await evaluate(`document.querySelectorAll('.md-image-fold').length`), 0, 'code and plain text do not become images');
  console.log('Chromium: image fold, keyboard, thumbnail, small viewport, selections, editing, deletion and value roundtrip passed');
} finally {
  await browser.stop();
  await rm(temp, { recursive: true, force: true });
}
