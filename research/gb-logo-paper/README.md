# GB标志函数化论文与实验材料

## 成果

论文为中文方法案例研究，按 `templates/paper.md` 的作者、单位、摘要、关键词、公式和文献机制排版。指定作者为Jiye Qian、GPT-6.1 Sol，前者为通讯作者；未填写未经提供的邮箱。组织结构参考研究目录 `gb/Papers/` 中的《基于概率模糊聚类的旋转对称点云配准》，没有复制其内容或双栏期刊版式。

- `manuscript.md`：可编辑主稿，配套6图、8表、12个编号公式和8项参考文献。
- `figures/`：白底版本对比、4倍交点局部、参数扫描、网格模型比较、搜索进度与跨格式一致性、差分及透明性。
- `data/results.json`、`data/parameter-sweep.csv`：实际重测结果及45组参数。
- `data/manifest.json`：输入、数据、图表及实验程序SHA-256。
- `data/experimental-best-model.json`：本轮有限网格IoU最优候选，不是生产替换。
- `build/gb-logo-paper-web.md`：构建后生成的自包含Markdown，6图内嵌，可直接导入WebApp。
- 最终Node PDF：仓库根目录 `output/pdf/gb-logo-function-paper.pdf`。

本任务只新增研究稿及配套实验，未改生产Logo、现有论文范例或其他模板。只提供一份最终Node PDF；CLI与两种WebApp用同一份内嵌图片的Markdown核对内容一致性。静态版原生打印、手机和实体印刷不属于本轮验收。

## 数据来源与限制

资料根目录为 `/Users/jiyeqian/Workspace/md2pdf-research/gb/logo-function-study/`。使用 `2026-10-28-fd9924b/inputs/covers/` 中4份封面，旧快照只读；本轮新数据与历史版本度量分开保存。

4份封面有3种不同解码流，但两两只差0、2或4个像素，因此不属于4个独立设计测试集。点阵共842个完整圆点；全局推断整数行列标签之后再留出，只能称条件留出。30次随机划分的标准差不是独立样本置信区间。45组扫描是确定性有限网格搜索，累计最佳曲线不是训练收敛曲线。

主结果：v1/v2/v3 IoU分别97.2557%、92.5209%、92.9916%。本轮最佳 `w=3,r=2.75` 得分93.1516%，但覆盖率偏差增大，不据此更新生产资源。无补片对源图异或误差净增1，不等于生成图只变1像素：直接比较是原生3像素、4倍35设备像素。所有限制及负结果保留在正文。

## 复现

在包含本目录的完整md2pdf工作树根目录运行，需要Node、Chrome、Poppler及Python的NumPy、Pillow、pypdf、pdfplumber、ReportLab。以下为本机已验证路径，不添加项目依赖：

```bash
GB_PAPER_PY=/Users/jiyeqian/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
GB_PAPER_COVERS=/Users/jiyeqian/Workspace/md2pdf-research/gb/logo-function-study/2026-10-28-fd9924b/inputs/covers
"$GB_PAPER_PY" research/gb-logo-paper/experiments.py prepare --covers "$GB_PAPER_COVERS"
node research/gb-logo-paper/capture.mjs
"$GB_PAPER_PY" research/gb-logo-paper/experiments.py analyze --covers "$GB_PAPER_COVERS"
node research/gb-logo-paper/build.mjs
node research/gb-logo-paper/validate.mjs
```

`prepare`和`analyze`只在本目录生成新材料，并核对历史模型、资源和源PDF未改变；不要把它们的输出路径改成历史快照。`capture`与论文构建使用临时浏览器；`build`启动临时Node服务、构建静态资源，完成后关闭服务。中间截图、SVG、Logo实验PDF及构建HTML不跟踪Git，可以由程序重建。`build/validation.json`记录当前论文与PDF哈希及分页检查，不将它当作人眼版面验收的替代品。

完整函数系数与实现来自：

- `docs/gb-logo-functions.md`：生成方程及全部分段控制点。
- `docs/gb-logo-parametric-model.json`：当前v3参数。
- `docs/gb-logo-parametric-v2-model.json`、`docs/gb-logo-reconstruction-model.json`：保留基线。
- `scripts/build-gb-logo-parametric.py`、`scripts/gb_logo_topology.py`：SVG/PDF生成与共享边构造。

本研究材料依赖这些项目文件；仅复制本目录不构成独立安装包。PDF可以直接阅读，无需启动或重启服务；修改主稿后重跑 `build`。WebApp验收时导入 `build/gb-logo-paper-web.md`，检查作者单位、6图、8表、公式和文献链接。

## 文献核对

2026-10-29通过原文、作者项目页、会议正式库或规范网站核对题名、作者和出版信息。正文不声称已实现或测试这些外部算法。

| 文献 | 核对入口 | 本文用途 |
| --- | --- | --- |
| Selinger, 2003 | https://potrace.sourceforge.net/potrace.pdf | 二值轮廓矢量化背景 |
| Schneider, 1990 | https://lhf.impa.br/cursos/tmg/Schneider-1990.pdf | 分段三次贝塞尔拟合 |
| GB/T 1.1—2020 | 归档附录E/F及原标准PDF | 封面与物理尺寸背景 |
| Bessmeltsev与Solomon, 2019 | https://doi.org/10.1145/3202661 | 交点连通问题 |
| Li等, 2020 | https://people.csail.mit.edu/tzumao/diffvg/ | 可微光栅化与后续方向 |
| Carlier等, 2020 | https://papers.neurips.cc/paper_files/paper/2020/hash/bcf9d6bd14a2095866ce8c950b702341-Abstract.html | 学习式矢量表示背景 |
| W3C SVG 2 | https://www.w3.org/TR/SVG/painting.html | 填充、描边与连接语义 |
| Felzenszwalb与Huttenlocher, 2012 | https://theoryofcomputing.org/articles/v008a019/ | 距离度量与后续计算方向 |
