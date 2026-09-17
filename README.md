# md2pdf

把 Markdown 排成**优雅的中文 A4 PDF**：报头大标题、元信息条、精心排过的表格/代码/引用/列表、页脚页码。
不是 pandoc 的默认样式 —— 是可以直接拿去打印、发给别人看的版式。

![themes](docs/themes.png)

仓库：https://cnb.cool/jiyeqian/md2pdf

## 两部分:命令 + 说明书

这个工具是两层结构,各自独立存在、各自分发:

| 层 | 是什么 | 给谁用 | 落在哪 |
| --- | --- | --- | --- |
| **命令** `md2pdf` | 真正的程序(Node + 无头 Chrome 渲染) | 你、任何脚本 | `~/.local/share/md2pdf/`,命令软链进 PATH |
| **技能说明书** `skill/SKILL.md` | 告诉 Agent「有 `md2pdf` 这个命令、怎么用」 | WorkBuddy 等 Agent 运行时 | `~/.workbuddy/skills/md-to-pdf/` |

`install.sh` 一次装两样:环境里有 WorkBuddy(`~/.workbuddy` 存在)就顺带装说明书,
没有就只装命令。只要命令用 `MD2PDF_SKILL=0` 跳过。

> 为什么说明书不在程序里?因为「怎么用」是给 Agent 看的,「能转换」是给系统跑的 ——
> 混在一起会让换机器时多一份要同步的实现。说明书只有一份,就在仓库 `skill/`。

## 安装

**一条命令**（不用 clone）：

```bash
curl -fsSL https://cnb.cool/jiyeqian/md2pdf/-/git/raw/main/install.sh | sh
```

它会下载最新源码到 `~/.local/share/md2pdf`，把 `md2pdf` 链接进 PATH，并检查 Node 与 Chrome（缺什么会直接告诉你）。
下载量约 120 KB —— 走流量也没负担。

```bash
md2pdf ~/.local/share/md2pdf/examples/demo.md --open   # 装完试一下
```

**更新**：`md2pdf --upgrade`（或重跑上面那条命令） · **卸载**：`~/.local/share/md2pdf/uninstall.sh`

> 若在 v1.2.1–v1.3.0 期间升级过，命令可能落到 `<原目录>/bin/bin`（每次升级多一层）。
> v1.3.1 起 `--upgrade` 会自动把历史遗留的多层 `/bin` 收敛回原目录，并清掉空目录。

| 变量 | 作用 |
| --- | --- |
| `MD2PDF_HOME=<dir>` | 安装位置，默认 `~/.local/share/md2pdf` |
| `MD2PDF_REF=<ref>` | 装指定分支/标签，默认 `main`（如 `MD2PDF_REF=v1.2.0`） |
| `MD2PDF_BIN_DIR=<dir>` | 命令落点目录（**精确**，优先于 `PREFIX`） |
| `PREFIX=<dir>` | 落点**前缀**，命令装在 `<dir>/bin`，默认 `/usr/local/bin`（无写权限自动用 `~/.local/bin`） |
| `MD2PDF_SKILL=0` | 不安装 Agent 技能说明书 |
| `MD2PDF_SKILL_DIR=<dir>` | 说明书落点，默认 `~/.workbuddy/skills/md-to-pdf`（`~/.workbuddy` 不存在时默认不装） |

### 在仓库里安装（开发用）

```bash
git clone https://cnb.cool/jiyeqian/md2pdf.git
cd md2pdf
./install.sh          # 把 bin/md2pdf 软链到 /usr/local/bin（无权限时自动用 ~/.local/bin）
```

这条路径下程序就是仓库本身，改完立即生效，不需要重装。

### 依赖

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 18（建议 ≥ 22） | < 22 时自动启用内置 WebSocket 实现；`MD2PDF_NODE` 可指定 |
| Chrome / Edge / Chromium | 任一 | 只用来渲染，不联网；`MD2PDF_CHROME` 可指定路径 |

零 npm 依赖 —— Markdown 解析器（marked）已内置在 `vendor/`，装好即用。

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
| `-o, --output <path>` | 输出路径；多文件或目标是目录时，作为输出目录 |
| `--theme <name>` | `elegant`（默认，墨蓝＋古铜）｜ `minimal`（黑白公文风） |
| `--title <text>` | 覆盖标题（默认：正文首个 H1 → frontmatter.title → 文件名） |
| `--kicker <text>` | 报头小标题；`SKILL.md` 默认显示「技能文档」 |
| `--no-meta` | 不要 frontmatter 元信息条 |
| `--no-lead` | 首段不作为导语放大 |
| `-t, --toc` | 文首插入目录页（取自 H2，需 2 个以上），每项可点击跳转 |
| `--no-outline` | 不生成 PDF 书签（**默认生成**，见下） |
| `--link-urls` | 正文链接后附 URL（纸质可读） |
| `--landscape` | 横向页面 |
| `--font-size <pt>` | 正文字号，默认 10.5 |
| `--margin <mm>` | 页边距，默认 20；可写 `"20,18"`（上下,左右） |
| `--no-footer` | 不要页脚页码 |
| `--footer-left / --footer-right <text>` | 页脚左右文字 |
| `--colophon <text>` | 文末落款（默认：来源文件名） |
| `--keep-html` | 保留中间 HTML，方便调样式 |
| `--html-only` | 只生成 HTML，不启动浏览器（调样式 / CI 校验用） |
| `--open` | 完成后打开 PDF |

布尔选项支持 `--flag=false`。环境变量：`MD2PDF_CHROME`、`MD2PDF_NODE`、`MD2PDF_WS=mini`。

### 目录与书签是两件事

| | 是什么 | 在哪看 | 怎么开 |
| --- | --- | --- | --- |
| **目录页** | 排在文首的一张目录，条目是**可点击的内链** | 文档第 1 页 | `-t / --toc`（默认关） |
| **PDF 书签** | PDF 阅读器侧边栏里的**章节大纲树**（可折叠、点击跳转） | 阅读器侧栏 | **默认开**，`--no-outline` 关 |

书签由 Chrome 按 HTML 的 `h1`–`h6` 结构生成（报头标题为根，H2/H3 逐层嵌套），
所以只要文档用了标准标题层级，就有对应的大纲，不需要额外配置。

需要看侧栏的阅读器操作：macOS 预览需手动展开侧栏（**⌘⌥3**，或右上角侧栏按钮）；
Acrobat / 福昕 / Chrome 内置阅读器点侧栏图标即可。侧栏是否自动展开由阅读器自身决定，
本工具不写 `/PageMode`（改这个字段要重写 PDF 目录对象，收益不值那份风险）。

自己验一份 PDF 的书签与内链：

```bash
node ci/inspect-pdf.mjs out.pdf
```

## 排版规则

- 首个 H1 提升为报头大标题，正文不再重复；其后的首段自动成为导语。
- YAML frontmatter 的 `name` / `description` 生成元信息条；description 里「适用于…」「不用于…」会自动拆成「适用 / 不适用」两栏。
- H2 自动分节并加色块标记；表格深色表头＋隔行浅底；有序列表用圆形序号。
- 相对路径图片自动解析成绝对地址，能正常进入 PDF。

## 改样式

```
assets/base.css              骨架（占位符 {{PAGE_SIZE}} {{MARGIN_*}} {{FONT_SIZE}}）
assets/theme-elegant.css     墨蓝 + 古铜（默认）
assets/theme-minimal.css     黑白公文
assets/shell.html            页面骨架
```

改完直接重跑命令，不用重启任何东西。

## 它是怎么工作的

```
Markdown ──(marked)──▶ HTML ──(模板+主题 CSS)──▶ 完整 HTML
        ──▶ 无头 Chrome（CDP Page.printToPDF）──▶ PDF
```

选 CDP 而不是 `chrome --print-to-pdf` 的原因：命令行版不支持页眉页脚模板，出不了页码。
`preferCSSPageSize: true` 让页面尺寸/边距完全由 CSS `@page` 控制。

## 校验与 CI

```bash
bash ci/validate.sh        # 本地跑，和 CI 完全同一套检查（约几秒）
```

校验分四层，全部不需要浏览器：

1. **结构**：必需文件齐全、`bin/` 与安装脚本有可执行位、关键文件确实被 git 跟踪
2. **语法**：`sh -n`、`node --check`
3. **一致性**：版本号（package.json ↔ src）；模板占位符 ↔ 替换逻辑双向闭合；
   主题 CSS 里 `var(--x)` 全部有定义；占位符替换必须是全量的
4. **行为**：`--help`/`--version` 冒烟；`examples/demo.md` 端到端渲染到 HTML，
   断言表格、代码块、引用、嵌套列表、目录、链接 URL、分节都在，且无占位符残留
   与 `undefined` 泄漏；目录锚点与标题 `id` 一一对应
5. **接线**：PDF 书签这类"只存在于 PDF 里"的特性，CI 没有浏览器验不了结果，
   就退一步断言参数真的传进了 `printToPDF`、开关真的从 `main` 接到了渲染 ——
   光有 `case '--no-outline'` 不等于接到了

最后还有一步**守卫自测**：故意破坏一份副本（塞入未定义的占位符、改错主题变量名、
改乱版本号、把目录项退回纯文本、关掉书签参数…），断言校验确实会失败 ——
只会"全绿"的校验等于没有校验。

CNB 云原生构建在 push / PR 时跑同一脚本；打 tag 时额外打包 zip 并发 Release
（见 `.cnb.yml`）。

### 发版

改完 `src/md2pdf.mjs` 的 `VERSION` 与 `package.json` 的 `version`（校验会检查两者一致），然后：

```bash
git tag v1.3.0 && git push origin v1.3.0
```

流水线会自动：校验 → `git archive` 打包 `md2pdf-v1.3.0.zip` → 创建 Release → 上传附件。
注意 CNB **不允许删除 tag**，打错了只能升版本号再发一版。

## 目录结构

```
bin/md2pdf            启动器（解析软链、挑选 node）
src/md2pdf.mjs        主程序
src/ws.mjs            Node < 22 时的极简 WebSocket 客户端
assets/               样式与页面骨架
vendor/marked.esm.js  内置 Markdown 解析器
examples/demo.md      示例文档（含表格/代码/引用/嵌套列表）
ci/validate.sh        校验入口（本地与 CI 同一套）
ci/checks.mjs         一致性 + 端到端渲染断言
ci/inspect-pdf.mjs    读出 PDF 的书签树与链接注解（本地验证 outline 用）
skill/SKILL.md        Agent 技能说明书（install.sh 会装到技能目录）
install.sh            安装（联网安装 / 仓库内安装 两用）
uninstall.sh          卸载
```

联网安装时 `install.sh` 会在安装目录额外写一个 `.install-meta`（记录来源仓库与 ref），
`md2pdf --upgrade` 靠它知道去哪儿拉新版。

## 常见问题

**装到哪了 / 怎么升级** → 联网安装的程序本体在 `~/.local/share/md2pdf`，命令在 `/usr/local/bin/md2pdf`
（无写权限时退到 `~/.local/bin`）。升级：`md2pdf --upgrade`。

**网络装不上** → 确认能访问 `cnb.cool`；也可以 `MD2PDF_REF=v1.2.0` 指定版本，
或直接 clone 仓库后 `./install.sh`。

**找不到 Chrome** → 设 `export MD2PDF_CHROME=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome`

**Node 版本老** → 升级到 22+；不想升也能用（自动走内置 WebSocket），只是没在老版本上充分测试。

**PDF 里目录不能点击** → Chrome 打印不保留内部锚点跳转，目录是纯文本。

**想改默认字号/边距** → 直接改命令行参数；要永久生效就改 `src/md2pdf.mjs` 里 `parseArgs` 的默认值。

## License

MIT

第三方组件：`vendor/marked.esm.js` 来自 [marked](https://github.com/markedjs/marked)（MIT License），随仓库分发以便零依赖安装。
