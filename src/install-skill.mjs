import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const TARGETS = Object.freeze({
  codex: '.codex/skills',
  workbuddy: '.workbuddy/skills',
  codebuddy: '.codebuddy/skills',
  claude: '.claude/skills',
  agents: '.agents/skills',
});

const HELP = `安装 Agent Skill：
  md2pdf skill install --target <${Object.keys(TARGETS).join('|')}> [--force]
  md2pdf skill install --dir <技能目录> [--force]

--dir 指向包含 SKILL.md 的目录；--force 覆盖内容不同的已有文件。
`;

export async function installSkill(args) {
  if (!args.length || (args.length === 1 && ['--help', '-h'].includes(args[0])) ||
      (args[0] === 'install' && args.length === 2 && ['--help', '-h'].includes(args[1]))) {
    console.log(HELP);
    return;
  }
  if (args.shift() !== 'install') throw new Error('未知 skill 子命令；使用 md2pdf skill --help');
  let target, dir, force = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--force') { force = true; continue; }
    if (arg !== '--target' && arg !== '--dir') throw new Error(`未知选项：${arg}`);
    const value = args.shift();
    if (!value || value.startsWith('-')) throw new Error(`${arg} 缺少值`);
    if (arg === '--target') {
      if (target !== undefined) throw new Error('--target 不可重复');
      target = value;
    } else {
      if (dir !== undefined) throw new Error('--dir 不可重复');
      dir = value;
    }
  }
  if (!!target === !!dir) throw new Error('请指定 --target 或 --dir，不能同时指定');
  if (target && !Object.hasOwn(TARGETS, target)) throw new Error(`未知 target：${target}；可用：${Object.keys(TARGETS).join(', ')}`);
  const home = process.env.HOME || os.homedir();
  const destination = path.resolve(dir || path.join(home, TARGETS[target], 'md-to-pdf'));
  const file = path.join(destination, 'SKILL.md');
  const source = await readFile(new URL('../skill/SKILL.md', import.meta.url));
  let existing;
  try {
    const stat = await lstat(file);
    if (!stat.isFile()) throw new Error(`目标不是普通文件：${file}`);
    existing = await readFile(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existing?.equals(source)) {
    console.log(`md2pdf: Skill 已是最新 → ${file}`);
    return;
  }
  if (existing && !force) throw new Error(`已有 Skill 内容不同：${file}；使用 --force 覆盖`);
  await mkdir(destination, { recursive: true });
  await writeFile(file, source, { flag: existing && force ? 'w' : 'wx' });
  console.log(`md2pdf: 已安装 Skill → ${file}`);
}
