---
name: materials-research-workbench
description: "Evidence-linked materials research using selected project inputs first, then MOOS MCP. Compare reported conditions, present recipes/processes with authorized images, or document simulation gaps. Generate real CSV/SVG/Markdown deliverables with frozen acceptance criteria."
license: AGPL-3.0-only
---
# 材料研究工作台 / Materials research workbench

使用当前引擎已经开放的 `research_data`、`research_delivery` 和 `task_control`。技能不赋予安装、外发、修改源数据或支付权限。不自行重造检索、统计或模拟工具。
Use only the advertised research tools, schemas and host grant. Do not invent retrieval, statistics or simulation tools.

1. 调用 `research_data`，`action=context`，读取项目条件、选定快照和执行前确定的交付要求。当前项目输入优先；缺匹配才用 `action=search` 从 MOOS 获取数据。默认 verified。只有用户明确同意时使用 include-unreviewed，并保留待复核状态。
2. 对搜索返回的真实 `ref` 使用 `action=select`。随后按 `snapshotId`、`section`、`offset` 和 `limit` 分页读取 `action=read` 的 observations、recipes、ingredients、processes、readEvidence、nodes。记录每条观测的原单位、条件、证据 ID 和来源版本；不要从名字猜 ID。
3. 条件比较：用户在研究项目中选 comparison；读取至少两个真实 observation IDs，调用 `research_delivery` 的 `snapshotIds` 与 `selections`。MOOS 原规则决定可比性。不可比时不平均、不排名、不推断因果。
4. 配方与工艺：用户选 recipe-process。`action=assets` 读取本实验图片元数据；只有明确可读且权利已知的图片，才把真实 mediaId 传给交付工具的 image。私有研究预览不意味着可公开发布或发送云模型。
5. 模拟缺项：用户选 simulation-gaps。读取 nodes 中真实 simulation_study ID，`action=simulation` 获取报告中的声明与缺项，交付时传 studies。该路径不执行模拟，缺文件/方法/参数应列出并请求补充，不能宣称复现成功。
6. `research_delivery` 写出真实 CSV、SVG 和 Markdown，返回哈希、逐项检查和 needs_review 科学状态。blocked 或缺回执不能声明完成。按 task_control 当前计划完成相应步骤，并引用真实产物路径；模型的文字不能更改冻结的交付条件。

Read context, search project-first, select returned refs, read bounded sections, then deliver actual source presentations. Preserve missing values. Respect host step dependencies and receipt IDs. Ask for missing critical inputs, while continuing independent ready steps.

## 科学检查与方法选择 / Scientific checks and method selection

若工具已开放，先调用 `research_quality` 检查选定的 snapshotIds：字段及结论必须回链真实 rowId、原字段和已读取证据；数量声明保留原单位。审核状态、来源哈希、测试条件、含量基准、重复记录和不确定性分别核对。不要把冲突值直接平均，也不要把字段回链称为科学验证。
数值分析使用 `research_methods` 的 assess，传入真实观测 ID；其硬条件决定可用方法。选择可用候选并说明理由，再调用 `research_method_run`。支持原值统计、固定线性拟合和按来源分组的训练/验证/测试。缺独立重复时不造标准误或误差条；验证只用训练数据拟合，报告训练均值基线及外推点。任意斜率不自动成为模量，拟合优度不等于预测精度。
结构试算的资格继续由 M6 检查，使用现有 `materials_science` 选势和执行。自定义脚本、模型一致性或可运行状态不能升级方法的科学身份。来源更正、撤回或权限撤销后，受影响结论失效；修订同一研究计划，不能重写旧结果或自动补造成成功。

Use the advertised quality and method tools to check owned original fields/evidence, assess hard eligibility, and record a reason before fixed analysis. Freeze source-grouped splits before fitting and report the training-only baseline and extrapolation. No arbitrary script or statistical fit grants material-law, causal, DFT or production validation. Source changes invalidate dependent results; preserve historical receipts and revise the same goal/plan contract.

- 对选定来源先做科学检查，再汇总相同单位、测试条件和含量基准的强度原值；独立重复不明确时不计算标准误。输出真实 JSON 和报告。
  Check selected sources, then summarize original strength values with matching units, conditions and composition bases. Omit standard error without identified independent replicates. Generate real JSON and a report.

## 使用例子 / Examples

- 在研究项目中选“条件比较”：比较 MOOS 中已审核的辐射制冷膜太阳反射率，保留厚度、测试条件和证据，输出表格、概览图和中文报告；条件不一致请说明。
  Compare reviewed MOOS solar-reflectance measurements, preserving thickness, test conditions and evidence. Generate a table, overview and English report; flag incompatible tests.
- 在研究项目中选“模拟缺项”：整理选定论文报告的模拟方法与输入缺项；不要执行模拟，也不要声称已复现。
  Document the reported simulation methods and missing inputs for selected records; do not run or claim reproduction.

## 公开论文补充 / Public paper supplementation

数据不足或用户明确要查询新论文时，使用同一引擎已开放的 `paper_search`（默认 local-first）。保留原始中文问题，并给出公开英文研究关键词；不得发送私有配方、路径、个人数据或密钥。MOOS 拒绝的同一私有记录不可用外网绕过。默认只复用已审核数据；用户明确同意后才选择 include-unreviewed。
选择工具返回的真实固定版本 ID；`paper_get` 可按 DOI 补充 Crossref 身份，不能据此声称同行评审。按需求 `paper_fetch` 下载一篇供本机研究的 PDF，再 `paper_read` 读取实际页码。每次最多 20 页，保留 PDF SHA、缺失文字和覆盖率。摘要/下载/部分文字阅读/全文文字阅读是不同状态，图片未审阅不能声明读懂图表。`paper_export` 写出真实 JSON/BibTeX/CSV/Markdown；科学证据抽取继续使用已有 RPSME/XYZ Skill，不重造解析器。

For public literature gaps use the advertised five paper tools, preserve the original question and public English query, pin versions, inspect real PDF pages and export actual files. Abstracts are metadata; text coverage does not imply image review or scientific verification. Missing dependencies: use `environment_check`; use `environment_repair` for fixed bundled dependencies, without another task/PDF read running. A damaged bundle cannot be repaired from arbitrary packages; request reinstall. Never run arbitrary pip against system Python.

- 查找最近一年机器学习势相关的 arXiv 论文，先检查项目和 MOOS，再补充公开来源。选择一篇相关论文，下载固定版本，读取前 5 页，输出 JSON 和 BibTeX；标出未读部分。
  Find recent arXiv interatomic-potential papers, checking project and MOOS first. Download a selected fixed version, read its first five pages and export JSON and BibTeX. Mark unread sections.
