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
  const html=parse(':::gb-note label=\"注1：\"\n**内容**\n\n第二段\n:::\n\n:::gb-example\n示例内容\n:::');
  assert.match(html,/<div class="gb-note"[^>]*><p><span class="gb-label">注1：<\/span><span class="gb-note-text"><strong>内容<\/strong><\/span><\/p>/);
  assert.match(html,/<p>第二段<\/p>/);
  assert.match(html,/<div class="gb-example gb-example-block"[^>]*><p><span class="gb-label">示例：<\/span><span class="gb-example-text">示例内容/);
});
test('术语使用显式编号和中英文名，定义可包含独立注块',()=>{
  const html=parse(':::gb-term 3.1\n机械手\nmanipulator\n\n用于操作的装置。\n\n:::gb-note\n术语附注。\n:::\n:::');
  assert.match(html,/<div class="gb-term-number">3.1<\/div>/);
  assert.match(html,/<div class="gb-term-name">机械手　manipulator<\/div>/);
  assert.match(html,/<div class="gb-term-definition"><p>用于操作的装置。<\/p>/);
  assert.match(html,/<div class="gb-note gb-unlabelled"[^>]*>/);
});
test('未关闭及编号无效的术语块保留原始正文，不丢失内容',()=>{
  assert.throws(()=>parse(':::gb-note\n未关闭'),/块未闭合/);
  const source=':::gb-term invalid\n术语\n:::'; assert.equal(parse(source),marked.parse(source));
});
test('普通说明不自动猜测来源或单位，分图仍有独立角色',()=>{
  const source=parse(':::gb-note\n来源：自填内容\n:::');
  assert.ok(!source.includes('gb-source'));
  assert.ok(!source.includes('gb-label'));
  assert.match(source,/<p>来源：自填内容<\/p>/);
  assert.match(parse(':::gb-note scope=table position=top align=right\n说明\n:::'),/data-gb-note-position="top" data-gb-note-align="right"/);
  assert.match(parse(':::gb-subfigure a）子图\n内容\n:::'),/class="gb-subfigure"/);
});
test('语义块中 raw HTML 和标签按文本转义，危险链接不形成可执行协议',()=>{
  const html=parse(':::gb-note label=\"<img src=x onerror=alert(1)>\"\n<script>alert(1)</script>\n\n[链接](javascript:alert%281%29)\n:::');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('href="#"'));
});
test('占位符不与用户原文冲突',()=>{
  const html=parse('MD2PDFGBBLOCK0END\n\n:::gb-note\n内容\n:::');
  assert.match(html,/<p>MD2PDFGBBLOCK0END<\/p>/);
  assert.match(html,/<div class="gb-note gb-unlabelled"[^>]*>/);
});

test('图表注及图表脚注有独立角色，首段标签与正文可悬挂对齐',()=>{
  for(const [scope,label,weight] of [['figure','注1：','bold'],['table','注2：','bold'],['figure','a）','normal'],['table','b）','normal']]) {
    const html=parse(`:::gb-note scope=${scope} label="${label}" weight=${weight}\n**第一段**\n\n第二段\n:::`);
    assert.match(html,new RegExp(`<div class="gb-${scope}-note"[^>]*><p><span class="gb-label">${label}</span><span class="gb-note-text"><strong>第一段</strong></span></p>`));
    assert.ok(html.includes('<p>第二段</p>'));
  }
});
test('多条表注和脚注归入前一张表的tfoot，不跨越正文或另一表',()=>{
  const source='| 甲 | 乙 |\n|---|---|\n| 1 | 2 |\n\n:::gb-note scope=table label=\"注1：\"\n第一表注\n:::\n\n:::gb-note scope=table label=\"a）\" weight=normal\n第一表脚注\n:::\n\n正文阻隔。\n\n:::gb-note label=\"注：\"\n游离表注\n:::\n\n| 丙 |\n|---|\n| 3 |\n\n:::gb-note scope=table label=\"注：\"\n第二表注\n:::';
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
test('仅为空白的表格单元格添加一字线，保留显式内容及合并属性',()=>{
  const input='<table><thead><tr><th> </th><th>标题</th></tr></thead><tbody><tr><td colspan="2" rowspan="2">\n </td><td>&nbsp;</td><td><br></td><td>0</td></tr></tbody></table><pre>&lt;td&gt;&lt;/td&gt;</pre>';
  const out=transformGbContent(input,'');
  assert.match(out,/<th>—<\/th><th>标题<\/th>/);
  assert.match(out,/<td colspan="2" rowspan="2">—<\/td><td>&nbsp;<\/td><td><br><\/td><td>0<\/td>/);
  assert.ok(out.endsWith('<pre>&lt;td&gt;&lt;/td&gt;</pre>'));
});
test('纵向合并单元格参与表注跨列计算，保留既有表体',()=>{
  const table='<table><tbody><tr><td rowspan="2">甲</td><td>乙</td><td>丙</td></tr><tr><td colspan="2">丁</td></tr></tbody></table>';
  const out=transformGbContent(table+parse(':::gb-note scope=table label=\"注：\"\n表注\n:::'),'');
  assert.match(out,/<td rowspan="2">甲<\/td>/);
  assert.match(out,/<tfoot><tr class="gb-table-notes"><td colspan="3">/);
});
test('公式显式块具有独立语义，代码围栏保持原样',()=>{
  assert.match(parse(':::gb-equation\n内容\n:::'),/<div class="gb-equation">/);
  const source='```text\n:::gb-equation\n内容\n:::\n```';
  assert.equal(parse(source),marked.parse(source));
});
test('图注及图脚注依原顺序移入图题之前，多图不互串',()=>{
  const figure=name=>`<figure class="fig"><img src="x"><figcaption>${name}</figcaption></figure>`;
  const html=figure('图1')+parse(':::gb-note scope=figure label=\"注：\"\n第一图注\n:::\n\n:::gb-note scope=figure label=\"a）\" weight=normal\n第一图脚注\n:::')+figure('图2')+parse(':::gb-note scope=figure label=\"注：\"\n第二图注\n:::');
  const out=transformGbContent(html,'');
  const figures=[...out.matchAll(/<figure[\s\S]*?<\/figure>/g)].map(match=>match[0]);
  assert.equal(figures.length,2);
  assert.ok(figures[0].indexOf('第一图注')<figures[0].indexOf('第一图脚注'));
  assert.ok(figures[0].indexOf('第一图脚注')<figures[0].indexOf('<figcaption>'));
  assert.ok(!figures[0].includes('第二图注'));
  assert.ok(figures[1].includes('第二图注'));
});
test('已有tfoot保留，并在其中追加注释行',()=>{
  const html='<table><tbody><tr><td>内容</td></tr></tbody><tfoot><tr><td>既有内容</td></tr></tfoot></table>'+parse(':::gb-note scope=table label=\"注：\"\n表注\n:::');
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
  const block=prepareGbContent(':::gb-note scope=figure label=\"注：\"\n图注[^@note]\n:::');
  const html='<figure class="fig"><img src="x"><figcaption>'+caption+'</figcaption></figure>'+block.restore(parser.parse(block.body),parser);
  const out=notes.finalize(transformGbContent(html,''));
  assert.match(out,/id="gb-footnote-1"[^>]*><span class="gb-footnote-label">1\)<\/span><span class="gb-footnote-content">图注脚注/);
  assert.match(out,/id="gb-footnote-2"[^>]*><span class="gb-footnote-label">2\)<\/span><span class="gb-footnote-content">图题脚注/);
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

test('表上方说明从表后移入表题，不跨过正文或另一表', () => {
  const note=parse(':::gb-note scope=table position=top align=right\n单位为毫米\n:::');
  const first='<table><caption>表1</caption><tbody><tr><td>甲</td></tr></tbody></table>';
  const second='<table><caption>表2</caption><tbody><tr><td>乙</td></tr></tbody></table>';
  const out=transformGbContent(first+'<p>正文</p>'+second+note,'');
  assert.match(out,/<caption>表1<\/caption>/);
  assert.match(out,/<caption>表2<div class="gb-table-top">[\s\S]*?单位为毫米/);
  assert.throws(()=>transformGbContent(second+'<p>阻隔</p>'+note,''),e=>e.status===400);
});

test('来源文字原样显示，保留安全的行内 Markdown与多段内容',()=>{
  for(const value of ['GB/T 20000.1—2014，5.3','来源: GB/T 20000.1—2014，5.3','[来源：GB/T 20000.1—2014，5.3]','［GB/T 20000.1—2014，5.3］']) {
    assert.ok(parse(`:::gb-note\n${value}\n:::`).includes('<p>'+value+'</p>'));
  }
  const html=parse(':::gb-note\n[来源：**GB/T 1**，有修改 [链接](https://example.com) <script> [坏](javascript:alert)]\n:::');
  assert.match(html, /<strong>GB\/T 1<\/strong>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.match(parse(':::gb-note\n第一段\n\n第二段\n:::'),/<p>第一段<\/p>\s*<p>第二段<\/p>/);
});

test('索引仅链接已存在且无歧义的标题和图表编号',()=>{
  const index=parse(':::gb-index A\n术语 | 3.1， 5.2 / 图1、表 A.1；附录A, A.1, 9.9, <img src=x>\n:::');
  const html='<h2 id="sec-1">3.1 范围</h2><h3 id="sec-2">5.2 内容</h3><h2 class="appendix" id="app">附录 A （资料性） 标题</h2><h3 id="app-1">A.1 内容</h3><figure id="fig-1"><figcaption>图 1　示意</figcaption></figure><table id="tab-1"><caption>表 A.1　数据</caption></table>'+index;
  const result=transformGbContent(html,'');
  for(const [label,id] of [['3.1','sec-1'],['5.2','sec-2'],['图1','fig-1'],['表 A.1','tab-1'],['附录A','app'],['A.1','app-1']]) assert.ok(result.includes(`<a href="#${id}">${label}</a>`),label);
  assert.ok(result.includes('9.9'));
  assert.ok(!result.includes('href="#9.9"'));
  assert.ok(!result.includes('<img src=x>'));
  const ambiguous=transformGbContent('<h2 id="one">3.1 甲</h2><h2 id="two">3.1 乙</h2>'+index,'');
  assert.ok(!ambiguous.includes('<a href="#one">3.1</a>'));
  const self=transformGbContent('<div class="gb-index"><h3 id="fake">3.1 自身</h3>'+index+'</div>','');
  assert.ok(!self.includes('href="#fake"'));
});

test('CLI 与 webSafe 对 GB 来源和索引生成相同链接',async()=>{
  const {render}=await import('../src/render.mjs');
  const source='# 标准\n\n## 范围\n\n### 内容\n\n:::gb-note\n[来源：GB/T 1—2020，5.3]\n:::\n\n## 索引\n\n:::gb-index\n术语 | 1.1，9.9\n:::';
  for(const context of [{},{webSafe:true}]) {
    const {html}=await render(source,{type:'gb'},context);
    assert.match(html, /\[来源：GB\/T 1—2020，5\.3\]/);
    assert.match(html, /<a href="#sec-\d+">1\.1<\/a>，9\.9/);
  }
});

test('术语编号提供可跳转的索引目标',()=>{
  const term=parse(':::gb-term 3.1\n术语\nterm\n\n定义\n:::');
  const index=parse(':::gb-index S\n术语 | 3.1\n:::');
  assert.match(transformGbContent(term+index,''), /<a href="#gb-term-3\.1">3\.1<\/a>/);
});

test('示例布局显式选择，拒绝同行复杂块，默认示例局部连续编号',()=>{
  const block=parse(':::gb-example\n段落\n:::');
  const inline=parse(':::gb-example layout=inline\n同行正文\n:::');
  assert.match(block,/gb-example-block/);
  assert.match(inline,/gb-example-inline/);
  assert.doesNotMatch(inline,/gb-label">layout/);
  for(const text of ['一\n\n二','- 列表','```\n代码\n```']) assert.throws(()=>parse(':::gb-example layout=inline\n'+text+'\n:::'),e=>e.status===400);
  assert.throws(()=>parse(':::gb-example layout=wide\n正文\n:::'),e=>e.status===400);
  const numbered=transformGbContent('<section><h3>5.1 标题</h3>'+block+inline+'</section><section><h3>5.2 标题</h3>'+block+'</section>','');
  assert.match(numbered,/gb-label">示例1：/);
  assert.match(numbered,/gb-label">示例2：/);
  assert.match(numbered,/gb-label">示例：/);
});

test('章后引导段使用统一标记，普通条后段落不混入',()=>{
  const html=transformGbContent('<section><h2>3 术语和定义</h2><p>引导</p><h3>3.1 分类</h3><p>普通段落</p></section>','');
  assert.match(html,/<p class="gb-intro">引导/);
  assert.match(html,/<p>普通段落/);
});

test('示例布局在CLI与Web安全渲染一致，并返回相同的参数错误',async()=>{
  const {render}=await import('../src/render.mjs');
  const source='# 标准\n\n## 范围\n\n:::gb-example layout=inline\n一段正文\n:::';
  for(const context of [{},{webSafe:true}]) {
    assert.match((await render(source,{type:'gb'},context)).html,/gb-example-inline/);
    await assert.rejects(()=>render(source.replace('一段正文','一段\n\n另一段'),{type:'gb'},context),e=>e.status===400);
  }
});

test('自动术语根据章与分类编号，稳定索引随插入更新，旧编号兼容',async()=>{
  const {render}=await import('../src/render.mjs');
  const term=(key)=>`:::gb-term${key?' id='+key:''}\n术语\nterm\n\n定义\n:::\n\n`;
  const source='# 标准\n\n## 范围\n\n正文\n\n## 术语和定义\n\n'+term('first')+term('second')+'## 索引\n\n:::gb-index\n第二项 | @second\n:::';
  for(const context of [{},{webSafe:true}]) {
    const html=(await render(source,{type:'gb'},context)).html;
    assert.match(html, /id="gb-term-first"><div class="gb-term-number">2\.1/);
    assert.match(html, /href="#gb-term-second">2\.2<\/a>/);
    const inserted=(await render(source.replace(term('first'),term('new')+term('first')),{type:'gb'},context)).html;
    assert.match(inserted,/href="#gb-term-second">2\.3<\/a>/);
    const grouped=(await render(source.replace(term('first'),'### 分类\n\n'+term('first')),{type:'gb'},context)).html;
    assert.match(grouped,/id="gb-term-first"><div class="gb-term-number">2\.1\.1/);
    const legacy=source.replace(':::gb-term id=first',':::gb-term 2.4 id=first');
    assert.match((await render(legacy,{type:'gb'},context)).html,/href="#gb-term-second">2\.5<\/a>/);
    await assert.rejects(()=>render(source.replace('id=second','id=first'),{type:'gb'},context),e=>e.status===400);
    await assert.rejects(()=>render(source.replace(':::gb-term id=second',':::gb-term 2.1'),{type:'gb'},context),e=>e.status===400);
    await assert.rejects(()=>render(source.replace(':::gb-term id=second',':::gb-term 3.1'),{type:'gb'},context),e=>e.status===400);
  }
});

test('中英索引分区采用对应栏数，旧中文分组保持单栏',()=>{
  const group=':::gb-index A\n词条 | 3.1\n:::';
  const zh=parse(':::gb-index-section lang=zh\n'+group+'\n:::');
  assert.match(zh,/data-gb-index-lang="zh"/);
  assert.match(zh,/汉语拼音索引/);
  assert.match(zh,/data-gb-index-columns="2"/);
  const en=parse(':::gb-index-section lang=en\n'+group+'\n:::');
  assert.match(en,/英文对应词索引/);
  assert.match(en,/data-gb-index-columns="1"/);
  assert.match(parse(':::gb-index-section lang=zh columns=1\n'+group+'\n:::'),/data-gb-index-columns="1"/);
  assert.doesNotMatch(parse(group),/gb-index-section|gb-index-columns/);
  for(const arg of ['lang=xx','lang=en columns=2','lang=zh columns=3','lang=zh onclick=x']) assert.throws(()=>parse(':::gb-index-section '+arg+'\n'+group+'\n:::'),e=>e.status===400);
  assert.throws(()=>parse(':::gb-index-section lang=zh\n普通正文\n:::'),e=>e.status===400);
});


test('索引分区中的稳定链接保持CLI与Web相同，缺少闭合明确报错',async()=>{
  const {render}=await import('../src/render.mjs');
  const source='# 标准\n\n## 术语和定义\n\n:::gb-term id=term\n词\nterm\n\n定义\n:::\n\n## 索引\n\n:::gb-index-section lang=zh\n\n:::gb-index C\n词 | @term\n:::\n\n:::';
  for(const context of [{},{webSafe:true}]) {
    const {html}=await render(source,{type:'gb'},context);
    assert.match(html,/data-gb-index-columns="2"/);
    assert.match(html,/href="#gb-term-term">1\.1<\/a>/);
  }
  assert.throws(()=>parse(':::gb-index-section lang=zh\n:::gb-index A\n词 | 1.1\n:::'),e=>e.status===400);
});
