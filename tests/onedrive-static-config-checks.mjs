import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
test('static build uses the empty template with or without a local config', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-static-config-'));
  try {
    for (const dir of ['src','assets','vendor','web']) await cp(dir, path.join(fixture, dir), { recursive:true, filter: source => !source.endsWith('/web/onedrive-config.json') });
    await cp('package.json', path.join(fixture,'package.json'));
    const local = path.join(fixture,'web/onedrive-config.json');
    const sentinel = JSON.stringify({clientId:'local-client-sentinel',redirectUri:'http://localhost:9999/private-callback'});
    await writeFile(local,sentinel);
    const packed = JSON.parse((await run('npm',['pack','--dry-run','--json'],{cwd:fixture})).stdout);
    const packageInfo = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
    const paths = packageInfo.files.map(file => file.path);
    assert.ok(paths.includes('web/onedrive-config.example.json'));
    assert.ok(!paths.includes('web/onedrive-config.json'));
    assert.match(await readFile('.dockerignore','utf8'), /^web\/onedrive-config\.json$/m);
    for (const withLocal of [true,false]) {
      if (!withLocal) await rm(local);
      await run(process.execPath,['--input-type=module','-e',"import('./src/static-build.mjs').then(m=>m.buildStatic())"],{cwd:fixture});
      const output=JSON.parse(await readFile(path.join(fixture,'dist/static/onedrive-config.json'),'utf8'));
      assert.deepEqual(output,{clientId:'',redirectUri:''});
      const worker=await readFile(path.join(fixture,'dist/static/service-worker.js'),'utf8');
      assert.doesNotMatch(worker,/local-client-sentinel|private-callback|onedrive-config\.json/);
      await assert.rejects(readFile(path.join(fixture,'dist/static/onedrive-config.example.json')),{code:'ENOENT'});
      await assert.rejects(readFile(path.join(fixture,'dist/static/.npmignore')),{code:'ENOENT'});
      assert.doesNotMatch(worker,/\.npmignore/);
      if (withLocal) assert.equal(await readFile(local,'utf8'),sentinel);
    }
  } finally { await rm(fixture,{recursive:true,force:true}); }
});
