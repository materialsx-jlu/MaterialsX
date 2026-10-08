# MaterialsX 材料流程 Skills 与默认论文检索实施规范

版本：2.1 · 日期：2026-10-05 · 统一计划技术附件  
状态：规划，尚未开发  
主计划：[统一开发计划](../UNIFIED_AGENT_DEVELOPMENT_PLAN.md)  
对应阶段：UA.1 底座、UA.4 材料入口/MOOS 消费、UA.6 外部论文、UA.7 科学检查；旧 LA/RA 编号仅为追踪参考  
版权：© 2026 吉林大学 AI-DAOS 团队

本附件维护论文/流程合同，不独立排期或记录完成状态；原 LA/RA 的依赖和编号以统一计划映射为准，不再据此另建服务、缓存、任务状态或工具注册。

## 1. 产品结构

```text
MaterialsX 聊天 / 项目 / Skills / 文献库 / 产物与 3D
                         ↓
Codex 公开本地 Agent runtime（优先） / Pi 本地兼容
                         ↓
基础工具：终端、文件、补丁、计划、状态与恢复
                         ↓
材料 Skills：研究入口 + 文献/数据/计算/候选/实验计划/报告
                         ↓
领域工具与 MCP：MOOS 优先材料数据 + paper_search + 证据抽取 + 材料计算
                         ↓
研究项目/样品/条件/版本 + 真实产物、引用证据与科学资格检查
```

Codex 负责通用本地执行底座；模型在底座提供的上下文、指令与工具中理解任务。Skills 负责材料研究方法和编排，程序负责真实工具、环境、身份、权限与验证。两者缺一不可。

App Server/SDK 集成先固定公开版本与可用接口；原生 exec/patch 已由 Codex 执行时只关联状态与回执，不能再执行一次。领域工具优先通过 MCP 接入。Pi 从相同 ResearchService 和科学后端导出函数工具，保留现有本地模型能力。

MOOS 连接两种引擎均实际走 MCP：Codex 使用领域 MCP 入口，Pi 如需函数工具封装则委托同一 McpManager/client，不改成直接读取 MOOS 数据库或目录。MOOS adapter 是数据接口，ResearchService 是外部论文服务，DataSourceRouter 负责来源选择；职责和缓存不混为一套全文库。

相关合同见 [MOOS MCP 规范](MOOS_MCP_SERVICE_PLAN.md)，对象、科学检查、模块所有权及实施顺序见 [统一开发计划](../UNIFIED_AGENT_DEVELOPMENT_PLAN.md)。

## 2. 研究搜索来源与边界

| 来源 | 首版定位 | 使用边界 |
| --- | --- | --- |
| MOOS MCP | 已归集实验、配方、工艺、模拟、图片、性能及已有论文/专利证据的优先来源 | 已入库/授权/实际可读；保留 generation、条件与复核，不默认等于科学真值 |
| arXiv 官方 API | 默认启用的外部论文发现源 | 相关学科预印本；不覆盖全部期刊或全网资料 |
| arXiv PDF/版本页 | 按任务下载/阅读 | 本机缓存、真实版本与页码；许可逐篇处理 |
| Crossref | DOI/期刊元数据补充适配 | 补身份与出版关系，不保证全文或同行评审状态 |
| 用户本地论文 | 直接导入阅读与抽取 | 记录本机输入身份、按授权处理 |
| 通用网页搜索 | 补代码、官方说明与其他线索 | 网页结果不等于已经取得并阅读论文 |
| 其他学术源 | 后续可插拔 provider | API、配额、访问权与覆盖范围分别验收 |

arXiv 官方介绍说明其学科范围，也明确平台不进行同行评审。产品中统一称“arXiv 预印本”，存在 DOI/期刊关系时另列出版信息，不因提交到 arXiv 就标为同行评审通过。[官方介绍](https://info.arxiv.org/about/index.html)

Crossref 可补论文元数据和 DOI 身份，其公开 API 本身不是全文库。[Crossref API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)

默认安装意味着应用已经提供适配器、工具与 Skill，不要求用户另装 arXiv MCP 或提供模型 Key。联网搜索依赖网络；仅本地模式可以保持缓存检索，不能生成假在线结果。

材料分析先使用用户指定项目实测/文件，再通过 MOOS MCP 补材料数据；已归集证据不足、需要新论文或用户指定其他来源时补 arXiv/Crossref 等。服务失联、无匹配、缺条件、拒绝与元数据状态分别记录，并生成获取回执。权限拒绝不能通过外部调用绕过同一私有记录的访问控制。

## 3. ResearchService 与模块布局

建议新增：

- `packages/research/`：provider 接口、arXiv 适配、查询构建、论文身份、缓存/文献库、导出、全文/证据引用。
- `packages/contracts/src/research.ts`：版本化查询、论文、下载/阅读与导出合同。
- 领域 MCP 入口：从 ResearchService 导出工具，并映射项目/任务授权；使用独立命名空间避免与 Codex 原生工具冲突。
- Pi 工具桥：只包装同一服务，不再写第二套检索/下载逻辑。
- 桌面主进程服务：任务绑定、用户数据存储、下载和受管 PDF 处理；不能在 renderer 直接读私人文件或保存凭据。
- 论文卡片与文献库组件：复用当前 Skills 布局、全局主题和双语字段。
- `DataSourceRouter`：优先使用 MOOS MCP 或项目指定输入，记录覆盖与有理由回退；不复制 MOOS 检索后端。
- `ResearchProjectStore`：选定来源、样品/条件/版本、数据快照、分析依赖与决策；实际布局在 UA.0/UA.4 冻结，复用已有持久化。

代码位置在 UA.0/UA.6 固定，不强制使用新的独立进程；MCP 暴露和执行隔离以实际版本支持为准。已有 PDF 预处理、材料抽取与文件验收继续复用。

现有连接器列表中的 MCP 标识不是传输与调用已实现的证据；UA.1 必须实测所固定版本的能力交换、工具发现、参数、调用、取消及身份映射，不把“目录里有 MCP”写成“默认可运行”。

## 4. 默认工具合同

| 工具 | 输入 | 输出 | 约束 |
| --- | --- | --- | --- |
| paper_search | 问题/关键词、来源、时间、类别、作者、排序、分页 | 查询回执、有限论文摘要、来源/缓存时间与继续检索入口 | 首版默认 arXiv，单次默认 10 条、最大 50 条 |
| paper_get | 服务返回的稳定 paperId 或经过校验的 arXiv ID | 元数据、版本、DOI/期刊关系、原文链接与已读状态 | 不接受模型随意编造的内部身份 |
| paper_fetch | paperId/版本、已有下载授权与字节上限 | 实际 PDF 文件、SHA、版本、大小/许可状态 | 不在检索时下载全部结果 |
| paper_read | 已获取的论文身份、页范围/阅读方式 | 页面/段落/图证据引用、覆盖页数、缺页与文本摘要 | 元数据、部分全文和完整读取分开 |
| paper_export | 已选 paperIds、格式、项目内目标 | 真实 BibTeX/JSON/CSV/Markdown 文件和回执 | 字段缺失留空/unknown，不编 DOI、引用数或期刊 |

检索调用概念例子（实施时通过真实 schema 校验）：

```json
{
  "query": "通用机器学习势 晶体结构优化",
  "source": "arxiv",
  "dateFrom": "2026-04-05",
  "dateTo": "2026-10-05",
  "dateField": "first_submitted",
  "sort": "newest",
  "limit": 10,
  "locale": "zh"
}
```

工具结果至少包括：`queryId/provider/queryOriginal/queryExecuted/fetchedAt/cacheAsOf/stale/totalProviderMatches/nextPage/items`。每篇包含 `paperId/arxivId/version/titleOriginal/authors/abstractOriginal/publishedAt/updatedAt/categories/doi/journalRef/abstractUrl/pdfUrl/readingStatus/sourceEvidence`。

原始文本与中文翻译分别保存；翻译由模型生成时标注生成来源/版本，不盖掉作者原标题与摘要。arXiv 没有返回引用次数等字段时使用 unknown。`totalProviderMatches` 是上游匹配数，不冒充人工筛选后的相关论文总数。

日期用 UTC 请求，UI 展示本地时区和字段含义。“最新发表/提交”与“最近版本更新”分开；默认 newest 用首次提交时间，更新排序明确标“最近更新”。API 无法原生过滤的条件在有界候选内处理，并说明筛选范围。

## 5. arXiv API 接入方式

使用官方 `https://export.arxiv.org/api/query`，解析 Atom XML。构造标题/摘要/作者/类别及布尔查询，支持分页与排序。`all:` 搜索 API 的元数据字段，不代表搜索全部 PDF 正文。上游 ID 的最新或固定版本分别通过对应身份查询。[API 手册](https://info.arxiv.org/help/api/user-manual.html)

中文任务先保存原问题，再用材料术语词表和有预算的模型生成英文检索表达，例如“机器学习势 → machine learning interatomic potential”。别名扩展保留每条实际查询与合并结果；不能将所有词简单 AND 导致漏检，也不能默认只查一个材料类别。

建议材料相关类别词表从官方 taxonomy 固定：材料物理、软物质、化学物理、计算/机器学习等。类别筛选可选；用户没有指定时先广搜再分组，不把类别边界误当材料边界。[类别目录](https://arxiv.org/category_taxonomy)

查询计划初始最多 3 条表达、30 条候选，模型默认只读前 10 条精简结果；用户继续筛选或任务需要时分页。排序与相关性理由保存，不能声称覆盖所有论文或给出来源没有的影响力排名。

## 6. 限速、缓存与故障处理

官方对 legacy APIs 规定最多每 3 秒一个请求、同时一个连接，限制适用于受控机器整体。不能让多个子任务、worker 或服务实例各自并发规避。元数据与论文全文的许可不同，默认不在平台公共服务重新托管全文。[API 使用条款](https://info.arxiv.org/help/api/tou.html)

实现策略：

- 桌面同一服务实例及进程共享 arXiv 请求队列；平台代理所有自有实例采用共享限速。分布式或直接访问模式在发行前确认责任范围，不把新增机器当作提高配额手段。
- 同查询/页/排序/时间范围规范化缓存，合并正在进行的相同请求；按官方更新周期采用约一天缓存策略，显示 cacheAsOf。
- 强制刷新也经过相同限速；不因用户快速点击或多 Agent 搜索产生请求风暴。
- 429/暂时失败按 Retry-After 或有界退避，首次最多两次网络重试；停止任务取消排队与下载。
- 无网或来源失败时，可返回明确标记的旧缓存；不能把它显示为实时最新结果。
- 首版建议元数据缓存上限 200 MiB、PDF 默认总上限 1 GiB，均可配置；本任务成果与已引用的论文版本受保护，清理先预览。
- XML 解析禁止外部实体；下载校验允许来源、重定向、类型、长度、实际 PDF 头与 SHA，拒绝恶意链接和异常超大文件。
- 下载不是默认一次性整站抓取；若未来需要批量元数据，另行评估官方批量接口与许可/容量。

搜索关键字只包含任务所需公开主题，不上传私有配方、完整本地路径或凭据。平台代理明确其会收到检索词；云模型筛选与全文分析另外遵守已有数据授权。

## 7. 论文身份、版本与证据

元数据和全文状态：

```text
metadata_only → downloaded → partially_read → fully_read → evidence_extracted
                  ↘ failed / unavailable
```

每一步有实际回执。全文只读选定页面时保持 partially_read；图表需要实际图像/表格解析，不把全文文本存在等同于理解全部图片。

论文 canonical ID 与 version ID 分开，更新保存新版本，旧报告仍引用原版本、PDF SHA、页码/段落。DOI、标题/作者归并只生成候选关系；存在冲突不静默合并，预印本与出版版各保留来源。

保存原始观察和派生结论：作者报告的数值、工具计算、模型推断、研发假设分别标记。引用必须对应实际检索或读取记录；BibTeX 转义与字段校验，DOI/arXiv ID 不由语言模型“补齐”。

研究文献库首版提供：检索、来源/日期/类别过滤、收藏到项目、打开原文、下载/读取状态、版本、摘要与引用导出。所有列表、详情与卡片采用 Skills 一致样式，支持中文/英文、长标题、窄窗口与全局主题。

## 8. 默认材料流程 Skills

| 功能/建议 ID | 主要职责 | 复用后端 |
| --- | --- | --- |
| materials-research-workflow | 研发入口；理解目标、优先 MOOS 获取、建立阶段与完成条件 | 研究项目/任务状态、MCP 与已授权研究/材料工具 |
| materials-paper-search-review | 查询表达、相关性筛选、研究现状和可定位引用 | paper_search/get/read/export |
| materials-evidence-extraction | 抽取真实配方/工艺/结构/性能证据 | 既有 RPSME/XYZ 抽取与 PDF 流程 |
| materials-data-analysis | 条件化数据集、清洗、单位、统计、绘图与可复现分析 | MOOS/用户数据、已有科研 Skills、受管 Python、科学/文件验收 |
| materials-simulation-analysis | 选势、资格、单点/优化/已支持计算、结果解释 | 既有 M6 Skills、领域 MCP 与科学 worker |
| materials-candidate-design | 基于证据和约束生成候选，记录推断与不确定性 | 已有数据/优化工具；缺数据时只输出待验证候选 |
| materials-experiment-planning | 目标、变量、对照、测量、记录模板与可执行实验计划 | 已审核实验设计能力；不编造已完成实验 |
| materials-research-validation-report | 汇总证据、阶段、局限、真实成果与下一步 | CompletionValidator、ScientificQualityValidator、获取/运行回执 |

这些是功能模块建议，不要求重复创建已有同类 Skills。新入口可调用已有 materials-literature-rpsme-json、materials-xyz-extraction 和 M6 任务 Skills；具体 ID、来源及依赖在 UA.4 冻结。

每个默认模块具有中英文简介、1–2 个使用例子、输入/输出、工具/环境依赖、支持范围和验证记录。首版不将文献内容、Skill 正文或模型计划升格为运行权限。

## 9. 全流程 Skill 的阶段模型

建议主流程：

```text
研究问题/目标性能 → 论文与已有证据 → 数据/结构整理
→ 适用的方法与真实分析 → 待验证候选 → 实验计划
→ 输入实际验证数据 → 分析更新 → 报告与可复现包
```

这是研究组织方式，不是已确立的统一材料研发理论。任务可从中间阶段开始，已有数据不强制先重做全网检索。

每阶段状态为 `planned/running/completed/needs_input/unsupported/failed`，带输入引用、方法、实际工具回执、结果文件、科学质量与缺口。计划阶段可完成，但实验阶段没有真实测量时必须保持 needs_input；完整研发闭环不能仅靠生成计划就 completed。

研究状态最少包含：研究目标/材料体系、已有数据、约束、选定方法、论文版本与证据、真实分析结果、候选/假设、实验计划、实际验证、预算/授权、未解决问题和下一步。状态以结构化项目文件保存，并在模型上下文中只保留当前必要摘要。

UA.4 增加样品/批次/试样/观测、MOOS connection/source/experiment/generation 身份及快照，记录数据和分析的依赖。人工修改、来源更新、图片误配或结论撤回产生新版本；不覆盖旧报告，也不继续将失效数据用于当前推荐。初期不要求建设全量知识图谱。

## 10. 双语用户例子

### 例子 A：研究发现与计划

中文：

> @materials-research-workflow 我想研究通用机器学习势在氧化物晶体结构优化中的适用性。搜索近 6 个月的 arXiv 论文，按体系、训练数据和验证方法整理，保存文献表与有证据的研究计划。

English:

> @materials-research-workflow Investigate universal ML potentials for oxide crystal relaxation. Search arXiv papers from the past six months, compare material domains, training data and validation methods, and save a bibliography and evidence-based research plan.

系统执行真实检索与筛选，必要时读选定全文；摘要无法支持的字段标 unknown。实际产物：papers.json、references.bib、research-plan.md、查询/筛选回执。未提供结构与计算授权时不虚称已做结构优化。

### 例子 B：研究与真实计算

中文：

> 对本项目已经导入的周期晶体，检索合适的势模型论文，在已授权探索计算范围内选势并优化，展示真实能量/力、收敛状态和前后 3D；说明论文结论与本次结果的差别。

English:

> For the periodic crystal imported into this project, find relevant potential papers, select an eligible model and relax the structure within the approved exploratory scope. Show actual energy, forces, convergence and before/after 3D, separating published claims from this run.

只有现有科学适用条件通过时执行；模型权重/环境缺失走已审核安装与预算。论文推荐不能覆盖当前结构资格，运行成功也不证明独立精度通过。

### 例子 C：已有实验数据研发

中文：

> @materials-research-workflow 根据本项目的配方与性能 CSV，检查数据、分析趋势，并检索相关方法，提出 5 个待实验验证的配方候选和实验计划。

English:

> @materials-research-workflow Validate the formulation/property CSV in this project, analyze trends, search relevant methods, and propose five candidates with an experimental validation plan.

有真实 CSV 才能拟合/分析；候选明确为推断，计划与测量记录分开。不把 arXiv 无结果当作不存在相关配方研究。

## 11. 统一阶段中的检索与流程验收

| 子阶段 | 交付 | 最小验收 |
| --- | --- | --- |
| UA.1 | Codex runtime、领域桥、原生基础工具 | 文件修复、MCP fixture、科学工具与会话继续；论文实查在 UA.6 验收 |
| UA.6 元数据子集 | arXiv 元数据、查询、缓存、文献导出与卡片 | 不少于 20 个 fixtures + 3 个受限真实查询，核对 ID/日期/查询回执 |
| UA.4/UA.6 入口 | 研究入口与论文筛选 Skill | 两个中文/两个英文问题，保存真实项目快照/研究计划/文献表 |
| UA.6 全文子集 | PDF、版本、页证据、文献库、跨引擎恢复 | 3 篇可取得全文的固定论文，核对 SHA/页码/版本与导出 |
| UA.4/UA.7–UA.9 | 数据/计算/候选/实验计划/报告阶段恢复 | 既有材料样例的真实分析；缺实验/宏观工具时正确保留状态 |
| UA.5/UA.14 | 网关、安装包、同模型与研究回归 | 清洁安装、默认可用、授权/计量、离线/故障与平台矩阵 |

功能测试：分页、跨类别、旧式/新版 arXiv ID、版本、无 DOI、XML 错误、重复、零结果、翻译失败、PDF 无法取得、摘要与全文状态、引用导出。

可靠性测试：共享限速、同查询去重、取消排队、网络断开、旧缓存提示、下载途中崩溃、旧全文保护、恶意 URL、超大文件、论文中的注入指令。

科学/产品测试：事实与推断区分、不编引用、未知字段不补造、不适用势不强跑、实验记录不虚构、3D 对应实际结构、主题统一和长标题不溢出。

数据基准：同 ID/版本的元数据可定位率 100%；故障集中伪造引用与“摘要冒充全文”拦截率 100%。检索相关性以人工冻结题集评价并列出查询范围，不能用“搜到很多”当成覆盖率。性能区分队列等待、API、翻译、下载/解析和模型分析，不承诺所有请求毫秒完成。

建议新增 `research:contracts:check/research:fixtures:test/research:live:test/research:ui:smoke/materials:workflow:test`，均为未来命令。核心 fixtures 测试离线可跑；真实查询只做有界验证，不进行全站抓取。

## 12. 初版范围与后续扩展

首版范围：Codex 执行底座、arXiv 发现、本机论文阅读/证据、现有材料工具和研发入口 Skills。Crossref 身份补充可以随后接入；其他论文库/机构订阅、自动跟踪通知和大规模知识图谱不阻碍首个闭环。

统一计划增补：MOOS 优先材料数据入口和项目快照在 UA.4 交付；外部论文在 UA.6，原始数据处理/反馈/方法包/团队按统一阶段后续扩展。本表仅定位验收细节，不创建独立子阶段进度或另一份待办。

新增材料方法通过 Skills 和领域适配器扩展，公开论文新方法不会自动变成已经可运行的算法。默认 Skills 可指导创建/验证新脚本，但新的科学模型、外部数据访问和领域精度仍分别审核与验收。

M7 多尺度理论与预测平台保持原状态；新建全流程 Skill 不意味着微观到宏观模型和实际实验能力已齐备。
