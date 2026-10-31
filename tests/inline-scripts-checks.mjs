import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../src/render.mjs';
import {renderScriptLabel} from '../src/inline-scripts.mjs';
for(const type of ['general','paper','skill','gb'])test(type+': brace scripts allow spaces while deletion, emphasis, code and math remain distinct',async()=>{
 const md='# 排版\n\n## 正文\n\nx^{2} H_{2}O，~~删除~~，_斜体_。`x^{2} H_{2}O`\n\n\\^{a}，\\_{b}。\n\n^{two words}，_{two words}。\n\n旧语法 x^2^、H~2~O、^^下标^^。\n\n```md\nx^{2} H_{2}O\n```\n\n数学 $x^{2}+y_{1}$。';
 const {html}=await render(md,{type,toc:false});
 assert.match(html,/x<sup class="md-superscript">2<\/sup>/);assert.match(html,/H<sub class="md-subscript">2<\/sub>O/);
 assert.match(html,/<sup class="md-superscript">two words<\/sup>/);assert.match(html,/<sub class="md-subscript">two words<\/sub>/);
 assert.match(html,/<del>删除<\/del>/);assert.match(html,/<em>斜体<\/em>/);assert.match(html,/<code>x\^\{2\} H_\{2\}O<\/code>/);
 assert.ok(html.includes('x^2^、H~2~O、^^下标^^'));
 assert.doesNotMatch(html,/<sup[^>]*>a<\/sup>|<sub[^>]*>b<\/sub>/);
 assert.match(html,/\$x\^\{2\}\+y_\{1\}\$/);
 const literal=(await render('## 正文\n\n^{} _{ } ^{未闭合\n\n_{换\n行}',{type,toc:false})).html;
 assert.doesNotMatch(literal,/class="md-(superscript|subscript)"/);
 const mixed=(await render('## 正文\n\n_{ } H_{2}O，^{未闭合 x^{3}',{type,toc:false})).html;
 assert.match(mixed,/H<sub class="md-subscript">2<\/sub>O/);assert.doesNotMatch(mixed,/<em>/);
});
test('labels use the same braces and spaces without allowing HTML or old delimiters',()=>{
 assert.equal(renderScriptLabel('^{a}'),'<sup class="md-superscript">a</sup>');
 assert.equal(renderScriptLabel('_{two words}'),'<sub class="md-subscript">two words</sub>');
 assert.equal(renderScriptLabel('^{a\\{b\\}}'),'<sup class="md-superscript">a{b}</sup>');
 assert.equal(renderScriptLabel('\\^{a} \\_{1}'),'^{a} _{1}');
 const label=renderScriptLabel('^{<img/src=x>}');assert.ok(label.includes('&lt;img/src=x&gt;'));assert.ok(!label.includes('<img'));
 assert.equal(renderScriptLabel('^a^ ~b~ ~~a~~'),'^a^ ~b~ ~~a~~');
});
