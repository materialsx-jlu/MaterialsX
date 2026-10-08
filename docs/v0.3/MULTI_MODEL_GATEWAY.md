# 0.3.2 多模型网关开发记录

日期：2026-10-07。当前交付为**服务端诊断能力**，不开放 MX 点销售；桌面模型选择与正式价格归 0.3.3–0.3.6。旧 `materials-research → RootFlowAI/gpt-5.6-sol` 路由、旧积分和已创建任务不迁移、不改价。

## 路由快照

| 用户选择的模型 ID | LiteLLM 固定别名 | Go→LiteLLM 协议 | 当前状态 |
| --- | --- | --- | --- |
| `gpt-5.6-sol` | `mx-gpt-5-6-sol` | Responses SSE | 小额真实流获得终态 usage；仅显式诊断开关可用 |
| `gpt-6-sol` | `mx-gpt-6-sol` | Responses SSE | 供应商 Key 无精确模型目录证据，硬性禁用 |
| `claude-opus-5-5` | `mx-claude-opus-5-5` | Chat Completions SSE，经 Go 转成 Responses 事件 | 已完成一轮真实工具调用和结果回传，均有终态 usage；仍需多轮稳定性复测 |
| `claude-fable-5-1` | `mx-claude-fable-5-1` | Chat Completions SSE，经 Go 转成 Responses 事件 | 已完成一轮真实工具调用和结果回传，均有终态 usage；此前另一次请求出现 400/无效参数片段，仍需稳定性复测 |

每路有独立的 `routeVersionId`；服务端目录包含四个槽位，未启用的槽位 `enabled=false`。任务创建时保存用户选择的模型，请求准入时再次比较任务模型与请求模型，并把当次路由版本写入 `gateway_requests.route_version`。发送给 LiteLLM 的模型名来自服务端常量表，客户端不能指定 Base URL、供应商密钥、LiteLLM 别名或重试次数。每路只有一个上游部署；Go 不重试生成，LiteLLM 的路由和每部署重试均设为零，不配置跨模型 fallback。断流、取消或无可信终态 usage 保持待核对，不自动扣点或重放请求。

Claude 的 `/v1/responses` 在 2026-10-07 实测返回 503，因此 Go 转成 `/v1/chat/completions`。适配器把消息、函数调用、函数返回、工具定义和工具选择转成 Chat 请求，并要求 `stream_options.include_usage`；返回时把文字、函数参数、终态 usage 转回现有 Responses SSE 合同。Fable 实测把工具索引从 1 而非 0 开始，适配器接受连续的 0/1 起始序列，仍拒绝缺号。加密 reasoning 无 Chat 等价物，在请求派发前拒绝。工具名仍使用现有客户端工具白名单；无 `[DONE]`、无终止原因、非法工具参数或流截断均不生成 `response.completed`。

## 本机启用诊断

LiteLLM 先保持 0.3.1 服务健康。管理员运行下列命令创建**只允许三条诊断别名**的 Go 内部虚拟 Key，密钥仅写入 Git 忽略的私有文件，终端不输出 Key：

```sh
node services/litellm/provision-gateway-key.mjs /absolute/private/path/litellm-gateway.env
```

本机已存入 `runtime/v03/litellm-gateway.env`，权限 0600。它与 LiteLLM Master Key 分离，并设置诊断预算、并发和每分钟上限。Go 服务环境仍需由运维安全注入该文件的 `MATERIALSX_LITELLM_URL` 和 `MATERIALSX_LITELLM_GATEWAY_KEY`，以及现有 RootFlowAI 旧路由环境变量；密钥不得进入桌面或计费 Web。

```text
MATERIALSX_CLOUD_MODE=alpha
MATERIALSX_CLOUD_ROUTE_VERIFIED=1
MATERIALSX_MX03_GATEWAY_MODE=diagnostic
MATERIALSX_MX03_DIAGNOSTIC_MODELS=gpt-5.6-sol,claude-opus-5-5,claude-fable-5-1
```

`MATERIALSX_MX03_DIAGNOSTIC_MODELS` 可只列其中一部分；缺省时四个新槽位全部禁用。配置拒绝 `gpt-6-sol`、重复/未知模型、付费模式或销售/采购价格版本。现有运行中的 Go 服务默认不带这些开关，因此普通用户当前不会看到或调用新路由。上线需要运营审批、四路完整探针及 0.3.3/0.3.4 钱包和价格版本。

## 验证与未完成项

- 本机 LiteLLM `/health/liveliness`、`/health/readiness` 为 200，三条诊断模型可见；新配置已通过 `manage.mjs validate`，启动后保持就绪。
- 真实小额探针：GPT-5.6 Responses SSE 有完成事件及 usage；两路 Claude 的 Responses 请求为 503，Chat SSE 则有 `[DONE]`、终止原因及 usage。Opus 与 Fable 的真实工具调用和工具结果回传各通过一轮。Fable 返回 1 起始工具索引；此前请求仍曾出现 400 或无效工具参数，网关拒绝产生完成事件；上线前必须做多轮稳定性复测。
- `go test` 使用隔离 PostgreSQL 跑过网关测试；覆盖旧路由兼容、模型错配拒绝、路由版本持久化、Chat 工具事件、断流与代理 URL/重定向边界。
- 尚未完成四路统一的流式、工具往返、取消、429/5xx 和供应商账单对账；`gpt-6-sol` 仍不可用。Claude 工具往返仍缺多轮稳定性证据。0.3.2 的正式验收及用户收费因此保持关闭。
