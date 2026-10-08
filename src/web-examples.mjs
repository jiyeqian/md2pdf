import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * web-examples —— /examples 页面与默认示例的固定白名单。
 *
 * - 每条示例指向**本模块内写死的相对路径**，HTTP 请求只能传 id，且 id 必须命中白名单；
 *   不存在「把请求参数拼进文件路径」的路由，因此不会出现任意文件读取。
 * - 示例 Markdown 已适配在线环境：不使用本机相对图片或远程图片，
 *   需要插图时统一内嵌受支持的 data raster（PNG）。
 * - type 显式给定（README 依赖文件名才能自动识别，网页端没有文件名）。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const EXAMPLES = [
  {
    id: 'general', type: 'general',
    title: '仿生机械手控制方案',
    summary: '通用文档：数学公式与交叉引用、Mermaid 流程图、栅格插图、表格题注、代码高亮与 BibTeX 参考文献。',
    tags: ['公式编号', 'Mermaid', '图表题注', '参考文献'],
    file: 'web/examples/general.md',
  },
  {
    id: 'skill', type: 'skill',
    title: '日志分析技能说明书',
    summary: '技能文档：frontmatter 的 name / description 触发自动识别，报头带「技能文档」标识、参数表与输出说明。',
    tags: ['frontmatter 识别', '参数表', '命令示例'],
    file: 'web/examples/skill.md',
  },
  {
    id: 'readme', type: 'readme',
    title: '项目 README 导览',
    summary: 'README：默认带目录，多级标题、链接与表格混排；在线版本不放远程徽章，避免出现未加载占位。',
    tags: ['默认目录', '链接与表格'],
    file: 'web/examples/readme.md',
  },
  {
    id: 'paper', type: 'paper',
    title: '面向非结构化环境的仿生抓取控制方法',
    summary: '学术论文：作者行、摘要与关键词三件套，公式编号、图表题注与按首次引用顺序编号的参考文献。',
    tags: ['摘要关键词', '公式引用', '三线表'],
    file: 'web/examples/paper.md',
  },
  {
    id: 'gb', type: 'gb',
    title: '仿生机械手抓取控制系统技术要求（国家标准样例）',
    summary: '国家标准：前言/引言/范围/术语/技术要求/附录 A 的 GB 结构，封面与页眉信息全部来自文档 frontmatter。',
    tags: ['GB 封面', '章条编号', '附录 A'],
    file: 'web/examples/gb.md',
  },
];

export const EXAMPLE_IDS = EXAMPLES.map(example => example.id);
export const DEFAULT_EXAMPLE_ID = 'general';

let cache;
async function loadAll() {
  cache ||= Promise.all(EXAMPLES.map(async example => ({ ...example, md: await readFile(path.join(ROOT, example.file), 'utf8') })));
  return cache;
}

/** 不带 md 的目录（列表用） */
export async function exampleCatalog() {
  return (await loadAll()).map(({ md, ...meta }) => meta);
}

/** 带 md 的完整目录；key === false 时只返回元数据 */
export async function examplesWithSource() {
  return (await loadAll()).map(({ file, ...example }) => example);
}

/** 按 id 取一条（未知 id → undefined） */
export async function findExample(id) {
  return (await loadAll()).find(example => example.id === id);
}

/** 默认示例正文，供 /api/example 的既有契约使用 */
export async function defaultExampleSource() {
  return (await findExample(DEFAULT_EXAMPLE_ID)).md;
}
