# MaterialsX 0.3.0：接口合同与四路供应商探针

合同版本：`mx-v0.3.0-v1`（结构基线，尚未实现）  
探针日期：2026-10-07  
状态：**部分通过；禁止据此开放正式收费**。私有原始脱敏记录位于 Git 忽略的 `runtime/v03/supplier-probe.json`。

## 四个槽位的实际探针结论

探针使用用户提供的四把专用 Key、固定 `https://api.rootflowai.com/v1`，每路先调用 `GET /models`。仅对精确 ID 可见的路由各发至多一条 Chat Completions 和一条 Responses 合成请求，`max_*_tokens=24`；不重试终态未知的 POST。报告只存状态、供应商返回的模型 ID 和 usage 数字/字段名，不存 Key、提示词、回答、请求体或供应商错误正文。

| 产品槽位 | 专用 Key 的 `/models` | Chat Completions | Responses | 0.3.0 结论 |
| --- | --- | --- | --- | --- |
| `gpt-5.6-sol` | 精确 ID 可见（HTTP 200） | HTTP 200、终态 usage：输入 4393、输出 5、缓存读 4224 | HTTP 200、终态 usage：输入 4393、输出 5、缓存读 3072 | 两种协议可完成最小文本调用；缓存计数跨协议不同，需核查供应商账单和 usage 语义 |
| `gpt-6-sol` | **目录为空、精确 ID 不可见**（HTTP 200；复查可见模型数 0） | 未发送 | 未发送 | 该 Key/分组的真实模型可用性未确认；保持禁用 |
| `claude-opus-5-5` | 精确 ID 可见（HTTP 200） | HTTP 200、终态 usage：输入 18、输出 2、缓存读 0 | HTTP 503 | 暂只把 Chat Completions 记为文本探针通过；不能假定 Responses 可用 |
| `claude-fable-5-1` | 精确 ID 可见（HTTP 200） | HTTP 200、终态 usage：输入 18、输出 2、缓存读 0 | HTTP 503 | 暂只把 Chat Completions 记为文本探针通过；不能假定 Responses 可用 |

`gpt-5.6-sol` 的短提示却产生 4393 输入 Token，表明存在需核实的上游输入开销；仅靠本地提示长度不能作为正式预留上界。上述成功调用证明了该 Key 对对应 ID 的最小文本访问与返回 usage，**不证明模型来源、工具/流式/取消能力、长上下文、缓存创建计量、采购倍率或账单扣额**。两款 Claude 的 Responses 503 只说明本轮请求失败，不推断永久不支持；后续以供应商协议说明和实测为准。

按供应商[余额查询接口说明](https://rootflowai.com/docs/tools/cc-switch)，还对四把 Key 分别执行了不调用模型的账户用量 GET；四次均返回 HTTP 200 且 `success=true`。因此 GPT-6 Key 本身可以查询账户，但该 Key 的模型目录仍为空，**账户有效不等于模型权限已开通**。接口返回的 `unit=USD` 是站内额度显示标记，且余额/累计用量属于整个账户，不能用它核定单个 Key 的本次扣费或 3.8x 倍率。

第 5.3 节的六档价格仍使用 [草案快照](../V0_3_ROOTFLOWAI_PRICING.json)。`gpt-6-sol` 的 3.8x、两款 Claude 的 0.6x 目前只有用户提供的价格假设，未见与这些调用关联的供应商扣额/分组账单；不能从成功返回 usage 推算采购成本。四路 `releaseEligible` 均保持 `false`。

## 0.3 跨服务合同

以下冻结**字段意义和服务责任**供 0.3.1–0.3.6 并行研发，具体数据库迁移和 HTTP 端点尚待实现。可执行类型定义在 [`mx-v03.ts`](../../packages/contracts/src/mx-v03.ts)，四路配置一致性由 [`mx03-contracts.ts`](../../scripts/mx03-contracts.ts) 检查。

| 边界 | 合同 |
| --- | --- |
| 桌面 ↔ Go | 公开 `slotId` 固定为四个产品名；目录返回展示名、上游 ID、协议、路由版本、价格版本、状态、证据时间。桌面只提交已发布槽位，不提交 Base URL、供应商 Key、采购价或用户自定点价。MX 钱包单位为 `mx-point`，余额和扣点以最多 6 位小数的十进制字符串返回。 |
| 充值 ↔ Go | 四商品为 ¥10/50/100/500，分别发 100/500/1000/5000 点；订单金额用人民币分的整数，订单商品、金额和点数由 Go 锁定，幂等到账。现有 `paid-credit` 继续独立显示和结算。 |
| Go ↔ LiteLLM | 四个固定代理别名及四个独立 Key 引用，见 `mx03Routes`；只走私网。每次请求携带 MaterialsX 请求关联 ID、公开槽位及已激活路由版本；LiteLLM 回传实际上游模型 ID、终态 usage 与故障状态。Go 独占用户预留、扣点和待对账决策。 |
| 计费 Web ↔ Go | 浏览器只访问计费 Web 同源 `/api/*`，其独立进程代理到 Go 私有 `/v1/admin/billing/*`。会话、角色、CSRF、幂等和审计由 Go 校验；计费 Web 不直连业务或 LiteLLM 数据库。 |
| 价格/路由发布 | 第 5.3 节价格版本与路由版本分别不可变，联合发布记录决定可用性。未验证的槽位必须是 `unverified`/`disabled`，只有完成采购账单、能力与结算验收才可转 `available`。 |

拟新增的桌面 HTTP 端点为 `GET /v1/mx/catalog`、`GET /v1/mx/wallet`、`GET /v1/mx/charges`、`POST /v1/mx/orders`；模型流式请求沿用 `/v1/model-gateway/{responses|chat/completions}`，服务端按槽位选择已激活路由。上述新端点**尚未注册**，不应让客户端提前依赖。计费管理端点按总览、用户钱包、订单、退款、用量、对账、价格版本、报表和审计划分；精确请求/响应在实现前由同一合同包细化。

业务 PostgreSQL 延续现有 `payment_orders`、`credit_grants`、`credit_ledger`、`credit_reservations` 和不可变 `sales_price_versions`、`purchase_price_versions` 的事务与审计原则，但 0.3 必须为 `mx-point` 使用**独立单位与至少百万分之一点的内部子单位**；旧 `paid-credit` 及其历史流水不得原地改写。每笔调用固定 `account_id`、`request_id`/幂等键、`slot_id`、路由/零售/采购/汇率版本、预留点数、四类 usage、供应商请求关联 ID 和证据引用。缺失终态 usage 或上游是否扣费未知时状态为待对账，不能结算为零。LiteLLM 的独立 PostgreSQL 只存代理运行资料，不存 MX 钱包真源。物理表和迁移将在 0.3.3/0.3.4 落地前审查，不以本文件代替迁移。

## 进入下一阶段前仍需的供应商证据

1. 让 `gpt-6-sol` 专用 Key 的精确 ID 在该 Key 的模型目录可见并完成最小调用；核对实际分组。不能改用另一把 Key 的可见目录代替。
2. 从供应商消费账单取得本轮请求的模型、分组、四类 Token、实际扣额和时间，核验 GPT-6 3.8x、Claude 0.6x；若倍率不同，生成新的价格快照并重新审批。
3. 核查 GPT 输入开销与两种协议的缓存计数差异，明确最终可信 usage 来源；验证流式、工具、取消、429/5xx 和长上下文档。
4. 在这些证据通过前保留 [价格快照](../V0_3_ROOTFLOWAI_PRICING.json) `draft` 状态、四路正式销售开关关闭；合同结构可供 0.3.1/0.3.3 开发。

本机复测：`npm run mx03:verify`；真实小额探针执行 `npm run mx03:probe:live`。私有文件 `runtime/litellm/secrets.env` 与 `runtime/v03/supplier-probe.json` 被 Git 忽略且权限为 `0600`；不要将其复制进文档、工单或发布包。

供应商调整 GPT-6 Key 后，可先执行 `npm run mx03:probe:discover -- --slot gpt-6-sol`：只查询该 Key 的模型目录，不发生成请求；结果另存 `runtime/v03/supplier-discovery-gpt-6-sol.json`，不会覆盖上述首轮证据。精确 ID 可见后再执行有上限的真实调用与账单核对。
