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
- `npm run test:cache-readiness-browser`、`npm run test:static-preview-browser`：真实 Chrome 正常路径要求预览成功并检查可视性；`npm run test:static-preview-retry-browser` 独立覆盖注册失败、重试和离线 ready。

## 多场景采样

可复跑脚本：`npm run bench:readiness`。脚本以每个目标自身版本端点记录提交号，固定 1440×1000 桌面视口，在 app-ready 后输入相同短文，分开报告 app-ready 与输入后的 preview-ready；正常场景要求成功事件和可视 iframe。包含三轮冷启动、一轮同 profile 热重载及一轮 150 ms/750 KB/s、4× CPU 降速。隐藏/滚动与窄屏场景不计入桌面数据，尚未采样。原始逐轮数据、平台与 Chrome 版本记录于 [performance-samples-2026-10-22.json](performance-samples-2026-10-22.json)。

| 运行方式 | 冷态 app-ready / 输入后预览 | 冷态传输 | 热态 app-ready / 输入后预览 | 热态传输 | 弱网 app-ready / 输入后预览 | 弱网传输 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Node 基线 `38c6bdb` | 134 / 627 ms | 2.20 MB | 60 / 613 ms | 0.71 MB | 2,913 / 1,883 ms | 2.15 MB |
| Node 候选 `2176d79` | 137 / 620 ms | 2.20 MB | 54 / 606 ms | 0.71 MB | 3,746 / 1,879 ms | 2.20 MB |
| 静态基线 `38c6bdb` | 149 / 705 ms | 1.98 MB | 66 / 703 ms | 0 MB | 3,933 / 1,059 ms | 1.98 MB |
| 静态候选 `2176d79` | 150 / 637 ms | 2.47 MB | 67 / 621 ms | 0 MB | 3,897 / 2,209 ms | 2.47 MB |

候选静态冷态预览约快 68 ms、热态约快 82 ms，但静态冷/弱网资源传输增加约 25%。Node 输入后预览仅有小幅变化；弱网下 Node app-ready 样本较慢，静态输入后预览也较慢。每个弱网场景只有一轮，不能据此判断稳定差异或称整体提速已证明。此轮修正了热重载导航竞态，并改为只测当前文档 app-ready 和当前样本文档完成；先前 JSON 中 warm timeout 数据作废并已被新轮次替换。旧无视口数据同样不用于预览时延结论。以上本机 loopback 与 CDP 限速结果不代表真实手机或公网链路。

## 第二轮：编辑与预览减负（2026-10-22）

### 变更与边界

- Node 与静态预览按版本身份和资源 URL 复用成功的引擎/国标标志 Data URL 转换；缓存有界，转换失败后可重试。没有缓存文档 HTML 或渲染结果。
- 编辑辅助即时分析结果与 200ms 防抖分析、补全消费者共享同一份文本分析。真实模块夹具模拟 `md-editor-change` 后触发防抖回调及补全：同一份 36KB 文本只调用分析器一次；内容变化后调用一次。它核验调用次数，不作为主线程时延/内存基准。
- 预览保留 450ms 防抖和 revision/AbortController 检查，在异步边界尽早退出。同步 JavaScript 执行期间无法被 AbortController 中断；PDF 导出不参与取消。

### 桌面可见视口对照

统一使用 1440×1000 headless Chrome。预览时延是输入后的 `md-preview-ready`。每个冷启动 3 轮取中位数；热态和弱网各 1 轮。逐轮数据见[66bc906 基线](performance-round2-baseline-66bc906.json)与[8513d42 候选](performance-round2-candidate-8513d42.json)。

| 运行时 | 基线提交 | 候选提交 | 冷态 app-ready 中位数 | 冷态输入后预览中位数 |
| --- | --- | --- | ---: | ---: |
| Node | `66bc906` | `8513d42` | 139.3 → 122.5 ms | 613.7 → 614.5 ms |
| 静态 | `66bc906` | `8513d42` | 138.2 → 148.2 ms | 638.3 → 640.6 ms |

桌面冷态预览时间基本相近。热态 Node 610.3→604.0ms、静态 626.1→632.3ms；弱网 Node 1875.2→1869.5ms、静态 2356.7→2366.1ms。单轮热态/弱网数据不支持整体速度提升结论。页面 ResourceTiming 只记录顶层页面资源，不包括 Service Worker 和后台流量，也不等同总网络流量。

### 移动与视口场景

390×844、模拟 40ms 网络延迟、1.5MB/s 和 2× CPU 场景先将 iframe 滚入视口。短文和 120KB 粘贴均成功；Node 长文 2.35s，静态 1.41s（各一轮）。在 756×413 场景强制把 iframe 移出视口后，两端均未在测量窗口内收到完成事件；这是可见性节流观察，不是渲染错误。逐轮数据见[移动与视口样本](performance-round2-mobile-8513d42.json)。该文件的候选服务身份为 `8513d42`，测量 runner 也为 `8513d42`。

### 复跑

在当前工作树、端口按示例运行本地两种 WebApp 后：

```bash
MD2PDF_PERF_BASELINE_ONLY=1 \
MD2PDF_BASELINE_NODE_URL=http://127.0.0.1:3182/ \
MD2PDF_BASELINE_STATIC_URL=http://127.0.0.1:3183/ \
MD2PDF_PERF_STAGE=pre-change-66bc906 \
MD2PDF_PERF_OUTPUT=/tmp/md2pdf-baseline.json npm run bench:readiness

MD2PDF_PERF_CANDIDATE_ONLY=1 \
MD2PDF_NODE_URL=http://127.0.0.1:3190/ \
MD2PDF_STATIC_URL=http://127.0.0.1:3191/ \
MD2PDF_PERF_OUTPUT=/tmp/md2pdf-candidate.json npm run bench:readiness

MD2PDF_PERF_CANDIDATE_ONLY=1 MD2PDF_PERF_EXTRA=1 \
MD2PDF_NODE_URL=http://127.0.0.1:3190/ \
MD2PDF_STATIC_URL=http://127.0.0.1:3191/ \
MD2PDF_PERF_OUTPUT=/tmp/md2pdf-mobile.json npm run bench:readiness
```

正常可见场景必须收到成功预览事件并确认 iframe 在视口内；仅显式的 `forceIframeOffscreen` 场景允许观测超时。分析调用复用由 `node --test tests/editor-analysis-checks.mjs` 检查。

### 验证范围与限制

`test:document-assets`、`test:static-runtime`、`test:render-cancellation`、`test:workspace-browser`、`test:local-drafts`、静态预览/重试浏览器检查、Node 缓存就绪、`test:web`（独立复核 386/386）及 `check:consistency` 通过。`test:browser` 的既有字号断言实际为 13.0164px、预期 24px，单独失败，未归因于本轮改动。工作集未测量峰值内存；同步 render/parse 阶段不能被 AbortController 中断；没有推送或部署。
