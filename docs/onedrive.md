# OneDrive 个人账户（试验中）

## 注册与配置

在 Microsoft Entra 注册支持个人 Microsoft 账户的应用，添加单页应用（SPA）平台和与部署地址完全一致的重定向 URI；添加 Microsoft Graph 委派权限 `Files.ReadWrite.AppFolder`。只需要公开的应用（客户端）ID，不创建或配置客户端密钥。浏览器直接与 Microsoft 登录服务及 Graph 通信，Markdown 不通过 md2pdf 服务中转。

Node 部署先执行 `cp web/onedrive-config.example.json web/onedrive-config.json`，再编辑本地配置，填写 `clientId` 和 `redirectUri`。该配置被 Git 忽略，不放客户端密钥。例如 Node 本机端口 3000 的回调为 `http://localhost:3000/onedrive-callback.html`；静态部署在 `https://example.com/md2pdf/` 时为 `https://example.com/md2pdf/onedrive-callback.html`。注册中须分别添加实际使用的每个地址；HTTPS 或 localhost 安全上下文是必需的。Node 读取本地 `web/onedrive-config.json`，修改后重新启动服务。静态构建从空白模板生成 `dist/static/onedrive-config.json`，不会复制本机配置；部署者需在构建完成后、每次发布前向该产物注入相应公开配置。不要在文件中放密钥。回调页面不得设置 Cross-Origin-Opener-Policy。

npm 全局安装时，可在 `$(npm root -g)/@jiyeqian/md2pdf/web/` 下从同名 example 文件复制并填写配置，然后重启工作台；写入权限取决于安装目录，升级或重装后需重新检查配置。

Docker 镜像以静态目录 `/usr/share/nginx/html` 提供文件。先在宿主机准备含公开配置的 `onedrive-config.json`，再在启动容器时只读挂载：

```sh
docker run -d --name md2pdf -p 127.0.0.1:3000:3000 \
  --mount type=bind,src="$(pwd)/onedrive-config.json",dst=/usr/share/nginx/html/onedrive-config.json,readonly \
  ghcr.io/jiyeqian/md2pdf:latest
```

宿主机文件必须事先存在；镜像重建不会自动填入配置。

## 使用与限制

打开 Markdown 菜单提供 OneDrive 打开；Markdown 保存菜单提供本地下载和 OneDrive 保存；云端保存每次创建新文件并提示文件名，同名冲突不会覆盖。Cmd+Alt+S 或 Ctrl+Alt+S 打开云端保存，Cmd+S 或 Ctrl+S 下载到本地。仅按需登录，认证信息保存在当前浏览器会话中；浏览器本地草稿继续独立保存。云端文件关联仅在当前页面会话中保留，切换或恢复草稿后请重新打开云端文件。文件位于 OneDrive 的应用专属文件夹，不支持选择任意目录或企业账户。

此功能尚未通过真实个人账户验收。当前禁止覆盖已有云端文件，请保存为不同文件名；空文件也暂不支持云端保存。新文件采用普通上传会话并要求同名冲突失败；只有返回文件信息、字节数与无凭据读回内容均匹配时才显示保存成功。实际权限、碰撞及网络中断行为仍需真实账户验证。失败时保留本地草稿；请求超时后请先检查云端是否已创建文件，避免误以为一定失败。

PDF 菜单中，打印使用 Cmd+P 或 Ctrl+P；下载 PDF 使用 Cmd+Alt+P 或 Ctrl+Alt+P。服务器版可直接生成 PDF 下载，静态版提供文档打印，直接下载会提示使用服务器版。

Microsoft 参考：[SPA 授权码与 PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)、[应用专属文件夹](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder)、[上传会话](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0)。

## 验收入口与验证范围

在工作树 `/Users/jiyeqian/.codex/worktrees/onedrive/md2pdf` 中启动 Node WebApp：

```sh
cd /Users/jiyeqian/.codex/worktrees/onedrive/md2pdf
./bin/md2pdf webapp --port 3000
```

访问 `http://localhost:3000/`。静态 WebApp 使用以下命令，访问 `http://localhost:3001/`：

```sh
cd /Users/jiyeqian/.codex/worktrees/onedrive/md2pdf
./bin/md2pdf webapp --static --port 3001
```

两种入口均需先启动对应服务；源码或配置变更后应重启。端口被占用时请更换端口，并相应注册和配置回调地址。

已通过 OneDrive 认证、Graph 和快捷键针对性测试，Node 与静态嵌套路径的模拟浏览器测试，以及 `npm run check:consistency`。既有 `tests/workspace-actions-browser-checks.mjs` 在第 59 行等待返回编辑器时超时，main 工作树同样复现。模拟测试不能代替真实微软账户授权、应用文件夹权限、上传提交与碰撞行为验收；独立窗口也仍待验收。

## 部署时的内容安全策略

Node 服务对编辑器使用限制性的 CSP，允许 Microsoft 登录服务 `https://login.microsoftonline.com`、Graph `https://graph.microsoft.com`、个人 OneDrive 下载 `https://*.files.1drv.com` 、上传 `https://*.up.1drv.com` 以及实际返回的 `https://my.microsoftpersonalcontent.com` 的连接；隐藏登录 iframe 也需要允许 `https://login.microsoftonline.com`，回调页面需允许同源页面嵌入。静态目录和 Docker 镜像本身未新增 CSP；若部署者在代理或托管平台设置 CSP，需在现有策略中加入这些地址，同时保留已有功能所需的源（例如静态 DOI 查询的 `https://api.crossref.org` 和 `https://api.datacite.org`）。不要使用宽泛的 `https:` 或 `*` 作为替代。

上述下载域名见 [OneDrive 个人版网络要求](https://learn.microsoft.com/en-us/sharepoint/required-urls-and-ports)，上传域名见 [Graph 上传会话示例](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0)，iframe 回调要求见 [MSAL 登录文档](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/login-user)。实际个人账户返回的预认证地址仍需在真实验收时确认；`my.microsoftpersonalcontent.com` 有 [Microsoft Q&A 实际返回示例](https://learn.microsoft.com/en-us/answers/questions/1691263/some-accounts-cannot-upload-files)，并非完整域名规范。

## 本轮菜单验证记录

Node 与静态版的 PDF 菜单、CDP 键盘事件、打印启动及打印文档快照验证通过；OneDrive、本地草稿、主屏入口浏览器测试和 31 项服务器／快捷键检查、一致性检查通过。服务器下载的浏览器测试使用模拟 PDF 服务；系统打印对话框、真实 PDF 视觉及独立窗口仍需人工验收。

补充回归：统计浏览器测试已覆盖屏外预览暂停、缓存兜底及可见后真实终态；原失败源于测试未考虑屏外暂停。工作区导航浏览器测试使用真实源码映射和版本协议，验证全屏退出后的目标高亮与可见位置；原夹具沿用旧行号和定位标记。两项测试已通过，统计采集范围和产品同步逻辑未变。

## 提示布局验证

OneDrive 提示位于编辑器工具栏之后；长错误可在限高区域滚动并关闭。Node 与静态版已使用模拟数据检查桌面、390px、320px 及 390×568 短屏，覆盖未配置、打开成功和长错误，并额外验证 Node 写作全屏；独立窗口尚未进行本次专项验收。图片错误浮层与 DOI、草稿、导出状态的长内容已检查；图片插入成功仍不显示通知。
