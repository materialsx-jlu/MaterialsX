# UA.5：模型协议、M5 平台与基础工具

最新本地修复与回归见 [UA.1–UA.7 统一闭环记录](ua-closure.md)。以下保留本阶段当时的验收结果。

日期：2026-10-05。状态：工程功能已实现、内部预览；四种引擎/模型来源组合完成真实执行测试，复杂科研任务的模型资格仍受限。本轮未发布安装包或 GitHub Release。

## 使用入口

- **设置 → 本地模型**：选 Pi / Codex App Server，设置 Chat Completions / Responses、本轮上下文预算和输出上限。不设置协议时沿用旧默认：Pi 使用 Chat Completions，Codex 使用 Responses。预算不得超过实际加载窗口；更改预算或协议会形成新的模型连接身份。
- **设置 → 平台模型**：使用已有 M5 账户与网关，供应商 Key 仅在服务端。Pi 默认使用本轮批准的只读文件/Skill；可以选择提供项目工具授权。发送时仍须确认该项目的外发范围和积分上限。Codex 保留其既有项目操作确认。
- **数据与 MCP → 模型与引擎能力**：四种组合的历史检测记录、固定版本/协议/操作系统、窗口和检查项。记录不是实时连通保证，24 小时过期或预算改变需重新检查。未知图片能力不发送图片，不静默改用云端。
- **数据与 MCP → MOOS MCP**：选择已构建的 MCP 服务目录和本机后端地址、启用/关闭。修改要求当前没有执行中的任务，保存使用版本比较；旧版本、未构建服务和非本机地址会被拒绝。重启后读取保存配置；服务目录丢失显示离线，不阻止应用启动。
- **Skills → 我的 Skills**：导入中英文 JSON 指令草稿，先校验并显示预览，再由用户保存。现有 `skill_search`、`skill_draft`、版本/启用/删除与默认 Skills 继续复用。暂不运行导入包里的脚本、依赖安装或第三方 MCP 程序。

## 共用实现

| 部件 | 实现与职责 |
| --- | --- |
| 协议合同 | `model-request.ts` 校验工具历史配对；`model-stream.ts` 校验流、实际用量和工具身份；`chat-responses.ts` 仅转换线协议 |
| 本地入口 | `local-wire.ts` 冻结 loopback 路由、模型、协议、上下文和输出预算；Pi SDK 和 Codex 共用，不另建执行循环 |
| 原生工具适配 | `localCodexRequest` 同时服务本地和 M5，保留命名空间、真实 call ID、自定义语法工具；旧 composer 格式留薄兼容层 |
| 云端回执 | `assertPlatformReceipt` 校验请求/任务/模型/计费模式、冻结路由/价格，以及流用量与 M5 账本；仅结算明确且终态完整时继续工具 |
| 项目基础包 | `projectTools` 复用 Pi SDK 的 read/write/edit/ls/bash；终端采用现有 macOS 沙箱，Git 提供状态读取。Codex 原生 exec/patch 保留原执行器 |
| 工具发现与科学计算 | 继续使用 `hostRouter` / `find_tools` / `invoke_material_tool`、同一个 `TaskSupervisor` 与 M6 dispatcher；科学计算仍需独立授权 |
| 配置/目录 | ModelSettings、兼容矩阵、MCP 配置继续使用 WorkspaceStore 的同一 SQLite；没有新增配置数据库或计划数据库 |
| 计划修复 | 两个引擎最多一次合同修复；修复计入原请求/时间预算，不执行工具、不推断缺失科学事实；仍不合格即停止 |

普通项目可用 read、ls、write、edit、隔离 bash 和 git_status。搜索还可通过现有 find/grep 或终端中的受控命令完成；不是引入另一套终端、Git 客户端或 Agent。当前平台终端只开放已验收的 macOS 项目隔离，不读取用户 shell 配置，不继承供应商密钥，不开放联网、安装软件、额外目录和科学计算脚本。

流式显示仍可立即呈现文本与参数片段，但**工具提交事件和最终完成事件要等整个流校验通过**。云端进一步等待 M5 回执。校验以真正的 `call_id` 和 JSON 参数为准，允许中转站改写非执行身份的输出项 ID、调整 JSON 键顺序；不允许修改工具名、call ID、参数或已展示的回答。

未知 usage 保持未知。HTTP 失败、断流、空消息、截断、重复调用 ID、孤立工具结果、畸形参数、未开放工具、模型卸载、窗口超限、回执身份/用量不一致均不会生成假成功或隐式模型回退。错误原生调用也查询已有 M5 请求记录，避免丢失待核对费用。

## 实际验收

固定依赖：Pi `0.99.1`（MIT）、Codex `0.160.0`（Apache-2.0）、MCP SDK `1.31.0`（MIT）。Codex 运行时从 MaterialsX 自己的依赖/安装资源加载，不使用其他软件安装的 Codex。详见根第三方清单和打包 hooks。

| 组合 | 真实测试结果 | 范围 |
| --- | --- | --- |
| 本地 Pi + Chat Completions | 通过，约 32 秒，5 次模型请求 | gpt-oss-20b；实际读、编辑、读取核对项目文件；共用监督记录 |
| 本地 Pi + Responses | 通过，约 30 秒，6 次模型请求 | 同一固定模型与文件验收 |
| 本地 Codex + Chat Completions 转换 | 通过，约 18 秒，4 次请求 | 内置 App Server；真实终端、apply_patch、文件核对 |
| 本地 Codex + Responses | 通过，约 18 秒，4 次请求 | 同上，原生 Responses 路径 |
| 平台 Pi + Responses | 通过，约 19–44 秒，2 次请求 | 真实 RootFlowAI `gpt-5.6-sol`、M5、账户、文件工具、终态与实际用量 |
| 平台 Codex + Responses | 曾通过，约 66 秒，4 次请求 | 内置 App Server、HostMcp、同一真实 M5 任务与逐请求用量 |
| 平台两引擎取消 | 本机中止通过 | 在服务端已记录 dispatched 后取消，execution=unknown、settlement=reconciliation_pending；未宣称上游停止计算或免费 |

**重复云端测试限制**：最后一次 Codex 测试在 120 秒原预算内未取得完整响应，停止并记录中断/待核对，未自动提高预算或重试。已有成功回执证明接入路径可工作，但不足以宣称供应商稳定或正式生产合格；云端组合继续标为受限，成功与失败的版本化报告均保留。

本地验证模型为 `openai/gpt-oss-20b`，加载窗口 `131072`。文件测试输出预算 `1600`；目标合同测试 `3200`。这些是该次环境设置，不是所有同名模型的能力保证。

30 个固定中英文目标案例共 **26/30 合同有效**（UA.4 为 19/30）。未通过：UA-G13、UA-G16、UA-G20、UA-G21；修复仍不合格时不会执行工具。该数字只代表结构/权限/目标保存等宿主检查，专家语义与科研准确性仍未验收，不等于 26 个科研任务完成。

真实云测试使用独立临时 PostgreSQL 数据库与合成文本；不读取 MOOS 私有来源、不写生产钱包、不产生支付订单。真实供应商调用会消耗采购额度；脚本从本机私有文件读取服务端测试密钥，报告不保存密钥。正常对外运行仍采用 M5 原价格、授权和积分政策。

内部证据（runtime 不进入公开仓库）：

- `runtime/agent/ua-5/goals-local.json`：30 个目标合同、失败案例与专家待审状态。
- `runtime/agent/ua-5/local-live.json`：两引擎 × 两协议、真实文件断言和监督记录。
- `runtime/agent/ua-5/platform-live.json`：两引擎真实 M5 工具/用量回执。
- `runtime/agent/ua-5/platform-cancel.json`：发送后的本机取消与服务端待核对状态。
- `runtime/agent/ua-5/ui.json`：真实 Electron IPC、中英文、配置保存/版本冲突、820/1600 宽度。

工程回归包括 TypeScript/Vue、全局 600 行检查、267 项 Node 测试（266 通过、1 项既有跳过）、UA.3 两引擎监督、UA.1 Pi/原生隔离与取消恢复、带隔离 PostgreSQL 的 M5 全部 Go 测试和合同、M6/RPSME 既有 Node 测试、12 个默认 Skills 资源/脚本验收。

## 开发命令

```bash
npm run ua5:verify         # 工程回归与 UI；不调用真实模型/付费 API
npm run ua5:goals          # 固定真实本地模型的 30 个合同案例
npm run ua5:local-live     # 真实本地两引擎/两协议；合成项目文件
npm run ua5:platform-live  # 明确的真实供应商测试，读取本机私有配置
```

平台测试依赖本机开发 PostgreSQL 16、`runtime/m5-local/private-config.json` 和权限为 600 的 `runtime/m5-local/paid-cloud.json`。只使用隔离测试数据库；其他机器配置不完整时失败并保留限制，不能使用生产库替代。

## 保留的边界

- 全部组合按**受限**发布；协议和一条真实任务通过不代表复杂任务或科学质量合格。四个目标案例未通过及专家复核进入后续模型资格验收。
- 当前模型图片输入未验证，注册为文本能力并拒绝图片；本地结构/3D、图片产物显示继续由 M6/UA.4 管理。reasoning 文本和 token 计数的兼容不证明模型推理准确。
- Windows/Linux 的 Codex 项目沙箱未验收；Pi 平台终端也暂不开放这些 OS。已有本地 Pi 路径与历史默认保留，不静默改引擎。
- 云端暂停后的恢复/交接仍要求原 M5 回执核对，未开放自动重建付费任务；本地恢复继续保留原权限、协议、输入/输出预算、时限和真实回执。
- MOOS MCP 直接外发仍关闭。远程第三方 MCP、脚本包安装、作者收费和论文全文/环境修复按原后续阶段实施。
- 受管 RPSME 流程继续使用现有 Pi 路径；Codex 受管 PDF 工作流接入属 UA.6，不自动换引擎。

## 清理

移除原生引擎本地/云端的重复请求分支、本地独立 SSE 解析器和已经无效的 Codex `localProtocol` 执行选项。`ModelSettings.localProtocol` 仍用于实际传输选择，不能删除。真实与合成探针分别保存，历史会话 composer/模型版本解析保留必需薄层。没有新增研究计划状态机、材料求解器、Skill 注册器或生产账本。
