# 自动识别与渲染单次调用交接

基线：`0711c6b`，工作树 `/Users/jiyeqian/.codex/worktrees/4c73/md2pdf`，分支 `codex/performance`。

## 完成范围

新编辑器自动模式使用 POST `/api/preview`。共用 `resolveWebInput` 校验请求、解析 frontmatter、识别模板，再按新策略清理不适用的控件覆盖项，完成有效配置合并与校验，并把同一解析结构传给 renderer。Node 和静态适配共用这条规则。显式模式和旧客户端继续使用严格的 `/api/render`；`/api/resolve` 保留。

只清理自动模式下已通过基础类型、范围和枚举校验的控件残留值；非法数字、未知选项、未知枚举、frontmatter 语法/类型/策略错误仍报错。编号方案切换导致合并菜单不再提供旧选择时，编号与方案一同重置。响应返回 `resetOptions`，界面应用新策略并提示重置，不会在切回模板时恢复已清空的覆盖项。

专业助手原有 frontmatter 识别请求也已消除：预览响应携带已有作者诊断，编辑器在当前 revision 校验后通过本地事件传递给助手；助手只显示与当前正文匹配的诊断，正文修改时清空来源。没有把正文或诊断写入统计、服务器缓存或新的持久存储。

## 请求与解析次数

`npm run test:auto-preview` 使用真实 Node HTTP API 和构建后的静态适配器，Inspector 精确覆盖统计实际 `parseFrontmatter` 调用，不通过模拟 parser 得出次数：

| 流程 | 调用数 | frontmatter 解析次数 |
| --- | --- | --- |
| 基线识别→渲染 | `/api/resolve` + `/api/render`：2 | 2 |
| 新自动预览 | `/api/preview`：1 | 1 |
| 静态同一编辑器未开始的两次请求 | 仅最新任务进入核心 | 1 |

浏览器 fetch 记录确认普通自动预览、GB 策略切换及包含作者诊断的 frontmatter 文档均只有一次 `/api/preview`，没有额外 `/api/resolve`；显式模式只有一次 `/api/render`。此结果不代表整体耗时按相同比例缩短。

## 验证与限制

- `test:auto-preview`：Node/静态有效输出相等；GB 禁用值、paper 编号方案切换、显式与旧端点严格校验、非法 frontmatter/选项、拒收客户端解析对象、取消及 latest-only 处理次数通过。
- `test:cache-readiness-browser`：自动请求数、GB→general、显式 paper、作者诊断共享、非法 frontmatter 修正、快速连续编辑及隐藏恢复通过。
- `check:consistency` 新增四类样例 `/api/preview` 的 Node/静态 HTML、有效配置和重置项比较；原 CLI/核心/Node/静态比较保留。
- `test:web`、`test:config`、静态预览与模板卡片、Node 模板流程及历史父页暖缓存兼容回归按本次执行记录验收。

PDF 导出继续使用开始导出时的独立正文/配置快照及原识别流程，模板卡片继续使用独立 `/api/render` 与消费者 key。旧缓存父页仍可能使用旧的双调用流程；更新到新父页后启用优化。没有服务器跨请求正文缓存，没有信任客户端传入的已解析配置，不能抢占正在执行的同步 JavaScript。真实设备验收不在本次范围。

## 验收入口

最终提交后从该工作树 HEAD 重启 Node `http://127.0.0.1:3190` 与静态 `http://127.0.0.1:3191/`，分别读取 `/api/version`、`/version-data.json` 确认提交一致。源码修改后静态服务需重建并重启。

1. 自动模式输入普通文档，观察一次 `/api/preview` 完成预览。
2. 设置字号后把 frontmatter 改为 GB，确认字号清空、提示重置；改回 general 后保持跟随文档。
3. 切换显式模板，确认走 `/api/render`；输入非法 frontmatter 显示错误，修正后恢复。
4. 包含未引用作者单位时专业助手显示诊断；快速替换正文后不保留旧诊断。模板卡片、独立 PDF 和旧缓存窗口继续按原路径验收。
