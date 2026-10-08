# md2pdf 示例导览（README 样例）

本文件是 `README` 类型的在线样例：文件名为 README.md 时自动识别，**网页端没有文件名**，
因此在 /examples 页面或编辑器里请显式选择「README」类型。渲染效果就是你现在看到的这份排版。

> README 自动带文首目录；顶部徽章（shields.io 等）会被自动识别且不参与图表编号。
> 在线版本不支持远程图片，所以本样例没有放远程徽章，避免出现「图片未加载」占位。

## 文档类型一览

| type | 自动识别依据 | 默认行为 |
| --- | --- | --- |
| general | 不含其他类型特征（兜底） | 首段作导语，标题自动编号 |
| skill | 文件名 SKILL.md，或 frontmatter 含 name | 报头带「技能文档」标识与元信息条 |
| readme | 文件名 README.md | 默认加目录，徽章不编号 |
| paper | frontmatter 含 abstract / keywords | 自动生成作者行、摘要与关键词 |
| gb | frontmatter 含「标准号」或 standard | 生成封面、目次、奇偶页眉与 GB 章条编号 |

## 排版能力速查

### 标题与层级

H2–H6 自动编号（` 1 / 1.1 / 1.1.1` 等四种方案可选），H1 作为文档标题不编号。

### 列表与引用

1. 有序列表支持多级缩进
   - 子项说明
   - 另一个子项
2. 引用块用于注意事项

> 注意：更换指尖材料后必须重新标定阻抗参数。

### 表格

表：三种类型的版式差异 {#tab:layout}

| 目标 | 主题 | 页边距 |
| --- | --- | --- |
| 正式公文 | minimal | 20 / 18 mm |
| 常规文档 | elegant | 20 / 18 mm |
| 国家标准 | gb | 25 / 19 mm（订口左宽） |

排版细节由表 \ref{tab:layout} 的主题与边距决定。

### 图表与公式

图题写在图片前一行（`图：… {#fig:x}`），表题写在表格前一行（`表：… {#tab:x}`），
正文用 `\ref{fig:x}`、`\ref{tab:x}` 引用；公式用 `\label` / `\eqref` 交叉引用。

行内公式示例：闭环误差满足 $M\,\ddot{e} + K_d\,\dot{e} + K_p\,e = 0$。

### 参考文献

BibTeX 脚注（`@article{...}`）按正文首次引用顺序编号，自动生成文末参考文献章节；
普通 Markdown 脚注保持原样。

## 命令行用法

```bash
npx @jiyeqian/md2pdf 文档.md            # 类型自动识别
npx @jiyeqian/md2pdf 文档.md --theme minimal
npx @jiyeqian/md2pdf 文档.md --toc --number-scheme chapter
```

## 在线工作台

```bash
npm start        # 打开 http://127.0.0.1:3000
```

左侧编辑 Markdown，右侧分页预览，点击「下载 PDF」导出；/examples 页面可浏览各类型样例。

更多说明见仓库 [ README ](https://cnb.cool/jiyeqian/md2pdf)。
