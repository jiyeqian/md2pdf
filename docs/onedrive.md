# OneDrive 个人账户（试验中）

## 注册与配置

在 Microsoft Entra 注册支持个人 Microsoft 账户的应用，添加单页应用（SPA）平台和与部署地址完全一致的重定向 URI；添加 Microsoft Graph 委派权限 `Files.ReadWrite.AppFolder`。只需要公开的应用（客户端）ID，不创建或配置客户端密钥。浏览器直接与 Microsoft 登录服务及 Graph 通信，Markdown 不通过 md2pdf 服务中转。

编辑部署目录的 `onedrive-config.json`，填写 `clientId` 和 `redirectUri`。例如 Node 本机端口 3000 的回调为 `http://localhost:3000/onedrive-callback.html`；静态部署在 `https://example.com/md2pdf/` 时为 `https://example.com/md2pdf/onedrive-callback.html`。注册中须分别添加实际使用的每个地址；HTTPS 或 localhost 安全上下文是必需的。静态站点应在构建后修改产物中的配置，且每次发布后保留此配置；Node 使用 `web/onedrive-config.json`，修改后重新启动服务。不要在文件中放密钥。回调页面不得设置 Cross-Origin-Opener-Policy。

## 使用与限制

打开 Markdown 菜单提供 OneDrive 打开；下载菜单提供保存和另存。Cmd+Alt+S 或 Ctrl+Alt+S 触发云端保存，原有 Cmd+S 或 Ctrl+S 仍下载到本地。仅按需登录，认证信息保存在当前浏览器会话中；浏览器本地草稿继续独立保存。云端文件关联仅在当前页面会话中保留，切换或恢复草稿后请重新打开云端文件。文件位于 OneDrive 的应用专属文件夹，不支持选择任意目录或企业账户。

此功能尚未通过真实个人账户验收。当前禁止覆盖已有云端文件，请使用另存并指定不同文件名；空文件也暂不支持云端保存。最终提交的条件检查、权限覆盖、碰撞及网络中断行为仍需真实账户验证。失败时保留本地草稿；请求超时后请先检查云端是否已创建文件，避免误以为一定失败。

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
