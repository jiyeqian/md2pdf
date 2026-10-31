# 文档配置与兼容迁移

通用文档默认采用中文编号方案（`number-scheme: cjk`，如“一、”“（一）”）；frontmatter 或显式选项仍可选择其他方案。学术论文、技能文档和国家标准的默认方案保持不变。

## 配置优先级

CLI 显式参数或 Web App 显式控件 → frontmatter → 文档类型默认 → 全局默认。

未指定表示继承；空字符串是显式清空，不再回退。同一层同字段的矛盾设置报错；一致设置允许。frontmatter 重复字段无论值是否相同均报错。每层先校验再合并，CLI 不能掩盖 frontmatter 的无效配置。国家标准的固定版式规则优先于普通配置。

## 章分页与跨页表格

```yaml
---
chapter-start: odd-page
---
```

`chapter-start` 支持 `continuous`（连续排版，默认）、`page`（第二章起从新页开始）、`odd-page`（每章从奇数页开始）。`#` 是文档标题；正文 `##` 为章，`###` 及以下不强制分页。自动生成的参考文献章节也遵循相同分页策略；未设置参考文献标题时不额外触发章分页。

CLI 用 `--chapter-start page` 等参数覆盖 frontmatter；WebApp 在 frontmatter 输入 `chapter-start:` 后提供三种候选值。CLI、服务端与静态 WebApp 共用规则。奇偶按 PDF 实际页序计算，必要时补入完全空白的页面，不显示页眉或页脚；这些空白页仍计入总页数。文档标题与首章默认同页：`page` 不主动拆开两者；`odd-page` 在首章能容纳于奇数首页时同页，已有独立封面、目录或首页空间不足时仍保证奇数页起章。已经处于新页开头的首章不额外补空白页。国家标准原有前置部分、附录等起页规则在默认连续模式下保留。

Markdown 表格跨页默认重复表头，无需开关；表题只在表格起始处出现。普通数据行尽量不跨页，单行高于一页时允许拆分；续页表头占用正常排版高度。带表格或非连续章分页的 PDF 使用与 WebApp 相同的分页引擎。流式浏览仍为连续内容，不显示重复表头、章分页或补白；分页预览与 PDF 导出时生效。

## 强制分页符

在正文独占一行写入：

```markdown
上一页内容。

<!-- pagebreak -->

下一页内容。
```

CLI、服务端和静态 WebApp 均将其作为强制起新页。前后不必留空行；允许 0–3 个行首空格及行尾空格。4 个行首空格属于 Markdown 缩进代码块，不生效；围栏代码块和行内代码中的示例同样不生效。连续标记合并，末尾标记不制造额外空白页；流式阅读隐藏标记并保持连续内容。标记位于标题与首章之间时可显式分开两者；遇到奇数页章起始规则时仍对齐奇数页。此约定不开放 WebApp 的其他原始 HTML。

## 关键词与标签

所有模板的可见关键词写在 Markdown 的 `role=keywords` 章节，使用非编号列表。tags 保留为 frontmatter 字符串列表，用于文档管理；与可见关键词互不填充、不用于识别论文。

```yaml
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

## Markdown 中的文字内容

参考文献、摘要与关键词使用显式角色，全部模板通用：

```markdown
## 摘要 {role=abstract}

摘要正文支持段落、公式和正常 Markdown。

## 关键词 {role=keywords}

- 参数化建模
- 矢量图形

## 参考资料 {role=bibliography}
```

角色决定内容用途，标题决定显示文字。摘要和关键词不占章号、不进入打印目次，以不编号导航项进入编辑大纲、预览大纲及 PDF 书签；关键词要求单个非编号列表，逐项保留内容，排版时以“；”连接。参考文献条目只填入声明位置；缺少声明则保留正文上标、不生成文献列表，专业助手提示并定位首个引用，CLI 给出警告。通用与技能模板沿用普通章编号，论文与国家标准模板的文献章节不编号。

```markdown
:::kicker
技术研究报告
:::

:::colophon
left: 编制：张三
center: ""
right: 审核：李四
:::
```

kicker、colophon 各允许一个独立块，只支持纯文字。未定义的部分沿用默认值；空 kicker 块清空默认文字。colophon 单段文字默认覆盖左栏，也可用 left/center/right 键值指定位置；省略位置保留默认值，`right: ""` 明确清空生成时间。重复块、重复位置、非法字段、非文字值或未闭合时报错；代码围栏内保持字面内容。

frontmatter 的 abstract、keywords、kicker、colophon 及其三栏文字字段、bibliography-title（含 camelCase 别名）已移除，遇到时明确报错，不作为兼容输入。对应 CLI 文字参数一并移除。title、作者及单位、tags、版本、分类、GB 封面元数据及排版配置继续保留；页眉、页脚文字不在本次迁移范围。

论文自动识别要求非空 `role=abstract` 内容与作者信息同时存在；关键词不参与识别。显式选择模板优先，国家标准与技能模板按其独立依据识别；缺少论文组合依据则使用通用文档。

## 错误显示

CLI 报告配置错误并返回非零退出状态。Web App 在预览区域顶部显示配置错误及行号，点击行号定位正文；底栏提示当前配置无效。保留上次成功预览并明确标注，不生成新结果，PDF 下载暂时禁用，Markdown 下载、编辑与草稿保存继续可用。首次出错时不显示伪成功预览；修正后自动恢复。

## 旧参数兼容

旧 `--no-*` 及正向布尔参数继续作为兼容别名，但不在 help 展示；`-t/--toc` 保留为便利入口。旧 `--no-footer` 仍关闭整个页脚，不能等同于清空中间页码。

旧 `--bibliography`、`--no-bibliography` 是例外：识别并提示迁移，参考文献由 `role=bibliography` 声明位置填充，不再允许旧参数关闭或指定标题。

## 三栏开关与默认值

header、footer、colophon 的显示开关保留，frontmatter 可写 `colophon-enabled: false` 或 `disable: [colophon]`。关闭时不会因内容块存在而重新启用；国家标准仍不显示落款。

默认落款左侧为品牌链接、中间为 version（未设置时为空）、右侧为生成时间；Markdown colophon 中仅覆盖显式指定的位置。kicker 未定义时保留模板／category 的默认规则。

页眉、页脚仍支持原有三栏文字配置和 CLI 参数。页眉默认空，页脚默认居中页码；本次不迁移这些重复页元素。

## 模板与主题

模板与文档类型一一对应；每种类型可提供多个主题，国标可仅保留固定主题。模板库根据当前草稿的有效类型默认选中模板，并以反色类型标签标记；浏览其他模板不更改当前草稿。

编辑器的 `⌘/Ctrl+S` 下载当前 Markdown，`⌘/Ctrl+O` 打开 Markdown，`⌘/Ctrl+P` 下载 PDF，预览获得焦点时也可使用。全屏与窗口共用同步开关；切换布局时保留内容位置。

## 学术论文的作者与单位

旧写法 `author: 姓名` 和 `affiliation: 单位` 继续支持。不同作者对应不同单位时，使用对象列表；作者顺序就是署名顺序，单位按 `affiliations` 列表顺序自动编号：

```yaml
authors:
  - name: 张三
    affiliations: [thu, cas]
  - name: 李四
    affiliations: [cas]
  - name: 王五
    affiliations: [thu]
    corresponding: true
    email: wang@example.com
affiliations:
  - id: thu
    text: 清华大学自动化系，北京
  - id: cas
    text: 中国科学院自动化研究所，北京
```

- 一人可引用多个单位，多人可共享同一单位。ID 是字符串，不需要等于显示序号。
- 单作者，或所有作者共享完全相同的一组单位时省略单位编号；作者归属存在差异时使用数字上标，与对应单位建立文内链接。
- 未被任何作者引用的单位不显示，原文保留；过滤后连续编号。CLI 输出提醒，WebApp 专业助手的检查列表显示提醒，可定位到 `affiliations` 所在行。
- `corresponding: true` 使用独立的星号标记，并列出通讯作者姓名和可选邮箱。支持多名通讯作者。
- `authors` 与 `affiliations` 必须同时填写为非空对象列表；每位作者必须有非空 `name` 和非空单位 ID 列表。
- 新写法不能与旧 `author`／`affiliation` 同时填写，即使旧字段为空也会提示冲突。重复单位 ID、不存在或重复的单位引用、字段拼写及类型错误都会报错。
- `corresponding` 必须是布尔值；填写邮箱时必须是非空邮箱字符串。姓名与单位按纯文本处理，不执行其中的 HTML。
- 这些字段使用共用解析和排版流程，适用于 CLI、服务端 WebApp 与静态 WebApp 的学术论文模板。模板识别仍按现有规则（`abstract`／`keywords`），或显式指定 `type: paper`。

## 内容补全与验收

二级标题后输入 `{role=` 可选择摘要、关键词、参考文献；输入 `:::` 可选择 kicker、colophon，GB 同时提供专用指令。选中后插入可编辑内容及关闭行，不重复已有关闭行。已移除的文字字段不再出现在 frontmatter 补全中。

预览中的摘要、关键词保留源行定位，以不编号的二级导航项进入大纲和 PDF 书签；点击预览导航定位整个内容块，原有行内标签样式及间距不变。空内容仍按原规则不输出。更新后重启当前工作树服务；静态部署重新构建。
