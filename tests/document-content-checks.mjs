import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../src/render.mjs';
import {resolveWebType} from '../src/web-options.mjs';
import {parseFrontmatter} from '../src/config.mjs';
import {parseArgs} from '../src/options.mjs';
import {prepareDocumentContent} from '../src/document-content.mjs';
const summary='## 摘要 {role=abstract}\n\n研究 **问题**。\n\n第二段。\n\n## 关键词 {role=keywords}\n\n- 矢量图形\n- 版面校准\n';
test('explicit bibliography fills all templates only at its declared position',async()=>{
 for(const type of ['general','paper','skill','gb']){
  const r=await render('## 范围\n\n文字[^r]。\n\n## 资料 {role=bibliography}\n\n## 后记\n\n结束。\n\n[^r]: 引用内容',{type});
  const main=r.html.match(/<main>([\s\S]*?)<\/main>/)[1];
  assert.ok(main.indexOf('引用内容')<main.indexOf('后记'));
  assert.equal((main.match(/class="references"/g)||[]).length,1);
  const missing=await render('## 范围\n\n文字[^r]。\n\n[^r]: 引用内容',{type});
  assert.doesNotMatch(missing.html,/<ol class="references">/);
  assert.ok(missing.warnings.some(w=>w.includes('role=bibliography')));
 }
});
test('summaries and keyword lists work in every template without becoming numbered chapters',async()=>{
 for(const type of ['general','paper','skill','gb']){
  const r=await render(summary+'\n## 范围\n\n正文',{type});
  assert.match(r.html,/class="abstract"/);assert.match(r.html,/<strong>问题<\/strong>/);
  assert.match(r.html,/矢量图形；版面校准/);
  assert.match(r.html,/<h2 class="paper-label summary-heading">摘要<\/h2>/);
  assert.match(r.html,/<h2 class="paper-label summary-heading">关键词<\/h2>/);
  const toc=(r.html.match(/<div class="toc">([\s\S]*?)<\/ol>/)||[])[1]||'';
  assert.doesNotMatch(toc,/摘要|关键词/);
 }
 await assert.rejects(render('## 关键词 {role=keywords}\n\n甲；乙',{type:'general'}),/非编号列表/);
});
test('paper inference requires author and a nonempty explicit abstract; explicit template wins',()=>{
 const md='---\nauthor: 张三\n---\n\n'+summary;
 assert.equal(resolveWebType(md),'paper');assert.equal(resolveWebType(md,'general'),'general');
 assert.equal(resolveWebType(summary),'general');
 assert.equal(resolveWebType('---\nauthor: 张三\n---\n\n## 关键词 {role=keywords}\n\n- 甲'),'general');
 assert.equal(resolveWebType('---\nauthor: 张三\n---\n\n```md\n'+summary+'\n```'),'general');
});
test('removed frontmatter and CLI text settings fail explicitly, tags and switches remain',()=>{
 for(const key of ['abstract','keywords','kicker','bibliography-title','bibliographyTitle','colophon','colophon-left','colophonCenter'])assert.throws(()=>parseFrontmatter('---\n'+key+': text\n---\n'),/已移至 Markdown/);
 for(const flag of ['--kicker','--bibliography-title','--colophon-left','--colophon'])assert.throws(()=>parseArgs([flag,'text']));
 assert.deepEqual(parseFrontmatter('---\ntags: [甲,乙]\ncolophon-enabled: false\n---').fm.tags,['甲','乙']);
});
test('kicker and colophon override supplied positions, preserve defaults and obey switches',async()=>{
 const r=await render('---\nversion: v2\n---\n\n:::kicker\n研究报告\n:::\n\n:::colophon\nleft: 编制：张三\nright: ""\n:::\n\n## 正文',{type:'general'});
 assert.match(r.html,/<div class="kicker">研究报告<\/div>/);
 assert.match(r.html,/<div class="colophon"><span>编制：张三<\/span><span>v2<\/span><span><\/span>/);
 const off=await render('---\ncolophon-enabled: false\n---\n\n:::colophon\n姓名\n:::',{type:'general'});assert.doesNotMatch(off.html,/<div class="colophon">/);
 assert.throws(()=>prepareDocumentContent(':::kicker\n一\n:::\n:::kicker\n二\n:::'),/重复/);
 assert.throws(()=>prepareDocumentContent(':::colophon align=left\n内容\n:::'),/不接受行内参数/);
 assert.throws(()=>prepareDocumentContent(':::colophon\nleft: A\nleft: B\n:::'),/colophon/);
 const literal='```md\n:::kicker\n不执行\n:::\n```';assert.equal(prepareDocumentContent(literal).body,literal);
});

test('summary and bibliography source positions remain navigable',async()=>{
 const {attachSourcePositions}=await import('../src/editor-position.mjs');
 const md=summary+'\n## 正文\n\n内容[^r]。\n\n## 文献 {role=bibliography}\n\n[^r]: 来源';
 const r=await render(md,{type:'paper'});const html=attachSourcePositions(r.html,md);
 for(const role of ['abstract','keywords'])assert.match(html,new RegExp('data-document-role="'+role+'"[^>]*data-md2pdf-source-line="[0-9]+"'));
 assert.match(html,/<h2[^>]*data-document-role="bibliography"[^>]*data-md2pdf-source-line=/);
});

test('common role and content block completion is shared, without retired frontmatter suggestions',async()=>{
 const {analyzeMarkdown,provideCompletions}=await import('../web/editor-analysis.mjs');
 for(const templateType of ['general','paper','skill','gb']){
  const text='## 参考资料 {role=';
  assert.ok(!analyzeMarkdown(summary,{templateType}).diagnostics.some(d=>d.code==='gb-section-invalid'));
  assert.ok(provideCompletions({text,pos:text.length,templateType},analyzeMarkdown(text)).options.some(o=>o.label==='role=bibliography'));
  const block=':::col';const result=provideCompletions({text:block,pos:block.length,templateType},analyzeMarkdown(block));
  assert.ok(result.options.some(o=>o.label==='colophon'&&o.apply==='colophon\n编制：张三\n:::'));
 }
});

test('reusing parsed frontmatter does not accumulate missing bibliography warnings',async()=>{
 const md='## 正文\n\n文字[^r]。\n\n[^r]: 来源';const parsed=parseFrontmatter(md);
 for(let i=0;i<3;i++){
  const r=await render(md,{type:'general'},{parsedFrontmatter:{source:md,parsed}});
  assert.equal(r.warnings.filter(w=>w.includes('role=bibliography')).length,1);
 }
 assert.deepEqual(parsed.warnings||[],[]);
});

test('summary navigation does not consume a later ordinary heading with the same name',async()=>{
 const {attachSourcePositions}=await import('../src/editor-position.mjs');
 const md='## 摘要 {role=abstract}\n\n摘要内容。\n\n## 摘要\n\n普通章节。';
 const r=await render(md,{type:'paper'}),html=attachSourcePositions(r.html,md);
 assert.match(html,/<div class="abstract" data-document-role="abstract" data-md2pdf-source-line="1">/);
 assert.match(html,/<h2[^>]*data-md2pdf-source-line="5"[^>]*>1 摘要<\/h2>/);
 assert.doesNotMatch(html,/<h2 class="paper-label summary-heading"[^>]*data-md2pdf-source-line/);
});

test('summary navigation stays unnumbered and outside printed contents',async()=>{
 const r=await render(summary+'\n## 正文\n\n文字[^r]。\n\n## 参考资料 {role=bibliography}\n\n[^r]: 来源',{type:'paper',toc:true});
 const toc=/<div class="toc">([\s\S]*?)<\/ol>/.exec(r.html)?.[1];
 assert.ok(toc);assert.match(toc,/1 正文/);assert.match(toc,/参考资料/);assert.doesNotMatch(toc,/摘要|关键词/);
 assert.equal((r.html.match(/<h2 class="paper-label summary-heading">/g)||[]).length,2);
});
