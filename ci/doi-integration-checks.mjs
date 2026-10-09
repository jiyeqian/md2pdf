import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';
import {render} from '../src/render.mjs';
async function fixture(t, doiResolver) {
  const app=createApp({doiResolver});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const url='http://127.0.0.1:'+app.server.address().port;
  const post=(body,headers={})=>fetch(url+'/api/doi',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  return {post,url};
}

test('DOI endpoint resolves only explicit valid requests and preserves errors',async t=>{
 let calls=0;
 const {post,url}=await fixture(t,async doi=>{calls++;if(doi==='missing')throw Object.assign(new Error('DOI 未找到'),{status:404});return {doi,bibtex:'@article{test,title={Test},year={2026}}',warnings:[],source:'crossref'};});
 const result=await post({doi:'10.1234/test'});assert.equal(result.status,200);assert.equal((await result.json()).doi,'10.1234/test');
 assert.equal((await post({doi:3})).status,400);assert.equal((await post({doi:'10.1234/test',url:'http://localhost'})).status,400);
 assert.equal((await post({doi:'x'.repeat(5000)})).status,413);
 assert.equal((await post({doi:'10.1234/test'},{Origin:'https://evil.example'})).status,403);
 assert.equal((await fetch(url+'/api/doi')).status,405);
 const missing=await post({doi:'missing'});assert.equal(missing.status,404);assert.equal((await missing.json()).error,'DOI 未找到');assert.equal(calls,2);
});

test('DOI query concurrency is bounded without blocking ordinary pages',async t=>{
 const releases=[];const {post,url}=await fixture(t,()=>new Promise(resolve=>releases.push(resolve)));
 const pending=Array.from({length:4},()=>post({doi:'10.1234/test'}));
 for(let i=0;i<50&&releases.length<4;i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(releases.length,4);
 assert.equal((await post({doi:'10.1234/fifth'})).status,429);
 assert.equal((await fetch(url+'/')).status,200);
 for(const release of releases)release({doi:'10.1234/test',bibtex:'test',warnings:[],source:'crossref'});
 for(const response of await Promise.all(pending))assert.equal(response.status,200);
});

for(const type of ['article','inproceedings','book'])test(type+' retains DOI in GB bibliography and both reference directions',async()=>{
 const md='# 引用测试\n\n正文[^ref]。\n\n[^ref]: @'+type+'{ref,\n    author={Smith, John},\n    title={Test title},\n    year={2026},\n    journal={Journal},\n    booktitle={Conference},\n    publisher={Publisher},\n    doi={10.1234/test}\n    }';
 const result=await render(md,{pagedHtml:true}, {webSafe:true});
 assert.match(result.html,/DOI: 10\.1234\/test/);assert.match(result.pagedHtml,/DOI: 10\.1234\/test/);
 assert.match(result.html,/href="#fn-1"/);assert.match(result.html,/href="#fnref-1"/);assert.doesNotMatch(result.html,/\. , 2026/);
});
test('generated BibTeX punctuation and organization names survive GB formatting',async()=>{
 const md='正文[^ref]\n\n[^ref]: @article{k,\n    author={{Research Group}},\n    title={A\\_B \\& C},\n    year={2026},\n    journal={Journal},\n    doi={10.1234/a\\_b}\n    }';
 const result=await render(md,{}, {webSafe:true});
 assert.match(result.html,/Research Group/);
 assert.match(result.html,/A_B &amp; C/);
 assert.match(result.html,/DOI: 10\.1234\/a_b/);
});
