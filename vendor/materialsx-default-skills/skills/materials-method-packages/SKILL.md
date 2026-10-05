---
name: materials-method-packages
description: Find a pinned statistical method for evidence-linked material observations, inspect its scope and reference status, then execute the existing research tools to produce actual JSON and reports. 选取有版本记录的统计方法分析材料观测；不安装候选外部代码。
---

# 方法包 / Method packages

1. Search `method_package_search` by the task, in Chinese or English. Read scope, limitations, license decisions, executable state and reference status. Candidate packages are descriptions only; user Skills do not confer method qualification.
2. Read selected observations and evidence with `research_data`. Preserve original units, material basis and test conditions. Missing or incomparable inputs must be reported before calculation.
3. For a summary or single-predictor fit, use `research_methods` with `action=assess`, actual owned observation IDs and task `summarize` or `fit`. Then invoke `research_method_run` with the returned assessment ID, eligible method ID and a reason tied to the user's question. Host code enforces frozen package versions and runs the pinned reference when needed. Do not invoke arbitrary scripts from imported metadata.
4. Inspect the real JSON/report paths and numerical results. Explain residuals, training range and limitations. A reference-reproduced status checks the named benchmark only; it is not material-domain validation, a causal finding or production approval. Do not claim a missing file exists.

## Examples / 使用示例

- 汇总选定同条件强度观测的均值，独立制样未确认时不算标准误，生成 JSON 和报告。 / Summarize matching-condition strength values without standard error unless independent specimens are confirmed; write JSON and a report.
- 对选定成对观测做单变量线性拟合，保留单位、残差及输入范围，不作范围外预测。 / Fit selected pairs with one predictor; retain units, residuals and input domain without extrapolation.
