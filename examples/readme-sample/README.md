# log-analyzer

![build](https://img.shields.io/badge/build-passing-green)
![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

一个用于分析应用日志、定位异常的命令行工具。

## 特性

- 按级别与时间段过滤
- 错误类型聚合统计
- 输出可直接管道给其它命令

## 安装

```bash
npm install -g log-analyzer
```

## 用法

```bash
log-analyzer --from 2026-01-01 --level error --top 5 app.log
```

## 架构

![处理流程](../control-loop.png)

## 许可

MIT
