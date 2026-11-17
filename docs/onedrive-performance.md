# OneDrive 访问优化比较

## 结果

基线为 `54412e8`，优化版本以包含本报告的提交为准。结果来自固定每次请求延迟 20ms 的合成接口；每个场景独立运行 5 次，取耗时中位数。图片为 6 张微小 PNG，路径均为 `images/pN.png`。数据不代表真实 OneDrive 网络速度，不包含登录交互、真实大图传输和完整文档分页耗时。

| 场景 | 优化前请求数 | 优化后请求数 | 优化前耗时 | 优化后耗时 |
| --- | ---: | ---: | ---: | ---: |
| 同一会话连续读取目录 3 次 | 6 | 4 | 128ms | 85ms |
| 打开一份纯 Markdown 正文 | 2 | 2 | 43ms | 43ms |
| 首次加载 6 张图片 | 36 | 21 | 770ms | 194ms |
| 两个重叠预览加载同一组图片 | 72 | 21 | 764ms | 192ms |
| 图片已缓存后修改正文并再次取图 | 0 | 0 | <1ms | <1ms |

首次图片阶段耗时约减少 75%；重叠预览不再重复下载同一图片。目录场景请求减少三分之一。纯 Markdown 下载和已缓存图片场景没有测得改善；若这些文档仍显慢，需要另测真实网络、全文转换和分页，不能将本表作为完整编辑体验提速结论。

## 实现边界

- 同一登录客户端复用根目录 ID 及其正在进行的查询；失败可重试，目录的 401/403/404 会清除缓存。
- 图片批次内复用祖先校验、目录查找及正在进行的查询；下一批未缓存图片仍重新检查边界。
- 全部重叠预览共用最多 3 个图片加载任务；相同路径共享进行中的下载和成功结果，失败不缓存。
- 取消旧预览不会中断新预览仍需要的下载；全部消费者已取消的排队任务不发请求。已开始的请求不保证立即中断，过时结果不能提交。
- 保留单图 10 MiB、合计 16 MiB、100 个路径和有界内存缓存。云端图片更新后仍需重新打开 Markdown。
- 创建、重命名、回收和覆盖保存仍做新鲜目录／版本校验；条件写入及正文读回验证未移除。

## 复现

在当前工作树运行（基线提交须在本地 Git 历史中）：

```sh
node scripts/benchmark-onedrive.mjs before 54412e8
node scripts/benchmark-onedrive.mjs after
node --test tests/onedrive-performance-checks.mjs
```

脚本只访问本地合成接口，不读取真实文档、令牌或 OneDrive 数据。默认 JSON 结果位于系统临时目录的 `md2pdf-onedrive-performance/`，可用 `MD2PDF_BENCH_OUTPUT` 指定输出目录。本次原始结果为 `/private/tmp/md2pdf-onedrive-performance/before.json` 和 `after.json`。

## 验证与验收

核心性能、路径、图片及服务端测试，以及两版云文件浏览器、侧栏和实际 PDF 导出测试通过；`npm run check:consistency` 通过。UI 打印测试桩化系统对话框并检查实际打印桥事件；服务器下载及两版打印 PDF 另外使用真实 Chrome 生成并核对图片。

工作树 `/Users/jiyeqian/.codex/worktrees/onedrive/md2pdf`，静态启动 `./bin/md2pdf webapp --port 3000 --static`，服务器启动 `./bin/md2pdf webapp --port 3000`；同端口先停止旧服务。刷新 `http://localhost:3000/` 后连接 OneDrive，比较目录切换、首次打开多图 Markdown 和连续编辑。真实账户、真实网络和实体手机仍需用户验收。
