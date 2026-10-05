# UA.3：执行监督、上下文与恢复

最新本地修复与回归见 [UA.1–UA.7 统一闭环记录](ua-closure.md)。以下保留本阶段当时的验收结果。

日期：2026-10-05 · © 2026 吉林大学 AI-DAOS 团队

本阶段已交付共同监督层及桌面入口。Pi 和随 MaterialsX 独立分发的 Codex App Server 保留各自工具循环；监督层只做准入、记录、版本检查和验收，不执行工具，不在外层重试整个 Agent。模型理解质量、科学结论、云端四组合和跨平台发行继续按原阶段验收。

## 使用入口

「运行记录」→ 点击任务 →「研究目标与执行计划」→「执行记录」。可查看步骤状态、请求数量、首个流片段耗时、总耗时和有序事件；暂停后可核对回执、恢复原引擎或显式交接到另一种本地引擎。旧任务没有监督记录时不编造记录。

聊天继续使用原 32ms 文本缓冲。每轮拥有独立 stream ID 和序号，旧轮输出不能覆盖新轮消息。执行事件独立传递，原消息正文不插入每次工具日志。

## 共同合同与职责

| 位置 | 职责 |
|---|---|
| `packages/contracts/src/task-execution.ts` | 一套任务、步骤、工具尝试、请求、版本、时间和交接来源合同 |
| `packages/agent/src/task-supervisor.ts` | 依赖、权限、预算、重复操作、真实回执和计划调整准入 |
| `execution-context.ts` | 请求预算、完整旧交换压缩、项目指令作用域 |
| `supervised-stream.ts` / `composer-admission.ts` | Codex 请求、原生调用及首个片段观察；实际执行仍归原生引擎 |
| `packages/pi-adapter/src/supervised-pi.ts` | Pi 扩展事件及请求准入；实际工具仍归 Pi |
| `host-tool-router.ts` | 按需查找原工具并调用原 dispatcher，不复制材料算法 |
| `apps/desktop/main/agent-journal.ts` | 原 WorkspaceStore SQLite 中的 CAS、事件和结果引用 |
| `agent-supervision-store.ts` | 计划修订与 journal/event 同一事务提交 |
| `agent-runtime.ts` / `agent-execution-ipc.ts` | 固定连接、原账户范围、取消、回执查询、恢复和本地显式交接 |

长回执和执行输入留在数据库，提示只携带近期回执引用和宿主计划；`task_control receipt` 可按真实 ID 在限额内读取原证据，不重新执行工具。没有新增任务数据库、钱包、科学计算后端或第二套 Agent 循环。

## 已实现的行为

1. 请求、工具和任务拥有 ID、开始/结束时间；请求记录首个流片段时间、输入上界、输出预留和真实可取得的用量。Pi 缺失用量时的默认零值保留为 unknown；本机记录不用于扣费，云端仍以 M5 回执/结算为准。
2. 请求前按实际连接窗口检查 UTF-8 字节保守上界、协议/工具 schema、1024 预留及输出预算。超限只移除旧的、已闭合的 assistant/tool 交换；保留全部用户/系统指令、当前证据和调用配对。无法满足窗口时停止，不截断证据。原始历史仍归引擎，宿主 checkpoint 不修改引擎会话。此策略追求安全上界，不能等同精确 tokenizer。
3. 每次请求携带当前宿主目标/计划快照，替换先前同类快照；不会让旧模型响应覆盖新目标。Pi 默认只向系统提示注入本轮点名的 Skill 描述，其他 Skills 使用已有 `skill_search` 和读取工具发现。扩展工具通过 `find_tools` 按需发现；Codex 通过原 MCP dispatcher 调用。
4. 工具执行前检查依赖、已知缺项、当前步骤及授权。缺项只阻断所声明步骤。可选 `cognition.conflictScopes` 将冲突关联到步骤；旧的未注明范围的冲突保守阻断全部步骤，不能擅自猜测影响范围。
5. 工具实际失败记录指纹，同一步初次失败后最多两次纠错；更小的非 stop 调整规则优先。只增加版本号不能清零重试次数。有效方法/输入/依赖调整经过同一合同校验；最终修复必须有真实成功回执。
6. 用户修订与模型重规划检查 expectedRevision。模型不能改用户目标、输入版本、事实、验收或扩大授权。宿主确认输入版本更新后，只使受影响步骤及依赖后继失效，独立已完成步骤保留。进行中的工具或计算必须先核对，不能以修订绕过它。
7. 同一已完成写操作不会重复执行；Pi SDK 无法替换工具执行结果时会阻断该重复调用并指向 status。未确认操作、在途计算阻止再次提交。读操作和 job 查询每次取新结果，不复用旧的 pending 状态。
8. `task_control complete` 必须引用实际成功回执；计算必须到真实 completed 终态，声明的项目文件必须存在且 SHA-256 验证通过。文件读取限额、realpath 和读取前后状态检查防止越界或变化。不把文本声明当成文件/计算结果，也不把技术成功当作科学有效。
9. 重启将执行中任务标为 interrupted、在途调用标为 unknown。恢复沿用原 grant、截止时间、请求/纠错计数、引擎/版本、模型/协议及回执；不重置预算。任务准备时间也计入截止时间，收紧时间限制会重置取消计时器。
10. 回执核对只查询原项目已有 M6 job/workflow、原账户 M5 task/request。M5 clientTaskId 必须匹配，结算未知不能重试供应商。取消只表示已发送停止信号；不会声称所有下游已结束。
11. 本地显式跨引擎交接要求原任务静止、回执已核对、预算尚存、目标方法可用及目标连接通过原兼容入口。部分写操作已执行但步骤未验收时拒绝交接，须先在原引擎核对。新任务保留已完成步骤/真实回执、原预算与来源，父任务终止为 handed_off；父子状态在同一数据库事务提交。原生会话历史不跨引擎复制；已交接父任务不能再次恢复或重复交接。
12. 项目指令仅从所选项目的 `AGENTS.md` / `.materialsx/AGENTS.md` 加载，必须有 read 授权、realpath 不越界且不超过限额。指令不能扩大权限、费用或验收。

Codex 的任意 composer 程序要求明确的宽范围 `engine.execute` 步骤。窄步骤支持单个 literal JSON 工具调用，例如 `text(await tools.mcp__materialsx__materials_science({"action":"get", ...}));`；实际 MCP 调用再次校验原工具及步骤。宿主不会冒充完整 JavaScript 静态分析器，也不会为满足模型输出放宽步骤权限。

## 验收与证据

- `npm run check`：源码大小、core / renderer / admin 类型检查。
- `npm test`：245 项，244 通过、1 个真实 PostgreSQL 外部环境测试按原条件跳过；监督、上下文、版本、真实 SQLite 重启/事务回滚，以及原 M5/M6/UA.1 回归。
- `npm run ua3:engines`：真实 Pi 0.99.1 SDK、真实独立 Codex 0.160.0 App Server；模型响应为离线脚本 fixture。验证重复写入只执行一次、Pi 预算失败不触达 provider、原生窄步骤经真实 MCP 调用一次、原生步骤权限拦截。
- `npm run ua1:pi` / `npm run ua1:native`：原本地工具、隔离、历史、steer / cancel / MCP 的回归。
- `npm run build:desktop`；Electron `apps/desktop/ua3-ui-smoke.cjs` 通过真实入口验证回执核对不重提、unknown 恢复阻断及窄/宽布局；原 UA.1 UI smoke：Skills、模型、运行记录、设置、计划抽屉及全局主题不退化。
- 可复跑入口：`npm run ua3:verify`。引擎证据写入被忽略的 `runtime/agent/ua-3/engines.json`，不进入公开仓库。

上述测试没有调用真实收费模型、支付、下载大模型或改写 MOOS 数据。fixture 测试中 `intelligenceValidated=false`、`scientificValidation=false`；没有将它们包装成真实 LLM 自我修复成功率。

## 保留的边界

- M5 原任务回执可核对；**平台自动恢复/跨引擎续接仍关闭**，等待 UA.5 正式四组合与原任务计量合同，避免新建付费任务绕过旧预算。
- 如果原生进程断开且没有能关联到该调用的终态回执，仍显示 unknown 并阻止重提；不靠相似日志、模型声明或新调用推算“已经完成”。跨天 scheduler/process 恢复扩展归 UA.11。
- 用户项目编辑、MOOS 输入快照的产品入口、双语澄清/计划编辑、跨尺度科学验收和完整产物索引归 UA.4；本阶段提供同一合同的监督 API，并不另建研究状态模型。
- 原受管 RPSME PDF worker 保持原流程及校验，统一迁移归 UA.6。这里不宣称所有旧专用 worker 已纳入新监督。
- 没有重新打包公开安装程序，没有发布或提交 GitHub。Windows/Linux 与签名按 UA.14 验收。
