# M5.0 协议决策与供应商核对

日期：2026-10-01。当前目标：用户明确改选的 `gpt-5.6-sol`。Responses 核心及 Pi ModelRuntime 实测通过；尚未开放生产云模型。

## 决策

选择 `openai-responses`，Base URL 规范化为 `https://api.rootflowai.com/v1`，不重复拼 `/v1`。保留 Pi 0.99.1；不需要为本次接入升级 SDK，也不需要改用 Chat Completions。[API 参考](https://rootflowai.com/docs/api/reference)

此前精确 `gpt-5.6` 在当前账户不可见，实际 POST 返回503 `model_not_found`。失败证据保留于 [初次诊断](evidence/rootflowai-live-exact-model.json)。用户随后明确授权改为 `gpt-5.6-sol`，不是静默 fallback。新型号通过模型列表检查及真实生成。

## 真实实测矩阵

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 精确模型发现 | HTTP 200，`gpt-5.6-sol` 可见 | [Go 完整探针](evidence/rootflowai-live-sol-responses.json) |
| 非流式文本 | HTTP 200，completed，实际文本和 usage | 同上 |
| 流式文本 | HTTP 200，13个 SSE 事件及有效终态 | 同上 |
| 流式工具调用 | 合法固定 `read_probe_material({symbol:Si})`，11个事件 | 同上；仅合成硅记录，无文件或网络工具 |
| 工具结果回传 | HTTP 200，使用本机返回的原子序数14，20个事件 | 同上 |
| 结构化输出 | HTTP 200，返回 JSON 并通过 symbol=Si 校验 | 同上；仅此单字段 schema，不能外推完整 RPSME 效果 |
| Pi ModelRuntime | 固定 SDK，两次 HTTP 200，工具/文本 delta 与结果回传通过 | [Pi 真实证据](evidence/pi-responses-live-sol.json) |
| 原始用量 | input/output/cache/reasoning 可读取，按最终 usage 记录 | 两份真实报告；SDK cost 不作采购账单 |
| 本地取消 | 50ms 请求取消已观测 | 上游是否已生成/收费仍未知，不标上游取消通过 |
| Chat Completions | 未进行真实供应商测试 | 无需 fallback，仍保留离线回归 |
| 缓存写、推理参数、真实上下文上限 | unknown | 未做参数及容量专项测试 |
| 价格、消费日志、商业/数据条款 | 待账户核对 | 核心协议通过不等于生产销售门槛通过 |

## 本次修正及用量差异

供应商报告极短提示也约4.4K输入 Token。普通文本有4224缓存 Token，也有请求缓存为零。前缀由何处加入尚未证明，不将差异解释为免费或确定原因；保存最终原始 usage，后续对账不能按本地字符估算结算。

初次本地字节估算检查触发，见 [初次 sol 报告](evidence/rootflowai-live-sol-initial.json)。有价测试模式仍停止以保护预算；用户授权的免金额诊断模式记录 warning 后继续，仍限制6次/轮和每次256输出 Token，不修改真实用量。

Pi 暂设8192的诊断上下文额度时，会根据上一轮约4.4K输入量及内部4096安全余量收紧第二轮输出；诊断模型改用32768的测试额度。该数值仅供此小型测试，不代表测得模型最大上下文。传输守卫允许 Pi 收紧输出上限，但拒绝超过256；请求序列化后再执行合同校验，避免将 SDK 的 undefined 可选属性误报为非法字段。两项情况已由离线回归覆盖。

## 能力边界与后续

`core_protocol_verified` 仅代表本次 Go 核心步骤通过，optional 子项仍独立解释。Pi 此次验证 ModelRuntime 的两次真实模型请求及工具消息回传，不代表完整自动科研 Agent、平台网关、生产身份、支付或科学质量已验收。

继续 MX-502/503 的身份、数据库与平台网关实现；在正式启用前核对采购价格和供应商消费日志、冻结销售价格/能力版本、验证平台链和完整材料工作流。模型来源、上游取消及商业数据处理安排仍需独立确认。免金额测试授权不改变生产账本和预算要求。
