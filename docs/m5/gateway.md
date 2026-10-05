# M5.2 平台网关与 Pi 启动指南

2026-10-01，MX-503。这是受邀技术测试链路。正式订阅、资金预留/结算、供应商成本对账和完整材料流程由 M5.3 及后续工作包实现。

## 已实现的数据路径

桌面主进程持有 MaterialsX 登录凭据 → 本机 Pi ModelRuntime → MaterialsX Go 网关 `/v1/model-gateway/responses` → RootFlowAI `gpt-5.6-sol`。用户不能配置供应商密钥、任意外部域名或上游模型；公开模型别名固定 `materials-research`。本地模型路径继续独立使用现有 Pi 工具与 PDF 流程。

每轮平台发送由原生窗口展示供应商、完整本轮问题、同账户本对话的平台历史条数（包括之前批准的工具结果）、选定文本快照/指纹、点名 Skill、请求/输出/时间上限。选择“同意本轮外发”才创建任务；授权不能由 renderer 传入布尔值跳过。未登录、服务端关闭或账户未获授权时阻断平台发送，用户可切换本地模型。

- `read_material_file`：点击输入框回形针，通过系统文件选择器选取**登记项目内**的 UTF-8 `.txt/.md/.json/.csv/.cif/.xyz/.log`，每个最多32KiB，最多8个。本机读取并冻结选择时的文本快照，模型只见不透明文件 ID、名字和 SHA256；不能按任意路径读取文件。符号链接逃逸、二进制与超限内容被拒绝。
- `read_skill`：用户以 `@skill-name` 或 `$skill-name` 明确点名已启用的内置 Skill；最多8项，工具结果受64KiB限制。仅发送选中的说明，不默认发送整个 Skills 库。
- 本期没有云模型驱动的 bash/write、MCP、自动 PDF 预处理或完整 RPSME/XYZ 产物流水线。读取 Skill 不代表已执行其脚本。模型不得声称执行不存在的操作。

Pi 保留原生工具调用/回传，文本接入32ms桌面缓冲。平台对话历史按账户和对话隔离，当前仅在进程内保存，退出账户/应用后不自动恢复；本地聊天记录仍在 SQLite。SQLite 额外只保存账户/对话/task ID索引，重启登录后可查询服务端请求状态和用量，不保存访问令牌或供应商 Key。

## 服务端部署与授权

先按 [M5.1 身份指南](identity.md) 准备 PostgreSQL、迁移所有者、运行角色和受邀账户。`002_gateway.sql` 新增 `cloud_access`、`research_tasks`、`gateway_requests`。不要改写已应用的001迁移，也不要让运行进程自动迁移。

私有服务环境配置（根 `.env.example` 仅提供占位名称；程序不自动载入 `.env`）：

| 变量 | 值/规则 |
| --- | --- |
| `MATERIALSX_CLOUD_MODE` | 默认 `disabled`，显式 `alpha` 才启用 |
| `MATERIALSX_CLOUD_ROUTE_VERIFIED` | 精确模型探针通过后置 `1`；这是部署审核开关，不会自动探测 |
| `ROOTFLOWAI_BASE_URL` | `https://api.rootflowai.com/v1`，仅允许已固定的官方中转域名 |
| `ROOTFLOWAI_MODEL` | `gpt-5.6-sol`，禁止自动回退到其他模型 |
| `ROOTFLOWAI_API_KEY` | 仅服务进程私有环境，不配置到桌面、仓库或命令参数 |
| `MATERIALSX_CLOUD_MAX_REQUESTS` | 默认6，每任务1–16次 |
| `MATERIALSX_CLOUD_MAX_OUTPUT_TOKENS` | 默认1024，每请求1–4096输出tokens |
| `MATERIALSX_CLOUD_MAX_DURATION_SECONDS` | 默认180，每任务1–600秒，包括工具轮次 |
| `MATERIALSX_CLOUD_MAX_CONCURRENT` | 默认8，平台1–64；每账户同时最多1个生成请求 |

生产环境继续要求身份公共地址 HTTPS、PostgreSQL verify-full TLS、受限数据库运行角色。网关与身份服务同进程，反向代理 SSE 禁用缓冲并允许长连接。供应商报告输出超过请求上限时保留实际usage并标记失败，不能通过截断token/少记用量伪装符合预算。服务端流每10秒发送 SSE 注释心跳，覆盖普通30秒写超时，以每次写10秒和任务截止时间限制连接。

迁移/角色授权用迁移所有者私有环境执行：

```bash
npm run identity:ctl -- --command migrate
npm run identity:ctl -- --command grant-runtime --role mx_identity_app
```

若之前已授权旧运行角色，**迁移002后重新执行 grant-runtime**。运行角色仅能更新 `cloud_access.request_count`，不能自行授予/扩充权限。授予测试资格由所有者 CLI 从 stdin 读取非秘密 JSON：

```bash
npm run identity:ctl -- --command grant-cloud <<'JSON'
{"accountId":"<ACCOUNT_ID>","requestLimit":20,"expiresAt":"<FUTURE_UTC_ISO_TIME>"}
JSON
```

`requestLimit` 是累计请求的绝对上限（1–10000），重复授予不清零已用计数；到期时间必须在未来31天内。权限授予追加审计记录。测试账户不是购买用户，测试次数不是资金余额。合法请求被接纳即消耗一个测试次数，失败/结果未知也不会自动返还，以限制采购风险。

使用运行角色环境启动 `npm run identity:dev`。桌面设置 `MATERIALSX_IDENTITY_URL` 为同一服务的 HTTPS origin（开发仅 `http://127.0.0.1:PORT`），运行 `npm run desktop:start`，在设置登录并选择“平台模型 · 技术测试”。本阶段没有默认公共生产服务器；打包应用需要部署时注入/配置该origin。

## 请求状态与用量

已实现 GET providers/models；POST tasks；GET tasks/{id}、tasks/{id}/requests、model-requests/{id}；POST任务finish/cancel和请求cancel；POST原生 Responses 网关。合同见 [openapi.json](openapi.json)。Chat Completions、资金/订阅接口仍标 planned。

- Task创建与生成claim在事务中校验账户、会话、设备、账户授权和期限；全局 admission 锁与账户唯一活动索引跨进程限制并发。
- 任务/请求幂等键绑定账户和内容摘要（请求另绑定task ID）。重复生成 POST返回409，不会重放供应商请求；同键改参数返回 `IDEMPOTENCY_CONFLICT`。取消/结束对同一目标和终态幂等，不触发供应商生成。
- 严格限制原生字段、文本类型、两个只读函数工具、256KiB请求、256KiB事件及8MiB整条流。禁止URL图片、付费搜索、任意上游地址/密钥/headers、未知采样参数和自动重试。
- PostgreSQL只保存授权元数据、预算、摘要、执行状态和usage；不保存问题正文、文件文本、模型答案或工具结果。供应商与代理自身的日志策略仍待确认。
- 有效completed终态先写数据库，再转发给Pi。断流/无终态/无效usage记 `unknown` + `reconciliation_pending`；明确完成但usage缺失可 `completed` + pending。未知token为null，不能填零。
- 精确记录input/output/cache/uncached/reasoning。reasoning已包含在output，不重复相加；Pi SDK内部cost设零仅为运行兼容，**不会作为账单或供应商成本**。
- 全部 alpha DTO `billingMode:alpha-test`、销售价格/实扣null；已知usage标 `not_billed`（用户测试不收费），未知标 pending；这不表示供应商免费或采购完成对账。
- 停止先在桌面abort，异步请求持久取消；服务器每300ms检查取消/账户/设备/会话/授权，断开供应商HTTP。**无法证明上游已经停止计费**；已发请求无终态仍保留unknown。未确认请求不在同任务继续调用。服务器崩溃后租约到期在状态查询/新请求时收敛为unknown，仍不可自动重发。
- Task completed要求每个请求已有有效完成终态；科学质量始终 `not_evaluated`。最终文本不等于材料产物验收。

## 验证

用隔离测试PostgreSQL DSN（名称必须含test）：

```bash
npm run check
npm run test
npm run build
npm run m5:contracts:check
npm run m5:identity:test
npm run m5:gateway:live
npm run m5:gateway:live -- --electron
```

最后两个默认仅用合成供应商，实际PKCE/PG/Go/Pi/Electron，不产生外部模型费用；fixture位于 internal/gateway/testfixture，正常服务不会加载它。辅助脚本使用临时随机端口、合成账户和临时master key，退出会停止子服务。该脚本会在所选测试数据库新增合成账户/审计；不得指向真实用户数据库。

真实供应商验证必须显式 `--provider --key-stdin --unbudgeted-test`，从私有stdin注入凭据。先验证models含精确 `gpt-5.6-sol`；只读合成硅文本，最多3次调用、每次256输出token、120秒，不传真实论文。诊断金额豁免源于本次用户授权，不作为生产默认。元数据证据写忽略的 runtime/m52，审核后才复制公开文件。验收结果见 [执行报告](gateway-execution-report.md)。
