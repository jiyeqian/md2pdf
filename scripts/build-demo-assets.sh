#!/usr/bin/env bash
# 重新生成 examples 的 PDF 与 README 效果图 —— 源文件与产物必须始终同步。
#
#   bash scripts/build-demo-assets.sh
#
# 产物：
#   examples/general-elegant.pdf / general-minimal.pdf（general.md 用各主题渲染）
#   docs/theme-<theme>.png            （上面 PDF 的第 1 页，供 README 展示）
#   examples/skill.pdf / paper.pdf / gb.pdf（各类型样例）
#
# 增量策略（项目约定）：只在输入（源 md / 主题与样式 / 渲染器）比产物新时才重渲，
# 无关样例自动跳过 —— 避免 PDF 时间戳带来的无意义 diff。
#
# 依赖：node、以及 poppler 的 pdftoppm（macOS: brew install poppler）。

set -euo pipefail
ROOT="$(cd -P "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--gb-only" ]; }; then
  echo "用法：bash scripts/build-demo-assets.sh [--gb-only]" >&2; exit 1
fi
node scripts/sync-gb-example.mjs

RENDER_DEPS="src/md2pdf.mjs assets/shell.html assets/base.css assets/themes/elegant.css assets/themes/minimal.css assets/themes/gb.css"

# need_build <output> <input...> ：输出缺失或任一输入比输出新时返回 0
need_build() {
  local out="$1"; shift
  [ -f "$out" ] || return 0
  local f
  for f in "$@"; do [ -e "$f" ] || continue; [ "$f" -nt "$out" ] && return 0; done
  return 1
}

report() { # <action> <out>
  echo "$1 $2"
}

# general：elegant / minimal 双主题
if [ "${1:-}" != "--gb-only" ]; then
for t in elegant minimal; do
  out="examples/general-$t.pdf"
  if need_build "$out" examples/general.md "assets/themes/$t.css" $RENDER_DEPS; then
    report "→ 生成" "$out"
    node src/md2pdf.mjs examples/general.md --theme "$t" -o "$out"
  else
    report "skip" "$out"
  fi
  png="docs/theme-$t.png"
  if [ ! -f "$png" ] || [ "$out" -nt "$png" ]; then
    echo "→ 生成 ${png}（PDF 第 1 页）"
    pdftoppm -png -r 150 -f 1 -l 1 "$out" "docs/theme-$t"
    mv "docs/theme-$t-1.png" "$png"
  else
    echo "skip $png"
  fi
done

fi

# 各文档类型样例：type ↔ template ↔ example 一一对应（见 examples/README.md）
build_sample() { # <name> <md> [额外依赖...]
  local name="$1"; local md="$2"; shift 2
  local out="examples/$name.pdf"
  if need_build "$out" "$md" $RENDER_DEPS "$@"; then
    report "→ 生成" "$out"
    node src/md2pdf.mjs "$md" -o "$out"
  else
    report "skip" "$out"
  fi
}
if [ "${1:-}" != "--gb-only" ]; then
build_sample skill   examples/skill.md   templates/skill.md
build_sample paper   examples/paper.md   templates/paper.md examples/control-loop.png examples/grasp-pose.svg
fi
build_sample gb      examples/gb.md      templates/gb.md web/examples/gb.md src/render.mjs src/gb-*.mjs src/numbering.mjs src/paged-layout.mjs src/profiles.mjs assets/gb-logo.svg assets/gb-cover-banner.svg assets/gb-issuer-outlines.json

# README 国家标准效果图：使用已有 GB 示例 PDF 的封面。
if need_build docs/theme-gb.png examples/gb.pdf; then
  pdftoppm -png -r 150 -f 1 -l 1 -singlefile examples/gb.pdf docs/theme-gb
  report "→ 生成" docs/theme-gb.png
else
  report "skip" docs/theme-gb.png
fi

if [ "${1:-}" = "--gb-only" ]; then
  echo "✓ GB 示例与封面预览已同步"
else
  echo "✓ examples 产物已同步（general-elegant/minimal、skill、paper、gb 与 docs/theme-*.png）"
fi
