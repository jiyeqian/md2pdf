import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const source = await readFile(root + '/web/template-confirm.js', 'utf8');
function fixture() {
  const nodes = [];
  const previous = { isConnected: true, focus() { this.focused = true; } };
  const document = { activeElement: previous, body: { append(node) { nodes.push(node); } }, createElement(tag) {
    return { tag, children: [], events: {}, setAttribute() {}, append(...children) { this.children.push(...children); }, addEventListener(name, fn) { this.events[name] = fn; }, showModal() { this.open = true; }, close() { this.open = false; }, remove() { this.removed = true; }, focus() { this.focused = true; } };
  } };
  const window = {};
  vm.runInNewContext(source, { document, window });
  return { window, nodes, previous };
}
for (const choice of ['cancel', 'accept', 'escape']) test('template confirmation ' + choice + ' resolves and restores focus', async () => {
  const { window, nodes, previous } = fixture();
  const result = window.mdConfirmTemplate();
  assert.equal(window.mdConfirmTemplate(), result);
  assert.equal(nodes.length, 1);
  const dialog = nodes[0];
  const [cancel, accept] = dialog.children[2].children;
  assert.equal(cancel.focused, true);
  assert.equal(dialog.children[1].textContent, '使用该模板会替换编辑器中的内容，是否继续？');
  if (choice === 'escape') { let prevented = false; dialog.events.cancel({ preventDefault() { prevented = true; } }); assert.ok(prevented); }
  else (choice === 'accept' ? accept : cancel).events.click();
  assert.equal(await result, choice === 'accept');
  assert.ok(dialog.removed);
  assert.ok(previous.focused);
});
test('both template replacement entry points share confirmation and cancel before writes', async () => {
  const examples = await readFile(root + '/web/examples.js', 'utf8');
  const app = await readFile(root + '/web/app.js', 'utf8');
  assert.ok(examples.indexOf('if (!await window.mdConfirmTemplate()) return;') < examples.indexOf('sessionStorage.setItem(HANDOFF_KEY'));
  assert.match(app, /handoff\.replaceConfirmed \|\| await window\.mdConfirmTemplate\(\)/);
  assert.doesNotMatch(examples + app, /window\.confirm\(/);
});
