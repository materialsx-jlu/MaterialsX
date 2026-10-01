#!/usr/bin/env python3
"""Validate the optional RPSME Ontology 1.4 research-opportunity extension."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
from validate_opportunity_discovery import validate_discovery
from quality_review import evidence_reference_issues

LOCALIZED_FIELDS = ("title", "objective", "rationale", "research_question", "hypothesis", "novelty")
SCORE_FIELDS = ("feasibility", "scientific_value", "novelty", "difficulty", "cost", "competition", "publication_potential")
EXPERIMENT_FIELDS = ("samples", "variables", "controls", "process", "characterization", "performance_tests", "statistics", "sample_size", "success_criteria", "failure_criteria", "next_decision")

def bilingual(value: Any) -> bool:
    return isinstance(value, dict) and all(isinstance(value.get(key), str) and value[key].strip() for key in ("zh-CN", "en"))

def validate(package: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if "evidence" in package:
        errors.extend(f"{i['path']}: {i['message']}" for i in evidence_reference_issues(package))
    if package.get("schema_version") != "rpsme-ontology-1.4":
        return ["schema_version must be rpsme-ontology-1.4 when validating research opportunities"]
    analysis, rows = package.get("paper_analysis"), package.get("research_opportunities")
    if not isinstance(analysis, dict):
        errors.append("paper_analysis must be an object")
        analysis = {}
    for field in ("core_idea", "core_contribution", "real_breakthrough"):
        if not bilingual(analysis.get(field)):
            errors.append(f"paper_analysis.{field} must contain non-empty zh-CN and en")
    if analysis.get("source_scope") not in {"abstract", "full_text"}:
        errors.append("paper_analysis.source_scope must be abstract or full_text")
    if not isinstance(analysis.get("paper_type"), str) or not analysis["paper_type"].strip():
        errors.append("paper_analysis.paper_type is required")
    facts = analysis.get("paper_facts", []) if isinstance(analysis, dict) else []
    if not facts or any(not isinstance(row, dict) or not bilingual(row.get("statement")) or not row.get("evidence_ids") for row in facts):
        errors.append("paper_analysis.paper_facts must be bilingual and evidence-linked")
    if not isinstance(rows, list) or len(rows) != 3:
        return errors + ["research_opportunities must contain exactly three cards"]
    if {row.get("ordinal") for row in rows if isinstance(row, dict)} != {1, 2, 3}: errors.append("opportunity ordinals must be exactly 1, 2, and 3")
    if {row.get("archetype") for row in rows if isinstance(row, dict)} != {"validation", "extension", "platform"}: errors.append("opportunity archetypes must be validation, extension, and platform")
    for index, row in enumerate(rows):
        path = f"research_opportunities[{index}]"
        if not isinstance(row, dict): errors.append(f"{path} must be an object"); continue
        if package.get("prompt_version") in {"rpsme-literature-v7-opportunity-discovery", "rpsme-literature-v8-material-identity"}:
            ids = {e.get("id") for e in package.get("evidence", []) if isinstance(e, dict)}
            errors.extend(f"{path}: {message}" for message in validate_discovery(row, ids))
        for field in LOCALIZED_FIELDS:
            if not bilingual(row.get(field)): errors.append(f"{path}.{field} must contain non-empty zh-CN and en")
        layers = row.get("evidence_layers")
        if not isinstance(layers, dict) or any(key not in layers for key in ("paper_facts", "reasoned_inference", "unverified_assumptions")): errors.append(f"{path}.evidence_layers must separate facts, inference, and assumptions")
        minimum = row.get("minimum_validation")
        if not isinstance(minimum, dict) or not bilingual(minimum.get("stop_conditions")): errors.append(f"{path}.minimum_validation.stop_conditions must be bilingual")
        design = row.get("experiment_design")
        if not isinstance(design, dict) or any(field not in design for field in EXPERIMENT_FIELDS): errors.append(f"{path}.experiment_design must include samples, variables, controls, process, characterization, performance, statistics, sample size, success/failure criteria, and next decision")
        simulation = row.get("simulation_plan")
        if not isinstance(simulation, dict) or simulation.get("status") not in {"applicable", "not_applicable"}: errors.append(f"{path}.simulation_plan.status must be applicable or not_applicable")
        elif simulation["status"] == "applicable" and any(field not in simulation for field in ("method", "inputs", "parameters", "expected_outputs", "experimental_cross_validation")): errors.append(f"{path}.simulation_plan must define reproducible inputs, parameters, outputs, and experimental cross-validation")
        elif simulation["status"] == "not_applicable" and not bilingual(simulation.get("reason")): errors.append(f"{path}.simulation_plan.reason must be bilingual when simulation is not applicable")
        execution = row.get("execution")
        if not isinstance(execution, dict) or any(field not in execution for field in ("required_conditions", "timeline", "owner")): errors.append(f"{path}.execution must include required_conditions, timeline, and owner")
        budget = row.get("budget")
        if not isinstance(budget, dict) or any(field not in budget for field in ("currency", "min", "max", "assumptions", "includes", "excludes")): errors.append(f"{path}.budget is incomplete")
        elif not isinstance(budget.get("min"), (int, float)) or not isinstance(budget.get("max"), (int, float)) or budget["min"] < 0 or budget["max"] < budget["min"]: errors.append(f"{path}.budget must have 0 <= min <= max")
        scores = row.get("scores")
        if not isinstance(scores, dict) or set(scores) != set(SCORE_FIELDS): errors.append(f"{path}.scores must contain exactly seven P0 dimensions")
        else:
            for name, value in scores.items():
                if not isinstance(value, dict) or not isinstance(value.get("score"), int) or not 1 <= value["score"] <= 10 or not bilingual(value.get("reason")): errors.append(f"{path}.scores.{name} must contain score 1-10 and bilingual reason")
        publication = row.get("publication_target")
        if not isinstance(publication, dict) or any(field not in publication for field in ("level", "rationale", "evidence_gaps")): errors.append(f"{path}.publication_target must include level, rationale, and evidence_gaps")
        risks = row.get("risks")
        if not isinstance(risks, dict) or not risks.get("items") or not bilingual(risks.get("stop_conditions")): errors.append(f"{path}.risks must include items and bilingual stop_conditions")
        keywords = row.get("keywords")
        if not isinstance(keywords, list) or len(keywords) < 3 or any(not bilingual(value) or not value.get("key") or not value.get("category") for value in keywords): errors.append(f"{path}.keywords must contain at least three normalized bilingual keywords")
        if row.get("recommendation") not in {"do", "observe", "drop"}: errors.append(f"{path}.recommendation must be do, observe, or drop")
        novelty_status = row.get("novelty_status")
        if novelty_status not in {"preliminary", "literature_screened", "expert_reviewed"}:
            errors.append(f"{path}.novelty_status must be preliminary, literature_screened, or expert_reviewed")
        elif novelty_status == "literature_screened":
            screening = row.get("novelty_screening")
            if not isinstance(screening, dict) or not isinstance(screening.get("query"), str) or not screening["query"].strip() or not isinstance(screening.get("searched_at"), str) or not isinstance(screening.get("competing_papers"), list):
                errors.append(f"{path}.novelty_screening must store query, searched_at, and competing_papers")
        elif novelty_status == "expert_reviewed":
            review = row.get("expert_review")
            if not isinstance(review, dict) or not isinstance(review.get("reviewer"), str) or not review["reviewer"].strip() or not isinstance(review.get("reviewed_at"), str):
                errors.append(f"{path}.expert_review must identify reviewer and reviewed_at")
        if row.get("value_status") != "derived": errors.append(f"{path}.value_status must be derived")
        if novelty_status == "preliminary":
            novelty_text = " ".join(str(row.get("novelty", {}).get(key, "")).lower() for key in ("zh-CN", "en"))
            if any(claim in novelty_text for claim in ("全球首创", "世界首创", "globally first", "world-first")):
                errors.append(f"{path}.novelty cannot claim global first while novelty_status is preliminary")
        if isinstance(scores, dict) and row.get("recommendation") == "do":
            feasibility = scores.get("feasibility", {}).get("score") if isinstance(scores.get("feasibility"), dict) else None
            value = scores.get("scientific_value", {}).get("score") if isinstance(scores.get("scientific_value"), dict) else None
            if (isinstance(feasibility, int) and feasibility < 7 or isinstance(value, int) and value < 7) and not bilingual(row.get("recommendation_exception_reason")):
                errors.append(f"{path}.recommendation_exception_reason is required when Do has feasibility or value below 7")
        if isinstance(keywords, list):
            for keyword_index, keyword in enumerate(keywords):
                if not isinstance(keyword, dict): continue
                source, status = keyword.get("source"), keyword.get("status")
                if source not in {"controlled_vocabulary", "auto_generated"} or status not in {"active", "pending_review"}:
                    errors.append(f"{path}.keywords[{keyword_index}] must declare source and active/pending_review status")
                elif source == "auto_generated" and status != "pending_review":
                    errors.append(f"{path}.keywords[{keyword_index}] auto-generated keywords must be pending_review")
        if not isinstance(row.get("next_7_days"), list) or len(row["next_7_days"]) != 3 or not all(bilingual(item) for item in row["next_7_days"]): errors.append(f"{path}.next_7_days must contain exactly three bilingual actions")
    return errors

def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("package", type=Path); args = parser.parse_args()
    errors = validate(json.loads(args.package.read_text(encoding="utf-8")))
    print(json.dumps({"valid": not errors, "errors": errors}, ensure_ascii=False, indent=2)); return 1 if errors else 0

if __name__ == "__main__": raise SystemExit(main())
