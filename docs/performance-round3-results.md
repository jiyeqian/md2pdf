# 第三轮性能与预览生命周期结果

最终实现提交：`e76bfda`（包含独立审阅修复）；此前初版 `57c88d8` 因模板卡片握手和可见计时问题已被修复提交取代。基线：`d840860` / `ad3f803`。本报告记录本轮目标、代码边界和已运行证据，不把单次浏览器启动时间当作吞吐量基准。

## 任务状态

| 项目 | 状态 | 实现与边界 | 验证证据 |
| --- | --- | --- | --- |
| A. 可见性与预览生命周期 | 完成 | iframe 通过带 revision 的消息暂停/恢复 readiness 检查；子页面真实 MathJax、Mermaid、Paged.js 错误仍立即上报。父页面只累计文档前台且 iframe 与视口相交的时间，累计 60 秒后有限超时。 | `tests/visible-time-budget-checks.mjs` 用虚拟时间覆盖连续滚动、前后台切换、视口外不累计、可见超时边界；Node `test:cache-readiness-browser`；静态 `test:static-preview-browser`。 |
| A. 模板卡片消费者 | 完成 | 卡片以自身 revision 注入运行时，并在 iframe load 后恢复其 readiness；卡片预览独立于编辑器生命周期。 | Node `test:workspace-browser`；静态浏览器检查断言卡片 iframe 成功显示且 revision 大于 0。 |
| B. 静态运行时 latest-only | 完成 | 每个消费者只保留尚未开始的最新任务；同一消费者的新任务 abort 其旧任务。编辑器 key 为 `editor`，每张卡片使用 `template:<id>`。不同 key 不互相取消。静态 PDF 走独立 `renderDocument(..., false)` 调用，不参加预览调度。 | `tests/latest-render-scheduler-checks.mjs` 断言排队旧工作调用次数为 0、运行中旧信号收到 abort、模板消费者仍独立完成、外部取消在启动前传递。Node 与静态卡片浏览器检查均通过。 |
| C. 请求内 frontmatter 复用 | 完成 | Node `/api/render`、`/api/pdf` 和静态 `/api/render` 只传递本次请求解析结果；源 Markdown 不完全相同则重新解析。配置合并和校验照常运行，独立 `/api/resolve` 与 `/api/render` 不共享上下文。 | `test:config` 的解析复用等价性、诊断和不匹配回退测试；`check:consistency` 覆盖 CLI、核心、Node API 和静态构建。 |

## 测试结果

- `npm run test:web`：393 项通过。
- `npm run check:consistency`：general、paper、gb、skill 四类样例的 CLI/共用核心/Node/静态结果一致，版本与提交号一致。
- `npm run test:workspace-browser`：Chromium 通过 Node WebApp 编辑器、模板卡片、模板切换与布局流程。
- `npm run test:static-preview-browser`：静态预览、离线就绪和模板卡片实时预览通过；最后观测主预览 ready 约 892ms，离线就绪约 1256ms，卡片 ready 约 4199ms。Node readiness 浏览器检查观测主预览约 741ms。这些是单次浏览器观测，不作性能基准。
- `npm run test:document-assets`（3 项）、`npm run test:render-cancellation`（1 项）、`npm run test:static-runtime` 均通过。
- `git diff --check` 通过。

## 已知边界与验收

JavaScript 同步执行期间不能被 `AbortController` 抢占；latest-only 可合并尚未开始的任务，并在动态模块加载、渲染阶段已有的异步检查点停止已过时任务。过时响应也不会作为新任务结果显示。不同模板、编辑器和 PDF 不共享 latest key 或取消信号。没有引入跨请求解析或正文缓存。

`check:consistency` 不覆盖浏览器后台节流、真实 PDF 版面与书签、手机打印和部署缓存；这些仍按 [跨运行时交接文档](cross-runtime-handoff.md) 人工验收。上一轮 `test:web` 中的字号断言差异不是本轮改动引入；本轮最终在获准 loopback 环境的完整 `test:web` 结果为 393/393。

Node 与静态验收入口：`http://127.0.0.1:3190`、`http://127.0.0.1:3191/`。两者需从本报告对应的最终提交 `e76bfda` 启动；静态源码变化需重新构建并重启。
