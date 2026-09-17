#!/bin/sh
# md2pdf 安装脚本（macOS / Linux）
#
#   ./install.sh            安装到 /usr/local/bin（无权限时自动改用 ~/.local/bin）
#   PREFIX=~/.local ./install.sh
#
# 它只做一件事：把 bin/md2pdf 软链接到 bin 目录。不改动系统其他配置。

set -e

ROOT="$(cd -P "$(dirname "$0")" && pwd)"

if [ -n "$PREFIX" ]; then
  BIN_DIR="$PREFIX/bin"
else
  BIN_DIR="/usr/local/bin"
  if [ ! -w "$BIN_DIR" ]; then BIN_DIR="$HOME/.local/bin"; fi
fi

mkdir -p "$BIN_DIR"
# 注意：不用 ln -sf —— BSD 版会先建临时文件再 unlink，在受限环境（沙箱）里会失败
rm -f "$BIN_DIR/md2pdf"
if ! ln -s "$ROOT/bin/md2pdf" "$BIN_DIR/md2pdf" 2>/dev/null; then
  # 软链不可用（例如某些受限目录）时退化为复制启动器
  cp "$ROOT/bin/md2pdf" "$BIN_DIR/md2pdf"
  chmod +x "$BIN_DIR/md2pdf"
  echo "（软链不可用，已改为复制启动器；项目更新后需重新运行 install.sh）"
fi

echo "md2pdf 已链接：$BIN_DIR/md2pdf -> $ROOT/bin/md2pdf"

# 检查 node
NODE=""
for c in "$HOME/.workbuddy/binaries/node/versions/22.22.2-3/bin/node" \
         "/usr/local/bin/node" "/opt/homebrew/bin/node" "/usr/bin/node" \
         "$(command -v node 2>/dev/null)"; do
  [ -x "$c" ] && NODE="$c" && break
done
if [ -z "$NODE" ]; then
  echo "⚠️  未找到 Node.js。请安装 Node >= 22（更老版本也可用，会走内置 WebSocket 实现）。"
else
  MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$MAJOR" -lt 22 ] 2>/dev/null; then
    echo "⚠️  检测到 Node $MAJOR（<$("$NODE" -p 'process.versions.node' 2>/dev/null)）。建议升级到 22+；当前会自动使用内置 WebSocket 实现。"
  else
    echo "✓ Node $("$NODE" -p 'process.versions.node')"
  fi
fi

# 检查 Chrome
CHROME=""
for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
         "/Applications/Chromium.app/Contents/MacOS/Chromium" \
         "/usr/bin/google-chrome" "/usr/bin/chromium" "/usr/bin/chromium-browser" \
         "$(command -v google-chrome 2>/dev/null)" "$(command -v chromium 2>/dev/null)"; do
  [ -x "$c" ] && CHROME="$c" && break
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

echo
echo "试一下： md2pdf \"$ROOT/examples/demo.md\" --open"
