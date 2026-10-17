#!/usr/bin/env node
// 隔离验证产物不进入 WebApp 构建；字体仅用于本机实验，不随仓库分发。
import {cp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildStatic} from '../src/static-build.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const [deps,font]=process.argv.slice(2);
if(!deps||!font)throw Error('用法：node scripts/build-pdf-probe.mjs <含 node_modules 的依赖目录> <本地 TTF 文件>');
for(const [name,expected] of [['jspdf','4.2.1'],['svg2pdf.js','2.8.1']]) {
  const actual=JSON.parse(await readFile(path.join(deps,'node_modules',name,'package.json'),'utf8')).version;
  if(actual!==expected)throw Error(`${name} 需要 ${expected}，实际为 ${actual}`);
}
const build=await buildStatic(),out=path.join(root,'dist/pdf-probe');
await cp(build.directory,out,{recursive:true});
for(const [from,to] of [['jspdf/dist/jspdf.umd.min.js','jspdf.js'],['svg2pdf.js/dist/svg2pdf.umd.min.js','svg2pdf.js']])await cp(path.join(deps,'node_modules',from),path.join(out,to));
const fontBytes=await readFile(font);
await rm(path.join(out,'probe-font.ttf'),{force:true});
await writeFile(path.join(out,'probe-font.ttf'),fontBytes);
for(const file of ['index.html','probe.mjs'])await cp(path.join(root,'experiments/pdf-export',file),path.join(out,file));
const info={fontBytes:(await stat(font)).size,jspdf:'4.2.1',svg2pdf:'2.8.1',productVersion:build.productVersion};
await writeFile(path.join(out,'probe-info.json'),JSON.stringify(info));
console.log(JSON.stringify({directory:out,...info},null,2));
