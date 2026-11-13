import test from 'node:test';
import assert from 'node:assert/strict';
import { createOneDriveGraph } from '../web/onedrive-graph.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
test('new file deferred commit fails on collision and preauthenticated uploads omit credentials', async () => {
  const calls = [];
  const graph = createOneDriveGraph({ token: async () => 'secret', fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/createUploadSession')) return json({ uploadUrl: 'https://upload.example/session' });
    if (url.startsWith('https://upload.example/')) return json({ nextExpectedRanges: [] }, 202);
    return json({ id: 'item', eTag: 'new' });
  } });
  await graph.save({ rootId: 'root', name: 'a.md', text: 'hello' });
  assert.equal(JSON.parse(calls[0].options.body).item['@microsoft.graph.conflictBehavior'], 'fail');
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.credentials, 'omit');
  assert.equal(calls[2].url, 'https://graph.microsoft.com/v1.0/me/drive/items/root');
  assert.equal(JSON.parse(calls[2].options.body)['@microsoft.graph.conflictBehavior'], 'fail');
  assert.equal(JSON.parse(calls[2].options.body)['@microsoft.graph.sourceUrl'], 'https://upload.example/session');
});
test('commit conflict and empty files preserve local input', async () => {
  let calls = 0;
  const graph = createOneDriveGraph({ token: async () => 'token', fetch: async url => {
    calls++;
    if (url.endsWith('/createUploadSession')) return json({ uploadUrl: 'https://upload.example/session' });
    if (url.startsWith('https://upload.example/')) return json({}, 202);
    return json({}, 412);
  } });
  await assert.rejects(graph.save({ rootId: 'root', name: 'a.md', text: 'data' }), error => error.status === 412);
  await assert.rejects(graph.save({ id: 'a', eTag: 'old', name: 'a.md', text: 'data' }), /不能安全覆盖/);
  await assert.rejects(graph.save({ id: 'a', eTag: 'old', name: 'a.md', text: '' }), /空文件/);
  assert.equal(calls, 4);
});
test('download URL receives no Graph token', async () => {
  const calls = [];
  const graph = createOneDriveGraph({ token: async () => 'secret', fetch: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? json({ id: 'x', name: 'x.md', eTag: 'tag', '@microsoft.graph.downloadUrl': 'https://download.example/x' }) : new Response('content');
  } });
  assert.equal((await graph.open('x')).text, 'content');
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(calls[1].options.credentials, 'omit');
});
