import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {Chrome} from '../src/chrome.mjs';
import {createApp} from '../src/server.mjs';
class InspectionChrome extends Chrome {
 async printHtml(...args) {
  const pdf=await super.printHtml(...args);
 this.inspection=await this.send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
 const pages=document.querySelector('.pagedjs_pages');
 const labels=[...pages.querySelectorAll('[data-gb-note-weight="normal"] .gb-label')];
 return {
 pages:pages.querySelectorAll('.pagedjs_page').length,
 normal:labels.length,
 normalFont:labels[0] && getComputedStyle(labels[0]).fontFamily,
 bodyFont:getComputedStyle(pages.querySelector('.gb-note-text')).fontFamily,
 orphan:[...pages.querySelectorAll('[data-gb-note-scope]')].filter(n=>!n.closest(n.dataset.gbNoteScope)).length,
 topAlignment:[...pages.querySelectorAll('[data-gb-note-position="top"] > p')].map(n=>getComputedStyle(n).textAlign),
 units:pages.querySelectorAll('caption .gb-table-top').length,
 sources:[...pages.querySelectorAll('.gb-note')].filter(n=>n.textContent.includes('[来源：')).length,
 records:[...pages.querySelectorAll('td')].map(n=>n.textContent.trim()).filter(s=>/^R\\d{3}$/.test(s)),
 fontWarning:window.__md2pdfFontError || null
 };
})()`});

  return pdf;
 }
}
let browser;
const app=createApp({chromeFactory:(binary,dir)=>(browser=new InspectionChrome(binary,dir,{incognito:true}))});
try {
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+app.server.address().port;
 const md=await readFile(new URL('../web/examples/gb.md',import.meta.url),'utf8');
 const response=await fetch(url+'/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({md,opts:{type:'gb'},allowFontFallback:true})});
 if (!response.ok) throw new Error('PDF HTTP '+response.status+': '+(await response.text()).slice(0,200));
 assert.equal(response.status,200);
 const pdf=Buffer.from(await response.arrayBuffer());
 assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
 await mkdir('output/pdf',{recursive:true});
 await writeFile('output/pdf/gb-directives-node-fallback.pdf',pdf);
 const result=browser.inspection.result.value;
 assert.ok(result.pages>1);
 assert.ok(result.normal>=2);
 assert.equal(result.normalFont,result.bodyFont);
 assert.equal(result.orphan,0);
 assert.ok(result.units>=2);
 assert.ok(result.topAlignment.length>=2 && result.topAlignment.every(a=>a==='right'),'top-right notes keep paragraph alignment');
 assert.ok(result.sources>=1);
 assert.equal(result.records.length,40);
 assert.equal(new Set(result.records).size,40);
 console.log(JSON.stringify(result,null,2));
 console.log('Node PDF written to output/pdf/gb-directives-node-fallback.pdf; ' + (result.fontWarning ? 'fallback-font geometry is not standards-font acceptance.' : 'all required fonts loaded; precise layout acceptance is checked separately.'));
} finally {await app.close();}
