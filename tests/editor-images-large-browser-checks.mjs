import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createApp } from '../src/server.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';
const app=createApp({lanHost:''}); const temp=await mkdtemp('/tmp/image-full-'); const browser=new Chrome(findChrome(),temp);
const ev=async expression=>{const x=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(x.exceptionDetails,undefined,JSON.stringify(x.exceptionDetails));return x.result.value};
try { await new Promise(r=>app.server.listen(0,'127.0.0.1',r)); await browser.start(); await browser.send('Runtime.enable'); await browser.send('Emulation.setDeviceMetricsOverride',{width:1200,height:800,deviceScaleFactor:1,mobile:false}); await browser.send('Page.navigate',{url:'http://127.0.0.1:'+app.server.address().port});
for(let i=0;i<240;i++){try{if(await ev('!!window.mdEditor'))break}catch{} await new Promise(r=>setTimeout(r,50));}
await ev(`(async()=>{window.original=Array.from({length:160},(_,i)=>'正文 '+i).join('\\n');window.anchor=original.indexOf('正文 80');mdEditor.setValue(original);mdEditor.setSelection(anchor);mdEditor.focus(); const c=document.createElement('canvas');c.width=c.height=310;const ctx=c.getContext('2d');const p=ctx.createImageData(310,310);for(let i=0;i<p.data.length;i+=65536)crypto.getRandomValues(p.data.subarray(i,Math.min(i+65536,p.data.length)));ctx.putImageData(p,0,0);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const d=new DataTransfer();d.items.add(new File([blob],'large.png',{type:'image/png'}));const picker=document.querySelector('.md-image-picker');picker.files=d.files;picker.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await ev(`new Promise((resolve,reject)=>{let end=Date.now()+10000;function check(){if(mdEditor.getValue().includes('{#fig:image-1}'))requestAnimationFrame(()=>requestAnimationFrame(resolve));else if(Date.now()>end)reject(Error('timeout'));else setTimeout(check,20)}check()})`);
const snap=()=>ev(`(()=>{let s=document.querySelector('.cm-scroller'),b=document.querySelector('.md-image-fold'),l=b?.closest('.cm-line'),lines=[...document.querySelectorAll('.cm-line')],rect=e=>{if(!e)return null;let r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,text:e.textContent.slice(0,35)}};return {length:mdEditor.getValue().length,scrollTop:s.scrollTop,scrollHeight:s.scrollHeight,clientHeight:s.clientHeight,scroller:rect(s),line:rect(l),button:rect(b),before:rect(lines.find(x=>x.textContent==='正文 79')),after:rect(lines.find(x=>x.textContent==='正文 80')),cursor:(()=>{const view=MDEditorVendor.EditorView.findFromDOM(document.querySelector('.cm-editor'));return view.coordsAtPos(view.state.selection.main.head)})(),selection:mdEditor.getSelection()}})()`);
const inserted=await snap();
assert.ok(inserted.length>500000 && inserted.length<550000, 'valid PNG has about 500k data characters');
assert.ok(inserted.line.height<30, JSON.stringify(inserted));
assert.ok(inserted.before && inserted.after, 'both adjacent paragraphs rendered');
assert.ok(Math.abs(inserted.line.top-inserted.before.bottom-23.4)<2, 'normal preceding paragraph gap');
assert.ok(Math.abs(inserted.after.top-inserted.line.bottom-23.4)<2, 'normal following paragraph gap');
assert.ok(inserted.cursor && inserted.cursor.top>=inserted.scroller.top && inserted.cursor.bottom<=inserted.scroller.bottom+1, 'caret remains visible');
assert.equal(await ev(`mdEditor.getValue().startsWith(original.slice(0,anchor)) && mdEditor.getValue().endsWith(original.slice(anchor)) && mdEditor.getValue().includes('data:image/png;base64,')`),true);
console.log('INSERT',JSON.stringify(inserted));
await ev(`document.querySelector('.md-image-fold').click();new Promise(r=>setTimeout(r,1000))`);const expanded=await snap(); assert.ok(expanded.line.height>inserted.line.height+100); assert.equal(await ev(`document.querySelector('.md-image-fold-thumbnail').naturalWidth`),310); console.log('EXPAND',JSON.stringify(expanded));
await ev(`document.querySelector('.md-image-fold').click();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);const collapsed=await snap();assert.ok(collapsed.line.height<30);console.log('COLLAPSE',JSON.stringify(collapsed));
await ev(`window.foldScanCount=0; window.originalFindFoldRanges=mdEditorImageHelpers.findFoldRanges; mdEditorImageHelpers.findFoldRanges=function(...args){window.foldScanCount++;return window.originalFindFoldRanges(...args)}; mdEditor.goToLine(1);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
assert.equal(await ev(`document.querySelector('.md-image-fold') === null`), true, 'image is outside the viewport');
await ev(`mdEditor.setSelection(anchor - 4, anchor - 1); mdEditor.goToLine(84);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
const returned = await snap();
assert.ok(returned.line && returned.line.height < 30, 'image remains folded after scrolling back');
assert.ok(returned.before && returned.after && Math.abs(returned.line.top-returned.before.bottom-23.4)<2 && Math.abs(returned.after.top-returned.line.bottom-23.4)<2, 'paragraph spacing survives scrolling');
await ev(`mdEditor.setSelection(mdEditor.getValue().indexOf('正文 80'), mdEditor.getValue().indexOf('正文 80') + 4);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
assert.ok((await snap()).line.height < 30, 'image remains folded after selecting following text');
assert.equal(await ev('window.foldScanCount'), 0, 'selection and scrolling reuse document decorations');
await ev(`mdEditor.runCommand('undo');new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
assert.equal(await ev('mdEditor.getValue()===original'),true,'undo preserves original text');
// Simulate a parser advancing without changing the document. The fallback initially
// sees an image-shaped URL inside an HTML comment; the completed tree rejects it.
const parsing = await ev(`(async()=>{
  const view=MDEditorVendor.EditorView.findFromDOM(document.querySelector('.cm-editor'));
  const languageState=MDEditorVendor.markdownLanguage.constructor.state;
  const originalUpdate=languageState.updateF;
  const url='data:image/png;base64,'+'A'.repeat(1000);
  mdEditor.setValue('<!-- ![x]('+url+') -->');
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const doc=view.state.doc, parsed=MDEditorVendor.syntaxTree(view.state);
  try {
    languageState.updateF=value=>Object.assign(Object.create(Object.getPrototypeOf(value)),value,{tree:MDEditorVendor.markdownLanguage.parser.parse('')});
    view.dispatch({selection:{anchor:1}});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const before=document.querySelectorAll('.md-image-fold').length;
    languageState.updateF=value=>Object.assign(Object.create(Object.getPrototypeOf(value)),value,{tree:parsed});
    view.dispatch({selection:{anchor:2}});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {before,after:document.querySelectorAll('.md-image-fold').length,sameDoc:doc===view.state.doc};
  } finally { languageState.updateF=originalUpdate; }
})()`);
assert.deepEqual(parsing,{before:1,after:0,sameDoc:true},'parser progress updates decorations without a document edit');

}finally{await browser.stop();app.server.close();await rm(temp,{recursive:true,force:true})}
