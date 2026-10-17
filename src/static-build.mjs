#!/usr/bin/env node
// 只生成独立静态目录；不改写 CLI、WebApp 源文件或其资源。
import { readFile, writeFile, mkdir, cp, readdir, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionInfo } from './version.mjs';
import { createHash } from 'node:crypto';
import { exampleCatalog, findExample } from './web-examples.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildStatic() {
const directory = path.join(root, 'dist/static');
const out = path.join(root, 'dist/.static-build-' + process.pid);
await rm(out, { recursive:true, force:true });
try {
await mkdir(path.join(out, 'src'), { recursive:true });
for (const dir of ['assets','vendor']) await cp(path.join(root, dir),path.join(out,dir),{recursive:true});
for (const entry of await readdir(path.join(root,'web'), {withFileTypes:true})) {
  if (entry.name !== 'platform-static') await cp(path.join(root,'web',entry.name),path.join(out,entry.name),{recursive:true});
}
for (const file of await readdir(path.join(root,'web/platform-static'))) {
  if (file !== 'cache.js') await cp(path.join(root,'web/platform-static',file),path.join(out,file));
}
const modules = new Set();
async function include(file) {
  if (modules.has(file)) return;
  modules.add(file);
  const source=await readFile(path.join(root,'src',file),'utf8');
  for (const match of source.matchAll(/from ['"]\.\/([^'"]+\.mjs)['"]/g)) await include(match[1]);
}
for(const file of ['render.mjs','web-input.mjs','web-options.mjs','web-document.mjs','editor-position.mjs','doi.mjs']) await include(file);
for (const file of modules) {
  let source = await readFile(path.join(root, 'src', file), 'utf8');
  if (file === 'render.mjs') {
    source = source.replace(/^import .* from 'node:[^']+';\n/gm, '');
    source = `import { path, readFile, existsSync, readdirSync, fileURLToPath, pathToFileURL } from '../resources.mjs';\nimport { Marked } from '../vendor/marked.esm.js';\nimport hljs from '../vendor/highlight/highlight.mjs';\n` + source;
    source = source.replace(/  const \{ Marked \} = await import\([^\n]+\n/, '').replace(/  const require = createRequire[^\n]+\n/, '').replace(/  const hljs = require[^\n]+\n/, '');
  }
  if (file === 'options.mjs') {
    source = source.replace(/^import .* from 'node:[^']+';\n/gm, '');
    source = `import { path, readdirSync, fileURLToPath } from '../resources.mjs';\n` + source;
  }
  if (/from ['"]node:|createRequire\(/.test(source)) throw new Error('浏览器模块仍依赖 Node：' + file);
  source = source.replaceAll("from '../web/", "from '../");
  await writeFile(path.join(out, 'src', file), source);
}
await writeFile(path.join(out, 'vendor/highlight/highlight.mjs'), await readFile(path.join(root, 'vendor/highlight/highlight.cjs'), 'utf8') + '\nexport default hljs;\n');
// YAML 包已内嵌浏览器的 Uint8Array/atob 分支；只替换 Node 的警告和环境接口。
const yamlFile = path.join(out, 'vendor/yaml/yaml.mjs');
let yaml = await readFile(yamlFile, 'utf8');
yaml = yaml.replace(/^import \{ createRequire \} from "node:module"; const require = createRequire\(import.meta.url\);/m,
  `const require = name => { if (name === 'process') return { env:{}, emitWarning:message => console.warn(message) }; if (name === 'buffer') return {}; throw new Error('不支持的浏览器模块：' + name); };`);
if (/from ["']node:/.test(yaml)) throw new Error('YAML 浏览器适配失败');
await writeFile(yamlFile, yaml);
const textAssets = {};
for (const file of ['assets/base.css','assets/shell.html', ...(await readdir(path.join(root, 'assets/themes'))).filter(f => f.endsWith('.css')).map(f => 'assets/themes/' + f)]) {
  textAssets['/md2pdf/' + file] = await readFile(path.join(root, file), 'utf8');
}
await writeFile(path.join(out, 'assets-text.mjs'), 'export default ' + JSON.stringify(textAssets) + ';\n');
const examples = await exampleCatalog();
const sources = {};
for(const {id} of examples){const {md,type,title}=await findExample(id);sources[id]={md,type,title};}
await writeFile(path.join(out,'catalog.mjs'),'export default '+JSON.stringify({examples:examples.map(({id,type,title,summary})=>({id,type,title,description:summary})),sources})+';\n');
let index=await readFile(path.join(out,'index.html'),'utf8');
index=index.replace('<meta charset="utf-8">','<meta charset="utf-8"><script src="./boot.js"></script><link rel="stylesheet" href="./static.css">');
index=index.replace(/(src|href)="\/([^"]*)"/g,'$1="./$2"');
index=index.replace('</header>','</header><div id="offline-state" class="offline-state" role="status">静态部署 · 浏览器本地排版。<span id="offline-cache">正在准备离线资源…</span></div>');
await writeFile(path.join(out,'index.html'),index);
for(const file of await readdir(path.join(root,'web'))){
  if(!/\.(?:js|mjs)$/.test(file))continue;
  const target=path.join(out,file);
  const source=await readFile(target,'utf8');
  await writeFile(target,source.replace(/(["'`])\/(icons\/|template-previews\/|src\/)/g,'$1./$2').replaceAll("../src/", "./src/"));
}
const manifest=JSON.parse(await readFile(path.join(out,'manifest.webmanifest'),'utf8'));
Object.assign(manifest,{id:'./',start_url:'./',scope:'./'});
for(const icon of manifest.icons)icon.src='./'+icon.src.replace(/^\//,'');
await writeFile(path.join(out,'manifest.webmanifest'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(path.join(out, '.nojekyll'), '');
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes:true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(target));
    else if (!['service-worker.js', 'build-info.json'].includes(entry.name)) result.push(target);
  }
  return result.sort();
}
const product = versionInfo('static');
await writeFile(path.join(out, 'version-data.json'), JSON.stringify(product));
const entries = [];
let bytes = 0;
for (const file of await files(out)) {
  const data = await readFile(file); bytes += data.length;
  entries.push({ url:path.relative(out, file).split(path.sep).join('/'), hash:createHash('sha256').update(data).digest('hex') });
}
const worker = await readFile(path.join(root, 'web/platform-static/cache.js'), 'utf8');
const version = createHash('sha256').update(JSON.stringify(entries) + worker).digest('hex').slice(0,20);
await writeFile(path.join(out, 'service-worker.js'), `const VERSION=${JSON.stringify(version)};\nconst FILES=${JSON.stringify(entries)};\n` + worker);
const info = { productVersion:product.version, commit:product.commit, version, files:entries.length, bytes, pdf:'system-print', sharedRenderer:'src/render.mjs', builtAt:new Date().toISOString() };
await writeFile(path.join(out, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
const backup = directory + '.previous';
await rm(backup,{recursive:true,force:true});
let previous = false;
try { await rename(directory,backup); previous = true; } catch(error) { if(error.code !== 'ENOENT') throw error; }
try { await rename(out,directory); } catch(error) { if(previous)await rename(backup,directory); throw error; }
await rm(backup,{recursive:true,force:true});
return {directory,...info};
} finally { await rm(out,{recursive:true,force:true}); }
}
