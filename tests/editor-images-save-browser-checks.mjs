import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-image-save-'));
const app = createApp({ lanHost: '' });
const browser = new Chrome(findChrome(), temp);
async function evaluate(expression) {
  const result = await browser.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function wait(check) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for browser');
}
try {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  await browser.start();
  await browser.send('Runtime.enable');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: temp });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${app.server.address().port}` });
  await wait(async () => { try { return await evaluate('!!window.mdEditor?.__mounted && !!document.querySelector(\'button[aria-label="下载 Markdown"]\')'); } catch { return false; } });
  const source = '# 图片保存\n\n![图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII=)\n';
  await evaluate(`mdEditor.setValue(${JSON.stringify(source)}); document.querySelector('button[aria-label="下载 Markdown"]').click(); document.querySelector('[aria-label="保存 Markdown"] button').click()`);
  await wait(async () => (await readdir(temp)).some(name => name.endsWith('.md')));
  const name = (await readdir(temp)).find(name => name.endsWith('.md'));
  const saved = await readFile(path.join(temp, name), 'utf8');
  assert.equal(saved, source, 'downloaded Markdown retains exact image data');
  await evaluate(`mdEditor.setValue(${JSON.stringify(saved)})`);
  assert.equal(await evaluate('mdEditor.getValue()'), source);
  const original = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  const anchor = original.indexOf('line 50');
  const revisionBefore = await evaluate('mdPreviewController.state().revision');
  await evaluate(`(async () => {
    mdEditor.setValue(${JSON.stringify(original)}); mdEditor.setSelection(${anchor}); mdEditor.focus();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const data = new DataTransfer(); data.items.add(new File([blob], 'slow.png', {type: 'image/png'}));
    window.originalImageBitmap = window.createImageBitmap;
    window.createImageBitmap = async file => { await new Promise(resolve => { window.resumeImage = resolve; }); return window.originalImageBitmap(file); };
    const picker = document.querySelector('.md-image-picker'); picker.files = data.files;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    mdEditor.replaceRange(0, 0, 'added '); window.resumeImage();
  })()`);
  await wait(() => evaluate(`mdEditor.getValue().includes('{#fig:image-1}')`));
  await wait(() => evaluate(`(() => { const state = mdPreviewController.state(); return state.ready && state.revision === state.previewRevision && state.revision > ${revisionBefore}; })()`));
  const inserted = await evaluate(`(() => { const value = mdEditor.getValue(); const cursor = document.querySelector('.cm-cursor')?.getBoundingClientRect(); return { value, selection: mdEditor.getSelection(), focus: document.activeElement.classList.contains('cm-content'), visible: !!cursor && cursor.top >= 0 && cursor.bottom <= innerHeight }; })()`);
  assert.ok(inserted.value.startsWith('added ' + original.slice(0, anchor)));
  assert.ok(inserted.value.endsWith(original.slice(anchor)));
  assert.ok(inserted.selection.from > inserted.value.indexOf(')', inserted.value.indexOf('{#fig:image-1}')) && inserted.selection.from <= inserted.value.indexOf('line 50'));
  assert.equal(inserted.focus, true);
  assert.equal(inserted.visible, true);
  await evaluate(`window.createImageBitmap = window.originalImageBitmap`);
  console.log('Chromium: downloaded Markdown file preserves embedded image and can be reloaded');
} finally {
  await browser.stop();
  await new Promise(resolve => app.server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
