import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { render } from '../src/render.mjs';
import { parseArgs } from '../src/options.mjs';
import { resolveWebInput } from '../src/web-input.mjs';
const exec = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;

// Independent acceptance: tests use public CLI and renderer, not config internals.
test('explicit clearing and inherited frontmatter work through the public renderer', async () => {
  const md = '---\nfooter-center: "内部资料"\ndisable: [lead]\n---\n# 标题\n\n正文[^a]。\n\n## 参考资料 {role=bibliography}\n\n[^a]: 文献\n\n:::colophon\nleft: ""\n:::\n';
  const cli = await render(md, parseArgs(['doc.md']), { filename: 'doc.md' });
  const web = await render(md, {}, { filename: 'doc.md', webSafe: true });
  for (const res of [cli, web]) {
    assert.ok(!res.html.includes('文档落款'));
    assert.ok((res.html + (res.printOptions?.footerTemplate || '') + (res.pagedHtml || '')).includes('内部资料'));
    assert.ok(res.html.includes('参考资料'));
    assert.match(res.html, /class="lead">\s*<\/p>/);
    assert.match(res.html, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}/);
  }
});

test('invalid frontmatter cannot be masked by a higher explicit setting', async () => {
  await assert.rejects(render('---\nenable: [footer]\ndisable: [footer]\n---\n# 标题', { footer: true }), /footer/);
  await assert.rejects(render('---\ncolophon: null\n---\n# 标题', { colophon: '覆盖' }), /colophon/);
});

test('web resolution hands the exact parsed frontmatter to render without changing output or diagnostics', async () => {
  const md = '---\ntype: general\nauthors:\n  - name: 甲\n    affiliations: [used]\naffiliations:\n  - id: used\n    text: 单位甲\n  - id: unused\n    text: 未引用单位\nfont-size: 11\n---\n# 标题\n\n正文';
  const resolved = resolveWebInput({ md, opts: { fontSize: 12 }, filename: 'doc.md' });
  assert.equal(resolved.parsedFrontmatter.source, resolved.md);
  assert.equal(resolved.parsedFrontmatter.parsed.body, '# 标题\n\n正文');
  assert.equal(resolved.authorDiagnostics.length, 1);
  const reused = await render(resolved.md, resolved.opts, { filename: resolved.filename, webSafe: true, parsedFrontmatter: resolved.parsedFrontmatter });
  const independent = await render(resolved.md, resolved.opts, { filename: resolved.filename, webSafe: true });
  assert.equal(reused.type, independent.type);
  assert.deepEqual(reused.effective, independent.effective);
  assert.equal(reused.pagedHtml, independent.pagedHtml);
  assert.equal(reused.html, independent.html);
});

test('request-local parsed frontmatter is ignored for mismatched source and invalid options still reject', async () => {
  const resolved = resolveWebInput({ md: '---\ntype: gb\nstandard: GB/T 1—2020\n---\n# A', opts: {} });
  const mismatch = await render('---\nfont-size: 11\n---\n# B', {}, { parsedFrontmatter: resolved.parsedFrontmatter });
  assert.equal(mismatch.html.includes('>B<'), true);
  await assert.rejects(render(resolved.md, {fontSize: 12}, {parsedFrontmatter: resolved.parsedFrontmatter}), /fontSize/);
  assert.throws(() => resolveWebInput({ md: '---\nenable: [footer]\ndisable: [footer]\n---\n# X', opts: {footer:true} }), /footer/);
});

test('CLI rejects invalid configuration without creating an output; hidden aliases remain accepted', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'md2pdf-config-accept-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'input.md');
  const output = path.join(dir, 'output.html');
  await writeFile(input, '---\nenable: [footer]\ndisable: [footer]\n---\n# 标题');
  await assert.rejects(exec(process.execPath, ['src/md2pdf.mjs', input, '--html-only', '-o', output], { cwd: root }), error => {
    assert.ok(error.code !== 0);
    assert.match(error.stderr, /footer/);
    return true;
  });
  await assert.rejects(readFile(output), { code: 'ENOENT' });
  await writeFile(input, '# 标题\n\n正文');
  await exec(process.execPath, ['src/md2pdf.mjs', input, '--html-only', '--no-footer', '-o', output], { cwd: root });
  const html = await readFile(output, 'utf8');
  assert.ok(!html.includes('@bottom-center { content: counter(page)'));
});

test('CLI and Web share document-type restrictions and normalized margin precedence', async () => {
  const { effectiveOptions } = await import('../src/web-options.mjs');
  const md = '---\nstandard: "GB/T 1—2020"\nfont-size: 12\n---\n# 标题';
  await assert.rejects(render(md), error => error.status === 400 && error.configErrors[0].line === 3);
  assert.throws(() => effectiveOptions({fontSize:12}, 'gb'), {status:400});
  const fm = {'margin': '25,22'};
  const effective = effectiveOptions({marginSide:16}, 'general', fm);
  assert.equal(effective.marginTop, 25);
  assert.equal(effective.marginLeft, 16);
  assert.equal(effective.marginRight, 16);
});

test('custom and hidden center footer disable both PDF and preview counter rewriting', async () => {
  const { enhancePreview } = await import('../src/preview.mjs');
  for (const footerCenter of ['内部资料', '']) {
    const result = await render('# 标题\n\n正文', {footerCenter, pagedHtml:true});
    assert.match(result.pagedHtml, /name="md2pdf-page-count" content="off"/);
    assert.match(enhancePreview(result.pagedHtml, 'general'), /pageCountMode.content !== 'off'/);
  }
  const result = await render('# 标题\n\n正文', {pagedHtml:true});
  assert.match(result.pagedHtml, /name="md2pdf-page-count" content="auto"/);
});

test('CLI help only advertises current switch and bibliography interfaces', async () => {
  const { stdout } = await exec(process.execPath, ['src/md2pdf.mjs', '--help'], {cwd:root});
  assert.ok(!stdout.includes('--no-'));
  assert.ok(!stdout.includes('--bibliography ['));
  for (const option of ['--enable', '--disable', '--footer-{left,center,right}', 'md2pdf skill install --help']) assert.ok(stdout.includes(option));
});

test('CLI short version alias matches the full version option', async () => {
  const short = await exec(process.execPath, ['src/md2pdf.mjs', '-v'], {cwd:root});
  const full = await exec(process.execPath, ['src/md2pdf.mjs', '--version'], {cwd:root});
  assert.equal(short.stdout, full.stdout);
});
