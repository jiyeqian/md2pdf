import {Chrome,findChrome} from '../src/chrome.mjs';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const dir=process.env.FIXTURE_DIR||'/private/tmp/md2pdf-image-retake';
let failures=0;
for(const name of ['small','large'])for(let round=1;round<=3;round++){
 const profile=await mkdtemp(path.join(os.tmpdir(),'image-decode-'));const browser=new Chrome(findChrome(),profile);
 try{await browser.start();const data=(await readFile(path.join(dir,name+'.jpg'))).toString('base64');const expression=`(async()=>{let raw=atob(${JSON.stringify(data)}),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),blob=new Blob([bytes],{type:'image/jpeg'}),times=[];for(let i=0;i<3;i++){let t=performance.now(),b=await createImageBitmap(blob);times.push({ms:performance.now()-t,w:b.width,h:b.height});b.close()}return times})()`;const r=await browser.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));const samples=r.result.value;if(samples.some(x=>x.w!==(name==='small'?1200:4000)||x.h!==(name==='small'?900:3000)))throw Error('dimensions');console.log(JSON.stringify({name,round,samples}));}catch(e){failures++;console.log(JSON.stringify({name,round,error:String(e)}))}finally{await browser.stop();await rm(profile,{recursive:true,force:true})}
}
if(failures)process.exitCode=1;
