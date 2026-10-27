import test from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from '../vendor/marked.esm.js';
import { prepareGbContent, transformGbContent } from '../src/gb-content.mjs';
const marked = new Marked({gfm:true});
const parse = source => {
  const {body,restore}=prepareGbContent(source);
  return restore(marked.parse(body),marked);
};

test('正文首页名称与首章在同一个 h2 中，title 按纯文本转义',()=>{
  const html=transformGbContent('<h2 data-chapter class="body-start" id="sec-1">1 范围</h2>','名称 <测试>');
  assert.match(html,/<h2 data-chapter class="body-start" id="sec-1"><span class="gb-body-title">名称 &lt;测试&gt;<\/span><span class="gb-first-heading">1 范围<\/span><\/h2>/);
  assert.equal((html.match(/<h2/g)||[]).length,1);
});
test('附录仅在明确声明性质时拆为编号、性质和标题',()=>{
  const html=transformGbContent('<h2 class="appendix">附录 A （规范性） 检查项目</h2>','');
  assert.match(html,/<span class="gb-appendix-number">附录 A<\/span><span class="gb-appendix-kind">（规范性）<\/span><span class="gb-appendix-title">检查项目<\/span>/);
  assert.equal(transformGbContent('<h2 class="appendix">附录 B 未知性质</h2>',''),'<h2 class="appendix">附录 B 未知性质</h2>');
});
test('普通注示例文字与 fenced 源码不猜测为语义块',()=>{
  assert.equal(parse('注：这是正文。\n\n示例：也是正文。'),marked.parse('注：这是正文。\n\n示例：也是正文。'));
  const source='```text\n:::gb-note\n源码\n:::\n```';
  assert.equal(parse(source),marked.parse(source));
});
test('注和示例角色具有独立标签，保留 Markdown 强调与多段内容',()=>{
  const html=parse(':::gb-note 注1：\n**内容**\n\n第二段\n:::\n\n:::gb-example\n示例内容\n:::');
  assert.match(html,/<div class="gb-note"><p><span class="gb-label">注1：<\/span><span class="gb-note-text"><strong>内容<\/strong><\/span><\/p>/);
  assert.match(html,/<p>第二段<\/p>/);
  assert.match(html,/<div class="gb-example"><p><span class="gb-label">示例：<\/span>示例内容/);
});
test('术语使用显式编号和中英文名，定义可包含独立注块',()=>{
  const html=parse(':::gb-term 3.1\n机械手\nmanipulator\n\n用于操作的装置。\n\n:::gb-note\n术语附注。\n:::\n:::');
  assert.match(html,/<div class="gb-term-number">3.1<\/div>/);
  assert.match(html,/<div class="gb-term-name">机械手　manipulator<\/div>/);
  assert.match(html,/<div class="gb-term-definition"><p>用于操作的装置。<\/p>/);
  assert.match(html,/<div class="gb-note">/);
});
test('未关闭及编号无效的术语块保留原始正文，不丢失内容',()=>{
  for(const source of [':::gb-note\n未关闭',':::gb-term invalid\n术语\n:::']) assert.equal(parse(source),marked.parse(source));
});
test('来源、单位陈述、分图题和表注提供固定语义角色',()=>{
  for(const [role,label] of [['source','来源：'],['unit',''],['subfigure','a）子图'],['table-note','注：']]) {
    const html=parse(`:::gb-${role}${role==='subfigure'?' '+label:''}\n内容\n:::`);
    assert.ok(html.includes(`class="gb-${role}"`));
    if(label) assert.ok(html.includes(label));
  }
});
test('语义块中 raw HTML 和标签按文本转义，危险链接不形成可执行协议',()=>{
  const html=parse(':::gb-note <img src=x onerror=alert(1)>\n<script>alert(1)</script>\n\n[链接](javascript:alert%281%29)\n:::');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('href="#"'));
});
test('占位符不与用户原文冲突',()=>{
  const html=parse('MD2PDFGBBLOCK0END\n\n:::gb-note\n内容\n:::');
  assert.match(html,/<p>MD2PDFGBBLOCK0END<\/p>/);
  assert.match(html,/<div class="gb-note">/);
});

test('图表注及图表脚注有独立角色，首段标签与正文可悬挂对齐',()=>{
  for(const [role,label] of [['figure-note','注1：'],['table-note','注2：'],['figure-footnote','a）'],['table-footnote','b）']]) {
    const html=parse(`:::gb-${role} ${label}\n**第一段**\n\n第二段\n:::`);
    assert.match(html,new RegExp(`<div class="gb-${role}"><p><span class="gb-label">${label.replace('）','\\）')}</span><span class="gb-note-text"><strong>第一段</strong></span></p>`));
    assert.ok(html.includes('<p>第二段</p>'));
  }
});
test('多条表注和脚注归入前一张表的tfoot，不跨越正文或另一表',()=>{
  const source='| 甲 | 乙 |\n|---|---|\n| 1 | 2 |\n\n:::gb-table-note 注1：\n第一表注\n:::\n\n:::gb-table-footnote a）\n第一表脚注\n:::\n\n正文阻隔。\n\n:::gb-table-note\n游离表注\n:::\n\n| 丙 |\n|---|\n| 3 |\n\n:::gb-table-note\n第二表注\n:::';
  const html=transformGbContent(parse(source),'');
  const tables=[...html.matchAll(/<table>[\s\S]*?<\/table>/g)].map(match=>match[0]);
  assert.equal(tables.length,2);
  assert.match(tables[0],/<tfoot><tr class="gb-table-notes"><td colspan="2">[\s\S]*?第一表注[\s\S]*?第一表脚注/);
  assert.ok(!tables[0].includes('第二表注'));
  assert.ok(!tables[0].includes('游离表注'));
  assert.match(tables[1],/<td colspan="1">[\s\S]*?第二表注/);
  assert.match(html,/<\/table>\s*<p>正文阻隔。<\/p>/);
  assert.equal((html.match(/游离表注/g)||[]).length,1);
});
test('嵌套div不截断表注，合并单元格列数用于tfoot colspan',()=>{
  const html='<table><thead><tr><th colspan="2">头</th></tr></thead><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table>\n<div class="gb-table-note"><p>外注</p><div class="gb-example"><p>内层</p></div><p>尾段</p></div>';
  const out=transformGbContent(html,'');
  assert.match(out,/<tfoot><tr class="gb-table-notes"><td colspan="2"><div class="gb-table-note">[\s\S]*?尾段<\/p><\/div><\/td><\/tr><\/tfoot><\/table>/);
  assert.equal((out.match(/内层/g)||[]).length,1);
});
test('图注及图脚注依原顺序移入图题之前，多图不互串',()=>{
  const figure=name=>`<figure class="fig"><img src="x"><figcaption>${name}</figcaption></figure>`;
  const html=figure('图1')+parse(':::gb-figure-note\n第一图注\n:::\n\n:::gb-figure-footnote a）\n第一图脚注\n:::')+figure('图2')+parse(':::gb-figure-note\n第二图注\n:::');
  const out=transformGbContent(html,'');
  const figures=[...out.matchAll(/<figure[\s\S]*?<\/figure>/g)].map(match=>match[0]);
  assert.equal(figures.length,2);
  assert.ok(figures[0].indexOf('第一图注')<figures[0].indexOf('第一图脚注'));
  assert.ok(figures[0].indexOf('第一图脚注')<figures[0].indexOf('<figcaption>'));
  assert.ok(!figures[0].includes('第二图注'));
  assert.ok(figures[1].includes('第二图注'));
});
test('已有tfoot保留，并在其中追加注释行',()=>{
  const html='<table><tbody><tr><td>内容</td></tr></tbody><tfoot><tr><td>既有内容</td></tr></tfoot></table>'+parse(':::gb-table-note\n表注\n:::');
  const out=transformGbContent(html,'');
  assert.equal((out.match(/<tfoot>/g)||[]).length,1);
  assert.match(out,/<td>既有内容<\/td><\/tr><tr class="gb-table-notes">/);
});
test('重要提示只接受行内段落，并放在正文首页名称与范围之间',()=>{
  const html='<h2 class="body-start">1 范围</h2>\n'+parse(':::gb-important\n**重要提示：** 请注意。\n\n补充提示。\n:::')+'\n<p>范围正文。</p>';
  const out=transformGbContent(html,'国家标准名称');
  assert.match(out,/<span class="gb-body-title">国家标准名称<\/span><span class="gb-important"><span class="gb-important-paragraph"><strong>重要提示：<\/strong> 请注意。<\/span>/);
  assert.ok(out.indexOf('补充提示。')<out.indexOf('<span class="gb-first-heading">'));
  assert.ok(!/<h2[^>]*>[\s\S]*?<div/.test(out.split('</h2>')[0]));
  assert.match(out,/<\/h2>\s*<p>范围正文。<\/p>/);
  for(const content of ['- 列表','```text\n代码\n```',':::gb-note\n嵌套\n:::']) assert.throws(()=>parse(':::gb-important\n'+content+'\n:::'),error=>error.status===400);
});
test('信息字符串不是关闭围栏，内部语义块保持代码原样',()=>{
  const source='```text\n```not-a-close\n:::gb-note\n源码\n:::\n```';
  assert.equal(parse(source),marked.parse(source));
});

test('图表脚注不自动猜测或生成字母标记',()=>{
  for(const role of ['figure-footnote','table-footnote']) assert.throws(()=>parse(`:::gb-${role}\n内容\n:::`),error=>error.status===400);
});

test('图注移动后再定脚注号，按图注在前、图题在后的最终顺序编号',async()=>{
  const {prepareGbFootnotes}=await import('../src/gb-footnotes.mjs');
  const notes=prepareGbFootnotes('[^@caption]: 图题脚注\n[^@note]: 图注脚注');
  const parser=new Marked({gfm:true});
  parser.use({extensions:[notes.extension]});
  const caption=parser.parseInline('图1 图题[^@caption]');
  const block=prepareGbContent(':::gb-figure-note\n图注[^@note]\n:::');
  const html='<figure class="fig"><img src="x"><figcaption>'+caption+'</figcaption></figure>'+block.restore(parser.parse(block.body),parser);
  const out=notes.finalize(transformGbContent(html,''));
  assert.match(out,/id="gb-footnote-1"[^>]*>图注脚注/);
  assert.match(out,/id="gb-footnote-2"[^>]*>图题脚注/);
  assert.ok(out.indexOf('id="gb-footnote-1"')<out.indexOf('id="gb-footnote-2"'));
});

test('显式索引按输入分组，关键词和多个位置均按纯文本转义',()=>{
  const html=parse(':::gb-index a\n关键词 <甲> | 3.6, 5.1.3, 表2，附录B\n**乙** | 图1、表A.1、C.3.1\n:::');
  assert.match(html,/<div class="gb-index-letter">a<\/div><ul class="gb-index-entries">/);
  assert.match(html,/<li><span class="gb-index-term">关键词 &lt;甲&gt;<\/span><span class="gb-index-dots"><\/span><span class="gb-index-locations">3.6, 5.1.3, 表2，附录B<\/span><\/li>/);
  assert.ok(html.includes('<span class="gb-index-term">**乙**</span>'));
  assert.ok(html.includes('图1、表A.1、C.3.1'));
  assert.ok(!html.includes('<strong>'));
  const ungrouped=parse(':::gb-index\n术语 | 3.1\n:::');
  assert.ok(ungrouped.includes('gb-index-entries'));
  assert.ok(!ungrouped.includes('gb-index-letter'));
});
test('普通索引样式段落不猜测为索引，显式索引缺项报输入错误',()=>{
  const prose='关键词 | 3.6, 表2\n\nA';
  assert.equal(parse(prose),marked.parse(prose));
  for(const source of [':::gb-index AB\n甲 | 3.1\n:::',':::gb-index A\n甲\n:::',':::gb-index\n | 3.1\n:::',':::gb-index\n甲 | \n:::',':::gb-index\n\n:::']) {
    assert.throws(()=>parse(source),error=>error.status===400);
  }
});
test('小写附录字母规范为大写，规范性质和附录标题保持',()=>{
  const html=transformGbContent('<h2 class="appendix">附录 b （资料性） 测试项目</h2>','');
  assert.match(html,/<span class="gb-appendix-number">附录 B<\/span>/);
  assert.match(html,/<span class="gb-appendix-kind">（资料性）<\/span><span class="gb-appendix-title">测试项目<\/span>/);
});

test('附录图表范围在文后要素开始时结束', async () => {
  const {render}=await import('../src/render.mjs');
  const source='# 标准\n\n## 范围\n\n![正文图](a.png)\n\n## 附录 **a**（资料性）说明\n\n![附录图](b.png)\n\n表：附录表\n\n| 甲 |\n|---|\n| 乙 |\n\n## 参考文献\n\n![文后图](c.png)\n\n表：文后表\n\n| 甲 |\n|---|\n| 乙 |';
  const {html}=await render(source,{type:'gb'});
  assert.match(html,/<figcaption>图 A\.1　附录图/);
  assert.match(html,/<figcaption>图 2　文后图/);
  assert.match(html,/<caption>表 A\.1　附录表/);
  assert.match(html,/<caption>表 1　文后表/);
});
