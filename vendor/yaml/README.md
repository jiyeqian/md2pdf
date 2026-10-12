# YAML 解析器

## 来源与用途

`yaml` 2.8.1，ISC 许可证，原始项目与版本信息记录于 `provenance.json`。`LICENSE` 随资源分发。

`yaml.mjs` 是独立的 Node.js 18+ ESM 包，只导出配置层使用的 `parseDocument`、`isMap` 和 `isSeq`。运行、安装 md2pdf 和 CI 校验不需要额外下载 YAML。

## 重建

```sh
node scripts/build-yaml.mjs
```

脚本在临时目录安装固定版本 `yaml@2.8.1`、`esbuild@0.25.4`，禁止安装脚本，生成资源、许可证及 SHA-256 来源记录，并清理临时目录。只有维护者重建时需要 npm 和网络；构建结果应与来源记录一起提交。
