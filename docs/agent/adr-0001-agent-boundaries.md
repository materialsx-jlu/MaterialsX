# ADR-0001：复用现有执行能力，固定引擎与数据边界

日期：2026-10-05；决策：接受 UA.0 基线，UA.1 起实施统一适配。阶段状态只维护 [UA 主计划](../UNIFIED_AGENT_DEVELOPMENT_PLAN.md)。

## 引擎选择

选公开 `@openai/codex@0.160.0` 的 app-server v2 stdio JSON-RPC 作为首个 Codex 适配接口，Pi 0.99.1 保留本地模型及旧会话。隔离运行时的命令、补丁、MCP、实际重启后的 thread/resume 均已执行通过；具体回执见 [UA.0](ua-0.md)。不从桌面产品提取私有实现，不复制 Codex 的工具循环。

app-server 是桌面集成的接口选择；此阶段不另外集成 `@openai/codex-sdk` 的 exec 包装。两套前端同时接入会产生重复会话与取消路线。若后续接口不足，再用可复现差异提出新的 ADR，而非默默增加第二个默认执行器。

运行时仍标记 experimental，必须固定版本、生成并哈希协议 Schema、保留协议回归，不跟随 npm latest 自动更新。此版本默认通过 `additional_tools`、namespace/custom tool 与 `functions.exec` 组合调用原生工具。已探测的接口行为不能等同于当前 M5 网关兼容：UA.1 必须核对这些输入项、流式事件、取消/恢复、模型端支持与每次实际请求计量，再允许平台账户接入。不能绕过 M5 直接装供应商密钥或自建 Token 账本。

UA.0 的模型传输是脚本 Responses fixture，不使用账户凭据，也没有付费供应商调用；证明的是协议和工具执行。真实模型需求理解、纠错和科学质量另测。OpenAI API 并不会使 MaterialsX 自动达到 Codex 完整产品能力。

依据：[官方 app-server 文档](https://developers.openai.com/codex/app-server)、[官方 SDK 文档](https://developers.openai.com/codex/sdk)、隔离 0.160.0 CLI 的 `generate-json-schema` 及本机真实探针。上游资料描述接口；本机回执证明此次验证范围。

## 唯一职责

| 主实现 | 保留职责 | 迁移要求 |
| --- | --- | --- |
| `packages/contracts/src` | 产品合同、身份、错误、权限与状态 | UA.1 实现 ResearchGoalPlan；上游 private 类型不穿透到产品层 |
| `packages/pi-adapter/src/local-session.ts` | Pi 会话、prompt/cancel、恢复与资源加载 | 引擎薄适配，不复制科学方法；保留旧会话回归 |
| `local-session-tools.ts`、`rpsme-workflow.ts` | 文档预处理、真实证据与抽取产物检查 | guards 与确定性抽取仍保留，UA.6 评估迁移；不能删除有历史兼容/测试调用的 guard |
| `science-bridge.ts`、`packages/atomistic/src` | 方法资格、选势、下载、真实计算及产物 | Codex/Pi 调用同一桥；同一 job 只提交一次 |
| `apps/desktop/main/store.ts` | 项目、会话、消息、已有运行记录 | UA.1/UA.4 通过稳定引用扩展；不另建重复项目/任务真相库 |
| `text-stream-buffer.ts` | 既有文本缓冲 | UA.3 增加共用事件序号与分项计时，保持流式行为 |
| M5 control-plane / client | 账户、任务/请求、预算、订单与积分 | 新引擎绑定已有 ID/授权；不复制付款或余额 |
| MOOS 原服务 | 原始材料事实、来源版本、审核、索引与资产权限 | UA.2 只读白名单 adapter；不直接操作数据库，不建事实镜像 |
| Electron main / renderer | 服务组合、IPC / 页面展示 | 业务服务不依赖 Vue；主界面保持页面与全局主题的一致呈现 |

UA.1 候选新增为一个 AgentEngine 产品接口及经验证的 Codex 适配；UA.3 的 TaskSupervisor 只检查授权、依赖、预算和真实回执，不再次执行引擎已经运行的工具。暂不创建空 `agent`、`research`、`mcp` 包。

## 合同冻结

唯一运行时定义归 `packages/contracts/src`，字段基线见 [contract-baseline.v1.json](../../fixtures/agent/contract-baseline.v1.json)。它是 UA.0 接口输入，不是已经可执行的 UA.1 schema。

研究计划保持目标、约束、认知状态、执行步骤、调整规则、最终验收六部分。保存原始用户消息及修订引用、goal/plan revision、输入版本/hash；事实、缺项、假设分开。复杂步骤记录方法、输入、依赖、预期产物、完成标准及真实 attempt/job/artifact 引用；依赖无环。简单任务无需额外长计划或重复批准。

目标由研究项目拥有，步骤/尝试由任务层拥有，资金由 M5 拥有，通过稳定 ID 引用关联。UA.3 消费同一合同检查与修订，UA.4 消费同一合同展示研究状态与真实交付；Skills、MCP、Pi、Codex 和 PS 管线不得各造一套计划对象。

来源必须携带 connection/source/package/experiment/generation/entity 和 hash；MOOS 的整数 ID 不转换成无来源的产品 UUID。未知单位、条件、审核与权利保留 null/unknown。模型引用论文、网页或 Skill 的指令不能增加宿主权限。

## MOOS 来源策略

默认先检索已授权 MOOS；缺数据时，记录缺项和负面结果，再按已有授权补外部/本地来源。先读版本、证据、条件及权利，再比较与计算。MOOS 搜索当前只覆盖辐射制冷 cohort，不能宣称全库或所有材料已覆盖。

固定 client/server SDK 1.31.0 与已协商协议 2025-11-25；初版同机 stdio，八个只读工具沿用 MOOS 专项规范。协议可用不代表服务生产权限已完备。本机预览身份不移植到公网；不得通过伪造 Host、代理头或绕过开关读取。当前 pending_review 仅表示待复核，不能被索引或模型升级为 validated。

历史 generation 的此次抽样为 404，错误 generation 被拒绝；UA.2 必须明确返回不可用/版本过期，不偷换为当前版本。图片本机可读仍可能不可再分发；外发需另有有效授权。simulation metadata 不等于可运行计算输入，也不授权发起模拟。

## 清理与兼容

本次拆分主进程目录加载/诊断/支持包、renderer 目录/运营页、Pi 文档工具；调用接口保留一份实现。删除硬编码已不再使用的 Gemma 探针，`lmstudio:probe` 指向当前已加载模型的受限基准。删除迁移后的旧函数副本、未使用 imports/refs；纠正没有实际连接却显示 Materials MCP ready 的静态代码。

`local-session.ts` 对外 helper 重导出仅为现有主进程和 `local-session.test.ts` 调用兼容，没有复制执行逻辑。UA.1 迁移新增调用，UA.6 文档工具迁移验收时将现有调用切到所属模块并删除重导出；保留测试回归，最迟 UA.6 清理。旧 RPSME guard 仍保护历史会话，不因新的确定性抽取路线存在而直接删除。

自有代码单文件最多 600 物理行，开发与 CI 强制。拆分按职责，不压缩行、不增添多套 Manager。UA.0 没有删除用户研究文件、模型权重、数据库或其他项目。

## 下一阶段估算

复用结果将 UA.1 收敛为合同+引擎适配+M5 协议兼容检查，UA.2 收敛为 MOOS 白名单/版本/权限投影，UA.3 复用会话、缓冲与运行回执，UA.4 再扩展研究状态。无需重写 M5/M6 或再建 Planner 数据库。

按一位主要开发者估算：UA.1 约 5–8 个开发日，UA.2 约 4–6 日，UA.3 约 6–10 日，UA.4 约 5–8 日；实际模型和源权限验收可能延长。这是 UA.0 的重新估算，不是时间承诺或新增排期；以统一阶段的验收为准。
