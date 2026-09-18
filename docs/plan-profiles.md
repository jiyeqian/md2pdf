# md2pdf 文档类型 Profile 方案（规划）

> 状态：**P0 已落地**（`src/profiles.mjs` + `--type` + 自动探测 + skill 收编）。
> 本文记录「如何让不同用途的 md 有针对性转 PDF」的设计分析、架构、路线图与已确认决策，供后续阶段参考。

---

## 1. 背景

md2pdf 是一套**通用** Markdown → 中文 A4 PDF 管线。但不同用途的 md 对版式要求差异很大：
Agent 技能文档、国家标准、博客文章、README、论文……它们的「报头、编号、区块样式」各不相同。

目标：在不破坏通用能力的前提下，让转换**按文档用途自动适配**。

## 2. 「有针对性」的 6 个维度

任一文档类型的差异都可归到这 6 个维度：

1. **识别**：怎么判定这篇 md 属于哪一类？
2. **报头 / 元信息**：frontmatter 哪些字段进报头？怎么排布？
3. **编号体系**：章节如何编号？
4. **扩展语法**：该生态私有语法如何渲染（Liquid、admonition、双链等）？
5. **默认开关**：默认启用哪些功能（编号 / 参考文献 / 目录 / 主题）？
6. **版式细节**：封面、页眉页脚、特定区块样式。

## 3. 各类文档分析

### 3.1 通用 md（`general`）— 已支持

- **识别**：fallback（其它 profile 都不命中时）。
- **报头**：首个 H1 → 标题；首段 → 导语。
- **编号**：`--numbering auto`（识别到已有编号则不另加）。
- **默认**：沿用全局默认值。

### 3.2 Skill md（`skill`）— P0 已落地

- **识别**：文件名 `SKILL.md`，或 frontmatter 含 `name`（沿用原有 `isSkill` 判定，行为不变）。
- **报头**：kicker「技能文档」；`name` → 元信息条（标签 `SKILL NAME`）。
- **元信息**：`description` 中含「适用于…/不用于…」时自动拆成「适用 / 不适用」两栏（原有能力）。
- **落款**：`SKILL · <name>`。
- **后续可增强（非 P0）**：代码块突出、`allowed-tools` 渲染为工具列表、默认不编号。

### 3.3 GB 国标 md（`gb`）— 暂缓（P3）

GB/T 1.1-2020 结构：

| 区块 | 特点 |
| --- | --- |
| 封面 | 标准号、中英文名称、发布 / 实施日期、发布机构 |
| 前言 / 引言 | **不编号** |
| 范围 / 规范性引用文件 / 术语和定义 | 编号章（1、2、3） |
| 正文 | 章条制：章 `1`、条 `1.1`、细分 `1.1.1` |
| 附录 | **字母编号**（附录 A、A.1），标注规范性 / 资料性 |
| 参考文献 | GB/T 7714（已实现） |

需要：封面页、章条编号（附录字母、前言豁免）、规范性引用文件条目、术语条目、附录区块、页眉标准号。

### 3.4 Jekyll 博客 md（`jekyll`）— 暂缓（P1 / P4）

- **识别**：frontmatter 含 `layout` 且含 `date`（+ `categories` / `tags`）。
- **报头**：`title` + `date` + `author` + `tags/categories` 标签条。
- **扩展语法（Liquid）**：`{{ site.baseurl }}`、`{% post_url %}`、`{% highlight %}` → 需处理（属扩展语法，P4）。
- frontmatter 报头部分可在 P1 单独落地（不含 Liquid）。

### 3.5 其他常见 md（后续扩展参考）

| 类型 | 特征 | 建议优先级 |
| --- | --- | --- |
| README.md | badge（行内小图）、TOC、大量代码块 | **已支持**（`readme` profile：默认目录 + 徽章不编号） |
| 学术论文 md | 中英文摘要、关键词、章节、参考文献（GB/T 7714 已有） | 高 |
| 文档站 md（VitePress / Docusaurus / GitBook） | 容器提示块 `::: tip`、层级深 | 高（语法属扩展语法） |
| Obsidian md | `[[双链]]`、`> [!note]` callout、`#标签` | 中（属扩展语法） |
| 公文 / 报告 md | 正式标题、发文号、落款、中文编号（一、（一）） | 中 |
| CHANGELOG | 版本号标题、条目列表 | 低 |
| 简历 md | 姓名 / 联系方式 / 模块，需专门版式 | 低 |
| RFC / 设计提案 md | 状态、作者、时间等元信息 + 结构化章节 | 低 |
| 书籍 / 多文件手册 | 多 md 合并、统编页码、总目录 | 低（现有批量模式可演进） |

## 4. 架构方案：Profile 机制

### 4.1 识别策略（已决策）

**以自动探测为主，同时提供显式 `--type` 覆盖；不支持 frontmatter 声明。**

优先级从高到低：

1. 显式 `--type <name>`（未知值抛错，与 `--theme` 一致）
2. 文件名特征：`SKILL.md` → skill
3. frontmatter 键特征：`name` → skill
4. fallback → `general`

> **决策说明**：不引入 frontmatter 声明字段（如 `md2pdf: gb`），
> 因为历史遗留文档不会有该字段，维护 / 回填成本高，且污染文档。

### 4.2 Profile 结构

`src/profiles.mjs` 导出 `PROFILES` 注册表与 `detectProfile()`。每个 profile 含：

- `name`：标识
- `detect({ basename, fm })`：是否命中（自动探测用）
- `kicker`：默认报头小标题（`null` = 无默认）
- `skillMeta`：元信息条是否按技能文档样式渲染
- `defaults`：覆盖全局默认选项（P0 均为空，后续按类型填充）

新增类型只需在 `PROFILES` 里加一项，并在需要时扩展字段语义（编号方案、预处理器等）。

### 4.3 预处理层（暂缓，P4）

按 profile 挂载正则预处理器（Liquid / admonition / callout / wikilink）。

### 4.4 编号方案（暂缓，P2）

| scheme | 形式 | 适用 |
| --- | --- | --- |
| `arabic` | 1 / 1.1 / 1.1.1 | 通用（默认） |
| `gb` | 章条制（与 arabic 同形；附录字母化与前言豁免属 P3） | GB |
| `gb` | 章条制 + 附录字母 | GB（P3） |
| `cjk` | 一、/（一）/ 1./（1） | 公文、论文 |
| `chapter` | 第 1 章 / 1.1 | 书籍、手册 |

## 5. 路线图

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| **P0** | Profile 骨架 + `--type` + 自动探测；`isSkill` 收编进 `skill` profile | **已完成** |
| P1 | Jekyll profile（仅 frontmatter 报头，不含 Liquid） | 待办 |
| P1′ | **`readme` profile**（文件名识别 + 默认目录 + 徽章不编号） | **已完成** |
| P2 | 编号方案抽象（arabic / gb / cjk / chapter） | **已完成** |
| P3 | GB 专项（封面、章条编号、规范性引用文件、术语、附录） | 待办（已决策延后） |
| P4 | 文档站扩展语法（admonition / callout / wikilink） | 待办（已决策延后） |
| P5 | 论文 / 简历 / 书籍等更多 profile | 待办 |

## 6. 决策记录

| # | 议题 | 决策 |
| --- | --- | --- |
| 1 | 先做哪个阶段 | **先做 P0** |
| 2 | 文档类型识别方式 | **自动探测为主**；提供**显式 `--type`**；**不做 frontmatter 声明** |
| 3 | GB 国标支持 | **先不做**（P3） |
| 4 | 扩展语法（Liquid / admonition / 双链） | **先不做**（P4） |
| 5 | 自动探测时是否打印命中类型 | **打印**（输出行附 `type=xxx`） |

## 7. P0 落地清单（已完成）

- [x] 定义 profile 结构与注册表（`src/profiles.mjs`）
- [x] 内置 `general` 与 `skill`
- [x] 新增 `--type <name>`（显式覆盖，未知值报错）
- [x] 自动探测（显式 > 文件名 > frontmatter 键 > general）
- [x] `isSkill` 迁移进 `skill` profile，行为保持不变
- [x] 输出行打印命中类型
- [x] P2：`--number-scheme`（arabic / gb / cjk / chapter）与 `src/numbering.mjs` 抽象；CI 断言覆盖四种方案
- [x] CI 断言（显式 / 自动 / 未知类型）
- [x] README / CODEBUDDY 说明

