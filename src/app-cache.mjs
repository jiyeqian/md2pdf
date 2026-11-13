import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { browserYaml } from './browser-yaml.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function readStaticAsset(root, file) {
  const body = await readFile(path.join(root, file));
  return file === 'vendor/yaml/yaml.mjs' ? Buffer.from(browserYaml(body.toString('utf8'))) : body;
}

// 内容摘要同时覆盖编辑器资源与公开启动配置，不把正文或导出结果纳入缓存。
export async function appCacheScript(root, routes, bootstrap, policy = '') {
  const entries = [];
  for (const [url, [file]] of routes) {
    if (url === '/onedrive-config.json' || url.startsWith('/vendor/msal/')) continue;
    const body = await readStaticAsset(root, file);
    entries.push({ url, hash: digest(body) });
  }
  for (const [url, data] of bootstrap) entries.push({ url, hash: digest(JSON.stringify(data)) });
  const source = await readFile(path.join(root, 'web/app-worker.js'), 'utf8');
  const version = digest(JSON.stringify(entries) + policy + source).slice(0, 20);
  return `const APP_VERSION=${JSON.stringify(version)};\nconst APP_FILES=${JSON.stringify(entries)};\n${source}`;
}
