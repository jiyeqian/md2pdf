import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOperationalMetrics } from '../src/operational-metrics.mjs';
import { createApp } from '../src/server.mjs';

test('operational counters persist only bounded dimensions and prune at ninety calendar days', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-metrics-'));
  const file = path.join(directory, 'metrics.json');
  let current = Date.parse('2026-01-01T12:00:00Z');
  const metrics = createOperationalMetrics({ enabled: true, file, now: () => current });
  try {
    metrics.record('GET', '/?document=PRIVATE', 200, 42);
    metrics.record('GET', '/users/PRIVATE', 404, 1001);
    metrics.record('POST', '/api/render?document=PRIVATE', 200, 3001);
    metrics.flush();
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /PRIVATE|document|users|visitor|address/);
    assert.equal(JSON.parse(text).counts.length, 3);
    current += 89 * 86400000;
    assert.equal(metrics.snapshot().counts.length, 3);
    current += 86400000;
    metrics.flush();
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).counts, []);
    metrics.record('POST', '/api/pdf', 503, 30000);
    metrics.close();
    const restored = createOperationalMetrics({ enabled: true, file, now: () => current });
    assert.equal(restored.snapshot().counts[0].route, 'pdf');
    assert.equal(restored.snapshot().counts[0].duration, 'gte30s');
    restored.close();
  } finally { metrics.close(); await rm(directory, { recursive: true, force: true }); }
});

test('public server counts requests without consent or a public metrics API; local defaults off', async () => {
  for (const publicHost of ['', 'md2pdf.app.workbuddy.host']) {
    const app = createApp({ publicHost });
    try {
      await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${app.server.address().port}`;
      assert.equal((await fetch(base)).status, 200);
      assert.equal((await fetch(base + '/api/operational-metrics')).status, 404);
      const counts = app.operationalMetrics().counts;
      assert.equal(counts.reduce((sum, row) => sum + row.count, 0), publicHost ? 2 : 0);
      if (publicHost) assert.equal(counts.find(row => row.route === 'page').count, 1);
    } finally { await app.close(); }
  }
});
