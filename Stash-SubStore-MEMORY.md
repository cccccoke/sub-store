# Stash + Sub-Store 项目维护记忆

更新时间：2026-07-17（Asia/Shanghai）
事实来源：当前仓库代码、`README.md` 与 `AGENTS.md`

> 本文件记录当前可继续维护的架构与不变量。README 是安装和装配说明的权威来源；代码、README 与本文件不一致时，应先核对代码，并在同一次变更中更新文档。

> 本仓库禁止保存真实订阅地址、Token、UUID、密码、私有节点、生成后的配置或带凭据的日志。

## 1. 当前目标

1. 使用 Sub-Store 官方 File 操作注入节点，不在自定义脚本里硬编码组合订阅名称。
2. 节点和规则独立更新：组合订阅更新节点，Stash `rule-providers` 更新规则。
3. 在中国大陆网络中保持 TCP 与 QUIC 协议池分离，不用单次 HTTP 延迟跨协议决定真实网速。
4. 普通外网优先速度，开发登录/SSH/长连接优先稳定，包与镜像下载优先吞吐。
5. AI 使用明确固定出口；自动故障转移不得伪装成固定 IP。
6. 支持按地区临时选择出口，并允许在地区内自动或手动选择节点。

## 2. 当前流水线

```text
原始单订阅
  → subscriptions/prepare-proxies.js
  → 组合订阅
  → collections/aggregate-subscription-usage.js
  → collections/normalize-proxy-names.js
  → Sub-Store File 远程加载 files/stash-base-config.yaml
  → 官方“从订阅添加节点”（替换模式）
  → files/generate-stash-config.js
  → files/set-stash-response-headers.js
  → Stash 配置 URL

rules/*.yaml
  → Stash rule-providers 后台独立更新
```

组合订阅名称不是运行时常量。改名后只需重新选择官方“从订阅添加节点”的来源，并更新 File 的“查询流量信息订阅链接”。

## 3. 目录职责

| 文件 | 当前职责 |
| --- | --- |
| `subscriptions/prepare-proxies.js` | 幂等添加订阅来源前缀；不再覆盖 `ecn` 或 `test-url` |
| `collections/aggregate-subscription-usage.js` | 严格聚合流量，原样返回节点 |
| `collections/normalize-proxy-names.js` | 删除提示节点，识别地区/协议/线路并生成确定性名称 |
| `files/stash-base-config.yaml` | DNS、六个规则 provider、引导规则与最终 MATCH |
| `files/generate-stash-config.js` | 读取已注入的 `$content.proxies`，生成并验证所有策略组 |
| `files/set-stash-response-headers.js` | 设置 YAML 下载头并验证当前 File 已取得的流量头 |
| `rules/ai.yaml` | 身份敏感 AI 服务 → `AI Stable` |
| `rules/developer.yaml` | 代码托管、云平台和开发交互 → `Developer` |
| `rules/developer-download.yaml` | 包、镜像、Release、LFS、模型下载 → `Developer Download` |
| `rules/research.yaml` | 学术与科研域名 → `Default Proxy` |
| `rules/proxy.yaml` | 普通境外服务 → `Default Proxy` |
| `rules/direct.yaml` | 国内服务与开发镜像 → `DIRECT` |
| `tests/runtime-scripts.test.js` | 本地模拟稳定命名、策略组和响应头保护 |
| `files/example.yaml` | 脱敏旧结构样例，不参与流水线 |

## 4. Sub-Store File 设置

内容：

```text
类型 = mihomo 配置
来源 = 远程
模式 = 作为 mihomo 配置
URL = https://cdn.jsdelivr.net/gh/cccccoke/sub-store@main/files/stash-base-config.yaml
```

仓库仍只使用 GitHub 远端；中国大陆网络中的 Sub-Store 通过 jsDelivr
读取 GitHub 公共文件。远程脚本 URL 不追加 `#noCache`，避免每次预览都
绕过 Sub-Store 的本地资源缓存并直接请求上游。

操作顺序：

1. 官方“从订阅添加节点”，选择规范化后的组合订阅，使用替换模式。
2. 脚本操作：`files/generate-stash-config.js`。
3. 修改响应：`files/set-stash-response-headers.js`。

“查询流量信息订阅链接”填写组合订阅生成链接。响应转换器只接受当前响应中的 `subscription-userinfo`，不按组合订阅名称读取本地记录。

旧流程中的 `produceArtifact()`、`COLLECTION_NAME = 'Sub-Store'` 和“转换原生 Stash 配置负责取节点”均已移除。

## 5. 节点命名契约

```text
SUBSCRIPTION-REGION-PROTOCOL-[F|SP]-[V6]-NN
```

- `F`：原节点名称明确声明固定/静态/独享/dedicated IP；只是声明，不是脚本验证结果。
- `SP`：IEPL、IPLC、MPLS、CN2、CMI、AS9929 等明确专线标记。
- `V6`：名称明确包含 IPv6/V6。
- `NN`：10 位确定性数字 ID，而不是按输入顺序递增的序号。

默认 ID 基于订阅、地区、协议、线路标记和节点端点。订阅只调整排序时，同一端点名称保持不变。

地区识别优先级为：节点名中的明确中文/英文地区或地区码 → 显式节点字段
→ Sub-Store `ProxyUtils.getISO()` → 国旗。该顺序用于纠正
`🇨🇳 TW台湾`、`🇲🇨 MC印度尼西亚` 一类文字与国旗冲突的名称。
“无法使用/更新订阅/重新复制订阅/距离下次重置”等通知节点必须删除。

身份敏感节点可使用本地名称标记：

```text
US Fixed [ID:AI-US-PRIMARY]
```

`[ID:...]` 先被哈希，不原样进入规范名。相同规范分组内 ID 冲突会报错。改用确定性 ID 后，Stash 的具体节点选择会发生一次性重置，需要重新确认。

修改命名契约时，必须同步修改：

- `collections/normalize-proxy-names.js`
- `files/generate-stash-config.js` 的 `parseNormalizedName()`
- `README.md`
- 本文件
- `tests/runtime-scripts.test.js`

## 6. 策略树

### 普通外网

```text
Default Proxy (select)
├─ TCP Fast              默认
├─ QUIC Fast             有 HY2/TUIC 时创建
├─ TCP Reliable
├─ Regional Exit
├─ Fixed Exit            有固定节点时创建
├─ IPv6                  有 V6 节点时创建
├─ Manual
└─ DIRECT
```

### 开发流量

```text
Developer (select)
├─ TCP Reliable          默认
├─ TCP Fast
├─ QUIC Fast
├─ Regional Exit
└─ Manual

Developer Download (select)
├─ TCP Fast              默认
├─ QUIC Fast
├─ TCP Reliable
├─ Regional Exit
└─ Manual
```

`Developer` 用于 Git/API/SSH/登录/远程 IDE/长连接；`Developer Download` 用于 Docker 层、GitHub 内容、包管理器、SDK 和模型下载。

### AI 固定出口

```text
AI Stable (select)
├─ AI US (select)         US 的全部固定节点
├─ AI TW (select)         TW 的全部固定节点
├─ AI JP (select)         JP 的全部固定节点
├─ AI 其他实际存在地区
└─ AI Emergency
```

硬约束：

- `AI Stable` 只允许通过动态 `AI REGION` 子组引用 `F` 节点，必须收录所有地区及 IPv4/IPv6 的固定节点。
- 子组默认排序为 US → TW → JP → 其他地区；同地区内 IPv4 优先于 IPv6。
- 外层必须是 `select`，不能使用 `fallback`、`url-test` 或负载均衡。
- `AI Emergency` 只有用户手动选择后才会改变出口。
- 只有完全没有固定节点时，生成器才允许报错；缺少 US 或 TW 不能阻止生成。

### 地区出口

`Regional Exit` 只包含实际存在的地区。每个地区是 `select`，成员顺序是该地区 `TCP Fast`、`QUIC Fast` 和具体非固定 IPv4 节点。固定和 IPv6 节点分别进入 `Fixed Exit`、`IPv6` 与 `Manual`。

### 自动池资格

- `TCP Fast` / `TCP Reliable`：IPv4 VLESS + REALITY TCP 或 IPv4 SS-SP。
- `QUIC Fast`：IPv4 HY2/Hysteria2/TUIC。
- 固定 IP、IPv6、NONE 和普通 SS 不进入默认自动池。
- 普通 SS 仍保留在地区与 `Manual`。
- TCP/QUIC 不跨协议自动比较。

当前常量：

```text
TEST_INTERVAL = 600
TCP_POOL_LIMIT = 12
QUIC_POOL_LIMIT = 12
REGION_POOL_LIMIT = 8
AI_REGION_PRIORITY = US, TW, JP, 其余 REGION_PRIORITY
AUTOMATIC_REGIONS = HK, SG, JP, TW, US, KR
```

## 7. 规则与匹配顺序

六个 provider 都使用 `behavior: domain`、`format: yaml`、独立缓存路径和 `interval: 3600`。

```text
内网内联规则
→ jsdelivr.net 引导规则
→ ai / AI Stable
→ developer-download / Developer Download
→ developer / Developer
→ research / Default Proxy
→ proxy / Default Proxy
→ direct / DIRECT
→ GEOIP,CN,DIRECT,no-resolve
→ MATCH,Default Proxy
```

最后一条必须始终是：

```text
MATCH,Default Proxy
```

规则文件格式：

```yaml
---
payload:
- "+.example.com"
- api.example.net
```

大量规则应继续使用 `domain`/`ipcidr` provider；没有必要时不要改为高开销 `classical`。

当前 provider URL 通过 jsDelivr 指向 GitHub 公开仓库 `cccccoke/sub-store` 的 `main/rules/`。仓库 fork、改名或换分支时，需要同步修改六个 URL 与 README 中的基础配置 URL。规则推送后可能受 CDN 缓存影响，不保证与 GitHub 提交同时生效。

## 8. DNS 基线

```yaml
dns:
  default-nameserver:
  - 223.5.5.5
  - 119.29.29.29
  nameserver:
  - 223.5.5.5
  - 119.29.29.29
  nameserver-policy:
    "+.internal": system
    "+.intranet": system
    "+.corp": system
    "+.private": system
  follow-rule: false
```

设计理由：国内 DNS 保留国内 CDN 选路；`follow-rule: false` 避免代理 DNS 递归；常见内网后缀交给系统 DNS。真实公司后缀和私有 DNS 只放个人 Override。

当前未默认启用 UDP/443 QUIC 拦截，因为需要先实机确认不会影响 HY2/TUIC 或特定应用。

## 9. 生成器保护

在写入 `$content` 前必须拒绝：

- 没有官方操作注入的节点。
- 空节点名、重名节点、名称格式错误或名称协议与实际类型冲突。
- 节点与策略组重名。
- 空组、重复成员、悬空引用、自引用和循环引用。
- 缺少 `rule-providers`、重复缓存路径或 provider 没有 URL/path。
- `RULE-SET` 引用不存在的 provider。
- 规则引用不存在的策略目标。
- 最后一条不是 `MATCH,Default Proxy`。
- 没有合格 TCP 自动池。
- 没有合格 AI 固定出口。

生成器还会删除节点级 `benchmark-url`、`benchmark-timeout`、`benchmark-disabled` 和旧 `test-url`，让 Stash 的统一测速设置成为权威来源。

## 10. 流量响应头

`aggregate-subscription-usage.js` 默认：

```text
allow_partial = false
include_expired = false
```

它严格检查 upload/download/total、过期时间和安全整数；失败时默认不发布部分合计，并始终原样返回节点。

`set-stash-response-headers.js`：

- 文件名：`Stash-SubStore.yaml`
- Content-Type：`text/yaml; charset=utf-8`
- 流量来源：File 当前响应或 `$options._res.headers`
- 不读取固定组合订阅名称
- 不修改正文或状态

Gist Raw 不能替代 Sub-Store File URL 传递动态响应头；若未来改用 Gist，只能把它当配置备份，并重新实测流量展示。

## 11. 本地验证

```bash
node --check subscriptions/prepare-proxies.js
node --check collections/aggregate-subscription-usage.js
node --check collections/normalize-proxy-names.js
node --check files/generate-stash-config.js
node --check files/set-stash-response-headers.js
node tests/runtime-scripts.test.js
ruby -e 'require "yaml"; Dir["files/*.yaml", "rules/*.yaml"].each { |path| YAML.safe_load(File.read(path), aliases: true, filename: path) }'
```

本地测试覆盖：

- 订阅顺序变化不改变节点规范名。
- `[ID:...]` 在端点替换后保持规范名。
- ID 冲突被拒绝。
- 新策略组类型、默认顺序和成员隔离。
- 固定节点不会进入 TCP/地区自动池。
- 缺少固定 AI 节点和无效 provider 引用会失败。
- 响应转换器保留正文与状态并规范化流量头。

## 12. 实机验证

代码行为修改后必须在 Sub-Store 与 Stash 中验证：

1. 组合订阅非空，节点名符合确定性契约。
2. File 操作顺序正确，预览含非空节点和策略组。
3. 六个远程 provider 均可下载且缓存路径无冲突。
4. `AI Stable` 第一项是已确认的固定出口。
5. File URL 含 YAML Content-Type、文件名和有效流量头。
6. Stash 成功导入，无空组或悬空引用。
7. 家宽、蜂窝、公司网络分别测试 TCP/QUIC 实际下载和长连接。
8. 测试 GitHub HTTPS/SSH、Docker、包管理器和 AI 登录。

未完成实机步骤时，只能声称“本地静态与模拟测试通过”。

## 13. 历史环境快照

以下来自 2026-07-16 的旧实机记录，可能已经过时：

```text
Stash macOS 4.2.0
Sub-Store 后端 2.36.6
节点总数 128
DINGDANG: 17 VLESS REALITY + 5 HY2
GLODOS:   56 SS（含 Fixed / V6 / NONE / 普通地区节点）
KTM:      9 HY2 + 14 SS-SP
MITCE:    17 HY2 + 10 TUIC v5
```

不能用本节代替当前预览和版本核对。

## 14. 当前 SHA-256

```text
5b06db685f3c6a2a3454761c19837e3befdad855a1d440642bbdea2cb1d05af2  subscriptions/prepare-proxies.js
6d53940f3bbc560d32a48e70c673ffd4964d57585d33b5f739d77b6ebfd1a962  collections/aggregate-subscription-usage.js
9cf74eb92eb36201f626b67f70c113eae35f0ea2b9843ddb9260d2184d99e08d  collections/normalize-proxy-names.js
e40c10d388f36a6087975de94c7aa6ff0115862bc44249dfaae9c96d6fdc88dc  files/generate-stash-config.js
f03c6d504f046a4e08e545a0a66f00f759fbbbb3400ac18dfec3f1ac6d258e9c  files/set-stash-response-headers.js
6000acc59b77dfa2db7cf5abfc13890a0b2cca42cb5dadd926e1867c76869865  files/stash-base-config.yaml
15fd6ed2fdcdc7137dfbcc104c07a736c8e85aec219921a5841e476722c54c80  rules/ai.yaml
fc1ded0d48571e2566721160f3ee7b70d64c8f5b8101d53872de1b050ffb7c2c  rules/developer-download.yaml
bbb60b4c0b64a15972f44da4974c4702893cd80cf70ba23ad79886037d460fd7  rules/developer.yaml
6c74c1d10f0ef580e5c48d06099273723a7f49da85f42b4073484d1c56182ae1  rules/direct.yaml
45bae094c8ec15f458cc2c76b1e896fd67ff226537ca5fd61aca7e08ac23f2e9  rules/proxy.yaml
439e5f142a1cb6457adef6464d651d7e068ab9dbdaeca85f128b8a659b4a7ee1  rules/research.yaml
a5ad408956991055c42653da03d9e512a3db369b741cffa7a68d424a7d2992cb  tests/runtime-scripts.test.js
```

修改以上文件后，应重新生成本节哈希并更新日期。
