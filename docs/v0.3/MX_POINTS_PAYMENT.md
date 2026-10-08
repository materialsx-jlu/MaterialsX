# 0.3.3 MX 点与支付开发记录

日期：2026-10-07。交付范围为 Go 服务端的钱包、商品、订单、微信验签到账及全额未使用退款事务。指定账户的 ¥10 实付与原路退款试点已完成。本机现在另以显式 `--mx-live` 配置开放四档真实微信 Native 充值；此状态只适用于当前 loopback 部署和临时回调隧道，生产公开部署尚未发行。

## 单位与固定商品

独立单位 `mx-point`，内部 `1 点 = 1,000,000 subunits`，所有数据库运算为整数；API 用十进制字符串返回。`1 元 = 10 点`，四个不可变商品版本为：

| 商品版本 ID | 人民币分 | MX 点 | 内部子单位 |
| --- | ---: | ---: | ---: |
| `mx-cny-10-v1` | 1000 | 100 | 100000000 |
| `mx-cny-50-v1` | 5000 | 500 | 500000000 |
| `mx-cny-100-v1` | 10000 | 1000 | 1000000000 |
| `mx-cny-500-v1` | 50000 | 5000 | 5000000000 |

商品由 [迁移](../../services/control-plane/migrations/012_mx_points.sql)种入并设不可变触发器。客户端创建订单只提交 `productVersionId` 和 `Idempotency-Key`；金额、点数、币种与渠道均由 Go 固定，未知 JSON 字段被拒绝。商品 ID 与 [跨语言合同](../../packages/contracts/src/mx-v03.ts)由检查脚本逐项核对。

## 账本和支付状态

`mx_point_orders`、`mx_point_batches`、`mx_point_ledger`、`mx_point_reservations`、`mx_point_allocations`、`mx_point_refunds`、`mx_point_evidence` 与 `mx_point_jobs` 与旧 `payment_orders`/`credit_grants`/`credit_ledger` 分开。旧 `paid-credit` 的 ¥1=1000 规则、历史订单和流水未迁移。批次行的 `granted = available + held + consumed + frozen + returned` 可由不可变流水重建，数据库约束禁止负数或超额。账户锁序列化充值、预留、结算和退款；请求 ID、订单幂等键与证据 ID 各有唯一约束。

复用现有微信支付 SDK 的 Native 下单、订单查询、验签和解密通知。通知先由 SDK 验证，再按 `mx` 订单前缀交给 MX 服务校验商户号、App ID、人民币金额、交易状态和流水号；同一有效回调或查单重放只生成一次批次。晚于本地关闭状态但经渠道确认的真实付款仍入账，避免收到钱却没有点数。订单及退款 Worker 在渠道 POST 前持久化 `submitting`，结果不明时只查单，不盲目再次 POST；超过 24 小时转人工，内部管理员可审核后重新触发原单查询，持久化状态仍阻止二次 POST。退款申请受理不等于成功，以渠道最终 `SUCCESS` 为准。这也符合微信支付的[退款开发指引](https://pay.wechatpay.cn/doc/v3/merchant/4013071031)与[退款最佳实践](https://pay.wechatpay.cn/doc/v3/merchant/4014959631)。支付通道的原始错误和凭据不写入业务日志。

0.3.3 只实现 `mx-unused-full-v1`：整笔购买点数尚未消费、未预留且在支付后 365 天内才可申请原路全额退款。申请立即冻结对应批次；计费后台财务角色带版本号审批后 Worker 发起原单退款；只有渠道确认成功才把冻结量转成退回量。驳回则解冻，用户可重新申请。部分退款、已消费部分折现与自动退款均未开放。

## API 和启用方式

- `GET /v1/mx-points/products`、`GET /v1/mx-points/wallet`、`GET /v1/mx-points/orders`、`GET /v1/mx-points/orders/{id}`：持用户 Bearer 凭据读取本账户资料。
- `POST /v1/mx-points/orders`：仅 `productVersionId`；`POST /v1/mx-points/orders/{id}/refunds`：仅原因。两者要求 `Idempotency-Key`。`GET /v1/mx-points/refunds/{id}` 查询退款；服务端均核账户归属。
- 微信回调沿用 `/v1/payments/wechat/notify`，先验签解密再分流。没有可公开调用的“标记支付成功”接口，也没有用户直接审批退款的接口。

默认 `MATERIALSX_MX03_PAYMENT_MODE` 为空，四款商品仍关闭。合成 `test` 模式仅用于隔离测试库，历史 `wechat-pilot` 仅允许指定账户购买 ¥10。本机 `npm run identity:local -- --mx-live` 使用私有 `runtime/m5-local/mx-live.json`、独立 LiteLLM 和回调专用隧道；Go 严格要求本地数据库、已审核价格版本、MX 钱包网关模式和真实微信 SDK，四档商品均可创建真实订单。旧 M5 充值商品未随此模式开放。

新 Go 二进制启动前须由部署命令显式执行数据库迁移并备份；运行时不自动迁移。本机服务已切换到新代码，四档目录均返回 `enabled=true`、`salesEnabled=true`。2026-10-07 一笔新的 ¥10 订单已由微信确认支付，钱包到账 100 MX 点；随后的真实 GPT 5.6 调用已从这笔钱包余额最终扣减 0.16905 MX 点。供应商遗漏的缓存写入量由独立消费日志补证，未凭空记零；受信任的本地 `reconcile-mx-supplier-bill` 命令一次事务提交钱包扣减、供应商账单和网关回执。详情见 [联调记录](INTEGRATION_RELEASE.md)。

## 验证

在每次测试创建/删除的隔离 PostgreSQL 库中，已覆盖四商品金额与点数、并发同键建单、验签证据错误金额拒绝、八路并发回调单次到账、关单后迟到付款、并发超额预留、预留/结算幂等、已用/预留点不可退款、退款冻结与解冻、渠道退款重放、流水与批次守恒、旧账本隔离，以及渠道下单未知结果不二次 POST。`go test ./...` 和 `npm run mx03:verify` 是本阶段回归命令。真实 ¥10 试点的收款、到账、财务审批、渠道退款成功和钱包回退由 `npm run mx03:pilot:verify` 从 Go API 只读复验，见 [0.3.7 联调记录](INTEGRATION_RELEASE.md)。生产商户绑定、支付账单对账和四档现金验收仍属发布门槛。
