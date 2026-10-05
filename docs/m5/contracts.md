# M5 核心合同说明

版本 `m5.5-v2`。权威核心校验定义为 `packages/contracts/src/platform.ts`；`npm run m5:contracts` 生成 [openapi.json](openapi.json)，`m5:contracts:check` 在 CI 拒绝漂移。M5.1 身份、设备与管理身份接口有独立 Go/PG 实现；M5.2供应商目录、任务、请求与Responses网关已实现alpha合同；M5.4 测试套餐/订单/退款/订阅/导出已实现，正式支付仍被准入策略关闭。OpenAPI逐路径标记implemented-M5.1/implemented-M5.2-alpha/implemented-M5.3-test-credits/implemented-M5.4-test-business-live-sales-gated/planned。旧开发服务不会自动拥有生产能力。

## 范围与版本

已固化核心 DTO：公开供应商/模型、PKCE 桌面登录握手/刷新、任务预算、请求执行/结算/科学质量、usage、权益、套餐/订单、网关请求与错误。分页列表为 `{items, nextCursor}`，cursor 为不透明游标，limit 默认 50、最多 200。

已增加当前主体/设备、用户管理状态与审计合同，启动和部署见 [M5.1](identity.md)。其他管理员具体操作、支付回调渠道签名、账本分页、退款试算、资源发布在 MX-504/505/OPS 合同评审继续增加 schema；不能从此核心 OpenAPI 推断整套商业接口已全部完成。新增字段/行为须更新合同版本和消费者，不 silently 改旧开发 DTO。

旧 `/v1/plans`、`/v1/entitlements/{accountId}` 和 `/v1/dev/*` 只属于 loopback 开发原型，不迁移为公网用户接口。

## 身份与权限

- 客户端发送 MaterialsX access token；供应商 Key 只由服务端注入。
- `/v1/auth/desktop/start` 绑定 flow、随机 state、S256 code challenge 和登记的 loopback callback；exchange 校验一次性授权码、过期、flow 与 verifier。服务端固定授权页面域名，不能信任客户端任意跳转地址。
- refresh token 轮换、重放拒绝、设备/账号撤销已由 MX-502 实现；凭据保存系统安全存储。合同里有 token 字段不等于应把 token 写到 SQLite/日志。
- 服务端从主体识别用户；预算、订单和模型请求均不接收可伪造的 account ID 或“实扣费用”。对象授权在取数据与写操作前执行。
- 商业 POST 创建/操作与管理状态变更使用 `Idempotency-Key`，绑定用户、操作和规范化参数摘要；冲突返回 `IDEMPOTENCY_CONFLICT`，禁止重复创建上游调用。
- 身份 start/exchange/refresh 不使用商业幂等键：一次性授权码和旋转令牌约束重放，客户端不自动重试；重放 refresh 会撤销会话。设备撤销/退出为相同目标的撤销操作，已失效的调用令牌仍返回 401。
- 浏览器 `GET/POST /auth/desktop/{flowId}` 为 HTML 表单与 303 回调，cookie/CSRF/Origin 验证见 identity.md；不属于 JSON API。
- 网关 additionally 绑定 `X-MaterialsX-Task-ID` 与 `X-MaterialsX-Request-ID`。trace ID 仅诊断，不代替幂等键。

## 网关与 Pi

Pi Base URL 将指向受控 MaterialsX `/v1/model-gateway`，原生 SDK 在后面追加 `/responses` 或 `/chat/completions`。请求保持原生协议体，任务、请求和幂等关联放在 HTTP headers。客户端使用公开模型别名，服务端固定映射 upstream ID，并冻结 route/price version。

合成 Pi 探针已验证其最小 Responses payload 符合核心 schema（包括 `store:false` 与 encrypted reasoning include）。真实能力、推理参数、structured output 等扩展需经供应商验证后显式纳入；严格 schema 不接受随意的上游地址或未知顶层字段。

input/messages/tools 的内容记录是协议容器，JSON Schema 校验不代表安全验证已完成。MX-503 已检查内容类型、工具种类、数量/字节、输出上限、引用资源、模型能力及云数据范围；首版只允许已确认的函数工具，不能放行供应商付费搜索等未知额外工具。

SSE 返回原生 Responses/Chat 事件，保留工具调用、终态和 usage。流开始前使用 JSON 错误；开始后按对应协议错误事件终止。请求持久状态通过 `/v1/model-requests/{id}` 查询，不能往 Pi 原生流中插入未定义商业事件。

取消接口请求停止；`cancel_requested` 不表示上游已停止。网络断开、终态缺失或 usage 缺失进入执行 unknown/结算 pending 的合法组合，不自动用零结束。将来重连查询已有请求，不能重复发生成。

## 数据单位与状态

- 钱和 credits 在生产 wire DTO 中均为非负十进制字符串，最多 signed int64；避免 JS number 丢失精度。旧开发 number DTO 不混用。
- 模型 Token 为安全整数或 null；null=未知，0=供应商明确报告零。
- capability unknown/unsupported 不等于 verified；verified 必须关联证据。启用付费云模型至少需要协议、销售价格、流式和工具证据及服务端发布审核。M5.2仅显式alpha-test允许price=null，通过累计次数限制非收费测试；不会改写付费DTO或虚构免费销售价。
- `execution`、`settlement`、`scientificQuality` 独立。产物待复核不能替代收费终态；settled 要求可靠 usage 和实际 credits。
- JSON Schema 无法表达所有跨字段规则。Zod refinements、Go 服务端状态机、事务及对象授权共同构成实际合同；生成 schema 的 `x-runtime-invariants` 明确这一点。

## HTTP 错误映射

| HTTP | code 示例 | 处理 |
| --- | --- | --- |
| 400/422 | VALIDATION_ERROR | 修改明确不合法的字段；不重发同一坏请求 |
| 401 | UNAUTHENTICATED | 合法刷新一次或重新登录 |
| 403 | FORBIDDEN | 不重试；不隐藏为余额不足 |
| 402 | INSUFFICIENT_CREDITS、TASK_BUDGET_EXCEEDED | 保存进度，补充额度/调整允许预算 |
| 404 | NOT_FOUND | 资源不可见或不存在；避免泄露其他用户对象 |
| 409 | IDEMPOTENCY_CONFLICT、OPERATION_CONFLICT | 查询当前状态，重新确认意图 |
| 429 | RATE_LIMITED | 显示 retryAfter；生成只在明确安全时重试 |
| 503 | MODEL_UNVERIFIED、MODEL_UNAVAILABLE、PRICE_UNVERIFIED | 返回阻断原因，保留本地模式 |
| 502/503 | UPSTREAM_ERROR | 脱敏错误，不复制上游正文/凭据；先查执行状态 |

STREAM_INTERRUPTED、USAGE_PENDING 用于持久状态或对应流错误，不以重复请求解决。错误包含 code、短消息、requestId、retryable；retryable 不表示可无条件再次消费或已有幂等执行保障。


## M5.2 Alpha增量

AlphaCreateTask/AlphaTask/AlphaRequest与付费DTO分开。所有对象由当前登录主体授权；原生网关只支持Responses，未实现Chat接口。alpha额度为累计请求次数而非credits，限额和逐轮外发consent在任务创建固化。模型目录附alpha可用性/剩余次数/到期/限额及不可变routeVersionId。

AlphaRequest的chargedCredits、salesPriceVersionId恒null，not_billed仅在终态及input/output已知时成立；usage未知为pending，科学质量固定not_evaluated。请求预算超限HTTP409，账本余额不足402留后续。Task finish completed逐项检查服务端请求，不接受客户端文字声明作为成功证据。任务和请求列表仅返回本账户，alpha单任务最多16项、nextCursor=null，不接受分页参数；身份/管理员分页规则继续沿用M5.1。

数据范围、默认限额、原生事件边界、取消/崩溃及未覆盖项见 [网关指南](gateway.md)。

## M5.3 test-credit 增量

合同版本 m5.5-v1。AlphaTask/AlphaRequest 名字为兼容保留，支持严格的 alpha-test/test-credits union。test-credits 必须有正整数 maxCredits、销售版本；reserved/settled/released/pending 独立于执行与科学状态。模型目录可附服务端 testPricing；采购价不下发普通客户端。钱包和账本使用整数字符串，无小数或浮点金额。

HTTP402为余额不足；任务/账户预算不足、价格不可用、核对版本冲突和未知用量需处理原因，对应HTTP409。管理员核对需MFA，preview只读、reconcile幂等key等于requestId，证据只能为usage/no-call/waiver。人工usage可能令settlement=settled，但原stream terminalReceived与execution保持真实状态；不能要求它们等同。

规范计费、权限、恢复与当前边界详见 [M5.3](metering.md)。正式支付DTO仍planned，不能从OpenAPI里的规划结构推断已有购买能力。

## M5.4 商业域测试合同

钱包新增退款冻结/回收，账本新增 frozenDelta/returnedDelta 及 refund_freeze/refund_release/refund。订单快照保存完整套餐、计费单位、有效期及退款规则；创建参数只有版本 ID 与 test 渠道，不接受客户端金额或 accountId。产品 testOnly、formalSalesEnabled=false 是当前准入约束，不是正式商户配置状态。

orders GET/CSV 是创建时间+ID 游标，每页 50 条；退款/期间为有界列表。管理操作必须管理员 MFA，退款 ID 幂等键与 expectedVersion/orderVersion 约束；关单/查询是同一资源重复请求的安全幂等，不能创建新支付或退款。微信通知使用渠道签名，不要求平台 Bearer，验签/解密/对象金额校验后事务提交，成功 204。详情见 [M5.4](payments.md)。

## M5.5 页面与运营合同

新增 WorkspaceStatus / WorkspaceControls、TaskBills / BillingActivity、Releases / ReleaseManifest / ReleaseMutation、OpsUsers / OpsAudit / OpsFinance。任务账单/趋势使用当前主体，分页 cursor 也受账户约束；累计 tokens 为整数字符串或 null，保持未知，不返回原始内容或采购成本。近 7 日趋势 UTC 独立于账单分页。

`/ops/api` 同源 cookie + 管理员 MFA，所有写入要求准确 Origin 与 CSRF；用户状态、控制、发布写入还要求幂等键和版本。控制传入 `version` 是预期当前版本，成功自增。ReleaseManifest 摘要采用 Go 规范 JSON；发布仅登记经过服务器私有证据与 GitHub 公开 immutable Release 校验的下载目录，不触发 GitHub 写入。公共 `/v1/releases` 无鉴权，只读 published 元数据。桌面仍经主进程可信服务连接获取，不能自填下载 URL。

平台合同版本独立于程序版本；本次没有要求旧 Electron 自动更新。旧 001–004 迁移及支付 DTO 保持兼容，新部署须应用 005 并重新授权最小 runtime。


## M5.3B 扩展（m5.5-v2）

AlphaTask/AlphaRequest 名字为兼容保留，新增严格 paid-credits 分支。真实积分 public amounts 是最多四位小数的字符串；测试分支仍要求整数。paid-credits settled 必须有总输入、缓存输入和输出 usage，不能把未知缓存当零。

模型目录新增 paidPricing（售价显示为积分/百万 Token，1000 / 100 / 10000），内部版本存储和请求预算使用整数子单位（precision=10000）。不要把内存/数据库子单位当客户端积分。钱包 purchased、流水、账单、核对预览按各自精度显示。活动和运营汇总新增 paidChargedCredits / paidHeldCredits，不与 test-credit 相加。新消费客户端需要 m5.5-v2 合同；旧发布目录仍可读取 m5.5-v1 / 005 历史清单，新清单支持 m5.5-v2 / 007。

详情：[真实积分消费](paid-credit-consumption.md)。默认禁用云消费，显式 paid-pilot 仅限指定账户，不开放通用生产付费。
