---
# 模板：paper（学术论文）—— 作者信息与 Markdown 中非空的 role=abstract 摘要组合用于自动识别，
# 报头三件套（作者行 + 摘要 + 关键词）自动生成。
# 用法：md2pdf 本文件.md
# 完整示例见 examples/paper.md。
title: 论文标题
authors:
  - name: 高松年
    affiliations: [sanlu-mechanical]
  - name: 朱千里
    affiliations: [beiping]
  - name: 赵辛楣
    affiliations: [sanlu-automation]
  - name: 方鸿渐
    affiliations: [sanlu-automation, clayton]
    corresponding: true
    email: fanghongjian@clayton.edu
affiliations:
  - id: sanlu-mechanical
    text: 三闾大学机械工程系
  - id: beiping
    text: 北平国学专修社
  - id: sanlu-automation
    text: 三闾大学自动化研究所
  - id: clayton
    text: 克莱登大学机械工程系
---

## 摘要 {role=abstract}

一段 200 字左右的摘要，说明问题、方法与主要结果。

## 关键词 {role=keywords}

- 关键词一
- 关键词二
- 关键词三

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
