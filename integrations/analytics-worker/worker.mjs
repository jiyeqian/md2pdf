import { validateEvent, validateVisitorId } from '../../web/analytics-schema.mjs';
function validOrigin(origin) {
  try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && url.origin === origin && !url.username && !url.password; } catch { return false; }
}
function response(status, origin, body = null) {
  const headers = { Vary: 'Origin', 'Cache-Control': 'no-store' };
  if (validOrigin(origin)) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
  if (body) headers['Content-Type'] = 'application/json';
  return new Response(body ? JSON.stringify(body) : null, { status, headers });
}
async function readBounded(request) {
  if (Number(request.headers.get('content-length')) > 2048) throw new Error('size');
  if (!request.body) throw new Error('json');
  const reader = request.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); throw new Error('size'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') return response(200, null, { ok: true });
    if (!['/events', '/forget'].includes(path)) return response(404);
    const origin = request.headers.get('origin');
    if (!validOrigin(origin)) return response(403);
    const site = request.headers.get('sec-fetch-site');
    if (site && !['cross-site', 'same-site', 'same-origin'].includes(site)) return response(403, origin);
    if (request.method === 'OPTIONS') {
      if (request.headers.get('access-control-request-method') !== 'POST' || (request.headers.get('access-control-request-headers') || '').split(',').some((header) => header.trim() && header.trim().toLowerCase() !== 'content-type')) return response(403, origin);
      return response(204, origin);
    }
    if (request.method !== 'POST') return response(405, origin);
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')) return response(415, origin);
    if (!env.EVENT_LIMITER || !env.DB) return response(503, origin);
    try {
      // IP is an ephemeral rate-limit key, never stored in D1 or application logs.
      const { success } = await env.EVENT_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' });
      if (!success) return response(429, origin);
      let input;
      try { input = await readBounded(request); } catch (error) { return response(error.message === 'size' ? 413 : 400, origin); }
      if (path === '/forget') {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).join(',') !== 'visitorId' || !validateVisitorId(input.visitorId)) return response(400, origin);
        // Withdrawal removes linkable live rows; budgets intentionally remain to prevent reset abuse.
        await env.DB.prepare('DELETE FROM events WHERE visitor_id = ?').bind(validateVisitorId(input.visitorId)).run();
        return response(204, origin);
      }
      const value = validateEvent(input);
      if (!value) return response(400, origin);
      const minute = new Date().toISOString().slice(0, 16) + ':00Z';
      const country = value.event === 'page_view' && typeof request.cf?.country === 'string' && /^[A-Z]{2}$/.test(request.cf.country) ? request.cf.country : 'XX';
      // Atomic daily cap bounds storage even when callers rotate IP addresses.
      const result = await env.DB.prepare('INSERT INTO events (minute, event, version, deployment, properties, country, site, visitor_id) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE coalesce((SELECT total FROM daily_counts WHERE day = ?), 0) < 10000').bind(minute, value.event, value.version, value.deployment, JSON.stringify(value.properties), country, value.site || 'legacy', value.visitorId || null, minute.slice(0, 10)).run();
      if (result.meta?.changes === 0) return response(429, origin);
      return response(204, origin);
    } catch { return response(503, origin); }
  },
  async scheduled(_controller, env) {
    await env.DB.prepare("DELETE FROM events WHERE minute < strftime('%Y-%m-%dT%H:%M:00Z', 'now', '-90 days')").run();
    await env.DB.prepare("DELETE FROM daily_counts WHERE day < date('now', '-90 days')").run();
  },
};
