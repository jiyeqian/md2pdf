import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCacheReadinessGate } from '../web/cache-readiness.mjs';

function harness({ appReady = false, previewReady = false, previewError = false, hasDocument = false, hidden = false } = {}) {
  const listeners = new Map(), timers = [], calls = [];
  const target = () => ({
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    emit(type) { for (const fn of listeners.get(type) || []) fn(); },
  });
  const window = target();
  Object.assign(window, { __MD2PDF_APP_READY__:appReady, __MD2PDF_PREVIEW_READY__:previewReady, __MD2PDF_PREVIEW_ERROR__:previewError,
    mdEditor:{ getValue:() => hasDocument ? '# doc' : '' } });
  const document = target();
  document.visibilityState = hidden ? 'hidden' : 'visible';
  createCacheReadinessGate({ window, document, start:() => calls.push('start'), setTimer:(fn, ms) => timers.push({ fn, ms }) });
  return { window, document, timers, calls };
}

test('observes app-ready then preview-ready and starts once', () => {
  const h = harness(); h.window.emit('md-app-ready');
  assert.deepEqual(h.calls, []);
  assert.equal(h.timers.find(t => t.ms === 10000) !== undefined, true);
  h.window.emit('md-preview-ready'); h.window.emit('md-preview-ready');
  assert.deepEqual(h.calls, ['start']);
});

test('observes preview-ready before app-ready and reads both ready flags at module load', () => {
  const earlyPreview = harness(); earlyPreview.window.emit('md-preview-ready'); earlyPreview.window.emit('md-app-ready');
  assert.deepEqual(earlyPreview.calls, ['start']);
  const alreadyReady = harness({ appReady:true, previewReady:true });
  assert.deepEqual(alreadyReady.calls, ['start']);
  assert.equal(alreadyReady.timers.some(t => t.ms === 10000 || t.ms === 35000), false);
});

test('preview errors start after app readiness without waiting for fallback', () => {
  const h = harness(); h.window.emit('md-preview-error');
  assert.deepEqual(h.calls, []);
  h.window.emit('md-app-ready');
  assert.deepEqual(h.calls, ['start']);
});

test('a preview error emitted before the gate module loads is retained', () => {
  const beforeApp = harness({ previewError:true });
  assert.deepEqual(beforeApp.calls, []);
  beforeApp.window.emit('md-app-ready');
  assert.deepEqual(beforeApp.calls, ['start']);
  const alreadyReady = harness({ appReady:true, previewError:true });
  assert.deepEqual(alreadyReady.calls, ['start']);
  assert.equal(alreadyReady.timers.some(t=>t.ms===10000||t.ms===35000),false);
});

test('blank and nonblank documents use bounded fallback delays', () => {
  const blank = harness(); blank.window.emit('md-app-ready');
  blank.timers.find(t => t.ms === 10000).fn();
  assert.deepEqual(blank.calls, ['start']);
  const content = harness({ hasDocument:true }); content.window.emit('md-app-ready');
  content.timers.find(t => t.ms === 35000).fn();
  assert.deepEqual(content.calls, ['start']);
});

test('hidden documents defer normal starts until visible, with a hard maximum fallback', () => {
  const h = harness({ appReady:true, previewReady:true, hidden:true });
  assert.deepEqual(h.calls, []);
  h.document.visibilityState = 'visible'; h.document.emit('visibilitychange');
  assert.deepEqual(h.calls, ['start']);
  const forced = harness({ appReady:true, hidden:true });
  forced.timers.find(t => t.ms === 60000).fn();
  assert.deepEqual(forced.calls, ['start']);
});
