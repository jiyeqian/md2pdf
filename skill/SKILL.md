---
name: md-to-pdf
description: 把 Markdown 文件排成优雅的中文 A4 PDF（报头＋元信息条＋表格/代码/引用排版＋页脚页码＋PDF 书签大纲），支持 elegant 与 minimal 两套主题、可点击目录与批量转换。当用户要求"把 md 转成 PDF""导出成 PDF""打印成 PDF""生成优雅的 PDF""PDF 要有目录/书签"时使用。
agent_created: true
---

# Markdown → 优雅 PDF

有现成命令 `md2pdf`，直接用，不要临时手写 HTML + 调 Chrome。

## 直接用

```bash
md2pdf 文件名.md                    # 同目录同名输出 .pdf
md2pdf 文件名.md --open             # 转完直接打开
md2pdf a.md b.md -o 输出目录/       # 批量（目录不存在会自动创建）
md2pdf 文件名.md --theme minimal --toc
```

## 程序在哪

- **命令入口**：npm 全局 bin 目录里的 `md2pdf`
- **程序本体**：npm 全局包 `@jiyeqian/md2pdf`（`node_modules/@jiyeqian/md2pdf/`）
- **源码仓库**：https://cnb.cool/jiyeqian/md2pdf （Public，唯一实现的源头）
- **本说明书**：仓库里的 `skill/SKILL.md`，安装时由 npm `postinstall` 复制到技能目录
  （WorkBuddy 下即 `~/.workbuddy/skills/md-to-pdf/SKILL.md`）

**没装过 / 换了机器** —— 一条命令（命令与说明书一起装好）：

```bash
npm install -g @jiyeqian/md2pdf
```

若 `command -v md2pdf` 为空，就是没装，跑上面这条即可。

**升级**：`npm update -g @jiyeqian/md2pdf` · **卸载**：`npm uninstall -g @jiyeqian/md2pdf`

环境变量：`MD2PDF_SKILL=0` 不装说明书；`MD2PDF_SKILL_DIR=<dir>` 指定技能目录。

## 常用选项

| 选项 | 作用 |
| --- | --- |
| `-o, --output <path>` | 输出路径；多文件或目标是目录时作为输出目录 |
| `--theme <name>` | `elegant`（默认，墨蓝＋古铜）｜ `minimal`（黑白公文风） |
| `--title` / `--kicker` | 覆盖标题 / 报头小标题 |
| `--no-meta` / `--no-lead` | 去掉元信息条 / 首段不作为导语 |
| `-t, --toc` | 文首插入目录页（取自 H2），条目可点击跳转 |
| `--no-outline` | 不生成 PDF 书签（默认生成） |
| `--bibliography [footnote\|bib]` | 参考文献模式，默认启用（footnote）；bib 为未来支持。`--no-bibliography` 关闭 |
| `--numbering <mode>` | 章节编号：auto（默认）｜ force（强制）｜ none（不加） |
| `--link-urls` | 链接后附 URL |
| `--landscape` / `--font-size` / `--margin` | 横向 / 字号（默认 10.5pt）/ 页边距（默认 20mm） |
| `--no-footer` / `--footer-left` / `--footer-right` | 页脚控制 |
| `--keep-html` / `--open` | 留中间 HTML 调样式 / 转完打开 |
| `--html-only` | 只出 HTML 不启动浏览器（调样式、CI 校验用） |

布尔选项支持 `--flag=false`。环境变量：`MD2PDF_CHROME`、`MD2PDF_NODE`、`MD2PDF_WS=mini`。
完整列表见 `md2pdf --help` 或项目 README。

## 排版规则（需要解释效果时看这里）

首个 H1 提升为报头大标题、其后首段成为导语；frontmatter 的 name/description 生成元信息条
（"适用于…""不用于…"自动拆两栏）；H2 自动分节并加 id 锚点；相对路径图片转 file://；
页脚页码由 CDP `Page.printToPDF` 生成（CLI `--print-to-pdf` 不支持页眉页脚模板）。

**目录页与书签是两件事**，别混：
- **目录页**（`-t`，默认关）＝ 文首排的一张目录，条目是文档内可点击的内链
- **PDF 书签**（默认开，`--no-outline` 关）＝ 阅读器侧边栏的章节大纲树
  由 Chrome 按 HTML 的 h1–h6 结构生成（报头标题为根，H2/H3 嵌套）；阅读器侧栏
  需用户自己展开（macOS 预览按 ⌘⌥3）。用户问"为什么侧栏是空的"时先确认是不是
  老版本 Chrome 没生成（参数不被支持时会静默退回无书签渲染）。

验一份 PDF 到底有没有书签：

```bash
node ci/inspect-pdf.mjs out.pdf   # 打印书签树、内链/外链数量
```

改样式：`assets/base.css`（骨架）与 `assets/theme-*.css`（配色）。
用户态改 npm 全局包里的 `assets/`；开发态（见下）改仓库即时生效。

## 开发这个工具

源码仓库就是唯一实现：

```bash
git clone https://cnb.cool/jiyeqian/md2pdf.git
cd md2pdf && npm link           # 切到开发态：命令指回仓库，改代码立即生效
```


改完代码跑校验（几秒钟、无需浏览器）：

```bash
bash ci/validate.sh              # 本地与 CNB 云原生构建跑的是同一套
```

推送后 CNB 自动跑同一套校验；打 tag 则自动 `npm publish` 发新版，用户 `npm update -g` 即可拿到。
发版前记得同步 `src/md2pdf.mjs` 的 `VERSION` 与 `package.json` 的 `version`（校验会检查一致）。
