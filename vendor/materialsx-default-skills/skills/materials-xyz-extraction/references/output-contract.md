# materials-xyz-1.0 输出契约

UTF-8 JSON。必需顶层：`schema_version, source, material_systems, groups, protocols, evidence, facts, coverage, relations, conflicts, inventory`。使用 `scripts/validate_extraction.py` 做结构及语义检查；它不能替代原文审阅。

## 对象

- `source`：`id, path, sha256, page_count, title, doi, publication_year, version_note, supplementary_status`。页码是PDF物理页从1开始，可另记印刷页。指纹限定本次读到的文件版本。
- `material_systems[]`：`id, name, family, constituents[], evidence_ids[]`。组分角色与牌号可空，未知不能补。
- `groups[]`：`id, label, generated_id, series, material_system_id, batch_id, specimen_ids[], linkage_level, possible_duplicate_cluster, evidence_ids[]`。默认 linkage_level=condition_group；没有证据不得用 specimen。
- `protocols[]`：`id, name, method, standard, conditions, specimen, replicates, evidence_ids[]`。数值要带单位；replicates.minimum与exact分开。
- `evidence[]`：`id, source_id, page, locator, excerpt, excerpt_kind, review`；review=text_checked / visual_checked。excerpt_kind=verbatim（原文短引）、paraphrase（忠实转述）、image_observation（图像观察），转述不冒充逐字引文。locator精确到表/行/列、图/子图或段落。
- `facts[]`：见下。将继承条件实例化到对应工艺组，但保留 inherited_from 和 evidence_ids；多组共用证据只存一份。原料性质等可放 source_context，不强塞入组事实。
- `coverage[]`：每个group必须有全部15类别，每项 `group_id, category, status, fact_ids[], missing_fields[], note`。
- `relations[]`：`id, layer, kind, linkage_level, group_ids[], from_fact_ids[], to_fact_ids[], evidence_ids[], claim, controls[], confounders[], limitations[], validation_experiment`。kind=association / author_mechanism / model_hypothesis / reported_model；layer=f1 / f2 / direct_XZ；不输出identified_causal等强因果标签。
- `conflicts[]`：`id, fact_ids[], description, resolution, impact`；未解决时resolution=unresolved。
- `inventory[]`：`locator, pages[], disposition, note`；disposition=extracted / qualitative_only / not_digitized / context_only / not_accessible。覆盖原文所有结果表及关键图，没提取的说明原因。

## 单条事实

```json
{
  "id": "T370.flexural_modulus",
  "group_id": "T370",
  "stage": "Z",
  "category": "stiffness",
  "metric": "flexural_modulus",
  "value": 64600.0,
  "unit": "MPa",
  "raw_value": 64.6,
  "raw_unit": "GPa",
  "normalization": "MPa = GPa * 1000",
  "origin": "reported",
  "measurement": "quantitative",
  "state": "during_test",
  "protocol_id": "flexural",
  "evidence_ids": ["table1.T370.flexural_modulus"],
  "inherited_from": null,
  "uncertainty": null,
  "note": "论文表格给出的组级数值；未报告对应批次和数值型误差。"
}
```

`value` 可以是标量、字符串、有序步骤数组或有说明的张量/曲线对象；量化事实的标量用数值类型，禁止NaN/Infinity。`unit=null`只用于类别/文本；无量纲数用`1`。不报告的量放coverage，或value=null并明确缺失理由，但不能拿它满足覆盖条件。

`digitized`额外包含`digitization`（工具、图号、坐标标定、读取方法、误差/分辨率）；`calculated`包含`calculation`（方程、输入事实ID、假设）；`simulated`包含`simulation`（模型、边界、参数来源、校准/验证、误差或未报告原因）。不支持的一般对象可原样保留，但校验器只对其形状/来源做有限检查。

## 导出与审核

`facts.csv`是一行一条事实的长表，保留状态、来源及证据定位。`groups.csv`是一行一条论文工艺组记录的宽表，不冒充独立试件表。同组同指标有多个试验条件或重复观测时，宽表单元格保存全部观测及事实ID，不择一覆盖；建模时再按协议展开。`report.md`汇总覆盖、候选关系、冲突与阅读限制；`validation.json`只报告机器校验结果。

最终报告必须给出至少一个具体 X→Y→Z 示例，逐箭头说明证据等级；列出缺失字段，指向JSON详细证据。不要把未验证或缺数据的环节画成已识别因果关系。
