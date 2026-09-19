![render](https://img.shields.io/badge/tool-%40jiyeqian%2Fmd2pdf-blue)
![types](https://img.shields.io/badge/types-general%20%7C%20skill%20%7C%20readme%20%7C%20paper%20%7C%20gb-green)

# md2pdf 示例导览

本目录是 `@jiyeqian/md2pdf` 的类型样例集：`--type` 的每一类文档在这里都有一个可渲染的例子，
在 `../templates/` 中有与之对应的起步模板（一一对应，见下表）。渲染产物 PDF 与源文件放在一起，
对照阅读即可看到每种类型的完整版式。

## 文件一览

| type | 模板（起步骨架） | 示例（完整排版效果） | 产物 PDF |
| --- | --- | --- | --- |
| general | [`../templates/general.md`](../templates/general.md) | [`general.md`](general.md) | [general-elegant.pdf](general-elegant.pdf) / [general-minimal.pdf](general-minimal.pdf) |
| skill | [`../templates/skill.md`](../templates/skill.md) | [`skill.md`](skill.md) | [skill.pdf](skill.pdf) |
| readme | [`../templates/readme.md`](../templates/readme.md) | 本文件（README.md） | [README.pdf](README.pdf) |
| paper | [`../templates/paper.md`](../templates/paper.md) | [`paper.md`](paper.md) | [paper.pdf](paper.pdf) |
| gb | [`../templates/gb.md`](../templates/gb.md) | [`gb.md`](gb.md) | [gb.pdf](gb.pdf) |

## 各示例展示了什么

### general.md —— 通用文档（默认类型）

综合演示：数学公式（\label/\eqref 自动编号与引用）、图表自动编号与正文引用、mermaid 流程图、
代码高亮、表格、BibTeX 脚注自动生成 GB/T 7714 参考文献章节、正文多处引用同一文献。
以 elegant / minimal 两种主题各渲染一份，便于对比主题风格。

### skill.md —— 技能说明书

frontmatter 含 name/description 即自动识别。演示技能文档的推荐结构：何时使用、快速开始、
参数表、输出说明；报头自动带「技能文档」标识与元信息条。

### README.md（本文件）—— 项目 README

文件名为 README.md 即自动识别：默认加目录，顶部徽章（shields.io）自动识别且**不参与**图表编号，
正文中的真实插图仍正常编号。你现在看到的这份排版就是渲染效果。

### paper.md —— 学术论文

frontmatter 含 abstract/keywords 自动识别，报头三件套（作者行、摘要、关键词）自动生成。
演示公式编号引用、图片与表格的题注编号及正文引用、按首次引用顺序排序的参考文献。

### gb.md —— 国家标准

frontmatter 含「标准号」自动识别。自动生成封面（GB 标志、题头、标准号、中英文名称、
发布/实施日期与机构块）、目次（点线 + 真实页码，前置部分罗马页码）、奇偶页眉、
章条与附录编号（前言/引言不编号、附录 A 及其下 A.1）。版式细节见 ../docs/gb-template.md。

## 如何起步

1. 从 ../templates/ 复制对应类型的模板；
2. 按注释填 frontmatter 与章节骨架；
3. npx @jiyeqian/md2pdf 你的文件.md 出 PDF —— 类型自动识别，无需 --type。

## 其他文件

- control-loop.png、grasp-pose.svg：被 general / paper 示例引用的插图（相对路径自动解析进 PDF）；
- 各 .pdf：对应示例的渲染产物，与源 md 一同提交，便于不装工具直接查看效果。

## 重新生成

改了任何示例或样式后，在仓库根目录执行：

```bash
bash ci/build-demo-assets.sh    # 按输入时间增量重渲，无关样例自动跳过
```

