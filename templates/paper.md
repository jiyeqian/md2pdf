<!--
  模板：paper（学术论文）—— frontmatter 含 abstract 或 keywords 即自动识别，
  报头三件套（作者行 + 摘要 + 关键词）自动生成。
  用法：md2pdf 本文件.md
  完整示例见 examples/paper.md。
-->
---
title: 论文标题
authors:
  - name: 方鸿渐
    affiliations: [clayton, sanlu]
    corresponding: true
    email: fang@example.com
  - name: 赵辛楣
    affiliations: [sanlu]
  - name: 孙柔嘉
    affiliations: [clayton]
affiliations:
  - id: clayton
    text: 克莱登大学机械工程系
  - id: sanlu
    text: 三闾大学自动化研究所
abstract: 一段 200 字左右的摘要，说明问题、方法与主要结果。
keywords:
  - 关键词一
  - 关键词二
  - 关键词三
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
