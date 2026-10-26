# CLI 使用说明

## 转换 Markdown

```bash
md2pdf 文件.md                         # 输出同目录的 文件.pdf
md2pdf 文件.md --open                  # 转换后打开 PDF
md2pdf a.md b.md -o 输出目录/          # 批量转换
md2pdf 文件.md --theme minimal --toc   # 选择主题并添加目录页
```

需要 Node.js 18 或更高版本，以及 Chrome、Edge 或 Chromium。可用 `MD2PDF_CHROME` 指定浏览器可执行文件。

## 常用选项

| 选项 | 说明 |
| --- | --- |
| `-o, --output <path>` | 输出文件或目录；批量转换时指定输出目录 |
| `--type <name>` | 文档类型：`general`、`skill`、`paper`、`gb`；默认自动识别 |
| `--theme <name>` | 主题：`elegant`（默认）、`minimal`、`gb` |
| `-t, --toc` | 在文首添加可点击目录页 |
| `--numbering <mode>` | 章节编号：`auto`、`force`、`none` |
| `--number-scheme <name>` | 编号格式：`arabic`、`gb`、`cjk`、`chapter` |
| `--font-size <pt>` | 正文字号，默认 10.5 pt |
| `--margin <mm>` | 页边距，默认 20 mm；可用 `20,18` 分别设置上下、左右 |
| `--enable <features>` / `--disable <features>` | 按逗号分隔启用或关闭排版功能 |
| `--title <text>` / `--kicker <text>` | 覆盖文档标题或标题上方的小标题 |
| `--open` | 完成后打开 PDF |

查看全部参数：

```bash
md2pdf --help
```

文档也可使用 YAML frontmatter 配置标题、文档类型、作者、主题与排版选项。配置优先级和字段列表见[配置说明](configuration.md)。

## 安装 Agent Skill

按需为常用 Agent 安装 md2pdf Skill：

```bash
md2pdf skill install --target codex
md2pdf skill install --target workbuddy
md2pdf skill install --target codebuddy
md2pdf skill install --target claude
```

也可用 `--target agents` 安装到 `~/.agents/skills/md-to-pdf`，或用 `--dir <path>` 指定目录。`--target` 与 `--dir` 只能选一个。升级 npm 包后再次运行安装命令即可更新 Skill。

## 输出 HTML

```bash
md2pdf 文件.md --paged-html
```

此选项同时输出分页 HTML，使用浏览器即可查看分页结果。HTML 引用本机安装目录中的排版资源，移动文件时需保持资源路径可用。
