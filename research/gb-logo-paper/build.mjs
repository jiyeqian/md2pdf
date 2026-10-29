// Embed the figures once so the same manuscript can be consumed by every runtime.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {render} from '../../src/render.mjs';
import {createApp} from '../../src/server.mjs';
import {buildStatic} from '../../src/static-build.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const scratch=path.join(here,'build');
const root=path.resolve(here,'../..');
await mkdir(scratch,{recursive:true});
await mkdir(path.join(root,'output/pdf'),{recursive:true});
let md=await readFile(path.join(here,'manuscript.md'),'utf8');
const figureNames=[];
for(const match of [...md.matchAll(/!\[([^\]]*)\]\((figures\/[^)]+\.png)\)/g)]){
  const data=await readFile(path.join(here,match[2]));
  figureNames.push(match[2]);
  md=md.replace(match[0],`![${match[1]}](data:image/png;base64,${data.toString('base64')})`);
}
assert.equal(figureNames.length,6);
await writeFile(path.join(scratch,'gb-logo-paper-web.md'),md);
const opts={type:'paper'};
const body=JSON.stringify({md,opts});
const fixedDate=new Date('2026-10-29T00:00:00Z');
const cli=await render(md,{...opts,pagedHtml:true},{generatedAt:fixedDate});
const web=await render(md,{...opts,pagedHtml:true},{webSafe:true,generatedAt:fixedDate});
const normalized=html=>html.replaceAll('&amp;','&').replace(/\s+/g,' ').trim();
// Safe Markdown contains no raw HTML; images and bibliography must be identical.
const cliNormalized=normalized(cli.html),webNormalized=normalized(web.html);
if(cliNormalized!==webNormalized){
  const index=[...cliNormalized].findIndex((c,i)=>c!==webNormalized[i]);
  throw new Error('CLI/Web difference near '+index+': '+JSON.stringify([cliNormalized.slice(index-50,index+120),webNormalized.slice(index-50,index+120)]));
}
await writeFile(path.join(scratch,'shared.html'),web.pagedHtml);
const app=createApp();
const nativeFetch=globalThis.fetch;
try{
  const built=await buildStatic();
  globalThis.fetch=async(input,init)=>new URL(input).protocol==='file:'
    ?new Response(await readFile(new URL(input))):nativeFetch(input,init);
  const offline=await import(pathToFileURL(built.directory+'/runtime.mjs'));
  const stat=await offline.renderDocument({md,opts},false);
  await writeFile(path.join(scratch,'static.html'),stat.html);
  await new Promise((resolve,reject)=>{
    app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);
  });
  const base='http://127.0.0.1:'+app.server.address().port;
  const response=await nativeFetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body});
  assert.equal(response.status,200);
  const node=await response.json();
  await writeFile(path.join(scratch,'node.html'),node.html);
  // Compare document body: runtime heads carry their own assets and product identity.
  const content=html=>normalized(html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1]||'');
  const textBody=html=>content(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')
    .replace(/ data-md2pdf-source-line="\d+"/g,'').trim();
  assert.equal(textBody(node.html),textBody(stat.html),'Node and static manuscript content');
  const pdf=await nativeFetch(base+'/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body});
  if(pdf.status!==200)throw new Error('Node PDF '+pdf.status+': '+(await pdf.text()).slice(0,300));
  const bytes=Buffer.from(await pdf.arrayBuffer());
  assert.ok(bytes.subarray(0,5).toString()==='%PDF-');
  const output=path.join(root,'output/pdf/gb-logo-function-paper.pdf');
  await writeFile(output,bytes);
  const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
  await writeFile(path.join(scratch,'render-report.json'),JSON.stringify({
    manuscriptSha256:sha(await readFile(path.join(here,'manuscript.md'))),
    embeddedMarkdownSha256:sha(Buffer.from(md)),figures:figureNames,
    cliWebSharedHtmlEqual:true,nodeStaticBodyEqual:true,
    pdf:{path:output,bytes:bytes.length,sha256:sha(bytes)},
  },null,2)+'\n');
  console.log('PASS: CLI/Web shared HTML and Node/static body; one Node paper PDF: '+output);
}finally{
  globalThis.fetch=nativeFetch;
  await app.close();
}
