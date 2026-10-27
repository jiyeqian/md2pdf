import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { render } from '../src/render.mjs';
import { Chrome, findChrome } from '../src/chrome.mjs';
const out='/tmp/md2pdf-pagination-acceptance';
await mkdir(out,{recursive:true});
const temp=await mkdtemp(path.join(os.tmpdir(),'md2pdf-pagination-'));
const browser=new Chrome(findChrome(),temp);
const markdown='# Pagination fixture\n\n## Alpha\n\nShort first chapter.\n\n### Subheading\n\nStill first chapter.\n\n## Beta\n\n表：Long table\n\n| Header A | Header B |\n| --- | --- |\n'+Array.from({length:85},(_,i)=>`| ROW_${String(i).padStart(3,'0')} | Table content ${i} |`).join('\n')+'\n\n## Gamma\n\nEND_MARKER\n';
try{
 await browser.start();
 for(const mode of ['continuous','page','odd-page']){
  const md=`---\nchapter-start: ${mode}\nheader-left: Header\nfooter-right: Footer\n---\n`+markdown;
  await writeFile(path.join(out,mode+'.md'),md);
  const result=await render(md,{pagedHtml:true},{filename:'pagination.md'});
  const htmlFile=path.join(out,mode+'.html');
  await writeFile(htmlFile,result.html);
  const pdf=await browser.print(htmlFile,{...result.printOptions,waitPaged:true});
  await writeFile(path.join(out,mode+'.pdf'),pdf);
  const response=await browser.send('Runtime.evaluate',{expression:`JSON.stringify(Array.from(document.querySelectorAll('.pagedjs_page'),(p,i)=>({number:i+1,blank:p.classList.contains('pagedjs_blank_page'),headings:Array.from(p.querySelectorAll('h2[data-chapter]'),h=>h.textContent),tables:Array.from(p.querySelectorAll('table'),t=>({head:t.tHead?.textContent,rows:Array.from(t.querySelectorAll('tbody tr'),r=>r.textContent),caption:t.caption?.textContent})),margins:Array.from(p.querySelectorAll('.pagedjs_margin-content'),e=>[e.textContent,getComputedStyle(e,'::after').content]),height:p.querySelector('.pagedjs_page_content')?.getBoundingClientRect().height})))`,returnByValue:true});
  const error=await browser.send('Runtime.evaluate',{expression:'window.__md2pdfPagedError',returnByValue:true});
  assert.equal(error.result.value,undefined);
  const pages=JSON.parse(response.result.value);
  await writeFile(path.join(out,mode+'.json'),JSON.stringify(pages,null,2));
  const starts=pages.filter(p=>p.headings.length).map(p=>p.number);
  assert.equal(pages.flatMap(p=>p.headings).length,3,JSON.stringify(pages));
  if(mode==='page')assert.equal(starts.length,3,'each chapter starts on its own page');
  if(mode==='odd-page'){
   assert.ok(starts.every(n=>n%2===1),'chapters start on physical odd pages: '+starts);
   assert.ok(pages.some(p=>p.blank),'parity creates blank pages');
   for(const p of pages.filter(p=>p.blank))assert.ok(p.margins.every(([text,css])=>!text&&['none','normal','""'].includes(css)),JSON.stringify(p));
  }
  const tables=pages.flatMap(p=>p.tables).filter(t=>t.rows.length);
  assert.ok(tables.length>1,'table spans pages');
  assert.ok(tables.every(t=>t.head?.includes('Header A')),JSON.stringify(tables));
  for(let i=0;i<85;i++)assert.equal(tables.flatMap(t=>t.rows).filter(row=>row.includes('ROW_'+String(i).padStart(3,'0'))).length,1,'row '+i+' appears once');
  console.log(mode+': '+pages.length+' pages, chapters '+starts+', repeated headers verified');
 }
 for(const mode of ['page','odd-page']){
  const result=await render('## First\n\nBody\n\n## Second\n\nBody',{chapterStart:mode,title:'',meta:false,colophonEnabled:false});
  const file=path.join(out,'titleless-'+mode+'.html');await writeFile(file,result.html);
  await browser.print(file,{...result.printOptions,waitPaged:true});
  const r=await browser.send('Runtime.evaluate',{expression:`Array.from(document.querySelectorAll('.pagedjs_page')).findIndex(p=>p.querySelector('h2[data-chapter]'))`,returnByValue:true});
  assert.equal(r.result.value,0,'first chapter at page start does not create a blank page');
 }
 const longText=Array.from({length:900},(_,i)=>'WORD_'+i+' long content').join(' ');
 const long=await render('# Long row\n\n| Header A | Header B |\n| --- | --- |\n| LONG_START | '+longText+' LONG_END |\n| NEXT_ROW | End |');
 const longFile=path.join(out,'long-row.html');await writeFile(longFile,long.html);
 const longPdf=await browser.print(longFile,{...long.printOptions,waitPaged:true});await writeFile(path.join(out,'long-row.pdf'),longPdf);
 const r=await browser.send('Runtime.evaluate',{expression:`JSON.stringify({text:document.querySelector('.pagedjs_pages').textContent,pages:document.querySelectorAll('.pagedjs_page').length,headers:Array.from(document.querySelectorAll('.pagedjs_page table'),t=>!!t.tHead)})`,returnByValue:true});
 const longResult=JSON.parse(r.result.value);
 assert.ok(longResult.pages>1&&longResult.headers.every(Boolean),'oversized row splits with headers: '+JSON.stringify({...longResult,text:longResult.text.slice(-150)}));
 assert.ok(longResult.text.includes('LONG_END')&&longResult.text.includes('NEXT_ROW'),'oversized row preserves end and following row');
 for(let i=0;i<900;i++)assert.equal((longResult.text.match(new RegExp('WORD_'+i+'(?=\\s)','g'))||[]).length,1,'long-row word '+i);
 console.log('titleless chapters and oversized row verified');
 const gb=await render('# Standard\n\n## First\n\nBody\n\n## Second\n\nBody',{type:'gb',chapterStart:'odd-page'});
 const gbFile=path.join(out,'gb-odd.html');await writeFile(gbFile,gb.html);
 await browser.print(gbFile,{...gb.printOptions,waitPaged:true});
 const gbState=await browser.send('Runtime.evaluate',{expression:`JSON.stringify({starts:Array.from(document.querySelectorAll('.pagedjs_page')).flatMap((p,i)=>p.querySelector('h2[data-chapter]')?[i+1]:[]),blank:Array.from(document.querySelectorAll('.pagedjs_blank_page .pagedjs_margin-content')).every(e=>getComputedStyle(e).visibility==='hidden')})`,returnByValue:true});
 const gbResult=JSON.parse(gbState.result.value);assert.ok(gbResult.starts.length===2&&gbResult.starts.every(n=>n%2===1),JSON.stringify(gbResult));assert.equal(gbResult.blank,true);
 console.log('GB named pages retain physical odd-page starts and blank margin boxes');
 if(process.argv[2]){
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await browser.send('Page.navigate',{url:process.argv[2]});
  async function evaluate(expression,sessionId){
   let result;
   if(!sessionId)result=await browser.send('Runtime.evaluate',{expression,returnByValue:true});
   else {
    const id=++browser.id;
    result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('iframe evaluate timeout')),10000);browser.pending.set(id,{resolve:m=>{clearTimeout(timer);m.error?reject(new Error(m.error.message)):resolve(m.result)},reject});browser.ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true},sessionId}));});
   }
   assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));return result.result.value;
  }
  async function wait(expression,sessionId){for(let n=0;n<300;n++){if(await evaluate('Boolean('+expression+')',sessionId))return;await new Promise(r=>setTimeout(r,100));}throw new Error('timeout: '+expression);}
  await wait('window.mdEditor');
  await evaluate(`mdEditor.setValue(${JSON.stringify('---\nchapter-start: odd-page\n---\n'+markdown)})`);
  await wait(`window.__MD2PDF_PREVIEW_READY__===true&&document.querySelector('#preview').srcdoc.includes('ROW_084')&&document.querySelector('#status').textContent.includes('预览已更新')`);
  let sessionId;
  for(const target of (await browser.send('Target.getTargets')).targetInfos.filter(t=>t.type==='iframe')){
   const session=await browser.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
   if(await evaluate(`typeof window.__md2pdfPreviewSnapshot==='function'`,session.sessionId)){sessionId=session.sessionId;break;}
   await browser.send('Target.detachFromTarget',{sessionId:session.sessionId});
  }
  assert.ok(sessionId,'preview frame');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.pagedjs_page')).every((p,i)=>!p.querySelector('h2[data-chapter]')||(i+1)%2===1)`,sessionId),true);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.pagedjs_page table')).every(t=>!!t.tHead)`,sessionId),true);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.pagedjs_blank_page .pagedjs_margin-content')).every(e=>!e.textContent)`,sessionId),true);
  await evaluate(`document.querySelector('[data-preview-mode-toggle]').click()`);
  await wait(`document.documentElement.classList.contains('md2pdf-preview-flow')`,sessionId);
  assert.deepEqual(await evaluate(`(()=>{const flow=document.querySelector('#md2pdf-preview-flow');return [flow.querySelectorAll('table').length,flow.querySelectorAll('thead').length,flow.querySelectorAll('h2[data-chapter]').length]})()`,sessionId),[1,1,3]);
  console.log(process.argv[2]+': actual WebApp odd chapters, repeated headers, blank-page footer and flow isolation verified');
 }
}finally{await browser.stop();await rm(temp,{recursive:true,force:true});}
