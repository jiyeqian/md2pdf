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
- **四类文档与类型约束**：支持通用文档、技能文档、学术论文和国家标准；按类型应用模板，在线工作台只显示该类型可配置的选项，国家标准的主题、字号、页边距与编号规则按模板固定。
- **国家标准专用版式**：根据 frontmatter 生成标准封面和页眉，支持章条编号、前言、引言、目次与附录结构；示例使用演示元数据，不代表正式发布的标准。
- **高效 Markdown 编辑**：语法高亮、行号、撤销重做、查找替换、折叠展开、快捷键与分组图标工具栏；一键插入表格、公式、脚注和 BibTeX。
- **frontmatter 精准补全**：输入字段片段即可推荐支持的字段；确认后，文本值自动加半角双引号并定位光标，枚举、布尔值和 `toc-depth` 的 `1`／`2` 直接选择，`enable`／`disable` 列表逐项推荐合法功能名。值补全自动补齐冒号后的空格，减少字段名、取值和 YAML 格式错误。
- **就近快捷操作**：选中文字后显示字符或多行标记图标；`/`、`/r`、`/e`、`/b` 提供代码块、图表内容、公式与参考文献插入入口，`\r`、`\e`、`\b` 通过图标选择引用操作，再选择已有目标。工具栏逐个图标换行，保持紧凑对齐。
- **专业助手**：展示标题大纲与公式、图表、脚注引用信息，提供交叉引用补全及跳转，提示缺失目标、重复标识、不受支持的引用和手写章节号不一致。专业助手与预览大纲通过各自面板全屏按钮左侧的图标打开，在面板内部右侧悬浮显示，可拖动左边缘调宽；关闭按钮、再次点击入口、Esc 或点击侧栏外部可关闭。全屏切换和 M/P 交换保留开关状态及宽度。
- **便捷插图**：直接粘贴截图、拖入图片或点击「插入图片」，自动生成带唯一图号标识的 Base64 Markdown；支持 PNG、JPEG、GIF、WebP，并将长图片数据折叠显示，保持编辑区整洁。
- **逐页预览与专注模式**：A4 纸张分隔预览，顶部、底部与页间灰色留白固定为 12px；编辑与预览缩放可调范围为 20%—200%；预览以固定页面尺寸为 100%，空间不足时自动缩小并显示实际百分比，空间恢复后回到用户所选比例。按标题章节近似同步定位，编辑区与预览区可分别全屏；预览和 PDF 支持文内引用跳转，预览栏直接下载 PDF；大纲侧栏按实际预览标题分层显示，点击可跳转，无需生成目录页。
- **行号与折叠栏显隐**：编辑底栏左侧按钮可隐藏或恢复整栏；首次小屏（宽度不超过 600px）默认隐藏，其余默认显示，手动选择后记住状态。编辑与预览工具栏按钮在小屏下保持 28×28px，方便点击。
- **手机与竖屏布局**：窄屏下编辑与预览自动上下排列，通过 M（Markdown）、P（预览）按钮交换面板顺序，或在两种全屏模式间快速切换，减少上下滚动；退出全屏恢复原布局，同步定位图标随排列方向旋转。已验证 390px 窄屏布局，手机软键盘、触摸拖动及横竖屏切换仍需真机验收。
- **专业示例库**：浏览四类文档的 Markdown 源码及对应分页效果，一键载入工作台继续编辑。
- **主屏幕 App**：支持添加到手机主屏幕，以独立窗口打开，适配安全区和键盘视口，重新打开恢复浏览器草稿；可信 HTTPS 下首次准备后支持离线启动与编辑，并提供保存草稿后更新的提示；支持时可在导出后选择系统分享，否则沿用文件下载。预览与 PDF 导出仍需服务在线；局域网访问及手机验收见 [主屏幕 App](docs/home-screen-app.md)。
- **本地文档保存**：正文和排版选项自动保存在用户浏览器，关闭后重新打开可恢复；工具栏提供“从模板创建 Markdown”菜单和独立“创建空文件”按钮，菜单可直接选择模板或浏览模板库，创建前保留当前草稿；“打开 Markdown”菜单提供文件打开与最近 10 份已保存草稿，长标题悬停可看全名。改标题更新同一草稿；支持逐条删除和“清除列表草稿”，仅删除当前显示项，后续草稿自动补位。下载 Markdown 可另存为文件备份；服务器不保存草稿，浏览器存储不可用时退回会话保存并明确提示。

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

打开 `http://127.0.0.1:3000`，左侧编辑 Markdown，右侧分页预览，点击「下载 PDF」导出。支持四类文档，按类型提供主题、目录、字号、页边距和章节编号选项；国家标准使用固定版式。默认加载完整示例，包含公式、Mermaid 和参考文献。

```bash
PORT=3100 npm start                         # 更换端口
MD2PDF_CHROME="/path/to/chrome" npm start    # 指定浏览器
npm run test:web                           # HTTP 与安全边界测试
npm run test:browser                       # 真实 Chrome 与五类 PDF 验收
```

服务默认仅监听本机。内容会发送到本地服务处理，服务器不保存正文或编辑历史，草稿与选项保存在此浏览器的 IndexedDB 中（不可用时退回会话存储），不会跨浏览器、设备或不同网站地址同步；HTML 在内存中生成；Chrome 使用临时隐私会话，任务成功后清空页面，浏览器重启或服务正常退出时清理目录；强制终止后的目录不保证自动清理。网页端不加载远程图片或本机相对图片，支持内嵌 PNG/JPEG/GIF/WebP 图片；不支持的图片显示为占位并保留图号；原始 HTML 按文本显示。公式中的外部资源、链接及自定义宏不支持。预览运行在隔离 iframe 中。

非 GB 文档的分页预览使用 Paged.js，PDF 使用 Chrome 原生分页，分页和字体可能有差异，以导出 PDF 为准。GB 版式的字体仍取决于本机安装情况。在线体验见文档开头链接；自行部署到公网时需验证运行环境与隔离边界。

npm 包包含本地工作台和示例库资源，保留零 npm 运行时依赖。验收步骤与验证边界见 [本地验收记录](docs/web-app-acceptance.md)。

### 通过 DOI 插入参考文献

点击编辑工具栏的 DOI 图标 → 输入 DOI 或完整 `https://doi.org/...` 链接 → 点击“解析并插入”。应用在光标处加入脚注引用，并在文末追加 BibTeX 定义；以后预览、导出或分享 Markdown 无需再次查询。也可使用 BibTeX 图标手动填写，普通脚注图标仍用于自由注释。

首版自动补全期刊论文、会议论文和图书。查询需要联网，仅将 DOI 发送到 Crossref／DataCite；普通编辑、预览和 PDF 导出不自动查询。元数据可能缺项，生成结果仍需核对。没有有效标题或出版年份、文献类型不支持、DOI 不存在或网络超时时，不写入不完整结果；选择“仅插入 DOI”后仍可导出，但会提示尚未补全参考文献。

使用模板替换编辑器内容前，编辑页和模板页使用统一确认框；取消保留当前内容。

预览工具栏按模板 → 主题 → 目录 → 编号 → 字号 → 边距 → 行距排列，统一使用图标按钮，并与标题栏共用动态列网格、保留空列；缩放滑条按左右按钮间空白宽度的 30% 自动调整。悬停查看名称和当前值，前四项点击后直接列出可选项，选择即生效；后三项点击展开滑块。字号、边距、行距滑块仅在拖动或键盘调整时显示当前值，保留两端范围及重置操作。

面板标题栏使用 M（Markdown）、P（预览）按钮：普通模式点击任一按钮交换两个面板的位置，窄屏时交换上下顺序；全屏模式点击按钮切换到另一面板全屏。退出全屏恢复进入前的顺序及各面板宽度，编辑与预览状态保留最新内容。上下排列时，同步定位图标旋转 90°。

### 编辑快捷操作

- 选中文字后，附近显示图标：选区不含换行时为链接、粗体、斜体、删除线；包含换行时为无序列表、有序列表、引用块。字符操作保持原文字选区；块操作处理选区涉及的完整行，再次使用同类标记可移除。代码块、公式块和 frontmatter 内或跨越这些区域时不显示。
- 插入与引用采用对称的图标入口：正文空白行 `/` 插入代码块，`/r` 选择表格、图片、图表，`/e` 插入公式块；正文任意位置 `/b` 选择参考文献、BibTeX参考文献、DOI参考文献。输入后点击图标，或用左右方向键与 Enter 确认；Esc、点击外部或继续输入其他文字关闭入口并保留原文字。frontmatter、代码块、公式块内不触发；原 `/m` 由 `/r` 的图表入口替代。
- 正文输入 `\r`、`\e`、`\b`，分别显示图表引用、公式引用、文献引用图标；确认后按编号、标题或文献标识选择已有目标，生成 `\ref{…}`、`\eqref{…}`、`[^…]`。工具栏提供相同引用动作；没有目标时保留空括号和光标，不创建假目标。
- YAML frontmatter 顶层输入字段名片段时，按完全匹配、前缀匹配、包含匹配推荐所有支持类型的字段，不依赖当前文档类型。已出现的字段仍可推荐，重复字段由配置校验提示；最多同时显示五项，用上下方向键浏览、Enter 确认、Esc 关闭。确认文本字段后插入半角双引号 `""`，光标停在引号内；枚举与布尔字段立即推荐合法值，`toc-depth` 推荐数字 `1`、`2`。`version` 为文本字段，供下载文件名使用。列表字段自动插入缩进的 `- `；`enable`／`disable` 立即推荐允许的文档功能，Enter 续写后再次推荐。字段与值分别推荐；统一推荐 `colophon-enabled`、`ICS`、`CCS`，旧写法仍可读取。
- 基础格式面板中，有序列表之后提供右缩进、左缩进图标，行为与 Tab、Shift+Tab 一致。每次快捷标记可一步撤销。

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
| `--type <name>` | 文档类型：`general`｜`skill`｜`paper`｜`gb`；**默认自动探测**，`--type` 可显式覆盖 |
| `--title <text>` / `--kicker <text>` | 覆盖标题 / 报头小标题 |
| `--enable <功能列表>` / `--disable <功能列表>` | 开启 / 关闭功能，支持逗号分隔，例如 `--disable meta,lead` |
| `-t, --toc` | 文首插入目录页（取自 H2），条目可点击跳转 |
| `--bibliography-title <text>` | 参考文献自动渲染；设置章节标题，默认“参考文献”，空字符串隐藏标题 |
| `--numbering <mode>` | 章节编号：`auto`（默认，识别到已有编号则不动）｜ `force`（强制）｜ `none`（不加） |
| `--number-scheme <n>` | 编号方案：`arabic`（默认，`1` / `1.1`）｜ `gb`（章条制）｜ `cjk`（`一、` / `（一）`）｜ `chapter`（`第1章`）
| `--enable link-urls` | 正文链接后附 URL（纸质可读） |
| `--enable landscape` / `--font-size <pt>` / `--margin <mm>` | 横向 / 字号（默认 10.5）/ 页边距（默认 20；可写 "20,18" = 上下,左右） |
| `--footer-left <text>` / `--footer-center <text>` / `--footer-right <text>` | 设置页脚文字；中间未指定时显示页码；`--disable footer` 关闭整个页脚 |
| `--header-left/center/right <text>` | 页眉三栏文字，默认空且不占空间 |
| `--footer-left/center/right <text>` | 页脚三栏文字，默认居中页码 |
| `--colophon-left/center/right <text>` | 落款三栏文字，默认左侧仓库链接、右侧生成时间 |
| `--keep-html` / `--html-only` | 留中间 HTML 调样式 / 只出 HTML（CI 校验用） |
| `--open` | 完成后打开 PDF |

文档类型默认**自动探测**，优先级：`--type` 显式指定 > frontmatter 的 `type` > 文件名 `SKILL.md`（`skill`）> frontmatter 含 `name`（`skill`）> 兜底 `general`。frontmatter 含 `abstract` 或 `keywords` 判为 `paper`（作者行 +「摘要」块 +「关键词」行）；含 `标准号`/`standard` 判为 `gb`（国标版式：封面 + 奇偶页眉 + 章条/附录编号 + 目次真实页码，由内置 Paged.js 接管分页，仅 gb 启用）。详见 `docs/gb-template.md`。

文档配置支持 frontmatter，优先级为 CLI/Web 显式设置 → frontmatter → 文档类型默认 → 全局默认。文本参数传 `""` 明确清空，缺值报错；旧布尔参数保留兼容。详见[配置与迁移说明](docs/configuration.md)。环境变量：`MD2PDF_CHROME`、`MD2PDF_NODE`、`MD2PDF_WS=mini`。

### 目录与书签是两件事

| | 是什么 | 在哪看 | 怎么开 |
| --- | --- | --- | --- |
| **目录页** | 文首一张目录，条目是**可点击内链** | 文档第 1 页 | `-t / --toc`（默认关） |
| **PDF 书签** | 阅读器侧栏的**章节大纲树** | 阅读器侧栏 | **默认开**，`--disable outline` 关 |

书签由 Chrome 按 `h1`–`h6` 结构生成，无需额外配置。验一份 PDF 的书签与内链：

```bash
node scripts/inspect-pdf.mjs out.pdf
```

## 排版规则

- 首个 H1 提升为报头大标题；第一段顶层普通段落作为导语，lead 默认关闭，开启时移到标题下，原位置不重复。
- YAML frontmatter 的 `name` / `description` 生成元信息条；「适用于…/不用于…」自动拆两栏。
- H2 自动分节加色块；表格深色表头＋隔行浅底；有序列表圆形序号。
- 章节编号分两维：是否编号与格式由 `--numbering` 与 `--number-scheme` 控制。
- 代码块按语言自动语法高亮（内置 highlight.js，支持 Python/JS/Bash 等常见语言）。
- 数学公式：`$...$`（行内）与 `$$...$$`（独立成行）由内置 MathJax 渲染；独立公式自动编号，`\label{eq:x}` 定义、`\eqref{eq:x}` 引用（SVG 输出，零字体依赖）。
- 脚注：`[^id]` 引用 + `[^id]: 内容` 定义；BibTeX 脚注（`@article{...}` 等）按 GB/T 7714-2025 著录，默认收集为「参考文献」章节，标题由 `--bibliography-title` 配置。编号按正文首次引用顺序自动排列。
- 图表：三类图统一编号为题注「图 N：…」——普通图片与矢量图（SVG）的题注写在 alt 里，mermaid 图写在代码块上一行「图：说明」；表格前一行写「表：说明」即编号「表 N：…」。`\ref{fig:x}` / `\ref{tab:x}` 交叉引用并链接到原图。
- 相对路径图片自动解析进 PDF。

改样式：`assets/base.css`（骨架）与 `assets/themes/*.css`（配色），改完重跑命令即生效。

## 模板与示例

`--type` 的每一类文档，[`templates/`](templates/) 里有一个起步骨架、[`examples/`](examples/README.md) 里有一个完整示例，一一对应：

| type | 模板 | 示例 |
| --- | --- | --- |
| general | [templates/general.md](templates/general.md) | [examples/general.md](examples/general.md) |
| skill | [templates/skill.md](templates/skill.md) | [examples/skill.md](examples/skill.md) |
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
bash scripts/validate.sh   # 本地与 CI 同一套校验（无需浏览器）
```

模板库首页截图随程序提供，浏览时不生成。修改 `examples/`、模板、字体或渲染代码后，在发布前执行 `npm run generate:template-previews`（需要 Chrome），并提交 `web/template-previews/` 中更新的图片。截图复用 WebApp 的渲染流程；普通部署只需提供静态图片。

发版：同步 `src/md2pdf.mjs` 的 `VERSION` 与 `package.json` 的 `version`，然后 `git tag v1.x.x && git push origin v1.x.x`，CNB 流水线会自动 `npm publish`（需配置 `NPM_TOKEN`）。

## 常见问题

**找不到 Chrome** → `export MD2PDF_CHROME=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome`

**Node 版本老** → 升级到 22+；不升也能用（自动走内置 WebSocket）。

**想改默认字号/边距** → 改命令行参数；永久生效改 `src/md2pdf.mjs` 里 `parseArgs` 的默认值。

## License

MIT。第三方组件：`vendor/marked.esm.js`（marked，MIT）、`vendor/mathjax/tex-svg.js`（MathJax，Apache-2.0），均随仓库分发。frontmatter 解析使用 `vendor/yaml/` 中的 `yaml`（ISC），无需安装外部运行依赖；维护者可运行 `node scripts/build-yaml.mjs` 重新构建固定版本资源。
