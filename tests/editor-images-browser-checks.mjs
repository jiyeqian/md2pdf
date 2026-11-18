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
  // Exercise the shared asynchronous insertion path through all three entry points.
  for (const mode of ['picker', 'paste', 'drop']) {
    const original = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const anchor = original.indexOf('line 50');
    await evaluate(`mdEditor.setValue(${JSON.stringify(original)}); mdEditor.setSelection(${anchor}); mdEditor.focus()`);
    await evaluate(`(async () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
      const bytes = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const data = new DataTransfer();
      data.items.add(new File([bytes], 'first.png', { type: 'image/png' }));
      if (${JSON.stringify(mode)} !== 'paste') data.items.add(new File([bytes], 'second.png', { type: 'image/png' }));
      if (${JSON.stringify(mode)} === 'picker') {
        const picker = document.querySelector('.md-image-picker');
        picker.files = data.files;
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        const content = document.querySelector('.cm-content');
        const line = [...document.querySelectorAll('.cm-line')].find(el => el.textContent === 'line 50');
        const rect = line?.getBoundingClientRect();
        if (${JSON.stringify(mode)} === 'drop' && !rect) throw new Error('drop target is not visible');
        const event = new MouseEvent(${JSON.stringify(mode)}, { bubbles: true, cancelable: true, clientX: rect ? rect.left + 1 : 0, clientY: rect ? rect.top + rect.height / 2 : 0 });
        Object.defineProperty(event, ${JSON.stringify(mode === 'paste' ? 'clipboardData' : 'dataTransfer')}, { value: data });
        content.dispatchEvent(event);
      }
    })()`);
    const result = await evaluate(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      function check() {
        const value = mdEditor.getValue();
        if (value.includes(${JSON.stringify(mode === 'paste' ? '{#fig:image-1}' : '{#fig:image-2}')})) {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve({ value, selection: mdEditor.getSelection(), focused: document.activeElement.classList.contains('cm-content'), visible: (() => { const cursor = document.querySelector('.cm-cursor'); const r = cursor?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= innerHeight; })() })));
        } else if (Date.now() > deadline) reject(new Error('image insertion timed out'));
        else setTimeout(check, 20);
      }
      check();
    })`);
    assert.equal(result.value.slice(0, anchor), original.slice(0, anchor), `${mode}: prefix preserved`);
    assert.ok(result.value.endsWith(original.slice(anchor)), `${mode}: suffix preserved`);
    assert.ok(result.selection.from > result.value.indexOf(')', result.value.indexOf(mode === 'paste' ? '{#fig:image-1}' : '{#fig:image-2}')), `${mode}: cursor follows last image`);
    assert.ok(result.selection.from < result.value.length, `${mode}: cursor stays before remaining text`);
    assert.equal(result.selection.from, result.selection.to);
    assert.equal(result.focused, true, `${mode}: editor retains focus`);
    assert.equal(result.visible, true, `${mode}: cursor visible`);
  }
  // An edit during decoding must map the pending insertion point.
  await evaluate(`(async () => {
    mdEditor.setValue('before\\nTARGET\\nafter'); mdEditor.setSelection(7); mdEditor.focus();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const data = new DataTransfer(); data.items.add(new File([blob], 'async.png', { type: 'image/png' }));
    window.originalImageBitmap = window.createImageBitmap;
    window.createImageBitmap = async file => { await new Promise(resolve => { window.resumeImage = resolve; }); return window.originalImageBitmap(file); };
    const picker = document.querySelector('.md-image-picker'); picker.files = data.files;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    mdEditor.replaceRange(0, 0, 'added ');
    window.resumeImage();
  })()`);
  const mapped = await evaluate(`new Promise((resolve, reject) => {
    const end = Date.now() + 5000;
    function check() { const value = mdEditor.getValue();
      if (value.includes('{#fig:image-1}')) resolve({ value, selection: mdEditor.getSelection() });
      else if (Date.now() > end) reject(new Error('async insertion timed out')); else setTimeout(check, 20);
    } check();
  })`);
  assert.ok(mapped.value.startsWith('added before\n'));
  assert.ok(mapped.value.endsWith('TARGET\nafter'));
  assert.ok(mapped.selection.from > mapped.value.indexOf('{#fig:image-1}') && mapped.selection.from <= mapped.value.indexOf('TARGET'));
  await evaluate(`window.createImageBitmap = window.originalImageBitmap`);
  console.log('Chromium: image fold, keyboard, thumbnail, small viewport, selections, editing, deletion and value roundtrip passed');
} finally {
  await browser.stop();
  await rm(temp, { recursive: true, force: true });
}
