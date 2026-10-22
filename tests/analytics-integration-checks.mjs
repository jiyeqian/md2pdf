import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyticsConfig } from '../src/analytics-config.mjs';
import { validateEvent } from '../web/analytics-schema.mjs';
import { createApp } from '../src/server.mjs';
import { buildStatic } from '../src/static-build.mjs';

test('public configuration fails closed and only accepts a clean HTTPS event endpoint', () => {
  assert.equal(analyticsConfig({ MD2PDF_ANALYTICS_ENABLED: '0' }).enabled, false);
  for (const endpoint of ['http://example.com/events', 'https://u:p@example.com/events', 'https://example.com/events?doc=secret', 'https://example.com/', 'invalid']) {
    assert.equal(analyticsConfig({ MD2PDF_ANALYTICS_ENABLED: '1', MD2PDF_ANALYTICS_ENDPOINT: endpoint }).enabled, false);
  }
  assert.equal(analyticsConfig({ MD2PDF_ANALYTICS_ENABLED: '1', MD2PDF_ANALYTICS_ENDPOINT: 'https://metrics.example.com/events' }).enabled, true);
});

test('payload schema rejects document fields, arbitrary values, and missing fields', () => {
  const value = { event: 'template_selected', version: '1.15.6', deployment: 'static', properties: { template: 'paper', theme: 'elegant' } };
  assert.deepEqual(validateEvent(value), value);
  assert.equal(validateEvent({ ...value, title: 'private' }), null);
  assert.equal(validateEvent({ ...value, properties: { ...value.properties, file: 'secret.md' } }), null);
  assert.equal(validateEvent({ ...value, properties: { template: 'private-custom-template', theme: 'elegant' } }), null);
  assert.equal(validateEvent({ ...value, properties: { template: 'paper' } }), null);
});

test('Node serves shared privacy assets and caches public configuration without changing document routes', async () => {
  const app = createApp();
  try {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    for (const file of ['analytics.mjs', 'analytics-schema.mjs', 'analytics-bootstrap.mjs', 'analytics.css', 'privacy.html']) {
      assert.equal((await fetch(`${base}/${file}`)).status, 200, file);
    }
    const response = await fetch(`${base}/analytics-config.json`);
    assert.deepEqual(await response.json(), analyticsConfig());
    const worker = await (await fetch(`${base}/service-worker.js`)).text();
    assert.match(worker, /analytics-config\.json/);
    assert.match(worker, /analytics-schema\.mjs/);
    const index = await (await fetch(base)).text();
    assert.match(index, /analytics-bootstrap\.mjs/);
    assert.equal((await fetch(base + '/?utm_source=github')).status, 200);
  } finally { await app.close(); }
});

test('static build contains the same consent/schema/config and project-relative resource links', async () => {
  const build = await buildStatic();
  const file = name => readFile(`${build.directory}/${name}`, 'utf8');
  assert.deepEqual(JSON.parse(await file('analytics-config.json')), analyticsConfig());
  assert.equal(await file('analytics-schema.mjs'), await readFile(new URL('../web/analytics-schema.mjs', import.meta.url), 'utf8'));
  assert.match(await file('index.html'), /src="\.\/analytics-bootstrap\.mjs"/);
  assert.match(await file('privacy.html'), /href="\.\/"/);
  assert.match(await file('service-worker.js'), /analytics-config\.json/);
});
