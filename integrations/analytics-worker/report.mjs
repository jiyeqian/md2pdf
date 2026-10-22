#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const directory = path.dirname(fileURLToPath(import.meta.url));
export function parseOptions(args) {
  let days = 7; let local = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--local') local = true;
    else if (args[index] === '--days' && ['1', '7', '30', '90'].includes(args[index + 1])) days = Number(args[++index]);
    else throw new Error('usage');
  }
  return { days, local };
}
export function parseResults(output) {
  let value;
  try { value = JSON.parse(output); } catch { throw new Error('invalid-results'); }
  if (!Array.isArray(value) || value.length !== 1 || value[0]?.success !== true || !Array.isArray(value[0]?.results)) throw new Error('invalid-results');
  return value[0].results;
}
export function shapeReport(rows, days) {
  const report = { periodDays: days, metric: 'events, not unique users or sessions', minimumDimensionCount: 5, dailyEvents: [], dimensions: {} };
  for (const row of rows) {
    if (!row || typeof row.group_name !== 'string' || typeof row.label !== 'string' || !Number.isSafeInteger(row.total) || row.total < 0) throw new Error('invalid-results');
    if (row.group_name === 'daily') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.label) || typeof row.event !== 'string') throw new Error('invalid-results');
      report.dailyEvents.push({ day: row.label, event: row.event, count: row.total });
    } else if (row.total >= 5) {
      (report.dimensions[row.group_name] ||= []).push({ value: row.label, count: row.total });
    }
  }
  return report;
}
export function reportSQL(days) {
  if (![1, 7, 30, 90].includes(days)) throw new Error('usage');
  const dimensions = [
    ['country', 'page_view', 'country'],
    ...['device', 'browser', 'source', 'campaign'].map((key) => [key, 'page_view', `json_extract(properties,'$.${key}')`]),
    ['template', 'template_selected', "json_extract(properties,'$.template')"],
    ['preview_success', 'preview_finished', "CAST(json_extract(properties,'$.success') AS TEXT)"],
    ['preview_duration', 'preview_finished', "json_extract(properties,'$.duration')"],
    ['export_method', 'export_started', "json_extract(properties,'$.method')"],
    ['export_error', 'export_failed', "json_extract(properties,'$.code')"],
    ['offline_ready', 'offline_ready', "CAST(json_extract(properties,'$.ready') AS TEXT)"],
  ];
  const entries = ["json_object('group_name','daily','label',substr(minute,1,10),'event',event)", ...dimensions.map(([name, event, expression]) => `CASE WHEN event='${event}' AND ${expression} IS NOT NULL THEN json_object('group_name','${name}','label',CAST(${expression} AS TEXT),'event',NULL) END`)];
  // Expand dimensions with JSON rather than UNION: D1 limits compound SELECT terms.
  return `WITH recent AS (SELECT * FROM events WHERE minute >= strftime('%Y-%m-%dT%H:%M:00Z','now','-${days} days')), expanded AS (SELECT json_extract(d.value,'$.group_name') AS group_name,json_extract(d.value,'$.label') AS label,json_extract(d.value,'$.event') AS event FROM recent,json_each(json_array(${entries.join(',')})) AS d WHERE d.value IS NOT NULL) SELECT group_name,label,event,count(*) AS total FROM expanded GROUP BY group_name,label,event HAVING group_name='daily' OR count(*) >= 5 ORDER BY group_name,label,event;`;
}
export function main(args) {
  const { days, local } = parseOptions(args);
  const result = spawnSync('npx', ['--yes', 'wrangler@4', 'd1', 'execute', 'md2pdf-analytics', local ? '--local' : '--remote', '--json', '--command', reportSQL(days)], { cwd: directory, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 120000 });
  if (result.error || result.status !== 0) throw new Error('query-failed');
  return shapeReport(parseResults(result.stdout), days);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(main(process.argv.slice(2)), null, 2) + '\n'); }
  catch (error) { process.stderr.write(error.message === 'usage' ? 'Usage: report.mjs [--days 1|7|30|90] [--local]\n' : 'Analytics report failed. Check Cloudflare authentication, database configuration and Wrangler availability.\n'); process.exitCode = 1; }
}
