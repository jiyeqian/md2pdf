#!/bin/sh
# md2pdf 安装脚本（macOS / Linux）—— 联网一条命令装 / 仓库内装，两用
#
# ① 联网安装（推荐，不用 clone）：
#      curl -fsSL https://cnb.cool/jiyeqian/md2pdf/-/git/raw/main/install.sh | sh
#
# ② 在仓库里安装（开发用）：
#      ./install.sh
#
# 环境变量：
#   PREFIX=<dir>         命令落点，默认 /usr/local/bin（无写权限时自动用 ~/.local/bin）
#   MD2PDF_HOME=<dir>    联网安装时程序本体的落点，默认 ~/.local/share/md2pdf
#   MD2PDF_REF=<ref>     指定分支或标签，默认 main（如 MD2PDF_REF=v1.2.0）
#   MD2PDF_SRC=<url>     仓库基址，默认官方地址（自建镜像时覆盖）
#   MD2PDF_SKILL=0       不安装 Agent 技能说明书（只在 WorkBuddy 环境里装）
#   MD2PDF_SKILL_DIR=<d> 技能说明书落点，默认 ~/.workbuddy/skills/md-to-pdf
#
# 它做三件事：把程序放到落点、把 bin/md2pdf 链接进 PATH、把技能说明书放进技能目录。
# 不动系统其他配置。

set -e

REPO_URL="${MD2PDF_SRC:-https://cnb.cool/jiyeqian/md2pdf}"

# ------------------------------------------------------------ 定位安装来源
# 区分「在仓库里执行」与「curl 管道执行」：
# 管道执行时 $0 是 sh/bash（不是可读文件路径），且脚本内容来自 stdin。
ROOT=""
if [ -f "$0" ]; then
  _dir="$(cd -P "$(dirname "$0")" 2>/dev/null && pwd)"
  if [ -f "$_dir/src/md2pdf.mjs" ]; then ROOT="$_dir"; fi
fi

if [ -n "$ROOT" ]; then
  echo "来源：本地仓库 $ROOT"
else
  # ---------------------------------------------------------- 联网安装
  if [ -z "$HOME" ]; then
    echo "md2pdf: 环境变量 HOME 为空，请用 MD2PDF_HOME=<dir> 指定安装目录" >&2
    exit 1
  fi

  REF="${MD2PDF_REF:-${MD2PDF_VERSION:-main}}"
  HOME_DIR="${MD2PDF_HOME:-$HOME/.local/share/md2pdf}"

  # 防手滑：绝不删这些目录
  case "$HOME_DIR" in
    ""|"/"|"$HOME"|"$HOME/") echo "md2pdf: 拒绝安装到 $HOME_DIR" >&2; exit 1 ;;
  esac

  URL="$REPO_URL/-/git/archive/$REF.tar.gz"
  TMP="$(mktemp -d 2>/dev/null || mktemp -d -t md2pdf)"
  trap 'rm -rf "$TMP"' EXIT HUP INT TERM

  echo "下载 $URL"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$URL" -o "$TMP/src.tar.gz"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$TMP/src.tar.gz" "$URL"
  else
    echo "md2pdf: 联网安装需要 curl 或 wget" >&2
    exit 1
  fi

  mkdir -p "$TMP/x"
  if ! tar -xzf "$TMP/src.tar.gz" -C "$TMP/x" 2>/dev/null; then
    echo "md2pdf: 解包失败，$REF 是否存在？" >&2
    exit 1
  fi

  # 归档布局有两种，都要认：
  #   - CNB 的 /-/git/archive/<ref>.tar.gz 解出来直接就是仓库根（无顶层目录）
  #   - git archive --prefix=xxx/ 打出来的包会多一层 xxx/
  SRC="$TMP/x"
  if [ ! -f "$SRC/src/md2pdf.mjs" ]; then
    SRC=""
    for d in "$TMP/x"/*/; do
      if [ -f "$d/src/md2pdf.mjs" ]; then SRC="$d"; break; fi
    done
  fi
  if [ -z "$SRC" ]; then
    echo "md2pdf: 解包后未找到 src/md2pdf.mjs（归档布局异常）" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$HOME_DIR")"
  rm -rf "$HOME_DIR"
  mv "$SRC" "$HOME_DIR"
  ROOT="$HOME_DIR"
  chmod +x "$ROOT/bin/md2pdf" "$ROOT/install.sh" "$ROOT/uninstall.sh" 2>/dev/null || true

  # 记下来源，供 md2pdf --upgrade 使用
  {
    echo "repo=$REPO_URL"
    echo "ref=$REF"
  } > "$ROOT/.install-meta"

  echo "已安装程序本体：${ROOT}（${REF}）"
  REMOTE=1
fi

# -------------------------------------------------------------- 链接命令
if [ -n "$PREFIX" ]; then
  BIN_DIR="$PREFIX/bin"
else
  BIN_DIR="/usr/local/bin"
  if [ ! -w "$BIN_DIR" ]; then BIN_DIR="$HOME/.local/bin"; fi
fi

mkdir -p "$BIN_DIR"
# 注意：不用 ln -sf —— BSD 版会先建临时文件再 unlink，在受限环境（沙箱）里会失败
rm -f "$BIN_DIR/md2pdf"
if ln -s "$ROOT/bin/md2pdf" "$BIN_DIR/md2pdf" 2>/dev/null; then
  echo "已链接命令：$BIN_DIR/md2pdf -> $ROOT/bin/md2pdf"
else
  # 软链不可用（受限目录等）：写一个转发脚本，而不是复制启动器 ——
  # 启动器靠自身路径反推项目根，复制过去就找错地方了。
  cat > "$BIN_DIR/md2pdf" <<EOF
#!/bin/sh
# md2pdf 转发脚本（软链不可用时的退化方案）
exec "$ROOT/bin/md2pdf" "\$@"
EOF
  chmod +x "$BIN_DIR/md2pdf"
  echo "已写入转发脚本：$BIN_DIR/md2pdf -> $ROOT/bin/md2pdf"
fi

# 记下命令落点，供 md2pdf --upgrade 使用 —— 不记的话，升级时会重新走一遍
# "默认 /usr/local/bin，不可写就退 ~/.local/bin"的选择，当初用 PREFIX 装的
# 就会把命令漂到别处（老位置留下悬空的软链）。
if [ -f "$ROOT/.install-meta" ]; then
  echo "bin=$BIN_DIR" >> "$ROOT/.install-meta"
fi

# ----------------------------------------------------------------- 检查 node
NODE=""
for c in "$MD2PDF_NODE" \
         "$HOME/.workbuddy/binaries/node/versions/22.22.2-3/bin/node" \
         "/usr/local/bin/node" "/opt/homebrew/bin/node" "/usr/bin/node" \
         "$(command -v node 2>/dev/null)"; do
  [ -n "$c" ] && [ -x "$c" ] && NODE="$c" && break
done
if [ -z "$NODE" ]; then
  echo "⚠️  未找到 Node.js。请安装 Node >= 18（建议 22+；更老版本会走内置 WebSocket 实现）。"
else
  NODE_VER="$("$NODE" -p 'process.versions.node' 2>/dev/null || echo '?')"
  MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$MAJOR" -lt 22 ] 2>/dev/null; then
    echo "⚠️  检测到 Node ${NODE_VER}（< 22）。建议升级；当前会自动使用内置 WebSocket 实现。"
  else
    echo "✓ Node $NODE_VER"
  fi
fi

# --------------------------------------------------------------- 检查 Chrome
CHROME=""
for c in "$MD2PDF_CHROME" \
         "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
         "/Applications/Chromium.app/Contents/MacOS/Chromium" \
         "/usr/bin/google-chrome" "/usr/bin/chromium" "/usr/bin/chromium-browser" \
         "$(command -v google-chrome 2>/dev/null)" "$(command -v chromium 2>/dev/null)"; do
  [ -n "$c" ] && [ -x "$c" ] && CHROME="$c" && break
done
if [ -z "$CHROME" ]; then
  echo "⚠️  未找到 Chrome/Edge/Chromium。渲染需要它，可用 MD2PDF_CHROME=/path/to/chrome 指定。"
else
  echo "✓ 浏览器 $CHROME"
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) echo "✓ $BIN_DIR 已在 PATH 中" ;;
  *) echo "⚠️  $BIN_DIR 不在 PATH 中，请加入："
     echo "    echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc && source ~/.zshrc" ;;
esac

# ---------------------------------------------------------- 安装技能说明书
# 让 Agent 认识 md2pdf：把仓库里的 skill/SKILL.md 放进 WorkBuddy 技能目录。
# 没有 WorkBuddy 的环境不需要它（可用 MD2PDF_SKILL_DIR 强制指定落点）。
SKILL_SRC="$ROOT/skill/SKILL.md"
if [ "${MD2PDF_SKILL:-1}" != "0" ]; then
  SKILL_DIR="${MD2PDF_SKILL_DIR:-}"
  if [ -z "$SKILL_DIR" ] && [ -n "$HOME" ] && [ -d "$HOME/.workbuddy" ]; then
    SKILL_DIR="$HOME/.workbuddy/skills/md-to-pdf"
  fi
  if [ -n "$SKILL_DIR" ] && [ -f "$SKILL_SRC" ]; then
    mkdir -p "$SKILL_DIR"
    cp "$SKILL_SRC" "$SKILL_DIR/SKILL.md"
    echo "✓ 已安装技能说明书：${SKILL_DIR}/SKILL.md"
    # 记进 .install-meta：md2pdf --upgrade 时环境里未必有 MD2PDF_SKILL_DIR，
    # 不记下来就会装到默认位置（或干脆不装），技能永远停在旧版。
    if [ -f "$ROOT/.install-meta" ]; then
      echo "skill=$SKILL_DIR" >> "$ROOT/.install-meta"
    fi
  fi
fi

echo
echo "试一下： md2pdf \"$ROOT/examples/demo.md\" --open"
if [ "${REMOTE:-0}" = "1" ]; then
  echo "升级：   md2pdf --upgrade   （或重跑同一条安装命令）"
  echo "卸载：   \"$ROOT/uninstall.sh\""
fi
