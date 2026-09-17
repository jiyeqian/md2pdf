#!/usr/bin/env node
/**
 * npm postinstall —— 把 skill/SKILL.md 装进 Agent 技能目录（WorkBuddy）。
 *
 * 纯 Node、零依赖。默认只在存在 ~/.workbuddy 时安装，保持与旧 install.sh 一致：
 *   MD2PDF_SKILL=0        跳过安装
 *   MD2PDF_SKILL_DIR=<d>  覆盖落点（默认 ~/.workbuddy/skills/md-to-pdf）
 *
 * 技能安装失败只告警、不失败 —— 不能让 npm install 因为装技能而整体失败。
 */

import { mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'skill', 'SKILL.md');

if (process.env.MD2PDF_SKILL === '0') process.exit(0);
if (!existsSync(SRC)) process.exit(0);

const home = process.env.HOME || os.homedir();
let skillDir = process.env.MD2PDF_SKILL_DIR;
if (!skillDir && home && existsSync(path.join(home, '.workbuddy'))) {
  skillDir = path.join(home, '.workbuddy', 'skills', 'md-to-pdf');
}
if (!skillDir) process.exit(0);

try {
  await mkdir(skillDir, { recursive: true });
  await copyFile(SRC, path.join(skillDir, 'SKILL.md'));
  console.log(`md2pdf: 已安装技能说明书 → ${path.join(skillDir, 'SKILL.md')}`);
} catch (e) {
  console.warn(`md2pdf: 技能说明书安装失败（${e.message}），命令本身不受影响`);
}
