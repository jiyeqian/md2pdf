import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../src/render.mjs';
import {renderScriptLabel} from '../src/inline-scripts.mjs';
for(const type of ['general','paper','skill','gb'])test(type+': inline scripts, escaping, deletion and code remain distinct',async()=>{
 const md='# 排版\n\n## 正文\n\nx^2^ H~2~O，~~删除~~。`x^2^ H~2~O`\n\n\\^a\\^，\\~b\\~。\n\n^two words^。\n\n~two words~。\n\n```md\nx^2^ H~2~O\n```\n\n数学 $x^2$。';
 const {html}=await render(md,{type,toc:false});
 assert.match(html,/x<sup class="md-superscript">2<\/sup>/);assert.match(html,/H<sub class="md-subscript">2<\/sub>O/);
 assert.match(html,/<del>删除<\/del>/);assert.match(html,/<code>x\^2\^ H~2~O<\/code>/);
 assert.ok(html.includes('^two words^'));assert.ok(html.includes('~two words~'));
 assert.doesNotMatch(html,/<sup[^>]*>a<\/sup>|<sub[^>]*>b<\/sub>/);
 assert.match(html,/\$x\^2\$/);
});
test('labels only support escaped script text and cannot introduce HTML',()=>{
 assert.equal(renderScriptLabel('^a^'),'<sup class="md-superscript">a</sup>');
 const label=renderScriptLabel('^<img/src=x>^');assert.ok(label.includes('&lt;img/src=x&gt;'));assert.ok(!label.includes('<img'));
 assert.equal(renderScriptLabel('~~a~~'),'~~a~~');
});
