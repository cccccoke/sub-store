# AGENTS.md

## 适用范围

本文件中的说明适用于整个仓库。

## 项目用途

本仓库存放用户自行维护的 Sub-Store 脚本，用于生成最终的 Stash YAML 配置。仓库只保存转换逻辑和基础策略，禁止加入真实订阅地址、Token、UUID、密码、私有节点数据或生成后的私有配置。

处理流水线如下：

1. `subscriptions/prepare-proxies.js` 处理每个单独订阅，补充订阅来源和节点默认属性。
2. `collections/aggregate-subscription-usage.js` 聚合流量信息，但不修改节点。
3. `collections/normalize-proxy-names.js` 生成 Stash 配置生成器所依赖的规范节点名。
4. `files/generate-stash-config.js` 将规范化后的组合订阅与 `files/stash-base-config.yaml` 组装为最终配置。
5. `files/set-stash-response-headers.js` 设置供 Stash 使用的最终 HTTP 响应头。

修改流水线行为或装配说明前，必须先阅读 `README.md`。

## 运行时模型

- JavaScript 文件运行在 Sub-Store 内部，不是普通的 Node.js 模块。
- 操作脚本必须保留全局入口 `async function operator(proxies, targetPlatform, context)`。不要添加 `import`、`export`、CommonJS 包装或仅 Node.js 可用的 API。
- 文件脚本和响应脚本会使用 Sub-Store 提供的全局对象，包括 `$substore`、`$arguments`、`$options`、`$content`、`$res`、`flowUtils`、`ProxyUtils` 和 `produceArtifact`。
- `files/generate-stash-config.js` 有意使用顶层 `await`。本地应按模块语法检查，但不要因此将脚本改造成 ES Module。
- 在普通本地 Node.js 环境中出现“Sub-Store 全局对象未定义”属于正常现象。本地只做静态检查，实际行为通过 Sub-Store 预览验证。

## 必须保持的约束

- 组合订阅脚本顺序必须是：先聚合流量，再规范化节点名称。
- 文件生成器和响应转换器中的 `COLLECTION_NAME = 'Sub-Store'` 必须保持一致。
- 必须保持节点命名契约：
  `SUBSCRIPTION-REGION-PROTOCOL-[F|SP]-[V6]-NN`。
- 如果修改节点命名契约，必须在同一次变更中同步修改 `collections/normalize-proxy-names.js` 和 `files/generate-stash-config.js`。
- 生成器必须在写入 `$content` 前拒绝以下情况：节点或策略组重名、空策略组、引用不存在、自引用、循环引用和无效规则目标。
- 基础配置最后一条规则必须保持为 `MATCH,Default Proxy`。
- `files/stash-base-config.yaml` 中的规则目标必须与生成器创建的策略组名称保持一致。
- 流量聚合默认使用严格模式，并且必须原样返回节点列表。
- 响应转换器可以修改响应头，但不能替换已经生成的正文或响应状态。
- 生成器中的 Stash 版本假设属于兼容性敏感内容；修改运行时语义前，应先核对当前 Sub-Store 与 Stash 官方文档。

## 仓库规范

- 目录使用复数英文名称，文件名使用小写 kebab-case。
- 运行时代码注释保持简洁；安装、装配和架构说明统一维护在 `README.md`。
- 路径、脚本顺序、参数、硬编码名称、输出命名规则或装配步骤发生变化时，必须同步更新 `README.md`。
- 行为修改应保持最小范围。不要把重命名或文档任务与无关的节点选择、路由策略修改混在一起。

## 校验要求

修改后运行所有相关静态检查：

```bash
node --check subscriptions/prepare-proxies.js
node --check collections/aggregate-subscription-usage.js
node --check collections/normalize-proxy-names.js
node --input-type=module --check < files/generate-stash-config.js
node --check files/set-stash-response-headers.js
ruby -e 'require "yaml"; path = "files/stash-base-config.yaml"; YAML.safe_load(File.read(path), aliases: true, filename: path)'
```

如果修改了实际行为，还必须在 Sub-Store 中预览组合订阅和文件，并将生成的 URL 导入 Stash。确认节点与策略组非空、引用有效、响应头正确且 Stash 能成功加载后，才能声称运行时验证通过。
