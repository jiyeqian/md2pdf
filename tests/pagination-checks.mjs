import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/options.mjs';
import { parseFrontmatter, resolveDocumentOptions, frontmatterValueCatalog } from '../src/config.mjs';
import { render } from '../src/render.mjs';
import { resolveWebInput } from '../src/web-input.mjs';
import { FRONTMATTER_FIELDS } from '../src/frontmatter-fields.mjs';

test('chapter pagination shares validated CLI/frontmatter values and explicit precedence', () => {
 const fm=parseFrontmatter('---\nchapter-start: odd-page\n---\n# Title').fm;
 assert.equal(resolveDocumentOptions({},fm).chapterStart,'odd-page');
 for(const mode of ['continuous','page','odd-page']){
  const cli=parseArgs(['--chapter-start',mode]);
  assert.equal(resolveDocumentOptions(cli,fm).chapterStart,mode);
  assert.equal(resolveWebInput({md:'---\nchapter-start: '+mode+'\n---\n# Title',opts:{}}).effective.chapterStart,mode);
 }
 assert.equal(resolveDocumentOptions({},{}).chapterStart,'continuous');
 assert.throws(()=>parseArgs(['--chapter-start','invalid']),/章分页策略/);
 assert.throws(()=>parseFrontmatter('---\nchapter-start: invalid\n---\n'),/章分页策略/);
 assert.throws(()=>resolveWebInput({md:'# Title',opts:{chapterStart:'invalid'}}),/chapterStart/);
 assert.ok(FRONTMATTER_FIELDS.includes('chapter-start'));
 assert.ok(!FRONTMATTER_FIELDS.includes('chapterStart'));
 assert.deepEqual(frontmatterValueCatalog().chapterStart,['continuous','page','odd-page']);
});

test('chapter rules mark only source h2, use a shared paginated export, and leave continuous as default',async()=>{
 const md='# Title\n\n## Alpha\n\nText\n\n### Child\n\nText\n\n## Beta\n\nText';
 const plain=await render(md);
 assert.equal(plain.printOptions.waitPaged,false);
 for(const mode of ['page','odd-page']){
  const result=await render(md,{chapterStart:mode});
  assert.equal(result.printOptions.waitPaged,true);
  assert.match(result.html,new RegExp('break-before: '+(mode==='page'?'page':'right')));
  assert.equal((result.html.match(/<h2 data-chapter/g)||[]).length,2);
  assert.doesNotMatch(result.html,/<h[13] data-chapter/);
 }
});

test('tables use the same repeat-header pagination runtime in PDF and preview',async()=>{
 const result=await render('# Title\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
 assert.equal(result.printOptions.waitPaged,true);
 assert.match(result.html,/installPagedLayout/);
 assert.match(result.html,/display: table-header-group/);
});
