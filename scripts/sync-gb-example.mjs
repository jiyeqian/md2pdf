#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
// The web catalog and PDF acceptance already consume this canonical source.
export async function syncGbExample(root=ROOT,check=false) {
  const source=await readFile(path.join(root,'web/examples/gb.md'));
  const target=path.join(root,'examples/gb.md');
  let current;
  try {current=await readFile(target);} catch(error) {if(error.code!=='ENOENT')throw error;}
  if(current?.equals(source))return false;
  if(check)throw new Error('examples/gb.md 与唯一来源 web/examples/gb.md 不一致，请运行 npm run generate:gb-example');
  await writeFile(target,source);
  return true;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.slice(2).some(arg=>arg!=='--check'))throw new Error('用法：node scripts/sync-gb-example.mjs [--check]');
  const changed=await syncGbExample(ROOT,process.argv.includes('--check'));
  console.log(changed?'已同步 examples/gb.md':'GB完整范例已同步');
}
