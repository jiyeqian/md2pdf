import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { appCacheScript } from '../src/app-cache.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
test('Node response CSP and every cached asset match the actual response', async () => {
  const app = createApp(); await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const page = await fetch(base + '/'); const csp = page.headers.get('content-security-policy');
    for (const host of ['https://login.microsoftonline.com','https://graph.microsoft.com','https://*.files.1drv.com','https://*.up.1drv.com']) assert.ok(csp.includes(host),host);
    assert.match(csp, /frame-ancestors 'none'/); assert.doesNotMatch(csp, /connect-src[^;]*\shttps:\s/);
    assert.match((await fetch(base+'/onedrive-callback.html')).headers.get('content-security-policy'), /frame-ancestors 'self'/);
    const worker = await (await fetch(base+'/service-worker.js')).text();
    const entries = JSON.parse(worker.match(/const APP_FILES=(.*);/)[1]);
    for (const entry of entries) { const res=await fetch(base+entry.url); assert.equal(res.status,200,entry.url); assert.equal(hash(Buffer.from(await res.arrayBuffer())),entry.hash,entry.url); }
    const root=path.resolve('.'); const old=await appCacheScript(root,new Map(),[],'old'); const changed=await appCacheScript(root,new Map(),[],'new');
    assert.notEqual(old.match(/APP_VERSION="([^"]+)/)[1],changed.match(/APP_VERSION="([^"]+)/)[1]);
  } finally { await new Promise(resolve=>app.server.close(resolve)); }
});
