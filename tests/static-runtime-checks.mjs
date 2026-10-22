import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildStatic } from '../src/static-build.mjs';

const build = await buildStatic();
const nativeFetch = globalThis.fetch;
const assetFetches = new Map();
globalThis.fetch = async input => {
  const url = new URL(input);
  if (/\/vendor\/|\/assets\/gb-logo\.svg$/.test(url.pathname)) assetFetches.set(url.href,(assetFetches.get(url.href)||0)+1);
  return url.protocol === 'file:' ? new Response(await readFile(url)) : nativeFetch(input);
};
try {
  const runtime = await import(pathToFileURL(build.directory + '/runtime.mjs').href);
  const cases = [
    ['plain', { md:'# Plain\n\nText.', opts:{type:'general'} }, [503181]],
    ['math', { md:'Formula $x^2$.', opts:{type:'general'} }, [2108580, 503181]],
    ['mermaid', { md:'```mermaid\ngraph TD; A-->B\n```', opts:{type:'general'} }, [2571900, 503181]],
    ['toc', { md:'# Contents\n\n## Section\n\nText.', opts:{type:'general',toc:true} }, [503181]],
    ['gb', { md:'# Standard\n\nText.', opts:{type:'gb'} }, [503181]],
  ];
  for (const [name, body, expected] of cases) {
    const response = await runtime.appFetch('/api/render', { body:JSON.stringify(body) });
    assert.equal(response.status, 200, name);
    const { html } = await response.json();
    const actual = [...html.matchAll(/<script\b[^>]*src="data:text\/javascript;base64,([^"]+)"/g)]
      .map(match => Buffer.from(match[1], 'base64').length);
    assert.deepEqual(actual, expected, `${name}: only scripts referenced by renderer output should be embedded`);
    assert.match(html, /Content-Security-Policy[^>]+script-src 'unsafe-inline' data:/, `${name}: strict data-only script policy`);
  }
  const beforeMath=[...assetFetches];
  const mathAgain=await runtime.appFetch('/api/render',{body:JSON.stringify(cases[1][1])});
  assert.equal(mathAgain.status,200,'repeated MathJax render');
  assert.deepEqual([...assetFetches],beforeMath,'repeated engine combinations reuse URL-scoped data URL conversions');
  for(const [key,count]of assetFetches)assert.equal(count,1,`asset converted once per URL and version: ${key}`);
  const gb=cases[4][1];
  const gbAgain=await runtime.appFetch('/api/render',{body:JSON.stringify(gb)});
  assert.equal(gbAgain.status,200,'repeated GB render');
  assert.equal([...assetFetches].find(([key])=>key.endsWith('/assets/gb-logo.svg'))?.[1],1,'GB logo conversion is reused');
  const aborted=new AbortController();
  aborted.abort();
  const beforeAbort=[...assetFetches];
  await assert.rejects(runtime.appFetch('/api/render',{body:JSON.stringify(cases[0][1]),signal:aborted.signal}),error=>error.name==='AbortError');
  assert.deepEqual([...assetFetches],beforeAbort,'already-stale render does not fetch document assets');
  console.log('PASS: static preview embeds only the renderer-referenced MathJax, Mermaid, and PagedJS engines under the existing CSP.');
} finally { globalThis.fetch = nativeFetch; }
