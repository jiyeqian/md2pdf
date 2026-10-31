import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {normalizeFonts,documentFonts} from '../src/fonts.mjs';
import {parseFrontmatter,resolveDocumentOptions} from '../src/config.mjs';
import {parseArgs,expandArgs} from '../src/options.mjs';
import {render} from '../src/render.mjs';
import {requireGbFonts,gbFontDiagnostic} from '../src/gb-fonts.mjs';

test('fonts is a bounded mapping of four single safe family names',()=>{
 assert.deepEqual(normalizeFonts({body:'Noto Serif CJK SC',western:'Times New Roman',code:'Menlo',heading:'方正黑体_GBK'}),{body:'Noto Serif CJK SC',heading:'方正黑体_GBK',western:'Times New Roman',code:'Menlo'});
 for(const value of [null,[],['Arial'],'Arial',new Date(),{url:'Arial'},{body:[]},{body:' '},{body:'Arial, serif'},{body:'serif'},{body:'../font.ttf'},{body:'https://font.test/a'},{body:'x"; color:red'},{body:'</style><script>'},{body:'a\nb'},{body:'x'.repeat(101)}]) assert.throws(()=>normalizeFonts(value));
 assert.deepEqual(normalizeFonts({}),{});
});

test('frontmatter mapping validates with source position and merges per role',()=>{
 const {fm,positions}=parseFrontmatter('---\nfonts:\n  body: Arial\n  heading: Times New Roman\n---\n# 文档');
 const e=resolveDocumentOptions({fonts:{code:'Menlo'}},fm,{name:'general',defaults:{fonts:{western:'Helvetica'}}},{positions});
 assert.deepEqual(e.fonts,{western:'Helvetica',body:'Arial',heading:'Times New Roman',code:'Menlo'});
 for(const declaration of ['fonts: [Arial]','fonts: { body: 123 }','fonts: { bad: Arial }','fonts: { body: "url(x)" }']) assert.throws(()=>parseFrontmatter('---\n'+declaration+'\n---\n正文'),e=>e.status===400&&e.configErrors?.[0]?.line===2);
 assert.equal(resolveDocumentOptions({}, {allowFontFallback:true}).allowFontFallback,false);
});

test('CLI accepts per-role fonts and explicit fallback without accepting conflicting values',()=>{
 const opts=parseArgs(expandArgs(['a.md','--font-body','Arial','--font-heading=Times New Roman','--font-code','Menlo','--allow-font-fallback']));
 assert.deepEqual(opts.fonts,{body:'Arial',heading:'Times New Roman',code:'Menlo'});
 assert.equal(opts.allowFontFallback,true);
 assert.equal(parseArgs(['a.md','--allow-font-fallback=false']).allowFontFallback,false);
 for(const args of [['--font-body'],['--font-body','Arial','--font-body','Menlo'],['--font-heading','x;color:red'],['--allow-font-fallback=perhaps']]) assert.throws(()=>parseArgs(args));
});

test('font CSS is family-only, Western is range-limited, GB overrides stay out of cover and headers',()=>{
 const plan=documentFonts({body:'Arial',heading:'Helvetica',western:'Times New Roman',code:'Menlo'},true);
 assert.equal(plan.checks.length,4);
 assert.match(plan.css,/unicode-range: U\+0030-0039/);
 assert.match(plan.css,/main, \.toc, \.pagedjs_footnote_area/);
 assert.match(plan.css,/font-family: "MD2PDF User code"/);
 assert.ok(!/font-size|line-height|@page|\.gb-cover/.test(plan.css));
 assert.deepEqual(documentFonts(),{css:'',checks:[]});
});

test('all templates share local font declarations and strict print checks',async()=>{
 for(const type of ['general','skill','paper','gb']) {
  const md='---\nfonts:\n  body: Arial\n  heading: Helvetica\n  western: Times New Roman\n  code: Menlo\n---\n# 测试\n\n## 范围\n\n正文 ABC 123。`code`';
  const r=await render(md,{type,pagedHtml:true});
  assert.match(r.html,/src: local\("Arial"\)/);
  assert.match(r.html,/window\.__md2pdfFontsReady=false/);
  assert.equal(r.printOptions.waitFonts,true);
  if(type==='gb') assert.match(r.html,/\.gb-body-title \{ font-family: var\(--md2pdf-default-head\)/);
  assert.equal(r.printOptions.requireFonts,true);
  assert.ok(!r.html.includes('window.__md2pdfAllowFontFallback=true'));
 }
 const plain=await render('# 文档\n\n正文',{type:'general'});
 assert.ok(!plain.html.includes('window.__md2pdfFontsReady'));
});

test('custom missing font diagnostics reuse safe confirmation flow without exposing arbitrary errors',async()=>{
 const window={};
 const document={fonts:{load:async()=>[],ready:Promise.resolve()}};
 const check=vm.runInNewContext('('+requireGbFonts.toString()+')',{window,document});
 await assert.rejects(check([['12pt "MD2PDF User body"',null,'Absent User Font','custom']]),/Absent User Font/);
 assert.deepEqual(gbFontDiagnostic(window.__md2pdfFontError),{code:'FONT_MISSING',fonts:['Absent User Font']});
 assert.equal(gbFontDiagnostic({code:'FONT_MISSING',fonts:['/private/font.ttf']}),null);
});

test('empty font roles reset inherited names and create no local font checks',async()=>{
 const empty={body:'',heading:'',western:'',code:''};
 assert.deepEqual(normalizeFonts(empty),empty);assert.deepEqual(documentFonts(empty),{css:'',checks:[]});
 const parsed=parseFrontmatter('---\nfonts:\n  heading: ""\n  body: ""\n  western: ""\n  code: ""\n---\n# 文档');
 assert.deepEqual(parsed.config.fonts,empty);assert.deepEqual(parsed.warnings||[],[]);
 assert.equal(resolveDocumentOptions({},parsed.fm,{name:'general',defaults:{fonts:{body:'Arial'}}}).fonts.body,'');
 assert.equal(parseArgs(['--font-body=']).fonts.body,'');
 const mixed=documentFonts({heading:'Arial',body:'',western:'',code:''});
 assert.equal(mixed.checks.length,1);assert.equal(mixed.checks[0][2],'Arial');assert.ok(!mixed.css.includes('local("")'));
 for(const type of ['general','paper','skill','gb']){
  const r=await render('---\nfonts: {heading: "", body: "", western: "", code: ""}\n---\n# 文档\n\n## 正文',{type});
  assert.ok(!r.warnings.some(w=>w.includes('fonts')));assert.ok(!r.html.includes('MD2PDF User'));
 }
});
