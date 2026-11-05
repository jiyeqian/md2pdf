import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../web/editor-workspace.js', import.meta.url), 'utf8');
const core = await readFile(new URL('../web/editor-core.js', import.meta.url), 'utf8');

function customEvent(type, { detail } = {}) { this.type = type; this.detail = detail; }

test('content bridge rejects stale, unready, invalid and out-of-range positions', () => {
  let listener;
  const sent = [];
  const context = vm.createContext({
    document: { addEventListener: (type, fn) => { assert.equal(type, 'md-preview-locate'); listener = fn; } },
    editor: { value: 'abcdefghij' }, revision: 3, previewRevision: 3,
    window: { __MD2PDF_PREVIEW_READY__: true },
    preview: { contentWindow: { postMessage: data => sent.push(data) } },
  });
  vm.runInContext(app.slice(app.indexOf('function postPreview('), app.indexOf('function workspaceQuery(')), context);
  vm.runInContext(app.slice(app.indexOf('function contentPosition('), app.indexOf("window.addEventListener('message', event => {\n  if (event.source !== preview.contentWindow")), context);
  listener({ detail: { from: 2, to: 6, reason: 'cursor', ratio: .3 } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].revision, 3);
  assert.equal(sent[0].type, 'md2pdf-content-locate');
  for (const detail of [ { from: -1, reason: 'scroll' }, { from: 11, reason: 'scroll' }, { from: 1.5, reason: 'scroll' }, { from: 5, to: 3, reason: 'cursor' }, { from: 3, reason: 'other' } ]) listener({ detail });
  context.previewRevision = 2;
  listener({ detail: { from: 3, reason: 'scroll' } });
  context.previewRevision = 3;
  context.window.__MD2PDF_PREVIEW_READY__ = false;
  listener({ detail: { from: 3, reason: 'scroll' } });
  assert.equal(sent.length, 1);
});

test('incoming scroll reveals without moving cursor, activation works with sync disabled', () => {
  const calls = [];
  const context = vm.createContext({
    hasEditor: () => true, ready: true, fullscreenMode: () => null,
    syncInput: { checked: true }, suppressUntil: 0, cursorTimer: 0,
    clearTimeout() {}, Date,
    window: { mdEditor: {
      revealPosition: (...args) => calls.push(['reveal', ...args]),
      goToPosition: (...args) => calls.push(['activate', ...args]),
      highlightRange: (...args) => calls.push(['highlight', ...args]),
    } },
  });
  const start = workspace.indexOf('  function onPreviewContentSource(');
  vm.runInContext(workspace.slice(start, workspace.indexOf('  function onCursor(', start)), context);
  context.onPreviewContentSource({ detail: { from: 8, ratio: .3, reason: 'scroll' } });
  assert.deepEqual(calls[0], ['reveal', 8, .3, false]);
  context.syncInput.checked = false;
  context.onPreviewContentSource({ detail: { from: 12, ratio: .4, reason: 'scroll' } });
  assert.equal(calls.length, 1);
  context.onPreviewContentSource({ detail: { from: 12, ratio: .4, reason: 'activate' } });
  assert.deepEqual(calls[1], ['activate', 12, .4]);
  assert.ok(context.suppressUntil > Date.now());
  context.onPreviewContentSource({ detail: { from: 4, to: 7, ratio: .2, reason: 'selection' } });
  assert.equal(calls.length, 2, 'disabled sync ignores selections');
  context.onPreviewContentSource({ detail: { from: 3, to: 9, ratio: .3, reason: 'outline' } });
  assert.equal(calls.length, 2, 'disabled sync keeps outline navigation local');
  context.syncInput.checked = true;
  context.onPreviewContentSource({ detail: { from: 4, to: 7, ratio: .2, reason: 'selection' } });
  assert.deepEqual(calls.slice(-2), [['reveal', 4, .2, false], ['highlight', 4, 7]]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.previewSelection)),{from:4,to:7,ratio:.2},'remember mapped selection for the newly visible editor');
  context.onPreviewContentSource({ detail: { from: 3, to: 9, reason: 'outline' } });
  assert.equal(context.outlineAnchor, 3, 'remember outline without moving the old caret');
  assert.equal(context.previewSelection,null,'new outline navigation supersedes the old preview range');
  context.onPreviewContentSource({ detail: { from: 8, reason: 'scroll' } });
  assert.equal(context.outlineAnchor, null, 'explicit scrolling supersedes outline');

});

test('cursor events include character changes within the same source line', () => {
  const events = [];
  const selection = { head: 4, from: 4, to: 4 };
  const context = vm.createContext({ lastCursorLine: -1, lastCursorPosition: -1, lastSelectionFrom: -1, lastSelectionTo: -1,
    view: { state: { selection: { main: selection } } },
    CustomEvent: customEvent, doc: { dispatchEvent: event => events.push(event.detail) },
  });
  const start = core.indexOf('    function emitCursor(');
  vm.runInContext(core.slice(start, core.indexOf('    // Full extension list', start)), context);
  context.emitCursor(2);
  context.emitCursor(2);
  selection.head = selection.from = selection.to = 7;
  context.emitCursor(2);
  assert.equal(events.length, 2);
  assert.equal(events[1].line, 2);
  assert.equal(events[1].position, 7);
  selection.from = 2;
  context.emitCursor(2);
  assert.equal(events.length, 3);
  assert.equal(events[2].from, 2);
});


test('reveal scrolls and unfolds containing folds without selecting or focusing', () => {
  const calls = [];
  let selection;
  const view = {
    state: { doc: { length: 100 } },
    dispatch: action => { selection = action.selection; calls.push(action.effects); },
    scrollDOM: { scrollTop: 100, clientHeight: 200, getBoundingClientRect: () => ({ top: 40 }) },
    coordsAtPos: () => ({ top: 200 }),
    requestMeasure: measure => measure.write(measure.read()),
    focus: () => calls.push('focus'),
  };
  const context = vm.createContext({ view, Number, Math, editorScrollIntentUntil: 0, editorRevealRevision: 0,
    requestAnimationFrame: fn => fn(),
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    V: { EditorView: { scrollIntoView: (from, options) => ({ scroll: from, options }) },
      foldedRanges: () => ({ between: (a, b, fn) => fn(10, 50) }), unfoldEffect: { of: range => range } },
  });
  const start = core.indexOf('      revealPosition: function (');
  const end = core.indexOf('      goToPosition:', start);
  vm.runInContext('const api = {' + core.slice(start, end) + '}; globalThis.reveal=api.revealPosition;', context);
  context.reveal(30, .3, false);
  assert.equal(selection, undefined);
  assert.equal(calls.includes('focus'), false);
  assert.equal(calls[0][0].from, 10);
  assert.equal(view.scrollDOM.scrollTop, 200);
  context.reveal(30, .3, true);
  assert.equal(selection.anchor, 30);
  assert.equal(calls.includes('focus'), true);
});


test('only user-owned editor scrolling can replace a cursor or selection location', () => {
  const sent = [];
  const context = vm.createContext({ ready: true, syncInput: { checked: true }, fullscreenMode: () => null,
    suppressUntil: 0, Date, cursorTimer: 10, clearTimeout: () => sent.push('cancel-cursor'),
    postContentLocate: (...args) => sent.push(args),
  });
  const start = workspace.indexOf('  function onEditorScroll(');
  vm.runInContext(workspace.slice(start, workspace.indexOf('  function onPreviewContentSource(', start)), context);
  context.onEditorScroll({ detail: { from: 10, ratio: .3, user: false } });
  assert.equal(sent.length, 0);
  context.onEditorScroll({ detail: { from: 10, ratio: .3, user: true } });
  assert.equal(sent[0], 'cancel-cursor');
  assert.deepEqual(sent[1], [10, 10, 'scroll', .3, true]);
});


test('offscreen wrapped targets are rendered at the exact offset before visual alignment', () => {
  const frames = [], dispatched = [];
  let rendered = false;
  const view = {
    state: { doc: { length: 50000 } },
    dispatch: action => { dispatched.push(action); },
    scrollDOM: { scrollTop: 1000, clientHeight: 400, getBoundingClientRect: () => ({ top: 20 }) },
    coordsAtPos: pos => { assert.equal(pos, 30000); return rendered ? { top: 180 } : null; },
    lineBlockAt: () => { throw new Error('logical line start cannot locate a wrapped target'); },
    requestMeasure: measure => measure.write(measure.read()),
    focus: () => { throw new Error('scrolling must not focus'); },
  };
  const context = vm.createContext({ view, Number, Math, editorScrollIntentUntil: 0, editorRevealRevision: 0,
    requestAnimationFrame: fn => frames.push(fn),
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    V: { EditorView: { scrollIntoView: (from, options) => ({ scroll: from, options }) },
      foldedRanges: () => ({ between() {} }), unfoldEffect: { of: range => range } },
  });
  const start = core.indexOf('      revealPosition: function (');
  vm.runInContext('const api = {' + core.slice(start, core.indexOf('      goToPosition:', start)) + '}; globalThis.reveal=api.revealPosition;', context);
  context.reveal(30000, .3, false);
  assert.equal(dispatched[0].effects[0].scroll, 30000);
  assert.equal(dispatched[0].effects[0].options.y, 'center');
  assert.equal(dispatched[0].selection, undefined);
  assert.equal(view.scrollDOM.scrollTop, 1000);
  rendered = true; // CodeMirror's scrollIntoView has mounted this wrapped display line.
  frames.shift()();
  assert.equal(view.scrollDOM.scrollTop, 1040);
});

test('preview mirror replaces the old source range without focus or scrolling', () => {
  const transactions = [];
  const start = core.indexOf('      highlightRange: function (from, to) {');
  const end = core.indexOf('      goToPosition:', start);
  const context = vm.createContext({ view: { state: { doc: { length: 50 }, selection: { main: { head: 18 } } }, dispatch: value => transactions.push(value) },
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)), syncHighlightEffect: { of: value => value } });
  vm.runInContext('var api = ({' + core.slice(start, end) + '}); api.highlightRange(3,9)', context);
  assert.equal(transactions[0].selection.anchor, 18, 'collapse old native range at its existing caret');
  assert.deepEqual(JSON.parse(JSON.stringify(transactions[0].effects)), { from: 3, to: 9 });
  assert.equal(transactions[0].scrollIntoView, undefined);
});

test('restored preview selection does not echo as new user navigation', async () => {
  const runtime = await readFile(new URL('../src/content-sync-runtime.mjs', import.meta.url), 'utf8');
  const node = {}, sent = [];
  const selection = {rangeCount:1,isCollapsed:false,anchorNode:node,anchorOffset:0,focusNode:node,focusOffset:5,
    getRangeAt:()=>({startContainer:node,endContainer:node,intersectsNode:()=>true})};
  const context=vm.createContext({getSelection:()=>selection,restoredSelection:null,reportedSelection:null,selectionGuardUntil:0,Date,
    activeScope:()=>({contains:()=>true}),refresh:()=>[{atomic:true,item:{from:30,to:40},node:{getBoundingClientRect:()=>({top:20})}}],
    selectedRange:null,overlay:null,overlayTimer:0,clearTimeout(){},send:(reason,range)=>sent.push({reason,range})});
  vm.runInContext(runtime.slice(runtime.indexOf('  function suppressSelectionEcho('),runtime.indexOf('  let selectionTimer;')),context);
  context.suppressSelectionEcho();context.selectionSource();context.selectionSource();
  assert.equal(sent.length,0,'repeated events for the restored range stay silent');
  selection.focusOffset=6;context.selectionSource();
  assert.equal(sent.length,1,'a different selection still navigates');
  context.selectionSource();assert.equal(sent.length,1,'flushing an already reported range does not navigate again');
  context.suppressSelectionEcho();context.restoredSelection=null;context.reportedSelection=null;context.selectionSource();
  assert.equal(sent.length,2,'real pointer/keyboard ownership can select the same range');
});

test('a source range immediately invalidates the saved fullscreen preview selection', () => {
  const calls=[];
  const context=vm.createContext({ready:true,syncInput:{checked:true},fullscreenMode:()=> 'editor',suppressUntil:Date.now()+1000,Date,
    outlineAnchor:10,lastPreviewPosition:{selection:{anchor:1,focus:9}},cursorTimer:1,
    clearTimeout(){calls.push('cancel')},setTimeout(){throw new Error('source range must not be delayed')},
    locateCurrentCursor:instant=>calls.push(['locate',instant])});
  const start=workspace.indexOf('  function onCursor(event)');
  vm.runInContext(workspace.slice(start,workspace.indexOf('  function onPreviewSource(',start)),context);
  context.onCursor({detail:{line:3,from:12,to:18}});
  assert.equal(context.lastPreviewPosition,null);
  assert.equal(context.outlineAnchor,null);
  assert.deepEqual(calls,['cancel',['locate',true]]);
});
