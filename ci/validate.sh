#!/usr/bin/env bash
# md2pdf 校验入口 —— 本地与 CI 用同一个脚本
#
#   bash ci/validate.sh              默认校验仓库根目录
#   bash ci/validate.sh <目录>       校验指定目录（用于反向自测）
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
REQUIRED="bin/md2pdf src/md2pdf.mjs src/ws.mjs assets/shell.html assets/base.css
assets/theme-elegant.css assets/theme-minimal.css vendor/marked.esm.js
examples/demo.md install.sh uninstall.sh package.json README.md LICENSE"
missing=""
for f in $REQUIRED; do [ -f "$TARGET/$f" ] || missing="$missing $f"; done
if [ -n "$missing" ]; then bad "缺少文件：$missing"; else good "必需文件齐全（$(echo $REQUIRED | wc -w | tr -d ' ') 项）"; fi

for f in bin/md2pdf install.sh uninstall.sh; do
  [ -x "$TARGET/$f" ] && good "$f 可执行" || bad "$f 缺少可执行位"
done

# 分发渠道是 git：必须真的被版本控制跟踪（防止文件只在本地存在）
if command -v git >/dev/null 2>&1 && git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1; then
  untracked="$(git -C "$TARGET" ls-files --error-unmatch bin/md2pdf src/md2pdf.mjs ci/validate.sh ci/checks.mjs >/dev/null 2>&1; echo $?)"
  [ "$untracked" = "0" ] && good "关键文件已被 git 跟踪" || bad "关键文件未被 git 跟踪"
fi

# ------------------------------------------------------------ 语法检查
head2 "语法"
if [ -f "$TARGET/install.sh" ]; then
  sh -n "$TARGET/install.sh" && sh -n "$TARGET/uninstall.sh" && sh -n "$TARGET/bin/md2pdf" \
    && good "sh -n 通过（install/uninstall/bin）" || bad "shell 语法错误"
fi
for f in src/md2pdf.mjs src/ws.mjs ci/checks.mjs; do
  if [ -f "$TARGET/$f" ]; then
    ( cd "$TARGET" && node --check "$f" >/dev/null 2>&1 ) && good "node --check $f" || bad "node --check $f 失败"
  fi
done

# ------------------------------------------------------------ 行为校验
head2 "行为校验"
if [ -f "$TARGET/ci/checks.mjs" ]; then
  ( cd "$TARGET" && node ci/checks.mjs "$TARGET" ) || FAIL=1
else
  bad "缺少 ci/checks.mjs"
fi

# ------------------------------------------------- 反向自测（守卫真的会失败）
# 只会"全绿"的校验等于没有校验：故意破坏一份副本，确认校验确实报错。
if [ "${MD2PDF_SKIP_SELFTEST:-0}" != "1" ]; then
  head2 "守卫自测（破坏副本应当失败）"
  TMP="$(mktemp -d)"
  mkdir -p "$TMP/proj"
  # 只复制校验会用到的部分
  ( cd "$TARGET" && tar cf - --exclude=.git --exclude=node_modules . ) 2>/dev/null | ( cd "$TMP/proj" && tar xf - ) 2>/dev/null
  if [ ! -f "$TMP/proj/assets/shell.html" ]; then
    bad "副本准备失败，跳过了守卫自测"
  else
    # 破坏 1：模板里塞一个没有替换逻辑的占位符
    sed -i.bak 's/{{COLOPHON_RIGHT}}/{{COLOPHON_RIGH}}/' "$TMP/proj/assets/shell.html" 2>/dev/null \
      || sed -i '' 's/{{COLOPHON_RIGHT}}/{{COLOPHON_RIGH}}/' "$TMP/proj/assets/shell.html"
    if ( cd "$TMP/proj" && node ci/checks.mjs "$TMP/proj" >/dev/null 2>&1 ); then
      bad "模板占位符被破坏，校验却通过了 —— 占位符检查失效"
    else
      good "模板占位符被破坏时校验正确失败"
    fi

    # 破坏 2：主题里引用一个不存在的变量
    ( cd "$TARGET" && tar cf - assets ) 2>/dev/null | ( cd "$TMP/proj" && tar xf - ) 2>/dev/null
    sed -i.bak 's/var(--accent)/var(--accentt)/g' "$TMP/proj/assets/theme-elegant.css" 2>/dev/null \
      || sed -i '' 's/var(--accent)/var(--accentt)/g' "$TMP/proj/assets/theme-elegant.css"
    if ( cd "$TMP/proj" && node ci/checks.mjs "$TMP/proj" >/dev/null 2>&1 ); then
      bad "主题变量名被改错，校验却通过了 —— 变量检查失效"
    else
      good "主题变量名写错时校验正确失败"
    fi

    # 破坏 3：版本号不一致
    sed -i.bak 's/"version": "[^"]*"/"version": "9.9.9"/' "$TMP/proj/package.json" 2>/dev/null \
      || sed -i '' 's/"version": "[^"]*"/"version": "9.9.9"/' "$TMP/proj/package.json"
    if ( cd "$TMP/proj" && node ci/checks.mjs "$TMP/proj" >/dev/null 2>&1 ); then
      bad "版本号被改乱，校验却通过了 —— 版本检查失效"
    else
      good "版本号不一致时校验正确失败"
    fi
  fi
  rm -rf "$TMP"
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
