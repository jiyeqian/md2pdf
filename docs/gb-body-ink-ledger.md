# 国家标准正文墨迹测量台账

## 依据与约定

[测量台账](../tests/fixtures/gb-body-ledger.json)中的 `normative` 摘录 GB/T 1.1—2020 10.1.1 和图 E.1～E.3、E.8～E.12 的尺寸；定位到可见字形墨迹、600 dpi、灰度阈值 128、Range 框外扩 0.7 mm 以及 0.5 mm 位置容差属于 `engineering` 验收约定，不是标准规定的容差。附录将三行标题视为整体：取附录编号最上缘及附录标题最下缘。

## 执行

使用同一次生成的 `states.json` 和 `cli.pdf`、`node.pdf`、`static.pdf`：

```sh
python3 tests/gb-body-ink.py /private/tmp/md2pdf-gb-body > /private/tmp/md2pdf-gb-body/ink-ledger.json
```

命令检查每页 PDF 的页面尺寸，并对有页码页面核对浏览器记录的版心边界；在 600 dpi 光栅上按对应 Range 框裁图并查找墨迹，输出每项坐标、判定与失败列表；任何位置超出工程容差时退出码为 1。裁图未检出墨迹或墨迹触及裁图边界时停止测量，不能将受截断的区域当作有效数据。

Range 框是裁图定位参考，PDF 和状态必须来自同一轮生成。版心边界来自浏览器的分页布局记录，页眉、页码和标题的字形位置来自 PDF 光栅。量测不能替代 PDF 的人工视觉验收，也不覆盖脚注完整性、无编号页面的正文元素、所有文档和设备。
