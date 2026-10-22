import assert from 'node:assert/strict';
import test from 'node:test';
import { render } from '../src/render.mjs';

test('render exits at an awaited module-load checkpoint after the request becomes stale', async () => {
  const controller=new AbortController();
  const work=render('# A short document',{}, {webSafe:true,signal:controller.signal});
  controller.abort();
  await assert.rejects(work,error=>error.name==='AbortError');
});
