import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// 内容摘要同时覆盖编辑器资源与公开启动配置，不把正文或导出结果纳入缓存。
export async function appCacheScript(root, routes, bootstrap) {
  const entries = [];
  for (const [url, [file]] of routes) {
    const body = await readFile(path.join(root, file));
    entries.push({ url: url === '/' ? '/app/' : url, hash: digest(body) });
  }
  for (const [url, data] of bootstrap) entries.push({ url, hash: digest(JSON.stringify(data)) });
  const source = await readFile(path.join(root, 'web/app-worker.js'), 'utf8');
  const version = digest(JSON.stringify(entries) + source).slice(0, 20);
  return `const APP_VERSION=${JSON.stringify(version)};\nconst APP_FILES=${JSON.stringify(entries)};\n${source}`;
}
