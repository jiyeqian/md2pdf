#!/bin/sh
# md2pdf 卸载脚本
#
#   ./uninstall.sh               删除 PATH 命令；若是联网安装，连程序本体一起删
#   ./uninstall.sh --keep-files  只删命令，保留程序本体
#   curl -fsSL https://cnb.cool/jiyeqian/md2pdf/-/git/raw/main/uninstall.sh | sh
#
# 只删两个地方：PATH 里的 md2pdf 命令、联网安装的程序目录。不动系统其他配置。

set -e

KEEP=0
[ "$1" = "--keep-files" ] && KEEP=1

# ------------------------------------------------------------------ 删命令
for d in "/usr/local/bin" "$HOME/.local/bin" "${PREFIX:-/nonexistent}/bin"; do
  f="$d/md2pdf"
  if [ -L "$f" ]; then
    rm -f "$f"; echo "已移除软链 $f"
  elif [ -f "$f" ] && grep -q "md2pdf" "$f" 2>/dev/null; then
    # 软链不可用时的转发脚本
    rm -f "$f"; echo "已移除命令 $f"
  fi
done

# -------------------------------------------------------- 删程序本体（可选）
HOME_DIR="${MD2PDF_HOME:-$HOME/.local/share/md2pdf}"
if [ "$KEEP" = "1" ]; then
  echo "（--keep-files）程序本体保留：$HOME_DIR"
elif [ -f "$HOME_DIR/.install-meta" ]; then
  # .install-meta 是联网安装写的标记 —— 只有确认是自己的目录才删
  case "$HOME_DIR" in
    ""|"/"|"$HOME"|"$HOME/") echo "md2pdf: 拒绝删除 $HOME_DIR" >&2; exit 1 ;;
  esac
  rm -rf "$HOME_DIR"
  echo "已删除程序本体 $HOME_DIR"
else
  echo "未发现联网安装的程序目录（${HOME_DIR}），项目文件保留"
fi

# ------------------------------------------------------ 技能说明书（只提示）
# 不自动删：那是共享的技能目录，用户可能改过或还想留着。
SKILL_DIR="${MD2PDF_SKILL_DIR:-$HOME/.workbuddy/skills/md-to-pdf}"
if [ -f "$SKILL_DIR/SKILL.md" ]; then
  echo "技能说明书保留：${SKILL_DIR}"
  echo "  （如不再需要，删除该目录即可）"
fi

echo
echo "md2pdf 已卸载。"
