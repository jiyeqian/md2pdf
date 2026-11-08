import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

for (const newline of ['LF', 'CRLF']) {
  test(`static build transforms ${newline} source files`, async () => {
    const copy = await mkdtemp(path.join(tmpdir(), 'md2pdf-newlines-'));
    try {
      for (const entry of ['src', 'web', 'assets', 'vendor', 'package.json']) {
        await cp(path.join(root, entry), path.join(copy, entry), { recursive: true });
      }
      for (const file of ['render.mjs', 'options.mjs']) {
        const target = path.join(copy, 'src', file);
        const text = (await readFile(target, 'utf8')).replace(/\r\n/g, '\n');
        await writeFile(target, newline === 'CRLF' ? text.replace(/\n/g, '\r\n') : text);
      }
      const { buildStatic } = await import(pathToFileURL(path.join(copy, 'src/static-build.mjs')).href);
      const build = await buildStatic();
      for (const file of ['render.mjs', 'options.mjs']) {
        const output = await readFile(path.join(build.directory, 'src', file), 'utf8');
        assert.doesNotMatch(output, /from ['"]node:|createRequire\(/);
      }
      const render = await readFile(path.join(build.directory, 'src/render.mjs'), 'utf8');
      assert.doesNotMatch(render, /const \{ Marked \} = await import|const hljs = require/);
      assert.match(render, /import \{ Marked \} from '\.\.\/vendor\/marked\.esm\.js'/);
    } finally {
      await rm(copy, { recursive: true, force: true });
    }
  });
}
