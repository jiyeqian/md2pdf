# md2pdf

[![CNB CI · main](https://cnb.cool/jiyeqian/md2pdf/-/badge/git/latest/ci/status/push?branch=main)](https://cnb.cool/jiyeqian/md2pdf/-/build)
[![npm 版本](https://img.shields.io/npm/v/@jiyeqian/md2pdf)](https://www.npmjs.com/package/@jiyeqian/md2pdf)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/jiyeqian/md2pdf/blob/main/LICENSE)

把 Markdown 排成**优雅的中文 A4 PDF**：报头大标题、元信息条、精心排过的表格/代码/引用/列表、页脚页码，还支持数学公式与参考文献。不是 pandoc 的默认样式——是可以直接拿去打印、发给别人看的版式。

仓库：[GitHub](https://github.com/jiyeqian/md2pdf) · 在线体验：[md2pdf 工作台](https://md2pdf.app.workbuddy.host/)

## 特色功能

- **安装即用的 Web App**：全局安装后运行 `md2pdf webapp`，即可在 `http://127.0.0.1:3000` 使用 Markdown 编辑、分页预览与 PDF 导出；可用 `md2pdf webapp --port 3001` 指定端口（1.14.1 起提供）。
- **BibTeX 脚注 → GB/T 7714—2025 参考文献**：脚注内容写成 BibTeX（`@article{...}`、`@book{...}` 等），自动按国标《信息与文献 参考文献著录规则》著录，并汇总为文末「参考文献」章节。
- **DOI 一键引用**：输入 DOI 或 doi.org 链接，查询公开文献元数据并写回可编辑的 BibTeX 脚注，自动生成国标参考文献；复用相同 DOI，支持一次撤销。查询失败保留正文，可重试、仅插入 DOI 或手动填写 BibTeX；缺少字段明确提示，不猜填。
- **参考文献双向链接**：正文引用编号可跳到参考文献，参考文献编号也可跳回正文原文位置（PDF 内链）。
- **参考文献自动排序**：编号按正文「首次引用顺序」自动排列（类 LaTeX），markdown 里的定义顺序不受影响。
- **渲染 LaTeX 公式**：内置 MathJax，`$...$` 行内公式与 `$$...$$` 独立公式原样渲染，独立公式**自动编号**（`\label{eq:x}` 定义、`\eqref{eq:x}` 交叉引用），SVG 输出、零字体依赖。
- **图表编号与引用**：支持 mermaid 图、普通图片、矢量图（SVG）三类图与表格，统一自动编号为题注「图 N / 表 N：…」，正文用 `\ref{fig:x}` / `\ref{tab:x}` 交叉引用并链接到原图（类 LaTeX）。
- **代码语法高亮**：代码块按语言自动着色（内置 highlight.js，支持 Python、JavaScript、Bash 等常见语言）。
- **相对路径图片自动解析（CLI）**：Markdown 里的相对路径图片自动转成绝对地址，正常嵌入 PDF。
- **五类文档与类型约束**：支持通用文档、README、技能文档、论文和国家标准；按类型应用模板，在线工作台只显示该类型可配置的选项，国家标准的主题、字号、页边距与编号规则按模板固定。
- **国家标准专用版式**：根据 frontmatter 生成标准封面和页眉，支持章条编号、前言、引言、目次与附录结构；示例使用演示元数据，不代表正式发布的标准。
- **高效 Markdown 编辑**：语法高亮、行号、撤销重做、查找替换、折叠展开、快捷键与分组图标工具栏；一键插入表格、公式、脚注、BibTeX 和专业片段。
- **专业助手**：展示标题大纲与公式、图表、脚注引用信息，提供交叉引用补全及跳转，提示缺失目标、重复标识、不受支持的引用和手写章节号不一致；提示不代表标准合规结论。
- **便捷插图**：直接粘贴截图、拖入图片或点击「插入图片」，自动生成带唯一图号标识的 Base64 Markdown；支持 PNG、JPEG、GIF、WebP，并将长图片数据折叠显示，保持编辑区整洁。
- **逐页预览与专注模式**：A4 纸张分隔预览、按标题章节近似同步定位，编辑区与预览区可分别全屏；预览和 PDF 支持文内引用跳转，预览栏直接下载 PDF。
- **专业示例库**：浏览五类文档的 Markdown 源码及对应分页效果，一键载入工作台继续编辑。
- **浏览器会话草稿**：在当前浏览器会话中保存正文和选项，刷新或往返示例库可恢复；存储额度不足时提示保存失败，建议另存重要内容。

| elegant（默认，墨蓝 + 古铜） | gb（国家标准版式） |
| :---: | :---: |
| [![elegant 主题效果](https://cnb.cool/jiyeqian/md2pdf/-/git/raw/main/docs/theme-elegant.png)](https://cnb.cool/jiyeqian/md2pdf/-/git/raw/main/examples/general-elegant.pdf) | [![国家标准示例封面](https://raw.githubusercontent.com/jiyeqian/md2pdf/main/docs/theme-gb.png)](https://github.com/jiyeqian/md2pdf/blob/main/examples/gb.pdf) |

点击效果图查看完整 PDF；国家标准示例的 Markdown 源码见 [examples/gb.md](https://github.com/jiyeqian/md2pdf/blob/main/examples/gb.md)。

## 安装

```bash
npm install -g @jiyeqian/md2pdf   # 需要 Node ≥ 18（建议 ≥ 22）
```

装上即可用 `md2pdf` 命令；Skill 需通过命令显式安装，npm 安装或更新不会自动修改 Agent 技能目录。

```bash
md2pdf 你的文档.md --open   # 装完试一下
```

**更新**：`npm update -g @jiyeqian/md2pdf` · **卸载**：`npm uninstall -g @jiyeqian/md2pdf`

安装 Agent Skill（按需选择目标）：

```bash
md2pdf skill install --target codex
md2pdf skill install --target workbuddy
md2pdf skill install --target codebuddy
md2pdf skill install --target claude
```

| target | 用户级安装目录 |
| --- | --- |
| `codex` | `~/.codex/skills/md-to-pdf` |
| `workbuddy` | `~/.workbuddy/skills/md-to-pdf` |
| `codebuddy` | `~/.codebuddy/skills/md-to-pdf` |
| `claude` | `~/.claude/skills/md-to-pdf`（Claude Code） |
| `agents` | `~/.agents/skills/md-to-pdf` |

自定义目录：`md2pdf skill install --dir /path/to/md-to-pdf`。必须指定 `--target` 或 `--dir`，不可同时指定。
文件内容相同则提示已是最新；内容不同时默认保留，确认覆盖后追加 `--force`。
更新 npm 包后再次运行安装命令更新 Skill；失败会返回非零状态。卸载 npm 包不会删除已有 Skill。
旧的 `MD2PDF_SKILL`、`MD2PDF_SKILL_DIR` 环境变量不再使用。

**依赖**：Node.js ≥ 18（建议 ≥ 22），以及 Chrome / Edge / Chromium 任一（只渲染、不联网）。零 npm 运行时依赖——`marked` 与 MathJax 已内置在 `vendor/`。

## 本地在线编辑器

全局安装后即可启动本地工作台（需要 Node.js ≥ 18 和 Chrome / Edge / Chromium；此命令随 1.14.1 起的版本提供）：

```bash
md2pdf webapp             # 默认端口 3000
md2pdf webapp --port 3001 # 自定义端口
```

仅监听 `127.0.0.1`，按 `Ctrl+C` 停止。端口被占用时会明确报错，可换用其他端口；推荐使用 1024 以上的端口。在源码仓库仍可用 `npm start` 启动。

打开 `http://127.0.0.1:3000`，左侧编辑 Markdown，右侧分页预览，点击「下载 PDF」导出。支持五类文档，按类型提供主题、目录、字号、页边距和章节编号选项；国家标准使用固定版式。默认加载完整示例，包含公式、Mermaid 和参考文献。

```bash
PORT=3100 npm start                         # 更换端口
MD2PDF_CHROME="/path/to/chrome" npm start    # 指定浏览器
npm run test:web                           # HTTP 与安全边界测试
npm run test:browser                       # 真实 Chrome 与五类 PDF 验收
```

服务默认仅监听本机。内容会发送到本地服务处理，服务器不保存正文或编辑历史，草稿与选项保存在当前浏览器会话中；HTML 在内存中生成；Chrome 使用临时隐私会话，任务成功后清空页面，浏览器重启或服务正常退出时清理目录；强制终止后的目录不保证自动清理。网页端不加载远程图片或本机相对图片，支持内嵌 PNG/JPEG/GIF/WebP 图片；不支持的图片显示为占位并保留图号；原始 HTML 按文本显示。公式中的外部资源、链接及自定义宏不支持。预览运行在隔离 iframe 中。

非 GB 文档的分页预览使用 Paged.js，PDF 使用 Chrome 原生分页，分页和字体可能有差异，以导出 PDF 为准。GB 版式的字体仍取决于本机安装情况。在线体验见文档开头链接；自行部署到公网时需验证运行环境与隔离边界。

npm 包包含本地工作台和示例库资源，保留零 npm 运行时依赖。验收步骤与验证边界见 [本地验收记录](docs/web-app-acceptance.md)。

### 通过 DOI 插入参考文献

点击编辑工具栏的 DOI 图标 → 输入 DOI 或完整 `https://doi.org/...` 链接 → 点击“解析并插入”。应用在光标处加入脚注引用，并在文末追加 BibTeX 定义；以后预览、导出或分享 Markdown 无需再次查询。也可使用 BibTeX 图标手动填写，普通脚注图标仍用于自由注释。

首版自动补全期刊论文、会议论文和图书。查询需要联网，仅将 DOI 发送到 Crossref／DataCite；普通编辑、预览和 PDF 导出不自动查询。元数据可能缺项，生成结果仍需核对。没有有效标题或出版年份、文献类型不支持、DOI 不存在或网络超时时，不写入不完整结果；选择“仅插入 DOI”后仍可导出，但会提示尚未补全参考文献。

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
| `--theme <name>` | `elegant`（默认）｜ `minimal`｜ `gb`（国标版式） |
| `--type <name>` | 文档类型：`general`｜`skill`｜`readme`｜`paper`｜`gb`；**默认自动探测**，`--type` 可显式覆盖 |
| `--title <text>` / `--kicker <text>` | 覆盖标题 / 报头小标题 |
| `--no-meta` / `--no-lead` | 不要元信息条 / 首段不作为导语 |
| `-t, --toc` | 文首插入目录页（取自 H2），条目可点击跳转 |
| `--no-outline` | 不生成 PDF 书签（默认生成） |
| `--bibliography [footnote\|bib]` | 参考文献模式，**默认启用**（`footnote`，不加参数也生效）；`bib` 为未来支持 |
| `--no-bibliography` | 关闭参考文献模式（脚注作为普通脚注） |
| `--numbering <mode>` | 章节编号：`auto`（默认，识别到已有编号则不动）｜ `force`（强制）｜ `none`（不加） |
| `--number-scheme <n>` | 编号方案：`arabic`（默认，`1` / `1.1`）｜ `gb`（章条制）｜ `cjk`（`一、` / `（一）`）｜ `chapter`（`第1章`）
| `--link-urls` | 正文链接后附 URL（纸质可读） |
| `--landscape` / `--font-size <pt>` / `--margin <mm>` | 横向 / 字号（默认 10.5）/ 页边距（默认 20；可写 "20,18" = 上下,左右） |
| `--no-footer` / `--footer-left` / `--footer-right` | 页脚控制 |
| `--colophon <text>` | 文末落款 |
| `--keep-html` / `--html-only` | 留中间 HTML 调样式 / 只出 HTML（CI 校验用） |
| `--open` | 完成后打开 PDF |

文档类型默认**自动探测**，优先级：`--type` 显式指定 > 文件名 `SKILL.md`（`skill`）／`README.md`（`readme`）> frontmatter 含 `name`（`skill`）> 兜底 `general`。`readme` 默认加目录，且顶部徽章（shields.io 等）不参与图表编号；frontmatter 含 `abstract` 或 `keywords` 判为 `paper`（作者行 +「摘要」块 +「关键词」行）；含 `标准号`/`standard` 判为 `gb`（国标版式：封面 + 奇偶页眉 + 章条/附录编号 + 目次真实页码，由内置 Paged.js 接管分页，仅 gb 启用）。详见 `docs/gb-template.md`。

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

## 模板与示例

`--type` 的每一类文档，[`templates/`](templates/) 里有一个起步骨架、[`examples/`](examples/README.md) 里有一个完整示例，一一对应：

| type | 模板 | 示例 |
| --- | --- | --- |
| general | [templates/general.md](templates/general.md) | [examples/general.md](examples/general.md) |
| skill | [templates/skill.md](templates/skill.md) | [examples/skill.md](examples/skill.md) |
| readme | [templates/readme.md](templates/readme.md) | [examples/README.md](examples/README.md)（即示例目录导览） |
| paper | [templates/paper.md](templates/paper.md) | [examples/paper.md](examples/paper.md) |
| gb | [templates/gb.md](templates/gb.md) | [examples/gb.md](examples/gb.md) |

起步：复制模板 → 按注释填 frontmatter 与章节 → `md2pdf 你的文件.md`（类型自动识别）。示例目录的完整导览见 [examples/README.md](examples/README.md)。

### md → 分页 HTML

`md2pdf 你的文件.md --paged-html` 额外产出一份**分页 HTML**：浏览器打开即与 PDF 同款分页、页码
（`第 x / y 页`、页脚左右文字），gb 类型还带封面/奇偶页眉。原理是同一套 CSS 交给 Paged.js
在浏览器里分页。注意 HTML 里的 MathJax / Mermaid / Paged.js 以本机绝对路径引用（vendor 目录），
拷到别的机器需保持相对位置。`--keep-html` 仍为未分页的调试 HTML，两者并存。

## 开发

```bash
git clone https://github.com/jiyeqian/md2pdf.git
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
