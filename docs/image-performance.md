# 图片插入与预览性能复测

## 结果

2026-11-18，基线提交 `afd600a`，macOS 27.2.1、Chrome 157.0.8103.79、Node.js 26.13.1，视口 1440×1000，服务器与静态版均由同一工作树隔离副本启动。下表单位为毫秒，每个场景仅一轮，不能视为稳定统计值；每个场景使用独立 Chrome 用户目录。首次预览从文件选择开始，插入后不再输入，等待预览 ready；重复预览从实际键入到 ready。

| 版本 | 图片尺寸 | 数量 | 选择至插入观察 | 首次预览 | 正文编辑后预览 | 首次处理/传输 | 首次分页 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 服务器 | 1200×900 | 1 | 40 | 648 | 641 | 41 | 13 |
| 服务器 | 1200×900 | 3 | 38 | 725 | 697 | 99 | 47 |
| 服务器 | 4000×3000 | 1 | 37 | 651 | 641 | 36 | 18 |
| 服务器 | 4000×3000 | 3 | 84 | 757 | 698 | 84 | 44 |
| 静态 | 1200×900 | 1 | 39 | 674 | 638 | 60 | 23 |
| 静态 | 1200×900 | 3 | 44 | 747 | 687 | 113 | 44 |
| 静态 | 4000×3000 | 1 | 41 | 675 | 630 | 48 | 12 |
| 静态 | 4000×3000 | 3 | 83 | 777 | 676 | 106 | 50 |

另一组在真实文件选择插入完成后立即通过浏览器输入文字，8 个场景均确认文字进入编辑器并生成预览；从开始选择到输入完成为 43–97 ms，包含观察轮询和 CDP 通信开销，并非净阻塞时间。测试通过 CDP 设置文件选择器，实际触发项目 change、文件解码、读取与插入管线；这组的首次预览包含新输入文字。两组各为单轮，记录见 [首次插入原始数据](image-performance-isolated.jsonl) 和 [立即键入原始数据](image-performance-isolated-immediate.jsonl)。预览 iframe 与顶层视口相交且未隐藏；分页图片数量、naturalWidth/naturalHeight 与样本一致，至少一张图片与 iframe 视口相交。此检查不是逐像素截图，也不证明所有图片都在当前屏幕视口内。

实际 450 ms 防抖从编辑器事务到预览请求启动；处理/传输从状态变为“正在生成预览”到 iframe HTML 设置，静态版为本地运行时处理，服务器版还包含本机请求和响应，无法细分。分页时间通过临时插桩 Paged.js 的开始和 Promise 完成标记。插入解码为 createImageBitmap 前后标记；各轮缓存状态未隔离，不能将其称为严格冷解码或热解码，也不能将预览时图像解码从分页中单独分离。采样包含轮询和浏览器调度误差。根据这些结果没有足够证据支持改变产品实现。

## 复现

需要 Node.js、Chrome 和 ImageMagick 7。先在隔离副本运行，构建会替换副本中的 `dist/static`；静态服务只提供该构建目录，不提供 API。原始图片是以固定随机种子生成的灰度噪声渐变，先生成 4000×3000 母图，再下采样为 1200×900，分别编码为 223559 和 236372 字节 JPEG。具体字节可能随 ImageMagick 版本变化；本次版本 7.1.2-35。 本次样本 SHA-256：小图 `840d445455618a19f323f75c6a1bafdec9aab571df612683160b9dbe72abbdf0`；大图 `1d8e36cbd4819ba3f727c5d07e889eeb51bc3de5947ca2d0a2bacdd90d6c3eb8`。三图为同一文件内容的三个副本，不代表不同照片。

```sh
PERF_DIR="$(mktemp -d /private/tmp/md2pdf-image-retake.XXXXXX)"
export FIXTURE_DIR="$PERF_DIR"
mkdir -p "$PERF_DIR/repo"
rsync -a --exclude=.git --exclude=dist /Users/jiyeqian/.codex/worktrees/editor/md2pdf/ "$PERF_DIR/repo/"
magick -seed 1047 -size 4000x3000 gradient: -attenuate 0.22 +noise Gaussian $PERF_DIR/master.miff
magick $PERF_DIR/master.miff -quality 62 $PERF_DIR/large.jpg
magick $PERF_DIR/master.miff -resize '1200x900!' -quality 97 $PERF_DIR/small.jpg
for n in small large; do cp $PERF_DIR/$n.jpg $PERF_DIR/$n-1.jpg; cp $PERF_DIR/$n.jpg $PERF_DIR/$n-2.jpg; done
cd $PERF_DIR/repo
node tests/image-performance-browser.mjs > $PERF_DIR/first.jsonl
IMMEDIATE_EDIT=1 node tests/image-performance-browser.mjs > $PERF_DIR/immediate.jsonl
```

脚本每场景输出事件的浏览器 performance.now 时间及失败阶段，异常不阻止后续场景。启动服务需允许监听本机端口及启动 Chrome。本次隔离环境第一次启动服务因权限限制返回 `listen EPERM: operation not permitted 127.0.0.1`，获得运行权限后两组均完成。照片内容、低端设备、手机、真实物理选择文件对话框和打印输出未覆盖。

## 隔离复核与解码

增强后的脚本每个场景创建新的 Chrome 用户目录，等待初始预览完成、重置正文并确认新版本预览完成后再开始计时；逐场景断言文字已写入、分页图片数量和原始像素尺寸正确，且至少一张图片的布局矩形与 iframe 视口相交。失败会记录阶段并返回非零退出码。文件选择计时从向浏览器发送选择命令之前开始，因包含自动化通信，略早于页面的 change 事件。隔离复核的首次插入原始数据见 [隔离复核](image-performance-isolated.jsonl)。

早期 [首次插入](image-performance-first.jsonl) 与 [立即键入](image-performance-immediate.jsonl) 为共享浏览器配置的历史数据，各场景仅一轮，不应作为主结果。此前增强断言但共享浏览器配置的另一次复跑中，静态版小图三张场景在 picker 阶段超时：预览中出现四张图，测试未记录插入前正文，多出图片的来源不明。记录见 [隔离前失败](image-performance-isolation-failure.jsonl)；无法据此断言具体内部竞态或产品性能问题。新配置复跑八种场景均通过。

额外对每种图片分别启动三个全新 Chrome 进程，每个进程对同一 Blob 连续调用三次 createImageBitmap。小图首次 4.1–4.3 ms、重复 3.5–3.9 ms；大图首次 14.4–16.4 ms、重复 14.3–15.8 ms。记录见 [解码原始数据](image-performance-decode.jsonl)。新进程首次与同进程重复只说明进程和 Blob 复用条件，系统文件缓存、浏览器内部解码缓存均未证明清空或命中；不能称为严格冷、热解码，也不等于预览阶段的解码耗时。解码实验与编辑器路径分开，复现命令：

```sh
node tests/image-performance-decode.mjs > $PERF_DIR/decode.jsonl
```

## PDF 自动打印质量抽查

使用上述同一组 JPEG，以 CLI 的 `general` 默认排版调用 Chrome 自动生成 PDF。两份 PDF 均为 1 页 A4（594.96×841.92 pt）。`pdfimages -list` 显示原图分别以 1200×900、4000×3000 JPEG 嵌入；页面上的图像均约 174×131 mm，比例约 4:3，有效分辨率分别约 175 和 584 ppi（基于 `pdfimages` 的整数 ppi）。从 PDF 提取的 JPEG 与输入文件 SHA-256 完全一致：

| 样本 | 字节数 | 输入及提取文件 SHA-256 |
| --- | ---: | --- |
| 1200×900 | 236372 | `840d445455618a19f323f75c6a1bafdec9aab571df612683160b9dbe72abbdf0` |
| 4000×3000 | 223559 | `1d8e36cbd4819ba3f727c5d07e889eeb51bc3de5947ca2d0a2bacdd90d6c3eb8` |

将两页以 96 dpi 渲染后目视检查，图片、图题和正文可见，未见裁切或拉伸。这是自动生成 PDF 的抽查，未操作系统打印对话框，也未测试实体打印或其他 PDF 阅读器。

在上面的复现步骤生成样本、设置 `FIXTURE_DIR` 并进入隔离副本后，可继续执行（需 Poppler 的 `pdfimages`、`pdfinfo` 和 `pdftoppm`）：

```sh
node -e 'const fs=require("fs"),p=process.env.FIXTURE_DIR;for(const n of ["small","large"]){const b=fs.readFileSync(`${p}/${n}.jpg`).toString("base64");fs.writeFileSync(`${p}/${n}-pdf.md`,`# 图片质量抽查\n\n![图片](data:image/jpeg;base64,${b})\n\n正文\n`)}'
for n in small large; do
  node src/md2pdf.mjs "$FIXTURE_DIR/$n-pdf.md" -o "$FIXTURE_DIR/$n-pdf.pdf"
  pdfinfo "$FIXTURE_DIR/$n-pdf.pdf" | rg 'Pages:|Page size:'
  pdfimages -list "$FIXTURE_DIR/$n-pdf.pdf"
  pdfimages -j "$FIXTURE_DIR/$n-pdf.pdf" "$FIXTURE_DIR/$n-extracted"
  shasum -a 256 "$FIXTURE_DIR/$n.jpg" "$FIXTURE_DIR/$n-extracted-000.jpg"
  pdftoppm -f 1 -l 1 -r 96 -png -singlefile "$FIXTURE_DIR/$n-pdf.pdf" "$FIXTURE_DIR/$n-review"
done
```
