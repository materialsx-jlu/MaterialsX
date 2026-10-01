#!/usr/bin/env python3
"""Render common ontology plus stage-scoped recipe/constraint review tables."""
import argparse
import json
from pathlib import Path
from rpsme_ontology_v2 import render_package_summary
from validate_package import validate


def cell(value):
    return str(value if value is not None else "未报告").replace("|", "\\|").replace("\n", " ")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    value = json.loads(args.package.read_text(encoding="utf-8"))
    report = validate(value)
    if not report["valid"]:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1
    document_set = value.get("document_set", {})
    lines = [render_package_summary(value), "\n## 来源文档集"]
    for document in document_set.get("documents", []):
        lines.append(f"- {cell(document.get('role'))} · {cell(document.get('filename'))} · {cell(document.get('page_count'))} 页 · `{cell(document.get('document_id'))}`")
    lines.append("\n## 子配方与配比核对")
    entities = value["entities"]
    mats = {m["id"]: m for m in entities.get("materials", [])}
    for recipe in entities.get("recipes", []):
        lines.extend([f"\n### {recipe['id']}", f"\n基准：{cell(recipe.get('basis'))}",
                      "\n| 材料 | 用料 ID | 本子配方用量 | 状态 |", "| --- | --- | --- | --- |"])
        for u in entities.get("ingredient_usages", []):
            if u.get("recipe_id") != recipe["id"]: continue
            amount = u.get("amount") or {}
            dose = "明确未使用" if u.get("not_used") else f"{cell(amount.get('original_value'))} {amount.get('original_unit') or ''}"
            lines.append(f"| {cell(mats.get(u['material_id'], {}).get('canonical_name'))} | {u['id']} | {dose} | {u['value_status']} |")
            if u.get("value_status") == "calculated":
                lines.append(f"\n计算依据：{cell(u.get('profile', {}).get('calculation'))}\n")
        for c in recipe.get("profile", {}).get("formulation_constraints", []):
            lines.append(f"\n配比：{cell(c.get('ratio_text') or c.get('source_expression'))}；基准：{cell(c.get('basis'))}；证据：{cell(c.get('evidence_ids'))}")
        for c in recipe.get("profile", {}).get("excluded_components", []):
            lines.append(f"\n明确未使用：{cell(c.get('canonical_name'))}；{cell(c.get('reason'))}")
    lines.append("\n## 表征、媒体与模拟覆盖\n")
    lines.append(f"- 表征事件：{len(entities.get('characterization_events', []))}")
    lines.append(f"- 表征定量结果：{len(entities.get('characterization_measurements', []))}")
    lines.append(f"- 图像/文件资产：{len(entities.get('media_artifacts', []))}")
    lines.append(f"- 模拟研究：{len(entities.get('simulation_studies', []))}")
    lines.append(f"- 原子化模拟结果：{len(entities.get('simulation_results', []))}")
    for simulation in entities.get("simulation_studies", []):
        related = [r for r in entities.get("simulation_results", []) if r.get("simulation_study_id") == simulation.get("id")]
        lines.append(f"- {cell(simulation.get('simulation_type'))} · {cell(simulation.get('software'))} {cell(simulation.get('software_version'))}: {len(related)} 项结果")
    lines.append("\n## 论文附加校验提示\n")
    lines.extend(f"- {i['code']}: {i['message']}" for i in report["issues"])
    rendered = "\n".join(lines) + "\n"
    if args.output:
        if args.output.resolve() == args.package.resolve(): parser.error("Output must not overwrite JSON.")
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
