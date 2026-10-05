# MaterialsX Codex 能力基线与基础组件清单

版本：2.3 · 统一计划能力附件 · 日期：2026-10-05  
状态：能力规范；已有工程证据见 UA.0/UA.1，新增范围依主计划验收  
执行主计划：[统一开发计划](../UNIFIED_AGENT_DEVELOPMENT_PLAN.md)；技术附件：[材料流程与论文检索规范](RESEARCH_SKILLS_AND_PAPER_SEARCH_PLAN.md)、[MOOS MCP](MOOS_MCP_SERVICE_PLAN.md)  
版权：© 2026 吉林大学 AI-DAOS 团队

本文件只维护能力范围和验收参考，不独立排期/维护进度；表中的实施归属按统一计划 UA 阶段执行，不能另建重复工具/模块。

## 1. 验收目标与适用范围

MaterialsX 在更换模型后，仍使用同一套项目、文件、工具、Skills、MCP、权限、任务记忆和产物界面。使用经验证的 OpenAI API 模型时，应能完成通用文件/脚本/研究任务，包括执行、修改、检查报错、纠错、测试与恢复，再叠加现有材料工具。

最新架构采用共同科研宿主与可选择的 Pi / Codex App Server 引擎；模型来源与引擎解耦，本地模型也可选择经验证的 Codex 路径，Pi 也可使用云端模型。保留公开 Codex 的独立分发，优先复用引擎本机执行能力；材料方法通过共同 Skills/MCP 接入，paper_search 按 UA.6 开放。不要求先用 Pi 复刻所有 Codex 基础工具。唯一架构与模型兼容合同见主计划第 4.1、5.3 节，本附件不新增排期。

统一计划的科研预览增加 MOOS MCP 优先材料数据、项目快照和科学检查。它们属于 MaterialsX 领域价值，按 UA 验收；不把 UA 全部远期阶段塞入通用 Codex 底座对照，也不把目录条目当成可运行工具。

“对标 Codex”指本清单的可观测能力和同模型任务对照，不是仅比较回答文风，也不是承诺取得订阅产品所有模型、桌面插件或云服务。官方列出了 CLI、SDK、App Server 与 Skills 的公开来源，适合作为复用起点；每项内容仍需固定版本及核查许可。[公开组件说明](https://learn.chatgpt.com/docs/open-source)

P0 是完整基线必须实现；P1 是扩展能力，按发行范围验收；P2 是独立后续产品范围。P0 未完成时只能发布有限预览，不能宣称达到完整基线。

## 2. 基础工具矩阵

下列是 MaterialsX 的规范工具名建议，部分用于表达语义；不声称与所有 Codex 版本的实际工具名一致。上游工具只有经协议适配和本机执行器实现后才能注册为可用。

| 能力 | 建议工具/接口 | 优先级 | 关键验收 | 实施阶段 |
| --- | --- | --- | --- | --- |
| 文件浏览 | list_directory/find_files | P0 | 分页、项目范围、中文路径、真实文件身份 | UA.1 |
| 文本检索 | search_text，底层优先 rg | P0 | 过滤、行号、结果上限、二进制排除 | UA.1 |
| 文件读取 | read_file/read_file_range | P0 | 编码、行范围、哈希、截断后继续读取 | UA.3/UA.1 |
| 文件写入 | write_file | P0 | 原子写入、允许范围、旧版本保留 | UA.3/UA.1 |
| 精确编辑 | edit_file/apply_patch | P0 | 前置内容校验、冲突、真实差异，不覆盖用户修改 | UA.1 |
| 终端执行 | exec_command | P0 | 受管 cwd/env、退出码、资源上限、执行回执 | UA.3/UA.1 |
| 长进程交互 | write_stdin/poll_execution/stop_execution | P0 | stdin、增量输出、进程树取消、unknown 查询 | UA.3/UA.1 |
| Git 检查 | git_status/git_diff | P0 | 显示真实变更，区分任务与原有修改 | UA.1 |
| Git 隔离 | create_worktree/check_changes | P1 | 隔离修改、冲突检查、快照与可恢复清理 | UA.1/UA.12 |
| Git 外部动作 | commit/push/PR adapter | P1 | 仅在请求或有效授权范围内写入/发布 | UA.1/UA.12 |
| 任务计划 | update_plan/task_status | P0 | 保留目标、完成条件、已执行步骤，简短任务无冗长计划 | UA.3/UA.3 |
| 用户补充 | request_user_input/steer_task | P0 | 缺少关键条件才询问，中途补充更新同一任务 | UA.3 |
| 任务记忆 | read_task_state/resume_task | P0 | 真实 IDs、输入身份、预算、未解决问题与恢复 | UA.3/UA.3/UA.3 |
| Skill 搜索/读取 | skill_search/read_skill | P0 | 按需加载、显式与隐式调用、中英匹配 | UA.5 |
| Skill 创建/安装 | skill_create/skill_validate/skill_install | P0 | 可检查草稿、来源、许可、依赖、固定版本 | UA.5 |
| 工具发现 | tool_search/tool_describe | P0 | 相关工具渐进加载，工具可用不等于已授权 | UA.3/UA.5 |
| MCP 管理 | mcp_list/mcp_health/mcp_call | P0 | 已验收传输、认证、重连、调用回执与作用域 | UA.5 |
| MOOS 材料数据 | moos_status/search/get_experiment/get_evidence 等 | P0（科研预览） | 实际 MCP、来源优先、六类数据、条件/版本/权利和真实回执 | UA.0–UA.4 |
| 研究项目与质量 | 项目状态/数据快照/科学检查 | P0（科研预览） | 样品/条件关联、引用、结果失效、技术/科学状态分开 | UA.4/UA.7 |
| 网页搜索 | web_search | P0 | 当前资料、URL/日期、外部传输范围与引用 | UA.6/UA.5 |
| 论文搜索 | paper_search/paper_get | P0 | 默认 arXiv、真实查询、论文身份、版本/日期与来源 | UA.6 |
| 论文阅读与导出 | paper_fetch/paper_read/paper_export | P0 | 本机 PDF、页码证据、阅读状态、BibTeX/JSON | UA.6 |
| 页面读取 | read_source | P0 | 网页作为数据、长度/类型限制、可定位证据 | UA.6 |
| 图像读取 | view_image | P0（API/视觉配置） | 实际像素输入、格式/大小、模型能力检查 | UA.5/UA.12 |
| 浏览器自动化 | browser_open/snapshot/act/screenshot | P1 | 可验证操作、隔离会话、登录/写入范围 | UA.12 |
| 数据执行 | 受管 Python/Notebook runner | P0 | 真正执行、环境身份、数值/单位与文件检查 | UA.3/UA.7/UA.5 |
| 文件与预览 | list_artifacts/open_artifact/preview | P0 | 真实路径/身份、CSV/图表/报告/3D 可打开 | UA.4/UA.7/UA.12 |
| 材料目录 | potential_search/potential_describe | P0 | checkpoint 与方法区分、证据、安装/适用状态 | UA.1/UA.3 |
| 材料计算 | 已有科学工具与受管工作流 | P0 | 真实资格、冻结配置、单点/优化/受支持 MD | UA.1/UA.7 |
| 子任务协作 | spawn_task/send_task_message/wait_task/cancel_task | P1 | 独立状态、父任务预算、隔离文件与结果复核 | UA.12 |
| 通用桌面控制 | computer-use adapter | P2 | 独立驱动、平台/权限/视觉验收 | 后续独立评估 |
| 跨设备/定时后台 | automation/remote-workspace | P2 | 调度、离线执行、凭据与通知策略 | 后续独立评估 |

### 2.1 工具执行共同要求

- Codex 原生基础工具直接由其 runtime 执行，MaterialsX 接入公开配置/事件与领域 MCP；Pi 使用兼容执行器。两者共用任务授权语义，不能要求同一调用在两个宿主重复运行。
- 提供结构化输入/输出，区分调用成功、任务完成和科学验证；长数组、日志、页面正文留在文件或可分页读取的资源中。
- 工具错误附原因和实际可用的下一步；重复参数错误由 TaskSupervisor 处理。
- 有副作用的操作核对幂等/执行回执，超时后先查询；不得重复启动计算或重复平台消费。
- 用户已经要求在项目内修改并测试时，低影响步骤自动推进；不为每个 read/bash 再次要求人工执行。
- 核实已有文件修改、符号链接、路径变化和跨项目身份；Git 回退只处理本任务变化。
- 图像传输、联网读取和外部写入在已授予范围内执行；客户端凭据不进入模型上下文。

### 2.2 通用函数与 API 原生工具

OpenAI API 的 shell 与 apply_patch 能提出命令或文件操作，MaterialsX 仍需负责本机执行和工具回执。[Shell](https://developers.openai.com/api/docs/guides/tools-shell)、[Apply Patch](https://developers.openai.com/api/docs/guides/tools-apply-patch)

实现分两层：

1. 共用本机执行语义：文件、进程、权限、回执、测试与产物。
2. 协议映射：Pi 函数工具、OpenAI 原生 item、Codex 引擎事件统一到任务状态与验收；Codex 自带执行器不再转发重复执行。

原生工具的支持范围、格式和可用模型要单独测试；不得把 API V4A、Codex 补丁文本和通用 JSON 编辑当成同一格式，也不得把 function-call 正常视为整个 API 协议完全支持。

## 3. 默认基础 Skills 包

默认安装的是通过验收的基础包，并附环境/工具依赖。原有材料包保留；相同功能先检查现有 Skill，避免无意义重复。以下是功能清单，最终 ID 与具体上游路径在 UA.5 固定。

| 基础 Skill/功能 | 来源策略 | 主要依赖 | 使用例子（中 / 英） |
| --- | --- | --- | --- |
| skill-creator | 公开上游候选，适配 MaterialsX | 文件/补丁、Skill 校验、受管脚本 | 把已经跑通的 CSV 分析流程保存为可复用 Skill。 / Turn this verified CSV analysis into a reusable skill. |
| skill-installer | 公开上游候选，适配安装宿主 | 固定来源获取、许可/依赖检查 | 从指定仓库安装这个 Skill，并检查依赖。 / Install this skill from the given repository and check its dependencies. |
| openai-docs | 公开上游候选，映射检索/MCP | 官方文档搜索与读取 | 核对当前接口的工具调用格式并修改项目示例。 / Verify the current tool-call format and update the project example. |
| 项目排错与脚本修复 | 优先复用适合的公开内容，必要时自研 | 终端、精确编辑、测试、Git diff | 修复这个数据处理脚本的报错，保留现有输入格式并验证。 / Fix this data-processing script while preserving its input format, then verify it. |
| 长任务执行计划 | 公开计划类候选或自研，避免重复通用提示 | 计划、任务状态、文件引用 | 根据需求建立开发计划，完成脚本并运行验收。 / Build an execution plan, implement the script, and run acceptance checks. |
| PDF 阅读与生成 | 审查公开 PDF Skill；复用材料预处理 | 受管 PDF 解析/渲染、OCR、view_image | 读取报告并核对第三页图表，输出带页码的摘要。 / Read the report, verify the chart on page 3, and produce a page-cited summary. |
| Word 文档 | 公开文档 Skill 候选，运行依赖另审 | 受管文档库、模板、渲染/格式检查 | 根据真实计算结果生成 Word 实验报告。 / Generate a Word experiment report from the verified calculation results. |
| 表格处理 | 公开表格 Skill 候选或既有科研包 | 受管表格库、公式/数据检查 | 检查 Excel 的缺失值与单位，生成统计表和图。 / Check missing values and units in the workbook, then create statistics and charts. |
| Notebook 与可复现分析 | 公开 Notebook 类候选 | 受管 Python、Notebook 读写/执行 | 将分析过程生成 Notebook 并实际运行全部单元。 / Create a notebook for this analysis and execute all cells. |
| 浏览器数据读取与验证 | 公开浏览器 Skill 候选 | 本机浏览器宿主、下载、截图 | 打开公开材料页面，读取表格并保留来源。 / Read the table from this public materials page and retain its source. |
| 科研数据分析 | 优先复用已有 K-Dense/自研包 | Python、绘图、单位与统计检查 | 分析应力应变 CSV，画图并说明拟合范围。 / Analyze the stress–strain CSV, plot it, and explain the fitting range. |
| 科学结果复核与报告 | 复用已有材料验收说明，必要时自研 | CompletionValidator、真实科学回执、报告/3D | 检查优化是否收敛，解释前后差异并导出结构。 / Check relaxation convergence, explain the changes, and export the structure. |
| 论文检索与筛选 | 自研 research Skill，复用现有文献能力 | 默认 paper_search、文献库、引用导出 | 搜索近一年机器学习势论文，按适用体系筛选并保存文献表。 / Find ML potential papers from the past year, screen by material domain, and save the bibliography. |
| 材料全流程研发入口 | 自研编排 Skill，调用现有专项模块 | 研究状态、论文证据、数据/科学工具与验收 | 从研究问题建立有证据的研发计划，自动完成支持的分析步骤。 / Build an evidence-based materials R&D plan and execute the supported analysis steps. |

这些名称中，公开上游候选表示审查目标，不表示已经复制、许可已通过或原版本可直接执行。官方文档展示了 Skill Creator、Skill Installer、OpenAI Docs 等能力，并链接到公开 Skills 仓库；具体文件以固定 commit 为准。[Skills 文档](https://learn.chatgpt.com/docs/build-skills)

### 3.1 包与来源记录

每项保存：上游 URL、commit、原始文件 hash、原始许可/版权、修改列表、工具映射、依赖锁、双语元数据、例子、运行平台、测试输入与产物。公开源码和发行依赖分别审核；不能因本机能看到文件就认为有再分发权。

候选来源：公开 `openai/skills`、公开 Codex 系统 Skills 源码、已有审核 K-Dense 包及团队授权内容。缺少明确许可或依赖宿主不可复制时，保留为待审，改为自研等价流程或选择可分发替代。

不要直接复制 `/Users/user/.codex/plugins/cache/` 或私人 Skill 目录到默认安装包。部分插件依赖 Codex 专有工具、服务、凭据或运行时，必须逐项适配；本机路径只用于识别现有行为。

### 3.2 Skill 扩展规范

- `SKILL.md` 前置 name/description，脚本、参考与资产按需组织；声明 appearance/invocation/dependency 元数据的文件要由 MaterialsX 实际解析支持。
- 名称和简介用于发现，正文在选中后读取；索引设独立预算，不能将大量 Skills 正文装入每一轮。
- 中英文介绍、1–2 个例子、复制到输入框、默认分类与全局主题沿用当前 Skills 页面。
- 实际工具/环境不存在时明确显示依赖缺失；自动发现 Skill 不等于自动安装依赖或获得执行授权。
- 已审核且选中的 Skill 作为任务指导，论文/网页/普通文件作为证据；两类内容不能混用。Skill 不提升权限，也不能覆盖用户明确要求。
- 创建 Skill 优先提炼经过验证的方法和关键约束，不堆叠泛化计划、万能提示词或无意义固定步骤。
- 默认包和用户包分别版本化；同名冲突显示来源并选择，不静默覆盖；撤回/禁用不损坏历史回执。
- Skill 安装脚本中的 Codex 路径、工具名和凭据方式映射到 MaterialsX，不把私人的 CODEX_HOME 当发行路径。

## 4. 执行引擎与复用选择

| 路线 | 定位 | 优点 | 必须验证 |
| --- | --- | --- | --- |
| 公开 Codex runtime + App Server adapter | 保留的正式引擎，本地/云端按组合实测准入 | 复用原生执行、基础工具、会话和审批机制 | 固定协议、本地端点/必要转换、M5 网关、领域 MCP、OS 隔离、分发与许可 |
| Pi + 共用领域后端 | 保留的正式引擎，本地/云端及旧会话适配 | 复用 SDK、多供应商接口和有效 LM Studio/M5/M6 工程 | 模型兼容、宿主权限、共同验收、会话恢复与性能 |
| Codex SDK adapter | 仅作技术参考，不另建第三条默认执行路线 | 程序化调用公开 Codex 能力 | 如需采用，先证明 App Server 缺口并记录替换方案，不叠加包装同一工具循环 |
| 只复制 Skills | 内容复用的一部分 | 复用工作流知识 | 无执行器、依赖和状态就不构成完整 Agent |

官方 SDK 可用于程序化任务；App Server 提供嵌入客户端接口。协议和实验字段按固定版本核实，不能从可见文档推定所有接口可稳定发行。[SDK](https://learn.chatgpt.com/docs/codex-sdk)、[App Server](https://learn.chatgpt.com/docs/app-server)

所有路线共用材料科学资格和产物验收。Codex 参考任务通过 MCP 等经验证接口获取同一材料工具，不能绕过它们直接给出模拟计算结论。

一次 task attempt 固定一个引擎；TaskSupervisor、协议代理和另一个引擎不能再次执行同一工具。模型来源、引擎版本、协议、OS、权限和验收配置共同决定准入，不能从“OpenAI 兼容”推断任何模型都能运行 Codex。[UA.1 扩展](../agent/ua-1-extension.md) 已接入本地 Responses + Codex；具体模型仍按实测 limited/unsupported 等状态准入，正式四组合矩阵归 UA.5。

跨引擎只交接经验证的研究目标、事实、计划和真实产物引用，新建独立原生会话；运行中先完成或取消并核对回执，不混用 thread ID 或重跑已完成计算。不静默回退到云端或另一引擎。UI 共用模型连接、引擎选择、兼容状态和全局主题。

已由 runtime 提供的任务理解支持、工具循环、终端、补丁和历史机制先直接集成，不再以大量自研通用 Skills 代替。MaterialsX 保留运行预算、领域资格、论文证据、收费网关和 UI；引擎不公开的内部能力明确作为限制，不假装通过事件即可控制全部行为。

默认发行仍然无 BYOK：平台 provider Key 服务端存储，客户端仅持 MaterialsX 凭据。第三方执行引擎若不能稳定走计量网关，就不放入默认收费路径；不能为了能力对标把供应商 Key 下发。

## 5. OpenAI 平台通道要求

当前平台普通会话没有通用 bash/write/patch 工具，接入强模型也会受限。升级必须同时修改客户端工具宿主、平台会话提示、版本化合同、服务端工具白名单、事件解析和用量处理。

完成口径：

1. 可用模型目录来自平台已配置路由；实际模型身份、来源与能力独立记录。
2. Responses 流式工具调用完整往返，不只解析正文；严格核对终态与工具 call_id。
3. 推理、图像、托管搜索、原生工具按实际支持声明；缺失能力明确显示。
4. 本机执行根据当前任务授权自动推进，不要求用户把命令复制到终端。
5. 云请求只带所需内容；文件/结构全文和图像按照已授予范围传输。
6. 主模型、升级模型、子任务与摘要请求都计入预算和平台账本；供应商托管工具另有费用时单独记录，不能以 Token 规则漏记成本。
7. stateful 不意味着历史免费或 Token 自动减少；以服务端用量和实测为准，状态过期有安全恢复路径。
8. 经中转的模型和原生能力分别探测；同名 model 参数不能证明与官方模型等价。

## 6. 固定验收任务

下面列出代表性任务，UA.0/UA.14 展开成版本化 60 案例，不能只凭“看起来能回答”通过。

| 编号 | 用户请求 | 必须出现的真实结果 |
| --- | --- | --- |
| C01 | 修复项目里报错的 CSV 清洗脚本，运行验证。 | 读取代码与报错、实际补丁、测试退出码、产物及差异 |
| C02 | 给已存在修改的脚本增加单位换算，保留我的修改。 | 不覆盖原有变更、正确单位、最小 diff 与验证 |
| C03 | 运行分析；若失败，定位并修正直到结果可用。 | 有界自动纠错、实际再运行，非“请手动执行” |
| C04 | 任务运行中补充：改用另一列数据，先别写报告。 | 当前计划更新、旧产物区分、修改后验证，不重复副作用 |
| C05 | 重启应用后继续上次分析。 | 恢复点、输入身份复验、已完成步骤不重复执行 |
| C06 | 把已跑通的流程做成默认可选的用户 Skill。 | 有效 SKILL.md、依赖声明、双语例子、实际验证 |
| C07 | 搜索方法的最新官方说明，按正确版本修改脚本。 | 真实检索/引用、版本判断、补丁和测试 |
| C08 | 读取 PDF 图表并导出带页码证据的数据。 | 实际页面/文本/图像读取，真实数据文件与证据 |
| C09 | 处理 Excel、画图并生成可打开的实验报告。 | 实际表格、图和报告文件；公式/单位/格式检查 |
| C10 | 为导入的晶体选势、优化并呈现前后 3D。 | 合格 checkpoint、真实 job、收敛状态、结构与 3D |
| C11 | 用短程势直接预测涂层耐候性。 | 识别不适用，说明缺少方法，不伪造科学结果 |
| C12 | 两个独立数据集并行分析，合并结果并核对。 | 隔离子任务、预算、输入身份、父任务真实验收 |
| C13 | 下载/依赖失败后恢复已审核环境。 | 官方/审核来源、受管修复、运行探针和身份检查 |
| C14 | 浏览公开页面取数据，截图核对来源。 | 实际页面操作、下载/截图与引用，符合授权范围 |
| C15 | 停止当前任务，保留已经完成的文件。 | 真实停止回执、保留产物、平台用量核对、无迟到续跑 |
| C16 | 搜索近 6 个月相关预印本，按体系比较并导出。 | arXiv 真实 ID/版本、查询时间、筛选与 BibTeX/JSON；缓存日期透明 |
| C17 | 根据论文组织材料研发流程，执行本机能做的分析。 | 阶段状态、事实/候选区分、真实分析文件与待实验记录 |
| C18 | 只搜索到摘要时，给出论文支持的具体实验数值。 | 不编造全文事实；请求/取得全文后逐页核对，或明确证据不足 |

主对照：相同 API 模型、服务来源、推理配置、数据、项目指令、工具权限、资源/费用上限、干净工作区；三次独立运行，保留失败。模型不等价或参考侧没有同样材料工具时只能另列参考，不能伪称公平对照。

UA.14 的总成功率、逐类别成功率、恢复率、Token/耗时目标与故障拦截要求是正式门槛。权限、假产物和副作用检查由代码实现，不因为参考引擎也犯错就允许放宽。

## 7. 不可由“复制 Skill”解决的依赖

以下只用于避免错误实施，不是扩大本轮交付范围：

- 终端/补丁、浏览器、MCP、持续状态与执行权限必须有程序实现。
- Codex 订阅登录与 OpenAI API 采购/模型访问是不同来源，不能复制登录凭据使用。
- Codex 专有桌面工具、插件托管与云能力不因采用 Skills 自动开放。
- 模型自身推理能力不能用更长 system prompt 或更多 Skill 数量替代。
- 科学模型适用范围、原始证据与真实结果必须继续验证，不能由强模型文字保证。

## 8. 实施与验收记录

后续每项基础组件记录 `planned / adapting / tested / bundled / blocked`，附具体版本、平台、许可证及测试回执。planned/tested 不能直接显示成“已默认安装可用”；只有完成清洁安装与依赖测试后才标记 bundled。

本文件是主计划的能力附件，不独立排期。模型/引擎解耦及本地 Codex 已按 UA.1 扩展实施，验收与限制由主计划及其交付记录维护；不能把本附件的目标清单当成已实现能力。
