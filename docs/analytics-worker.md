# 产品统计接收服务

## 数据与边界

接收器位于 `integrations/analytics-worker/`，使用 Cloudflare Worker 和 D1。仅接收用户同意后的白名单事件，字段约定以 `web/analytics-schema.mjs` 为准。不保存 IP、User-Agent、Cookie、账号标识、URL、文件名、正文或错误文本。仅在用户同意访问统计后，page_view 可携带站点内随机 UUID v4 浏览器标识；产品事件拒绝任何访客标识。标识不跨站共享，不代表自然人。IP 仅作为 Cloudflare 临时限流键。国家仅在基础访问统计 page_view 中取 Cloudflare 提供的粗粒度两位国家代码，缺失则为 XX；产品事件始终为 XX，单独同意产品统计不会产生地理统计；不接受请求正文或请求头声称的国家。数据库时间精度为分钟，事件不是独立用户或会话。

接受任意有效 HTTP/HTTPS Origin，包括 localhost、127.0.0.1、局域网和自建站点；拒绝缺失、null、其他协议及含路径的伪造 Origin。不保存原始 Origin、内网主机名和端口；仅存客户端申报的 site 分类 official-server、official-static、local、self-hosted。旧记录为 legacy。Origin 检查和 CORS 不能防止脚本伪造请求，因此数据用于趋势判断，不用于财务或精确转化归因。GitHub Pages 同源下其他项目也可能发送请求。

每个请求最多 2 KiB，实际读取流也受限；每个 IP 每分钟约 30 次，Cloudflare 限流为分布式近似限制，不是全球精确计数。同一网络用户可能共享额度。缺少限流绑定时拒绝接收。应用不记录请求载荷，配置关闭 Worker observability；Cloudflare 平台自身的安全、账单等处理另受其协议约束。

原始事件每日清理，保存不超过约 90 天加一次定时任务间隔。不主动创建长期副本，无公共查询接口。D1 无法关闭的自动恢复历史可能在删除后额外保留记录 7 天（免费套餐）或 30 天（付费套餐），以 [Time Travel 规则](https://developers.cloudflare.com/d1/reference/time-travel/) 为准。恢复数据库后应立即补执行过期记录清理，避免恢复过期事件。需配置 Cloudflare 免费额度通知、监控 D1 容量和定时任务；流量增加时可暂停 Worker，前端统计失败不会影响产品。另有原子全局每日 10,000 条写入上限，达到后返回 429；配合清理通常最多约 91 万条原始事件。清理任务失败会延长保留期限，必须监控并补执行清理。免费额度耗尽时统计请求会失败。

## 首次部署

在已登录 Cloudflare 的终端中执行（Wrangler 使用当前受支持版本）：

```bash
cd /Users/jiyeqian/.codex/worktrees/analytics/md2pdf/integrations/analytics-worker
npx wrangler d1 create md2pdf-analytics
```

将输出的 database_id 填入 `wrangler.jsonc`，不要填写猜测值。多账号登录时按 CLI 提示选择正确账号。`namespace_id` 是本服务的限流命名空间，账号中若已用于其他规则，应另选唯一正整数。

```bash
npx wrangler d1 migrations apply md2pdf-analytics --remote
npx wrangler deploy
```

将发布所得 HTTPS `/events` 地址配置到 WebApp 的分析设置。`GET /health` 仅检查 Worker 存活，不确认 D1 绑定或写入成功。验收需在已同意统计的正式站点发起事件，检查请求返回 204，再通过下列认证查询核对。

## 查询与验收

所有查询需 Cloudflare 登录和 D1 权限，不开放网页读接口：

```bash
npx wrangler d1 execute md2pdf-analytics --remote --command "SELECT substr(minute,1,10) AS day,event,count(*) AS events FROM events GROUP BY day,event ORDER BY day DESC,event LIMIT 100;"
npx wrangler d1 execute md2pdf-analytics --remote --command "SELECT json_extract(properties,'$.template') AS template,count(*) AS selections FROM events WHERE event='template_selected' GROUP BY template;"
npx wrangler d1 execute md2pdf-analytics --remote --command "SELECT json_extract(properties,'$.source') AS source,count(*) AS views FROM events WHERE event='page_view' GROUP BY source;"
npx wrangler d1 execute md2pdf-analytics --remote --command "SELECT json_extract(properties,'$.code') AS code,count(*) AS failures FROM events WHERE event='export_failed' GROUP BY code;"
```

预览、导出等产品事件没有访客标识，只可比较趋势，不能计算用户级漏斗或独立用户转化率。访问统计可在同意样本中计算站点内活跃浏览器数，但换浏览器、清理存储、不同站点会重复计数，拒绝或丢失上报会漏计。`export_started` 只代表发起导出，浏览器打印不能证明保存 PDF 成功。用户拒绝、广告拦截、断网和限流都会造成缺失。

本地接收器测试：

```bash
node --test tests/analytics-worker-checks.mjs
```

上线后检查拒绝/撤回无上报、合法事件写入、无效 Origin 返回 403、未知字段返回 400、超大请求返回 413，以及定时清理实际执行。暂时停用统计可取消前端接收地址；删除全部事件需显式执行数据库清理，不属于常规部署。

限流绑定配置参照 [Cloudflare 官方文档](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。每日预算通过数据库触发器维护，无需每次扫描事件表。

按国家查看最近七日事件时，报告只显示至少 5 条事件的分组，降低小样本暴露风险；计数不是独立用户数：

```bash
npx wrangler d1 execute md2pdf-analytics --remote --command "SELECT country,count(*) AS events FROM events WHERE event='page_view' AND minute >= strftime('%Y-%m-%dT%H:%M:00Z','now','-7 days') GROUP BY country HAVING count(*) >= 5 ORDER BY events DESC;"
```

## 管理报告

无需开放公共读接口。在已登录 Cloudflare 的终端运行：

```bash
node /Users/jiyeqian/.codex/worktrees/analytics/md2pdf/integrations/analytics-worker/report.mjs --days 7
```

支持 `--days 1|7|30|90`，默认为 7；`--local` 查询本地 Wrangler 数据集。报告通过认证 Wrangler CLI 执行固定聚合 SQL，输出 JSON；首次运行可能下载 Wrangler 4，不接受任意 SQL 参数。每日事件总数保留，国家、设备、浏览器、来源、渠道、模板、预览、导出、离线准备等维度低于 5 条的分组不显示，空维度表示无足够样本。dailyEvents 和 dimensions 均为事件次数；activeBrowsers.daily 为每日去重浏览器数，activeBrowsers.period 为整个查询期间去重浏览器数。仅纳入带标识的已同意 page_view，旧无标识记录不纳入；按 site 分类分别输出，不跨站关联，不代表人数或用户级漏斗。期间 firstObserved 是在保留明细中首次出现落在查询期间的浏览器，returning 是此前已有记录并在期间再次出现的浏览器，两者之和等于期间去重数；这不是首次安装或新用户，超过保留期、清理存储会使旧浏览器重新成为首次观测。每日去重数不能相加作为月活；期间去重必须在整个时间窗口重新计算。

报告查询使用 JSON 维度展开后聚合，不使用多项 UNION ALL，以兼容 D1 的 compound SELECT 限制。测试包含真实 SQLite 固定样本执行，核对国家只取 page_view、小样本隐藏和每日事件总数。


## 浏览器标识与撤回

首次升级需先应用 `0002_visitors.sql` 再发布 Worker；迁移增加 site、visitor_id 和部分索引，不删除旧事件，旧行保留为 legacy 且无标识。未升级数据库的接收请求将失败关闭，不回退到不受限写入。

`POST /forget` 只接受 JSON `{ "visitorId": "UUID-v4" }`，同样限制 HTTP/HTTPS Origin、2 KiB 正文、JSON 类型及 IP 频率；不接受额外字段。它按索引删除所有关联实时事件，返回 204（包括已无记录的情况），不返还匹配数量。随机 UUID 是删除能力凭证，不应公开；CORS 不是身份认证。每日写入上限不拦截删除，删除也不减少 daily_counts，防止靠撤回绕过预算。

撤回立即清除本地标识，并在在线且未启用 DNT/GPC 时尽力发送一次删除请求；离线、限流或网络失败时不排队、不重试，也不保留标识以继续追踪。因而无法确认服务端删除，未删明细仍受约 90 天自动过期约束。DNT/GPC 开启时不发送包括删除在内的统计请求。产品事件本身没有标识，不能据此定位删除。D1 自动恢复历史无法即时清除，仍受前述 Time Travel 窗口约束；恢复后除清理过期数据外，应重新执行仍需履行的删除请求，不能把恢复备份当成重新授权采集。
