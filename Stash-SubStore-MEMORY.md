# Stash + Sub-Store 项目维护记忆

更新时间：2026-07-17（Asia/Shanghai）
事实来源：当前仓库代码、`README.md` 与 `AGENTS.md`
用途：以后继续修改本项目时，先阅读本文件，再核对实际 Sub-Store、Stash、订阅和软件版本。

> 本文件已按当前仓库重新生成。除“历史运行环境与节点快照”一节外，所有文件名、路径、脚本顺序、常量和行为均以当前代码为准。README 是安装与装配说明的权威来源；若代码、README 与本文件不一致，应先核对代码，再在同一次变更中同步更新 README 和本文件。

> 安全说明：本仓库和本文件都不得保存真实订阅地址、Token、UUID、密码、私有节点、生成后的私有配置或带凭据的日志。

## 1. 当前目标

这套配置的第一目标不是“全局最低延迟”，而是：

1. 在中国大陆网络环境中优先使用 VLESS + REALITY TCP。
2. 减少因 `url-test` 频繁切换节点造成的断流和出口漂移。
3. 保留不同供应商、协议和线路作为故障降级路径。
4. 当前网络不支持 IPv6 时，任何 V6 节点都不能进入默认自动链。
5. 普通 SS 不进入默认自动链；SS-SP/专线只作为 TCP 容灾。
6. HY2/TUIC 保持独立，在 UDP 友好网络中使用，并作为末级应急。
7. 默认保持规则模式；临时全局代理时通过受控策略组进入，避免误选裸节点或 IPv6。

## 2. 当前目录与文件职责

```text
.
├── subscriptions/
│   └── prepare-proxies.js
├── collections/
│   ├── aggregate-subscription-usage.js
│   └── normalize-proxy-names.js
├── files/
│   ├── example.yaml
│   ├── generate-stash-config.js
│   ├── set-stash-response-headers.js
│   └── stash-base-config.yaml
├── AGENTS.md
├── README.md
└── Stash-SubStore-MEMORY.md
```

| 当前文件 | 在 Sub-Store 中的位置 | 职责 |
| --- | --- | --- |
| `subscriptions/prepare-proxies.js` | 单个订阅的脚本操作 | 添加订阅来源前缀，设置 ECN 和节点测速 URL |
| `collections/aggregate-subscription-usage.js` | 组合订阅的第一个脚本操作 | 严格聚合套餐流量，原样返回节点 |
| `collections/normalize-proxy-names.js` | 组合订阅的第二个脚本操作 | 删除提示节点，生成规范节点名 |
| `files/example.yaml` | 不挂载 | 使用无效占位节点的脱敏 YAML 结构参考，不参与流水线，也不作为当前生成器输出的金标准 |
| `files/stash-base-config.yaml` | File 的基础内容 | 提供 Stash 模式、DNS 基线和 712 条分流规则 |
| `files/generate-stash-config.js` | File 的文件脚本 | 注入节点，生成策略组并执行完整校验 |
| `files/set-stash-response-headers.js` | 修改响应 / Response Transformer | 设置 YAML 下载头并转发聚合流量信息 |

`files/example.yaml` 中的节点、凭据和服务器均为不可用占位符，策略组只用于展示 YAML 结构；它不是当前生成器的预期输出，不能代替 `files/stash-base-config.yaml`。

## 3. 旧名称与当前名称对照

旧记忆中的名称来自重构前的个人开发目录。当前只使用右侧路径：

| 旧名称 | 当前规范路径 |
| --- | --- |
| `stash-rules-mainland-stable.yaml` | `files/stash-base-config.yaml` |
| `sub-store-stash-mainland-stable.js` | `files/generate-stash-config.js` |
| `sub-store-traffic-aggregate-strict.js` | `collections/aggregate-subscription-usage.js` |
| `sub-store-response-subscription-info.js` | `files/set-stash-response-headers.js` |
| 旧记忆中未命名的节点重命名脚本 | `collections/normalize-proxy-names.js` |
| 旧记忆未覆盖的单订阅预处理阶段 | `subscriptions/prepare-proxies.js` |

旧记忆提到的以下回退文件当前不在仓库中，不能再当作可用备份：

- `sub-store-stash-adaptive.js`
- `stash-rules-adaptive.yaml`
- `sub-store-stash-stable.js`
- `stash-rules-stable.yaml`

旧记忆中的 `outputs/` 和 `work/` 路径也不属于当前仓库；不要再使用那些路径下的校验命令。

## 4. 当前流水线与挂载顺序

```text
原始单订阅
  → subscriptions/prepare-proxies.js
  → 组合订阅 Sub-Store
  → collections/aggregate-subscription-usage.js
  → collections/normalize-proxy-names.js
  → files/stash-base-config.yaml
  → files/generate-stash-config.js
  → files/set-stash-response-headers.js
  → Stash YAML 响应
```

必须保持：

1. `prepare-proxies.js` 挂在每个单独订阅上。
2. 组合订阅中必须先聚合流量，再规范化节点名。
3. `stash-base-config.yaml` 是 File 基础内容，不是可直接导入 Stash 的最终配置。
4. `generate-stash-config.js` 是 File Script；它有意使用顶层 `await`。
5. `set-stash-response-headers.js` 是独立的 Response Transformer，不能当作普通 File Script。
6. 更新任一运行时脚本后，应重新预览 File，并在 Stash 中更新订阅。

这些 JavaScript 运行在 Sub-Store 内部，不是普通 Node.js 模块。不要添加 `import`、`export`、CommonJS 包装或仅 Node.js 可用的 API；需要保留操作脚本的全局入口 `async function operator(proxies, targetPlatform, context)`。

## 5. 节点命名契约

`collections/normalize-proxy-names.js` 的输出格式是：

```text
SUBSCRIPTION-REGION-PROTOCOL-[F|SP]-[V6]-NN
```

其中：

- `SUBSCRIPTION`：优先取 `_subDisplayName` 或 `_subName`，缺失时再从已有名称前缀恢复。
- `REGION`：两位地区代码；无法识别时为 `NONE`。
- `PROTOCOL`：大写协议名；无法识别时为 `UNK`。
- `F`：固定、静态、独享或 dedicated IP。
- `SP`：IEPL、IPLC、MPLS、DIA、BGP、CN2、CMI、AS9929 等专线标识。
- `V6`：原始节点名明确包含 IPv6/V6 标识。
- `NN`：同类节点内从 `01` 开始编号。

示例：

```text
KTM-HK-VLESS-F-01
KTM-HK-SS-SP-01
KTM-HK-HY2-01
KTM-TW-SS-V6-01
```

规范化脚本输出短标记 `F`、`SP`、`V6`；生成器为了兼容旧输入，也接受 `FIXED`、`SPECIALIZED`、`IPV6`。

重要细节：

- 固定 IP、专线和 IPv6 标记只从原始节点名判断。
- 固定 IP 优先于专线；同时命中时只输出 `F`。
- 流量、到期和过滤提示节点默认会被删除。
- 订阅元数据是来源名的首选；单订阅预处理提供可恢复的名称前缀。
- 修改命名契约时，必须同时修改 `collections/normalize-proxy-names.js` 和 `files/generate-stash-config.js` 的 `parseNormalizedName()`，并同步更新 README 与本文件。

## 6. 各阶段当前行为

### 6.1 单订阅预处理

`subscriptions/prepare-proxies.js` 对每个节点：

1. 读取 `_subDisplayName`、`_subName`，都缺失时使用 `Unknown`。
2. 幂等地添加 `订阅名-` 前缀，已有相同前缀时不重复添加。
3. 设置 `ecn: true`。
4. 设置 `test-url: http://1.0.0.1/generate_204`。

### 6.2 流量聚合

`collections/aggregate-subscription-usage.js` 只允许挂在组合订阅上，并始终原样返回节点数组。

默认参数：

```text
allow_partial = false
include_expired = false
```

当前语义：

- 组合订阅可以按订阅名和订阅标签选取来源。
- 主订阅流量请求失败后仍会尝试自定义流量链接或自定义流量值。
- 在调用 `normalizeFlowHeader` 前严格检查 `upload`、`download`、`total` 和可选 `expire`。
- 缺字段、非法数字、负数、不安全整数和加法溢出都会使该来源失败。
- `total=0 && used>0` 被视为语义不明并失败。
- 默认排除已过期套餐；设置 `include_expired=true` 后才纳入。
- 有正常套餐时，已用尽套餐贡献的剩余量按 0 处理并从合计中排除。
- 全部有效套餐都已用尽时，会以封顶计数发布明确的剩余 0，而不是继续保留旧值。
- 任一来源失败且 `allow_partial=false` 时，不发布不完整合计。
- 新版运行时优先写入当前请求的 `$options._res.headers['subscription-userinfo']`；没有实时响应上下文时才回写本地 `collections[].subUserinfo` 作为兼容路径。

### 6.3 节点名称规范化

`collections/normalize-proxy-names.js`：

- 删除流量、到期、配额和过滤提示节点。
- 优先使用 Sub-Store 元数据识别订阅来源。
- 依次从明确地区字段、`ProxyUtils.getISO()`、旗帜和名称开头识别地区。
- 优先使用 `proxy.type` 识别协议，缺失时才从名称推断。
- 输出纯 ASCII、大写、无空格的名称段。
- 按订阅、地区、协议、线路标记和 IPv6 状态分别编号。

### 6.4 Stash 文件生成

`files/generate-stash-config.js`：

1. 解析 `$content` 中的基础 YAML，并把旧规则目标 `Auto` 迁移为 `Default Proxy`。
2. 通过 `produceArtifact()` 生成名为 `Sub-Store`、平台为 `Stash` 的组合订阅。
3. 拒绝空节点、空名称和重名节点。
4. 删除节点级 `benchmark-url`、`benchmark-timeout`、`benchmark-disabled`。
5. 稳定排序节点，解析规范名称，并校验已知协议名称与实际 `type` 一致。
6. 生成自动池、稳定池、AI 池和手动导航组。
7. 校验组名、成员、空组、自引用、悬空引用、循环引用和规则目标。
8. 只有全部校验通过后才替换 `$content`。

生成器有两个硬前提：

- `Stable` 至少需要一个 IPv4 VLESS/REALITY TCP 节点或一个 IPv4 SS-SP 节点。
- `AI Stable` 至少需要一个位于 US、JP 或 SG 的固定 IP、VLESS/REALITY 或 SS-SP 节点。

### 6.5 响应头处理

`files/set-stash-response-headers.js`：

- `Content-Type` 固定为 `text/yaml; charset=utf-8`。
- 下载文件名固定为 `Stash-Sub-Store.yaml`。
- 优先读取当前 File 请求中的实时 `subscription-userinfo`。
- 实时值缺失时，从本地组合订阅 `Sub-Store` 的 `subUserinfo` 读取兼容性后备值。
- 规范化流量头，并确认上传、下载、总量都是有限数字后才写入响应。
- 不替换已生成的正文，也不修改响应状态。

看板流量必须通过挂载该 Response Transformer 的 Sub-Store File/Share 直链验证。旧记忆中的实机经验是 Gist Raw URL 不会转发 Sub-Store 的自定义响应头，只适合作为配置备份；若继续依赖这一结论，应重新实测。

## 7. 当前策略树

### 默认稳定档

```text
Default Proxy (select，第一项 Stable)
└─ Stable (fallback)
   ├─ Stable VLESS (fallback，最多 8 个 REALITY IPv4)
   ├─ SS-SP Backup (fallback，最多 6 个专线 SS IPv4)
   └─ QUIC Emergency (fallback，最多 4 个 HY2/TUIC IPv4)
```

不存在合格节点时，对应子组不会创建。`Stable` 及子层采用固定顺序 fallback；更靠前的节点健康时，不会因为另一个节点延迟更低而切换。

### 家宽性能档

```text
Home Performance (fallback)
├─ Auto VLESS (url-test，与 Stable VLESS 使用同一批节点)
├─ Auto QUIC (url-test，最多 12 个 HY2/TUIC IPv4)
└─ SS-SP Backup (fallback)
```

协议优先级仍是 VLESS → QUIC → SS-SP，不是跨协议全局最低延迟。

### 全局模式入口

```text
Stash 内置 GLOBAL
└─ Global Stable (select)
   ├─ Stable
   ├─ Home Performance
   ├─ Auto VLESS（存在时）
   ├─ Auto QUIC（存在时）
   ├─ AI Stable
   └─ DIRECT
```

- 配置保持 `mode: rule`。
- 临时切换全局模式时，在 Stash 内置 `GLOBAL` 中选择 `Global Stable`。
- `Global Stable` 不直接包含裸节点、IPv6、NONE、固定 IP 或普通 SS。
- Stash 内置 `GLOBAL` 仍会显示全部原始节点和用户策略组；脚本无法裁剪该列表。
- `GLOBAL` 和 `PROXY` 是 Stash 运行时保留组，不要创建同名策略组。

### AI 与手动导航

- `Research + AI` 第一项为 `AI Stable`。
- `AI Stable` 的候选顺序优先固定 IP，再按线路层级和 US → JP → SG 排序。
- `Default Proxy` 还包含 `Specialized`、`Regions`、`Protocols`、`Fixed IP`、`IPv6`、`Subscriptions` 等存在时创建的导航入口，最后包含 `DIRECT`。
- `Developer` 使用自动入口和导航入口，但不自动附加 `DIRECT`。
- 固定 IP、IPv6、NONE 和普通 SS 只保留在相应手动入口，不进入 `Stable` 或 `Home Performance`。

## 8. 当前关键常量

位于 `files/generate-stash-config.js`：

```text
COLLECTION_NAME = Sub-Store
TEST_INTERVAL = 600
ADAPTIVE_TEST_INTERVAL = 600
VLESS_POOL_LIMIT = 8
SS_SP_POOL_LIMIT = 6
QUIC_POOL_LIMIT = 12
QUIC_EMERGENCY_LIMIT = 4
AUTOMATIC_REGIONS = HK, SG, JP, TW, US, KR
AI_REGION_PRIORITY = US, JP, SG
```

`COLLECTION_NAME = 'Sub-Store'` 也存在于 `files/set-stash-response-headers.js`，两处必须保持一致。除非有至少 24–48 小时的实际日志证据，否则不要把 600 秒测速间隔降低到 300 秒。

## 9. IPv4、IPv6、DNS 与测速约束

基础配置当前只固定：

```yaml
dns:
  follow-rule: false
```

设计原则：

- 不在 YAML 中写 `nameserver`，由 Stash 的 DNS 设置负责。
- `follow-rule: false` 用于避免代理 DNS 递归。
- V6 节点只进入独立 IPv6/地区 IPv6 组，不进入自动池。
- 固定 IP、NONE 和普通 SS 也不进入默认自动池。
- 生成器删除每个节点上的三个 benchmark 覆盖字段，让 Stash 全局测速设置成为唯一来源。
- 不得删除连接必需字段，例如 `server`、`port`、`uuid`、`password`、TLS、REALITY、obfs、ALPN、上下行带宽或 UDP。
- HTTP 测速只能判断短时可达与延迟，不能代表持续吞吐、丢包或运营商软限速。

## 10. 基础规则与生成校验

`files/stash-base-config.yaml` 当前可静态确认：

```text
mode = rule
log-level = warning
dns.follow-rule = false
proxies = []
proxy-groups = []
rules = 712 条
最后一条 = MATCH,Default Proxy
```

空 `proxies` 和空 `proxy-groups` 是基础模板的正常状态，最终内容由生成器注入。

生成器必须在写入 `$content` 前拒绝：

- 空节点列表、空节点名、重名节点。
- 不符合命名契约的节点。
- 已知协议名称与实际 `type` 不一致。
- 重名策略组、空策略组和重复成员。
- 不存在的成员、自引用和循环引用。
- 非字符串规则、不可解析规则和无效规则目标。
- 最后一条不是 `MATCH,Default Proxy` 的规则集。

基础规则引用的策略组名称必须与生成器创建的名称保持一致。修改规则目标、策略组名或最后一条规则时，必须同步修改生成器和 README。

## 11. 历史运行环境与节点快照

以下内容来自旧记忆在 2026-07-16 的最后一次实机记录，不是当前仓库能自行验证的事实：

```text
Stash macOS 4.2.0
Sub-Store 后端 2.36.6
节点总数 128
DINGDANG: 17 VLESS REALITY + 5 HY2
GLODOS:   56 SS（含 Fixed / V6 / NONE / 普通地区节点）
KTM:      9 HY2 + 14 SS-SP
MITCE:    17 HY2 + 10 TUIC v5
```

结构性风险曾是所有 VLESS REALITY 都来自 DINGDANG。以后增加订阅时，优先寻找第二家提供 VLESS + REALITY + TCP/Vision 的独立供应商，而不是只增加同一家节点数量。

任何涉及版本兼容性、实际节点数量、供应商构成或运行效果的结论，都必须重新在 Sub-Store 与 Stash 中验证，不能只依赖本节历史快照。

## 12. 修改后的验证清单

### 静态检查

```bash
node --check subscriptions/prepare-proxies.js
node --check collections/aggregate-subscription-usage.js
node --check collections/normalize-proxy-names.js
node --input-type=module --check < files/generate-stash-config.js
node --check files/set-stash-response-headers.js
ruby -e 'require "yaml"; path = "files/stash-base-config.yaml"; YAML.safe_load(File.read(path), aliases: true, filename: path)'
```

普通 Node.js 中出现 `$substore`、`$arguments`、`$options`、`$content`、`$res`、`flowUtils`、`ProxyUtils` 或 `produceArtifact` 未定义属于正常现象；本地只做静态检查。

### Sub-Store 与 Stash 实机检查

修改实际行为后必须：

1. 预览组合订阅，确认节点非空、提示节点已移除、名称全部符合契约且没有重名。
2. 预览 File，确认 `proxies` 和 `proxy-groups` 非空，所有引用有效。
3. 确认 `Global Stable`、`Default Proxy`、`Stable`、`Home Performance` 和 `AI Stable` 的顺序符合本文件。
4. 在生成 YAML 中搜索三个 benchmark 覆盖字段，结果应为 0。
5. 通过 File 直链检查 YAML Content-Type、`Stash-Sub-Store.yaml` 下载名和有效 `subscription-userinfo`。
6. 把生成 URL 导入 Stash，确认配置可加载、策略组无空组、分流规则可用。

未完成这些实机步骤时，只能声称“静态检查通过”，不能声称“Sub-Store/Stash 运行时验证通过”。

## 13. 当前文件 SHA-256

以下校验值对应 2026-07-17 重新生成本记忆时的当前文件：

```text
54fc37a09693d02741225242f7ef6eb3a536cb197eabae6414e01439df0fadc9  subscriptions/prepare-proxies.js
6d53940f3bbc560d32a48e70c673ffd4964d57585d33b5f739d77b6ebfd1a962  collections/aggregate-subscription-usage.js
a75623147c22bf0bdb02bfd93d21e2d8df53f992518b977a8c89f9d9d0677ccf  collections/normalize-proxy-names.js
75c2f89e2b5eafa3fe38a7caeee25ff592afffea22460fb5aea81ed5084e7ec4  files/generate-stash-config.js
4c91f1f81ffbe1bb55fd827079cf96d6a56245f01948fa5d311f242ec2d30bfc  files/set-stash-response-headers.js
89153b225c7fafbb56429083bcc1d47d293da78aad6358738735050545f00eb4  files/stash-base-config.yaml
```

修改任一运行时文件后，应更新本节哈希和本文日期。

## 14. 以后如何继续

下一次修改时应提供或确认：

1. 当前仓库中的 `Stash-SubStore-MEMORY.md`。
2. 需要修改的最新 JS/YAML，而不是旧开发目录中的副本。
3. Stash 和 Sub-Store 的当前版本。
4. 问题发生时间、网络类型、当时选中的完整策略链和错误日志。

建议开场说明：

```text
请先完整阅读 README.md、AGENTS.md 和 Stash-SubStore-MEMORY.md，
以当前仓库文件为准保持其中的不变量，再检查并修改这次的问题。
```
