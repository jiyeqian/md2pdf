import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createApp } from '../src/server.mjs';

const app=createApp();
try{
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  for(const [type,file]of [['general','general.md'],['paper','paper.md'],['skill','skill.md'],['gb','gb.md']]){
    const md=await readFile(new URL(`../examples/${file}`,import.meta.url),'utf8');
    const response=await fetch(base+'/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({md,opts:{type,toc:true}})});
    if(response.status!==200)throw new Error(`${type}: ${await response.text()}`);
    const pdf=Buffer.from(await response.arrayBuffer());
    assert.equal(pdf.subarray(0,5).toString(),'%PDF-',`${type} PDF header`);
    const check=spawnSync('pdfinfo',['-'],{input:pdf,encoding:'utf8'});
    if(check.status===0)assert.ok(Number(check.stdout.match(/^Pages:\s+(\d+)/m)?.[1])>0,`${type} PDF has pages`);
    console.log(`${type}: PDF produced (${pdf.length} bytes)${check.status===0?`, ${check.stdout.match(/^Pages:\s+(\d+)/m)?.[1]} pages`:''}`);
  }
}finally{await app.close();}
