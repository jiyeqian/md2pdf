import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {render} from '../src/render.mjs';
import {Chrome,findChrome} from '../src/chrome.mjs';
// The caller supplies an immutable exported checkout, avoiding branch switches in shared worktrees.
const baseline=process.argv[2];assert.ok(baseline,'provide baseline checkout exported from the base commit');
const before=await import(pathToFileURL(baseline+'/src/render.mjs'));
const out='/private/tmp/md2pdf-gb-other-templates';await mkdir(out,{recursive:true});
const temp=await mkdtemp('/private/tmp/gb-other-browser-'),chrome=new Chrome(findChrome(),temp),results=[];
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
try{
 await chrome.start();
 for(const type of ['general','paper','skill']){
  const file=type,md=await readFile(new URL('../web/examples/'+file+'.md',import.meta.url),'utf8');
  const images=[];
  for(const [name,fn] of [['before',before.render],['after',render]]){
   const result=await fn(md,{type,pagedHtml:true},{generatedAt:new Date('2026-01-01T00:00:00Z')});
   const html=out+'/'+type+'-'+name+'.html';await writeFile(html,result.pagedHtml);
   const pdf=await chrome.print(html,{...result.printOptions,waitPaged:true});await writeFile(out+'/'+type+'-'+name+'.pdf',pdf);
   const dir=out+'/'+type+'-'+name;await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
   execFileSync('pdftoppm',['-r','90','-png',out+'/'+type+'-'+name+'.pdf',dir+'/page']);
   const {readdir}=await import('node:fs/promises');const files=(await readdir(dir)).filter(f=>f.endsWith('.png')).sort();
   images.push(await Promise.all(files.map(async f=>hash(await readFile(dir+'/'+f)))));
  }
  assert.deepEqual(images[1],images[0],type+': every PDF page must be pixel-identical');
  results.push({template:type,pages:images[0].length,input_sha256:hash(md),dpi:90,pixel_identical:true,before_png_sha256:images[0],after_png_sha256:images[1]});
 }
 await writeFile(out+'/results.json',JSON.stringify({baseline,results},null,2));
 console.log('PASS: all PDF pages pixel-identical for '+results.map(r=>r.template+' ('+r.pages+')').join(', '));
}finally{await chrome.stop();await rm(temp,{recursive:true,force:true});}
