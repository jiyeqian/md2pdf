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

## 缓存准备延后

Node 与静态 WebApp 共用 `web/cache-readiness.mjs`，启动时先读取 ready 标志，再订阅事件；确定性测试覆盖 app/preview 先后、初始全 ready、预览错误、空白/有内容文档兜底、隐藏标签页与 60 秒硬兜底。预览显式失败时立即准备缓存；worker 的资源清单、校验、原子完成标记和升级流程未变。

真实 Chrome 的正常预览验收固定为 1440×1000 前台桌面视口，并要求 `md-preview-ready` 与 iframe 位于视口内；Node 与静态分别约 716 ms、853 ms 后成功，service worker 注册/缓存 ready 均发生在预览成功后。此前没有固定视口的约 31 秒预览超时样本受到 iframe 位于默认视口下方及 Chrome 可见性节流影响，不能作为预览耗时结论，已作废。隐藏标签页、滚动到可见和窄屏场景应单独测量，不与正常桌面样本合并；目前尚无这些场景的对比样本。

## 验证

- `npm run check:consistency`：general、paper、gb、skill 的 CLI、Node 与静态 HTML、配置和错误诊断一致。
- `npm run test:web`：385/385。
- `npm run test:analytics-browser`：真实 Chrome 覆盖 Node/静态 UI、静态子路径、缓存就绪和离线刷新；线上统计请求由本地夹具拦截。
- `npm run test:app-shell`：当前 service worker 资源路由、桌面/独立窗口几何、前后台切换及离线编辑行为。
- `npm run test:local-drafts`：IndexedDB 草稿恢复、跨客户端冲突检测和删除竞态。
- `npm run test:static-runtime`：只内嵌 renderer HTML 实际引用的引擎，并保留 data-only script CSP。
- `npm run test:cache-readiness`：共享门控状态与定时器的确定性覆盖。
- `npm run test:cache-readiness-browser`、`npm run test:static-preview-browser`：真实 Chrome 时间线、显式预览结果、错误可见性与缓存注册顺序。

## 多场景采样

可复跑脚本：`npm run bench:readiness`。脚本以每个目标自身版本端点记录提交号，固定 1440×1000 桌面视口，在 app-ready 后输入相同短文，分开报告 app-ready 与输入后的 preview-ready；正常场景要求成功事件和可视 iframe。包含三轮冷启动、一轮同 profile 热重载及一轮 150 ms/750 KB/s、4× CPU 降速。隐藏/滚动与窄屏场景不计入桌面数据，尚未采样。原始逐轮数据、平台与 Chrome 版本记录于 [performance-samples-2026-10-22.json](performance-samples-2026-10-22.json)。

| 运行方式 | 冷态 app-ready 中位 | 冷态输入后预览中位 | 冷态资源传输中位 | 弱网 app-ready | 弱网输入后预览 | 热重载 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Node 基线 `38c6bdb` | 123 ms | 610 ms | 2.20 MB | 2,889 ms | 1,886 ms | app-ready timeout |
| Node 候选 `95babae` | 137 ms | 629 ms | 2.20 MB | 3,544 ms | 2,352 ms | 57 ms / 608 ms 预览 |
| 静态基线 `38c6bdb` | 127 ms | 706 ms | 1.98 MB | 3,872 ms | 1,362 ms | app-ready timeout |
| 静态候选 `95babae` | 133 ms | 642 ms | 2.46 MB | 3,706 ms | 2,290 ms | app-ready timeout |

候选静态冷态预览约快 64 ms，但传输量增加约 24%；Node 冷态变化较小。弱网样本中候选预览更慢，且每格只有一轮，不能据此推断稳定差异。静态热重载未就绪，基线 Node 热重载未就绪；不作热态比较。旧无视口数据不适用于预览时延结论。以上本机 loopback 与 CDP 限速结果不代表真实手机或公网链路。
