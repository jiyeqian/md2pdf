# 国家标准正文排版与验收

本文记录上一阶段的实现和历史验收结果；当前仅维护一份全面范例，最新入口和结果见[GB 全面范例](gb-comprehensive-example.md)。以下双样例路径不作为当前入口。

## 本次范围

针对国家标准，落实 GB/T 1.1—2020 附录 E、F 中适用的正文版式要求。封面沿用已确认的 Logo 和校准参数；本次不扩展行业、地方标准。

- 以实际字形墨迹校准页眉、页码、目次、前言、引言、正文首页、附录及文后标题；镜像版心宽 165 mm。
- 前置部分使用罗马页码，正文重新从 1 开始并从奇数物理页起排；目录链接显示实际页码。
- 调整目录层级缩进、参考文献、图表注释的悬挂对齐。
- 数字列在共同支持的纯数字格式中按小数点对齐；真正空白的单元格显示一字线。保留原值，不补小数位。
- 显式公式块保留 MathJax 编号、标签和引用；分页完成后按最终尺寸生成编号前引导点，符号释义采用共同列宽，长释义回行对齐。
- 脚注分隔线的空间计入分页高度；编号与内容分别定位，避免末行被隐藏。跨页表格保留表头和续表题，终结线不得独占新页。
- 导出前拒绝无法放入一页的表格行、表注、整幅图及图注、脚注和完整公式块；分页后检查内容保留、元素越界与脚注末行裁切。错误信息指示如何拆分，不静默截断。

## 公式写法

普通数学公式继续支持。需要结构化“式中”时使用：

```markdown
:::gb-equation
$$F = K_p(x_d-x) + K_d(\dot{x}_d-\dot{x})$$

式中：
$F$ | 输出作用力，单位为牛顿；
$K_p$ | 刚度系数；
$K_d$ | 阻尼系数。
:::
```

国家标准范例已改用该写法。符号和释义仍支持安全的 Markdown 行内内容；不完整块保留原内容，不猜测普通段落。

## 可复现验收

在 `/Users/jiyeqian/.codex/worktrees/f96a/md2pdf` 执行：

```sh
node --test tests/gb-content-checks.mjs tests/gb-footnotes-checks.mjs tests/gb-equations-checks.mjs
npm run test:gb-body
node tests/gb-body-acceptance.mjs --example
npm run test:gb-ef
npm run test:gb-cover
npm run check:consistency
```

实际 PDF 墨迹的测量方法、规范数据与工程容差见[尺寸台账](gb-body-ink-ledger.md)。生成同一轮 PDF 和 `states.json` 后运行 `tests/gb-body-ink.py`；不能混用不同轮次文件。

## 本轮结果

三个入口各 17 页、139 项尺寸检查，共 51 页、417 项全部通过；最大偏差约 0.277 mm。完整结果见[测量记录](gb-body-measurements.json)。42 项内容、脚注与公式模块检查，七种目录／封面组合的实际 PDF，五种超限拒绝、多脚注、跨页长注、注释与单元格内页底脚注和末页图／公式／标题检查均通过。四组封面 × 三入口的每组 36 项墨迹检查保持通过，一致性检查通过。已渲染检查完整样例，并放大复核脚注与公式页。

## 审阅入口

无需服务，直接打开本工作树 `output/pdf/`：

- `gb-template-final-cli.pdf`、`gb-template-final-node.pdf`、`gb-template-final-static.pdf`：实际国家标准范例。
- `gb-body-calibration-cli.pdf`、`gb-body-calibration-node.pdf`、`gb-body-calibration-static.pdf`：含长脚注、长释义、数字列、100 行续表和附录的压力样例。

顺序：查看目录与正文页码 → 正文首页和脚注 → 公式及长释义 → 续表、表注 → 附录与文后终结线。尺寸台账和测量结果作为复核依据，不需要重新解析附录图片。

WebApp 验收须从本工作树重启服务；没有启动常驻服务。先确认端口空闲，再运行：

```sh
cd /Users/jiyeqian/.codex/worktrees/f96a/md2pdf
PORT=8766 npm start
```

访问 `http://127.0.0.1:8766/`，从国家标准模板创建，再导出 PDF。静态部署须重新构建、部署并更新客户端缓存。

## 既有检查的限制

额外运行 `node tests/gb-parser-checks.mjs` 时，旧用例因传入当前已禁止的 GB `numbering` 覆盖而提前失败；不能将其列为通过。本次另以合法配置执行了 `gb_source_cover: true` 的实际单页 PDF 检查，确认原始证据分支保留且无隐藏报头空页。没有借机修改该旧测试或放宽固定配置规则。

## 验收边界

测量的 ±0.5 mm 是工程验收容差，并非标准给出的通用容差。版心边界由浏览器分页坐标核对，字形位置由真实 PDF 光栅独立核对。已测样例不代表任意内容、字体替换、所有设备或实体打印全部符合规范；Pages 实际部署、手机和实体打印仍需人工验收。

数值列自动对齐限无合并、无嵌套标记的纯数字列（可带正负号、小数、百分号）。现有 Markdown 输入不扩展为任意 HTML 合并表格编辑器；合并单元格的结构处理只保留已有能力。过大图、公式或单行必须由作者拆分，工具不擅自改写文意。
