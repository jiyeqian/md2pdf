import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../web/workspace-hosts.js', import.meta.url), 'utf8');
function surface() {
  const handlers = new Map(), nodes = new Map();
  const document = { defaultView: { closed: false, addEventListener(type, fn) { document.addEventListener(type, fn); }, removeEventListener(type, fn) { document.removeEventListener(type, fn); } },
    querySelector: selector => nodes.get(selector) || null,
    addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); },
    removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
    emit(type) { for (const fn of [...handlers.get(type) || []]) fn({ currentTarget: document }); },
  };
  return { document, nodes };
}
function setup() {
  const root = surface(), popup = surface(), sent = [];
  const frame = { contentWindow: { postMessage: (...args) => sent.push(args) } };
  root.nodes.set('#preview', frame);
  const window = {};
  vm.runInNewContext(source, { document: root.document, window, Event });
  return { root, popup, frame, sent, hosts: window.mdWorkspaceHosts };
}
test('UI events attach to future windows and custom events remain root-only', () => {
  const { hosts, root, popup } = setup();
  let keys = 0, custom = 0;
  const remove = hosts.on('keydown', () => keys++);
  hosts.on('md-editor-change', () => custom++);
  hosts.add(popup.document); hosts.add(popup.document);
  popup.document.emit('keydown');
  popup.document.emit('md-editor-change');
  root.document.emit('md-editor-change');
  assert.equal(keys, 1); assert.equal(custom, 1);
  assert.equal(hosts.activeDocument(), popup.document);
  remove(); popup.document.emit('keydown'); assert.equal(keys, 1);
  hosts.remove(popup.document);
  assert.equal(hosts.activeDocument(), root.document);
});
test('query follows moved nodes and cached preview transport survives adoption', () => {
  const { hosts, root, popup, frame, sent } = setup();
  hosts.add(popup.document);
  root.nodes.delete('#preview'); popup.nodes.set('#preview', frame);
  assert.equal(hosts.query('#preview'), frame);
  hosts.postPreview({ type: 'locate' });
  assert.equal(sent[0][0].type, 'locate');
  const relayed = [];
  hosts.frameTransport = (target, data) => relayed.push([target, data]);
  hosts.postPreview({ type: 'outline' });
  const thumbnail = {};
  hosts.postFrame(thumbnail, { type: 'page' });
  assert.equal(relayed[0][0], frame); assert.equal(relayed[1][0], thumbnail);
});
test('closing a host removes its listeners and restores a usable active document', () => {
  const { hosts, root, popup } = setup();
  hosts.add(popup.document); popup.document.emit('pointerdown');
  popup.document.defaultView.closed = true;
  assert.equal(hosts.activeDocument(), root.document);
  let calls = 0; hosts.on('click', () => calls++);
  hosts.remove(popup.document); popup.document.emit('click'); root.document.emit('click');
  assert.equal(calls, 1);
});


test('removing a popup settles dialog cancellation and closes unhandled dialogs', () => {
  const { hosts, popup } = setup();
  hosts.add(popup.document);
  popup.document.defaultView.Event = Event;
  let settled = false, defaultClose = null, preventedClose = false;
  const handled = { open: true, dispatchEvent(event) { assert.equal(event.cancelable, true); event.preventDefault(); settled = true; this.open = false; }, close() { throw new Error('already handled cancellation'); } };
  const unhandled = { open: true, dispatchEvent() {}, close(value) { this.open = false; defaultClose = value; } };
  const prevented = { open: true, dispatchEvent(event) { event.preventDefault(); }, close() { preventedClose = true; } };
  popup.document.querySelectorAll = selector => { assert.equal(selector, 'dialog[open]'); return [handled, unhandled, prevented]; };
  hosts.remove(popup.document);
  assert.equal(settled, true);
  assert.equal(defaultClose, '');
  assert.equal(preventedClose, false);
});

test('closed hosts release cached UI nodes and tolerate a missing defaultView', () => {
  const { hosts, root, popup } = setup();
  hosts.add(popup.document);
  popup.document.defaultView = null;
  const moved = [], menu = { tagName: 'DIV', hidden: false }, dialog = { tagName: 'DIALOG', open: false };
  let canceled = false;
  const open = { open: true, dispatchEvent(event) { canceled = event.cancelable; }, close() { this.open = false; } };
  root.document.body = { appendChild(node) { moved.push(node); } };
  root.document.adoptNode = node => { node.ownerDocument = root.document; return node; };
  popup.document.querySelectorAll = selector => selector === 'dialog[open]' ? [open] : [menu, dialog];
  hosts.remove(popup.document);
  assert.equal(canceled, true);
  assert.deepEqual(moved, [menu, dialog]);
  assert.equal(menu.hidden, true);
  assert.equal(dialog.ownerDocument, root.document);
});
