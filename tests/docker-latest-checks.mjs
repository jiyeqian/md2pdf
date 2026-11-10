import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/docker-latest.sh', import.meta.url));
test('highest stable remote tag alone may update latest', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'md2pdf-tags-'));
  try {
    execFileSync('git', ['init', '--bare', directory], { stdio: 'ignore' });
    const object = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    for (const tag of ['v1.9.9', 'v1.10.0', 'v1.11.0-rc.1']) {
      execFileSync('git', ['--git-dir', directory, 'fetch', '--no-tags', process.cwd(), `${object}:refs/tags/${tag}`], { stdio: 'ignore' });
    }
    for (const [tag, status] of [['v1.10.0', 0], ['v1.9.9', 1], ['v1.11.0-rc.1', 1]]) {
      assert.equal(spawnSync('sh', [script, tag, directory]).status, status, tag);
    }
    assert.equal(spawnSync('sh', [script, 'v1.10.0', path.join(directory, 'missing')], { stdio: 'ignore' }).status, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
