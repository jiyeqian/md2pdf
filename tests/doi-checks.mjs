import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDoi, createDoiResolver } from '../src/doi.mjs';

const DOI = '10.1000/xyz123';
const ENC = encodeURIComponent(DOI);

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json' },
});
const notFound = () => new Response('', { status: 404 });

function recorder(handler) {
  const calls = [];
  const fn = (url, options) => { calls.push({ url, options }); return handler(url, options); };
  fn.calls = calls;
  return fn;
}

const crossrefMsg = (over = {}) => ({
  message: {
    type: 'journal-article',
    title: ['A Study of Things'],
    author: [{ given: 'Jane', family: 'Doe' }, { given: 'John', family: 'Roe' }],
    'container-title': ['Journal of Testing'],
    publisher: 'Test Press',
    'publisher-location': 'Berlin',
    volume: '12',
    issue: '3',
    page: '45-67',
    DOI,
    URL: 'https://doi.org/' + DOI,
    issued: { 'date-parts': [[2020, 5, 1]] },
    ...over,
  },
});

const dataciteMsg = (over = {}) => ({
  data: {
    attributes: {
      types: { resourceTypeGeneral: 'JournalArticle' },
      titles: [{ title: 'DataCite Study' }],
      creators: [
        { name: 'Doe, Jane', nameType: 'Personal' },
        { name: 'Research Group', nameType: 'Organizational' },
      ],
      publisher: 'DataCite Press',
      publicationYear: 2019,
      container: { title: 'Journal of Data', volume: '4', issue: '2', firstPage: '10', lastPage: '20' },
      doi: DOI,
      url: 'https://doi.org/' + DOI,
      ...over,
    },
  },
});

// ------------------------------------------------------------- normalizeDoi

test('normalizeDoi accepts plain, prefixed and link forms, preserving the DOI', () => {
  assert.equal(normalizeDoi(DOI), DOI);
  assert.equal(normalizeDoi('  ' + DOI + '  '), DOI);
  assert.equal(normalizeDoi('doi:' + DOI), DOI);
  assert.equal(normalizeDoi('DOI: ' + DOI), DOI);
  assert.equal(normalizeDoi('https://doi.org/' + DOI), DOI);
  assert.equal(normalizeDoi('http://dx.doi.org/' + DOI), DOI);
  assert.equal(normalizeDoi('https://DOI.ORG/' + DOI), DOI);
  // 大小写保留，不擅自裁剪合法尾随字符
  assert.equal(normalizeDoi('10.1000/AbC'), '10.1000/AbC');
  assert.equal(normalizeDoi('10.1000/abc.'), '10.1000/abc.');
  // doi 链接里的编码斜杠允许安全解码一次
  assert.equal(normalizeDoi('https://doi.org/10.1000%2Fxyz'), '10.1000/xyz');
});

test('normalizeDoi rejects invalid, oversized, hostile and credential-bearing input with status 400', () => {
  const bad = [
    null, undefined, 42, {}, [],
    '', '   ',
    'not a doi', '10.1/x', '10.1234', 'foo/bar',
    'x'.repeat(513),
    '10.1000/' + 'a'.repeat(600),
    '10.1000/xy z',
    '10.1000/xy\tz',
    '10.1000/xy\u0001z',
    '10.1000/x y',
    'https://evil.com/' + DOI,
    'https://doi.org.evil.com/' + DOI,
    'https://user:pass@doi.org/' + DOI,
    'https://doi.org/' + DOI + '?q=1',
    'https://doi.org/' + DOI + '#frag',
    'ftp://doi.org/' + DOI,
  ];
  for (const v of bad) {
    assert.throws(() => normalizeDoi(v), err => err instanceof Error && err.status === 400, JSON.stringify(v));
  }
  // 报错信息应可读（中文）
  try { normalizeDoi('not a doi'); assert.fail('should throw'); }
  catch (e) { assert.equal(e.status, 400); assert.match(e.message, /DOI/); }
});

// ------------------------------------------------------------- resolve: types

test('resolve maps a Crossref journal-article to @article with fields', async () => {
  const fetchImpl = recorder(() => json(crossrefMsg()));
  const resolver = createDoiResolver({ fetchImpl });
  const r = await resolver.resolve(DOI);
  assert.equal(r.source, 'crossref');
  assert.equal(r.doi, DOI);
  assert.deepEqual(r.warnings, []);
  assert.match(r.bibtex, /^@article\{/);
  assert.match(r.bibtex, /title = \{A Study of Things\}/);
  assert.match(r.bibtex, /author = \{Doe, Jane and Roe, John\}/);
  assert.match(r.bibtex, /year = \{2020\}/);
  assert.match(r.bibtex, /journal = \{Journal of Testing\}/);
  assert.match(r.bibtex, /publisher = \{Test Press\}/);
  assert.match(r.bibtex, /volume = \{12\}/);
  assert.match(r.bibtex, /number = \{3\}/);
  assert.match(r.bibtex, /pages = \{45--67\}/);
  assert.match(r.bibtex, new RegExp('doi = \\{' + DOI + '\\}'));
  assert.match(r.bibtex, /url = \{https:\/\/doi\.org\/10\.1000\/xyz123\}/);
  // 请求只打到固定 HTTPS 主机、路径整体编码、redirect=error、无凭证
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, 'https://api.crossref.org/works/' + ENC);
  assert.equal(fetchImpl.calls[0].options.redirect, 'error');
  const h = fetchImpl.calls[0].options.headers || {};
  assert.equal(h.authorization, undefined);
  assert.equal(h.Authorization, undefined);
});

test('resolve maps proceedings-article to @inproceedings and book to @book', async () => {
  const proc = recorder(() => json(crossrefMsg({ type: 'proceedings-article', 'container-title': ['Proc. of Conf.'] })));
  const r1 = await createDoiResolver({ fetchImpl: proc }).resolve(DOI);
  assert.match(r1.bibtex, /^@inproceedings\{/);
  assert.match(r1.bibtex, /booktitle = \{Proc\. of Conf\.\}/);

  const book = recorder(() => json(crossrefMsg({ type: 'book', title: ['Big Book'], 'container-title': undefined })));
  const r2 = await createDoiResolver({ fetchImpl: book }).resolve(DOI);
  assert.match(r2.bibtex, /^@book\{/);
  assert.match(r2.bibtex, /title = \{Big Book\}/);
  assert.match(r2.bibtex, /publisher = \{Test Press\}/);
});

test('resolve rejects unsupported types (incl. datasets) with 422 and explanation', async () => {
  const ds = recorder(() => json(crossrefMsg({ type: 'dataset' })));
  await assert.rejects(createDoiResolver({ fetchImpl: ds }).resolve(DOI), err => err.status === 422 && /不支持/.test(err.message));

  const dcDs = recorder(url => (url.includes('crossref') ? notFound() : json(dataciteMsg({ types: { resourceTypeGeneral: 'Dataset' } }))));
  await assert.rejects(createDoiResolver({ fetchImpl: dcDs }).resolve(DOI), err => err.status === 422);
});

// ------------------------------------------------------------- provider fallback

test('Crossref 404 falls back to DataCite on a fixed encoded URL', async () => {
  const fetchImpl = recorder(url => (url.includes('crossref') ? notFound() : json(dataciteMsg())));
  const r = await createDoiResolver({ fetchImpl }).resolve(DOI);
  assert.equal(r.source, 'datacite');
  assert.match(r.bibtex, /^@article\{/);
  assert.match(r.bibtex, /author = \{Doe, Jane and \{Research Group\}\}/);
  assert.match(r.bibtex, /journal = \{Journal of Data\}/);
  assert.match(r.bibtex, /year = \{2019\}/);
  assert.match(r.bibtex, /pages = \{10--20\}/);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[0].url, 'https://api.crossref.org/works/' + ENC);
  assert.equal(fetchImpl.calls[1].url, 'https://api.datacite.org/dois/' + ENC);
});

test('both providers 404 -> status 404 (missing)', async () => {
  const fetchImpl = recorder(() => notFound());
  await assert.rejects(createDoiResolver({ fetchImpl }).resolve(DOI), err => err.status === 404);
});

test('a Crossref 5xx fails with 502 and does not fall back to DataCite', async () => {
  let dataciteHit = 0;
  const fetchImpl = recorder(url => {
    if (url.includes('datacite')) { dataciteHit++; return json({}); }
    return new Response('boom', { status: 503 });
  });
  await assert.rejects(createDoiResolver({ fetchImpl }).resolve(DOI), err => err.status === 502);
  assert.equal(dataciteHit, 0);
});

// ------------------------------------------------------------- integrity & warnings

test('escapes BibTeX hazards and preserves braces and TeX math', async () => {
  const title = 'Fast & 100% {DNA} in \$x_1\$ and a_b';
  const fetchImpl = recorder(() => json(crossrefMsg({ title: [title] })));
  const r = await createDoiResolver({ fetchImpl }).resolve(DOI);
  assert.match(r.bibtex, /Fast \\& 100\\% \{DNA\} in \$x_1\$ and a\\_b/);
  // 花括号成对，无原始裸 & 破坏结构
  assert.equal((r.bibtex.match(/\{/g) || []).length, (r.bibtex.match(/\}/g) || []).length);
});

test('strips HTML markup from titles without injecting HTML', async () => {
  const fetchImpl = recorder(() => json(crossrefMsg({ title: ['<b>Bold</b> & <script>x</script>Title'] })));
  const r = await createDoiResolver({ fetchImpl }).resolve(DOI);
  assert.doesNotMatch(r.bibtex, /<b>|<script>/);
  assert.match(r.bibtex, /title = \{Bold \\& Title\}/);
  assert.ok(r.warnings.some(w => /标记/.test(w)));
});

test('incomplete metadata yields Chinese warnings and never invents fields', async () => {
  const fetchImpl = recorder(() => json(crossrefMsg({ author: [], volume: undefined, page: undefined })));
  const r = await createDoiResolver({ fetchImpl }).resolve(DOI);
  assert.ok(r.warnings.some(w => /作者/.test(w)));
  assert.ok(r.warnings.some(w => /卷号/.test(w)));
  assert.ok(r.warnings.some(w => /页码/.test(w)));
  assert.doesNotMatch(r.bibtex, /author = /);
  assert.doesNotMatch(r.bibtex, /volume = /);
  assert.doesNotMatch(r.bibtex, /pages = /);
  // doi/url 永不省略
  assert.match(r.bibtex, /doi = \{/);
  assert.match(r.bibtex, /url = \{/);
  assert.ok(r.warnings.every(w => typeof w === 'string' && w.length > 0));
});

test('missing publication year cannot be inferred from DOI digits or registration date', async () => {
  const fetchImpl = recorder(() => json({ message: {
    type: 'journal-article', title: ['No Date'], 'container-title': ['J'],
    DOI: '10.1000/2021abc', created: { 'date-parts': [[2022]] },
  } }));
  await assert.rejects(createDoiResolver({ fetchImpl }).resolve('10.1000/2021abc'), err => err.status === 422);
});

test('structured dates are preferred over the DOI', async () => {
  const fetchImpl = recorder(() => json(crossrefMsg({ DOI: '10.1000/1999zzz', issued: { 'date-parts': [[2001, 1, 1]] } })));
  const r = await createDoiResolver({ fetchImpl }).resolve('10.1000/1999zzz');
  assert.match(r.bibtex, /year = \{2001\}/);
  assert.deepEqual(r.warnings, []);
});

// ------------------------------------------------------------- required fields

test('missing title or year is rejected with 422', async () => {
  const noTitle = recorder(() => json(crossrefMsg({ title: [] })));
  await assert.rejects(createDoiResolver({ fetchImpl: noTitle }).resolve(DOI), err => err.status === 422);

  const noYear = recorder(() => json({ message: {
    type: 'journal-article', title: ['T'], DOI: '10.9999/no-year',
  } }));
  await assert.rejects(createDoiResolver({ fetchImpl: noYear }).resolve('10.9999/no-year'), err => err.status === 422);
});

test('malformed provider payloads are rejected (structure 502, invalid JSON 502)', async () => {
  const noMessage = recorder(() => json({}));
  await assert.rejects(createDoiResolver({ fetchImpl: noMessage }).resolve(DOI), err => err.status === 502);

  const badJson = recorder(() => new Response('{not json', { status: 200 }));
  await assert.rejects(createDoiResolver({ fetchImpl: badJson }).resolve(DOI), err => err.status === 502);

  const badData = recorder(url => (url.includes('crossref') ? notFound() : json({ data: {} })));
  await assert.rejects(createDoiResolver({ fetchImpl: badData }).resolve(DOI), err => err.status === 502);
});

// ------------------------------------------------------------- transport guards

test('redirects are refused (redirect:error) and surfaced as 502', async () => {
  const fetchImpl = recorder((url, options) => {
    assert.equal(options.redirect, 'error');
    return new Response('', { status: 302, headers: { location: 'https://evil.example/' } });
  });
  await assert.rejects(createDoiResolver({ fetchImpl }).resolve(DOI), err => err.status === 502);
  assert.equal(fetchImpl.calls.length, 1);
});

test('a hanging request hits the shared deadline -> 504', async () => {
  let signalSeen = false;
  const fetchImpl = recorder((url, options) => {
    signalSeen = Boolean(options.signal);
    return new Promise(() => {});
  });
  await assert.rejects(
    createDoiResolver({ fetchImpl, timeoutMs: 40 }).resolve(DOI),
    err => err.status === 504,
  );
  assert.equal(signalSeen, true);
});

test('a stalled response body also hits the deadline -> 504', async () => {
  const fetchImpl = recorder(() => new Response(
    new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"message":')); } }),
    { status: 200 },
  ));
  await assert.rejects(
    createDoiResolver({ fetchImpl, timeoutMs: 40 }).resolve(DOI),
    err => err.status === 504,
  );
});

test('response bodies over 512KB are capped -> 502', async () => {
  const big = new Uint8Array(600 * 1024).fill(65);
  const fetchImpl = recorder(() => new Response(
    new ReadableStream({ start(c) { c.enqueue(big); c.close(); } }),
    { status: 200 },
  ));
  await assert.rejects(createDoiResolver({ fetchImpl }).resolve(DOI), err => err.status === 502);
});

// ------------------------------------------------------------- caching / dedupe

test('successful resolves are cached (one upstream call for repeated DOIs)', async () => {
  const fetchImpl = recorder(() => json(crossrefMsg()));
  const resolver = createDoiResolver({ fetchImpl });
  await resolver.resolve(DOI);
  await resolver.resolve('doi:' + DOI);
  await resolver.resolve('https://doi.org/' + DOI);
  assert.equal(fetchImpl.calls.length, 1);
});

test('concurrent requests for the same DOI are collapsed in flight', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const fetchImpl = recorder(async () => { await gate; return json(crossrefMsg()); });
  const resolver = createDoiResolver({ fetchImpl });
  const p1 = resolver.resolve(DOI);
  const p2 = resolver.resolve(DOI);
  release();
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(a.bibtex, b.bibtex);
  assert.equal(fetchImpl.calls.length, 1);
});

test('failures are not cached', async () => {
  let n = 0;
  const fetchImpl = recorder(() => { n++; return n === 1 ? new Response('x', { status: 500 }) : json(crossrefMsg()); });
  const resolver = createDoiResolver({ fetchImpl });
  await assert.rejects(resolver.resolve(DOI), err => err.status === 502);
  const r = await resolver.resolve(DOI);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(r.source, 'crossref');
});

test('invalid input rejects without any network call', async () => {
  const fetchImpl = recorder(() => { throw new Error('should not be called'); });
  await assert.rejects(createDoiResolver({ fetchImpl }).resolve('https://evil.com/10.1/x'), err => err.status === 400);
  assert.equal(fetchImpl.calls.length, 0);
});


test('provider DOI mismatch is rejected instead of inserting the wrong reference', async () => {
  const fetchImpl = recorder(() => json(crossrefMsg({ DOI: '10.1000/other' })));
  await assert.rejects(createDoiResolver({fetchImpl}).resolve(DOI), e => e.status === 502);
});

test('unbalanced metadata braces cannot produce a corrupt BibTeX entry', async () => {
  const fetchImpl = recorder(() => json(crossrefMsg({ title: ['Broken } title'] })));
  await assert.rejects(createDoiResolver({fetchImpl}).resolve(DOI), e => e.status === 422);
});
test('DataCite specific supported resource type takes precedence over general Text', async () => {
 const fetchImpl = recorder(url => url.includes('crossref') ? notFound() : json(dataciteMsg({types:{resourceTypeGeneral:'Text', resourceType:'JournalArticle'}})));
 const result = await createDoiResolver({fetchImpl}).resolve(DOI);
 assert.match(result.bibtex, /^@article/);
});
