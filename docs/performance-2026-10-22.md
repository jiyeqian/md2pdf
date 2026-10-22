# 静态启动性能优化记录

## 已完成：静态 runtime 按端点加载

工作树从 `38c6bdb` 起步。静态 runtime 不再在模块顶层导入渲染、配置、DOI 和示例目录。版本端点只读取版本 JSON；策略、frontmatter 字段和示例端点各自按需导入；渲染核心只在 resolve/render 请求时加载。动态模块失败会清空待加载 Promise，使后续请求可以重试。

文档资源选择以共用 renderer 输出的 HTML 为准，提取实际出现的 MathJax、Mermaid 和 PagedJS `<script src>`，只下载并内嵌这些脚本。这样保留原有 data URL、严格 CSP 与三端 HTML 字节一致性，也覆盖普通预览 HTML 启用分页脚本但 `waitPaged` 为 false 的情况。GB logo 仍只在 GB 文档准备。

## 测量

使用同一台 Mac 上的 headless Chrome、独立空白配置和静态子路径 `/md2pdf/`，分别基于 `38c6bdb` 与候选版本各运行三轮冷启动。完整静态 service worker 资源校验及预缓存保持启用。数据是本机模拟，不代表手机或 Pages 部署。

| 指标 | 基线 | 候选 | 结果 |
| --- | ---: | ---: | ---: |
| `md-app-ready` 前加载的渲染相关模块数 | 5 | 2 | 少 3 个模块请求 |
| `md-app-ready` 前资源传输量 | 1,983,517 B | 1,708,033 B | 少 275,484 B（13.9%） |
| `md-app-ready` 时间中位数 | 152 ms | 163 ms | 本样本未显示更快，差异可能是测量噪声 |

三轮 app-ready 时间分别为基线 165/152/149 ms、候选 163/170/139 ms。静态 worker 仍完整预缓存资源，因此离线包总字节和缓存完整性策略没有变化。

renderer 实际引用脚本的 HTML 大小：纯文档 699,524 B（仅 PagedJS，503,181 B 原始脚本）；公式文档 3,511,430 B（MathJax 2,108,580 B + PagedJS）；Mermaid 文档 4,129,840 B（Mermaid 2,571,900 B + PagedJS）。旧逻辑每次均内嵌三引擎，纯文档约 6,940,164 B；候选纯文档减少约 89.9%。这里测的是返回 HTML 字节，不是压缩网络传输量。

## 验证

- `npm run check:consistency`：general、paper、gb、skill 的 CLI、Node 与静态 HTML、配置和错误诊断一致。
- `npm run test:web`：385/385。
- `npm run test:analytics-browser`：真实 Chrome 覆盖 Node/静态 UI、静态子路径、缓存就绪和离线刷新；线上统计请求由本地夹具拦截。
- `npm run test:static-runtime`：只内嵌 renderer HTML 实际引用的引擎，并保留 data-only script CSP。

尚未完成的验收包括首次/热缓存与弱网、草稿/加载竞态、复杂长文真实 PDF、缓存升级/失败重试，以及手动 Chrome 前后预览时延分布。本阶段不证明可输入时间或用户留存改善。
