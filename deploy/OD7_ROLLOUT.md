# OD.7：预发布联调与逐阶段放量

OD.7 提供一个**阻断式证据门禁**，不自动部署、不自动打开销售，也不把本机模拟视为公网验收。当前缺正式域名、证书、商户、独立 staging/production 主机和三平台实机记录，因此尚无可通过的真实生产放行报告。

## 环境隔离

先复制 `deploy/examples/staging.template.yaml` 和 `production.template.yaml` 到仓库外的私有目录，填真实 HTTPS 域名。staging 使用独立 PostgreSQL 与 LiteLLM 数据库、凭据、账本和测试账户命名空间，不导入生产用户账本。清单中的 `cloud.mode: alpha` 用于隔离测试账户的模型流式联调，启用前须独立验证路由并配置 `MATERIALSX_CLOUD_ROUTE_VERIFIED=1`；`payment.mode` 固定 `disabled`，回调用签名验证夹具和获批准的测试商户方案验证，不使用真实用户订单。生产使用 `cloud.mode: mx-production` 时必须同时使用获批的 `wechat-native` 支付清单；`alpha` 在生产被拒绝。生产部署初始应保持 `MATERIALSX_SIGNUP_ENABLED=0`，`operations_controls.cloud_paused=true`、`sales_paused=true`，先只验证只读与登录。生产支付配置即使已安装，也必须经过 OD.5 批准和独立销售开关才可建单。

## 放行链

标准顺序为 `staging → read-only → research → canary-model → wallet → orders`。若用户明确选择不建 staging、直接在已有服务器部署正式环境，则使用 `direct-read-only → research → canary-model → wallet → orders`；第一阶段同时要求原 staging 的全部公共探针、路由、模型、MOOS、回调和故障注入回执，以及正式只读登录回执，不能凭空生成 staging 报告。每阶段的前一份报告必须未过期，生产清单 SHA-256、数据库/凭据/账本/账户命名空间标识保持一致。标准路径中 staging 与生产四种标识必须逐项不同；这是配置层检查，还须人工核对实际服务器、数据库角色与数据。任一回执缺失、哈希变化、权限不为 0600、审核时间晚于当前时间、审批过期、操作开关与阶段不符时停止。

各阶段生成仓库外 0600 JSON 证据文件，字段示例：

```json
{
  "schemaVersion": 1,
  "stage": "staging",
  "operator": "release-operator",
  "approvedAt": "2026-10-09T04:00:00.000Z",
  "expiresAt": "2026-10-10T04:00:00.000Z",
  "bindings": {"databaseId":"staging-db-id","credentialSetId":"staging-keys-id","ledgerId":"staging-ledger-id","accountNamespace":"staging-accounts"},
  "productionBindings": {"databaseId":"production-db-id","credentialSetId":"production-keys-id","ledgerId":"production-ledger-id","accountNamespace":"production-accounts"},
  "operations": {"observedAt":"2026-10-09T04:00:00.000Z","version":1,"cloudPaused":true,"salesPaused":true},
  "receipts": [{"kind":"dns-tls","path":"/private/evidence/dns-tls.txt","sha256":"<64 lowercase hex>","reviewer":"security-reviewer","reviewedAt":"2026-10-09T04:00:00.000Z"}]
}
```

`receipts` 必须覆盖 `requiredReceipts(stage)` 所列种类；实际集合可用 `node -e "import('./deploy/od7-gate.mjs').then(x=>console.log(x.requiredReceipts('orders')))"` 查询。每项 `path` 指向真实、普通、最大 1 MiB 的私有文件。`operations-control-snapshot` 文件内容必须是证据中的 `operations` JSON；从受保护运营接口读取真实 `version` 和两个暂停值后写入，五分钟内完成门禁。不要用手写的虚假状态替代运营回执。报告只记录文件哈希、审核人和阶段；凭据、用户资料和商户文件均不进入仓库。文件哈希仅证明内容未变，不能代替审核人对实验结果、账本和业务条件的判断。

`dns-tls` 回执必须是只读公网探针生成的 JSON，且对应当前清单、七项检查全部通过、24 小时内完成。它通过真实 HTTPS 请求检查 API/官网的 DNS/TLS、首页、客户端目录、API 管理路径与私有指标阻断、研究路由鉴权，以及管理域名匿名访问阻断；管理域名在 VPN 外无法建立连接也算外部隔离通过，仍须从 VPN 内另行核对其证书和登录。还需人工核对证书链、外部端口扫描、Nginx 配置和管理准入。先执行：

```sh
npm run od7:public-probe -- --manifest /private/staging.yaml --out /private/od7/staging-public-probe.json
```

将生成文件的 SHA-256 填入 `dns-tls` 回执，`path` 指向该文件。探针只读且不带用户认证，不会创建订单或调用模型。

```sh
npm run od7:gate -- --stage staging --manifest /private/staging.yaml --production-manifest /private/production.yaml --evidence /private/od7/staging.json --out /private/od7/staging-report.json
npm run od7:gate -- --stage read-only --manifest /private/production.yaml --evidence /private/od7/read-only.json --previous /private/od7/staging-report.json --out /private/od7/read-only-report.json
# 依次执行 research、canary-model、wallet、orders，--previous 指向上一阶段报告。
```

正式直发路径首阶段使用 `npm run od7:gate -- --stage direct-read-only --manifest /private/production.yaml --evidence /private/od7/direct-read-only.json --out /private/od7/direct-read-only-report.json`，之后 `research` 的 `--previous` 指向该报告。清单改动（包括从禁用支付改为正式微信支付）会使旧报告失效；需用新的生产清单从 `direct-read-only` 重新核验，不能跳过阶段。

门禁报告是人工执行放量的前置条件，**不会自行更改业务开关**。`read-only` 和 `research` 要求云调用与新销售均暂停；`canary-model` 与 `wallet` 要求仅新销售暂停；`orders` 要求两项均已解除且生产清单使用获批的 `wechat-native`。每次解除暂停前复核上一个阶段回执、OD.5 批准、Worker 心跳及供应商结算；更改后重新抓取运营控制快照再生成报告。任何异常立即把两个暂停开关置为 true，保留通知、退款与待核对请求处理，不重放供应商请求，也不回滚账本迁移。

## 现场测试与正式门槛

staging 回执需要覆盖 DNS/TLS、同源路由、外网无法直达管理/私有端口、登录与模型流式、MOOS ACL、回调验签/重复通知和故障注入。生产只读阶段核对登录、状态页、目录与管理隔离；随后研究数据、灰度模型、钱包逐项验收。最终 `orders` 回执还必须覆盖正式域名证书、受限 DB 角色、微信回调和符合规则的退款、供应商账单、macOS/Windows/Linux 安装、异机恢复、密钥轮换、告警、回滚和客户端模型/价格一致性。测试订单只在正式商户与人工批准后执行。日期或门禁脚本通过都不会自动授予发布批准。

`/v1/client-config` 的 `features` 现在反映运营暂停状态，`availability` 给出 `available`、`paused` 或 `not_configured`；桌面平台连接提示会解释暂停，而不把它当作普通调用失败。这是部署可用性，不代替账户授权、模型价格和实时路由检查。

验证：`npm run od7:test`、`npm run config:test`、`npm run source:size`。真实公网、支付与三平台安装仍必须在对应环境留存上述回执。
