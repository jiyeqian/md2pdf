# 文档配置与兼容迁移

## 配置优先级

CLI 显式参数或 Web App 显式控件 → frontmatter → 文档类型默认 → 全局默认。

未指定表示继承；空字符串是显式清空，不再回退。同一层同字段的矛盾设置报错；一致设置允许。frontmatter 重复字段无论值是否相同均报错。每层先校验再合并，CLI 不能掩盖 frontmatter 的无效配置。国家标准的固定版式规则优先于普通配置。

## 关键词与标签

`keywords` 和 `tags` 使用字符串列表，支持多行列表或 `[]` 行内列表；空列表表示不设置。原来的字符串形式需改为列表。论文报头将 `keywords` 按中文分号连接显示；`tags` 仅作元数据，不改变文档类型和正文。

```yaml
keywords:
  - 仿生机械手
  - 阻抗控制
tags:
  - 机器人
  - 控制研究
```

## 开关

```sh
md2pdf document.md --enable outline --disable meta,lead
```

```yaml
---
enable: [outline]
disable:
  - meta
  - lead
---
```

文档开关包括 `header`、`footer`、`colophon`、`meta`、`lead`、`toc`、`outline`、`float-numbering`、`gb-cover`、`gb-defaults`、`link-urls`、`landscape`。CLI 的列表可用逗号分隔，并可重复传入；frontmatter 必须使用列表。未知功能名、错误类型和启用/禁用矛盾均报错。

输出路径、打开结果、保留中间 HTML、只生成 HTML、Web App 端口、skill 安装等属于运行操作，不允许由文档 frontmatter 控制。

## 文本、数值与枚举

```sh
md2pdf document.md --colophon "编制：张三" --footer-center "" --bibliography-title "参考资料"
```

```yaml
---
title: "示例文档"
colophon: "编制：张三"
footer-left: "内部资料"
footer-center: ""
bibliography-title: "参考资料"
---
```

文本配置有 `title`、`kicker`、`header-left/center/right`、`colophon-left/center/right`、`footer-left`、`footer-center`、`footer-right`、`bibliography-title`。不传参数/不声明字段表示继承；字符串表示覆盖；`""` 表示明确清空；CLI 缺值和 frontmatter 的裸字段、null、列表、对象报错。标题显式清空后不再使用一级标题或文件名作为替代标题。

文档类型、主题、编号模式、编号方案、目录深度、字号、行距、边距同样遵守优先级，但数值和枚举不接受空字符串。frontmatter 使用与 CLI 相同的不带 `--` 的字段名。普通文档元数据不因空值而一律报错。

## 页脚与文末落款

页脚左、右默认无文字，中间默认显示“当前页 / 总页数”。`footer-center` 的字符串替换页码，空字符串只清空中间；`disable: [footer]` 关闭整个页脚。设置文字不隐式开启已关闭的页脚。

文末落款默认左侧为 `make md2pdf great`，其中 md2pdf 链接至仓库；右侧为本次生成时间，包含时区。`colophon` 只覆盖左侧，空字符串不移除右侧时间。一次渲染取一个时间，预览与 PDF 分别生成，时间可以不同。国家标准不显示文末落款。

## 导语与参考文献

导语是正文中跳过各级标题后遇到的第一段顶层普通段落；代码块、列表、引用块、表格、公式块、仅图片段落和参考文献定义不算。`lead` 全局默认关闭；开启 `lead` 时移至文档标题下，原位置不重复；关闭时留在原位。国家标准仍不提取导语。

参考文献始终按当前方式自动渲染，`bibliography-title` 默认“参考文献”。空字符串隐藏标题而保留内容、编号和跳转；没有参考文献不生成空章节。

## 错误显示

CLI 报告配置错误并返回非零退出状态。Web App 在预览区域顶部显示配置错误及行号，点击行号定位正文；底栏提示当前配置无效。保留上次成功预览并明确标注，不生成新结果，PDF 下载暂时禁用，Markdown 下载、编辑与草稿保存继续可用。首次出错时不显示伪成功预览；修正后自动恢复。

## 旧参数兼容

旧 `--no-*` 及正向布尔参数继续作为兼容别名，但不在 help 展示；`-t/--toc` 保留为便利入口。旧 `--no-footer` 仍关闭整个页脚，不能等同于清空中间页码。

旧 `--bibliography`、`--no-bibliography` 是例外：识别并提示迁移，参考文献始终自动处理，不再允许旧参数关闭。新接口使用 `--bibliography-title <text>` 设置标题。

## 三栏开关与文字

`header`、`footer`、`colophon` 默认启用。整栏开关和各位置文字分别按 CLI → frontmatter → 文档类型 → 全局默认解析；文字不会隐式启用被关闭的整栏。页眉默认三处为空，全部为空时不显示、不占空间。页脚默认居中页码；落款默认左侧品牌链接、中间空、右侧生成时间。

```yaml
header-left: "内部资料"
colophon-center: "审核通过"
colophon-right: ""
disable: [footer, lead]
```

未显式设置落款中栏时，frontmatter 的 `version` 自动作为 `colophon-center` 的默认值；显式 `colophon-center: ""` 可清空。关闭落款或使用国家标准固定版式时不显示。

CLI 对应 `--header-left/--header-center/--header-right <text>` 和 `--colophon-left/--colophon-center/--colophon-right <text>`。旧 `--colophon <text>` / frontmatter `colophon: "文字"` 是左侧文字的兼容别名；同层与新参数取值矛盾时报错。国家标准不允许覆盖固定页眉，保持专用页脚且不输出落款。

## 模板与主题

模板与文档类型一一对应；每种类型可提供多个主题，国标可仅保留固定主题。模板库根据当前草稿的有效类型默认选中模板，并以反色类型标签标记；浏览其他模板不更改当前草稿。

编辑器的 `⌘/Ctrl+S` 下载当前 Markdown，`⌘/Ctrl+O` 打开 Markdown，`⌘/Ctrl+P` 下载 PDF，预览获得焦点时也可使用。全屏与窗口共用同步开关；切换布局时保留内容位置。
