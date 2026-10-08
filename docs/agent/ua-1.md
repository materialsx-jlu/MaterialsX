# UA.1：最小 Agent 底座与研究计划合同

最新本地修复与回归见 [UA.1–UA.7 统一闭环记录](ua-closure.md)。以下保留本阶段当时的验收结果。

更新：2026-10-05。状态：运行时、合同、桌面接入与本机工程验收已交付；真实模型解释的失败项和专家语义复核仍开放。使用者不应将这一阶段理解为已达到 Codex 的科研能力。

## 用户入口

设置 →「执行引擎」：默认 Pi；本地 LM Studio 与平台模型可分别选择引擎。本地 Codex 的 Responses 准入与真实验收见 [UA.1 扩展](ua-1-extension.md)，macOS 以外暂不可用。平台首次发送前确认本轮项目文件、终端操作及数据外发范围，供应商密钥仍只在服务端。主输入框在执行中可发送补充内容；Codex 与本地 Pi 使用各自原生 steer。平台 Pi 暂不支持持续输入，会明确报出能力限制。

运行记录 →「研究计划」查看本轮保存的原始请求、目标、约束、认知状态、执行步骤、调整规则和验收要求。窄窗、全屏和全局主题使用同一套样式。简单的解释/预览/搜索等请求保存单步合同，直接执行，不增加需求解释模型调用。复杂请求先解释、校验、保存，再交给原引擎执行。

已有 `@materials-literature-rpsme-json …pdf` 保留有效的受管抽取流程，以单步合同记录 JSON、中文摘要和校验报告；没有为迁移通用 Agent 重写 PDF 抽取器。后续 UA.6 再统一领域流程接入。

## 实现边界

| 责任 | 实现 | 复用关系 |
| --- | --- | --- |
| 引擎接口 | `packages/agent/src/engine.ts` | run / steer / cancel / resume 与真实 capability；不执行工具 |
| Codex | `codex-engine.ts`、`codex-rpc.ts` | 公开 npm `@openai/codex@0.160.0`、原生 app-server v2；原生执行终端、补丁和 MCP |
| Pi | `pi-engine.ts`、既有 local/platform session | 使用既有工具循环、会话存储、PDF 流程；本地 edit 纳入实际工具能力 |
| 目标与计划 | `contracts/src/research-goal.ts`、`research-planning.ts` | 一份版本化六部分 schema，主进程绑定真实任务、授权和快照；模型无权生成授权 |
| 身份与回执 | `contracts/src/agent.ts` | typed UUID、结构化错误、权限、EvidenceRef/ArtifactRef、任务完成与科学资格分开 |
| 科学动作 | `contracts/src/science-action.ts` | 从原科学桥抽取已有冻结定义，Pi/Codex 均调用原 ScienceBridge.execute |
| MCP | `mcp-client.ts`、`host-mcp.ts` | SDK 1.31.0，实际协议 2025-11-25；初始化/发现/调用/取消/重连，按批准能力开放 |
| M5 | 原 `PiPlatformSessionService.native`、Go gateway | 同一账户服务、任务预算、请求 IDs、实际用量/结算；不建立第二个账本 |
| 桌面 | `main/agent-runtime.ts`、`agent-messaging.ts` | 引擎选择、范围授权、流式文本、补充/取消、科学任务取消 |
| 存储 | 原 WorkspaceStore | 原数据库 app_meta 保存一次计划/线程引用和原有回执；无新任务数据库 |

M5 网关增加两个固定 schema 的 `agent_exec` / `agent_wait` Responses 函数。它们仅对 Codex 原生 composer 的 `functions.exec` / `functions.wait` 做协议映射，实际工具仍由本机原生引擎执行。Go 端继续拒绝未知工具或替换参数 schema。启用 Codex 时需使用本次代码构建的账户服务；旧服务会拒绝新协议工具。

供应商仍是既有平台 `materials-research` 路由。原生 Codex 使用 `gpt-5.6-sol` 模型提示以获得正确工具协议；线上的模型选择、价格、扣费以 M5 服务端为准，客户端不能改变供应商密钥或销售费率。

## 合同校验和缺项处理

保留用户完整原话，原样保存材料体系、数值/单位/条件与优先级解释。校验步骤依赖、循环、输入引用、实际方法、所需权限、预算和目标/计划版本。模型自拟数值、请求中未出现的单位、尚未取得的证据、无证据的已确认假设会被拒绝。主进程赋予的引用与文件/Skill 快照不能由模型替换。

明确声明的缺失必需文件，以及缺少组分密度的 wt%/vol% 换算，有最小主机检查。它不是全面的材料知识规则库。复杂计划有阻断缺项或冲突时保存计划并停止；依赖步骤级推进、补充后的计划修订、失败纠错与重算属于 UA.3，当前不伪装成已实现的监督系统。

执行结束使用 `completed_with_limitations` 与独立 `scientificStatus`。声明“已计算”必须经过原科学桥的真实终态/产物核验，不能用模型文本替代文件。此次只建立完成合同，不自动认证科学结论。

## 权限与运行时

Codex 子进程使用独立账户/会话的 CODEX_HOME、最小环境变量、临时本机网关和 MCP token；不继承供应商凭据。macOS 外层 sandbox 限定项目读写、独立运行时目录及必要系统运行库，阻止项目外用户文件、常见密钥文件和外部网络。原生 turn 使用 externalSandbox，以避免二重 macOS sandbox 的 EPERM；外层实际限制经过负向探针验证，失败时没有无隔离降级。

这些范围不是完整的恶意代码隔离产品保证。通用 Pi 本地模式保持既有本机权限行为，capability 标记 sandbox=none；其工具权限检查不能代替 OS 沙箱。Windows/Linux Codex 本轮未验收，明确不可用，不扩大权限继续执行。任意科学依赖安装与联网工具不是本阶段新增功能。

取消立即中断原引擎及其受管科学任务，平台取消/最终用量仍由原 M5 服务核对。原生线程可在进程重启后恢复历史；这不代表任意中断科学任务可幂等重跑，相关回执协调留到 UA.3。

## 实测结果

| 验收 | 结果 | 证据性质 |
| --- | --- | --- |
| 类型、源码大小、桌面/运营后台 | check 通过，所有自有代码文件 ≤600 行 | 静态与构建检查 |
| 原生 Codex | read/search/terminal、真实磁盘 patch、MCP、重启 resume、steer、cancel 通过 | 公共二进制真实执行，模型 Responses 为脚本；不证明模型自主推理 |
| 项目隔离 | 项目外读/写、`.env`、外部网络拒绝；项目内合法操作通过 | 实际 OS 沙箱负向测试 |
| 原生材料 MCP | 经原 ScienceBridge 实际 inspect 8 原子硅结构 | 原 M6 后端真实执行；不是新造的 ping 科学工具 |
| 本地 Pi | 工具未授权拒绝，批准后真实写文件，重启恢复历史通过 | Pi SDK 真执行，生成响应为脚本 |
| MCP | 固定版本发现、能力筛选、调用、取消、重连通过 | 本机双端 SDK fixture |
| M5 | 原生模式同一任务两次请求、真实回执准入；缺用量停止，不继续调用 | 服务协议 fixture；未发起真实付费供应商请求 |
| 原有科学流程 | Pi + Go validator + 真实已缓存 MACE FIRE 弛豫回归通过 | 本机真实计算，无新模型下载 |
| UI | 引擎选择、持久计划、六页面、浅色主题、820/1600 宽度通过 | 隔离 Electron 用户数据，0 次支付/下载/模型调用 |
| 真实模型需求解释 | 固定 gpt-oss-20b，30 案例 × 中英，60 次实际生成；41/60 合同通过 | 其余安全拒绝；专家语义与科学准确性待复核 |

本地解释测试使用 LM Studio `openai/gpt-oss-20b`、temperature=0、单次输出 1800、90 秒超时和生产解释/绑定函数，不把金标准答案放进模型提示。强化前一次测试为 48/60，通过输入引用等检查后为 41/60；以当前合同回放同一批真实提案仍为 41/60，不额外生成。失败包括字段不完整、擅自补单位、未知输入/方法、依赖/权限不一致。即使合同通过，也可能遗漏材料条件或误解优先级；预期缺项和实际缺项分别保留，不能将 68.3% 合同通过率当科研准确率。

工程测试与真实生成测试分开：脚本响应可验证调用链、权限、协议、回执和磁盘产物，不能用于宣布达到 Codex 的智能水平。未重跑 RootFlowAI 真实付费端到端测试；未构建签名安装包或在其他 OS 验收。

## 重现与后续

```bash
npm ci
npm run check
npm test
npm run control-plane:test
npm run ua1:native
npm run ua1:pi
npm run m6:pi:automation:test
npm run ua1:ui
# 需本机已加载固定模型；60 次模型生成，可能较慢
npm run ua1:goals
# 只回放上一步真实提案，不调用模型
npm run ua1:goals:replay
```

脱敏测试合同在 `fixtures/agent`；本机报告在忽略目录 `runtime/agent/ua-1/{native,pi-local,ui,goals-local,goal-replay}.json`，包含请求内容的报告不会发布。计划仍以统一开发计划为唯一阶段入口。UA.2 接 MOOS MCP，UA.3 增加监督/性能与版本化调整，UA.4 完成独立科学证据验收，UA.6 将材料管线作为 Skills 迁移到同一底座。

清理：删除主入口中已抽出的消息处理重复实现与未用导入；科学动作 schema、完成核验仅保留共享实现。删除 UA.0 隔离安装的重复 Codex 副本（约 322 MB），探针改用同一固定依赖。保留有现存调用者的兼容导出，不删有效材料业务或用户数据。

独立分发要求已落实：[MaterialsX 内置 Agent 打包与验收](codex-independent-package.md)。程序、composer host、rg、shell/库和上游通知均进入 MaterialsX 自有 Resources/agent-runtime/codex；原生产 node_modules 分发内容排除，不依赖全局 Codex。

技术决定见 [ADR-0002](adr-0002-native-engine-contract.md)。
