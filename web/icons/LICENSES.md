# 第三方图标来源与许可

本目录只包含两个**单色** SVG 图标，均为项目自有静态资源（由根服务以
`/icons/doi.svg`、`/icons/bibtex.svg` 提供）。除这两个文件外，本目录不含任何
图标库、字体或依赖包。

本地适配：

- 删除原始固定 `width` / `height`，改为 `viewBox`，以便在紧凑工具条按钮中等比缩放；
- 删除 `role="img"` / `<title>`（按钮已由 `aria-label` 提供可访问名称，`<img>` 使用
  `alt="" aria-hidden="true"`）；
- BibTeX 填充色为 `#33465e`；DOI 使用 `#42648b` 描边，与工具条线性图标一致。
- BibTeX 保留原始路径；DOI 保留圆形及 `doi` 字样，重绘为 20 × 20 网格、1.4 描边的线性图标。

## bibtex.svg

- 上游：<https://raw.githubusercontent.com/file-icons/icons/master/svg/BibTeX.svg>
- 项目：File Icons（<https://github.com/file-icons/icons>）
- 版权：Copyright (c) 2016-2021, John Gardner
- 许可：ISC（<https://raw.githubusercontent.com/file-icons/icons/master/LICENSE.md>）

```
Copyright (c) 2016-2021, John Gardner

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## doi.svg

- 上游：<https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/doi.svg>
- 项目：Simple Icons（<https://github.com/simple-icons/simple-icons>）
- 许可：CC0 1.0 Universal（<https://raw.githubusercontent.com/simple-icons/simple-icons/develop/LICENSE.md>）

CC0 1.0 Universal 全文见上游地址；要点：作者放弃全部著作权与邻接权，
可自由使用、修改、复制、分发（含商业用途），无需署名。

## Tabler Icons（内联，未作为文件存放）

- 上游仓库：<https://github.com/tabler/tabler-icons>
- 版权：Copyright (c) 2020-2026 Paweł Kuna
- 许可：MIT（<https://raw.githubusercontent.com/tabler/tabler-icons/main/LICENSE>）

本目录不含其文件：以下两个图标以**内联 SVG** 形式嵌入前端，颜色随文字
（`currentColor`），未改动任何路径数据（path `d`）：

- `file-type-pdf`（`icons/outline/file-type-pdf.svg`）→ `web/index.html` 预览栏「下载 PDF」按钮；
  24×24 视图直接内联（`viewBox="0 0 24 24"`，由 `.btn-icon` 等比缩放到 16px）。
- `arrows-exchange`（`icons/outline/arrows-exchange.svg`）→ `web/editor-workspace.js` 工具条「同步定位」开关；
  24 网格以 `<g transform="scale(0.8333333333)">` 归一到既有的 20×20 视图，路径未被拉伸变形。

抓取来源仅上述两个 SVG 与上游 `LICENSE`，未下载整个图标库。

```
MIT License

Copyright (c) 2020-2026 Paweł Kuna

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
