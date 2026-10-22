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
- `npm run test:cache-readiness-browser`：Node 预览和缓存注册顺序通过；浏览器检查将 `document.visibilityState` 切到 hidden，开始新 revision 并保持 1.2 秒，再切回 visible，预览成功且没有 error。该 Chromium 构建不支持 `Emulation.setPageVisibilityState`，因此此集成场景验证状态事件与恢复，不等同真实后台标签页节流；隐藏区间预算由虚拟时间单测覆盖。
- `npm run test:static-preview-browser`：静态预览、离线就绪和模板卡片实时预览通过；最后观测主预览 ready 约 892ms，离线就绪约 1256ms，卡片 ready 约 4199ms。Node readiness 浏览器检查观测主预览约 741ms。这些是单次浏览器观测，不作性能基准。
- `npm run test:document-assets`（3 项）、`npm run test:render-cancellation`（1 项）、`npm run test:static-runtime` 均通过。
- `git diff --check` 通过。

## 已知边界与验收

JavaScript 同步执行期间不能被 `AbortController` 抢占；latest-only 可合并尚未开始的任务，并在动态模块加载、渲染阶段已有的异步检查点停止已过时任务。过时响应也不会作为新任务结果显示。不同模板、编辑器和 PDF 不共享 latest key 或取消信号。没有引入跨请求解析或正文缓存。

`check:consistency` 不覆盖浏览器后台节流、真实 PDF 版面与书签、手机打印和部署缓存；这些仍按 [跨运行时交接文档](cross-runtime-handoff.md) 人工验收。既有 PDF 页间距断言限制独立保留，不归为字号问题；本轮在获准 loopback 环境的完整 `test:web` 结果为 393/393。

## 旧窗口与新服务的预览协议兼容修复

用户实际 IAB 曾报告 Node 预览等待超时，静态端正常；发布方随后读取原页面和普通刷新均正常。历史 Paged.js `e.getAttribute is not a function` 日志没有本次失败 revision 或新的时间证据，不能据此确定根因，本次没有修改 Paged.js 或分页启动次数。

源码确认一条独立、确定的兼容缺口：`web/app-worker.js` 为既有窗口固定旧 GET 缓存，而 POST `/api/render` 始终请求新服务。`ad3f803` 父页没有 visibility 消息，新服务生成的 iframe 默认 `suspended=true`，因此已完成分页也无法发送 ready。该缺口可复现用户描述的挂起，但缺少现场失败标志，不能认定就是用户那次 IAB 事件的根因。

修复改为显式协议启用：iframe 的 `MD2PDF_PREVIEW_MANAGED` 默认 false，新编辑器和模板卡片在注入 HTML 时设为 true。旧父页不启用协议时正常检查就绪；新版保持暂停/恢复、父窗口来源和 revision 校验，无定时强制解除隐藏暂停。

- 新增 `npm run test:preview-version-compat-browser`：在临时端口、新 Chrome profile 中使用真实历史 `ad3f803:web/app.js` 与当前 API。修复前 10 秒内没有 ready/error，状态为“正在加载公式、图表与分页…”；修复后成功。测试还安装真实 Service Worker 暖缓存，将服务器切到新 `app.js` 后重载，断言 `app.js` 网络请求次数没有增加、历史父页仍未启用 managed 协议且预览成功。该开发回归需要 Git 中保留 `ad3f803` 对象。
- 新版 Node 浏览器检查新增断言：hidden 状态生成的新 revision 在恢复 visible 前既不 ready 也不 error，且 iframe 明确启用 managed 协议；恢复后成功。
- Node 模板、静态主预览/离线与卡片浏览器回归均通过。实际 IAB 重启后仍交由发布方继续验收。

Node 与静态验收入口：`http://127.0.0.1:3190`、`http://127.0.0.1:3191/`。交付时两者应从当前工作树 HEAD 启动；可分别读取 Node `/api/version` 和静态 `/version-data.json` 核对版本与提交号。静态源码变化需重新构建并重启。
