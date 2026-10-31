import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {Chrome,findChrome} from '../src/chrome.mjs';
import {render} from '../src/render.mjs';
const temp=await mkdtemp('/private/tmp/gb-body-edges-'),chrome=new Chrome(findChrome(),temp);
const base='---\ntitle: 边界检查\n---\n\n## 范围\n\n';
try{
 await chrome.start();
 const cases=[
  ['wide formula','$$'+Array(500).fill('x').join('+')+'$$','正文元素超出版心'],
  ['huge merged group',':::gb-table\nhead:\n| 对象 | 内容 |\nbody:\n| {rowspan=2} 系统 | '+('合并行组。'.repeat(1500))+' |\n| 次行 |\n:::','合并行组超过'],
  ['huge row','| 项目 | 内容 |\n| --- | --- |\n| 一 | '+('长单元格。'.repeat(1600))+' |','表格单行超过'],
  ['huge table note','| 项目 | 内容 |\n| --- | --- |\n| 一 | 二 |\n\n:::gb-note scope=table layout=boxed label=\"注：\"\n'+('长表注。'.repeat(1800))+'\n:::','表格单行超过'],
  ['huge footnote','内容[^@a]\n\n[^@a]: '+('长脚注。'.repeat(2000)),'条文脚注超过'],
  ['huge equation',':::gb-equation\n$$F=x$$\n\n式中：\n$F$ | '+('长释义。'.repeat(2200))+'\n:::','公式及释义超过'],
 ];
 for(const [name,content,expected] of cases){
  const r=await render(base+content,{type:'gb',pagedHtml:true});const path=temp+'/'+name.replaceAll(' ','-')+'.html';await writeFile(path,r.pagedHtml);
  await assert.rejects(chrome.print(path,{...r.printOptions,waitPaged:true}),e=>e.message.includes(expected),name);
 }
 const r=await render(base+'首条[^@a]，次条[^@b]。\n\n[^@a]: 第一条内容。\n[^@b]: 第二条内容。\n\n:::gb-note\n'+('注释回行。'.repeat(500))+'\n:::',{type:'gb',pagedHtml:true});
 const path=temp+'/multiple.html';await writeFile(path,r.pagedHtml);await chrome.print(path,{...r.printOptions,waitPaged:true});
 const result=await chrome.send('Runtime.evaluate',{returnByValue:true,expression:`({error:window.__md2pdfPagedError,notes:document.querySelectorAll('.pagedjs_pages .gb-footnote-content').length,audit:window.__gbBodyAudit})`});
 assert.ok(!result.result.value.error,result.result.value.error);assert.equal(result.result.value.notes,2);assert.ok(result.result.value.audit.records>=3);
 for(const [name,ending] of [
  ['formula','$$x=1$$'],
  ['heading','### 末页标题'],
  ['figure','```mermaid\nflowchart LR\n A[输入] --> B[输出]\n```\n\n图：末页图'],
 ]){
  const r=await render(base+'前文。\n\n<!-- pagebreak -->\n\n'+ending,{type:'gb',pagedHtml:true});
  const path=temp+'/last-'+name+'.html';await writeFile(path,r.pagedHtml);await chrome.print(path,{...r.printOptions,waitPaged:true});
 }
 const nested=await render(base+':::gb-note\n说明[^@n]。\n:::\n\n| 项目 | 内容 |\n| --- | --- |\n| 一 | 说明[^@t] |\n\n[^@n]: 注中的页底脚注。\n[^@t]: 单元格中的表脚注。',{type:'gb',pagedHtml:true});
 const nestedPath=temp+'/nested-notes.html';await writeFile(nestedPath,nested.pagedHtml);await chrome.print(nestedPath,{...nested.printOptions,waitPaged:true});
 const nestedState=await chrome.send('Runtime.evaluate',{returnByValue:true,expression:`({body:document.querySelectorAll('.pagedjs_pages .gb-footnote-content').length,table:document.querySelectorAll('.pagedjs_pages .gb-table-footnote').length})`});
 assert.deepEqual(nestedState.result.value,{body:1,table:1},'note footnote stays at page bottom; table-cell footnote stays in table');
 const source=await render('---\ngb_source_cover: true\n标准号: GB/T 1—2020\n---\n\nSOURCE_COVER 原始证据正文。',{type:'gb',gbDefaults:false,pagedHtml:true});
 assert.ok(!source.pagedHtml.includes('<header class="masthead'));
 const sourcePath=temp+'/source-cover.html';await writeFile(sourcePath,source.pagedHtml);await chrome.print(sourcePath,{...source.printOptions,waitPaged:true});
 const sourceState=await chrome.send('Runtime.evaluate',{returnByValue:true,expression:`({pages:document.querySelectorAll('.pagedjs_page').length,text:document.querySelector('.pagedjs_page_content').textContent})`});
 assert.equal(sourceState.result.value.pages,1,'unsectioned source evidence has no phantom page');
 assert.ok(sourceState.result.value.text.includes('SOURCE_COVER'));
 console.log('PASS: six oversize rejections; two footnotes and multipage note; final formula/figure/heading; source-cover evidence');
}finally{await chrome.stop();await rm(temp,{recursive:true,force:true});}
