---
name: materials-tensile-analysis
description: "Analyze configured engineering tensile CSV/XLSX project records with saved fit intervals and exclusions. Create actual curves, statistics, evidence-linked reports and replay bundles through MaterialsX experiment tools."
license: AGPL-3.0-only
---
# 应力—应变分析 / Engineering tensile analysis

使用 `experiment_data` 与 `experiment_analyze`，沿用当前执行引擎、任务计划及权限。数据只在本机处理，不自动外发。
Use the advertised experiment tools through the current engine, task and grant. Inputs stay local.

1. `experiment_data` 的 `action=list` 返回本任务冻结的配置 ID。`action=read` 加真实 datasetId，读取试样、原始列、单位、测试条件、应变来源、拟合区间与剔除理由。
2. 未导入或配置的记录，请用户在「研究数据与交付 → 原始实验分析」导入 CSV/XLSX 并确认必填条件。不要猜测截面积、单位、标距、试样应变来源或弹性段。
3. `experiment_analyze` 使用真实 configurationIds、非空 reason，以及用户明确声明的 independentReplicates。没有明确的独立重复说明，传 false。区间或数据变更后必须使用新配置，不能继续使用旧回执。
4. 读取实际结果回执并交付文件链接。同一曲线各点不是独立重复；横梁位移的斜率是表观刚度；实测弹性段及试样引伸计/DIC 条件未确认时不能把拟合斜率称作杨氏模量。观测峰值不自动称作极限强度。
5. 科学状态保持 needs_review，不能把脚本成功或高 R² 称为科学验证。数字化曲线保留 digitized 身份与误差说明，不伪造实测误差条。复算使用实际生成目录中的 `node replay.mjs`，不重新编写计算方法。

List and read the exact frozen configuration IDs. Missing configurations require the experimental editor; do not infer measurement metadata. Execute the fixed analysis with a recorded reason and an explicit replicate declaration (false unless the user establishes independence). Preserve the distinction between fit slope, apparent stiffness and eligible fitted Young’s modulus. Deliver the real JSON/CSV/SVG/report and same-source replay bundle with needs_review status. A changed input or interval requires a new configuration and run.

- 单个试样 / Single specimen: 分析已配置试样，按保存区间拟合，输出曲线和中文报告，不声明重复。Analyze the configured specimen using its saved interval; deliver a curve and report without declaring replicates.
- 独立重复 / Independent replicates: 比较相同条件下三个不同试样，用户确认独立重复后汇总样本均值与标准差。Compare three specimens under identical conditions; summarize sample mean and SD only after independence is established.
