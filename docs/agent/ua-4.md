# UA.4：研究数据、项目状态与真实交付

最新本地修复与回归见 [UA.1–UA.7 统一闭环记录](ua-closure.md)。以下保留本阶段当时的验收结果。

日期：2026-10-05。状态：内部预览工程已实现；主模型理解与复杂任务资格仍未通过。没有更新公开安装包、发布 Release 或提交 GitHub。

## 实现范围

首条研究路径共用 `ResearchGoalPlan`、`TaskSupervisor`、WorkspaceStore 的 SQLite、Pi/Codex 工具循环和既有 MCP 客户端。没有新建计划数据库、Agent 循环、统计计算器或 MOOS 镜像库。

| 模块 | 职责 |
|---|---|
| `packages/contracts/src/research-project.ts` | 项目、样品/来源关联、快照、冻结交付合同、获取回执与产物引用 |
| `packages/agent/src/data-source-router.ts` | 已选项目输入优先，再调用 MOOS；版本核对、证据读取、图片权利与哈希 |
| `packages/agent/src/research-delivery.ts` | 将真实来源呈现为 CSV、SVG、Markdown；单位/条件/证据/审核/容差/文件逐项检查 |
| `apps/desktop/main/research-store.ts` | 使用现有数据库存引用、不可变快照/回执和版本历史 |
| `apps/desktop/main/research-service.ts` | 同一数据服务接两个引擎，冻结每轮交付条件，绑定任务输入及证据 |
| `ResearchWorkspace.vue` / `ResearchPlanEditor.vue` | 中英页面、研究条件和样品、输入选定/撤回、修订、依赖进度与预览 |
| `ExecutionIdentity.vue` | 聊天和研究任务显示该次运行固定的模型、引擎版本、来源与协议，历史回答不跟随当前设置改标签 |
| `ResearchMessageArtifacts.vue` | 聊天里的真实产物卡片，按项目所有权及文件哈希读取；不把文字引用当成授权 |

工具只有 `research_data` 与 `research_delivery` 两个研究入口；都注册到既有 Pi 工具池，Codex 通过现有 HostMcp/hostRouter 使用相同定义与权限。工具按需发现、版本/依赖/预算/纠错与真实回执继续使用 UA.3。M6 的结构、3D、计算工具与界面保留；本阶段不新增模拟求解器。

新增默认 Skill `materials-research-workbench`，有中文/英文说明和两个双语示例，随现有 vendor/skills 资源进入安装包。12 个 MaterialsX 默认 Skills 内容完整性、发现、双语例子与已有脚本验收通过；这不等于该 Skill 对任意问题具备科学资格。

## 首版支持的任务

1. **条件比较**：选择 2–8 条真实观测，MOOS 原有比较规则决定可比性。保留原单位与条件，不平均、排名或推断因果。每个选定快照只有一条观测时，可以省略观测 ID，由宿主唯一确定；有多条观测时仍须明确选择。
2. **配方与工艺**：呈现已有来源的配方、成分、工艺、观测与证据；图片只通过 MOOS 签发资源读取，读前后重查版本/权利，预览和原图 SHA 分开。
3. **模拟缺项**：呈现论文/专利已报告的模拟声明与缺项；输出始终标明 `executionPerformed=false`，不声称复现或计算完成。

`chart.svg` 是原始记录的独立行概览，不是具有共享尺度的性能排名图。图内显示展示行数/总行数（最多 40 行）；表格和报告保留全部行。CSV 保留负数数值，对可能被电子表格执行的字符串加文本保护。`report.md` 记录行数据、来源版本/哈希、证据定位、冻结要求与文件检查。科学状态始终 `needs_review`。

`requireEvidence` 要求字段声明的 evidence IDs 都有读取回执；缺字段证据会阻断。`requireReviewed=true` 时，待审核记录不能通过。数值验收使用指定 property、**原单位**、条件对象 JSON 与绝对容差；不自动进行单位换算。允许限制在执行前确定，模型不能更改。必须的图片缺失不因“no-image”限制而被放行。

## 使用方式

先按 MOOS 项目自己的 README 启动其后端，并构建只读 MCP 服务。本开发仓默认探测同级 `../MOOS/services/materials-mcp`；其他电脑/安装版需设置：

```sh
export MATERIALSX_MOOS_MCP_DIRECTORY=/absolute/path/to/MOOS/services/materials-mcp
export MATERIALSX_MOOS_ORIGIN=http://127.0.0.1:8080
npm run dev
```

路径必须指向实际存在的 `dist/src/server.js`。MaterialsX 使用自己的 Electron/Node 进程启动 stdio MCP，不依赖电脑安装 Codex。不会启动 MOOS 数据库、执行迁移或改写论文数据。当前配置仅支持无凭据 loopback HTTP；远程身份/团队范围归 UA.13。

打开 **研究数据与交付** → 选择项目 → 设置材料、条件、样品及交付类型 → 选择来源版本。默认检索已审核记录；可明确勾选待审核。导入的项目 JSON 是用户提供的未审核输入，没有自动获得 MOOS 身份或证据资格。

项目 JSON 格式示例（不属于科学测量数据）：

```json
{"title":"我的项目输入","data":{"observations":[],"recipes":[],"processes":[]}}
```

然后使用默认 Skill 示例或在聊天输入研究任务。本地 Pi/Codex 可用同一研究工具；引擎与连接按 UA.1 实测准入。本阶段的 MOOS 入口**仅支持本地引擎**；平台不能自动取得或外发本地来源，命名 Skill 的平台请求在模型调用前拒绝。不要将只读本机能力理解成已经开放云端 MCP 外发。

任务页可修改目标/条件和补充缺项。选择“同步当前项目输入版本”时，使用宿主批准的新输入；撤回的步骤输入会成为缺项，不自动把新样品冒充旧样品。修订以预期版本检查，计划、执行记录和研究绑定在同一事务提交。保留已完成独立步骤；受影响步骤与后续产物失效。预算、原截止时间和请求计数不会重置。超时或未知操作不能直接恢复；需要按原回执核对或明确开启新任务。平台恢复继续归 UA.5。

来源当前 generation/审核状态变化时，版本检查产生 stale/denied 回执，相关产物标记失效。服务不可用、拒绝、无匹配和分页过滤分别显示；不伪造匹配、自动读旧版本或改从磁盘绕过图片权限。当前变化检测在检索/读取/手动检查时发生，不承诺后台持续监控。

## 验收证据与实际结果

以下报告在被忽略的 `runtime/agent/ua-4/`，包含本机来源引用，不能直接公开发布。

| 验收 | 结果与边界 |
|---|---|
| `npm run check` | 类型检查和 ≤600 行门槛通过；自有源码最大 586 行 |
| `npm test` | 254 项：253 通过、1 项原 PostgreSQL 环境测试跳过；全量回归，包含 UA.4 的作用域、版本/事务、冻结要求、来源更新、撤回、服务错误、篡改、缺图片、符号链接和独立步骤保留测试 |
| `npm run ua4:moos` → `moos.json` | 真实 MCP + 既有后端 + 实际文件；三类任务各中文/英文一组，共 6 组。比较与模拟缺项带限制通过；配方/合法图片均生成，但选定来源有配方字段缺证据，验收为 blocked。服务不降低标准 |
| `npm run ua4:ui` → `ui.json` | 实际 Electron IPC：项目优先检索、双语、暂停目标修订、820/1600 窗口、历史模型/引擎身份和全局 Codex 配色；隔离夹具，不计模型智能 |
| `npm run ua3:engines` | 真实 Pi SDK / MaterialsX 独立 Codex App Server 的原工具/监督回归；脚本模型不计理解能力 |
| `npm run skills:accept:materialsx` | 12/12 默认 Skill 资源/说明/例子/发现及已有脚本检查通过 |
| `npm run ua4:goals` → `goals-local.json` | 固定 `openai/gpt-oss-20b`，30 个真实解释/分解请求，中英交替；19/30 合同有效，11 个被拒绝。缺权限、无效依赖、缺字段和制造用户指标都被阻止。语义专家复核待完成；合同有效不等于理解正确 |
| `npm run ua4:agent-live` / `npm run ua4:agent-live -- --codex --en` → 版本化 `agent-live-*.json` | 同一真实本地模型 + MOOS：Pi 中文条件比较约 28.7 秒/2 次模型请求；独立 Codex App Server 英文条件比较约 92.9 秒/4 次请求，实际调用两次 research_data 和一次 research_delivery。两者生成 CSV、SVG、报告并带限制验收。早期两次 Pi 错误 ID/协议输出的失败保留在本机日志与独立任务数据库；不隐去失败率 |

固定模型的 30 案例结果不足以通过完整模型资格；真实 Agent 闭环目前只验证了 Pi 中文、Codex 英文条件比较子集，不能声称三个复杂研究场景均已自主理解、分解、纠错和完成。中文/英文六组后端验收不能冒充 LLM 全自动验收。后续按 UA.5 收敛模型/协议能力，再完成剩余真实引擎任务及专家语义复核；UA.7 扩展更复杂的单位、条件、科学方法与质量检查。

本阶段不调用付费 API、不外发 MOOS 内容、不下载新模型，也不提供科学精度保证。通用论文/PDF、arXiv 检索与隔离 worker 继续归 UA.6；长期任务/自动监控归 UA.11。
