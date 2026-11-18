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
  console.log('Chromium: downloaded Markdown file preserves embedded image and can be reloaded');
} finally {
  await browser.stop();
  await new Promise(resolve => app.server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
