// The same window workflow, served from a nested deployment path without APIs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildStatic } from '../src/static-build.mjs';
const build = await buildStatic(), prefix = '/nested/md2pdf/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const outside = [];
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (!path.startsWith(prefix)) {
    if (path !== '/favicon.ico') outside.push(path);
    response.writeHead(404); response.end(); return;
  }
  let file;
  try { file = resolve(build.directory, decodeURIComponent(path.slice(prefix.length)) || 'index.html'); }
  catch { response.writeHead(400); response.end(); return; }
  if (!file.startsWith(build.directory + sep)) { response.writeHead(403); response.end(); return; }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const result = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./independent-window-browser-checks.mjs', import.meta.url)), 'http://127.0.0.1:' + server.address().port + prefix], { stdio: 'inherit' });
    child.once('error', reject); child.once('exit', accept);
  });
  assert.equal(result, 0, 'static nested-path browser workflow');
  assert.deepEqual(outside, [], 'popup resources and data remain under the deployment prefix');
  console.log('PASS: nested static deployment uses the same window/state implementation');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
