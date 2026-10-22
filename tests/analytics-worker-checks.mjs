import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../integrations/analytics-worker/worker.mjs';
const origin = 'https://md2pdf.qianjiye.de';
const event = { event: 'export_started', version: '1.15.6', deployment: 'static', properties: { method: 'browser-print' } };
function environment(success = true) {
  const queries = [];
  return { queries, EVENT_LIMITER: { async limit() { return { success }; } }, DB: { prepare(sql) { const entry = { sql, values: [] }; queries.push(entry); return { bind(...values) { entry.values = values; return this; }, async run() { return {}; } }; } } };
}
function request(body = event, extra = {}) { return new Request('https://receiver.example/events', { method: 'POST', headers: { origin, 'content-type': 'application/json', ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) }); }
test('valid event is parameterized and excludes request metadata', async () => {
  const env = environment(); const result = await worker.fetch(request(event, { 'cf-connecting-ip': '192.0.2.1', 'user-agent': 'secret' }), env);
  assert.equal(result.status, 204); assert.equal(result.headers.get('access-control-allow-origin'), origin);
  assert.equal(env.queries.length, 1); assert.match(env.queries[0].sql, /SELECT \?, \?, \?, \?, \?, \?, \?, \? WHERE/);
  assert.equal(env.queries[0].values.includes('192.0.2.1'), false); assert.equal(env.queries[0].values.includes('secret'), false);
});
test('invalid and absent origins are rejected before storage', async () => {
  for (const value of ['file:///tmp/test', 'https://evil.example/path', 'null', '']) { const env = environment(); assert.equal((await worker.fetch(request(event, { origin: value }), env)).status, 403); assert.equal(env.queries.length, 0); }
});
test('preflight allows only JSON POST and exact origin', async () => {
  const req = new Request('https://receiver.example/events', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  assert.equal((await worker.fetch(req, environment())).status, 204);
  const bad = new Request(req, { headers: { origin, 'access-control-request-method': 'DELETE' } }); assert.equal((await worker.fetch(bad, environment())).status, 403);
});
test('invalid JSON, unsupported content and additional fields are rejected', async () => {
  for (const body of ['{', { ...event, filename: 'private.md' }, { ...event, properties: { method: 'browser-print', text: 'private' } }]) assert.equal((await worker.fetch(request(body), environment())).status, 400);
  assert.equal((await worker.fetch(request(event, { 'content-type': 'text/plain' }), environment())).status, 415);
});
test('stream body cap holds without content-length and when misleading', async () => {
  for (const headers of [{}, { 'content-length': '1' }]) {
    const env = environment(); assert.equal((await worker.fetch(request(' '.repeat(2049), headers), env)).status, 413); assert.equal(env.queries.length, 0);
  }
});
test('rate limit and unavailable bindings fail closed', async () => {
  assert.equal((await worker.fetch(request(), environment(false))).status, 429);
  assert.equal((await worker.fetch(request(), {})).status, 503);
});
test('health has no database access and retention removes old rows', async () => {
  assert.equal((await worker.fetch(new Request('https://receiver.example/health'), {})).status, 200);
  const env = environment(); await worker.scheduled({}, env); assert.match(env.queries[0].sql, /DELETE FROM events/); assert.match(env.queries[0].sql, /-90 days/);
});

test('daily storage budget fails closed', async () => {
  const env = environment(); env.DB.prepare = () => ({ bind() { return this; }, async run() { return { meta: { changes: 0 } }; } });
  assert.equal((await worker.fetch(request(), env)).status, 429);
});

test('country uses Cloudflare metadata only and rejects submitted country', async () => {
  const env = environment();
  const page = { event: 'page_view', version: '1.15.6', deployment: 'static', properties: { source: 'direct', device: 'desktop', browser: 'chrome', os: 'macos', language: 'zh' } };
  const req = request(page, { 'cf-ipcountry': 'US' });
  Object.defineProperty(req, 'cf', { value: { country: 'DE' } });
  assert.equal((await worker.fetch(req, env)).status, 204);
  assert.equal(env.queries[0].values[5], 'DE');
  const product = environment(); const productReq = request();
  Object.defineProperty(productReq, 'cf', { value: { country: 'DE' } });
  await worker.fetch(productReq, product); assert.equal(product.queries[0].values[5], 'XX');
  const fallback = environment(); await worker.fetch(request(event, { 'cf-ipcountry': 'US' }), fallback);
  assert.equal(fallback.queries[0].values[5], 'XX');
  assert.equal((await worker.fetch(request({ ...event, country: 'US' }), environment())).status, 400);
});

test('scheduled cleanup binds retention to ninety days and removes counters', async () => {
  const env = environment(); await worker.scheduled({}, env);
  assert.equal(env.queries.length, 2);
  assert.match(env.queries[0].sql, /minute < strftime\('%Y-%m-%dT%H:%M:00Z', 'now', '-90 days'\)/);
  assert.match(env.queries[1].sql, /day < date\('now', '-90 days'\)/);
});

test('SQLite migration trigger, budget and ninety-day boundary', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const migration = fileURLToPath(new URL('../integrations/analytics-worker/migrations/0001_events.sql', import.meta.url));
  const result = spawnSync('python3', ['-c', `
import sqlite3,sys
c=sqlite3.connect(':memory:')
c.executescript(open(sys.argv[1]).read())
sql="INSERT INTO events(minute,event,version,deployment,properties,country) SELECT ?,'page_view','1.15.6','static','{}','XX' WHERE coalesce((SELECT total FROM daily_counts WHERE day=?),0)<10000"
c.execute(sql,('2026-07-24T00:00:00Z','2026-07-24'))
c.execute(sql,('2026-07-23T23:59:00Z','2026-07-23'))
c.executescript(open(sys.argv[1].replace('0001_events.sql','0002_visitors.sql')).read())
assert c.execute('SELECT site,visitor_id FROM events LIMIT 1').fetchone()==('legacy',None)
c.execute("UPDATE events SET visitor_id='12345678-1234-4234-8234-123456789abc' WHERE minute='2026-07-23T23:59:00Z'")
c.execute('DELETE FROM events WHERE visitor_id=?',('12345678-1234-4234-8234-123456789abc',))
assert c.execute('SELECT total FROM daily_counts WHERE day=?',('2026-07-23',)).fetchone()==(1,)
assert c.execute('SELECT total FROM daily_counts WHERE day=?',('2026-07-24',)).fetchone()==(1,)
c.execute('UPDATE daily_counts SET total=10000 WHERE day=?',('2026-07-24',))
c.execute(sql,('2026-07-24T00:01:00Z','2026-07-24'))
assert c.execute('SELECT count(*) FROM events').fetchone()==(1,)
c.execute("DELETE FROM events WHERE minute < strftime('%Y-%m-%dT%H:%M:00Z','2026-10-22T00:00:00Z','-90 days')")
assert c.execute('SELECT minute FROM events').fetchall()==[('2026-07-24T00:00:00Z',)]
`, migration], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') { t.skip('python3 unavailable for SQLite migration test'); return; }
  assert.equal(result.status, 0, result.stderr);
});

const visitorId = '12345678-1234-4234-8234-123456789abc';
test('all HTTP deployments pass CORS while identifiers stay page-view only', async () => {
  for (const value of ['http://localhost:3180', 'http://127.0.0.1:3000', 'https://self.example']) {
    const result = await worker.fetch(request(event, { origin: value }), environment());
    assert.equal(result.status, 204); assert.equal(result.headers.get('access-control-allow-origin'), value);
  }
  assert.equal((await worker.fetch(request({ ...event, visitorId }), environment())).status, 400);
  const page = { event: 'page_view', version: '1.15.6', deployment: 'static', site: 'local', visitorId, properties: { source: 'direct', device: 'desktop', browser: 'chrome', os: 'macos', language: 'zh' } };
  const env = environment(); assert.equal((await worker.fetch(request(page), env)).status, 204);
  assert.equal(env.queries[0].values[6], 'local'); assert.equal(env.queries[0].values[7], visitorId);
  assert.equal((await worker.fetch(request({ ...page, visitorId: 'private filename' }), environment())).status, 400);
});
test('forget removes linked rows only and cannot reset event budget', async () => {
  const req = body => new Request('https://receiver.example/forget', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const env = environment(); assert.equal((await worker.fetch(req({ visitorId }), env)).status, 204);
  assert.equal(env.queries[0].sql, 'DELETE FROM events WHERE visitor_id = ?');
  assert.deepEqual(env.queries[0].values, [visitorId]); assert.equal(env.queries.length, 1);
  for (const body of [{ visitorId: 'bad' }, { visitorId, other: true }, []]) assert.equal((await worker.fetch(req(body), environment())).status, 400);
  assert.equal((await worker.fetch(req({ visitorId }), environment(false))).status, 429);
});
