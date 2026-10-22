# 2026-10-22 main 分支整合记录

## 范围与完整性

按用户指令，将 7b10、f96a、analytics 三个工作树对应的本地分支合并到 `/Users/jiyeqian/Workspace/md2pdf` 的 main。起点为 `8c9314f`，采用三次 `--no-ff` 合并，保留全部原始提交与各分支历史，共纳入 18 个此前不在 main 中的提交。开始时主工作树和三个来源工作树均干净，没有排除或暂存未提交内容。未合并其他会话的新任务，未推送、未修改 tag、未发布网站。

| 工作树 | 来源分支 | 来源 HEAD | 新增提交数 | 合并提交 |
| --- | --- | --- | --- | --- |
| `7b10` | `codex/editor` | `bb461f1` | 4 | `b8877e2` |
| `f96a` | `codex/template` | `eaf767a` | 10 | `9a92b8f` |
| `analytics` | `codex/analytics` | `c8e7994` | 4 | `5113900` |

## 纳入的提交

7b10：

- `1350d59` feat(editor): dock writing sidebars and unify workspace controls
- `1a0c7be` fix(editor): place outdent before indent
- `9b58fe8` feat(web): compact topbar and simplify page titles
- `bb461f1` fix(web): soften brand tagline color

f96a：

- `a513889` feat(theme): simplify minimal typography and decorations
- `a09882b` fix(theme): refine minimal boundaries and task alignment
- `f7bc571` style(theme): use three-rule minimal tables
- `777e95a` style(theme): tighten and balance minimal table spacing
- `2e61ec0` feat(template): unify task lists and default general to Chinese numbering
- `26babf9` feat(paper): support structured authors and affiliation links
- `549815f` docs(paper): expand example authors and affiliations
- `ba725d2` fix(paper): hide unused affiliations and number distinct author groups
- `25161da` style(minimal): use black text and table rules for printing
- `eaf767a` fix(minimal): draw black readonly task checkboxes

analytics：

- `f006aaa` feat(analytics): add consented privacy-preserving usage metrics
- `f1b5a3d` feat(analytics): separate operational counts and consented browser metrics
- `e955778` style(web): simplify privacy dialog and unify footer status
- `c8e7994` docs(privacy): simplify dialog and clarify automatic counts

## 冲突与解决

7b10 无文本冲突。f96a 与 analytics 各产生两处冲突，共四处：

| 合并 | 文件 | 解决方式 |
| --- | --- | --- |
| f96a | `tests/web-options-checks.mjs` | 同时保留页面方向与通用文档中文编号两组测试 |
| f96a | `web/editor-pro.js` | 保留编辑器的 details/summary 折叠结构，标题合并为“引用、章节与作者单位检查” |
| analytics | `tests/editor-layout-checks.mjs` | 保留新版 MAKE MD2PDF GREAT 品牌与 md2pdf 页面标题测试，增加中央底栏测试，移除冲突中的旧品牌断言 |
| analytics | `web/app.css` | 采用 analytics 的左隐私／中央更新或备份／右版本布局，保留编辑器其余顶部栏、导航与焦点样式规则 |

README、package.json、服务端、示例路由等其余重叠文件由 Git 自动合并；新增作者模块、模板示例、测试、统计迁移以及二进制模板预览均随分支完整纳入，未以整文件 ours/theirs 覆盖。

## 整合验证修正

首次完整 Web 测试出现 13 个失败，原因是旧 VM 测试环境未跟上现有浏览器入口：DOI 夹具只剥离首个 import，配置错误夹具缺少 Event、dispatchEvent 和 navigator.onLine。补齐模拟后完整复跑通过。真实编辑器控制测试中的检查面板旧标题也更新为合并后的完整标题。修正仅涉及测试，未为通过测试改变生产渲染或网络规则。

## 验证结果

- `npm run check:consistency`：四类文档的 CLI、Node 与静态共同输入范围、版本一致性通过。
- `npm run test:analytics`：26/26。
- `npm run test:config`：73/73。
- `npm run test:web`：385/385；前置 editor-core 检查通过。
- `node tests/ui-controls-browser-checks.mjs`：导航、停靠侧栏、任务插入、折叠、1440/780/390px 布局通过。
- `npm run test:analytics-browser`：同意、拒绝、撤回、本地同意上报、底栏、小屏与静态子路径离线刷新通过；统计请求由本机夹具拦截，没有发送到生产接收器。
- `node tests/paper-authors-browser-checks.mjs`：elegant/minimal 作者与单位、通讯作者、链接、三端一致性与 PDF 通过。
- `node tests/minimal-theme-browser-checks.mjs`：表格、列表连续编号、三端预览与 PDF 通过。
- `node tests/task-list-browser-checks.mjs`：general/paper/skill × elegant/minimal，另含 gb/gb，共 7 种组合通过。
- `bash scripts/validate.sh`：完整校验及破坏副本守卫自测全部通过。

本地生成的 PDF／首屏截图位于 `/private/var/folders/j7/hx5hf57d4mncbp8s2nwkj5yw0000gn/T/md2pdf-paper-authors-review/`、`md2pdf-minimal-theme-review/`、`md2pdf-task-list-review/`；已抽看作者单位和 minimal 首屏。临时目录可能被系统清理。此验证不代替手机实机、系统打印保存对话框、线上 Pages 缓存或生产服务器验收。没有更改已部署的 Cloudflare 接收器。

## 验收与其他会话同步

main 专用验收入口使用 3182（服务端）和 3183（静态）；3180/3181 仍属于 analytics 工作树，不能拿它们证明 main 整合结果。

```bash
cd /Users/jiyeqian/Workspace/md2pdf
./bin/md2pdf webapp --port 3182
./bin/md2pdf webapp --static --port 3183
```

修改源文件后需重启或重建对应服务。检查编辑器侧栏／折叠、模板库 paper 多作者示例、minimal 表格与任务列表、隐私弹窗及中央底栏切换。各来源分支和工作树保留原状态；其他会话继续开发前先检查自己的修改，保存后阅读本交接并自行同步 main，禁止重置覆盖工作。当前记录不表示已向其他会话发送消息。
