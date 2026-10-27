# 图 E.5 封面尺寸台账

## 来源与测量规则

依据 GB/T 1.1—2020 图 E.5；用户上传截图 SHA-256：`eec5a541810dd9eff248ebf75d3b5cea617406dd40641bc95e01954e6ebe5a90`。以下 **23 项是图中全部尺寸箭头**，重复数值按不同箭头独立编号。已由两次独立逐项识图核对。

可执行台账：[gb-cover-e5.json](../tests/fixtures/gb-cover-e5.json)。原点为纸张左上角，单位 mm。文字端点取可见字形墨迹边缘；图形取可见外框；横线取上缘。不能以 CSS 行高、字体度量框或基线代替。图中未标注的线宽、日期至横线间隙、行高、字体文件及容差单列为实现选择。

## 全部尺寸

| 标识 | 起点 → 终点 | mm |
| --- | --- | ---: |
| `paper-width` | 纸张宽度（`page.left` → `page.right`） | 210 |
| `paper-height` | 纸张高度（`page.top` → `page.bottom`） | 297 |
| `ics-left` | ICS 左端距纸左边（`page.left` → `ics.left`） | 25 |
| `ics-top` | ICS 上缘距纸顶（`page.top` → `ics.top`） | 10 |
| `logo-right-center` | GB 图形中心线至纸右边（`logo.centerX` → `page.right`） | 46 |
| `logo-width` | GB 图形宽度（`logo.left` → `logo.right`） | 40 |
| `logo-height` | GB 图形高度（`logo.top` → `logo.bottom`） | 20 |
| `upper-rule-top` | 上部横线距纸顶（`page.top` → `rule.top`） | 75 |
| `upper-rule-left` | 上部横线左端距纸左边（`page.left` → `rule.left`） | 25 |
| `upper-rule-width` | 上部横线长度（`rule.left` → `rule.right`） | 170 |
| `banner-height` | 国家标准横幅可见字高（`head.top` → `head.bottom`） | 8 |
| `banner-rule-gap` | 横幅下缘至上部横线（`head.bottom` → `rule.top`） | 25 |
| `logo-rule-gap` | GB 图形下缘至上部横线（`logo.bottom` → `rule.top`） | 42 |
| `banner-number-gap` | 横幅下缘至文件编号上缘（`head.bottom` → `stdno.top`） | 9 |
| `number-replacement-gap` | 文件编号下缘至被代替编号上缘（`stdno.bottom` → `sup.top`） | 3 |
| `replacement-right` | 被代替编号末端至横线右端定位线（`sup.right` → `rule.right`） | 5 |
| `rule-title-gap` | 上部横线至中文名称上缘（`rule.top` → `cn.top`） | 40 |
| `title-translation-gap` | 中文名称下缘至英文译名上缘（`cn.bottom` → `en.top`） | 10 |
| `translation-equivalence-gap` | 英文译名下缘至一致性标识上缘（`en.bottom` → `iso.top`） | 15 |
| `date-rule-bottom` | 日期行下横线至纸底（`date-rule.top` → `page.bottom`） | 40 |
| `issuer-bottom` | 发布机构文字下缘至纸底（`org-names.bottom` → `page.bottom`） | 20 |
| `issuer-fa-gap` | 发布机构右缘至发字左缘（`org-names.right` → `fa.left`） | 5 |
| `fa-bu-gap` | 发字右缘至布字左缘（`fa.right` → `bu.left`） | 3 |

## 推导坐标

封面编排区 x=25～195，中心 x=110；不能按纸张中心 x=105 居中。

- 上部横线 y=75。
- GB 图形中心 x=210−46=164，左 x=144；下缘 y=75−42=33，上缘 y=13。
- 横幅下缘 y=75−25=50，上缘 y=42；文件编号上缘 y=59，编号右缘 x=190。
- 中文名称上缘 y=75+40=115；英文译名上缘随中文名称实际下缘 +10；一致性标识上缘随英文译名实际下缘 +15。
- 日期横线 y=297−40=257；发布机构文字下缘 y=297−20=277。
- “发”字左缘=机构文字右缘+5；“布”字左缘=“发”字右缘+3。

以上是派生坐标，不计入原图的 23 项标注。机构多行取所有机构字形的整体外接矩形；编号或一致性标识缺失时相应项目标为不适用，不计通过。

## 重复校准

在本工作树运行 `npm run test:gb-cover`。需要本机三种 GB 字体、Chrome、Poppler 和 Python Pillow；无需重读图片。脚本分别使用图中占位文字、实际国家标准范例，经真实 CLI、Node PDF 接口、静态打印生成六份 PDF。以 600 dpi、灰度 <128 实测墨迹，保存每项目标、实测、误差、状态、输入/PDF 哈希及行框位置。工程阈值 ±0.2 mm，不是标准给出的容差。

输出目录：`/private/tmp/md2pdf-gb-cover-e5/`；汇总 `report.md`、`measurements.json`，每例封面为 `diagram-node-1.pdf`、`example-node-1.pdf`。测试不取生产 CSS 值作为期望；PDF 实际幅面取自 MediaBox，像素按 600 dpi 换算。定位 DOM 只提供裁剪区域，真实 CLI/Node 导出首页须与定位文档首页栅格逐字节相同；墨迹触及裁剪边界即判不可信。另查编号对齐、横幅边缘、文字居中、日期定位、ICS/CCS 左对齐等 13 项，共 36 项检查。字体或浏览器变更后必须重新运行；测量通过不等于专用字资源已获确认。

静态项检查共用打印 HTML 经 Chrome 输出的几何，未覆盖系统打印对话框或实体打印机。
