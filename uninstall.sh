#!/bin/sh
# 卸载：删除 md2pdf 的 PATH 软链接
set -e

for d in "/usr/local/bin" "$HOME/.local/bin" "${PREFIX:-/nonexistent}/bin"; do
  if [ -L "$d/md2pdf" ]; then
    rm -f "$d/md2pdf"
    echo "已移除 $d/md2pdf"
  fi
done
echo "md2pdf 命令已卸载（项目文件保留，可重新 ./install.sh）"
