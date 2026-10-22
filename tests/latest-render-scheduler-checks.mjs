import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatestRenderScheduler } from '../web/platform-static/latest-render-scheduler.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));

test('only the newest not-yet-started task for one consumer is invoked', async () => {
  const schedule = createLatestRenderScheduler();
  const calls = [];
  const old = schedule('editor', async () => { calls.push('old'); return 'old'; });
  const latest = schedule('editor', async () => { calls.push('latest'); return 'latest'; });
  await assert.rejects(old, { name: 'AbortError' });
  assert.equal(await latest, 'latest');
  assert.deepEqual(calls, ['latest']);
});

test('a newer request aborts active work and starts latest work without affecting another consumer', async () => {
  const schedule = createLatestRenderScheduler();
  let staleSignal;
  const stale = schedule('editor', signal => new Promise(resolve => {
    staleSignal = signal;
    signal.addEventListener('abort', () => resolve('stale-stopped'), { once: true });
  }));
  await turn();
  const independent = schedule('template:general', async () => 'template');
  const latest = schedule('editor', async signal => {
    assert.equal(signal.aborted, false);
    return 'latest';
  });
  assert.equal(await stale, 'stale-stopped');
  assert.equal(staleSignal.aborted, true);
  assert.equal(await independent, 'template');
  assert.equal(await latest, 'latest');
});

test('external consumer abort is propagated before work starts', async () => {
  const schedule = createLatestRenderScheduler();
  const controller = new AbortController();
  const pending = schedule('template:paper', async () => assert.fail('aborted work must not start'), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
