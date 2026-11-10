# syntax=docker/dockerfile:1
#
# md2pdf 静态版镜像（多阶段）
# 阶段1：用 Node 把前端构建成纯静态目录 dist/static（零 npm 运行时依赖，无需 npm install）
# 阶段2：用 nginx 托管静态文件 —— 无需 Node 运行时、无需 Chromium、无需服务器字体
#
# 用途：内网/公网静态部署，PDF 由访问者浏览器系统打印（Ctrl+P）生成。
# 注意：本 Dockerfile 不含任何版本号，版本只体现在镜像 tag（如 md2pdf-static:1.17.1），
#       因此发版时 Dockerfile 无需改动；仅在依赖或运行方式变化时调整。
#
# 说明：Docker 的 `COPY dir ./` 会把 dir 的内容平铺进目标目录（不保留 dir 自身），
#       故此处逐目录显式 COPY 到 /app/<同名子目录>，保证构建脚本按预期的相对路径找到源码。

# ---------- 阶段 1：构建静态产物 ----------
FROM node:22-alpine AS build
WORKDIR /app
# 仅拷贝静态构建所需内容，并保留各自的目录结构
COPY package.json /app/
COPY src /app/src
COPY assets /app/assets
COPY vendor /app/vendor
COPY web /app/web
# 候选图形只供研发对照，不属于静态应用资源；在生成离线清单之前排除。
RUN rm -rf /app/assets/candidates
# 直接调用 buildStatic() 生成 dist/static 后立即退出。
# （不要用 `webapp --static`，它会常驻启动静态服务器、卡住构建。）
RUN node -e "import('./src/static-build.mjs').then(m=>m.buildStatic()).catch(e=>{console.error(e);process.exit(1)})"

# ---------- 阶段 2：纯静态托管 ----------
FROM nginx:1.27-alpine
# 将 nginx 默认 80 端口改为 3000，匹配 md2pdf 约定端口
RUN sed -i 's/listen\s\+80;/listen 3000;/' /etc/nginx/conf.d/default.conf \
 && sed -i 's/listen\s\+\[::\]:80;/listen [::]:3000;/' /etc/nginx/conf.d/default.conf
# 关键：nginx 默认不识别 .mjs，会返回 application/octet-stream，导致浏览器拒绝执行
# ES module（index.html 大量 <script type="module" src="*.mjs">），页面整体失效。
# 把 .mjs 并入 application/javascript 类型即可（与 GitHub Pages 行为一致）。
RUN sed -i 's/\(application\/javascript[[:space:]]*js\);/\1 mjs;/' /etc/nginx/mime.types
# 拷贝构建阶段产出的静态目录
COPY --from=build /app/dist/static /usr/share/nginx/html
EXPOSE 3000
