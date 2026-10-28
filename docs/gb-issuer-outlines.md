# 三组发布单位原字形复用

## 范围与来源

2026-10-28，三组已校准的发布机构组合改用原生 PDF 嵌入字体导出的实际轮廓。所有三入口共用 `assets/gb-issuer-outlines.json`，不制作或分发字体文件；只有完整匹配的三组组合启用，未知组合及单机构保留原文本排版。

| 原件 | 两行机构字数 | 首末字位跨度 |
| --- | --- | ---: |
| GB/T 48316—2026 | 10 / 10 | 61.001275 mm |
| GB/T 7714—2015 | 19 / 12 | 99.820236 mm |
| GB 7718—2025 | 16 / 10 | 83.183236 mm |

第一组另与 GB/T 1001.1—2021、13000—2025、42452—2023 逐字核对，导出路径一致；六份原件中重复出现的汉字路径均一致，共 31 种字形。第二、三组的完整机构组合各来自一份对应原件，不能据此宣称所有独有字形均有第二份独立来源。轮廓保持在其原组合内，不拼出未经核对的新机构。

来源 SHA-256、页码、原文、字体及字号、逐字路径哈希、SVG 原点、原 PDF 原点、生成参数、工具版本与资源哈希见 [资源清单](gb-issuer-outlines-manifest.json)。原件仍在外部研发目录，不复制进代码仓库。

## 保持字距、对齐与空间关系

- 路径保持来源字形大小和比例；按此前独立测量的跨度均分字位，不使用本机近似字体替代可见机构文字。
- 两行首末排字原点对齐，行间基线距离保持 18 pt，即 6.35 mm。汉字间的手工排版空格仅用于识别时规范化，不写入资源字样。
- 定位器直接测量 SVG 墨迹，按实际轮廓维持下缘距纸底 20 mm、机构右墨迹边缘至“发”5 mm、“发”至“布”3 mm，以及整体中心 x=110 mm。
- SVG 使用共同零原点及精确 18 pt 视窗。验收中曾发现短视窗的比例取整会压缩长行跨度，独立 PDF 测量还发现非零 SVG 左定位会造成行间偏移；两项已修正，没有放宽阈值。
- 读屏通过每行容器的可访问名称读取；辅助 PDF 文字层保持可搜索、提取，每行名字在首封面只出现一次，不参与可见墨迹测量。

“发布”两字仍使用此前字体，它们的原轮廓复用不属于本轮。原件特别是 2015 年封面的整体位置不直接照搬，位置继续按当前图 E.5 的约束校准。

## 三入口验收

已完成：

- `npm run test:gb-cover`：图示、当前范例和另两组机构共四例 × CLI、服务端、静态 WebApp，每份 36 项墨迹约束通过；另查 SVG 资源哈希、31 种重复字形一致性、三组逐字原点、空格兼容、未知组合回落、PDF 文字不重复。
- 独立从最终 PDF 的填充轮廓起点减去原字形局部偏移，反算每个字的真实原点；每个字的所有闭合子路径都须推得相同原点，不拟合整体变换来消除误差。三组 × 三入口均通过，另查两行基线距离和机构区域无位图。
- 首末字位跨度误差最大约 0.00226 mm，两行首字错位最大约 0.00001 mm、末字错位最大约 0.00036 mm；逐字工程阈值仍为 ±0.03 mm。墨迹几何仍采用既有 ±0.2 mm 阈值，两者均不代表标准规定的容差。结果与实际 PDF 哈希见 [测量记录](gb-issuer-outlines-measurements.json)。
- `npm run test:gb-ef`：35 项内容检查及三入口浏览器/PDF 回归通过；`node tests/checks.mjs`：108 项通过；`npm run check:consistency` 通过。

提取及独立复测使用含 pdfplumber 的 Python 环境；本机验收使用 Codex 捆绑 Python，提取还需要 Poppler 26.10.0 和项目 Chrome 支持。

```bash
python3 scripts/extract-gb-issuer-outlines.py \
  --covers /Users/jiyeqian/Workspace/md2pdf-research/gb/Covers \
  --output /private/tmp/gb-issuer-outlines-reproduced.json \
  --manifest /private/tmp/gb-issuer-outlines-manifest-reproduced.json

python3 tests/gb-issuer-outlines-pdf.py \
  --pdf-dir /private/tmp/md2pdf-gb-cover-e5 \
  --report /private/tmp/gb-issuer-outlines-measurements.json
```

已重建至临时目录，资源内容逐字节相同，清单解析后完全一致。复测前运行 `npm run test:gb-cover` 生成对应 PDF；不要把未完成或旧版本测试目录当成当前结果。

## 人工验收入口

工作树 `/Users/jiyeqian/.codex/worktrees/f96a/md2pdf`，分支 `codex/template`。

1. 打开 `output/pdf/gb-issuer-outlines-comparison.pdf`：三页分别为三组原件与替换后结果，采用相同放大倍率，对照字形、字距和两行对齐。
2. 九份三入口封面 PDF 保存在 `output/pdf/gb-issuer-outlines/`，文件名为 `{example,issuer-0,issuer-1}-{cli,node,static}.pdf`；三组顺序与上表一致。打开 `output/pdf/example-node-1.pdf`、`output/pdf/issuer-0-node-1.pdf`、`output/pdf/issuer-1-node-1.pdf` 查看完整封面；后两份沿用项目范例内容，仅替换发布机构，并非原标准全文复刻。
3. 在本工作树启动或重启 `./bin/md2pdf webapp --port 8771`，访问 `http://127.0.0.1:8771/`，国家标准模板卡片的非实时截图同步更新。静态部署须重建。

本轮为本机集成和验收，未推送或对外发布。原资源公开再分发条件仍待确认；实体打印机、手机和静态系统打印对话框未覆盖。后续固定标签、GB 图形及可变英文原字形不在本轮范围内。
