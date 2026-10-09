import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseWebappArgs } from '../src/webapp.mjs';
const cli = new URL('../src/md2pdf.mjs', import.meta.url);

test('webapp defaults to 3000 and accepts explicit ports', () => {
  assert.deepEqual(parseWebappArgs([]), { port: 3000, help: false });
  assert.equal(parseWebappArgs(['--port', '3001']).port, 3001);
  assert.equal(parseWebappArgs(['--port=65535']).port, 65535);
});

test('invalid ports and unknown arguments fail before starting a service', () => {
  for (const args of [['--port'], ['--port', '0'], ['--port', '65536'], ['--port', '3.5'], ['--port', 'abc'], ['--host', '0.0.0.0']]) {
    assert.throws(() => parseWebappArgs(args));
  }
  const result = spawnSync(process.execPath, [cli.pathname, 'webapp', '--port', '0'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--port/);
});

test('installed command help documents the default address and port flag', () => {
  const result = spawnSync(process.execPath, [cli.pathname, 'webapp', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /127\.0\.0\.1:3000/);
  assert.match(result.stdout, /--port/);
});

test('npm ships the web assets and each topbar ends with the safe GitHub link', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.ok(pkg.files.includes('web'));
  for (const name of ['index.html', 'examples.html']) {
    const html = readFileSync(new URL('../web/' + name, import.meta.url), 'utf8');
    const nav = html.match(/<nav class="topbar-actions"[\s\S]*?<\/nav>/)[0];
    assert.match(nav, /href="https:\/\/github\.com\/jiyeqian\/md2pdf" target="_blank" rel="noopener noreferrer"[^>]*>GitHub<\/a>\s*<\/nav>/);
  }
});
