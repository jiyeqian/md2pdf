import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {Chrome,findChrome} from '../src/chrome.mjs';
import {createApp} from '../src/server.mjs';
const temp=await mkdtemp('/private/tmp/gb-completion-'),chrome=new Chrome(findChrome(),temp),app=createApp();
try {
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 await chrome.start();
 await chrome.send('Page.navigate',{url:'http://127.0.0.1:'+app.server.address().port+'/'});
 const evaluate=async expression=>{const r=await chrome.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(r.exceptionDetails,undefined,JSON.stringify(r.exceptionDetails));return r.result.value;};
 for(let i=0;i<100&&!await evaluate('!!window.mdEditor');i++)await new Promise(r=>setTimeout(r,100));
 assert.ok(await evaluate('!!window.mdEditor'));
 await evaluate(`(async()=>{window.gbAnalysis=await import('/editor-analysis.mjs');window.gbView=MDEditorVendor.EditorView.findFromDOM(document.querySelector('.cm-editor'));})()`);
 for(const type of ['gb','general']) {
  await evaluate(`mdEditor.setValue(':::gb-no');gbView.dispatch({selection:{anchor:8}});mdEditor.setCompletions(c=>gbAnalysis.provideCompletions({...c,templateType:${JSON.stringify(type)}},gbAnalysis.analyzeMarkdown(c.text)));MDEditorVendor.startCompletion(gbView);`);
  await new Promise(r=>setTimeout(r,150));
  const menu=await evaluate(`document.querySelector('.cm-tooltip-autocomplete')?.textContent||''`);
  if(type==='gb') {
   assert.ok(menu.includes('gb-note'),'GB completion menu is visible');
   assert.ok(await evaluate("MDEditorVendor.completionKeymap.find(k=>k.key==='Enter').run(gbView)"));
   assert.equal(await evaluate('mdEditor.getValue()'),':::gb-note\n注的内容\n:::');
  }else assert.equal(menu,'','other templates do not show GB suggestions');
 }
 await evaluate(`mdEditor.setValue(':::gb-ex');gbView.dispatch({selection:{anchor:8}});mdEditor.setCompletions(c=>gbAnalysis.provideCompletions({...c,templateType:'gb'},gbAnalysis.analyzeMarkdown(c.text)));MDEditorVendor.startCompletion(gbView);`);
 await new Promise(r=>setTimeout(r,150));
 const examples=await evaluate(`document.querySelector('.cm-tooltip-autocomplete')?.textContent||''`);
 assert.ok(examples.includes('标签独立')&&examples.includes('标签同行'),'both example layouts are available');
 for(const [type,count] of [['gb',10],['general',5]]) {
  await evaluate(`mdEditor.setValue(':::');gbView.dispatch({selection:{anchor:3}});mdEditor.setCompletions(c=>gbAnalysis.provideCompletions({...c,templateType:'gb'},gbAnalysis.analyzeMarkdown(c.text)));document.dispatchEvent(new CustomEvent('md-document-type',{detail:{type:${JSON.stringify(type)}}}));MDEditorVendor.startCompletion(gbView);`);
  await new Promise(r=>setTimeout(r,150));
  assert.equal(await evaluate(`document.querySelectorAll('.cm-tooltip-autocomplete li[role="option"]').length`),count,type+' completion count');
 }
 await evaluate(`mdEditor.setValue(':::gb-index');gbView.dispatch({selection:{anchor:11}});mdEditor.setCompletions(c=>gbAnalysis.provideCompletions({...c,templateType:'gb'},gbAnalysis.analyzeMarkdown(c.text)));MDEditorVendor.startCompletion(gbView);`);
 await new Promise(r=>setTimeout(r,150));
 const indexMenu=await evaluate(`document.querySelector('.cm-tooltip-autocomplete')?.textContent||''`);
 assert.ok(indexMenu.includes('中文索引分区')&&indexMenu.includes('英文索引分区'));
 assert.ok(await evaluate("MDEditorVendor.completionKeymap.find(k=>k.key==='Enter').run(gbView)"));
 assert.match(await evaluate('mdEditor.getValue()'),/^:::gb-index-section lang=zh\n:::gb-index[\s\S]*:::\n:::$/);
 const indexSource='## 范围 {#sec:scope}\n\n图：流程 {#fig:flow}\n\n表：数据 {#tab:data}\n\n:::gb-term id=grasp\n抓取\ngrasp\n\n定义\n:::\n\n:::gb-index\n词条 | ';
 for(const type of ['gb','paper']) {
  await evaluate(`mdEditor.setValue(${JSON.stringify(indexSource)});gbView.dispatch({selection:{anchor:gbView.state.doc.length}});mdEditor.setCompletions(c=>gbAnalysis.provideCompletions({...c,templateType:${JSON.stringify(type)}},gbAnalysis.analyzeMarkdown(c.text,{templateType:${JSON.stringify(type)}})));gbView.focus();gbView.dispatch({changes:{from:gbView.state.doc.length,insert:'@'},selection:{anchor:gbView.state.doc.length+1},userEvent:'input.type'});`);
  await new Promise(r=>setTimeout(r,500));
  const menu=await evaluate(`document.querySelector('.cm-tooltip-autocomplete')?.textContent||''`);
  if(type==='gb') {
   for(const id of ['@sec:scope','@fig:flow','@tab:data','@grasp'])assert.ok(menu.includes(id),'automatic @ completion '+id);
   assert.ok(await evaluate("MDEditorVendor.completionKeymap.find(k=>k.key==='Enter').run(gbView)"));
   assert.ok((await evaluate('mdEditor.getValue()')).endsWith('@sec:scope'),'inserts one @ and stable id');
  }else assert.equal(menu,'','paper does not activate index @ completion');
 }
 for(const [input,wanted] of [[':::gb-note scope=table layout=','layout=boxed'],[':::gb-note scope=figure label','label="^a^"']]) {
  await evaluate(`mdEditor.setValue(${JSON.stringify(input)});gbView.dispatch({selection:{anchor:gbView.state.doc.length}});mdEditor.setCompletions(c=>gbAnalysis.provideCompletions({...c,templateType:'gb'},gbAnalysis.analyzeMarkdown(c.text,{templateType:'gb'})));MDEditorVendor.startCompletion(gbView);`);
  await new Promise(r=>setTimeout(r,150));
  assert.ok((await evaluate(`document.querySelector('.cm-tooltip-autocomplete')?.textContent||''`)).includes(wanted),'note parameter completion '+wanted);
 }
 console.log('PASS: real editor GB completion menu, insertion, automatic @ targets and template isolation');
}finally{await chrome.stop();await app.close();await rm(temp,{recursive:true,force:true});}
