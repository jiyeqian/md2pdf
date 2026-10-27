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
  if(mode==='page'){assert.equal(starts.length,3,'subsequent chapters start separately');assert.equal(starts[0],1,'title and first chapter share the first page');}
  if(mode==='odd-page'){
   assert.equal(starts[0],1,'compact title and first chapter share odd page one');
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
  const shortTable='表：Short table\n\n| 指标 | 目标值 | 实测值 |\n| --- | --- | --- |\n| 抓取成功率 | ≥ 98% | 98.6% |\n| 响应延迟 | ≤ 12ms | 10.4ms |';
  const md=`---\nchapter-start: ${mode}\n---\n# Regression fixture\n\n## Short\n\n${shortTable}\n\n## Long\n\n表：Long table\n\n| 指标 | 目标值 | 实测值 |\n| --- | --- | --- |\n`+Array.from({length:75},(_,i)=>`| ROW_${i} | 98% | 98.6% |`).join('\n')+'\n\n## Summary\n\nSee reference[^one].\n\n[^one]: Reference item.';
  await writeFile(path.join(out,'regression-'+mode+'.md'),md);
  const result=await render(md,{pagedHtml:true});
  const file=path.join(out,'regression-'+mode+'.html');await writeFile(file,result.html);
  const pdf=await browser.print(file,{...result.printOptions,waitPaged:true});await writeFile(path.join(out,'regression-'+mode+'.pdf'),pdf);
  const r=await browser.send('Runtime.evaluate',{expression:`JSON.stringify(Array.from(document.querySelectorAll('.pagedjs_page'),(p,i)=>({page:i+1,headings:Array.from(p.querySelectorAll('h2[data-chapter]'),h=>h.textContent),tables:Array.from(p.querySelectorAll('table'),t=>({heads:t.querySelectorAll('thead').length,headerRows:t.tHead?.rows.length,headerText:t.tHead?.textContent}))})))`,returnByValue:true});
  const pages=JSON.parse(r.result.value),chapters=pages.filter(p=>p.headings.length);
  assert.equal(chapters.length,4,'summary and generated bibliography each start a separate page');
  assert.ok(chapters.every(p=>p.headings.length===1),'one chapter start per page');
  assert.ok(chapters.at(-1).headings[0].includes('参考文献'),'bibliography is a chapter');
  if(mode==='odd-page')assert.ok(chapters.every(p=>p.page%2===1),'bibliography follows odd-page policy');
  for(const t of pages.flatMap(p=>p.tables)){
   assert.equal(t.heads,1,'exactly one thead per table fragment');
   assert.equal(t.headerRows,1,'original and continuation have one header row');
   assert.equal(t.headerText.split('指标').length-1,1,'caption must not trigger an early duplicate header');
  }
  console.log(mode+': captioned short/long tables have one header, generated bibliography starts separately');
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
 const manualMarkdown='# Manual pagination\n\n## First\n\nBEFORE_BREAK\n\n<!-- pagebreak -->\n\n<!-- pagebreak -->\n\nAFTER_BREAK\n\n```php-template\n<!-- pagebreak -->\n```\n\nInline `<!-- pagebreak -->` example.\n\nEND_MANUAL\n\n<!-- pagebreak -->';
 for(const webSafe of [false,true]){
  const manual=await render(manualMarkdown,{pagedHtml:true},{webSafe});
  const file=path.join(out,'manual-'+(webSafe?'web':'cli')+'.html');
  // CLI file loading supplies local assets; web-safe rendering is exercised through the WebApp below.
  await writeFile(file,manual.html);
  const pdf=await browser.print(file,{...manual.printOptions,waitPaged:true});await writeFile(path.join(out,'manual-'+(webSafe?'web':'cli')+'.pdf'),pdf);
  const r=await browser.send('Runtime.evaluate',{expression:`JSON.stringify(Array.from(document.querySelectorAll('.pagedjs_page'),p=>p.querySelector('.pagedjs_page_content').textContent))`,returnByValue:true});
  const pages=JSON.parse(r.result.value);
  assert.equal(pages.length,2,'consecutive/trailing breaks and code examples do not create extra pages');
  assert.ok(pages[0].includes('BEFORE_BREAK')&&!pages[0].includes('AFTER_BREAK'),'break ends first page');
  assert.ok(pages[1].includes('AFTER_BREAK')&&pages[1].includes('END_MANUAL'),'next content starts on second page');
  assert.equal(pages.join('').split('<!-- pagebreak -->').length-1,2,'fenced and inline examples remain literal');
 }
 await writeFile(path.join(out,'manual.md'),manualMarkdown);
 const explicit=await render('# Title\n\n<!-- pagebreak -->\n\n## First\n\nBody',{chapterStart:'page'});
 const explicitFile=path.join(out,'manual-first.html');await writeFile(explicitFile,explicit.html);
 await browser.print(explicitFile,{...explicit.printOptions,waitPaged:true});
 const explicitPage=await browser.send('Runtime.evaluate',{expression:`Array.from(document.querySelectorAll('.pagedjs_page')).findIndex(p=>p.querySelector('h2[data-chapter]'))+1`,returnByValue:true});
 assert.equal(explicitPage.result.value,2,'explicit break overrides title/first-chapter sharing');
 for(const mode of ['page','odd-page']){
  const result=await render('# Title\n\n## First\n\nBody\n\n<!-- pagebreak -->\n\n## Second\n\nBody',{chapterStart:mode});
  const file=path.join(out,'manual-chapter-'+mode+'.html');await writeFile(file,result.html);
  await browser.print(file,{...result.printOptions,waitPaged:true});
  const r=await browser.send('Runtime.evaluate',{expression:`Array.from(document.querySelectorAll('.pagedjs_page')).flatMap((p,i)=>p.querySelector('h2[data-chapter]')?[i+1]:[])`,returnByValue:true});
  assert.deepEqual(r.result.value,mode==='page'?[1,2]:[1,3],'manual breaks preserve chapter parity');
 }
 console.log('manual pagebreak, consecutive/trailing markers, code examples and explicit first-chapter override verified');
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
  const uiMarkdown=markdown.replace('Short first chapter.','Short first chapter.\n\n表：Short table\n\n| 指标 | 目标值 |\n| --- | --- |\n| 抓取成功率 | 98% |').replace('Still first chapter.','Still first chapter.\n\n<!-- pagebreak -->\n\nMANUAL_WEB_MARKER')+'\n\nReference[^one].\n\n[^one]: Reference item.';
  await evaluate(`mdEditor.setValue(${JSON.stringify('---\nchapter-start: odd-page\n---\n'+uiMarkdown)})`);
  await wait(`window.__MD2PDF_PREVIEW_READY__===true&&document.querySelector('#preview').srcdoc.includes('ROW_084')&&document.querySelector('#status').textContent.includes('预览已更新')`);
  let sessionId;
  for(const target of (await browser.send('Target.getTargets')).targetInfos.filter(t=>t.type==='iframe')){
   const session=await browser.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
   if(await evaluate(`typeof window.__md2pdfPreviewSnapshot==='function'`,session.sessionId)){sessionId=session.sessionId;break;}
   await browser.send('Target.detachFromTarget',{sessionId:session.sessionId});
  }
  assert.ok(sessionId,'preview frame');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.pagedjs_page')).every((p,i)=>!p.querySelector('h2[data-chapter]')||(i+1)%2===1)`,sessionId),true);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.pagedjs_page table')).every(t=>t.querySelectorAll('thead').length===1&&t.tHead.rows.length===1)`,sessionId),true);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.pagedjs_blank_page .pagedjs_margin-content')).every(e=>!e.textContent)`,sessionId),true);
  assert.equal(await evaluate(`document.querySelector('.pagedjs_page').querySelectorAll('h2[data-chapter]').length`,sessionId),1,'title and first chapter share page one in the WebApp');
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.pagedjs_page')).findIndex(p=>p.querySelector('.pagedjs_page_content').textContent.includes('MANUAL_WEB_MARKER'))`,sessionId)>0,'manual marker forces the following content to a later page');
  await evaluate(`document.querySelector('[data-preview-mode-toggle]').click()`);
  await wait(`document.documentElement.classList.contains('md2pdf-preview-flow')`,sessionId);
  assert.deepEqual(await evaluate(`(()=>{const flow=document.querySelector('#md2pdf-preview-flow');return [flow.querySelectorAll('table').length,flow.querySelectorAll('thead').length,flow.querySelectorAll('h2[data-chapter]').length]})()`,sessionId),[2,2,4]);
  assert.equal(await evaluate(`document.querySelectorAll('#md2pdf-preview-flow .md2pdf-pagebreak').length`,sessionId),0,'flow has no marker blocks');
  console.log(process.argv[2]+': actual WebApp odd chapters, repeated headers, blank-page footer and flow isolation verified');
 }
}finally{await browser.stop();await rm(temp,{recursive:true,force:true});}
