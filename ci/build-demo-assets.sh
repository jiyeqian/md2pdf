#!/usr/bin/env bash
# 重新生成 demo 的 PDF 与 README 效果图 —— 这两处必须始终同步。
#
#   bash ci/build-demo-assets.sh
#
# 产物：
#   examples/demo-<theme>.pdf   （demo.md 用各主题渲染）
#   docs/theme-<theme>.png      （上面 PDF 的第 1 页，供 README 展示）
#
# 依赖：node、以及 poppler 的 pdftoppm（macOS: brew install poppler）。
# 改了 demo.md、样式、或排版逻辑后，跑一次本脚本，再提交两处产物。

set -euo pipefail
ROOT="$(cd -P "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

THEMES="elegant minimal"
for t in $THEMES; do
  echo "→ 生成 examples/demo-$t.pdf"
  node src/md2pdf.mjs examples/demo.md --theme "$t" -o "examples/demo-$t.pdf"
  echo "→ 生成 docs/theme-$t.png（PDF 第 1 页）"
  pdftoppm -png -r 150 -f 1 -l 1 "examples/demo-$t.pdf" "docs/theme-$t"
  mv "docs/theme-$t-1.png" "docs/theme-$t.png"
done

echo "✓ 已更新 examples/demo-*.pdf 与 docs/theme-*.png"
