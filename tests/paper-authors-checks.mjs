import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parseFrontmatter, validateFrontmatter, ConfigError } from '../src/config.mjs';
import { render } from '../src/render.mjs';
import { FRONTMATTER_FIELDS, ARRAY_FIELDS } from '../src/frontmatter-fields.mjs';

const people = {
  authors: [
    {name:'张三', affiliations:['thu','cas']},
    {name:'李四', affiliations:['cas']},
    {name:'王五', affiliations:['thu'], corresponding:true, email:'wang@example.com'},
  ],
  affiliations:[{id:'thu',text:'清华大学自动化系，北京'},{id:'cas',text:'中国科学院自动化研究所，北京'}],
};
const source = fields => '---\n' + Object.entries(fields).map(([key,value])=>`${key}: ${JSON.stringify(value)}`).join('\n') + '\n---\n# 标题\n\n## 引言\n\n正文';
const paper = fields => render(source(fields),{type:'paper'},{webSafe:true});

test('结构化字段可被 YAML 解析与编辑器字段目录识别', () => {
  assert.deepEqual(parseFrontmatter(source(people)).fm,people);
  for (const field of ['authors','affiliations']) {assert.ok(FRONTMATTER_FIELDS.includes(field));assert.ok(ARRAY_FIELDS.has(field));}
});
test('保留作者顺序，多单位使用数字上标，单位只渲染一次', async () => {
  const {html}=await paper(people);
  assert.ok(html.indexOf('张三')<html.indexOf('李四')&&html.indexOf('李四')<html.indexOf('王五'));
  assert.match(html,/张三<sup[^>]*><a href="#md2pdf-affiliation-1">1<\/a>,<a href="#md2pdf-affiliation-2">2<\/a><\/sup>/);
  assert.equal(html.split('清华大学自动化系，北京').length-1,1);
  assert.match(html,/href="#md2pdf-correspondence">\*<\/a>/);
  assert.match(html,/通讯作者：王五（<a href="mailto:wang@example.com">wang@example.com<\/a>）/);
});
test('单位显示编号跟随单位顺序，与作者 ID 引用独立', async () => {
  const {html}=await paper({...people,affiliations:[...people.affiliations].reverse()});
  assert.match(html,/id="md2pdf-affiliation-1"><sup[^>]*>1<\/sup> 中国科学院/);
  assert.match(html,/李四<sup[^>]*><a href="#md2pdf-affiliation-1">1/);
});
test('所有作者同一单位时省略单位上标，通讯标记独立保留', async () => {
  const {html}=await paper({authors:[{name:'甲',affiliations:['only'],corresponding:true},{name:'乙',affiliations:['only']}],affiliations:[{id:'only',text:'同一单位'}]});
  assert.ok(!html.includes('href="#md2pdf-affiliation-'));
  assert.match(html,/通讯作者：甲/);
  assert.match(html,/id="md2pdf-affiliation-1">同一单位/);
});
test('多名通讯作者及可选邮箱；姓名单位作为纯文本转义', async () => {
  const {html}=await paper({authors:[{name:'<甲>',affiliations:['only'],corresponding:true},{name:'乙',affiliations:['only'],corresponding:true,email:'b@example.com'}],affiliations:[{id:'only',text:'<单位>&实验室'}]});
  assert.match(html,/&lt;甲&gt;/);
  assert.match(html,/&lt;单位&gt;&amp;实验室/);
  assert.match(html,/通讯作者：&lt;甲&gt;；乙/);
});
test('旧字段保持原有 HTML，没有作者元数据时不产生作者块', async () => {
  assert.match((await paper({author:'甲，乙',affiliation:'同一单位'})).html,/<p class="authors"><span class="author">甲，乙<\/span><span class="affil">同一单位<\/span><\/p>/);
  assert.ok(!(await paper({})).html.includes('class="authors"'));
});
for (const [name,change,field] of [
  ['旧 author 冲突',p=>({...p,author:''}),'authors'],
  ['旧 affiliation 冲突',p=>({...p,affiliation:null}),'authors'],
  ['缺少单位列表',p=>({authors:p.authors}),'affiliations'],
  ['缺少作者列表',p=>({affiliations:p.affiliations}),'authors'],
  ['空作者列表',p=>({...p,authors:[]}),'authors'],
  ['作者标量',p=>({...p,authors:'甲'}),'authors'],
  ['空作者姓名',p=>({...p,authors:[{name:' ',affiliations:['thu']}]}),'authors'],
  ['重复单位 ID',p=>({...p,affiliations:[p.affiliations[0],p.affiliations[0]]}),'affiliations'],
  ['不存在的单位',p=>({...p,authors:[{name:'甲',affiliations:['missing']}]}),'authors'],
  ['重复单位引用',p=>({...p,authors:[{name:'甲',affiliations:['thu','thu']}]}),'authors'],
  ['错误引用类型',p=>({...p,authors:[{name:'甲',affiliations:[1]}]}),'authors'],
  ['空引用列表',p=>({...p,authors:[{name:'甲',affiliations:[]}]}),'authors'],
  ['通讯作者布尔类型',p=>({...p,authors:[{...p.authors[0],corresponding:'yes'}]}),'authors'],
  ['非法邮箱',p=>({...p,authors:[{...p.authors[0],email:'not an email'}]}),'authors'],
  ['未知作者字段',p=>({...p,authors:[{...p.authors[0],affilation:'thu'}]}),'authors'],
  ['未知单位字段',p=>({...p,affiliations:[{...p.affiliations[0],name:'多余字段'}]}),'affiliations'],
]) test(`校验：${name}`, async () => {
  const fm=change(structuredClone(people));
  assert.throws(()=>validateFrontmatter(fm),error=>error instanceof ConfigError&&error.status===400&&error.configErrors.some(issue=>issue.field===field));
  assert.throws(()=>parseFrontmatter(source(fm)),error=>error instanceof ConfigError&&error.configErrors.some(issue=>issue.field===field&&issue.line>1));
  await assert.rejects(paper(fm),ConfigError);
});

test('论文模板、CLI 和 Web 示例统一使用指定的四位作者与四个单位', async () => {
  let expected;
  for (const file of ['web/examples/paper.md','examples/paper.md','templates/paper.md']) {
    const md=await readFile(new URL('../'+file,import.meta.url),'utf8');
    const {fm}=parseFrontmatter(md);
    assert.deepEqual(fm.authors.map(author=>author.name),['高松年','朱千里','赵辛楣','方鸿渐']);
    assert.deepEqual(fm.affiliations.map(unit=>unit.text),['三闾大学机械工程系','北平国学专修社','三闾大学自动化研究所','克莱登大学机械工程系']);
    assert.equal(fm.authors[3].corresponding,true);
    assert.equal(fm.authors[3].email,'fanghongjian@clayton.edu');
    const metadata={authors:fm.authors,affiliations:fm.affiliations};
    if(expected)assert.deepEqual(metadata,expected);else expected=metadata;
    const result=await render(md,{}, {webSafe:true});
    assert.equal(result.type,'paper');
    assert.match(result.html,/通讯作者：方鸿渐/);
  }
});
