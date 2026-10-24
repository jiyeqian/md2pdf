import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { enhancePreview } from '../src/preview.mjs';
const source = readFileSync(new URL('../web/preview-thumbnails.js', import.meta.url), 'utf8');
function harness() {
  const listeners = {}, previewListeners = {}, requests = [], events = [], frames = [], container = {children: [], append(frame) {this.children.push(frame);}};
  const preview = {contentWindow: {postMessage(message) {requests.push(message);}}, addEventListener(type, callback) {previewListeners[type] = callback;}};
  let next = 0;
  const window = {addEventListener(type, callback) {(listeners[type] ||= []).push(callback);}, dispatchEvent(event) {events.push(event.type); for (const callback of listeners[event.type] || []) callback(event);}};
  const document = {querySelector: () => preview, createElement(tag) {
    assert.equal(tag, 'iframe');
    const frame = {style: {}, attributes: {}, sent: [], setAttribute(name, value) {this.attributes[name] = value;}, remove() {container.children = container.children.filter(child => child !== this);}, contentWindow: {postMessage(message) {frame.sent.push(message);}}};
    frames.push(frame); return frame;
  }};
  vm.runInNewContext(source, {window, document, crypto: {randomUUID: () => 'session-' + (++next)}, addEventListener: window.addEventListener, queueMicrotask: callback => callback(), CustomEvent: class {constructor(type) {this.type = type;}}});
  return {window, preview, requests, events, frames, container, load: () => previewListeners.load(), send(data, from = preview.contentWindow) {for (const callback of listeners.message || []) callback({data, source: from});}};
}
function ready(env, revision = 3) {env.send({type: 'md2pdf-ready', revision});}
function initialize(env) {
  ready(env); const api = env.window.mdPreviewThumbnails.create(env.container); api.setActive(true);
  const frame = env.frames.at(-1), request = env.requests.at(-1);
  env.send({type: 'md2pdf-thumbnails-meta', revision: 3, request: request.request, styles: 'body{}', pages: Array.from({length: 30}, () => ({width: 794, height: 1123}))});
  env.send({type: 'md2pdf-thumbnails-frame-ready', token: request.request.split(':')[0]}, frame.contentWindow);
  const token = frame.sent[0].token;
  return {api, frame, token};
}

test('inactive thumbnails allocate no frame; active uses one nonce-only opaque sandbox and releases it', () => {
  const env = harness(); ready(env);
  const api = env.window.mdPreviewThumbnails.create(env.container);
  assert.equal(env.frames.length, 0);
  api.setActive(true); api.setActive(true);
  assert.equal(env.frames.length, 1);
  const frame = env.frames[0];
  assert.equal(frame.attributes.sandbox, 'allow-scripts');
  assert.ok(!frame.srcdoc.includes('allow-same-origin'));
  assert.match(frame.srcdoc, /script-src 'nonce-[^']+'/);
  assert.ok(!frame.srcdoc.includes("script-src 'unsafe-inline'"));
  assert.equal(env.events[0], 'md-preview-request-paged');
  api.setActive(false); assert.equal(env.container.children.length, 0);
  api.setActive(true); assert.equal(env.frames.length, 2);
});

test('page requests are bounded to two, validated, and delivered only to the current child frame', () => {
  const env = harness(), {frame, token} = initialize(env);
  env.send({type: 'md2pdf-thumbnails-want', token, revision: 3, indices: Array.from({length: 30}, (_, index) => index)}, frame.contentWindow);
  const pages = env.requests.filter(message => message.type === 'md2pdf-thumbnails-page');
  assert.equal(pages.length, 2);
  const first = pages[0];
  env.send({...first, html: '<div>untrusted</div>'}, {});
  assert.equal(frame.sent.length, 1);
  env.send({...first, html: '<div>untrusted</div>', revision: 2});
  assert.equal(frame.sent.length, 1);
  env.send({...first, html: '<div>untrusted</div>'});
  assert.equal(frame.sent[1].type, 'md2pdf-thumbnails-deliver');
  assert.equal(env.requests.filter(message => message.type === 'md2pdf-thumbnails-page').length, 3);
  assert.ok(!frame.srcdoc.includes('untrusted'));
});

test('refresh invalidates old sessions and closing prevents further requests or stale HTML', () => {
  const env = harness(), {api, frame, token} = initialize(env);
  env.send({type: 'md2pdf-thumbnails-want', token, revision: 3, indices: [0]}, frame.contentWindow);
  const oldRequest = env.requests.at(-1);
  env.load(); ready(env, 4);
  assert.equal(env.container.children.length, 1);
  env.send({...oldRequest, html: 'old'});
  assert.equal(env.frames.at(-1).sent.length, 0);
  api.setActive(false); const count = env.requests.length;
  env.send({type: 'md2pdf-thumbnails-want', token, revision: 3, indices: [0]}, frame.contentWindow);
  assert.equal(env.requests.length, count);
});

test('sandbox Escape is bridged to preview sidebar closure', () => {
  const env = harness(), {frame, token} = initialize(env);
  env.send({type: 'md2pdf-thumbnails-close', token, revision: 3}, frame.contentWindow);
  assert.ok(env.events.includes('md-preview-sidebar-close'));
});

test('preview protocol checks parent and revision and serializes only a requested sanitized page', () => {
  const html = enhancePreview('<html><body></body></html>');
  assert.ok(html.includes('event.source !== parent || !data || data.revision !== MD2PDF_PREVIEW_REVISION'));
  assert.ok(html.includes('data.index >= pages.length'));
  assert.ok(html.includes('var copy = page.cloneNode(true)'));
  assert.ok(html.includes('copy.querySelectorAll("script,iframe,object,embed,meta,link")'));
  assert.ok(html.includes('if (/^on/i.test(attr.name)) node.removeAttribute(attr.name)'));
  assert.ok(source.includes('if (!wanted.has(index)) row.querySelector(\'.page-copy\').replaceChildren()'));
  assert.ok(source.includes('new IntersectionObserver'));
  assert.ok(source.includes('MAX_VISIBLE = 12, MAX_IN_FLIGHT = 2'));
});
