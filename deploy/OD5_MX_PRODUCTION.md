# OD.5：MX 钱包生产发布与回滚

OD.5 的生产开关已与现有微信官方 SDK、MX 钱包、LiteLLM 路由和价格目录接通。它是**默认关闭**的发布合同；此文档不表示已经完成真实收款。正式公网域名、商户回调、价格/采购证据和批准文件到位后，才可执行小额实付验收。

## 同一发布版本

将 `deploy/examples/production.template.yaml` 复制到 Git 忽略的私有目录，填真实 HTTPS origin。获批后把 `cloud.mode` 设为 `mx-production`，`payment.mode` 设为 `wechat-native`，`payment.notifyOrigin` 设为与 `public.apiOrigin` 完全相同的值，`payment.releaseId` 设为 `mx-v0.3-rootflow-svip-20261007-3model-approved-v1`。`config:check` 拒绝云路由与支付状态不一致；预览保持 `deploymentReady: false`，不会代替上线批准。

Go 身份服务和 Billing Worker 使用同一环境：

```text
MATERIALSX_ENV=production
MATERIALSX_CLOUD_MODE=mx-production
MATERIALSX_PAYMENT_MODE=wechat-native
MATERIALSX_MX03_PAYMENT_MODE=wechat-production
MATERIALSX_MX03_GATEWAY_MODE=wallet-production
MATERIALSX_MX03_PRICE_VERSION=mx-v0.3-rootflow-svip-20261007-3model-approved-v1
MATERIALSX_MX_PRODUCTION_APPROVAL_FILE=/absolute/private/path/mx-production-release.json
MATERIALSX_IDENTITY_PUBLIC_URL=https://api.your-domain.tld
MATERIALSX_LITELLM_URL=http://127.0.0.1:4001
```

`MATERIALSX_LITELLM_GATEWAY_KEY`、商户配置、数据库 DSN、身份主密钥只从私有部署环境注入；`MATERIALSX_MX03_DIAGNOSTIC_MODELS` 在生产留空。微信商户参数使用 `WECHAT_PAY_MCH_ID`、`WECHAT_PAY_APP_ID`、`WECHAT_PAY_CERT_SERIAL`、`WECHAT_PAY_PUBLIC_KEY_ID`、`WECHAT_PAY_API_V3_KEY`、`WECHAT_PAY_PRIVATE_KEY_PATH`、`WECHAT_PAY_PUBLIC_KEY_PATH`，或由权限为 0600 的 `MATERIALSX_WECHAT_CONFIG_PATH` 加载。正式 callback 由 API origin 固定拼成 `/v1/payments/wechat/notify`，不能从客户端或下单请求改写。生产数据库使用独立的受限运行角色；不要复制本机开发库。

## 私有批准文件

发布文件采用 `mx-production-release-v1` JSON，须为绝对路径、普通文件、权限 0600、内容小于 64 KiB，且 `releaseId` 与 `priceVersion` 均等于上述已批准价格版本。字段：`schemaVersion`、`releaseId`、`priceVersion`、`apiOrigin`、`merchantId`、`refundRule`（固定 `unused-full-v1`）、`expiresAt`、`routes` 和 `evidence`。`routes` 列出每个准售模型的 `modelId` 与精确 `routeVersion`；动态模型还必须在模型目录处于 active 且 `deployed_version=version`，并指向各自已批准的采购、汇率和零售价格。

`evidence` 必须恰好覆盖六类：`price-and-fx`、`supplier-usage`、`merchant-and-callback`、`unused-full-refund`、`wallet-reconciliation`、`release-approval`。每项填 `kind`、绝对 `path`、实际文件的 SHA-256、`approvedBy`、`approvedAt`。审批及证据文件都要为 0600；证据上限 1 MiB。运行时检查哈希、有效期和审批时间，防止只填一个看似正确的文件名。审批人的业务判断、商户资质、供应商账单和费率真实性必须人工核对；哈希校验不能替代这些审核。不得把批准文件、商户材料或含密钥的证据提交到仓库。

只有正式商户配置、相同的 HTTPS origin、同一版本的已批准三层价格、完整的路由清单、未过期且未篡改的六份证据、Billing Worker 近 60 秒心跳，以及 `sales_paused=false`、`cloud_paused=false` 同时成立，MX 新订单和新模型任务才可进入。旧订阅商品不会因为 MX 开关一并开放。任何条件失效时，商品和模型价格页面显示不可售，服务端拒绝新订单及新任务；已经发生的支付通知、订单查询、退款和未知用量核对继续运行。

## 上线核对与小额验收

1. 按 OD.1–OD.4 完成真实 DNS/TLS、仅 443 对外、数据库受限角色、模型代理部署和供应商用量探针；在审核文件中记录价格/汇率、采购账单、回调域名、未使用全额退款规则、账本对账及发布批准。
2. 在私有目录生成并保护六份证据和批准 JSON；运行 `npm run config:check -- --manifest /absolute/path/to/production.yaml`。检查 Go 与 Worker 使用相同私有配置，且 API、商户 ID、模型路由和价格版本与批准文件吻合。
3. 在获授权的正式环境执行一笔小额 Native 订单，核对扫码支付、验签通知、重复通知幂等、断线后主动查询与钱包只发一次点数。然后用获批模型执行请求，核对输入、输出、缓存读取、缓存创建四类 Token 的真实回执、预留/结算、独立供应商账单及不会自动重放的未知请求。
4. 使用另一笔**完全未使用**订单申请、审核并核对原路全额退款；已消费订单应被拒退。测试回调晚到、进程重启、Worker 暂停/恢复和模型路由停用，确认不多发权益、不多扣点。保存脱敏订单 ID、请求 ID、账单差额与审批记录。

没有正式域名、商户资料及批准文件时，保持 `payment.mode: disabled`。本机单元/数据库测试不等于步骤 3–4 的真实验收。

## 停售与恢复

先由运营控制把 `sales_paused`、`cloud_paused` 设为 true，或撤销/移走批准文件；确认新订单、新研究任务都被拒绝，保留 Go 与 Billing Worker 运行以处理支付回调、已发生请求的终态结算、退款和历史账单。修复证据、价格或路由后，重新签发有效批准文件并复核 Worker 心跳，再解除暂停。不要通过切回 `wechat-mx-live`、修改开发库或重放待核对供应商请求恢复销售。
