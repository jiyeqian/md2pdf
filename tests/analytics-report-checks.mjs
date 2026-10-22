import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, parseResults, reportSQL, shapeReport } from '../integrations/analytics-worker/report.mjs';
test('report accepts only fixed periods and local flag', () => {
  assert.deepEqual(parseOptions([]), { days: 7, local: false });
  assert.deepEqual(parseOptions(['--days', '30', '--local']), { days: 30, local: true });
  for (const args of [['--days', '2'], ['--command', 'DELETE'], ['--days', '7;drop']]) assert.throws(() => parseOptions(args));
  assert.throws(() => reportSQL('7;drop'));
});
test('Wrangler results reject failures and malformed data', () => {
  assert.deepEqual(parseResults('[{"success":true,"results":[]}]'), []);
  for (const value of ['not JSON', '{}', '[{"success":false,"results":[]}]', '[{"success":true}]']) assert.throws(() => parseResults(value));
});
test('small dimensions are suppressed; daily totals remain event counts', () => {
  const result = shapeReport([{ group_name: 'country', label: 'DE', total: 4 }, { group_name: 'country', label: 'US', total: 5 }, { group_name: 'daily', label: '2026-10-22', event: 'page_view', total: 2 }], 7);
  assert.deepEqual(result.dimensions.country, [{ value: 'US', count: 5 }]);
  assert.equal(result.dailyEvents[0].count, 2);
  assert.match(result.metric, /not unique people/);
  assert.throws(() => shapeReport([{ group_name: 'country', label: 'US', total: '5' }], 7));
});
test('fixed queries restrict country to page views and aggregate before output', () => {
  const sql = reportSQL(7);
  assert.match(sql, /'-7 days'/); assert.match(sql, /CASE WHEN event='page_view' AND country IS NOT NULL THEN json_object\('group_name','country'/);
  assert.match(sql, /OR count\(\*\) >= 5/); assert.doesNotMatch(sql, /UNION/i); assert.doesNotMatch(sql, /SELECT minute,|user_id|request_ip/);
});

test('real SQLite executes report against fixtures without compound SELECT', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const sql = reportSQL(7);
  const script = `
import sqlite3,json,sys,datetime
c=sqlite3.connect(':memory:')
c.row_factory=sqlite3.Row
c.execute('CREATE TABLE events(minute TEXT,event TEXT,version TEXT,deployment TEXT,properties TEXT,country TEXT,site TEXT,visitor_id TEXT)')
now=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:00Z')
def add(event,props,country,count):
 for i in range(count): c.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',(now,event,'1.15.6','static',json.dumps(props),country,'local',('visitor-'+str(i%2)) if event=='page_view' else None))
add('page_view',{'device':'desktop','browser':'chrome','source':'direct'},'DE',5)
add('page_view',{'device':'mobile','browser':'safari','source':'campaign','campaign':'github'},'US',4)
add('export_started',{'method':'browser-print'},'XX',6)
add('template_selected',{'template':'paper'},'XX',5)
add('preview_finished',{'success':True,'duration':'lt1s'},'XX',5)
add('export_failed',{'code':'timeout'},'XX',5)
add('offline_ready',{'ready':True},'XX',5)
print(json.dumps([dict(row) for row in c.execute(sys.argv[1])]))
`;
  const result = spawnSync('python3', ['-c', script, sql], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') { t.skip('python3 unavailable for SQLite report test'); return; }
  assert.equal(result.status, 0, result.stderr);
  const report = shapeReport(JSON.parse(result.stdout), 7);
  assert.deepEqual(report.dimensions.country, [{ value: 'DE', count: 5 }]);
  assert.deepEqual(report.dimensions.device, [{ value: 'desktop', count: 5 }]);
  assert.equal(report.dimensions.campaign, undefined);
  assert.deepEqual(report.dimensions.export_method, [{ value: 'browser-print', count: 6 }]);
  assert.deepEqual(report.dimensions.preview_success, [{ value: '1', count: 5 }]);
  assert.equal(report.dailyEvents.find((row) => row.event === 'page_view').count, 9);
  assert.equal(report.dailyEvents.length, 6);
  assert.deepEqual(report.activeBrowsers.period, [{ site: 'local', count: 2, firstObserved: 2, returning: 0 }]);
  assert.equal(report.activeBrowsers.daily[0].count, 2);
});

test('period browsers deduplicate repeat days and remain separated by site', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('python3', ['-c', `
import sqlite3,json,sys,datetime
c=sqlite3.connect(':memory:');c.row_factory=sqlite3.Row
c.execute('CREATE TABLE events(minute TEXT,event TEXT,version TEXT,deployment TEXT,properties TEXT,country TEXT,site TEXT,visitor_id TEXT)')
for day in [0,1]:
 stamp=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=day)).strftime('%Y-%m-%dT%H:%M:00Z')
 for site,visitor in [('local','a'),('local','a'),('official-static','a'),('legacy',None)]:
  c.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',(stamp,'page_view','1.15.6','static','{}','XX',site,visitor))
old=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=8)).strftime('%Y-%m-%dT%H:%M:00Z')
c.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',(old,'page_view','1.15.6','static','{}','XX','local','a'))
print(json.dumps([dict(row) for row in c.execute(sys.argv[1])]))
`, reportSQL(7)], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') { t.skip('python3 unavailable'); return; }
  assert.equal(result.status, 0, result.stderr);
  const report = shapeReport(JSON.parse(result.stdout), 7);
  assert.deepEqual(report.activeBrowsers.period, [{ site: 'local', count: 1, firstObserved: 0, returning: 1 }, { site: 'official-static', count: 1, firstObserved: 1, returning: 0 }]);
  assert.equal(report.activeBrowsers.daily.length, 4);
  assert.equal(report.dailyEvents.reduce((sum, row) => sum + row.count, 0), 8);
});
