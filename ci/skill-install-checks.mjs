import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(path.join(root, 'skill/SKILL.md'), 'utf8');
const targets = { codex: '.codex', workbuddy: '.workbuddy', codebuddy: '.codebuddy', claude: '.claude', agents: '.agents' };
function fixture(t) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'md2pdf-skill-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'src/md2pdf.mjs'), 'skill', ...args], {
    encoding: 'utf8', env: { ...process.env, HOME: home },
  });
  return { home, run };
}

for (const [target, folder] of Object.entries(targets)) {
  test(`install and repeat: ${target}`, t => {
    const { home, run } = fixture(t);
    const file = path.join(home, folder, 'skills/md-to-pdf/SKILL.md');
    const first = run('install', '--target', target);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(readFileSync(file, 'utf8'), source);
    assert.ok(first.stdout.includes(file));
    const second = run('install', '--target', target);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /已是最新/);
  });
}

test('custom directory preserves edits unless forced', t => {
  const { home, run } = fixture(t);
  const dir = path.join(home, 'custom skill');
  assert.equal(run('install', '--dir', dir).status, 0);
  const file = path.join(dir, 'SKILL.md');
  writeFileSync(file, 'custom content');
  const blocked = run('install', '--dir', dir);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /--force/);
  assert.equal(readFileSync(file, 'utf8'), 'custom content');
  const forced = run('install', '--dir', dir, '--force');
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(readFileSync(file, 'utf8'), source);
});

test('invalid arguments fail', t => {
  const { run } = fixture(t);
  for (const args of [ ['install'], ['remove'], ['install', '--target', 'unknown'],
    ['install', '--target'], ['install', '--dir', '--force'],
    ['install', '--target', 'codex', '--dir', 'other'],
    ['install', '--target', 'codex', '--target', 'claude'],
    ['install', '--wat'] ]) {
    assert.notEqual(run(...args).status, 0, JSON.stringify(args));
  }
  assert.equal(run('--help').status, 0);
  assert.equal(run('install', '--help').status, 0);
});

test('filesystem failures return nonzero and do not follow file symlinks', t => {
  const { home, run } = fixture(t);
  const dir = path.join(home, 'blocked');
  writeFileSync(dir, 'not a directory');
  assert.notEqual(run('install', '--dir', dir).status, 0);
  const linkDir = path.join(home, 'link');
  mkdirSync(linkDir);
  symlinkSync(dir, path.join(linkDir, 'SKILL.md'));
  assert.notEqual(run('install', '--dir', linkDir, '--force').status, 0);
  assert.equal(readFileSync(dir, 'utf8'), 'not a directory');
});

test('package has no automatic install hook', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.postinstall, undefined);
  assert.ok(pkg.files.includes('skill'));
});
