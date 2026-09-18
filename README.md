# md2pdf

把 Markdown 排成**优雅的中文 A4 PDF**：报头大标题、元信息条、精心排过的表格/代码/引用/列表、页脚页码，还支持数学公式与参考文献。不是 pandoc 的默认样式——是可以直接拿去打印、发给别人看的版式。

## 特色功能

- **BibTeX 脚注 → GB/T 7714—2025 参考文献**：脚注内容写成 BibTeX（`@article{...}`、`@book{...}` 等），自动按国标《信息与文献 参考文献著录规则》著录，并汇总为文末「参考文献」章节。
- **参考文献双向链接**：正文引用编号可跳到参考文献，参考文献编号也可跳回正文原文位置（PDF 内链）。
- **参考文献自动排序**：编号按正文「首次引用顺序」自动排列（类 LaTeX），markdown 里的定义顺序不受影响。
- **渲染 LaTeX 公式**：内置 MathJax，`$...$` 行内公式与 `$$...$$` 独立公式原样渲染，独立公式**自动编号**（`\label{eq:x}` 定义、`\eqref{eq:x}` 交叉引用），SVG 输出、零字体依赖。
- **图表编号与引用**：支持 mermaid 图、普通图片、矢量图（SVG）三类图与表格，统一自动编号为题注「图 N / 表 N：…」，正文用 `\ref{fig:x}` / `\ref{tab:x}` 交叉引用并链接到原图（类 LaTeX）。
- **代码语法高亮**：代码块按语言自动着色（内置 highlight.js，支持 Python、JavaScript、Bash 等常见语言）。
- **相对路径图片自动解析**：Markdown 里的相对路径图片自动转成绝对地址，正常嵌入 PDF。

| elegant（默认，墨蓝 + 古铜） | minimal（黑白公文风） |
| :---: | :---: |
| [![elegant 主题效果](https://cnb.cool/jiyeqian/md2pdf/-/git/raw/main/docs/theme-elegant.png)](https://cnb.cool/jiyeqian/md2pdf/-/git/raw/main/examples/demo-elegant.pdf) | [![minimal 主题效果](https://cnb.cool/jiyeqian/md2pdf/-/git/raw/main/docs/theme-minimal.png)](https://cnb.cool/jiyeqian/md2pdf/-/git/raw/main/examples/demo-minimal.pdf) |

仓库：https://cnb.cool/jiyeqian/md2pdf

## 安装

```bash
npm install -g @jiyeqian/md2pdf   # 需要 Node ≥ 18（建议 ≥ 22）
```

装上即可用 `md2pdf` 命令；npm 的 `postinstall` 会把技能说明书装进 `~/.workbuddy`（存在时，供 Agent 使用）。

```bash
md2pdf 你的文档.md --open   # 装完试一下
```

**更新**：`npm update -g @jiyeqian/md2pdf` · **卸载**：`npm uninstall -g @jiyeqian/md2pdf`

| 变量 | 作用 |
| --- | --- |
| `MD2PDF_SKILL=0` | 安装时不装 Agent 技能说明书 |
| `MD2PDF_SKILL_DIR=<dir>` | 说明书落点，默认 `~/.workbuddy/skills/md-to-pdf` |

**依赖**：Node.js ≥ 18（建议 ≥ 22），以及 Chrome / Edge / Chromium 任一（只渲染、不联网）。零 npm 运行时依赖——`marked` 与 MathJax 已内置在 `vendor/`。

## 用法

```bash
md2pdf 文件名.md                    # 同目录输出同名 .pdf
md2pdf 文件名.md --open             # 转完直接打开
md2pdf a.md b.md -o 输出目录/       # 批量（共用一个浏览器实例，很快）
md2pdf 文件名.md --theme minimal --toc
```

### 选项

| 选项 | 作用 |
| --- | --- |
| `-o, --output <path>` | 输出路径；多文件或目标是目录时作为输出目录 |
| `--theme <name>` | `elegant`（默认）｜ `minimal` |
| `--type <name>` | 文档类型：`general`｜`skill`；**默认自动探测**，`--type` 可显式覆盖 |
| `--title <text>` / `--kicker <text>` | 覆盖标题 / 报头小标题 |
| `--no-meta` / `--no-lead` | 不要元信息条 / 首段不作为导语 |
| `-t, --toc` | 文首插入目录页（取自 H2），条目可点击跳转 |
| `--no-outline` | 不生成 PDF 书签（默认生成） |
| `--bibliography [footnote\|bib]` | 参考文献模式，**默认启用**（`footnote`，不加参数也生效）；`bib` 为未来支持 |
| `--no-bibliography` | 关闭参考文献模式（脚注作为普通脚注） |
| `--numbering <mode>` | 章节编号：`auto`（默认，识别到已有编号则不动）｜ `force`（强制）｜ `none`（不加） |
| `--number-scheme <n>` | 编号方案：`arabic`（默认，`1` / `1.1`）｜ `gb`（章条制）｜ `cjk`（`一、` / `（一）`）｜ `chapter`（`第1章`）
| `--link-urls` | 正文链接后附 URL（纸质可读） |
| `--landscape` / `--font-size <pt>` / `--margin <mm>` | 横向 / 字号（默认 10.5）/ 页边距（默认 20） |
| `--no-footer` / `--footer-left` / `--footer-right` | 页脚控制 |
| `--colophon <text>` | 文末落款 |
| `--keep-html` / `--html-only` | 留中间 HTML 调样式 / 只出 HTML（CI 校验用） |
| `--open` | 完成后打开 PDF |

文档类型默认**自动探测**，优先级：`--type` 显式指定 > 文件名 `SKILL.md` > frontmatter 含 `name`（判为 `skill`）> 兜底 `general`。

布尔选项支持 `--flag=false`。环境变量：`MD2PDF_CHROME`、`MD2PDF_NODE`、`MD2PDF_WS=mini`。

### 目录与书签是两件事

| | 是什么 | 在哪看 | 怎么开 |
| --- | --- | --- | --- |
| **目录页** | 文首一张目录，条目是**可点击内链** | 文档第 1 页 | `-t / --toc`（默认关） |
| **PDF 书签** | 阅读器侧栏的**章节大纲树** | 阅读器侧栏 | **默认开**，`--no-outline` 关 |

书签由 Chrome 按 `h1`–`h6` 结构生成，无需额外配置。验一份 PDF 的书签与内链：

```bash
node ci/inspect-pdf.mjs out.pdf
```

## 排版规则

- 首个 H1 提升为报头大标题；其后的首段自动成为导语。
- YAML frontmatter 的 `name` / `description` 生成元信息条；「适用于…/不用于…」自动拆两栏。
- H2 自动分节加色块；表格深色表头＋隔行浅底；有序列表圆形序号。
- 章节编号分两维：是否编号与格式由 `--numbering` 与 `--number-scheme` 控制。
- 代码块按语言自动语法高亮（内置 highlight.js，支持 Python/JS/Bash 等常见语言）。
- 数学公式：`$...$`（行内）与 `$$...$$`（独立成行）由内置 MathJax 渲染；独立公式自动编号，`\label{eq:x}` 定义、`\eqref{eq:x}` 引用（SVG 输出，零字体依赖）。
- 脚注：`[^id]` 引用 + `[^id]: 内容` 定义；BibTeX 脚注（`@article{...}` 等）按 GB/T 7714-2025 著录，默认收集为「参考文献」章节（`--no-bibliography` 关闭）。编号按正文首次引用顺序自动排列。
- 图表：三类图统一编号为题注「图 N：…」——普通图片与矢量图（SVG）的题注写在 alt 里，mermaid 图写在代码块上一行「图：说明」；表格前一行写「表：说明」即编号「表 N：…」。`\ref{fig:x}` / `\ref{tab:x}` 交叉引用并链接到原图。
- 相对路径图片自动解析进 PDF。

改样式：`assets/base.css`（骨架）与 `assets/theme-*.css`（配色），改完重跑命令即生效。

## 开发

```bash
git clone https://cnb.cool/jiyeqian/md2pdf.git
cd md2pdf
npm link              # 命令指向仓库，改代码立即生效
bash ci/validate.sh   # 本地与 CI 同一套校验（无需浏览器）
```

发版：同步 `src/md2pdf.mjs` 的 `VERSION` 与 `package.json` 的 `version`，然后 `git tag v1.x.x && git push origin v1.x.x`，CNB 流水线会自动 `npm publish`（需配置 `NPM_TOKEN`）。

## 常见问题

**找不到 Chrome** → `export MD2PDF_CHROME=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome`

**Node 版本老** → 升级到 22+；不升也能用（自动走内置 WebSocket）。

**想改默认字号/边距** → 改命令行参数；永久生效改 `src/md2pdf.mjs` 里 `parseArgs` 的默认值。

## License

MIT。第三方组件：`vendor/marked.esm.js`（marked，MIT）、`vendor/mathjax/tex-svg.js`（MathJax，Apache-2.0），均随仓库分发以便零依赖安装。
