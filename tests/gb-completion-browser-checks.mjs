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
 console.log('PASS: real editor GB completion menu, insertion and template isolation');
}finally{await chrome.stop();await app.close();await rm(temp,{recursive:true,force:true});}
