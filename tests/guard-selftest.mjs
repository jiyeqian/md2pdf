// 每个破坏用例从已通过的未破坏副本独立开始；不接受任意非零退出作为证据。
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || fileURLToPath(new URL('../', import.meta.url)));
const temp = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-guards-'));
const pristine = path.join(temp, 'pristine');
const trial = path.join(temp, 'trial');
const check = directory => spawnSync(process.execPath, ['tests/checks.mjs', directory], {cwd:directory, encoding:'utf8'});
const failures = result => (result.stdout + result.stderr).split('\n').filter(line => line.includes('✗'));
async function replace(file, from, to) {
  const target = path.join(trial, file), before = await readFile(target, 'utf8');
  if (!before.includes(from)) throw new Error(`破坏目标不存在：${file}`);
  const after = before.replaceAll(from, to);
  if (after === before) throw new Error(`未实际破坏：${file}`);
  await writeFile(target, after);
}
const cases = [
  ['模板占位符', 'assets/shell.html', '{{COLOPHON}}', '{{COLOPHN}}', '占位符：shell.html 全部有替换逻辑'],
  ['主题变量', 'assets/themes/elegant.css', 'var(--accent)', 'var(--accentt)', '主题 elegant.css：var(--x) 全部有定义'],
  ['共享版本漂移', 'src/version.mjs', "export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;", "export const VERSION = '9.9.9';", '版本号：共享模块与 package.json 一致'],
  ['技能名称', 'integrations/skills/md2pdf/SKILL.md', 'name: md-to-pdf\n', 'name: md-to-pdff\n', '技能：frontmatter name 为 md-to-pdf'],
  ['目录内链', 'src/render.mjs', '<li class="toc-level-${included.indexOf(s.level)}"><a href="#${s.id}"><span class="toc-text">${esc(s.text)}</span><span class="toc-dots"></span></a></li>', '<li>${esc(s.text)}</li>', '渲染：目录项是可点击内链'],
  ['PDF 书签', 'src/chrome.mjs', 'generateDocumentOutline: true', 'generateDocumentOutline: false', '书签：printToPDF 传入 generateDocumentOutline'],
];
try {
  await mkdir(pristine);
  await cp(root, pristine, {recursive:true, filter:source => !['.git','node_modules','dist','.workbuddy'].includes(path.relative(root, source).split(path.sep)[0])});
  const baseline = check(pristine);
  if (baseline.status !== 0) {
    console.error('✗ 未破坏副本校验失败，停止守卫自测，不能以此证明破坏用例有效');
    console.error(failures(baseline).join('\n') || (baseline.stderr || baseline.stdout).slice(-2000));
    process.exitCode = 1;
  } else {
    console.log('✓ 未破坏副本校验通过');
    for (const [name, file, from, to, expected] of cases) {
      await rm(trial, {recursive:true, force:true});
      await cp(pristine, trial, {recursive:true});
      await replace(file, from, to);
      const result = check(trial), failed = failures(result);
      if (result.status !== 1 || !failed.some(line => line.includes(expected))) {
        throw new Error(`${name}未因预期断言失败：status=${result.status}\n${failed.join('\n') || result.stderr.slice(-1500)}`);
      }
      console.log(`✓ ${name}：独立副本命中「${expected}」`);
    }
  }
} catch (error) {
  console.error('✗ 守卫自测失败：' + error.message);
  process.exitCode = 1;
} finally {
  await rm(temp, {recursive:true, force:true});
}
