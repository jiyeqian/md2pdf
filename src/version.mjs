import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 所有入口只从 package.json 读取产品版本；Git 仅补充开发版本身份。
export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export function versionInfo(deployment) {
  let commit = '';
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd:fileURLToPath(new URL('../', import.meta.url)), stdio:['ignore','pipe','ignore'],
    }).toString().trim();
  } catch { /* 安装包和静态部署不要求保留 Git 仓库。 */ }
  return { version:VERSION, commit, deployment };
}
