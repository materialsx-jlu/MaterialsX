# UA.1 扩展：本地模型与双引擎

日期：2026-10-05。工程接入已实现，兼容性按具体模型和平台验收；不等同于科研推理或科学准确性认证。

## 使用

1. 在 LM Studio 启动本地服务，并加载聊天模型。
2. MaterialsX 设置 → 本地模型，填写 `http://localhost:1234/v1` 和实际模型 ID。
3. 执行引擎选择 Pi 或 Codex App Server。点击「检测引擎兼容性」，再保存设置。
4. 在项目内发送任务；运行记录 → 研究计划查看本轮模型、协议、引擎版本和研究合同。

Model source and execution engine are independent. Local Codex requires native Responses SSE and tool calls. A passing protocol probe is **limited**, not a guarantee of task quality. Unsupported configurations stop without cloud fallback, downloads or paid credits.

已验收平台为 macOS arm64。本机测试模型是 LM Studio 的 `openai/gpt-oss-20b`、MXFP4/MLX、加载窗口 131072。Pi 保留 Chat Completions；Codex 使用原生 `/v1/responses`。不伪装成 `gpt-5.6-sol`，不通过平台中转调用本地模型。仅支持 Chat Completions 的服务不能据此使用 Codex，四组合正式兼容矩阵归 UA.5。

## 实现与边界

| 责任 | 唯一实现 |
| --- | --- |
| 连接、兼容、选择、会话快照 | `contracts/src/engine-selection.ts`，原 WorkspaceStore 持久化 |
| 本地模型发现、加载窗口、版本身份、SSE | `agent/src/local-model-transport.ts`，复用原模型发现函数 |
| 原生函数、补丁、MCP namespace 转换 | `agent/src/codex-local-protocol.ts`；不执行工具、不重试 |
| 原生执行与历史恢复 | 原 `CodexEngine` / App Server；独立 MaterialsX CODEX_HOME |
| 本地科学工具与 Skill 读取 | 原 Pi 工具定义经 HostMcp 暴露；原 M6 dispatcher 和 worker 不复制 |
| 目标解释、权限与事件 | 原 DesktopAgentRuntime、ResearchGoalPlan、请求授权和回执 |
| 平台认证、请求与计量 | 原 M5；本地执行不调用它 |

连接身份包含端点、实际模型、协议、加载窗口及可取得的版本信息。兼容记录绑定引擎版本和 OS/架构；同一身份的探针最多缓存一天，未知版本不复用缓存。单次任务固定连接/引擎快照，只允许补充原生会话 ID；模型检测中发生变化会拒绝执行。旧设置缺引擎字段时仍默认 Pi；旧平台原生会话只在原账户/对话范围续接。

宿主不会另起工具循环，也不会让 Pi 执行 Codex 生成的工具。Codex 消费现有科学动作和指令型工具定义；已有 Skill 仍有调用者的命名工具保留，共用原 M6 后端，不复制算法或 worker。选势回执同时提供明确 `assessmentId` 与原 `id`，原调用者保持兼容。

原生 provider 有两种指令格式：composer 路径将指令放在 input 中，本地模型可能另带 instructions。转换器完整保留两者，指令也计入本地输入预算；不丢掉引擎基础行为。原生 MCP 的纯文本内容数组按顺序转换成字符串，不丢证据或状态；当前不支持的图片回执明确拒绝，不伪装成读过像素。

本地模型历史中的真实 `reasoning_text` 与非空推理摘要继续回传，只移除没有文本的网关加密占位。兼容探针第二轮携带第一轮的真实输出与工具回执，验证这一历史格式，而不是只拼造一个函数调用。

本地 Codex 通过固定 App Server 的公开 `baseInstructions` 参数使用共同的 MaterialsX 科研指令，Pi 也消费这份指令；Pi 的 PDF/文件执行说明继续由原适配提供。平台 Codex 保留已有基础配置。引擎提供的完整指令仍经过转换，不靠丢弃指令节省输入；不复制 Codex 默认编码助手的大段提示作为材料业务规则。

本地传输拒绝重定向、远程端点和嵌入凭据；不自动加载或下载未加载模型。使用实际加载窗口的保守 UTF-8 字节预算，超限停止，不截断证据。流中断、空输出、模型身份不符、未知工具、解释阶段调用工具和截断终态均报错。用量缺失保持未知，不造 Token 数或积分流水。

原生执行统一最多 32 次请求，并受本轮时间上限约束；不再将未付费的本地任务限制为 8 次。可选 `interaction=null` 与未指定语义一致，必填域/模式/任务 ID 不自动补全。执行动作必须与选势时冻结的域、模式和相互作用要求一致；同一桥内同一 assessment/势的重复或并发提交复用实际任务。跨重启和重新选势后的幂等协调仍归 UA.3。

macOS 外层沙箱只开放本轮宿主代理/MCP 的 loopback 端口，拒绝其他本机服务、外网、项目外用户文件及常见凭据文件。子进程显式使用 loopback `NO_PROXY`，避免系统代理绕路；不修改系统代理。Pi 仍声明 `sandbox=none`，不能把引擎层权限检查当成 OS 隔离。

取消覆盖准备阶段、上游请求、原生 turn 和受管 MCP 科学任务；历史恢复使用同一原生线程，不能据此承诺任意中断计算幂等恢复。步骤纠错、重规划和跨引擎交接归 UA.3，完整产物/证据验收归 UA.4。

安装包继续使用 MaterialsX 独立的公开 Codex 0.160.0 资源，详见 [独立分发](codex-independent-package.md)。本轮更新开发代码，不更新公开安装包。

## Skill 范围

本轮接入已安装指令型 Skills、材料目录工具和已有结构计算。`read_skill` 返回真实文本与 SHA-256，仅接受内置、用户明确安装和本项目 Skill 目录；不读取用户其他 Agent 的全局目录，拒绝越界符号链接。指令不能扩大权限，也不授予模型安装资格。

大 Skill 可指定 `startLine/endLine` 分段读取，回执标明实际行范围、全文行数和 `partial`，SHA-256 始终对应完整文件。片段读取不表示已读全部流程，依赖后续章节时仍需继续读取。

原受管 `materials-literature-rpsme-json` PDF 流程继续使用 Pi。Codex 会明确提示此能力尚未迁移，不静默切换引擎或模拟产物；按 UA.6 接入共同后端。并非所有 Skills 的脚本都能在原生沙箱内直接运行。

## 验收

工程检查与真实生成分别记录。协议探针只请求一次无副作用函数、返回随机文本，再检查模型是否准确读回；不执行模型提交的命令。真实文件测试必须检查磁盘修改，科学测试必须检查终态和每个产物的 SHA-256。

实测发现 gpt-oss-20b 多步任务仍有参数误传与截断，保留 limited 状态；没有放宽科学资格、使用模型文字替代产物或自动切换模型。首次真实 CHGNet 单点运行完成并返回实际结构/结果；后续重复验收不保证同样成功，正式稳定性与科学准确性继续独立验证。完整结果以本机报告为准。

2026-10-05 本机完整验收已通过：

| 检查 | 结果与限制 |
| --- | --- |
| 真实本地 Codex 文件执行 | 读取→实际 apply_patch→终端验证；磁盘内容与 SHA-256 核对通过 |
| 历史续接 | 原生线程 ID 保持一致，继续读取且未再次修改文件 |
| 共享 Skill 与科学工具 | 分段读取单点 Skill、实际资格筛选、一次 CHGNet 0.3.0 计算、终态查询；8 原子硅，能量约 -42.49744 eV；4 个产物逐一验真 |
| 真实取消和补充指令 | 本地响应进行中，原生 steer/interrupt 及上游取消通过 |
| 同模型 Pi | Chat Completions 实际写入新文件并读取核对，既有文件未改变 |
| 原生权限隔离 | 固定真实二进制、协议 fixture 驱动；项目外、凭据、外网及无关本机端口拒绝；不计为真实模型推理验收 |
| 桌面与回归 | 双语设置、模型/引擎独立、持久化、全局主题及 820/1600 宽度检查通过；M5/M6/Pi 回归通过 |
| 自动检查 | 类型检查与 Go 测试通过；216 项测试中 215 通过、1 项既有跳过；462 个自有代码文件，最大 586 行 |

上述科学任务使用限定输入与明确任务方法，验证执行链和真实产物，不证明任意自然语言需求的自动选势或科学精度。复杂任务理解保留集的旧结果仍为 41/60 合同通过，不因本轮最小闭环改写。

重复实测还出现过没有开始科学任务的参数误传，以及后台计算完成但模型最终文字异常的情况。统一 Skill 的 `select→singlepoint→get` 是当前验收路径；旧命名工具仍为已有调用者保留。报告中的 `passed` 表示执行与文件断言通过，不表示回答质量已评审；可读交付与逐项科学验收继续归 UA.4，稳定纠错归 UA.3。

```bash
npm run check
npm test
npm run control-plane:test
npm run ua1:native        # 原生工具/隔离/续接/取消；生成端为协议 fixture
npm run ua1:pi            # Pi 既有路径与持久化回归；生成端为 fixture
npm run m6:pi:automation:test
npm run ua1:ui
npm run ua1:local-codex   # 真实本地生成；需提前加载模型与已安装材料势
```

本地报告在忽略目录 `runtime/agent/ua-1-extension/local-live.json`；包含实际模型身份、耗时、文件哈希、真实科学结果与工具记录。后续每次验收也按时间保存独立报告，失败记录不覆盖既有成功证据。测试临时项目在结束后移除，无新模型下载、真实支付或云端请求。报告失败不能计为通过，故障后的修复需重新验收。

清理了旧的本地模式禁用 Codex 判断和错误的流事件转换，科研指令抽取为共享实现。保留有实际 Pi/旧平台调用者的兼容工具与线程引用，不删除用户项目、模型权重或有效业务。所有自有代码文件由 `source:size` 检查，最多 600 行。
