"""Human-readable review rendering for an RPSME Ontology v2 package."""

from __future__ import annotations

from typing import Any

from .vocabulary import ENTITY_COLLECTIONS


def _rows(value: Any) -> list[dict[str, Any]]:
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _measurement(value: Any) -> str:
    if not isinstance(value, dict):
        return "未报告"
    original = value.get("original_value")
    unit = value.get("original_unit") or ""
    if isinstance(original, dict):
        if "min" in original or "max" in original:
            original = f"{original.get('min', '—')}–{original.get('max', '—')}"
        else:
            original = "结构化值（请在 JSON 中查看）"
    return f"{original} {unit}".strip()


def render_package_summary(package: dict[str, Any]) -> str:
    source = package.get("source") if isinstance(package.get("source"), dict) else {}
    entities = package.get("entities") if isinstance(package.get("entities"), dict) else {}
    relations = _rows(package.get("relations"))
    evidence = _rows(package.get("evidence"))
    lines = [
        f"# {source.get('publication_number', '未知来源')} · RPSME Ontology v2 摘要",
        "",
        f"- 来源类型：{source.get('source_type', '未报告')}",
        f"- 标题：{source.get('title', '未报告')}",
        f"- 申请日：{source.get('application_date') or '未报告'}",
        f"- 公开日：{source.get('publication_date') or '未报告'}",
        f"- 契约：{package.get('package_version')} / {package.get('schema_version')}",
        f"- 实验记录：{len(_rows(package.get('experiment_records')))}",
        f"- 显式关系：{len(relations)}；断言：{len(_rows(package.get('assertions')))}；证据：{len(evidence)}",
        "",
        "## 实体计数",
        "",
    ]
    for collection in ENTITY_COLLECTIONS:
        lines.append(f"- {collection}: {len(_rows(entities.get(collection)))}")

    relations_by_subject: dict[str, list[dict[str, Any]]] = {}
    for relation in relations:
        subject = relation.get("subject") if isinstance(relation.get("subject"), dict) else {}
        relations_by_subject.setdefault(str(subject.get("id")), []).append(relation)
    entity_by_id: dict[str, dict[str, Any]] = {}
    for collection in ENTITY_COLLECTIONS:
        for entity in _rows(entities.get(collection)):
            entity_by_id[str(entity.get("id"))] = entity

    for experiment in _rows(package.get("experiment_records")):
        experiment_id = str(experiment.get("id"))
        lines.extend(["", f"## {experiment_id} · {experiment.get('label', '')}", ""])
        outgoing = relations_by_subject.get(experiment_id, [])
        recipe_ids = [row["object"]["id"] for row in outgoing if row.get("type") == "HAS_RECIPE"]
        route_ids = [row["object"]["id"] for row in outgoing if row.get("type") == "HAS_ROUTE"]
        specimen_ids = [row["object"]["id"] for row in outgoing if row.get("type") == "HAS_SPECIMEN"]
        usages = [row for row in _rows(entities.get("ingredient_usages")) if row.get("recipe_id") in recipe_ids]
        steps = sorted(
            [row for row in _rows(entities.get("process_steps")) if row.get("route_id") in route_ids],
            key=lambda row: row.get("normalized_order", 0),
        )
        tests = [row for row in _rows(entities.get("tests")) if row.get("experiment_id") == experiment_id]
        observations = [row for row in _rows(entities.get("property_observations")) if row.get("experiment_id") == experiment_id]
        characterization_measurements = [row for row in _rows(entities.get("characterization_measurements")) if row.get("experiment_id") == experiment_id]
        lines.append(f"- 配方：{len(usages)} 次用料；工艺：{len(steps)} 步；试样：{len(specimen_ids)}；测试/性能：{len(tests)}/{len(observations)}")
        if experiment.get("baseline_experiment_id"):
            lines.append(f"- 对照基准：{experiment['baseline_experiment_id']}")
        if usages:
            lines.append("- 组分：")
            for usage in usages:
                material = entity_by_id.get(str(usage.get("material_id")), {})
                lines.append(f"  - {material.get('canonical_name', usage.get('material_id'))}｜{usage.get('role')}｜{_measurement(usage.get('amount'))}｜{usage.get('value_status')}")
        if steps:
            lines.append("- 工艺路线：")
            for step in steps:
                source_number = f"{step.get('source_step')}{step.get('source_substep') or ''}"
                lines.append(f"  - {step.get('normalized_order')}.〔原文 {source_number}〕{step.get('display_name_zh')}｜{step.get('value_status')}")
                def label(entity_id: str) -> str:
                    row = entity_by_id.get(entity_id, {})
                    material = entity_by_id.get(str(row.get("material_id")), {})
                    return str(row.get("display_name_zh") or row.get("name") or material.get("canonical_name") or entity_id)
                inputs = [r["subject"]["id"] for r in relations if r["type"] in {"INTRODUCED_AT", "FEEDS"} and r["object"]["id"] == step["id"]]
                inputs += [r["object"]["id"] for r in relations if r["type"] == "CONSUMES" and r["subject"]["id"] == step["id"]]
                outputs = [r["object"]["id"] for r in relations if r["type"] == "PRODUCES" and r["subject"]["id"] == step["id"]]
                lines.append(f"    - 输入：{' + '.join(map(label, inputs)) or '未绑定'} → 输出：{' + '.join(map(label, outputs)) or '未报告'}")
        unresolved = experiment.get("profile", {}).get("material_flow", {}).get("unbound_usage_ids", [])
        if unresolved:
            lines.append(f"- 待绑定用料：{len(unresolved)} 项（禁止依据步骤相邻补线）")
        if observations:
            lines.append("- 性能观测：")
            visible_observations = [row for row in observations if row.get("observation_role") != "replicate"]
            for observation in visible_observations:
                test = entity_by_id.get(str(observation.get("test_id")), {})
                specimen = entity_by_id.get(str(test.get("specimen_id")), {})
                lines.append(
                    f"  - {observation.get('display_name_zh') or observation.get('property_type')}："
                    f"{_measurement(observation.get('value'))}｜试样：{specimen.get('name', '待关联')}｜"
                    f"方法：{test.get('method', '未报告')}｜{observation.get('value_status')}｜"
                    f"统计：{observation.get('statistic_type') or observation.get('observation_role') or 'single'}"
                )
            replicate_count = sum(row.get("observation_role") == "replicate" for row in observations)
            if replicate_count:
                lines.append(f"  - 平行试样原始值：{replicate_count} 个（JSON中逐条保存）")
        if characterization_measurements:
            lines.append("- 表征定量测量：")
            for item in characterization_measurements:
                lines.append(f"  - {item.get('display_name_zh') or item.get('metric_type')}：{_measurement(item.get('value'))}｜{item.get('value_status')}")
        inferred_edges = [row for row in relations if row.get("value_status") == "inferred" and (
            row.get("subject", {}).get("id") in entity_by_id and entity_by_id[row["subject"]["id"]].get("experiment_id") == experiment_id
        )]
        if inferred_edges:
            lines.append(f"- 待审推断关系：{len(inferred_edges)} 条（不会作为来源事实发布）")
    lines.extend(["", "## 审核提示", "", "本摘要用于抽取审核，不代表来源内容已被独立实验复现。价格、采购建议和平台订单不属于来源事实。", ""])
    return "\n".join(lines)
