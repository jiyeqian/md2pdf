import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/server.mjs';

test('LAN is opt-in and keeps exact Host and Origin checks', async () => {
  const app = createApp({ lanHost: '192.168.1.9' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  const request = (host, origin, path = '/') => new Promise((resolve, reject) => {
    http.get({ hostname:'127.0.0.1', port, path, headers:{ Host:host, ...(origin ? { Origin:origin } : {}) } }, response => {
      let data = '';
      response.on('data', part => { data += part; });
      response.on('end', () => resolve({ status:response.statusCode, data }));
    }).on('error', reject);
  });
  try {
    assert.equal((await request(`192.168.1.9:${port}`, `http://192.168.1.9:${port}`)).status, 200);
    assert.equal((await request(`127.0.0.1:${port}`, `http://127.0.0.1:${port}`)).status, 200);
    assert.equal((await request(`192.168.1.10:${port}`)).status, 403);
    assert.equal((await request(`192.168.1.9:${port}`, 'https://evil.example')).status, 403);
    assert.equal((await request(`192.168.1.9:${port}`, `http://192.168.1.9:${port+1}`)).status, 403);
  } finally { await app.close(); }
  for (const lanHost of ['0.0.0.0','8.8.8.8','192.168.1.999','192.168.1.9:3116']) {
    assert.throws(() => createApp({ lanHost }), /私有 IPv4/);
  }
  assert.throws(() => createApp({ lanHost:'192.168.1.9', publicHost:'example.com' }), /同时启用/);
});

test('manifest and real PNG app icons are served without adding a caching worker', async () => {
  const app = createApp({ lanHost:'' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const response = await fetch(base+'/manifest.webmanifest');
    assert.match(response.headers.get('content-type'), /application\/manifest\+json/);
    const manifest = await response.json();
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.id, '/');
    for (const size of [180,192,512]) {
      const response = await fetch(base+`/icons/app-${size}.png`);
      assert.equal(response.headers.get('content-type'), 'image/png');
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.subarray(1,4).toString(), 'PNG');
      assert.equal(bytes.readUInt32BE(16),size);
      assert.equal(bytes.readUInt32BE(20),size);
    }
    const page = await (await fetch(base)).text();
    assert.match(page, /apple-touch-icon/);
    assert.match(page, /apple-mobile-web-app-capable/);
    assert.equal((await fetch(base+'/service-worker.js')).status,404);
  } finally { await app.close(); }
});
