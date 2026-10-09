# 第三方图标来源与许可

本目录只包含两个**单色** SVG 图标，均为项目自有静态资源（由根服务以
`/icons/doi.svg`、`/icons/bibtex.svg` 提供）。除这两个文件外，本目录不含任何
图标库、字体或依赖包。

本地改动（两个文件一致）：

- 删除原始固定 `width` / `height`，改为 `viewBox`，以便在紧凑工具条按钮中等比缩放；
- 删除 `role="img"` / `<title>`（按钮已由 `aria-label` 提供可访问名称，`<img>` 使用
  `alt="" aria-hidden="true"`）；
- 填充色固化为 `#33465e`，与工具条线性图标 `currentColor` 的观感一致。
- 未改动任何路径数据（path `d`）与图形形状。

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
