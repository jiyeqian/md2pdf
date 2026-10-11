import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDoi, parseBibtex, validateManualBibtex, planCitation, applyChanges, scanFootnotes, checkSnapshot} from '../web/editor-doi-helpers.mjs';
const doi = '10.1000/example';
const bib = '@article{example,\n  title = {{Nested} title},\n  year = {2026},\n  doi = {10.1000/example}\n}';
test('strict DOI normalization preserves punctuation and decodes DOI URLs', () => {
 assert.equal(normalizeDoi(' DOI:10.1000/ABC) '),'10.1000/abc)');
 assert.equal(normalizeDoi('https://doi.org/10.1000%2FExample'),doi);
 for (const input of ['10.1000/a b','https://evil.org/10.1000/a','https://doi.org/10.1000/a?x=1','https://u@doi.org/10.1000/a','https://doi.org:123/10.1000/a']) assert.equal(normalizeDoi(input),null);
});
test('BibTeX parses nested braces, escaped punctuation and rejects malformed entries', () => {
 assert.equal(parseBibtex(bib).fields.title,'{Nested} title');
 assert.equal(parseBibtex('@article{k,doi={10.1000/a\\_b}}').fields.doi,'10.1000/a_b');
 for(const bad of ['@article{k,}','@article{k,title={broken}','@article{k,title={a}} @book{b,title={b}}','@article{k,title={a} bad}']) assert.equal(parseBibtex(bad),null);
 assert.equal(validateManualBibtex(bib,doi).ok,true);
 assert.equal(validateManualBibtex(bib,'10.1000/other').ok,false);
});
test('new citation at EOF is one change and indents the full BibTeX',()=>{
 const plan=planCitation({markdown:'正文',at:2,doi,bibtex:bib});
 assert.equal(plan.changes.length,1);
 const out=applyChanges('正文',plan.changes);
 assert.match(out,/正文\[\^ref-doi-example\] \n\n\[\^ref-doi-example\]: @article/);
 assert.match(out,/\n    }/);
 assert.equal(scanFootnotes(out).definitions[0].doi,doi);
});
test('middle insertion preserves existing content and reserves orphan reference IDs',()=>{
 const md='正文[^ref-doi-example]末尾';
 const plan=planCitation({markdown:md,at:2,doi,bibtex:bib});
 assert.equal(plan.id,'ref-doi-example-2');
 assert.equal(plan.changes.length,2);
 assert.match(applyChanges(md,plan.changes),/正文\[\^ref-doi-example-2\] \[\^ref-doi-example\]末尾/);
});
test('existing multiline BibTeX is reused without overwriting it',()=>{
 const md=applyChanges('正文',planCitation({markdown:'正文',at:2,doi,bibtex:bib}).changes);
 const plan=planCitation({markdown:md,at:0,doi:'https://doi.org/10.1000/EXAMPLE',bibtex:bib.replace('2026','2025')});
 assert.equal(plan.action,'reuse'); assert.equal(plan.changes.length,1);
 assert.match(applyChanges(md,plan.changes),/2026/);
 assert.equal(scanFootnotes(applyChanges(md,plan.changes)).definitions.length,1);
});
test('DOI-only definition upgrades once including insertion at EOF',()=>{
 for(const atEnd of [false,true]) {
 const md='正文\n\n[^old]: doi:10.1000/example\n';
 const plan=planCitation({markdown:md,at:atEnd?md.length:2,doi,bibtex:bib});
 assert.equal(plan.action,'upgrade');
 const out=applyChanges(md,plan.changes);
 assert.equal(scanFootnotes(out).definitions.length,1);
 assert.equal(scanFootnotes(out).definitions[0].kind,'bibtex');
 assert.match(out,/\[\^old\] /);
 }
});
test('code examples are excluded, valid definitions and references are reserved',()=>{
 const md='```md\n[^fake]: doi:10.1000/example\n```\n`[^inline]`\n    [^code]: doi:10.1000/example\n正文[^taken]\n\n[^real]: doi:10.1000/real';
 const scan=scanFootnotes(md);
 assert.deepEqual([...scan.taken].sort(),['real','taken']);
 assert.equal(planCitation({markdown:md,at:0,doi,bibtex:bib}).action,'insert');
});
test('DOI-only fallback produces warning; stale snapshots block insertion',()=>{
 assert.ok(planCitation({markdown:'正文',at:2,doi}).warning);
 assert.equal(checkSnapshot('a','b').ok,false); assert.equal(checkSnapshot('a','a').ok,true);
});
test('reuse at a definition EOF cannot corrupt its DOI; insertion inside definitions is rejected',()=>{
 const md='正文\n\n[^old]: doi:10.1000/example';
 const plan=planCitation({markdown:md,at:md.length,doi});
 assert.equal(scanFootnotes(applyChanges(md,plan.changes)).definitions[0].doi,doi);
 assert.equal(planCitation({markdown:md,at:md.length-1,doi,bibtex:bib}).ok,false);
});
test('manual partial metadata remains explicit rather than filling missing fields',()=>{
 const result=validateManualBibtex('@article{k,doi={10.1000/example}}',doi);
 assert.equal(result.ok,true);assert.match(result.warning,/标题/);assert.match(result.warning,/年份/);
});
