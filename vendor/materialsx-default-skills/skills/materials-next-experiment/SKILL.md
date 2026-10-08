---
name: materials-next-experiment
description: "Plan the next materials experiments using the user-saved study, source-linked measurement feedback, controls, independent preparations, complete blocks and cost/time constraints. Use MaterialsX next_experiment_data and next_experiment_design to create actual DOE or gated surrogate candidates, reports and replay files."
license: AGPL-3.0-only
---
# 下一轮实验 / Next materials experiments

沿用当前研究项目、执行引擎、计划、权限与真实回执。方案只安排实验，不执行设备或宣称实体实验已完成。
Use the current research project, engine, plan, grant and real receipts. A design schedules experiments; it does not execute equipment or claim physical completion.

1. 调用 `next_experiment_data`（可传 offset/limit）读取当前任务冻结的研究条件和实际反馈。必须使用返回的 study.id。记录目标响应及原单位、实验单元、假设、替代解释、否定条件、变量水平、对照、区组、独立制备数、可加工性限制和成本依据。
2. 研究条件缺失时，引导用户在「研究数据与交付 → 下一轮实验」填写条件。不得猜测工艺范围、测量条件、实验独立性、真实测量值、人工核对状态或预算。反馈登记使用界面；实测值来自 UA.8 原始实验计算或已导入观测。失败与偏离也必须保留。
3. 根据目标选择 `next_experiment_design`：传 studyId、method、points（1–32）、seed 和非空 reason。factorial 是全部已保存水平的全因子；points 对它不生效。latin-hypercube 分层连续变量、平衡离散水平。每个区组包含全部对照和处理点，各重复须独立制备。系统不会静默删点或减少重复来满足预算。
4. bayesian / active-learning 只在至少 8 个不同变量组合、来源未重复且人工核对的测量反馈上启用。固定 RBF GP 使用按完整坐标分组的固定留出验证；候选随机种子不能改变验证划分。未达到门槛时，解释 blocked 理由，采用可行 DOE 或收集缺失数据，不能绕过门槛伪造完成。
5. 检查真实回执的 status/reasons、完整 schedule、估算成本/时间、预测来源和 baseline。baseline 是前瞻模型评分，不是已测的优越性证据；后验标准差不是校准后的测量不确定性。所有候选和可加工性保持 needs_review，不宣称唯一分子结构、因果证明或科学认证。
6. 交付实际 JSON、报告、候选表、随机实验顺序表和 `node replay.mjs` 复算文件。条件/反馈或来源变更后重新计算；历史方案保留旧版本。模型文字不能替代文件验收。需要设备操控或跨天作业时，当前工具不执行，不能把计划当成已运行任务。

Read the saved study and actual feedback, preserving the original units and evidence. Missing settings require the study editor. Use the exact study ID with a reason, design method, point count and seed. Complete blocks include controls and independently prepared replicates. DOE is available without surrogate qualification. Bayesian/active-learning candidates require reviewed measurements, unique source identities, eight distinct coordinates and a fixed coordinate-grouped holdout improvement over a training-only mean baseline. This engineering gate is not scientific validation. Inspect actual outputs and limitations; deliver files with needs_review status and do not claim completed experiments.

- DOE 示例 / DOE example: 用当前保存的两个工艺变量生成全因子方案，保留对照、批次内随机顺序、两次独立制备，并检查预算。Generate a factorial design for two saved process factors with controls, block-wise random order, two independent preparations and budget checks.
- 反馈示例 / Feedback example: 读取已核对反馈，为下一轮推荐 4 个候选；通过验证时按预计改善/成本排序，否则说明缺项并给出 DOE。Read reviewed outcomes and recommend four candidates by expected improvement per estimated cost only if the validation gate passes; otherwise explain gaps and provide DOE.
