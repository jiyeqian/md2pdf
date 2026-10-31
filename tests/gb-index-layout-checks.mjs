import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {render} from '../src/render.mjs';
import {finalizeGbIndexLayout} from '../src/gb-index-layout.mjs';
import {Chrome,findChrome} from '../src/chrome.mjs';
const temp=await mkdtemp('/private/tmp/gb-index-layout-'),chrome=new Chrome(findChrome(),temp);
const row=(i,long=false)=>`${long?'用于验证跨栏换行且包含较长中文关键词的索引条目':'测试词条'}${String(i).padStart(3,'0')} {sort-key="${String(i).padStart(3,'0')}"} | @sample，1`;
const wrap=(lang,body)=>`:::gb-index-section lang=${lang}\n\n${body}\n\n:::`;
const group=(letter,rows)=>`:::gb-index ${letter}\n${rows.join('\n')}\n:::`;
const doc=body=>`# 索引校准\n\n## 范围\n\n正文。\n\n## 术语和定义\n\n:::gb-term id=sample\n测试术语\nsample\n\n定义。\n:::\n\n## 索引 {role=index}\n\n${body}`;
try {
 await chrome.start();
 for(const [name,count] of [['short',12],['long',150],['legacy',14]]) {
  const rows=Array.from({length:count},(_,i)=>row(i,i%13===0));
  const source=name==='legacy'?doc(group('A',rows)):doc(wrap('zh',group('A',rows.slice(0,count/2))+'\n\n'+group('B',rows.slice(count/2)))+'\n\n'+wrap('en',group('S',['sample term | @sample','sample '+ 'veryLongUnbrokenEnglishKeyword'.repeat(12)+' | @sample'])));
  const result=await render(source,{type:'gb',gbCover:false,toc:false,pagedHtml:true});
  await writeFile(temp+'/'+name+'.html',result.pagedHtml);
  await writeFile(temp+'/'+name+'.pdf',await chrome.print(temp+'/'+name+'.html',{...result.printOptions,waitPaged:true}));
  const value=await chrome.send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const pages=[...document.querySelectorAll('.pagedjs_page')];return {error:window.__md2pdfPagedError,audit:window.__gbBodyAudit,entries:[...document.querySelectorAll('.pagedjs_pages .gb-index-entries>li')].map(e=>({text:e.textContent,term:e.querySelector('.gb-index-term')?.textContent,leader:(()=>{if(!e.closest('.gb-index-section'))return null;const r=document.createRange();r.selectNodeContents(e.querySelector('.gb-index-term'));const last=[...r.getClientRects()].at(-1);const line=e.querySelector('.gb-index-dots').getBoundingClientRect(),target=e.querySelector('.gb-index-locations').getBoundingClientRect();return {left:line.left,right:line.right,width:line.width,termEnd:last.right,target:target.left};})(),page:pages.indexOf(e.closest('.pagedjs_page')),termLeft:e.querySelector('.gb-index-term')?.getBoundingClientRect().left,listPadding:parseFloat(getComputedStyle(e.parentElement).paddingLeft),left:e.getBoundingClientRect().left,top:e.getBoundingClientRect().top,right:e.getBoundingClientRect().right,bottom:e.getBoundingClientRect().bottom})),letters:[...document.querySelectorAll('.pagedjs_pages .gb-index-letter')].map(e=>({text:e.textContent,term:e.querySelector('.gb-index-term')?.textContent,page:pages.indexOf(e.closest('.pagedjs_page')),left:e.getBoundingClientRect().left,top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom})),sections:[...document.querySelectorAll('.pagedjs_pages .gb-index-columns')].map(e=>({columns:getComputedStyle(e).columnCount,width:e.getBoundingClientRect().width,titleLeft:e.closest('.gb-index-section')?.querySelector('.gb-index-section-title')?.getBoundingClientRect().left,firstTermLeft:e.querySelector('.gb-index-term')?.getBoundingClientRect().left}))};})()`});
  assert.equal(value.exceptionDetails,undefined);const state=value.result.value;
  await writeFile('/private/tmp/gb-index-'+name+'-state.json',JSON.stringify(state,null,2));
  for(const section of state.sections.filter(s=>s.titleLeft!==undefined&&s.firstTermLeft!==undefined)) assert.ok(Math.abs(section.titleLeft-section.firstTermLeft)<1,'index section title aligns with first keyword');
  assert.ok(state.entries.every(e=>e.listPadding===0&&Math.abs(e.left-e.termLeft)<1),'index keywords have no body-list indentation');
  assert.ok(!state.error,JSON.stringify(state.error));
  assert.equal(state.audit.problems.length,0,JSON.stringify(state.audit.problems));
  for(let i=0;i<count;i++)assert.equal(state.entries.filter(e=>e.term.endsWith(String(i).padStart(3,'0'))).length,1,'each Chinese entry exactly once: '+i);
  for(const entry of state.entries.filter(e=>e.leader)) assert.ok(entry.leader.width<1||(entry.leader.left>=entry.leader.termEnd&&entry.leader.right<=entry.leader.target),'leader does not cross keyword or locations');
  assert.equal(state.entries.length,count+(name==='legacy'?0:2),'no entries lost or duplicated');
  const chinese=state.entries.filter(e=>e.term?.includes('词条')||e.term?.includes('索引条目'));
  for(let i=1;i<chinese.length;i++) {
    const previous=chinese[i-1],current=chinese[i];
    assert.ok(current.page>=previous.page,'reading order progresses through pages');
    if(current.page===previous.page) assert.ok(current.left>previous.left+10 || (Math.abs(current.left-previous.left)<1&&current.top>=previous.bottom-.5),'down left column, then right');
  }
  for(const [letter,term] of (name==='legacy'?[['A','000']]:[['A','000'],['B',String(count/2).padStart(3,'0')],['S','sample term']])) {
    const heading=state.letters.find(e=>e.text===letter);
    const first=state.entries.find(e=>term==='sample term'?e.term===term:e.term?.endsWith(term));
    assert.ok(heading&&first&&heading.page===first.page&&Math.abs(heading.left-first.left)<1&&first.top>=heading.bottom-.5,'letter stays with first entry in same column: '+letter);
  }
  if(name==='legacy') { assert.equal(state.sections.length,0); assert.ok(state.entries.every(e=>Math.abs(e.left-state.entries[0].left)<1),'legacy Chinese index stays single-column'); }
  else assert.ok(state.sections.some(e=>e.columns==='2')&&state.sections.some(e=>e.columns==='1'));
  const repeated=await chrome.send('Runtime.evaluate',{expression:`(${finalizeGbIndexLayout.toString()})();JSON.stringify([...document.querySelectorAll('.pagedjs_pages .gb-index-entries>li')].map(e=>[e.getBoundingClientRect().left,e.getBoundingClientRect().top,e.getBoundingClientRect().bottom]))`,returnByValue:true});
  assert.equal(repeated.exceptionDetails,undefined);
  assert.deepEqual(JSON.parse(repeated.result.value),state.entries.map(e=>[e.left,e.top,e.bottom]),'finalizing leaders again does not move entries');
  const text=execFileSync('pdftotext',['-layout',temp+'/'+name+'.pdf','-'],{encoding:'utf8'});
  for(let i=0;i<count;i++)assert.ok(text.includes(String(i).padStart(3,'0')),'actual PDF entry '+i);
  if(name!=='legacy') {
    assert.ok(state.entries.at(-1).bottom-state.entries.at(-1).top>40,'long English keyword really wraps');
    for(const entry of state.entries.slice(-2))assert.ok(text.replace(/\s+/g,'').includes(entry.term.replace(/\s+/g,'')),'actual PDF contains complete English keyword');
  }
  await writeFile('/private/tmp/gb-index-'+name+'-state.json',JSON.stringify(state,null,2));
  console.log(name+': all '+count+' Chinese and '+(name==='legacy'?0:2)+' English entries appear once in actual PDF');
 }
 const oversized=await render(doc(wrap('zh',group('A',['超长关键词'.repeat(1500)+' | @sample']))),{type:'gb',gbCover:false,toc:false,pagedHtml:true});
 await writeFile(temp+'/oversize.html',oversized.pagedHtml);
 await assert.rejects(chrome.print(temp+'/oversize.html',{...oversized.printOptions,waitPaged:true}),e=>e.message.includes('索引单条超过单页'));
 console.log('oversized index entry: explicit rejection verified');
}finally{await chrome.stop();await rm(temp,{recursive:true,force:true});}
