---
title: 面向非结构化环境的仿生抓取控制方法
author: 张三，李四，王五
affiliation: 清华大学 自动化系
abstract: 针对非结构化环境下抓取成功率偏低的问题，本文提出一种融合阻抗控制与深度强化学习的抓取方法。该方法以阻抗控制器为底层执行层，以强化学习策略在线整定刚度与阻尼参数。在自建数据集上，抓取成功率较基线方法提升 6.2 个百分点，单指响应延迟维持在 12 ms 以内。
keywords: 仿生机械手；阻抗控制；深度强化学习；抓取
---

## 引言

非结构化环境下的稳定抓取长期受限于接触状态的不确定性，传统位置控制在接触瞬间易产生过大的冲击力[^hogan1985]。

## 方法

### 阻抗控制

机械手的关节动力学可写为：

$$\tau = K_p\,(\theta_d - \theta) + K_d\,(\dot{\theta}_d - \dot{\theta}) $$

其中 $K_p$ 为刚度系数，$K_d$ 为阻尼系数。

### 学习策略

以抓取成功率与能耗的加权和为回报，用近端策略优化在线整定 $K_p$、$K_d$。

## 实验

表：不同方法的抓取成功率对比 {#tab:metrics}

| 方法 | 抓取成功率 | 平均延迟 |
| --- | --- | --- |
| 位置控制（基线） | 92.4% | 9.8 ms |
| 阻抗控制 | 96.1% | 10.4 ms |
| 本文方法 | 98.6% | 10.9 ms |

由表 \ref{tab:metrics} 可见，本文方法在成功率上优于两类基线，延迟仍在可接受范围内。

## 结论

本文提出的融合方法在非结构化抓取任务上取得了稳定提升，后续将扩展到多指协同场景。

[^hogan1985]: @article{hogan1985,
  author = {Hogan, Neville},
  title = {Impedance Control: An Approach to Manipulation},
  journal = {Journal of Dynamic Systems, Measurement, and Control},
  year = {1985},
  volume = {107},
  number = {1},
  pages = {1--24}
  }
