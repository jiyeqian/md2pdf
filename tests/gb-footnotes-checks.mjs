import test from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from '../vendor/marked.esm.js';
import { prepareGbFootnotes } from '../src/gb-footnotes.mjs';
import { prepareGbContent } from '../src/gb-content.mjs';
import { render } from '../src/render.mjs';
const marked = new Marked({gfm:true});
const parse = source => {
  const prepared=prepareGbFootnotes(source);
  const parser=new Marked({gfm:true});
  parser.use({extensions:[prepared.extension]});
  const html=prepared.finalize(parser.parse(prepared.body));
  return {html,css:prepared.css};
};

test('条文脚注按首次引用次序编号，复引链接到同一实体',()=>{
  const {html,css}=parse('乙[^@b]，甲[^@a]，再次乙[^@b]。\n\n[^@a]: 甲的内容\n[^@b]: 乙的内容');
  assert.match(html,/id="gb-footnote-1"[^>]*>乙的内容/);
  assert.match(html,/id="gb-footnote-2"[^>]*>甲的内容/);
  assert.match(html,/<sup class="gb-footnote-repeat"><a href="#gb-footnote-1">1\)<\/a><\/sup>/);
  assert.equal((html.match(/id="gb-footnote-1"/g)||[]).length,1);
  assert.match(css,/gb-footnote-1::footnote-call/);
});
test('未引用条文脚注不显示，重复定义和缺失定义明确报错',()=>{
  assert.ok(!parse('正文\n\n[^@unused]: 不应输出').html.includes('不应输出'));
  assert.throws(()=>parse('正文[^@missing]'),/未定义/);
  assert.throws(()=>prepareGbFootnotes('[^@x]: 甲\n[^@x]: 乙'),/重复/);
});
test('条文脚注的 raw HTML 按文本转义',()=>{
  const {html}=parse('正文[^@a]\n\n[^@a]: <img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'));
  assert.match(html,/&lt;img/);
});
test('不同长度反引号代码中的脚注语法不作引用',()=>{
  for(const source of ['注`[^@missing]`。','注``a ` [^@missing]``。','注```a `` [^@missing]```。']) {
    assert.equal(parse(source).html,marked.parse(source),source);
  }
});
test('围栏代码里的定义和引用保持字面内容',()=>{
  for(const fence of ['```','~~~~']) {
    const source=fence+'text\n[^@x]: 示例定义\n正文[^@x]\n'+fence;
    assert.equal(parse(source).html,marked.parse(source));
  }
});
test('缩进代码里的脚注语法保持字面内容',()=>{
  for(const source of ['    [^@x]: 示例定义\n\n正文','    正文[^@missing]\n\n正文','\t正文[^@missing]\n\n正文']) {
    assert.equal(parse(source).html,marked.parse(source));
  }
});
test('链接目标和图片说明里的脚注语法不能注入 HTML 属性',()=>{
  for(const source of ['[链接](https://example.com/[^@a])','![图片[^@a]](data:image/png;base64,AAAA)']) {
    const {html}=parse(source+'\n\n[^@a]: 脚注内容');
    assert.equal(html,marked.parse(source),source);
    assert.ok(!html.includes('<span'));
  }
});
test('gb 页底脚注和既有参考文献分别渲染',async()=>{
  const source='# 标准名称\n\n## 范围\n\n正文[^@page]和参考文献[^ref]。\n\n[^@page]: 页底说明\n[^ref]: 文献条目';
  for(const webSafe of [false,true]) {
    const {html}=await render(source,{type:'gb'},{webSafe});
    assert.match(html,/<span class="gb-footnote gb-footnote-1"/);
    assert.match(html,/<ol class="references">/);
    assert.match(html,/<li id="fn-1">[\s\S]*?文献条目/);
    assert.ok(!/<li id="fn-\d+">[^]*?页底说明/.test(html.slice(html.indexOf('<ol class="references">'))));
  }
});
test('gb 中代码围栏里的既有参考文献定义不被抽取到文末',async()=>{
  const source='# 标准名称\n\n## 范围\n\n```text\n[^ref]: 代码内容\n```\n\n正文';
  const result=await render(source,{type:'gb'},{webSafe:true});
  const html=/<main>([\s\S]*?)<\/main>/.exec(result.html)[1];
  assert.match(html,/<pre><code[^>]*>[\s\S]*?代码内容[\s\S]*?<\/code><\/pre>/);
  assert.ok(!html.includes('<ol class="references">'));
});
test('转义、跨行行内代码与非关闭围栏内的脚注保持字面内容',()=>{
  for(const source of ['\\[^@missing]','`跨行\n[^@missing]`','```text\n```not-a-close\n[^@missing]\n```']) {
    assert.equal(parse(source).html,marked.parse(source));
  }
});
test('脚注内容不执行危险链接，数学反斜线保持原样',()=>{
  const {html}=parse('正文[^@a]\n\n[^@a]: [恶意](javascript:alert%281%29) 与 $a\\_b$');
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('$a\\_b$'));
});
test('语义块中的脚注与后续普通正文仍按显示顺序编号',async()=>{
  const source='# 标准名称\n\n## 范围\n\n:::gb-note\n先见[^@a]。\n:::\n\n后见[^@b]。\n\n[^@a]: 第一条脚注\n[^@b]: 第二条脚注';
  const result=await render(source,{type:'gb'},{webSafe:true});
  const html=/<main>([\s\S]*?)<\/main>/.exec(result.html)[1];
  assert.match(html,/id="gb-footnote-1"[^>]*>第一条脚注/);
  assert.match(html,/id="gb-footnote-2"[^>]*>第二条脚注/);
});

test('延迟定号使语义块内的首次引用成为唯一浮动实体，块外复引沿用编号',()=>{
  const source=':::gb-note\n先见[^@a]。\n:::\n\n后见[^@b]，复引[^@a]。\n\n[^@a]: 第一条脚注\n[^@b]: 第二条脚注';
  const notes=prepareGbFootnotes(source), blocks=prepareGbContent(notes.body);
  const parser=new Marked({gfm:true});
  parser.use({extensions:[notes.extension]});
  const html=notes.finalize(blocks.restore(parser.parse(blocks.body),parser));
  assert.match(html,/id="gb-footnote-1"[^>]*>第一条脚注/);
  assert.match(html,/id="gb-footnote-2"[^>]*>第二条脚注/);
  assert.match(html,/<sup class="gb-footnote-repeat"><a href="#gb-footnote-1">1\)<\/a><\/sup>/);
  assert.equal((html.match(/id="gb-footnote-1"/g)||[]).length,1);
  assert.ok(html.indexOf('id="gb-footnote-1"')<html.indexOf('id="gb-footnote-2"'));
  assert.equal(notes.finalize(html),html);
  assert.match(notes.css,/gb-footnote-2::footnote-call/);
});
