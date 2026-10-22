import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROUTES = new Set(['page', 'render', 'pdf', 'resolve', 'other']);
const DURATIONS = new Set(['lt1s', '1to3s', '3to10s', '10to30s', 'gte30s']);
const STATUSES = new Set(['2xx', '3xx', '4xx', '5xx']);

// Only counters are retained: no request records, addresses, headers, or identifiers.
export function createOperationalMetrics({ enabled = false, file = '', now = Date.now } = {}) {
  const counts = new Map();
  let dirty = false, warned = false;
  const cutoff = () => new Date(now() - 89 * 86400000).toISOString().slice(0, 10);
  function prune() {
    const first = cutoff(), last = new Date(now()).toISOString().slice(0, 10);
    for (const key of counts.keys()) if (key.slice(0, 10) < first || key.slice(0, 10) > last) { counts.delete(key); dirty = true; }
  }
  if (enabled && file) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8'));
      for (const row of Array.isArray(stored.counts) ? stored.counts : []) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(row.day) && ROUTES.has(row.route) && STATUSES.has(row.status) && DURATIONS.has(row.duration)
          && Number.isSafeInteger(row.count) && row.count > 0) counts.set([row.day, row.route, row.status, row.duration].join('|'), row.count);
      }
      prune();
    } catch { /* Missing or invalid snapshots never affect document requests. */ }
  }
  function snapshot() {
    prune();
    return { schema: 1, metric: 'requests, not people or page views', counts: [...counts].sort().map(([key, count]) => {
      const [day, route, status, duration] = key.split('|'); return { day, route, status, duration, count };
    }) };
  }
  function flush() {
    if (!enabled || !file) return;
    prune();
    if (!dirty) return;
    try {
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file + '.tmp', JSON.stringify(snapshot()) + '\n', { mode: 0o600 });
      renameSync(file + '.tmp', file); dirty = false;
    } catch {
      if (!warned) { console.warn('运营计数保存失败；文档功能不受影响。'); warned = true; }
    }
  }
  const timer = enabled && file ? setInterval(flush, 30000) : null;
  timer?.unref();
  return {
    record(method, target, statusCode, elapsed) {
      if (!enabled) return;
      let route;
      // Deliberately classify a fixed set of paths, never keep a URL or query string.
      const pathname = String(target || '').split('?')[0];
      if (method === 'GET' && (pathname === '/' || pathname === '/index.html' || /^\/examples\/[^/]+$/.test(pathname))) route = 'page';
      else if (method === 'POST' && ['/api/render', '/api/pdf', '/api/resolve'].includes(pathname)) route = pathname.slice(5);
      else route = 'other';
      const status = `${Math.floor(statusCode / 100)}xx`;
      if (!STATUSES.has(status)) return;
      const duration = elapsed < 1000 ? 'lt1s' : elapsed < 3000 ? '1to3s' : elapsed < 10000 ? '3to10s' : elapsed < 30000 ? '10to30s' : 'gte30s';
      prune();
      const key = [new Date(now()).toISOString().slice(0, 10), route, status, duration].join('|');
      counts.set(key, Math.min(Number.MAX_SAFE_INTEGER, (counts.get(key) || 0) + 1)); dirty = true;
    },
    snapshot, flush,
    close() { if (timer) clearInterval(timer); flush(); },
  };
}
