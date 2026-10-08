# MOOS 材料数据 MCP 服务与 MaterialsX 接入规范

版本：1.2 · 统一计划技术附件  
日期：2026-10-05  
状态：UA.2 本机只读服务已实现；[真实运行与验收](../agent/ua-2.md)，UA.4 消费与 UA.13 远程授权待实施  
对应阶段：UA.0 调查、UA.2 服务、UA.4 消费；依赖 UA.1/UA.3 合同和执行基础  
版权：© 2026 吉林大学 AI-DAOS 团队

本文件只维护 MOOS 接口/资产/数据合同与验收细节，不独立排期或维护阶段状态。唯一执行入口为 [统一开发计划](../UNIFIED_AGENT_DEVELOPMENT_PLAN.md)，旧 RA/LA 提及只用于历史追踪，映射以主计划为准。

UA.2 已冻结 SDK 1.31.0 / MCP 2025-11-25，并在 MOOS `services/materials-mcp` 实现候选八工具；以下调查为原设计依据，当前运行边界以 UA.2 验收记录为准。原 API 的 precise 搜索会省略大部分详情，适配只补读当前页固定版本；没有改造上游集合分页策略。默认 verified，待审核需显式 include-unreviewed。尚未开放远程传输、桌面数据源路由或数据集导出。

## 1. 目标和系统责任

MOOS 负责归集论文/专利中的实验、配方、工艺、结构、表征图片、模拟与性能数据，以及来源、版本和复核。MaterialsX 通过 MCP 优先查询这些数据，组织项目证据、分析与计算，交付可复现结果。

MOOS 是优先数据源，不意味着其中每条记录都经过科学验证。材料数据检索优先级不等于论文学术质量排名。服务仅发布已入库且有权限的记录；目录中有 PDF/JSON 不等于已入库可检索。

首版只读。纠错先记录在 MaterialsX 项目，后续通过明确的审核接口提交 MOOS；不直接覆盖 MOOS 事实，不开放 SQL、任意文件读取、上传入库、采购、模拟执行、索引重建或审核批准工具。

## 2. 当前可复用基础与缺口

调查位置为本机 `/Users/user/Code/MOOS`，以下路径相对该仓库。路径用于开发定位，不是其他用户安装前提。README 和早期 architecture 文档包含历史描述；接口存在性以当前代码为准，运行可用性仍须 UA.0 实测。

| 静态调查依据 | 观察与实施影响 |
| --- | --- |
| `go-backend/internal/httpapi/api.go` | 已注册知识检索、实验、证据、图片、模拟、本体、资产等 HTTP 路由；可封装 MCP |
| `go-backend/internal/httpapi/knowledge_phase_zero.go` | GraphRAG 受功能开关、loopback/Host/同源检查限制；尚不能假定支持远程生产账号 |
| `go-backend/internal/httpapi/knowledge_phase_one.go` | 精确/混合检索、数值单位检查、2–8 条观测比较、绑定实验与 generation 的证据读取 |
| `go-backend/internal/httpapi/knowledge_phase_three.go` | 图片、模拟检索/读取/预览；图片、模拟需实验 ID 和 generation；内容缺失不自动补采 |
| `go-backend/internal/store/knowledge_phase_three.go` | 资产包含 SHA、可读状态、权利、再分发许可、关联复核；模拟声明读取不等于真实复算 |
| `go-backend/internal/store/rpsme_search.go` | 当前 v2 投影查询；过滤材料、配方、工艺、条件和审核状态，旧版本不作为当前结果重复返回 |
| `schemas/`、`python-backend/rpsme_ontology_v2/` | 可复用 RPSME 包与版本适配；不能只按“v2”字符串推定兼容 |
| 目标后端/脚本范围的 MCP 检索 | 未找到可确认已实现的材料数据 MCP server；需要新建并验收，不把现有 HTTP 当成 MCP |

尚未确认：当前服务地址/端口、开关与数据库健康、各字段覆盖率、可用图片/原始数据数量、生产身份体系、完整历史版本读取、增量通知与部署方式。UA.0 做脱敏能力报告；不读取或复制 `.env` 来生成公开文档。

现有部分目录实现先读取有限上限集合再分页。UA.0 测量规模与查询计划，增长场景按权限和索引在数据库内分页、过滤；不以每次扫描整个材料库实现“全量检索”。

## 3. 部署和传输

```text
MaterialsX Agent（Codex / Pi）
       ↓ MaterialsX McpManager + 凭据/权限/预算
MOOS MCP adapter（本机 stdio；远程可选 Streamable HTTP）
       ↓ 显式白名单、版本适配和结构化合同
MOOS Go 材料/知识 HTTP API
       ↓ 既有本体、复核、索引和资产访问层
MOOS PostgreSQL / 合法文件资产
```

1. 首发同机：MaterialsX 管理一个 stdio MCP 子进程，通过受控 loopback 请求 MOOS；MOOS API/数据库仍由 MOOS 管理，不由 MaterialsX 隐式启动数据库、迁移或导入文件。
2. 适配器优先采用锁版本的 TypeScript MCP SDK，与桌面宿主一致；建议源代码放 MOOS 的 `services/materials-mcp/`。UA.0 核实两端运行时与 SDK 后冻结实际目录与版本。
3. MaterialsX 注册连接器 `moos-materials`。其他电脑可配置自己的 MOOS 地址；本机绝对路径不得硬编码到安装包，未配置时显示“未连接”。不得将个人 MOOS 数据随开源安装包分发。
4. 远程连接另设部署门槛：Streamable HTTP、TLS、实际用户/项目授权、资产权限、Origin/Host 检查、凭据吊销和限流全部通过后开放。不会为适配 MCP 关闭现有 MOOS 同源门槛。
5. 固定两端都支持的 MCP 协议/SDK 版本，按该版本实现能力交换、发现、调用、分页、错误与取消。最新协议与旧版初始化/会话语义有差异，不照抄不同版本示例混用。[官方传输规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
6. stdio stdout 只用于协议，日志走 stderr 且脱敏。健康探测不触发 LLM、重索引或付费生成。适配器不自动调用 MOOS AI-search/深度探索，以免形成隐藏的第二层模型费用。

数据库连接凭据留在 MOOS 服务端。stdio 使用进程和本机访问边界；公开 HTTP 不能沿用本机预览的固定身份或信任客户端自报权限。只读是后端路由白名单和权限约束，不仅是 MCP annotation。

## 4. 最小工具合同

工具名为本计划候选名，UA.0 冻结为 v1。所有工具提供中英文标题/说明；工具名和标准字段稳定，原文及原始单位保持不变。发布初版 8 个工具，扩展工具按任务发现，避免每轮装载全部 schema。

| 工具 | 输入和输出 | HTTP 复用/缺口 |
| --- | --- | --- |
| `moos_status` | 可用能力、索引时间/覆盖、版本、连接与权限状态 | health + indexes/status + visual/status；缺少统一合同则新增只读能力端点 |
| `moos_search` | query、entityKinds、材料/组成/工艺/性能/条件过滤、reviewScope、cursor、limit；返回小型候选、匹配/缺项理由 | knowledge/search + rpsme/search，图片/模拟按 entityKinds 复用 media/simulations；过滤不能由 LLM 猜测 |
| `moos_get_experiment` | 类型化实验引用；返回配方、步骤、试样、观测、结构和证据引用 | knowledge/records/{id}?generation=…；按白名单字段投影 |
| `moos_get_evidence` | 实验引用 + evidenceId；返回原文、来源与页/表/图定位 | knowledge/evidence/{id}?experiment_id=…&generation=… |
| `moos_compare_observations` | 2–8 个实验版本/观测引用；返回条件差异、单位转换与可比性 | knowledge/compare；不能强行平均不可比观测 |
| `moos_search_assets` | 实验引用或 query + 模态过滤；返回图片/文件元数据和可用状态 | knowledge/media；若按实验过滤尚未支持，补只读服务端过滤 |
| `moos_read_asset` | 返回过的资产引用、preview/original；返回资源或可访问内容句柄 | 图片 metadata/preview、assets metadata/content；每次重查权限/SHA，不接受任意路径或 URL |
| `moos_get_simulation` | 实验引用 + studyId；返回软件/版本/模型/输入/结果/缺项与证据 | knowledge/simulations/{id}/{media}?generation=…；只读研究记录，不执行 |

UA.4 可增加 `moos_search_simulations` 和受限 `moos_export_dataset`，后者只导出用户选定的授权记录与 manifest，不导出全库。前端保存到项目由 MaterialsX 文件执行器完成，不让远端工具写任意本机目录。

配方和工艺首先随实验读取，不拆成丢失父记录/来源的独立事实。来源论文/专利元数据可按 sourceRef 再读取；没有稳定 ID 或入口时在 UA.0 列缺口，不虚构 API。

Resource URI 示例为拟定合同：`moos://{connectionId}/experiments/{experimentId}/generations/{generation}/evidence/{evidenceId}`。它是客户端/服务可解析的引用，不能直接作为文件系统路径。资产 URI 另含 assetId 与 SHA。正文分段读取，图片按需返回 MCP image/resource；大 CSV/轨迹使用受限内容获取，避免 base64 巨量文本进入上下文。[工具规范](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)、[资源规范](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)

认证令牌和带访问签名的下载 URL 留在服务/宿主解析层，不写入模型上下文、报告或公开日志。资源句柄由连接器校验来源和权限后获取；可本机读取不自动意味着可以外发给云模型或再分发，分别应用项目授权与资产权利。

## 5. 数据与证据合同

统一包至少包含以下字段；MOOS 不提供的字段为 unknown/null 并列出 missingFields，不能由模型补造。

| 字段组 | 最低要求 |
| --- | --- |
| 身份 | connectionId、sourceId、packageImportId、experimentId、generation；entityType/entityId；跨库 ID 不互换 |
| 契约 | providerSchemaVersion、adapterVersion、projectionVersion、snapshotId（如有）、retrievedAt、indexAsOf |
| 来源 | paper/patent/user_experiment/simulation 等类型，DOI/专利号（如有）、原文版本、页/表/图定位 |
| 数值 | 原值/原单位、归一值/单位、转换方法、含量基准、测试条件、重复数与不确定性（如有） |
| 事实类型 | reported/inherited/calculated/predicted/digitized/inferred/pending；映射保留原枚举和依据 |
| 质量 | 原 reviewStatus、字段证据、关联状态、已知缺口；独立科学验证状态不明则 unknown |
| 资产 | assetId、SHA、MIME、尺寸/字节、整图或面板区域、可读状态、rightsBasis、redistributionAllowed |
| 审计 | 原始响应 hash、查询回执、筛选原因、是否截断、来源变更/撤回状态 |

“已复核抽取”不能等同“已独立复现实验”。专利性能是来源报告，不自动视作本团队实测；claim、实施例、对比例分别记录。缺少重复数、误差条和测试标准时，不生成虚假的统计置信区间。

质量筛选默认选用 MOOS 中实际对应“已复核且当前有效”的状态，UA.0 固定映射。未复核记录可由用户选择纳入，并突出标记；搜索无足够合格数据时返回缺口，不静默降级为全库。状态映射不明确时 fail closed，报告无法确认审核状态。

历史 generation 是否可读取要实测；现有 current-only 接口可能返回 stale。MaterialsX 保存有权限的最小分析快照和 SHA，不假定旧 URI 永久可读。来源更新不覆盖已有分析；使用旧快照时显式标为历史，重新分析先确认新版本。

## 6. MOOS 优先的获取策略

材料数据任务顺序：**用户明确选定的本项目实测数据 → MOOS MCP → 受支持外部材料数据库/论文 → 用户补充**。项目实测是本次分析输入；新增外部材料数据优先查 MOOS。用户指定来源/文件时尊重指定，不强制改查 MOOS。

论文发现任务先查 MOOS 已有来源与证据，查新论文/补覆盖时走 UA.6 arXiv/Crossref 等。arXiv 仍为默认外部预印本入口。联网查询不能代替 MOOS 调用，也不能把网络摘要伪装为 MOOS 实验记录。

每次写出 DataAcquisitionReceipt：`requestedKinds / attemptedSources / selectedRefs / missingConstraints / fallbackReason / versions / coverage / authorizationScope`。

必须区分 no_match、insufficient_conditions、unauthorized、service_unavailable、stale_version 和 metadata_only。权限错误不尝试其他接口读取同一受限记录；服务未连接时可分析已授权快照，或检索其他来源，并明示未使用实时 MOOS。若用户要求只用 MOOS，则保持待连接/待补数据。

## 7. 增量、性能与空间预算

- 初始候选默认 10、最大 50；先返回摘要，读取选中实验/证据；比较最大 8 条。图片首轮最多 4 张预览，默认单张预览 ≤2 MiB，预算可配置并记录。
- HTTP 查询初始超时 10s、最多两次可重试网络错误恢复，整个获取任务有独立时间/调用预算；权限、版本与合同错误不当作网络错误重试。
- 缓存键包含连接、授权作用域、查询、合同/索引版本；详情绑定 generation/SHA。权限收窄或连接切换清理可读缓存；旧分析的审计身份可保留，内容访问和导出依然受当前权限约束。
- 前台调用检索 indexAsOf/状态；后台增量先采用受限轮询与源版本差异。服务已有变更游标才能使用；不存在就作为新增端点，不假称已支持推送。
- 索引由 MOOS 管理。MaterialsX 仅缓存选定结果，初始数据缓存 200 MiB、资产缓存 1 GiB，与 UA.6 文献缓存分项显示；项目产物不自动删除。禁止每个桌面端重复重嵌入全库。
- UA.0 固定小/中/增长数据集和设备，分开记录查询、下载、模型时间。温热精确查询 P95≤2s、温热混合查询 P95≤5s 是首版目标，不是当前实测；超时允许有说明的精确检索回退。
- 原文件和缩略图分开校验。图片不可读时仍可展示许可允许的元数据，不能生成替代图片当作论文证据。

## 8. MaterialsX 产品接入

连接设置提供“MOOS 材料数据”：服务地址/传输、连接测试、版本、可用能力、索引新鲜度、权限和缓存占用。凭据进入现有 vault；数据源认证不等于恢复云模型 BYOK。

研究工作台展示来源标签“MOOS”、实际复核状态、实验条件、证据按钮、图片与分析用数据集。支持中英文，原文可切换；复用 Skills/模型目录的组件、全局主题、宽度、抽屉和例子布局。禁止单独配色设置、内部阶段编号占据产品标题。

基础研究 Skill 在材料数据任务中先调用 moos_status/moos_search，读取被选中的详情与证据后分析。任务上下文只装载必要工具组和摘要，完整记录在项目状态中。连接权限允许的普通只读调用无需逐条再次确认；下载/外发按用户已有项目授权和预算处理。

## 9. 统一阶段的 MOOS 验收细节

| 阶段 | 交付 | 必须通过 |
| --- | --- | --- |
| UA.0 | 服务/开关与覆盖调查、字段/身份映射、MCP 版本/运行时冻结、脱敏 fixtures | 实验/配方/工艺/性能/图片/模拟六类逐项区分可用/缺失/不支持；权限、生成版本、单位合同清楚 |
| UA.2 | MOOS stdio MCP、八工具、白名单、错误、资源读取、服务启动指南 | 真实 MCP 发现/调用/取消；原始数据前后无修改；选定脱敏记录与 HTTP 原始响应逐字段核对 |
| UA.4 | MaterialsX 双引擎接入、MOOS 优先、缓存/增量、项目引用、工作台卡片、最小选定导出 | MOOS→证据→真实分析→文件/图片报告；重启与来源更新不串版本；无 MOOS 的安装仍能使用本地任务 |

不少于 30 个合同/故障 fixtures：单位与 wt%/vol% 不混；空/不完整查询；中文/英文别名；同 ID 不同连接；generation 更新；审核撤回；索引落后；图片面板缺失；内容/权利未知；预览 SHA 不匹配；模拟仅声明；跨项目拒绝；路径/URL 注入；权限撤销后缓存；服务断线；工具 stdout 污染；分页截断；取消后无重复调用。

真实验收至少 3 组端到端：①带条件性能比较；②配方/工艺与图片证据；③模拟声明/缺项与合法输入复用。每组至少运行中英文请求，核对生成文件、引用与数值；材料子类由实际已入库可用数据决定，不虚构指定样例存在。

公开 CI 使用合成/已授权数据，私人数据库内容、论文全文、专利图片和本机配置不提交仓库。登记每次查询和资产获取的回执；MOOS 自有索引/存储开销与 M5 模型 Token/计算费用分别显示，不重复计费。

## 10. 后续范围和实施入口

优先从 UA.0 开始，不要求先建团队后台或新数据库。服务端代码归 MOOS，消费/工作台代码归 MaterialsX，共用版本化 MCP/数据合同。两个仓库属于同一 UA 交付项，分别遵循仓库指令并产出验收记录，不各自建立第二份功能任务。

后续可接入提议纠错、审核回写、受限深度探索和团队权限；每项明确授权与费用。真实模拟继续走 M6/受支持后端，不因 MOOS 保存了一段模拟软件说明就自动获得执行资格。完整远程生产服务在 UA.13 权限门槛后交付。

上层阶段、模块责任、去重规则与唯一进度表均见 [统一开发计划](../UNIFIED_AGENT_DEVELOPMENT_PLAN.md)。
