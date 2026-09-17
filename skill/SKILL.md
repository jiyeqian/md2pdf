---
name: md-to-pdf
description: 把 Markdown 文件排成优雅的中文 A4 PDF（报头＋元信息条＋表格/代码/引用排版＋页脚页码），支持 elegant 与 minimal 两套主题、批量转换与目录。当用户要求"把 md 转成 PDF""导出成 PDF""打印成 PDF""生成优雅的 PDF"时使用。
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

- **命令入口**：`/usr/local/bin/md2pdf`（无写权限时退到 `~/.local/bin/md2pdf`）
- **程序本体**：`~/.local/share/md2pdf/`（含 `.install-meta`，记录来源仓库与 ref）
- **源码仓库**：https://cnb.cool/jiyeqian/md2pdf （Public，唯一实现的源头）
- **本说明书**：仓库里的 `skill/SKILL.md`，安装时由 `install.sh` 复制到技能目录
  （WorkBuddy 下即 `~/.workbuddy/skills/md-to-pdf/SKILL.md`）

**没装过 / 换了机器** —— 一条命令（约 120 KB，命令与说明书一起装好）：

```bash
curl -fsSL https://cnb.cool/jiyeqian/md2pdf/-/git/raw/main/install.sh | sh
```

若 `command -v md2pdf` 为空，就是没装，跑上面这条即可。

**升级**：`md2pdf --upgrade`（读 `.install-meta` 回源覆盖安装） · **卸载**：`~/.local/share/md2pdf/uninstall.sh`

环境变量：`MD2PDF_REF=v1.2.0` 固定版本；`MD2PDF_HOME=<dir>` 改程序本体位置；
`PREFIX=<dir>` 改命令落点；`MD2PDF_SKILL=0` 不装说明书；`MD2PDF_SKILL_DIR=<dir>` 指定技能目录。

## 常用选项

| 选项 | 作用 |
| --- | --- |
| `-o, --output <path>` | 输出路径；多文件或目标是目录时作为输出目录 |
| `--theme <name>` | `elegant`（默认，墨蓝＋古铜）｜ `minimal`（黑白公文风） |
| `--title` / `--kicker` | 覆盖标题 / 报头小标题 |
| `--no-meta` / `--no-lead` | 去掉元信息条 / 首段不作为导语 |
| `-t, --toc` | 生成目录（取自 H2） |
| `--link-urls` | 链接后附 URL |
| `--landscape` / `--font-size` / `--margin` | 横向 / 字号（默认 10.5pt）/ 页边距（默认 20mm） |
| `--no-footer` / `--footer-left` / `--footer-right` | 页脚控制 |
| `--keep-html` / `--open` | 留中间 HTML 调样式 / 转完打开 |
| `--html-only` | 只出 HTML 不启动浏览器（调样式、CI 校验用） |
| `--upgrade` | 回源拉最新版覆盖本机安装 |

布尔选项支持 `--flag=false`。环境变量：`MD2PDF_CHROME`、`MD2PDF_NODE`、`MD2PDF_WS=mini`。
完整列表见 `md2pdf --help` 或项目 README。

## 排版规则（需要解释效果时看这里）

首个 H1 提升为报头大标题、其后首段成为导语；frontmatter 的 name/description 生成元信息条
（"适用于…""不用于…"自动拆两栏）；H2 自动分节；相对路径图片转 file://；
页脚页码由 CDP `Page.printToPDF` 生成（CLI `--print-to-pdf` 不支持页眉页脚模板）。

改样式：`assets/base.css`（骨架）与 `assets/theme-*.css`（配色）。
用户态改 `~/.local/share/md2pdf/assets/`；开发态（见下）改仓库即时生效。

## 开发这个工具

源码仓库就是唯一实现：

```bash
git clone https://cnb.cool/jiyeqian/md2pdf.git
cd md2pdf && ./install.sh        # 切到开发态：命令指回仓库，改代码立即生效
```

联网安装则是用户态（命令指向 `~/.local/share/md2pdf`）；两种模式跑各自的 `install.sh` 即可切换。

改完代码跑校验（几秒钟、无需浏览器）：

```bash
bash ci/validate.sh              # 本地与 CNB 云原生构建跑的是同一套
```

推送后 CNB 自动跑同一套校验；打 tag 则自动打包发 Release，用户 `md2pdf --upgrade` 即可拿到新版。
发版前记得同步 `src/md2pdf.mjs` 的 `VERSION` 与 `package.json` 的 `version`（校验会检查一致）。
