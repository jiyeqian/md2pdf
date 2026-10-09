import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as helpers from '../web/editor-doi-helpers.mjs';
const source=(await readFile(new URL('../web/editor-doi.js',import.meta.url),'utf8')).replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']+';/,'');
const bib='@article{k,title={Title},year={2026},doi={10.1000/example}}';
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(fetchImpl){
 class Node {
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.events={};this.value='';this.hidden=false;this.disabled=false;this.isConnected=false;this.open=false;this.textContent='';}
  setAttribute(k,v){this.attrs[k]=v;if(k==='open')this.open=true;}
  getAttribute(k){return this.attrs[k]??null;}
  removeAttribute(k){delete this.attrs[k];if(k==='open')this.open=false;}
  appendChild(n){this.children.push(n);n.isConnected=true;return n;}
  addEventListener(k,fn){(this.events[k]??=[]).push(fn);}
  fire(k){for(const fn of this.events[k]||[])fn({preventDefault(){}});}
  focus(){} select(){} showModal(){this.open=true;} close(){this.open=false;this.fire('close');}
 }
 const body=new Node('body'),row=new Node('div');let markdown='正文';const changes=[];
 const editor={getValue:()=>markdown,getSelection:()=>({from:2,to:2}),replaceRanges:plan=>{changes.push(plan);markdown=helpers.applyChanges(markdown,plan);},setSelection(){},focus(){}};
 const doc={body,activeElement:new Node('button'),createElement:t=>new Node(t),querySelector:()=>row,events:{},addEventListener(k,fn){(this.events[k]??=[]).push(fn);}};
 const window={mdEditor:editor};const context=vm.createContext({window,document:doc,AbortController,fetch:fetchImpl,setTimeout,clearTimeout,Date,...helpers});
 vm.runInContext(source,context);
 const all=()=>{const out=[];function visit(n){out.push(n);n.children.forEach(visit);}visit(body);return out;};
 const byId=id=>all().find(n=>n.attrs.id===id);const button=text=>all().find(n=>n.tag==='button'&&n.textContent===text);
 const open=()=>{window.mdDoiCitation.open();byId('md-doi-input').value='10.1000/example';};
 const submit=()=>all().find(n=>n.tag==='form').fire('submit');
 return {open,submit,button,byId,all,row,changes,get markdown(){return markdown;},setMarkdown:value=>{markdown=value;},close:()=>window.mdDoiCitation.close()};
}
test('manual BibTeX controls are mounted inside the dialog',()=>{
 const f=fixture(()=>{throw Error('unexpected network');});f.open();
 assert.ok(f.byId('md-doi-manual-input'));f.byId('md-doi-manual-input').value=bib;
 f.button('插入手动 BibTeX').fire('click');assert.equal(f.changes.length,1);assert.match(f.markdown,/@article/);f.open();assert.equal(f.byId('md-doi-manual-input').value,'');
});
test('failed query can be retried and commits one transaction on success',async()=>{
 let count=0;const f=fixture(async()=>++count===1?{ok:false,status:404,json:async()=>({error:'未找到'})}:{ok:true,status:200,json:async()=>({doi:'10.1000/example',bibtex:bib,warnings:[]})});
 f.open();f.submit();assert.equal(f.all().find(n=>(n.className||'').includes('md-doi-loading')).hidden,false);await tick();assert.equal(f.markdown,'正文');
 f.button('重试解析').fire('click');await tick();assert.equal(count,2);assert.equal(f.changes.length,1);
});
test('closing aborts lookup and ignores a late response',async()=>{
 let release,signal;const f=fixture((_url,opts)=>{signal=opts.signal;return new Promise(r=>{release=r;});});
 f.open();f.submit();f.close();assert.equal(signal.aborted,true);
 release({ok:true,status:200,json:async()=>({bibtex:bib})});await tick();assert.equal(f.markdown,'正文');assert.equal(f.changes.length,0);
});
test('changed document retains result until explicit recapture',async()=>{
 let release;const f=fixture(()=>new Promise(r=>{release=r;}));f.open();f.submit();f.setMarkdown('已修改正文');
 release({ok:true,status:200,json:async()=>({bibtex:bib})});await tick();assert.equal(f.changes.length,0);
 assert.equal(f.button('重新定位并插入').hidden,false);f.button('重新定位并插入').fire('click');assert.equal(f.changes.length,1);assert.equal(f.markdown.split('\n')[0].replace(/\[\^[^\]]+\] /g,''),'已修改正文');
});
test('editing DOI to an invalid input cannot insert a previously requested DOI',async()=>{
 const f=fixture(async()=>({ok:false,status:404,json:async()=>({})}));f.open();f.submit();await tick();
 f.byId('md-doi-input').value='invalid';f.button('仅插入 DOI').fire('click');assert.equal(f.changes.length,0);
});
