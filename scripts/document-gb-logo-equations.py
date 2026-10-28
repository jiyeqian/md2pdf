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

这是以 2026 年封面位图为约束的规范化几何候选，不是官方原生设计方程。上一版候选与生产资源保留；本版没有接入封面。模型为 `docs/gb-logo-parametric-model.json`；本文由 `scripts/document-gb-logo-equations.py` 展开生成。

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
text+=f'\n公共圆半径 r={m["circleRadius"]}，直径 {2*m["circleRadius"]*40/948:.9f} mm；公共居中描边宽 w={m["lineWidth"]}，即 {m["lineWidth"]*40/948:.9f} mm。所有直线、斜线、贝塞尔路径采用同一 w，miter 接合、miterlimit=4。实际交点按共享坐标连接；描边沿填充区内部重叠的部分与实体黑面合并，不代表该处视觉上存在独立细线。\n'
text+=r'''
生成器将画布与所属字母的横向范围外扩圆半径 r，再用网格基矩阵的逆矩阵求出整数 i、j 的遍历边界；仅保留圆心在该外扩矩形内的圆，再按斜面与字母区域裁切。G 横向范围 [0,463]，B 为 [486,948]。因此点阵没有逐个保存的圆心，也没有固定的行列数量。

实测隔行横移约为点距 0.530/0.532 倍，尚不支持严格半点距；G、B 的行相位也不同。相邻行前向连线 v 约 62.37°/62.32°。用户观察的约 45°/135° 斜向可以出现在次级网格方向：u+2v 约 44.5°，−3u+2v 约 133.8°；不能把相邻行斜线与这些跨行斜线混为一谈。仿射网格保持各行等间距与固定行位移，但不是严格等腰三角网格。完整圆点拟合 RMS 约 0.735/0.793 像素；强制水平半点距模型为 3.919/4.287 像素。不要将它解读为原设计有意采用这些小偏差，源图可能经历过制版、采样与变换。

## 区域组合方程

记 S 为两个字母实体轮廓的并集，F 为九个点阵斜面的并集，H 为 B 两个孔洞的并集，Γ 为所有轮廓和斜面边界；Stroke 为上述同宽居中描边，接合方式见上。

$$
I=\left[\,(S\setminus F)\;\cup\;\left(S\cap F\cap\bigcup D_{ij}\right)\;\cup\;\operatorname{Stroke}(\Gamma,w)\,\right]\setminus H.
$$

最终与画布矩形相交。I 内填黑，其余透明。SVG 使用反向裁切而非白色覆盖；PDF 用同样的 even-odd 裁切，不绘制白色孔洞或底色。

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

线宽／半径在 15 个组合中按原分辨率 SVG 二值交并比择优（线宽 2、2.5、3、3.5、4；半径 2.5、2.75、3）。这只是明确搜索范围内的最优候选，不是连续参数空间的全局最小误差证明。原件法向截面线宽约 3–4.3 像素，不能据此断定原设计全部同宽。

最终 SVG／主样本交并比约 92.52%，低于上一版的 97.26%，不满足上一版 ≥97% 的像素目标。保留上一版，当前仅交付规范化候选；其参数化与透明性验证通过，不等于样本贴合度已经验收通过。

```bash
python3 scripts/build-gb-logo-parametric.py
python3 scripts/document-gb-logo-equations.py
node tests/gb-logo-parametric-checks.mjs
```

PDF 构建需 ReportLab；源图测量和指标检查需 NumPy、Pillow、pypdf、pdfplumber、Poppler。详见 `docs/gb-logo-parametric-measurements.json`、`docs/gb-logo-grid-measurements.json` 与 `docs/gb-logo-line-measurements.json`。四份参考蒙版近乎相同，不视作四份独立设计原稿。
'''
(ROOT/'docs/gb-logo-functions.md').write_text(text)
print('Expanded all line/Bezier coefficients and grid equations into docs/gb-logo-functions.md')
