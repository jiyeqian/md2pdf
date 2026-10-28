"""Expand the canonical GB model into a complete, inspectable piecewise equation ledger."""
import json
import sys
sys.dont_write_bytecode = True
from pathlib import Path
from importlib.util import spec_from_file_location, module_from_spec
ROOT=Path(__file__).resolve().parent.parent
spec=spec_from_file_location('geometry',ROOT/'scripts/build-gb-logo-parametric.py')
g=module_from_spec(spec);spec.loader.exec_module(g)
m=json.loads((ROOT/'docs/gb-logo-parametric-model.json').read_text())
fmt=lambda p:'('+', '.join(f'{v:.8f}'.rstrip('0').rstrip('.') for v in p)+')'
text=r'''# GB Logo 绘制函数与参数方程

## 状态与坐标

这是以 2026 年封面位图为约束的规范化几何候选，不是官方原生设计方程。v1、v2 研究基线保留；用户已确认将当前 v3 接入国家标准模板。生产资源与本模型的图形内容一致，仅无障碍名称改为“GB 标志”。模型为 `docs/gb-logo-parametric-model.json`；本文由 `scripts/document-gb-logo-equations.py` 展开生成。

模型坐标左上为原点，x 向右、y 向下，画布 948×474。映射到 40×20 mm：

$$
(X,Y)=\left(\frac{40x}{948},\frac{20y}{474}\right).
$$

## 基本函数

线段（下面的 L 行逐一给出 A、B）：

$$
L(A,B;t)=(1-t)A+tB,\qquad 0\le t\le1.
$$

三次贝塞尔（下面的 C 行逐一给出 P0、P1、P2、P3）：

$$
C(P_0,P_1,P_2,P_3;t)=(1-t)^3P_0+3(1-t)^2tP_1+3(1-t)t^2P_2+t^3P_3.
$$

圆点与其填充圆盘：

$$
Q_{ij}(\theta)=c_{ij}+r(\cos\theta,\sin\theta),\quad0\le\theta<2\pi,
\qquad D_{ij}=\{p:\|p-c_{ij}\|\le r\}.
$$

'''
# Raw Markdown contains single backslashes in math.
text=text.replace('\\\\','\\')
text+='## 点阵方程\n\n每个字母使用一套仿射网格：\n\n$$\nc_{ij}=o+i\\,u+j\\,v,\\qquad i,j\\in\\mathbb Z.\n$$\n\n'
text+='| 区域 | o | u（同一行相邻点） | v（相邻行同索引点） |\n| --- | --- | --- | --- |\n'
for grid in m['grids']:
    text+=f'| {grid["name"]} | {fmt(grid["origin"])} | {fmt(grid["u"])} | {fmt(grid["v"])} |\n'
text+=f'\n公共圆半径 r={m["circleRadius"]}，直径 {2*m["circleRadius"]*40/948:.9f} mm；公共居中描边宽 w={m["lineWidth"]}，即 {m["lineWidth"]*40/948:.9f} mm。所有直线、斜线、贝塞尔路径采用同一 w，可见线宽均由 w 推导：内部共享缝居中宽 w，单侧边界带用宽 2w 的中心带在外轮廓／孔洞处裁切，点阵面内可见宽 w。使用独立边、平端点与显式交点多边形，不使用闭合面的斜接描边。边界带与黑实体重叠，避免相邻裁切的抗锯齿细缝。\n'
text+=r'''
生成器将画布与所属字母的横向范围外扩圆半径 r，再用网格基矩阵的逆矩阵求出整数 i、j 的遍历边界；仅保留圆心在该外扩矩形内的圆，再按斜面与字母区域裁切。G 横向范围 [0,463]，B 为 [486,948]。因此点阵没有逐个保存的圆心，也没有固定的行列数量。

实测隔行横移约为点距 0.530/0.532 倍，尚不支持严格半点距；G、B 的行相位也不同。相邻行前向连线 v 约 62.37°/62.32°。用户观察的约 45°/135° 斜向可以出现在次级网格方向：u+2v 约 44.5°，−3u+2v 约 133.8°；不能把相邻行斜线与这些跨行斜线混为一谈。仿射网格保持各行等间距与固定行位移，但不是严格等腰三角网格。完整圆点拟合 RMS 约 0.735/0.793 像素；强制水平半点距模型为 3.919/4.287 像素。不要将它解读为原设计有意采用这些小偏差，源图可能经历过制版、采样与变换。

## 区域组合方程

记 S 为两个字母实体轮廓的并集，F 为九个点阵斜面的并集，H 为 B 两个孔洞的并集。对所有斜面边分段：直线在共线顶点处分开，正反向相同的边只保留一次，并记录所属面数。外轮廓不再重复描边。

边 e 的中心带半宽由面数决定：

$$
h_e=\frac{w}{1+\mathbf1_{\{\operatorname{owners}(e)=2\}}}.
$$

对线段或曲线生成平端点中心带 B_e=Stroke_butt(e,2h_e)。同宽边合成一条含多个子路径的路径，一次绘制，避免独立端点反复抗锯齿造成内部细缝。外轮廓及孔洞的单侧裁切使边框留在字母内侧，宽为 w；邻接实体黑面的部分与实体合并。交点之外的可见细线宽度由同一个 w 决定，交点本身不要求具有独立的一维线宽。

对顶点 v，取各关联边在该点的单位法向 n_e，显式构造交点连接多边形：

$$
J_v=\operatorname{conv}\{v+h_en_e,\ v-h_en_e:\ e\text{ 关联 }v\}.
$$

所有顶点到补片顶点的距离不超过 w，不会产生 miter 的长尖刺。共线直边的退化补片为空；曲线切线由端部控制点差计算，零切线会明确报错。

最终黑色区域：

$$
I=\left(S\cap\left[(S\setminus F)\cup\left(F\cap\bigcup D_{ij}\right)\cup\bigcup_e B_e\cup\bigcup_v J_v\right]\right)\setminus H.
$$

SVG 和 PDF 均对整体墨迹裁切一次 S、再排除 H；其他区域透明。没有白色孔洞覆盖，也没有让边界带分别与黑实体无重叠拼接，避免抗锯齿形成亮缝。

## 轮廓复用与交点求解

实体轮廓和孔洞是权威边界。G 外侧弧、内侧弧及 B 顶面外弧，通过 de Casteljau 细分精确复用原曲线的子段；不再次拟合同一弧。对约束直线 n·p=b 求根：

$$
f(t)=n\cdot C(t)-b=0,\qquad t\in[0,1].
$$

本模型三条约束均在指定单调段内求根，使用 60 次二分；G 两条对角交线为 x+y=477，B 顶部对角交线为 x+y=910。结果和根参数记录在模型 `boundaryConstruction.roots` 中。子曲线精确继承原曲线形状，输出路径系数舍入到 8 位小数。

G 下部 y353.74370 统一取自实体轮廓，移除旧的 2 单位偏移；两孔轮廓直接供斜面复用，不再叠加固定偏移。B 外侧中部的 0.09673 单位短边合并为一个共同凹口节点。点阵与其裁切规则不变，合法的半圆点仍会在边界出现；它们与越界尖刺、空隙不是同一种现象。

## 全部分段系数

每个路径依次连接下列段，终点回到起点。L 使用 A、B；C 使用 P0、P1、P2、P3。小数位用于确定性生成，不表示原始位图具有同等测量精度。
'''
for group,key in [('实体轮廓 S','silhouettes'),('点阵斜面 F','facets'),('镂空 H','counters')]:
    text+=f'\n### {group}\n\n'
    text+='| 路径／段 | 函数 | 控制点（按顺序） |\n| --- | --- | --- |\n'
    for index,d in enumerate(m[key]):
        point=None;start=None;seg=0
        for cmd,v in g.commands(d):
            if cmd=='M':point=tuple(v);start=point;continue
            seg+=1
            if cmd=='Z':
                if point==start:continue
                controls=[point,start];end=start;kind='L'
            elif cmd=='L':controls=[point,tuple(v)];end=tuple(v);kind='L'
            else:controls=[point,tuple(v[:2]),tuple(v[2:4]),tuple(v[4:])];end=tuple(v[4:]);kind='C'
            text+=f'| {index+1}/{seg} | {kind} | '+ ' → '.join(fmt(p) for p in controls)+' |\n';point=end
text+='\n## 共享交点\n\n| 名称 | 坐标 | 斜面索引（从 1 开始） |\n| --- | --- | --- |\n'
for j in m['junctions']:
    text+=f'| {j["name"]} | {fmt(j["point"])} | '+', '.join(str(i+1) for i in j['facets'])+' |\n'
text+='''
## 误差与复现

统一线宽、网格点阵与透明孔洞是本版新增约束。原轮廓曲线沿用已拟合的贝塞尔段，仅修正共享交点，没有声称全部曲线均为严格圆弧或椭圆，也未推导出原作者的设计方程。

v2 线宽／半径曾在 15 个组合中按原分辨率 SVG 二值交并比择优（线宽 2、2.5、3、3.5、4；半径 2.5、2.75、3）。这只是明确搜索范围内的最优候选，不是连续参数空间的全局最小误差证明。原件法向截面线宽约 3–4.3 像素，不能据此断定原设计全部同宽。

v3 保留 v2 的 w、r 和点阵参数，不重做像素择优搜索。最终 SVG／主样本交并比约 93.04%，高于 v2 的 92.52%，仍低于 v1 的 97.26%，不满足 v1 ≥97% 的像素目标。保留两版基线，当前按用户选择用于国家标准模板；拓扑与透明性通过不等于样本贴合度已验收通过。

```bash
python3 scripts/gb_logo_topology.py
python3 scripts/build-gb-logo-parametric.py
python3 scripts/document-gb-logo-equations.py
node tests/gb-logo-parametric-checks.mjs
python3 tests/gb-logo-topology-checks.py
```

PDF 构建需 ReportLab；源图测量和指标检查需 NumPy、Pillow、pypdf、pdfplumber、Poppler。全图边图、41 个节点及四倍分辨率检测记录见 `docs/gb-logo-topology-measurements.json`。轮廓像素检查允许 1 个设备像素的抗锯齿边界差异（207 个阈值差异像素均在此范围），范围之外没有外伸像素；41 个节点内部核验区域无白缝。矢量的严格边界由整体裁切保证。详见 `docs/gb-logo-parametric-measurements.json`、`docs/gb-logo-grid-measurements.json` 与 `docs/gb-logo-line-measurements.json`。四份参考蒙版近乎相同，不视作四份独立设计原稿。
'''
measure=json.loads((ROOT/'docs/gb-logo-parametric-measurements.json').read_text())
audit=json.loads((ROOT/'docs/gb-logo-topology-measurements.json').read_text())
text=text.replace('约 93.04%',f"约 {measure['sources'][0]['svgIoU']*100:.2f}%")
text=text.replace('207 个阈值差异像素',f"{audit['rawThresholdBoundaryDisagreementsAt4x']} 个阈值差异像素")
text=text.replace('41 个节点内部核验区域无白缝',f"41 个节点均已记录并生成放大对照，其中 {audit['nodesWithInteriorRasterProbe']} 个节点有可采样的内部核验区域且无白缝，其余节点位于裁切／抗锯齿边界，不冒充内部像素采样通过")
(ROOT/'docs/gb-logo-functions.md').write_text(text)
print('Expanded all line/Bezier coefficients and grid equations into docs/gb-logo-functions.md')
