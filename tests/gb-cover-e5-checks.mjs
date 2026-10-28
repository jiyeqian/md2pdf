import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Chrome, findChrome } from '../src/chrome.mjs';
import { render } from '../src/render.mjs';
import { createApp, webDocument } from '../src/server.mjs';
import { buildStatic } from '../src/static-build.mjs';

// Expectations are transcribed independently of the implementation. Measure PDF
// ink, not line boxes; retain both so a box-only pass cannot conceal glyph drift.
const out = '/private/tmp/md2pdf-gb-cover-e5';
const temp = await mkdtemp('/private/tmp/md2pdf-e5-');
const chrome = new Chrome(findChrome(), temp), app = createApp();
const nativeFetch = globalThis.fetch;
const ledger = JSON.parse(await readFile(new URL('./fixtures/gb-cover-e5.json', import.meta.url)));
const issuerSpacing = JSON.parse(await readFile(new URL('./fixtures/gb-issuer-spacing.json', import.meta.url)));
assert.equal(ledger.constraints.length,23,'all 23 source dimension arrows recorded');
assert.equal(new Set(ledger.constraints.map(c=>c.id)).size,23,'unique identities for repeated numeric labels');
const reports = [];
const rendererFilesSha256=Object.fromEntries(await Promise.all(['src/render.mjs','src/gb-layout.mjs','assets/themes/gb.css','assets/gb-logo.svg'].map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
const run = (cmd, args) => execFileSync(cmd, args, {encoding:'utf8', maxBuffer:16*1024*1024});
try {
  await mkdir(out, {recursive:true});
  const build = await buildStatic();
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    return url.protocol === 'file:' ? new Response(await readFile(url)) : nativeFetch(input, init);
  };
  const offline = await import(pathToFileURL(build.directory + '/runtime.mjs'));
  await new Promise((resolve, reject) => {app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const base = `http://127.0.0.1:${app.server.address().port}`;
  await chrome.start();
  for (const [name, source] of [['diagram', './fixtures/gb-cover-e5.md'], ['example', '../web/examples/gb.md']]) {
    const md = await readFile(new URL(source, import.meta.url),'utf8');
    await writeFile(`${out}/${name}.md`, md);
    const opts = {type:'gb'}, body = JSON.stringify({md,opts});
    const core = await render(md,{...opts,pagedHtml:true},{webSafe:true});
    if(name==='diagram')assert.ok(!core.html.split('class="cover-org-names"')[1].split('class="cover-org-pub"')[0].includes('国家标准化管理委员会'),'explicit single issuer must not acquire a default second issuer');
    const response = await nativeFetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body});
    assert.equal(response.status,200,await response.clone().text());
    await response.json();
    const node = {html:await webDocument(core.html)};
    const stat = await offline.renderDocument({md,opts},false);
    for (const [runtime,html] of [['cli',core.pagedHtml],['node',node.html],['static',stat.html]]) {
      const prefix = `${out}/${name}-${runtime}`;
      if(runtime==='cli') execFileSync(process.execPath,['src/md2pdf.mjs',`${out}/${name}.md`,'--html-only','--type','gb','--paged-html=','-o',prefix+'.html'],{stdio:'pipe'});
      else await writeFile(prefix+'.html',html);
      await writeFile(prefix+'-full.pdf',await (runtime==='cli' ? chrome.print(prefix+'.html',{...core.printOptions,waitPaged:true}) : chrome.printHtml(html,{...core.printOptions,webSafe:true,waitPaged:true})));
      await writeFile(prefix+'-locator.pdf',await readFile(prefix+'-full.pdf'));
      if(runtime==='cli')execFileSync(process.execPath,['src/md2pdf.mjs',`${out}/${name}.md`,'--type','gb','-o',prefix+'-full.pdf'],{stdio:'pipe'});
      if(runtime==='node'){const pdfResponse=await nativeFetch(base+'/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body});assert.equal(pdfResponse.status,200,await pdfResponse.clone().text());await writeFile(prefix+'-full.pdf',Buffer.from(await pdfResponse.arrayBuffer()));}
      const result = await chrome.send('Runtime.evaluate',{returnByValue:true,expression:`(() => {
        const page=document.querySelector('.pagedjs_pagebox'), root=document.querySelector('.pagedjs_pages .cover');
        const origin=page.getBoundingClientRect(), zoom=origin.width/(210*96/25.4);
        const rect=e=>{if(!e||!e.textContent.trim()&&e.tagName!=='IMG'&&!e.className.includes('rule'))return null;const r=e.getBoundingClientRect();return {left:(r.left-origin.left)/zoom*25.4/96,top:(r.top-origin.top)/zoom*25.4/96,right:(r.right-origin.left)/zoom*25.4/96,bottom:(r.bottom-origin.top)/zoom*25.4/96};};
        const boxes=Object.fromEntries(['ics','logo','head','stdno','sup','rule','cn','en','iso','date-rule','org-names'].map(k=>[k,rect(root.querySelector('.cover-'+k))]));
        const pub=root.querySelectorAll('.cover-org-pub > span');boxes.fa=rect(pub[0]);boxes.bu=rect(pub[1]);
        const dates=root.querySelectorAll('.cover-dates > span');boxes.issued=rect(dates[0]);boxes.implementation=rect(dates[1]);
        const walker=document.createTreeWalker(root.querySelector('.cover-ics'),NodeFilter.SHOW_TEXT);let text;while(text=walker.nextNode()){if(!/^(ICS|CCS)/.test(text.textContent.trim()))continue;const range=document.createRange();range.selectNodeContents(text);const r=range.getBoundingClientRect();boxes[text.textContent.trim().startsWith('ICS')?'ics-first':'ics-second']={left:(r.left-origin.left)/zoom*25.4/96,top:(r.top-origin.top)/zoom*25.4/96,right:(r.right-origin.left)/zoom*25.4/96,bottom:(r.bottom-origin.top)/zoom*25.4/96};}
        const issuerRows=[...root.querySelectorAll('.cover-org-name')].filter(e=>e.textContent.trim()).map(e=>{
          const node=e.firstChild, xs=[];
          for(let i=0;i<node.textContent.length;i++){const r=document.createRange();r.setStart(node,i);r.setEnd(node,i+1);xs.push((r.getBoundingClientRect().left-origin.left)/zoom*25.4/96);}
          return {name:e.textContent,originXsMm:xs};
        });
        return {boxes,issuerRows,error:window.__md2pdfPagedError||null,fonts:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family)};
      })()`});
      assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));
      const state=result.result.value;
      const size=/Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(run('pdfinfo',[prefix+'-full.pdf']));
      assert.ok(size,'PDF MediaBox available');state.paperMm=[+size[1]/72*25.4,+size[2]/72*25.4];
      assert.equal(state.error,null);
      if(name==='example')for(const expected of issuerSpacing.names){
        const row=state.issuerRows.find(r=>r.name===expected);
        assert.ok(row,`${runtime}: publisher ${expected}`);
        for(let i=1;i<row.originXsMm.length;i++)assert.ok(Math.abs(row.originXsMm[i]-row.originXsMm[i-1]-issuerSpacing.targetOriginPitchMm)<=issuerSpacing.engineeringToleranceMm,`${runtime}: publisher origin pitch matches independent sample measurements`);
      }
      await writeFile(prefix+'-boxes.json',JSON.stringify(state,null,2));
      run('pdfseparate',['-f','1','-l','1',prefix+'-full.pdf',prefix+'-%d.pdf']);
      const xml=run('pdftohtml',['-f','1','-l','1','-xml','-i','-stdout',prefix+'-1.pdf']);
      const families=Object.fromEntries([...xml.matchAll(/<fontspec id="(\d+)"[^>]*family="([^"]+)"/g)].map(m=>[m[1],m[2]]));
      const textRuns=[...xml.matchAll(/<text\b[^>]*font="(\d+)"[^>]*>([\s\S]*?)<\/text>/g)].map(m=>({font:families[m[1]],text:m[2]}));
      const expectFont=(text,font)=>assert.ok(textRuns.some(r=>r.text.includes(text)&&r.font.includes(font)),`${name}/${runtime}: ${text} uses ${font} in actual PDF`);
      expectFont('ICS','FZXBSK--GBK1-0');
      if(name==='example') {
        expectFont('Technical','FZXBSK--GBK1-0');
        expectFont('Robotics','FZXBSK--GBK1-0');
        expectFont('-','FZXBSK--GBK1-0');
        expectFont('10218','FZHTK--GBK1-0');
        expectFont('—','FZHTK--GBK1-0');
        expectFont('39999','FZHTK--GBK1-0');
        expectFont('仿生机械手','FZHTK--GBK1-0');
      } else expectFont('标准名称的英文译名','FZHTK--GBK1-0');
      await writeFile(prefix+'-font-runs.json',JSON.stringify(textRuns,null,2));
      run('pdftoppm',['-f','1','-singlefile','-r','600','-png',prefix+'-1.pdf',prefix]);
      if(runtime!=='static'){run('pdftoppm',['-f','1','-singlefile','-r','600','-png',prefix+'-locator.pdf',prefix+'-locator']);assert.ok((await readFile(prefix+'.png')).equals(await readFile(prefix+'-locator.png')),runtime+': production and locator first-page raster identical');}
      const ink=JSON.parse(run('python3',[new URL('./gb-cover-e5-ink.py',import.meta.url).pathname,prefix+'.png',prefix+'-boxes.json']));
      const point=(ref)=>{const [role,edge]=ref.split('.');return ink[role]?.[edge];};
      const rows=ledger.constraints.map(c=>{
        const a=point(c.from),b=point(c.to), measured=a==null||b==null?null:b-a;
        const error=measured==null?null:measured-c.mm;
        return {...c,measuredMm:measured,errorMm:error,status:measured==null?'not-applicable':Math.abs(error)<=ledger.measurement.toleranceMm?'pass':'fail'};
      });
      const alignError=ink.stdno&&ink.sup?ink.stdno.right-ink.sup.right:null;
      rows.push({id:'number-rows-right-aligned',mm:0,measuredMm:alignError,errorMm:alignError,status:alignError==null?'not-applicable':Math.abs(alignError)<=ledger.measurement.toleranceMm?'pass':'fail'});
      for(const [id,measured,expected] of [['banner-left',ink.head.left,25],['banner-width',ink.head.right-ink.head.left,170],['ics-first-left',ink['ics-first'].left,25],['ccs-left',ink['ics-second'].left,25],['issued-left',ink.issued.left,25],['implementation-right',ink.implementation.right,195],['lower-rule-left',ink['date-rule'].left,25],['lower-rule-width',ink['date-rule'].right-ink['date-rule'].left,170],['issuer-group-center',(ink['org-names'].left+ink.bu.right)/2,110],...['cn','en','iso'].filter(k=>ink[k]).map(k=>[k+'-center',ink[k].centerX,110])]){const error=measured-expected;rows.push({id,mm:expected,measuredMm:measured,errorMm:error,status:Math.abs(error)<=ledger.measurement.toleranceMm?'pass':'fail'});}
      const pdf=await readFile(prefix+'-1.pdf');
      const report={case:name,runtime,rendererFilesSha256,browser:await chrome.send('Browser.getVersion'),sourceSha256:createHash('sha256').update(md).digest('hex'),pdfSha256:createHash('sha256').update(pdf).digest('hex'),measurement:ledger.measurement,locator:'Independent printable DOM used only for crop locations; production PDF first-page raster compared byte-for-byte against locator raster. Static checks printable HTML through Chrome, not the OS print dialog.',ink,rows};
      await writeFile(prefix+'-measurements.json',JSON.stringify(report,null,2));
      reports.push(report);
      console.log(`${name}/${runtime}: ${rows.filter(r=>r.status==='pass').length}/${rows.length} ink constraints pass`);
    }
  }
  await writeFile(out+'/measurements.json',JSON.stringify(reports,null,2));
  const table=['# 图 E.5 封面墨迹校准','',`源图尺寸标注：${ledger.source.count} 项；另查编号对齐、横幅边缘、文字居中、日期定位和 ICS/CCS 左对齐。单位 mm。工程阈值 ±${ledger.measurement.toleranceMm}，不代表标准容差。`,'','| 案例 / 入口 | 项目 | 目标 | 实测 | 误差 | 结果 |','| --- | --- | ---: | ---: | ---: | --- |'];
  for(const r of reports)for(const row of r.rows)table.push(`| ${r.case} / ${r.runtime} | ${row.description||row.id} | ${row.mm} | ${row.measuredMm?.toFixed(3)??'—'} | ${row.errorMm?.toFixed(3)??'—'} | ${row.status} |`);
  await writeFile(out+'/report.md',table.join('\n')+'\n');
  const failures=reports.flatMap(r=>r.rows.filter(v=>v.status!=='pass').map(v=>`${r.case}/${r.runtime}: ${v.id} ${v.errorMm}`));
  assert.deepEqual(failures,[],`PDF ink calibration failures; see ${out}/report.md`);
  console.log(`PASS: two cases × CLI/Node/static; ${out}/report.md`);
} finally {
  globalThis.fetch=nativeFetch;
  await chrome.stop();await app.close();await rm(temp,{recursive:true,force:true});
}
