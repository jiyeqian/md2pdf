#!/usr/bin/env bash
# md2pdf 校验入口 —— 本地与 CI 用同一个脚本
#
#   bash scripts/validate.sh              默认校验仓库根目录
#   bash scripts/validate.sh <目录>       校验指定目录（用于反向自测）
#
# 设计原则：只做能在 Linux 容器里做、且不依赖浏览器的事。
# 真正的渲染校验落在 HTML 阶段（--html-only），PDF 打印本身需要 Chrome，
# 属于本机/dev 环节，不放进 CI。

set -uo pipefail

ROOT="$(cd -P "$(dirname "$0")/.." && pwd)"
TARGET="${1:-$ROOT}"

FAIL=0
say()  { printf '%s\n' "$*"; }
head2() { printf '\n\033[1m%s\033[0m\n' "$*"; }
bad()  { printf '  \033[31m✗ %s\033[0m\n' "$*"; FAIL=1; }
good() { printf '  \033[32m✓ %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- Node
ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local major; major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    [ "$major" -ge 18 ] 2>/dev/null && { NODE=node; return 0; }
    say "  已装 node $(node -v)，但需要 >= 18"
  fi
  if command -v apt-get >/dev/null 2>&1; then
    say "  安装 nodejs（apt-get）…"
    apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq nodejs >/dev/null 2>&1
  elif command -v apk >/dev/null 2>&1; then
    say "  安装 nodejs（apk）…"; apk add --no-cache nodejs >/dev/null 2>&1
  elif command -v dnf >/dev/null 2>&1; then
    say "  安装 nodejs（dnf）…"; dnf install -y -q nodejs >/dev/null 2>&1
  fi
  command -v node >/dev/null 2>&1 || return 1
  local major; major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge 18 ] 2>/dev/null
}

head2 "环境"
say "  目标目录：$TARGET"
if [ -f /etc/os-release ]; then say "  系统：$(. /etc/os-release; echo "$PRETTY_NAME")"; fi
if ! ensure_node; then bad "需要 Node.js >= 18（且无法自动安装）"; exit 1; fi
good "node $(node -v)"

# ------------------------------------------------------- 结构与可执行位
head2 "结构与可执行位"
REQUIRED="bin/md2pdf src/md2pdf.mjs src/render.mjs src/chrome.mjs src/options.mjs src/profiles.mjs src/ws.mjs src/install-skill.mjs assets/shell.html assets/base.css assets/gb-logo.svg scripts/assets/trace-gb-logo.mjs scripts/assets/gb-logo.src.png
assets/themes/elegant.css assets/themes/minimal.css assets/themes/gb.css vendor/yaml/yaml.mjs vendor/yaml/LICENSE vendor/yaml/provenance.json vendor/marked.esm.js vendor/mathjax/tex-svg.js vendor/highlight/highlight.cjs vendor/mermaid/mermaid.min.js vendor/pagedjs/paged.polyfill.min.js
examples/general.md examples/skill.md examples/paper.md examples/README.md examples/gb.md
templates/general.md templates/skill.md templates/paper.md templates/gb.md
docs/gb-template.md package.json README.md LICENSE
integrations/skills/md2pdf/SKILL.md scripts/inspect-pdf.mjs"
missing=""
for f in $REQUIRED; do [ -f "$TARGET/$f" ] || missing="$missing $f"; done
if [ -n "$missing" ]; then bad "缺少文件：$missing"; else good "必需文件齐全（$(echo $REQUIRED | wc -w | tr -d ' ') 项）"; fi

for f in bin/md2pdf; do
  [ -x "$TARGET/$f" ] && good "$f 可执行" || bad "$f 缺少可执行位"
done

# 分发渠道是 git：必须真的被版本控制跟踪（防止文件只在本地存在）
if command -v git >/dev/null 2>&1 && git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1; then
  untracked="$(git -C "$TARGET" ls-files --error-unmatch bin/md2pdf src/md2pdf.mjs scripts/validate.sh tests/checks.mjs integrations/skills/md2pdf/SKILL.md >/dev/null 2>&1; echo $?)"
  [ "$untracked" = "0" ] && good "关键文件已被 git 跟踪" || bad "关键文件未被 git 跟踪"
fi

# ------------------------------------------------------------ 语法检查
head2 "语法"
if [ -f "$TARGET/bin/md2pdf" ]; then
  sh -n "$TARGET/bin/md2pdf" \
    && good "sh -n 通过（bin/md2pdf）" || bad "shell 语法错误"
fi
for f in src/md2pdf.mjs src/render.mjs src/chrome.mjs src/options.mjs src/ws.mjs src/install-skill.mjs tests/checks.mjs scripts/inspect-pdf.mjs; do
  if [ -f "$TARGET/$f" ]; then
    ( cd "$TARGET" && node --check "$f" >/dev/null 2>&1 ) && good "node --check $f" || bad "node --check $f 失败"
  fi
done

# ------------------------------------------------------------ 行为校验
head2 "行为校验"
if [ -f "$TARGET/tests/checks.mjs" ]; then
  ( cd "$TARGET" && node tests/checks.mjs "$TARGET" ) || FAIL=1
else
  bad "缺少 tests/checks.mjs"
fi

( cd "$TARGET" && node --test tests/skill-install-checks.mjs ) || FAIL=1
( cd "$TARGET" && npm run test:config ) || FAIL=1
( cd "$TARGET" && npm run test:analytics ) || FAIL=1

# ------------------------------------------------- 反向自测（守卫真的会失败）
# 只会"全绿"的校验等于没有校验：故意破坏一份副本，确认校验确实报错。
if [ "${MD2PDF_SKIP_SELFTEST:-0}" != "1" ]; then
  head2 "守卫自测（破坏副本应当失败）"
  ( cd "$TARGET" && node tests/guard-selftest.mjs "$TARGET" ) || FAIL=1
fi

# ------------------------------------------------------------------ 汇总
head2 "结果"
if [ "$FAIL" = "0" ]; then
  say "  全部通过"
  exit 0
else
  say "  存在失败项，见上文 ✗"
  exit 1
fi
