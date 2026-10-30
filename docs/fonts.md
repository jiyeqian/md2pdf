# 自定义文档字体

## 在 Markdown 中设置

四种模板、CLI、服务器版和静态版共用以下 frontmatter：

```yaml
---
fonts:
  body: "Noto Serif CJK SC"
  heading: "Noto Sans CJK SC"
  western: "Times New Roman"
  code: "Menlo"
---
```

`fonts` 是映射，不是列表；每个值是单个已安装字体的名称，**建议优先使用 PostScript Name**，也支持浏览器能识别的家族名或完整名。macOS、Linux、Windows 的获取步骤见[字体名称与安装说明](gb-fonts.md)。省略整个映射，或省略某个键，都沿用模板默认字体；空映射合法，空字符串、未知键、路径、URL、字体列表和 CSS 表达式会报错。仅设置需要覆盖的键即可。

## 作用范围

| 键 | 范围 |
| --- | --- |
| `body` | 正文及使用正文字体的段落、列表、表格、注释等 |
| `heading` | 各级标题及目次标题，统一字体家族，字号、字重和行距仍由模板决定 |
| `western` | 正文、标题中的西文字母和数字；优先于上述两项，不替换中文及其他符号 |
| `code` | 行内代码、代码块及键盘／示例代码字样；独立于 `western` |

Mermaid 文字使用正文对应字体，并在自定义字体检查完成后排版；MathJax 公式等已绘制为矢量字形的内容不由这些参数重绘。字体是否涵盖所需汉字、符号，仍取决于该字体本身；已安装字体不等于包含所有字形。

GB 的覆盖范围是正文、目次及条文页脚注；封面、正文首页文件名称、页眉标准号、页码和封底标准号等专用区域保留既有字体。GB 的字号和行距不开放修改，自定义字体后仍须自行核对标准版式，不能仅凭字号不变就认定符合 GB/T 1.1。专用区域所需的 GB 字体仍须安装。

## CLI 设置

```bash
md2pdf 文档.md --font-body "Noto Serif CJK SC" --font-heading "Noto Sans CJK SC"
md2pdf 文档.md --font-western "Times New Roman" --font-code "Menlo"
```

CLI 按键覆盖 frontmatter，未在 CLI 指定的键保留文档配置。WebApp 本轮只通过 frontmatter 设置，不增加工具栏或字体面板。以上字体仅为写法示例，项目不附带字体。

## 缺字体时

- 预览提示具体缺失字体，使用模板字体回退，并标注分页和版式可能变化；右下角提示可打开字体配置说明。
- WebApp 下载弹窗默认聚焦“下载”；确认才允许回退，取消不导出。每次导出重新检查，不改写文档的 `fonts`。
- CLI 默认提示缺失字体并停止。明确接受版式变化时，使用 `--allow-font-fallback`；此运行选项不能通过 frontmatter 开启。

```bash
md2pdf 文档.md --allow-font-fallback
```

服务器版的预览使用浏览器设备字体，PDF 使用服务器字体；静态版的预览和打印都使用浏览器设备字体。字体不会自动跨设备传输。安装步骤见[字体配置说明](gb-fonts.md)。

仅同名字体不能保证跨设备一致：字体文件／版本、字形覆盖、浏览器版本及打印设置都可能影响最终版式。
