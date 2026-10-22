# 第三轮预览生命周期与解析复用基线

基线提交：`ad3f803`（生产代码与 `8513d42` 相同；后续 `e7b50a1`、`ad3f803` 仅调整性能测试/报告）。本记录先于本轮源码修改建立。

| 场景 | 基线观察/已有证据 | 本轮目标 |
| --- | --- | --- |
| 1440×1000 前台可见编辑器预览 | 66bc906→8513d42 冷态输入后预览：Node 613.7→614.5ms，静态 638.3→640.6ms；资源及逐轮证据见 [基线 JSON](performance-round2-baseline-66bc906.json) 和 [候选 JSON](performance-round2-candidate-8513d42.json) | 成功事件与 iframe 可见断言继续保留 |
| 手机 390×844，纵向页面滚动到预览 | 8513d42 的 120KB 粘贴单轮：Node 2.35s、静态 1.41s | 维持成功，不以脚本自动滚动冒充真机行为 |
| iframe 在视口外，父页面仍前台 | 两端旧实现未在测量窗口收到 ready；iframe 内 30s 与父级 60s 超时可能误报失败。见 [移动/视口逐轮 JSON](performance-round2-mobile-8513d42.json) | 不累积不可见时间；恢复可见时继续检查当前 revision；可见后仍有有限超时 |
| 标签页隐藏/恢复前台 | 无第三轮定量对照；旧 iframe 的 `Date.now()` 超时在后台节流期间仍推进 | 隐藏时暂停可见超时，恢复时重启计时且真实 error 保留 |
| 快速连续编辑/切换配置 | 已有 450ms debounce、revision、AbortController；同步渲染无法被 abort 抢占 | 每个编辑器实例只提交最新未开始工作；过时结果丢弃，说明已运行同步任务边界 |
| 模板卡片并行预览、PDF 导出 | 独立调用链，不应互相取消 | 每张卡片/每个导出保持独立作用域 |
| Node 同请求 resolve+render | `/api/render` 中 `resolveWebInput()` 与 `render()` 分别解析 frontmatter | 仅将解析结构随同一次调用传递，仍运行有效配置合并和校验 |
| 自动模式 `/api/resolve`→`/api/render` | 独立 HTTP 请求；没有跨请求解析上下文 | 暂保留请求序列与现有策略语义，不增加正文缓存 |

本轮新浏览器证据将记录各自 target commit、runner commit、输入 revision、iframe 可见性/文档前后台状态、成功/error/超时和处理次数。ResourceTiming 仍仅为顶层页面观测。
