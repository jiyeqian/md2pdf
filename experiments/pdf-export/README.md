# 浏览器一次导出 PDF 可行性验证

## 结论

一次生成并下载含大纲的 PDF 已在真实浏览器中证明可行，但本实验的绘制适配器未达到正式版质量，不接入应用。现有 CLI、服务端及静态 WebApp 导出入口未改动，正式构建不包含实验代码、额外库或字体。

## 路线与依据

Better Export PDF 的 [导出源码](https://github.com/l1xnan/obsidian-better-export-pdf/blob/master/src/pdf.ts#L438) 先用 Electron `printToPDF` 取得 PDF 数据，再补大纲、写文件。普通浏览器的 [window.print](https://developer.mozilla.org/en-US/docs/Web/API/Window/print) 不返回 PDF 数据，不能直接复用该流程。

[html2pdf.js](https://github.com/eKoopmans/html2pdf.js#known-issues) 明确把页面转为图片，文字不可搜索，故不采用。该结论不等于所有 html2canvas 使用方式都只生成图片；本轮未测试 jsPDF 的 html() 路线。

本实验复用正式静态产物的 renderDocument、Paged.js 分页和 captureOutline/addPdfOutline；在沙箱中记录现有分页的文字坐标、背景、栅格图片与 SVG，通过 jsPDF 4.2.1 和 svg2pdf.js 2.8.1 绘制后自动补全书签，一次下载。没有重写 Markdown 解析和分页规则，也没有调用服务器生成 PDF。

## 实测（2026-10-17）

桌面内置 Chromium，字体已从 localhost 加载；耗时为点击后到触发下载，包含本地字体读取、绘制与补大纲，不代表手机或公网冷启动性能。大小为最终含大纲 PDF。

| 示例 | 页数 | 书签 | 大小 | 耗时 |
| --- | --- | --- | --- | --- |
| general | 3 | 7 | 212 KiB | 0.54 秒 |
| paper | 2 | 8 | 137 KiB | 0.50 秒 |
| gb | 8 | 17 | 173 KiB | 0.48 秒 |
| skill | 1 | 5 | 95 KiB | 0.47 秒 |

四份下载文件用 pypdf 独立检查：页数、书签数符合分页快照；目的页均有效；中文可提取。渲染查看 general 三页及 GB 封面，发现明确缺陷，不能宣称和正式 PDF 一致。没有完整验收其余页面和手机。

- 中文正文是 PDF 文字，不是整页截图；MathJax SVG 公式在修正隐藏辅助文本重复采集后能够显示。
- Mermaid 使用的 SVG foreignObject 未被这个导出路径保留，节点文字缺失；general 快照中有 9 个 foreignObject。
- CSS 列表标记、边框、字重、精确基线、链接尚未完整实现；GB 封面的 SVG 图片标志未输出。这些是当前实验适配器的缺陷，不足以证明底层库无法实现。
- 自定义字体仅用一种本机 Arial Unicode TTF：23,278,008 字节，约 23.3 MB；两份额外 JS 合计 507,714 字节，约 0.51 MB，均未压缩。字体子集嵌入可缩小 PDF，但本实验仍需先加载整份 TTF，字体与浏览器实际排版回退也不一致。
- 本机字体仅用于实验，未放入 Git、安装包或正式静态产物，不能直接作为公开部署的字体方案。正式采用前需选可分发字体并评估子集、字重和性能。

## 本机复现

在当前工作树根目录准备隔离依赖，库和字体不写入生产依赖：

```bash
npm install --prefix /private/tmp/md2pdf-pdf-feasibility/deps --ignore-scripts --no-audit --no-fund jspdf@4.2.1 svg2pdf.js@2.8.1
node scripts/build-pdf-probe.mjs /private/tmp/md2pdf-pdf-feasibility/deps '/Library/Fonts/Arial Unicode.ttf'
python3 -m http.server 8772 --bind 127.0.0.1 --directory dist/pdf-probe
```

访问 <http://127.0.0.1:8772/>，选择示例 → 加载示例 → 一次下载含大纲 PDF。无需预先打印或重新选择 PDF。下载后在阅读器查看书签、检索中文，并对照页面中的共用核心预览。字体路径可替换为自己有权使用且包含中文的 TTF，字形与结果可能不同。

构建会先调用正式静态构建，再复制到独立 `dist/pdf-probe/` 并加入实验资源；生成目录被 Git 忽略。此验证页不注册离线缓存；本轮运行时请求全部来自 localhost，证明客户端处理，不代表已经验证断网冷启动。

## 下一步决策

暂不替换正式导出。进入正式实现前须验证：SVG/foreignObject 与 SVG 图片、完整 CSS 文字和装饰、可分发字体与下载预算、内链和中文大纲精确位置、四类文档的实际视觉对照，以及 iPhone 内存和性能。DOM 到 PDF 的绘制层本身存在维护成本；这是共用核心之外的环境适配，不能把另写版式规则当作免费继承在线版。

本实验保留为评估工具，不作为新的产品或发布入口。后续若继续推进，应先明确接受的质量与下载预算，再决定使用现成绘制后端还是完善此适配器。
