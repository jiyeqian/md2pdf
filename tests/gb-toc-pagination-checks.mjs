import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Chrome,findChrome} from '../src/chrome.mjs';
import {render} from '../src/render.mjs';

const temp=await mkdtemp(path.join(os.tmpdir(),'gb-toc-pages-'));
const chrome=new Chrome(findChrome(),temp);
try {
  const fixture=await readFile(new URL('../web/examples/gb.md',import.meta.url),'utf8');
  const cases=[
    {name:'standard',md:fixture,opts:{}},
    {name:'no-cover',md:fixture,opts:{gbCover:false}},
    {name:'no-toc',md:fixture,opts:{toc:false}},
    {name:'no-cover-no-toc',md:fixture,opts:{gbCover:false,toc:false}},
    {name:'no-front',md:fixture.replace(/## 前言[\s\S]*?(?=## 范围)/,''),opts:{}},
    {name:'no-cover-no-front',md:fixture.replace(/## 前言[\s\S]*?(?=## 范围)/,''),opts:{gbCover:false}},
    {name:'long-toc',md:fixture.replace('## 标志和使用说明',Array.from({length:90},(_,i)=>`## 附加章节 ${i+1}\n\n内容 ${i+1}。\n\n`).join('')+'## 标志和使用说明'),opts:{}},
  ];
  await chrome.start();
  for(const item of cases){
    const rendered=await render(item.md,{type:'gb',pagedHtml:true,...item.opts},{webSafe:false});
    const htmlPath=path.join(temp,item.name+'.html'),pdfPath=path.join(temp,item.name+'.pdf');
    await writeFile(htmlPath,rendered.pagedHtml);
    const pdf=await chrome.print(htmlPath,{...rendered.printOptions,waitPaged:true});
    await writeFile(pdfPath,pdf);
    const result=await chrome.send('Runtime.evaluate',{returnByValue:true,expression:`[...document.querySelectorAll('.pagedjs_page')].map(p=>({number:Number(p.dataset.pageNumber),label:p.dataset.gbPage||null,blank:p.classList.contains('pagedjs_blank_page'),text:p.querySelector('.pagedjs_page_content')?.innerText.trim()||'',toc:!!p.querySelector('.toc'),front:!!p.querySelector('h2.front'),body:!!p.querySelector('h2.body-start')}))`});
    assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));
    const pages=result.result.value;
    const text=execFileSync('pdftotext',['-layout',pdfPath,'-'],{encoding:'utf8'}).split('\f');
    const toc=pages.filter(p=>p.toc),front=pages.filter(p=>p.front),body=pages.find(p=>p.body);
    for(const p of pages) {
      assert.ok(!p.label||p.text,`${item.name}: numbered blank page ${p.number}`);
      if(p.blank) assert.equal(p.label,null,`${item.name}: alignment blank page has a number`);
    }
    assert.ok(body&&body.number%2===1,`${item.name}: body begins on odd page`);
    assert.equal(body.label,'1',`${item.name}: body restarts at 1`);
    assert.ok(text[body.number-1].includes('范围'),`${item.name}: PDF body content`);
    if(front.length&&toc.length){
      assert.equal(front[0].number,toc.at(-1).number+1,`${item.name}: front follows last contents page`);
      assert.ok(text[front[0].number-1].replace(/\s+/g,'').includes('前言'),`${item.name}: PDF preface content`);
    }
    if(item.name==='standard') {
      assert.equal(toc[0].label,'I');
      assert.ok(toc[0].number%2===1,'contents begins on an odd physical page');
    }
    if(item.name==='long-toc') assert.ok(toc.length>1,'contents spans multiple pages');
    console.log(`${item.name}: ${pages.length} pages, PDF checked`);
  }
} finally {await chrome.stop();await rm(temp,{recursive:true,force:true});}
