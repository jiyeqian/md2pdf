# md2pdf 本地在线应用验收记录

## 交付范围

2026-10-02 完成计划阶段 0–2：文本渲染内核、受限 Node HTTP 服务、Markdown 编辑器、分页预览与 PDF 下载。仅本地运行，未部署到目标域名；公网环境、安全隔离和容量验收仍未进行。

实现位于 worktree `/Users/jiyeqian/.codex/worktrees/7f01/md2pdf`，分支 `codex/web-app`。提交保留在该分支，未合入 `main`，未打 tag 或 push。

## 启动与手工验收

```bash
cd /Users/jiyeqian/.codex/worktrees/7f01/md2pdf
npm start
```

打开 `http://127.0.0.1:3000`：

1. 确认默认示例加载，预览完成后显示「预览已更新」。
2. 修改正文，切换主题、类型、目录、字号、边距和编号，确认预览刷新。
3. 输入普通 Mermaid 代码块和公式，确认显示为图表与公式。
4. 点击「下载 PDF」，打开下载文件，检查中文、书签与目录链接。
5. 将 Mermaid 改成无效语法，确认出现失败提示；改回正常内容后再次导出。
6. 缩窄窗口，确认双栏转为上下布局，预览页宽适配可视区域。

服务默认仅监听本机；可用 `PORT=3100 npm start` 更换端口。未安装浏览器时，通过 `MD2PDF_CHROME` 指定 Chrome / Edge / Chromium 可执行文件。

## 自动验证证据

| 检查 | 结果与范围 |
| --- | --- |
| `npm test` | 112 项 CLI/HTML 断言、6 项破坏性守卫自测通过；不打印 PDF |
| 拆分前后 HTML 对比 | 五类示例 × 普通/分页 HTML，共 10 组；归一化仓库资源路径后完全一致 |
| `npm run test:web` | 8 组 HTTP/生命周期测试：输入校验、路由/Host/Origin、大小与 JSON、HTML/公式安全、队列满、失败重启、超时释放、停止后禁止启动 |
| `npm run test:browser` | 实际 Chromium 生成五类 PDF，显式启用目录；检查 PDF 文件头、书签和链接注解，以及错误 Mermaid 后恢复 |
| npm 打包范围 | `npm pack --dry-run --ignore-scripts` 确认 CLI 所需新模块与资源包含在包中，`web/` 未加入发布范围 |
| 通用文档分页预览 | 实际 Chrome 检测 3 页、12 个公式容器、1 个 Mermaid 图、9 个正文引用链接；无 MathJax 错误，内嵌图片可解码 |
| 浏览器交互 | 实际编辑、主题/目录切换和预览完成；Chrome 点击下载后文件落地，`pdfinfo` 确认 1 页 A4 PDF |

版面抽查：已查看 GB 封面及 general 第 2 页，中文、GB 标志、公式编号、引用与代码高亮正常。桌面 1365 × 900 和窄屏 390 × 844 下，无页面横向溢出；窄屏采用上下布局。

真实 PDF 验收样例的页数：general 3、skill 2、readme 3、paper 2、gb 8。页数与本机字体、浏览器版本及显式目录设置有关，不作为所有环境的固定值。

可重新生成验收 PDF：

```bash
MD2PDF_ACCEPTANCE_DIR=/tmp/md2pdf-web-acceptance npm run test:browser
node ci/inspect-pdf.mjs /tmp/md2pdf-web-acceptance/general.pdf
```

验证环境：macOS、Node.js v26.10.0、本机 Chrome 154。Node ≥ 18 的兼容目标保留，但本次没有单独运行 Node 18 测试。

## 边界与数据处理

- 请求体上限 1 MiB；正文上限 200,000 字符、5,000 行、300 个标题及 50 个 Mermaid 代码块。PDF 队列最多容纳 3 个运行/等待任务，单任务超时 60 秒，超时或浏览器失败后重启。
- 内容通过 HTTP 发到本机服务，应用不保存正文或编辑历史；刷新会丢失修改。HTML 在内存中生成，浏览器使用临时隐私会话，正常退出清理目录；异常强制终止可能留下临时浏览器目录。
- 外部与本机路径图片显示占位，不读取资源；内嵌 PNG/JPEG/GIF/WebP 支持。占位保留图号与引用。GB 标志是应用自带的受控 SVG。
- 原始 HTML 转义为文本。公式中的资源、链接及自定义宏不支持。服务浏览器阻止网络与文件 URL，预览 iframe 无同源权限；这些本地检查不能替代公网安全验收。
- 非 GB 预览使用 Paged.js，导出使用 Chrome 原生分页，页码、断页与字体可能不同，以 PDF 为准。GB 字体仍取决于本机字体。
- 两个自动化浏览器的下载事件等待接口未返回事件；实际 Chrome 下载文件已在 Downloads 中检查。浏览器下载能力的结论依据文件落地与 PDF 检查，而非等待接口。
