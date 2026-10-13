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
    menus: document.querySelectorAll('.md-fold-menu').length,
    source: mdEditor.getValue()
  })`);
  const foldLine = async number => {
    assert.equal(await evaluate(`mdEditor.goToLine(${number}); mdEditor.runCommand('fold')`), true);
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  };
  await evaluate(`window.triggerFor = prefix => {
    const center = rect => rect.y + rect.height / 2;
    const row = [...document.querySelectorAll('.cm-content .cm-line')].find(el => el.textContent.startsWith(prefix));
    const y = center(row.getBoundingClientRect());
    return [...document.querySelectorAll('.cm-foldGutter .cm-gutterElement')]
      .find(el => Math.abs(center(el.getBoundingClientRect()) - y) < 1)?.querySelector('button');
  }; window.groupTrigger = () => triggerFor('[^one]')`);
  const layout = () => evaluate(`(() => {
    const numbers = document.querySelector('.cm-lineNumbers').getBoundingClientRect();
    const fold = document.querySelector('.cm-foldGutter').getBoundingClientRect();
    return { columns: document.querySelectorAll('.cm-gutter').length, foldWidth: fold.width,
      gap: fold.x - numbers.right, gutterWidth: document.querySelector('.cm-gutters').getBoundingClientRect().width,
      contentX: document.querySelector('.cm-content').getBoundingClientRect().x };
  })()`);
  const closedLayout = await layout();
  assert.equal(closedLayout.columns, 2, 'only line numbers and one folding column remain');
  assert.ok(closedLayout.foldWidth <= 12 && closedLayout.gap < 1, 'fold control is narrow and adjacent to line numbers');
  await evaluate(`groupTrigger().click()`);
  assert.equal((await snapshot()).menus, 1);
  const menuLayout = await evaluate(`(() => {
    const entry = document.querySelector('.md-fold-entry').getBoundingClientRect();
    const group = document.querySelector('.md-fold-group').getBoundingClientRect();
    return { entryX: entry.x, groupX: group.x, deltaY: Math.abs(entry.y - group.y) };
  })()`);
  assert.ok(menuLayout.entryX < menuLayout.groupX && menuLayout.deltaY < 1, 'two compact choices align on one row');
  assert.deepEqual(await layout(), closedLayout, 'opening the menu does not consume editor width');
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal((await snapshot()).menus, 0);
  assert.equal(await evaluate(`document.activeElement === groupTrigger()`), true, 'Escape restores trigger focus');
  await evaluate(`triggerFor('发布单位:').click()`);
  assert.ok((await snapshot()).lines.includes('发布单位:…'));
  await foldLine(1);
  let state = await snapshot();
  assert.ok(state.lines[0].includes('frontmatter'));
  assert.equal(state.lines.filter(line => line === '---').length, 0, 'closing delimiter stays hidden');
  assert.equal(state.lines.filter(line => line.includes('单位一')).length, 0);
  await evaluate(`document.querySelector('.cm-foldPlaceholder').click()`);
  state = await snapshot();
  assert.ok(state.lines.includes('发布单位:…'), 'inner array fold survives outer expansion');
  await evaluate(`groupTrigger().click(); document.querySelector('.md-fold-entry').click()`);
  state = await snapshot();
  assert.ok(state.lines.includes('[^one]: @article{one,…'));
  assert.equal(state.lines.filter(line => line.trim() === '}').length, 1, 'only unfolded second entry has a closing brace');
  assert.equal(state.menus, 0);
  await evaluate(`groupTrigger().click(); document.querySelector('.md-fold-group').click()`);
  state = await snapshot();
  assert.ok(state.lines.includes('参考文献 · 2 条 …'), 'whole group is one display row');
  assert.equal(state.lines.filter(line => /\[\^(?:one|two)\]/.test(line)).length, 0);
  assert.equal(state.lines.filter(line => line.trim() === '}').length, 0);
  await evaluate(`[...document.querySelectorAll('.cm-foldPlaceholder')].find(el => el.textContent.includes('参考文献')).click()`);
  state = await snapshot();
  assert.ok(state.lines.includes('[^one]: @article{one,…'), 'first-entry fold survives group expansion');
  assert.equal(state.menus, 0);
  // Native buttons support keyboard activation, not only pointer clicks.
  await evaluate(`[...document.querySelectorAll('.cm-foldPlaceholder')].find(el => el.textContent === '…' && el.closest('.cm-line').textContent.startsWith('[^one]')).focus()`);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  state = await snapshot();
  assert.equal(state.lines.filter(line => line.trim() === '}').length, 2);
  assert.equal(state.source, source);
  // A dual-level menu also supports keyboard selection of the group action.
  await evaluate(`groupTrigger().focus()`);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.equal((await snapshot()).menus, 1);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  assert.equal(await evaluate(`document.activeElement.className`), 'md-fold-group');
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.ok((await snapshot()).lines.includes('参考文献 · 2 条 …'));
  await evaluate(`[...document.querySelectorAll('.cm-foldPlaceholder')].find(el => el.textContent.includes('参考文献')).click()`);
  await evaluate(`groupTrigger().click(); document.querySelector('.cm-content').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}))`);
  assert.equal((await snapshot()).menus, 0, 'outside click dismisses the menu');
  await evaluate(`groupTrigger().click(); foldView.scrollDOM.dispatchEvent(new Event('scroll'))`);
  assert.equal((await snapshot()).menus, 0, 'scroll dismisses the menu');
  const listSource = '---\n起草单位:\n  - 第一单位\n---\n\n- 正文列表';
  await evaluate(`mdEditor.setValue(${JSON.stringify(listSource)});
    mdEditor.setSelection(mdEditor.getValue().indexOf('第一单位') + 4); mdEditor.focus()`);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.equal(await evaluate(`mdEditor.getValue()`), '---\n起草单位:\n  - 第一单位\n  - \n---\n\n- 正文列表');
  assert.equal(await evaluate(`mdEditor.getValue().slice(mdEditor.getSelection().from - 2, mdEditor.getSelection().from)`), '- ');
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.equal(await evaluate(`mdEditor.getValue()`), '---\n起草单位:\n  - 第一单位\n  \n---\n\n- 正文列表');
  await evaluate(`mdEditor.runCommand('undo')`);
  assert.equal(await evaluate('mdEditor.getValue()'), listSource.replace('第一单位', '第一单位\n  - '), 'empty-item exit is one undo step');
  await evaluate(`mdEditor.runCommand('undo')`);
  assert.equal(await evaluate('mdEditor.getValue()'), listSource, 'list continuation is one undo step');
  await evaluate(`mdEditor.setSelection(mdEditor.getValue().length); mdEditor.focus()`);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.equal((await evaluate('mdEditor.getValue()')).endsWith('- 正文列表\n- '), true, 'ordinary Markdown lists still continue');
  assert.deepEqual(errors, []);
  if (process.env.MD2PDF_FOLD_SCREENSHOT) {
    await evaluate(`mdEditor.setValue(${JSON.stringify(source)})`);
    await foldLine(1);
    await evaluate(`groupTrigger().click()`);
    await evaluate(`Promise.all(document.querySelector('.md-fold-menu').getAnimations().map(animation => animation.finished))`);
    const screenshot = await browser.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(process.env.MD2PDF_FOLD_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }
  console.log('Chromium: compact shared gutter, aligned floating choices, YAML/BibTeX folds, keyboard/outside dismissal, YAML list continuation/exit/undo and Markdown lists passed');
} finally {
  await browser.stop();
  await rm(temp, { recursive: true, force: true });
}
