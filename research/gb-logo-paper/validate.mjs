import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {render} from '../../src/render.mjs';
import {Chrome,findChrome} from '../../src/chrome.mjs';

const here=new URL('./',import.meta.url),root=new URL('../../',here);
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await readFile(new URL('data/manifest.json',here)));
for(const [name,sha]of Object.entries(manifest.sourceInputs))assert.equal(hash(await readFile(new URL(name,root))),sha,name);
for(const [name,sha]of Object.entries(manifest.outputs))assert.equal(hash(await readFile(new URL(name,here))),sha,name);
assert.equal(hash(await readFile(new URL('experiments.py',here))),manifest.generatorSha256);
assert.equal(hash(await readFile(new URL('capture.mjs',here))),manifest.captureSha256);
const r=JSON.parse(await readFile(new URL('data/results.json',here)));
assert.equal(r.sweep.length,45);
assert.equal(r.best.iou,Math.max(...r.sweep.map(x=>x.iou)));
let best=0;
for(const x of r.sweep){
  assert.equal(x.xorPixels,x.missingBlack+x.extraBlack);
  assert.ok(Math.abs(x.iou-(r.sources[0].blackPixels-x.missingBlack)/(r.sources[0].blackPixels+x.extraBlack))<1e-12);
  best=Math.max(best,x.iou);assert.equal(x.cumulativeBestIoU,best);
}
const md=await readFile(new URL('build/gb-logo-paper-web.md',here),'utf8');
for(const name of Object.keys(manifest.outputs).filter(n=>n.startsWith('figures/'))){
  const embedded=(await readFile(new URL(name,here))).toString('base64');
  assert.ok(md.includes('data:image/png;base64,'+embedded),'embedded figure matches final experiment: '+name);
}
const cliPath=new URL('build/cli.html',here);
execFileSync(process.execPath,[fileURLToPath(new URL('src/md2pdf.mjs',root)),
  fileURLToPath(new URL('build/gb-logo-paper-web.md',here)),'--html-only','--paged-html=','-o',fileURLToPath(cliPath)],{stdio:'pipe'});
const manuscriptBody=html=>(html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1]||'')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/ data-md2pdf-source-line="\d+"/g,'')
  .replaceAll('&amp;','&').replace(/\s+/g,' ').trim();
assert.equal(manuscriptBody(await readFile(cliPath,'utf8')),
  manuscriptBody(await readFile(new URL('build/node.html',here),'utf8')),'actual CLI entry and Node body');
const core=await render(md,{type:'paper',pagedHtml:true},{webSafe:true});
const chrome=new Chrome(findChrome(),await mkdtemp('/private/tmp/gb-paper-audit-'));
try{
  await chrome.start();
  await chrome.print(fileURLToPath(new URL('build/node.html',here)),{...core.printOptions,waitPaged:true});
  const result=await chrome.send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
    const pages=[...document.querySelectorAll('.pagedjs_page')];
    const scope=document.querySelector('.pagedjs_pages');
    const page=e=>pages.indexOf(e.closest('.pagedjs_page'))+1;
    const tables=[...scope.querySelectorAll('table')].map(t=>({id:t.id,page:page(t),caption:t.caption?.textContent,rows:t.tBodies[0]?.rows.length}));
    const figures=[...scope.querySelectorAll('figure')].map(f=>({page:page(f),caption:f.querySelector('figcaption')?.textContent,loaded:[...f.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0)}));
    const overflows=[];
    for(const e of scope.querySelectorAll('table,figure,mjx-container[display="true"]')){
      const p=e.closest('.pagedjs_page_content');if(!p)continue;
      const a=e.getBoundingClientRect(),b=p.getBoundingClientRect();
      if(a.left<b.left-2||a.right>b.right+2||a.bottom>b.bottom+2)overflows.push({tag:e.tagName,page:page(e),left:a.left-b.left,right:a.right-b.right,bottom:a.bottom-b.bottom});
    }
    const refs=[...scope.querySelectorAll('.references>li')].map(e=>({id:e.id,text:e.textContent}));
    return {pages:pages.length,tables,figures,overflows,refs,displayEquations:scope.querySelectorAll('mjx-container[display="true"]').length,mathErrors:scope.querySelectorAll('mjx-merror,[data-mjx-error]').length,authors:scope.querySelector('.authors')?.textContent,pagedError:window.__md2pdfPagedError||null};
  })()`});
  assert.equal(result.exceptionDetails,undefined);
  const state=result.result.value;
  const pdf=new URL('../../output/pdf/gb-logo-function-paper.pdf',here);
  const text=execFileSync('pdftotext',['-layout',fileURLToPath(pdf),'-'],{encoding:'utf8'});
  state.pdfSha256=hash(await readFile(pdf));
  state.manuscriptSha256=hash(await readFile(new URL('manuscript.md',here)));
  state.figureManifestVerified=true;state.experimentArithmeticVerified=true;state.actualCliEntryBodyEqual=true;
  state.pdfTextChecks={authors:text.includes('Jiye Qian')&&text.includes('GPT-6.1 Sol'),pages:text.split('\f').filter(x=>x.trim()).length,noRawLatex:!text.includes('\\label{')&&!text.includes('\\eqref{'),references:text.includes('612-626')&&text.includes('10.4086/toc.2012.v008a019')};
  await writeFile(new URL('build/validation.json',here),JSON.stringify(state,null,2)+'\n');
  assert.equal(state.figures.length,6);assert.ok(state.figures.every(f=>f.loaded));
  assert.equal(state.tables.length,8,'short tables must remain complete on one page');
  assert.deepEqual(state.tables.map(t=>t.rows),[3,6,3,4,2,3,3,3]);
  // MathJax's SVG equation tags are vector paths in the PDF, not searchable text.
  assert.equal(state.displayEquations,12,'all twelve display formulas are rendered');
  assert.equal(state.refs.length,9);assert.equal(state.mathErrors,0);assert.equal(state.pagedError,null);
  assert.ok(state.authors.includes('qianjiye@gmail.com'),'correspondence email is rendered');
  assert.ok(text.includes('致谢')&&text.includes('md2pdf: Markdown'),'acknowledgement and software citation are present');
  assert.ok(Object.values(state.pdfTextChecks).every(Boolean),'PDF text integrity');
  assert.equal(state.overflows.length,0,JSON.stringify(state.overflows));
  console.log(JSON.stringify({pages:state.pages,tableFragments:state.tables.length,tables:state.tables,figures:state.figures.length,refs:state.refs.length,mathErrors:state.mathErrors,overflows:state.overflows}));
}finally{await chrome.stop();}
