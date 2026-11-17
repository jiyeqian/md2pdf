import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { startStaticServer } from '../src/static-server.mjs';

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

test('local static startup serves public local config without altering the deployable build', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-local-static-config-'));
  let server;
  try {
    const empty = {clientId:'',redirectUri:''};
    const configFile = path.join(directory,'local-config.json');
    await writeFile(path.join(directory,'onedrive-config.json'),JSON.stringify(empty));
    await writeFile(configFile,JSON.stringify({clientId:'local-client',redirectUri:'http://localhost:3000/onedrive-callback.html',secret:'must-not-be-served'}));
    server = await startStaticServer({directory,port:0,onedriveConfigFile:configFile});
    const url = `http://localhost:${server.address().port}/onedrive-config.json`;
    const response = await fetch(url);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(await response.json(),{clientId:'local-client',redirectUri:'http://localhost:3000/onedrive-callback.html'});
    assert.deepEqual(JSON.parse(await readFile(path.join(directory,'onedrive-config.json'),'utf8')),empty);
    await rm(configFile);
    assert.deepEqual(await (await fetch(url)).json(),empty,'missing local config falls back to build config');
    await writeFile(configFile,'invalid json');
    assert.equal((await fetch(url)).status,500,'invalid config is not silently hidden');
  } finally { if(server) await new Promise(resolve=>server.close(resolve)); await rm(directory,{recursive:true,force:true}); }
});
