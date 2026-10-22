# 可选访问与产品统计

## 方案与数据边界

WebApp 的访问统计和产品统计均采用主动同意。两项分别选择，默认均不发送；可在底部“隐私与统计”中拒绝、修改和撤回。选择只在当前来源的浏览器 localStorage 保存 180 天，其他标签页同步撤回；DNT/GPC 优先关闭统计。CLI、localhost、局域网、未列入白名单的网站和离线环境不发送。

采用自有 Cloudflare Worker + D1，同时接收基础访问和产品事件，不加载额外第三方统计脚本，不需要修改网站的 Cloudflare 代理设置。拒绝或服务不可用不影响文档编辑和导出。国家仅由 Cloudflare 为访问事件补充，产品事件不附加地理信息。

| 事件 | 允许字段 | 用途 |
| --- | --- | --- |
| `page_view` | 来源类别、限定推广渠道、设备／浏览器／系统／语言类别 | 判断推广和适配方向 |
| `template_selected` | 内置模板、主题标识 | 模板使用趋势 |
| `preview_finished` | 成功与否、耗时和文档长度区间、模板 | 排版稳定性和性能 |
| `export_started` | 服务端 PDF／浏览器打印 | 导出操作趋势 |
| `export_failed` | 导出方式、固定错误码 | 错误排查优先级 |
| `offline_ready` | 资源是否就绪 | 离线能力状态 |

版本和部署方式随事件提交。字段由浏览器和 Worker 共用的 `web/analytics-schema.mjs` 严格验证；未知字段直接拒绝。数据不含正文、标题、文件名、图片、DOI、完整 URL／来源网址、完整异常、邮箱、IP 或持久用户标识。不提供访客身份、跨设备跟踪、独立用户数或用户级漏斗。国家等细分报告至少 5 条事件才显示；不能保证类别组合在任何情况下都不可识别，因此不把“不含访客标识”宣称为法律上的完全匿名。

页面只保留首次入口的推广类别，不保存原始来源。推广链接可使用 `?utm_source=github`、`wechat`、`zhihu`、`xiaohongshu`，其余值归为 `other`，其他 UTM 字段不发送。每页访问最多记录一次；预览事件最多每 30 秒一次，所有事件每页最多 30 次／分钟。不排队补传离线行为，不重试失败请求。浏览器打印不能证明 PDF 已保存；预览耗时包含处理、加载与分页等待，不是纯渲染引擎基准。

## 配置、部署与报告

公开配置为 `web/analytics-config.json`，只包含开关、HTTPS 接收地址和站点白名单，不含令牌。服务端及静态构建共用 `src/analytics-config.mjs`；可用环境变量覆盖：

```bash
MD2PDF_ANALYTICS_ENABLED=0 ./bin/md2pdf webapp --port 3180
MD2PDF_ANALYTICS_ENABLED=0 node scripts/build-static.mjs
```

关闭开关需重启服务或重建静态产物；已有缓存窗口需按原更新流程切换新版。浏览器始终提供拒绝入口。`MD2PDF_ANALYTICS_ENDPOINT` 可覆盖接收地址，仅接受无凭据、查询参数或片段的 HTTPS `/events` 地址。服务端 CSP 仅按已启用的地址开放相应连接来源，不开放任意域名。

接收服务已部署到 `https://md2pdf-analytics.jiye-qian.workers.dev`，D1 为独立的 `md2pdf-analytics` 数据库，创建时指定欧盟辖区。Worker 在全球网络接收请求；欧盟数据库不等于全部网络处理都只在欧盟。明细按分钟保存，约 90 天加每日清理间隔；不主动创建长期事件备份，不保存用户标识。D1 自动恢复历史可能额外保留已删除记录 7 天（免费套餐）或 30 天（付费套餐），详见 [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)。每日原子写入上限 10,000 条，限流及清理详见 [接收服务运维](analytics-worker.md)。没有启用额外付费套餐；与账户中其他服务共享额度，应用写入上限不能限制所有恶意请求造成的账户消耗。

管理报告需要本机 Cloudflare 授权，没有公共查询网址：

```bash
node /Users/jiyeqian/.codex/worktrees/analytics/md2pdf/integrations/analytics-worker/report.mjs --days 7
```

远端保留一条版本为 `0.0.0-smoketest` 的合成验收事件，不含用户内容。比较真实访问前可在查询中排除此版本；不要把验收事件算作真实用户使用。

隐私说明位于 `web/privacy.html`。运营者上线前应结合用户地区核对运营主体、同意依据、服务商协议及跨境处理要求；技术措施不等同于法律认证。邮箱留资、营销订阅和邮件发送不在本次范围，不会把分析同意解释成营销同意。

## 本次验收入口

所有命令在独立工作树执行：

```bash
cd /Users/jiyeqian/.codex/worktrees/analytics/md2pdf
./bin/md2pdf webapp --port 3180
./bin/md2pdf webapp --static --port 3181
```

分别打开 <http://127.0.0.1:3180/> 与 <http://127.0.0.1:3181/>，点击底部“隐私与统计”。这两个本地入口始终不采集，可检查说明、编辑、预览及导出不受影响。正式站点提示与真实请求通过下面的浏览器夹具验收：夹具用本机 CDP 模拟 HTTPS 生产来源，不访问生产网站、不发送到线上接收器。

```bash
npm run test:analytics
npm run test:analytics-browser
npm run check:consistency
```

上线验收需从同一发布提交构建后，在正式 HTTPS 网站检查：未同意无请求、拒绝无请求、分别同意后仅对应类别发送、跨标签撤回、离线不补传、清除网站数据后重新询问，并通过认证报告核对趋势。手机实机、正式 Pages 缓存升级与浏览器系统打印仍需人工验收。本分支不自动合并 main、推送或创建发布标签。
