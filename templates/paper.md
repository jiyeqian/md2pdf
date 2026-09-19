<!--
  模板：paper（学术论文）—— frontmatter 含 abstract 或 keywords 即自动识别，
  报头三件套（作者行 + 摘要 + 关键词）自动生成。
  用法：md2pdf 本文件.md
  完整示例见 examples/paper.md。
-->
---
title: 论文标题
author: 张三，李四
affiliation: 单位名称
abstract: 一段 200 字左右的摘要，说明问题、方法与主要结果。
keywords: 关键词一；关键词二；关键词三
---

## 引言

研究背景与动机[^keyref2020]。

## 方法

### 模型

$$ E = mc^2 \label{eq:mass} $$

由式 \eqref{eq:mass} 可知……

### 实验

![实验流程](figures/flow.png)

如图 \ref{fig:flow} 所示……

## 结论

……
