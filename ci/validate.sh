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
examples/demo.md install.sh uninstall.sh package.json README.md LICENSE
skill/SKILL.md ci/inspect-pdf.mjs"
missing=""
for f in $REQUIRED; do [ -f "$TARGET/$f" ] || missing="$missing $f"; done
if [ -n "$missing" ]; then bad "缺少文件：$missing"; else good "必需文件齐全（$(echo $REQUIRED | wc -w | tr -d ' ') 项）"; fi

for f in bin/md2pdf install.sh uninstall.sh; do
  [ -x "$TARGET/$f" ] && good "$f 可执行" || bad "$f 缺少可执行位"
done

# 分发渠道是 git：必须真的被版本控制跟踪（防止文件只在本地存在）
if command -v git >/dev/null 2>&1 && git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1; then
  untracked="$(git -C "$TARGET" ls-files --error-unmatch bin/md2pdf src/md2pdf.mjs ci/validate.sh ci/checks.mjs skill/SKILL.md >/dev/null 2>&1; echo $?)"
  [ "$untracked" = "0" ] && good "关键文件已被 git 跟踪" || bad "关键文件未被 git 跟踪"
fi

# ------------------------------------------------------------ 语法检查
head2 "语法"
if [ -f "$TARGET/install.sh" ]; then
  sh -n "$TARGET/install.sh" && sh -n "$TARGET/uninstall.sh" && sh -n "$TARGET/bin/md2pdf" \
    && good "sh -n 通过（install/uninstall/bin）" || bad "shell 语法错误"
fi
for f in src/md2pdf.mjs src/ws.mjs ci/checks.mjs ci/inspect-pdf.mjs; do
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

# --------------------------------------------------- 联网安装自测（离线模拟）
# 用 file:// 伪造 CNB 的两条接口，把"一条命令安装"整条链路跑一遍。
# 关键是归档布局要仿真：CNB 的 /-/git/archive/<ref>.tar.gz 解出来是**扁平**的
# （没有顶层目录），和 git archive --prefix 打出来的包不一样。
head2 "联网安装自测（离线模拟）"
TMPI="$(mktemp -d)"
mkdir -p "$TMPI/fx/-/git/archive" "$TMPI/fx/-/git/raw/main" "$TMPI/root"
( cd "$TARGET" && tar cf - --exclude=.git --exclude=dist . ) 2>/dev/null | ( cd "$TMPI/root" && tar xf - ) 2>/dev/null
tar -czf "$TMPI/fx/-/git/archive/main.tar.gz" -C "$TMPI/root" . 2>/dev/null
cp "$TARGET/install.sh" "$TMPI/fx/-/git/raw/main/install.sh" 2>/dev/null

if ( cd "$TMPI" && MD2PDF_SRC="file://$TMPI/fx" MD2PDF_HOME="$TMPI/home" \
     MD2PDF_SKILL_DIR="$TMPI/skill" \
     PREFIX="$TMPI/prefix" sh -c "cat '$TARGET/install.sh' | sh" ) >"$TMPI/log" 2>&1; then
  good "联网安装成功（扁平归档布局）"
  if [ -x "$TMPI/prefix/bin/md2pdf" ] && "$TMPI/prefix/bin/md2pdf" --version >/dev/null 2>&1; then
    good "装出来的命令可直接运行（$("$TMPI/prefix/bin/md2pdf" --version)）"
  else
    bad "装出来的命令无法运行"
  fi
  if [ -f "$TMPI/home/.install-meta" ]; then
    good "写入 .install-meta（供 --upgrade 用）"
  else
    bad "缺少 .install-meta"
  fi
  # 技能说明书：随命令一起装，内容必须与仓库里的一致
  # （注意 MD2PDF_SKILL_DIR 指到临时目录，否则会写进真实的技能目录）
  if [ -f "$TMPI/skill/SKILL.md" ]; then
    if diff -q "$TARGET/skill/SKILL.md" "$TMPI/skill/SKILL.md" >/dev/null 2>&1; then
      good "技能说明书随命令一起安装（内容与仓库一致）"
    else
      bad "技能说明书内容与仓库不一致"
    fi
  else
    bad "技能说明书未安装"
  fi
  # .install-meta 要记下技能目录，否则 --upgrade 不知道该更新哪里
  if grep -q '^skill=' "$TMPI/home/.install-meta" 2>/dev/null; then
    good ".install-meta 记录了技能目录（--upgrade 才知道更新哪里）"
  else
    bad ".install-meta 未记录技能目录"
  fi
  # 装完再"升级"一次：应当成功、不破坏现有安装，且把技能说明书一并更新
  echo "stale" > "$TMPI/skill/SKILL.md"
  if ( cd "$TMPI" && "$TMPI/prefix/bin/md2pdf" --upgrade ) >"$TMPI/up.log" 2>&1 \
     && "$TMPI/prefix/bin/md2pdf" --version >/dev/null 2>&1; then
    good "md2pdf --upgrade 走通（同一来源覆盖安装）"
    if diff -q "$TARGET/skill/SKILL.md" "$TMPI/skill/SKILL.md" >/dev/null 2>&1; then
      good "升级同时更新了技能说明书"
    else
      bad "升级未更新技能说明书"
    fi
  else
    bad "md2pdf --upgrade 失败"; sed 's/^/      /' "$TMPI/up.log" | tail -6
  fi
  # 升级不得把命令漂到默认目录 —— PREFIX 必须从 .install-meta 恢复。
  # 曾经的 bug：doUpgrade 不传 PREFIX，安装脚本回落到 /usr/local/bin，
  # 把真实命令覆盖成指向临时目录的悬空软链。
  drifted=""
  for d in /usr/local/bin "$HOME/.local/bin"; do
    if [ -L "$d/md2pdf" ] && [ "$(readlink "$d/md2pdf" 2>/dev/null)" = "$TMPI/home/bin/md2pdf" ]; then
      drifted="$drifted $d"
    fi
  done
  if [ -n "$drifted" ]; then
    bad "升级把命令写进了默认目录：${drifted}（PREFIX 未从 .install-meta 恢复）"
  else
    good "升级未污染默认命令目录（命令落点从 .install-meta 恢复）"
  fi
  # 命令落点必须幂等 —— 每升级一次都不能多套一层 /bin。
  # 曾经的 bug：bin=（精确目录）被当成 PREFIX（前缀）回传，安装脚本再拼一层 /bin，
  # 于是 /usr/local/bin → …/bin → …/bin/bin 逐次加深（每次升级都没报错）。
  # 只查"默认目录有没有被污染"抓不到它，必须直接盯 meta 里的落点值。
  meta_bin() { sed -n 's/^bin=//p' "$TMPI/home/.install-meta" 2>/dev/null | tail -1; }
  base_bin="$(meta_bin)"
  if [ "$base_bin" = "$TMPI/prefix/bin" ]; then
    good "升级后命令落点正确（${base_bin}）"
  else
    bad "升级后命令落点漂移：${base_bin}（应为 $TMPI/prefix/bin）"
  fi
  # 连续再升一次：落点、meta、可运行性都不许变
  ( cd "$TMPI" && "$TMPI/prefix/bin/md2pdf" --upgrade ) >"$TMPI/up2.log" 2>&1 || true
  again_bin="$(meta_bin)"
  if [ "$again_bin" = "$base_bin" ]; then
    good "连续升级两次命令落点不变（幂等）"
  else
    bad "连续升级导致落点加深：${base_bin} → ${again_bin}"
  fi
  if [ -x "$TMPI/prefix/bin/md2pdf" ] && "$TMPI/prefix/bin/md2pdf" --version >/dev/null 2>&1; then
    good "连续升级后原落点命令仍可用"
  else
    bad "连续升级后原落点命令丢失"; sed 's/^/      /' "$TMPI/up2.log" | tail -5
  fi
  # 自愈：已经被旧版写坏的 meta（落点含多层 /bin）+ 遗留目录，升级后必须收敛
  mkdir -p "$TMPI/prefix/bin/bin" 2>/dev/null
  rm -f "$TMPI/prefix/bin/bin/md2pdf"
  ln -s "$TMPI/home/bin/md2pdf" "$TMPI/prefix/bin/bin/md2pdf" 2>/dev/null
  echo "bin=$TMPI/prefix/bin/bin" >> "$TMPI/home/.install-meta"
  ( cd "$TMPI" && "$TMPI/prefix/bin/md2pdf" --upgrade ) >"$TMPI/up3.log" 2>&1 || true
  healed="$(meta_bin)"
  if [ "$healed" = "$TMPI/prefix/bin" ]; then
    good "历史遗留的多层 /bin 落点被收敛（>${healed}）"
  else
    bad "历史遗留落点未收敛：${healed}（应为 $TMPI/prefix/bin）"
  fi
  if [ -e "$TMPI/prefix/bin/bin" ]; then
    bad "遗留目录未被清理：$TMPI/prefix/bin/bin"
  else
    good "遗留的命令目录被清理"
  fi
  # 防误删：安装目录指到家目录必须被拒绝
  if ( cd "$TMPI" && MD2PDF_SRC="file://$TMPI/fx" MD2PDF_HOME="$HOME" \
       MD2PDF_SKILL_DIR="$TMPI/skill" \
       PREFIX="$TMPI/prefix" sh -c "cat '$TARGET/install.sh' | sh" ) >/dev/null 2>&1; then
    bad "MD2PDF_HOME=\$HOME 竟然被接受 —— 防误删保护失效"
  else
    good "MD2PDF_HOME=\$HOME 被拒绝（防误删保护生效）"
  fi
else
  bad "联网安装失败"; sed 's/^/      /' "$TMPI/log" | tail -8
fi

# 技能说明书的两条"不该装"路径
( cd "$TMPI" && MD2PDF_SRC="file://$TMPI/fx" MD2PDF_HOME="$TMPI/home-off" \
  MD2PDF_SKILL_DIR="$TMPI/skill-off" MD2PDF_SKILL=0 \
  PREFIX="$TMPI/prefix-off" sh -c "cat '$TARGET/install.sh' | sh" ) >/dev/null 2>&1
if [ -f "$TMPI/skill-off/SKILL.md" ]; then
  bad "MD2PDF_SKILL=0 却仍安装了技能说明书"
else
  good "MD2PDF_SKILL=0 时跳过技能说明书"
fi

mkdir -p "$TMPI/plainhome"
( cd "$TMPI" && HOME="$TMPI/plainhome" MD2PDF_SRC="file://$TMPI/fx" \
  MD2PDF_HOME="$TMPI/home-plain" PREFIX="$TMPI/prefix-plain" \
  sh -c "cat '$TARGET/install.sh' | sh" ) >/dev/null 2>&1
if [ -f "$TMPI/plainhome/.workbuddy/skills/md-to-pdf/SKILL.md" ]; then
  bad "没有 WorkBuddy 环境却安装了技能说明书"
else
  good "无 WorkBuddy 环境时自动跳过技能说明书"
fi
rm -rf "$TMPI"

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

    # 破坏 4：文档里的一行安装命令与 install.sh 的仓库地址不一致（文档漂移）
    ( cd "$TARGET" && tar cf - README.md ) 2>/dev/null | ( cd "$TMP/proj" && tar xf - ) 2>/dev/null
    sed -i.bak 's|/-/git/raw/|/-/raw/|' "$TMP/proj/README.md" 2>/dev/null \
      || sed -i '' 's|/-/git/raw/|/-/raw/|' "$TMP/proj/README.md"
    if ( cd "$TMP/proj" && node ci/checks.mjs "$TMP/proj" >/dev/null 2>&1 ); then
      bad "README 的安装命令被改坏，校验却通过了 —— 渠道一致性检查失效"
    else
      good "README 安装命令漂移时校验正确失败"
    fi

    # 破坏 5：把 ${VAR} 改回裸 $VAR 并紧跟多字节字符（macOS bash 3.2 会吃掉半字符）
    # 注意：这里用变量拼出待替换字符串，避免本文件自身触发上面那条"裸变量"检查
    ( cd "$TARGET" && tar cf - install.sh ) 2>/dev/null | ( cd "$TMP/proj" && tar xf - ) 2>/dev/null
    BARE='$ROOT'
    sed -i.bak "s/\${ROOT}（/${BARE}（/" "$TMP/proj/install.sh" 2>/dev/null \
      || sed -i '' "s/\${ROOT}（/${BARE}（/" "$TMP/proj/install.sh"
    if ( cd "$TMP/proj" && node ci/checks.mjs "$TMP/proj" >/dev/null 2>&1 ); then
      bad "裸变量紧跟中文，校验却通过了 —— 多字节边界检查失效"
    else
      good "裸变量紧跟中文时校验正确失败"
    fi

    # 破坏 6：技能说明书的 frontmatter name 与技能目录名漂移
    # （先把副本恢复干净 —— 前面几步已把 install.sh / README.md 弄坏，否则会假阳性）
    ( cd "$TARGET" && tar cf - --exclude=.git --exclude=node_modules . ) 2>/dev/null | ( cd "$TMP/proj" && tar xf - ) 2>/dev/null
    sed -i.bak 's/^name: md-to-pdf$/name: md-to-pdff/' "$TMP/proj/skill/SKILL.md" 2>/dev/null \
      || sed -i '' 's/^name: md-to-pdf$/name: md-to-pdff/' "$TMP/proj/skill/SKILL.md"
    if ( cd "$TMP/proj" && node ci/checks.mjs "$TMP/proj" >/dev/null 2>&1 ); then
      bad "技能 frontmatter 被改坏，校验却通过了 —— 技能检查失效"
    else
      good "技能 frontmatter 漂移时校验正确失败"
    fi

    # 破坏 7：把目录项退回成纯文本（丢掉内链）
    # 待替换串用变量拼出 —— 直接写双引号里的 ${s.id} 会被本脚本的 shell 当成展开
    ( cd "$TARGET" && tar cf - --exclude=.git --exclude=node_modules . ) 2>/dev/null | ( cd "$TMP/proj" && tar xf - ) 2>/dev/null
    LI_LINK='<li><a href="#${s.id}">${esc(s.text)}</a></li>'
    LI_PLAIN='<li>${esc(s.text)}</li>'
    sed -i.bak "s|$LI_LINK|$LI_PLAIN|" "$TMP/proj/src/md2pdf.mjs" 2>/dev/null \
      || sed -i '' "s|$LI_LINK|$LI_PLAIN|" "$TMP/proj/src/md2pdf.mjs"
    if ( cd "$TMP/proj" && node ci/checks.mjs "$TMP/proj" >/dev/null 2>&1 ); then
      bad "目录项退回纯文本，校验却通过了 —— 可点击目录的断言失效"
    else
      good "目录项丢失内链时校验正确失败"
    fi

    # 破坏 8：去掉 PDF 书签参数（书签静默消失，转换仍"成功"）
    ( cd "$TARGET" && tar cf - --exclude=.git --exclude=node_modules . ) 2>/dev/null | ( cd "$TMP/proj" && tar xf - ) 2>/dev/null
    sed -i.bak 's/generateDocumentOutline: true/generateDocumentOutline: false/' "$TMP/proj/src/md2pdf.mjs" 2>/dev/null \
      || sed -i '' 's/generateDocumentOutline: true/generateDocumentOutline: false/' "$TMP/proj/src/md2pdf.mjs"
    if ( cd "$TMP/proj" && node ci/checks.mjs "$TMP/proj" >/dev/null 2>&1 ); then
      bad "书签参数被关掉，校验却通过了 —— 书签断言失效"
    else
      good "书签参数缺失时校验正确失败"
    fi

    # 破坏 9：把升级回传的落点改回 PREFIX（即复现 v1.2.1–v1.3.0 的漂移 bug）
    ( cd "$TARGET" && tar cf - --exclude=.git --exclude=node_modules . ) 2>/dev/null | ( cd "$TMP/proj" && tar xf - ) 2>/dev/null
    sed -i.bak 's/env\.MD2PDF_BIN_DIR = fixed/env.PREFIX = fixed/' "$TMP/proj/src/md2pdf.mjs" 2>/dev/null \
      || sed -i '' 's/env\.MD2PDF_BIN_DIR = fixed/env.PREFIX = fixed/' "$TMP/proj/src/md2pdf.mjs"
    if ( cd "$TMP/proj" && node ci/checks.mjs "$TMP/proj" >/dev/null 2>&1 ); then
      bad "落点被当作 PREFIX 回传（漂移 bug 复现），校验却通过了 —— 落点断言失效"
    else
      good "落点语义被写错时校验正确失败"
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
