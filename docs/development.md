# 开发与发布

## 本地开发

```bash
git clone https://github.com/jiyeqian/md2pdf.git
cd md2pdf
npm install
npm start
```

运行项目校验：

```bash
npm test
npm run check:consistency
```

WebApp 与跨运行环境的人工验收要求见[交接与一致性说明](cross-runtime-handoff.md)和[验收记录](web-app-acceptance.md)。

## 版本与发布

`package.json` 是唯一版本来源，CLI 与服务端、静态 WebApp 共用该版本。发布 tag 使用 `v版本号` 格式；三种发布产物应来自同一提交。项目的 CNB 流水线负责构建和 npm 发布，凭据配置及运行维护说明不属于终端用户使用指南。

## 许可

项目使用 MIT 许可证。第三方资源及其许可证见各自随附的许可文件和来源说明；重新分发前应一并保留对应声明。
