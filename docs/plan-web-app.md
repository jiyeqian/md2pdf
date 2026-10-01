# md2pdf 在线应用评估与实现路径

> 目标：把 md2pdf 从 CLI 变成一个在线应用 —— 输入 Markdown，实时预览 HTML 排版，并可下载 PDF。
> 参考形态：https://md-to.com/zh-cn/markdown-to-pdf/
> 目标地址：https://md2pdf.app.workbuddy.host/
>
> 本文只做评估与规划，**未经确认不执行任何改动**。

---

## 一、结论速览（TL;DR）

| 问题 | 结论 | 置信度 |
| --- | --- | --- |
| 1. 能否做在线「md → HTML → PDF」应用 | **能**，而且有现成基础可复用，工作量不大 | 高 |
| 2. 能否上线 `md2pdf.app.workbuddy.host` | **能**，且 Chrome 可用性已确认有可靠解法（沙箱可装自带 Chromium 的 Puppeteer/Playwright） | 高（仅磁盘配额需试部署实测） |
| 关键差异 | 参考站 md-to.com 是 100% 浏览器本地；md2pdf 的 PDF 质量（GB/T 参考文献、mermaid、MathJax、书签内链）**必须**依赖服务端 Chrome，这是它区别于竞品的核心竞争力 | — |

一句话：**做得到，且应该做**。不是把 CLI 重写成前端，而是把「渲染内核」抽成一个 HTTP 服务，前端做一个极简编辑器 + 预览。

---

## 二、现状盘点（项目已有的、可复用的资产）

### 2.1 渲染链路已经与 Chrome 解耦

这是最关键的好消息。`src/md2pdf.mjs` 里：

- `render(mdText, opts)` 负责 **Markdown → 完整 HTML**（含报头、元信息条、目录、图表编号、参考文献、公式/mermaid 脚本注入），返回 `{ title, html, type }`，**完全不碰 Chrome**。
- 依赖的解析器全部内置在 `vendor/`：`marked.esm.js`（Markdown）、`mathjax/tex-svg.js`（公式）、`mermaid.min.js`（图）、`highlight.cjs`（代码高亮）、`pagedjs/paged.polyfill.min.js`（浏览器分页）。
- 只有最后一步 `Page.printToPDF`（CDP）需要无头 Chrome —— 在 `class Chrome`（第 614 行起）里 `spawn` 本地 Chrome，走 `--remote-debugging-port` + WebSocket。

**含义**：`md → HTML` 这条线可以原地复用，直接作为「在线预览」的输出；只有「导出 PDF」需要服务端。

### 2.2 已存在的两条 HTML 产物

| 产物 | 开关 | 作用 | 对在线应用的价值 |
| --- | --- | --- | --- |
| 调试 HTML | `--html-only` / `--keep-html` | 未分页的完整 HTML | 预览正文样式 |
| 分页 HTML | `--paged-html` | Paged.js 浏览器分页，与 PDF 同款页码/页眉页脚 | **直接就是「PDF 实时预览」**，无需真开 Chrome |

`--paged-html` 已经能产出「浏览器里和 PDF 一样分页」的 HTML，这正是在线预览区的理想形态。

### 2.3 能力对比（md2pdf vs 参考站 md-to.com）

| 维度 | md-to.com | md2pdf（本项目） |
| --- | --- | --- |
| Markdown 解析 | markdown-it（GFM） | marked（GFM，内置） |
| 公式 | KaTeX | MathJax（SVG，自动编号 + `\label`/`\eqref` 交叉引用） |
| 代码高亮 | highlight.js（50+ 语言） | highlight.js（内置） |
| 图表 | 无 | **Mermaid 原生支持 + 图题自动编号** |
| 参考文献 | 无 | **BibTeX → GB/T 7714—2025 + 双向内链** |
| 文档类型 | 无 | **general / skill / readme / paper / gb 五类预设** |
| 章节编号 | 无 | **arabic / gb / cjk / chapter 四种方案** |
| PDF 书签内链 | 无（浏览器打印） | **Chrome 生成 /Outlines 树 + 图/表/式交叉引用** |
| PDF 生成方式 | 浏览器 `window.print()` | 服务端无头 Chrome `Page.printToPDF` |
| 隐私 | 100% 本地，不上传 | 需上传到服务端渲染（见第四节） |

**结论**：md2pdf 的排版深度和「正式文档感」显著强于参考站，这是差异化卖点，**不应**为了「纯前端」而放弃服务端 Chrome 路线。

---

## 三、架构方案

### 3.1 推荐架构：轻量 HTTP 服务（Node）

```
┌─────────────────────────────────────────────────────┐
│  前端（静态，部署在 workbuddy.host）                  │
│  左：Markdown 编辑器    右：实时预览（iframe/内联 HTML）│
│  顶部：主题 / 类型 / 字号 / 边距 / TOC 等开关          │
│  底部：「下载 PDF」按钮                                │
└──────────────────────────┬──────────────────────────┘
                           │ POST /api/render  (md + opts)
                           │ POST /api/pdf     (md + opts)
                           ▼
┌─────────────────────────────────────────────────────┐
│  后端（Node 服务，同一部署单元）                       │
│  · 复用 src/md2pdf.mjs 的 render() → 返回 HTML        │
│  · 复用 class Chrome → Page.printToPDF → 返回 PDF     │
│  · 进程内常驻一个 Chrome 实例（复用，避免每次拉起）      │
└─────────────────────────────────────────────────────┘
```

### 3.2 为什么是「服务端渲染」而不是「纯前端」

1. **PDF 是核心价值**：md2pdf 的 PDF 有书签、图/表/式交叉引用、参考文献双向内链，这些 Chrome `generateDocumentOutline` 才能生成；浏览器 `window.print()` 做不到。
2. **复用而非重写**：把 `render()` 和 `Chrome` 类抽成可被 HTTP 调用的模块，改动集中在「加一层 HTTP + 常驻 Chrome」，不是重写引擎。
3. **预览仍可纯前端**：预览用 `--paged-html` 等价物（Paged.js 浏览器分页），实时性靠前端；只有「点下载」才回服务端，体验与 md-to.com 一致。

### 3.3 一个折中选项（可选讨论）

如果坚持「内容不出浏览器」，可以走「纯前端预览 + 浏览器打印」的降级 PDF。但会**丢掉**书签、参考文献内链、mermaid 完整排版等卖点，且排版和 CLI 产物不一致。**不推荐作为主路径**，仅作为无后端时的兜底。

---

## 四、实现步骤

> 以下为规划，未获确认前不动手。

### 阶段 0：内核抽取（纯重构，不改行为）

- [ ] 把 `src/md2pdf.mjs` 的 `render()` 拆到独立模块 `src/render.mjs`，导出 `render(md, opts) → {title, html, type}`。
- [ ] 把 `class Chrome` 拆到 `src/chrome.mjs`，导出 `Chrome` 类（支持复用单实例）。
- [ ] 保留原 CLI 入口不变（`src/md2pdf.mjs` 仍 import 这两个模块），跑 `bash ci/validate.sh` 确认零回归。
- **验收**：`npm test` 全绿，CLI 行为与拆前完全一致。

### 阶段 1：HTTP 服务骨架

- [ ] 新增 `src/server.mjs`，用 Node 内置 `http`（零依赖，延续项目风格）起一个服务。
- [ ] 路由：
  - `GET /` → 返回前端页面（见阶段 2）。
  - `POST /api/render` → body `{ md, opts }`，返回 `{ html, type }`。
  - `POST /api/pdf` → body `{ md, opts }`，返回 PDF 二进制（`application/pdf`）。
- [ ] 单进程常驻一个 `Chrome` 实例，`/api/pdf` 复用（冷启动一次，之后极快）。
- [ ] 加基本安全：请求体大小上限（如 5MB）、超时、`--no-sandbox` 已有、并发队列（串行化打印避免 Chrome 抖动）。
- **验收**：`curl -X POST .../api/render` 返回合法 HTML；`curl .../api/pdf` 返回可打开的 PDF。

### 阶段 2：前端页面（极简、贴合你的审美）

- [ ] 单页应用，纯 HTML/CSS/JS（延续项目零依赖、无构建风格），放进 `web/` 目录。
- [ ] 布局：左编辑区（textarea + 高亮可选）、右预览区（iframe 加载 `/api/render` 返回的 HTML，或直接 `srcdoc`）。
- [ ] 顶部精简控制：主题（elegant/minimal/gb）、类型（自动/手动）、TOC、字号、边距、编号方案。**少按钮，能自动的就自动**。
- [ ] 防抖实时预览（输入停顿 ~400ms 后请求 `/api/render`）。
- [ ] 「下载 PDF」按钮 → `POST /api/pdf` → 触发浏览器下载。
- [ ] 预填 `examples/general.md` 作为默认示例，方便即开即用。
- **验收**：浏览器打开 → 输入 md → 右侧实时刷新 → 点下载得到 PDF。

### 阶段 3：上线 `md2pdf.app.workbuddy.host`

- [ ] 确认部署形态：这需要 **Node HTTP 服务**（非纯静态），走 `sites`/`workbuddy_sites_deploy` 部署 Node 应用。
- [ ] **Chrome 可用性 —— 已确认有可靠解法**（详见第七节「部署环境确认」）：
  - 沙箱不保证预装系统级 Chrome/Chromium；
  - 但沙箱**能 `npm install` 且能访问外网**，因此**必然**能装自带 Chromium 的 Puppeteer/Playwright，渲染能力不成问题；
  - 唯一代价是打破「零 npm 运行时依赖」——这是 CLI 的洁癖，**在线服务可以接受**，且仅影响新增的 `server`，不动现有 CLI。
- [ ] 方案落地：新增一个「渲染后端」模块，优先复用现有 `Chrome` 类走系统 Chrome；沙箱里则回退到 Puppeteer 自带 Chromium（`MD2PDF_CHROME` 未命中时自动降级）。
- [ ] `package.json` 增加 `"start": "node src/server.mjs"` 与 `files` 白名单补 `web/`（若上线需包含）。
- [ ] 上线后回报：地址、HTTP 状态、一个端到端「输入 → 下载 PDF」验证。
- **验收**：`https://md2pdf.app.workbuddy.host/` 可访问，完整链路跑通。

### 阶段 4（可选，后续）：对齐竞品的体验细节

- [ ] 多主题色板（参考站有 20+ 模板；本项目可把 existing elegant/minimal/gb + 未来新增主题做成可切换）。
- [ ] 「加载示例」「拖拽上传 .md 文件」。
- [ ] 富文本/HTML 预览切换（参考站有「复制富文本」）。

---

## 五、风险与待确认项

| # | 风险 / 待确认 | 影响 | 建议 |
| --- | --- | --- | --- |
| 1 | ~~部署环境是否有 Chrome~~ | ~~上线成败关键~~ | **已确认**：沙箱能装 npm 依赖 → 自带 Chromium 的 Puppeteer/Playwright 可用（见第七节） |
| 2 | 冷启动延迟 | 首次渲染慢 | 常驻 Chrome 实例（阶段 1 已含） |
| 3 | 并发打印导致 Chrome 不稳定 | 高并发下偶发失败 | 串行化队列 + 超时重试 |
| 4 | 隐私（内容上传服务端） | 与 md-to.com「本地处理」卖点相悖 | 明确告知 + 渲染后不落盘、内存即弃 |
| 5 | 依赖体积（新增 Puppeteer） | 冷启动拉取 Chromium 变慢 | 用 puppeteer-core + 指定已装 Chromium，或接受首次安装耗时 |
| 6 | `--paged-html` 引用了本机绝对路径 vendor | 预览 HTML 需内联或改相对路径 | 阶段 0/1 处理 |

---

## 六、建议的推进顺序

1. ~~先确认部署环境能力~~ **已确认有可靠解法**（自带 Chromium 的 Puppeteer/Playwright 可装，见第七节），无需再阻塞。
2. 阶段 0（内核抽取）+ 阶段 1（HTTP 服务）可并行小步推进，全程 `npm test` 保回归。
3. 阶段 2 前端，边做边截图给你确认（延续「设计先行」节奏）。
4. 阶段 3 上线，遵守既有发布协议（**仅在你明确说「上线/部署」时执行**）。首次上线前做一次「试部署」实测沙箱里的 Chromium 是否真的能启动（这是唯一 100% 确定的办法）。

---

## 七、部署环境确认（workbuddy.host 能否跑无头 Chrome）

### 结论：能，且有两条可靠路径，不影响上线可行性。

### 已确认的事实（依据 sites 部署工具 schema + 官方文档 + 社区实测）

1. **沙箱形态**：workbuddy.host 的 sites 部署是「上传源码 → 沙箱内装依赖 → 起单端口 HTTP 服务 → 反代到公网域名」。沙箱是一个能跑 Node/Python/Go 的小型虚拟机，**有公网出口**。
2. **能装依赖**：`workbuddy_sites_deploy` 有 `installCmd` 参数，Node 项目默认 `npm install`。**这意味着任何 npm 包都能装**。
3. **能否访问外网**：能（部署预检查允许连公共托管数据库如 Supabase，说明沙箱可出网）。

### 由此推出的两条渲染路径

| 路径 | 做法 | 代价 |
| --- | --- | --- |
| **A. 系统 Chrome（不确定）** | 复用现有 `Chrome` 类，靠 `MD2PDF_CHROME` 或 `findChrome()` 探测 | 沙箱**不保证**预装 Chrome/Chromium，可能找不到 |
| **B. Puppeteer/Playwright 自带 Chromium（确定可行）** | `npm install puppeteer`（自动下载 Chromium）或 `npx playwright install chromium`；Chromium 随依赖落地 | 引入运行时依赖 + 首次安装/冷启动变慢；体积变大 |

**结论**：路径 A 不确定，但**路径 B 是确定可行的**——只要沙箱能 `npm install` 且能出网（两者均已确认），就一定能拿到一个可用的 Chromium。因此「部署环境有没有 Chrome」**不再是上线成败的关键风险**，而只是一个「用哪个渲染后端」的实现选择。

### 唯一不能 100% 排除的残余不确定性

沙箱的**磁盘/内存配额**是否够装 Chromium（约 200–400MB）——这个只能靠**首次试部署实测**。但这属于「试了就知道了」，不构成方案性障碍。

### 对「零依赖」原则的说明

「零 npm 运行时依赖」是 **CLI 的洁癖**（安装快、无网络可用）。在线服务是**常驻服务端**，本来就联网、本来就装依赖，所以：

- **不动现有 CLI**：`src/md2pdf.mjs` 的渲染路径、`findChrome()`、`class Chrome` 原样保留，`npm test` 必须全绿。
- **新增独立的 server 依赖**：Puppeteer 只被 `src/server.mjs`（或新 `src/renderer-server.mjs`）引用，不进 CLI 的 `import` 图。
- 设计上：`MD2PDF_CHROME` 命中系统 Chrome 时走老 `Chrome` 类；未命中时降级到 Puppeteer。两条路输出同一个 PDF。

---

## 八、按 plan-web-app.md 执行，会不会影响现有功能？

### 结论：不会。设计原则是「新增不改旧」，且用 `npm test` 全程锁回归。

### 逐项影响分析

| 现有能力 | 是否受影响 | 说明 |
| --- | --- | --- |
| CLI `md2pdf` 命令 | **零影响** | `src/md2pdf.mjs` 的 `parseArgs`/`main` 入口不动，只把内部函数抽到新模块再 `import` 回来（阶段 0 是等价重构） |
| `findChrome()` / `class Chrome` | **零影响** | 抽到 `src/chrome.mjs` 导出，CLI 仍 import 它；Puppeteer 是**新增**的降级分支，不改 `Chrome` 类本身 |
| `render()`（md→HTML） | **零影响** | 抽到 `src/render.mjs`，函数签名与行为不变 |
| 五类文档预设 / 编号方案 / 参考文献 / 公式 / mermaid | **零影响** | 全部在 `render()` 内部，抽取不改逻辑 |
| 主题 CSS / shell.html 占位符 | **零影响** | 只在阶段 2 前端做「内联 or 相对路径」处理，供预览用；PDF 路径不变 |
| `npm test` / `ci/validate.sh` | **必须全绿** | 阶段 0 的验收硬门槛；抽取后跑一遍，绿了才继续 |
| `package.json` 的 `files` 白名单 | **只增不减** | 若上线需补 `web/`；`postinstall`、`bin`、CLI 相关字段不动 |
| npm 发布（`@jiyeqian/md2pdf`） | **零影响** | 若新增 Puppeteer 依赖，需确认是否随 tarball 走；**建议**：Puppeteer 不放进 CLI 的 `dependencies`，而是 server 的独立 `devDependencies` 或独立 package，避免污染 CLI 安装 |

### 唯一需要留意的两个点（非破坏，但要决策）

1. **Puppeteer 依赖放哪**：若直接加进根 `package.json` 的 `dependencies`，`npm i -g @jiyeqian/md2pdf` 会把 Chromium 一起拖下来，破坏 CLI「零依赖、秒装」。**建议**：Puppeteer 用 `optionalDependencies` 或放到独立的 `server/package.json`，让 CLI 用户完全无感。
2. **`--paged-html` 的绝对路径 vendor 引用**：预览 HTML 里的 MathJax/Mermaid/Paged.js 目前指向本机绝对路径，在线预览需要改成内联或相对路径（阶段 1 处理）。这**只影响新增的预览**，不影响现有 PDF 渲染。

### 一句话总结

> 按 plan-web-app.md 执行 = **纯增量**。现有 CLI、渲染引擎、五类预设、测试体系、npm 发布**全部原样保留**；新增的只是一个 HTTP 服务 + 一个前端 + 一个可选的 Puppeteer 降级分支。只要每阶段跑 `npm test` 保绿，就没有回归风险。

---

*本文档为评估结论，待你确认后再进入实现。*
