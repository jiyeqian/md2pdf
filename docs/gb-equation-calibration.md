# GB 公式编号校准

## 参考与适用范围

以 `md2pdf-research/gb/Examples/GB:T 47036—2026 空间物体轨道摄动解析计算方法.pdf` 为参考：物理第 11 页正文编号，物理第 14 页附录 A 编号；补取第 17、19、37 页的数字及 B—D 字母。文件指纹、字形来源位置见 [资源记录](gb-equation-glyphs-manifest.json)。

原 PDF 的部分字体使用自定义编码，抽取出的字符不能直接当作字形身份。经页面可见编号核对后，从原件矢量输出中提取 0—9、A—D、括号、小数点和三点引导字形。普通数字编号及 A—D 的标准附录编号使用这些曲线，不依赖近似字体。

原件没有提供其余附录字母的同类编号样本；E—Z 和自定义标签保留 MathJax 原有显示。显式 `\tag*` 的内容不补括号。未在本次扩大字形覆盖范围，也不替用户改写标签内容。

## 显示规则

MathJax 继续生成编号、标签、引用与锚点；分页后校准显示层，保留原语义标签。GB 专用矢量编号覆盖其可见字样，其他三个模板不调用此处理。

- 编号右侧墨迹对齐公式容器右端。
- 括号复用原曲线比例，以实际墨迹高度约 7.2 pt 校准。字框比墨迹高，不能按字框高度直接缩小曲线。
- 括号内侧留白约 5.4–5.8 pt。实现保留曲线字框，左右定位间隔分别为 5.1、5.25 pt；墨迹间隔另由曲线尖端与字面边界共同决定。
- 点线复用原三点字形，周期 10.48 pt；矢量中心间距约 3.20、3.23、4.04 pt 循环。600 dpi 墨迹观察约为 3.24、3.24、3.96–4.08 pt。
- 点线最多十组三点；长公式根据剩余空间减少完整组数。公式到点线至少留 6 pt，末点到左括号约 2.7 pt。
- 同一矢量定义供组内重复引用，并留半点空白视口，避免末点被亚像素裁切。
- 根据实际页面缩放换算坐标；预览缩放不二次缩放物理字号和点距。

这些细节用于贴合指定发布样本。GB/T 1.1 的圆括号、右对齐、点线等要求仍为依据；具体点径、间隔与十组上限不作为规范明文规定宣传。

## 测量与验收

[测量结果](gb-equation-calibration-measurements.json) 记录参考墨迹、本软件实际下载 PDF 墨迹及三入口几何数据。600 dpi、灰度阈值 128；工程比较容差为 0.36 pt（3 个采样像素），不承诺不同 PDF 查看器逐像素完全相同。

参考裁切可直接复查（600 dpi）：

```sh
pdftoppm -f 11 -l 11 -r 600 -x 3500 -y 4510 -W 1000 -H 150 -png -singlefile "$REFERENCE_PDF" /tmp/gb-equation-reference-4
pdftoppm -f 14 -l 14 -r 600 -x 3500 -y 2800 -W 1000 -H 150 -png -singlefile "$REFERENCE_PDF" /tmp/gb-equation-reference-a1
```

`tests/gb-equation-calibration-browser-checks.mjs` 生成单页校准 PDF，覆盖数字 1—12、A.1/A.12/B.1/C.1/D.1、未覆盖字母及自定义标签、公式引用、右对齐与连续重复校准。Node 成品来自 `/api/pdf`，不把自动缩放的预览页面当成导出文件。核心入口和静态导出同时验收。`tests/gb-body-acceptance.mjs` 回归 CLI、服务端和静态全面范例的分页、列项、图表、脚注、公式与引导段换行。

62 项针对性测试、三入口专用校准、GB 三入口全面范例 PDF、`npm run check:consistency` 及其他三个模板的 Node／静态实际 PDF 回归通过。PDF 内部引用的命名目标及链接注释已核查。

工作树 `/Users/jiyeqian/.codex/worktrees/f96a/md2pdf`、分支 `codex/template`。交付文件：

- `output/pdf/gb-equation-calibration-node.pdf`：单页编号校准及引用测试。
- [docs/gb-equation-comparison.png](gb-equation-comparison.png)：左为原件，右为校准结果，同为 600 dpi；只移动对齐，未缩放两侧字样。
- `output/pdf/gb-comprehensive-node.pdf`：全面范例，第 9 页和第 17 页核对编号。

WebApp 启动或重启：`PORT=8766 npm start`，打开 `http://127.0.0.1:8766/`，重新渲染 GB 文档。静态部署需要重新构建，新增字形已加入离线资源清单。未做手机、线上缓存与实体打印验收。

## 资源复现与升级

提取器绑定已核验的 PDF 指纹及字符映射，开发环境需 `pdfplumber`、`pdftocairo`，产品运行无需这两个工具：

```sh
python3 scripts/extract-gb-equation-glyphs.py "$REFERENCE_PDF" /tmp/gb-equation-glyphs
cmp assets/gb-equation-glyphs.json /tmp/gb-equation-glyphs/gb-equation-glyphs.json
```

当前源文件可逐字节复现资源。更换样本需重新确认字符映射和字号，检查全部数字及字母的放大图，再更新指纹、资源和测量数据。
