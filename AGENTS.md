# AGENTS.md

## 适用范围

本文件中的说明适用于整个仓库。

## 项目用途

本仓库存放用户自行维护的 Sub-Store 脚本，用于生成最终的 Stash YAML 配置。仓库只保存转换逻辑和基础策略，禁止加入真实订阅地址、Token、UUID、密码、私有节点数据或生成后的私有配置。

处理流水线如下：

1. `subscriptions/prepare-proxies.js` 处理每个单独订阅，只补充订阅来源前缀。
2. `collections/aggregate-subscription-usage.js` 聚合流量信息，但不修改节点。
3. `collections/normalize-proxy-names.js` 生成 Stash 配置生成器所依赖的规范节点名。
4. Sub-Store File 使用官方“从订阅添加节点”操作，把规范化节点以替换模式写入远程基础配置。
5. `files/generate-stash-config.js` 读取已经注入的 `$content.proxies`，生成并校验策略组。
6. `files/set-stash-response-headers.js` 设置供 Stash 使用的最终 HTTP 响应头。
7. Stash 从 `rules/*.yaml` 后台更新独立规则集合。

修改流水线行为或装配说明前，必须先阅读 `README.md`。

## 运行时模型

- JavaScript 文件运行在 Sub-Store 内部，不是普通的 Node.js 模块。
- 操作脚本必须保留全局入口 `async function operator(proxies, targetPlatform, context)`。不要添加 `import`、`export`、CommonJS 包装或仅 Node.js 可用的 API。
- 文件脚本和响应脚本会使用 Sub-Store 提供的全局对象，包括 `$substore`、`$arguments`、`$options`、`$content`、`$res`、`flowUtils` 和 `ProxyUtils`。
- `files/generate-stash-config.js` 是顶层 File Script，不使用 `operator()`，也不应重新加入 `produceArtifact()` 或硬编码组合订阅名称。
- 在普通本地 Node.js 环境中出现“Sub-Store 全局对象未定义”属于正常现象。本地只做静态检查，实际行为通过 Sub-Store 预览验证。

## 必须保持的约束

- 组合订阅脚本顺序必须是：先聚合流量，再规范化节点名称。
- File 操作顺序必须是：官方“从订阅添加节点”替换节点，再运行 `generate-stash-config.js`，最后运行响应转换器。
- 必须保持节点命名契约：
  `SUBSCRIPTION-REGION-PROTOCOL-[F|SP]-[V6]-NN`。
- `NN` 必须是与输入顺序无关的确定性数字标识；身份敏感节点允许通过本地 `[ID:...]` 标记固定身份。
- 如果修改节点命名契约，必须在同一次变更中同步修改 `collections/normalize-proxy-names.js` 和 `files/generate-stash-config.js`。
- 生成器必须在写入 `$content` 前拒绝以下情况：节点或策略组重名、空策略组、引用不存在、自引用、循环引用和无效规则目标。
- `AI Stable` 必须通过动态 `AI REGION` 子组收录所有明确固定节点并使用手动 `select`；默认子组顺序为 US、TW、JP、其他地区，地区只能决定排序，不能作为准入条件。不得把普通 VLESS、SS-SP 或自动故障转移伪装成固定出口。
- TCP 与 QUIC 自动池必须保持分离，不能用一次 HTTP 延迟测试自动比较不同传输协议。
- 基础配置最后一条规则必须保持为 `MATCH,Default Proxy`。
- `files/stash-base-config.yaml` 中的规则目标必须与生成器创建的策略组名称保持一致。
- `files/stash-base-config.yaml` 中每条 `RULE-SET` 必须引用存在的 `rule-providers`；每个 provider 缓存路径必须唯一。
- 流量聚合默认使用严格模式，并且必须原样返回节点列表。
- 响应转换器只能使用 File 当前响应或“查询流量信息订阅链接”带来的流量头，不得重新加入按组合订阅名称读取本地记录的耦合。
- 响应转换器可以修改响应头，但不能替换已经生成的正文或响应状态。
- 生成器中的 Stash 版本假设属于兼容性敏感内容；修改运行时语义前，应先核对当前 Sub-Store 与 Stash 官方文档。

## 仓库规范

- 目录使用复数英文名称，文件名使用小写 kebab-case。
- 规则文件使用 `rules/*.yaml` 的 domain provider 结构；大量规则优先使用 `domain` 或 `ipcidr`，不要无理由改成 `classical`。
- 运行时代码注释保持简洁；安装、装配和架构说明统一维护在 `README.md`。
- 路径、脚本顺序、参数、硬编码名称、输出命名规则或装配步骤发生变化时，必须同步更新 `README.md`。
- 行为修改应保持最小范围。不要把重命名或文档任务与无关的节点选择、路由策略修改混在一起。

## 校验要求

修改后运行所有相关静态检查：

```bash
node --check subscriptions/prepare-proxies.js
node --check collections/aggregate-subscription-usage.js
node --check collections/normalize-proxy-names.js
node --check files/generate-stash-config.js
node --check files/set-stash-response-headers.js
node tests/runtime-scripts.test.js
ruby -e 'require "yaml"; Dir["files/*.yaml", "rules/*.yaml"].each { |path| YAML.safe_load(File.read(path), aliases: true, filename: path) }'
```

如果修改了实际行为，还必须在 Sub-Store 中预览组合订阅和文件，并将生成的 URL 导入 Stash。确认节点与策略组非空、引用有效、响应头正确且 Stash 能成功加载后，才能声称运行时验证通过。
