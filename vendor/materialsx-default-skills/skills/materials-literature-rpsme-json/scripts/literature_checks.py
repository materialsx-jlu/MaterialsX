"""Extra deterministic checks for literature recipe semantics; no model/network calls."""
import json
import math
from collections import defaultdict

CONVERSIONS = {
    "mass": {"g": 1, "mg": .001, "kg": 1000, "ug": .000001, "µg": .000001, "μg": .000001},
    "volume": {"mL": 1, "ml": 1, "L": 1000, "l": 1000, "uL": .001, "µL": .001, "μL": .001},
    "molar": {"mol": 1, "mmol": .001, "umol": .000001, "µmol": .000001, "μmol": .000001},
}
TYPES = {"component_mass_ratio": "mass", "component_volume_ratio": "volume", "component_molar_ratio": "molar"}
RECIPE_SCOPES = {
    "direct", "inherited_and_hydrated",
    "opaque_commercial_product", "not_applicable", "unresolved_with_reason",
}


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def terms(constraint):
    if "terms" in constraint:
        return constraint["terms"] if isinstance(constraint["terms"], list) else []
    return [{"usage_id": constraint.get(f"{side}_usage_id"),
             "material_id": constraint.get(f"{side}_material_id"),
             "coefficient": constraint.get(f"{side}_value")}
            for side in ("numerator", "denominator")]


def absolute(usage, basis):
    measurement = usage.get("amount") or {}
    # Prefer original units; only use normalized units as an alternative pair.
    for prefix in ("original", "normalized"):
        value, unit = measurement.get(f"{prefix}_value"), measurement.get(f"{prefix}_unit")
        factor = CONVERSIONS.get(basis, {}).get(unit)
        if number(value) and factor is not None:
            return value * factor
    return None


def check_literature(package):
    issues = []
    def add(code, path, message, severity="error"):
        issues.append(dict(severity=severity, code=code, path=path, message=message))
    source = package.get("source", {})
    if source.get("source_type") not in {"paper", "master_thesis", "doctoral_thesis"}:
        add("LITERATURE_SOURCE_TYPE", "$.source.source_type", "This Skill accepts research papers or theses, not patents.")
    document_set = package.get("document_set", {})
    documents = document_set.get("documents", []) if isinstance(document_set, dict) else []
    if package.get("schema_version") == "rpsme-ontology-1.2" and not documents:
        add("DOCUMENT_MANIFEST_MISSING", "$.document_set", "Ontology 1.2 requires the main/SI document set.")
    elif not documents and not source.get("profile", {}).get("documents"):
        add("DOCUMENT_MANIFEST_MISSING", "$.source.profile", "Record main/SI document IDs and page/hash metadata before extraction delivery.", "warning")
    if documents:
        document_ids = {item.get("document_id") for item in documents if isinstance(item, dict)}
        for index, evidence_item in enumerate(package.get("evidence", [])):
            locator = evidence_item.get("locator", {})
            if locator.get("document_id") not in document_ids:
                add("EVIDENCE_DOCUMENT", f"$.evidence[{index}].locator.document_id", "Evidence must identify one document in document_set.")
    entities = package.get("entities", {})
    for index, step in enumerate(entities.get("process_steps", [])):
        label = str(step.get("display_name_zh") or "").strip()
        if not label:
            add("PROCESS_DISPLAY_NAME_ZH", f"$.entities.process_steps[{index}].display_name_zh", "Every extracted process step needs a source-faithful Chinese display name; source_text retains the original language.")
    usages = {u["id"]: u for u in entities.get("ingredient_usages", [])}
    materials = {m["id"]: m for m in entities.get("materials", [])}
    evidence = {e["id"]: e for e in package.get("evidence", [])}
    assertions = package.get("assertions", [])
    simulations = {s.get("id"): s for s in entities.get("simulation_studies", [])}
    records = {row.get("id"): row for row in package.get("experiment_records", []) if isinstance(row, dict)}
    recipe_experiments = {row.get("experiment_id") for row in entities.get("recipes", []) if isinstance(row, dict)}
    route_experiments = {row.get("experiment_id") for row in entities.get("process_routes", []) if isinstance(row, dict)}
    for experiment_id, record in records.items():
        profile = record.get("profile") if isinstance(record.get("profile"), dict) else {}
        parent_id = profile.get("preparation_parent_experiment_id")
        scope = profile.get("recipe_scope") if isinstance(profile.get("recipe_scope"), dict) else {}
        scope_status = scope.get("status")
        if scope_status and scope_status not in RECIPE_SCOPES:
            add("RECIPE_SCOPE_STATUS", f"experiment_record:{experiment_id}.profile.recipe_scope.status",
                f"Unsupported recipe scope status: {scope_status}")
        if parent_id:
            if parent_id == experiment_id or parent_id not in records:
                add("PREPARATION_PARENT", f"experiment_record:{experiment_id}.profile.preparation_parent_experiment_id",
                    "Preparation parent must identify another experiment in this package.")
            if experiment_id not in recipe_experiments or experiment_id not in route_experiments:
                add("UNHYDRATED_PREPARATION", f"experiment_record:{experiment_id}",
                    "A preparation child must carry experiment-scoped hydrated Recipe and ProcessRoute entities; a parent pointer alone is not searchable or renderable.")
            if scope_status != "inherited_and_hydrated":
                add("PREPARATION_SCOPE", f"experiment_record:{experiment_id}.profile.recipe_scope.status",
                    "A hydrated preparation child must declare inherited_and_hydrated recipe scope.")
        elif experiment_id not in recipe_experiments:
            if scope_status not in {"opaque_commercial_product", "not_applicable", "unresolved_with_reason"}:
                add("UNEXPLAINED_EMPTY_RECIPE", f"experiment_record:{experiment_id}",
                    "Experiment has no Recipe and no explicit source-supported recipe_scope reason.", "warning")
    for index, result in enumerate(entities.get("simulation_results", [])):
        if result.get("simulation_study_id") not in simulations:
            add("SIMULATION_RESULT_STUDY", f"$.entities.simulation_results[{index}]", "Simulation result must belong to a study.")
    for index, media in enumerate(entities.get("media_artifacts", [])):
        if media.get("simulation_study_id") and media.get("characterization_event_id"):
            add("MEDIA_MULTIPLE_PRODUCERS", f"$.entities.media_artifacts[{index}]", "Media has both characterization and simulation producers.")
    introduced = defaultdict(list)
    for edge in package.get("relations", []):
        if edge.get("type") == "INTRODUCED_AT":
            introduced[edge["subject"]["id"]].append(edge["object"]["id"])
    seen = {}
    for uid, usage in usages.items():
        path = f"ingredient_usage:{uid}"
        if usage.get("not_used"):
            amount = (usage.get("amount") or {}).get("original_value")
            if number(amount) and amount > 0:
                add("UNUSED_POSITIVE_AMOUNT", path, "An explicitly unused component cannot have a positive dose.")
            continue
        signature = (usage.get("experiment_id"), usage.get("recipe_id"), usage.get("material_id"),
                     tuple(sorted(introduced[uid])), tuple(sorted(usage.get("evidence_ids", []))),
                     json.dumps(usage.get("amount"), sort_keys=True),
                     json.dumps(usage.get("profile", {}).get("addition_index"), sort_keys=True))
        if signature in seen:
            add("DUPLICATE_USE_EVENT", path, f"Probable duplicate of {seen[signature]}; verify distinct addition events.")
        seen[signature] = uid
        amount = (usage.get("amount") or {}).get("original_value")
        if isinstance(amount, str) and (":" in amount or "：" in amount):
            add("RATIO_IN_AMOUNT", path, "Represent a component ratio as a recipe constraint, not an absolute amount.")
        profile = usage.get("profile", {})
        additional = profile.get("additional_amount")
        if additional:
            if not isinstance(additional, dict) or additional.get("original_value") is None or not additional.get("original_unit"):
                add("ADDITIONAL_AMOUNT_SHAPE", path, "Additional amount must be a structured Measurement.")
            if not profile.get("additional_amount_basis"):
                add("ADDITIONAL_AMOUNT_BASIS", path, "Additional mol%/wt% requires an explicit reference basis or a stated source gap.")
            total = usage.get("amount") or {}
            if (isinstance(additional, dict) and total
                    and total.get("original_value") == additional.get("original_value")
                    and total.get("original_unit") == additional.get("original_unit")):
                add("ADDITIVE_AS_TOTAL_AMOUNT", path, "An additional percentage cannot also be represented as the component's total usage amount.")
        if usage.get("value_status") == "calculated":
            deps = profile.get("depends_on_usage_ids", [])
            if not profile.get("calculation") or not deps:
                add("CALCULATION_PROVENANCE", path, "Calculated dose requires formula and input usage IDs.")
            for dep in deps:
                target = usages.get(dep)
                if not target or dep == uid or target.get("experiment_id") != usage.get("experiment_id"):
                    add("CALCULATION_INPUT", path, f"Invalid/cross-experiment input usage: {dep}")
    for recipe in entities.get("recipes", []):
        path = f"recipe:{recipe['id']}"
        profile = recipe.get("profile", {})
        active = [u for u in usages.values() if u.get("recipe_id") == recipe["id"] and not u.get("not_used")]
        for excluded in profile.get("excluded_components", []):
            mid = excluded.get("material_id")
            if mid not in materials:
                add("EXCLUDED_MATERIAL", path, "Excluded material reference does not exist.")
            if any(u.get("material_id") == mid for u in active):
                add("ACTIVE_AND_EXCLUDED", path, "Same material is both active and explicitly excluded.")
            if not excluded.get("reason") or not excluded.get("evidence_ids"):
                add("EXCLUSION_EVIDENCE", path, "Explicit absence requires a reason and source evidence.")
            for eid in excluded.get("evidence_ids", []):
                if evidence.get(eid, {}).get("experiment_id") != recipe.get("experiment_id"):
                    add("EXCLUSION_EVIDENCE_BOUNDARY", path, f"Invalid/cross-experiment exclusion evidence {eid}.")
        for index, c in enumerate(profile.get("formulation_constraints", [])):
            cp = f"{path}.formulation_constraints[{index}]"
            if not isinstance(c, dict):
                add("CONSTRAINT_SHAPE", cp, "Expected an object."); continue
            kind, basis = c.get("constraint_type", ""), c.get("basis")
            if "ratio" not in kind:
                add("CONSTRAINT_MANUAL_REVIEW", cp, "This constraint type needs manual arithmetic review.", "warning"); continue
            if c.get("value_status") == "pending":
                add("RATIO_PENDING", cp, "Unresolved ratio/basis must remain in review.", "warning")
            elif basis not in CONVERSIONS:
                add("RATIO_BASIS", cp, "Reported ratio needs explicit mass, volume or molar basis.")
            if kind in TYPES and basis != TYPES[kind]:
                add("RATIO_TYPE_BASIS", cp, "Constraint type and basis disagree.")
            ids = c.get("evidence_ids", [])
            if c.get("value_status") == "calculated" and (not c.get("calculation") or not c.get("source_expression")):
                add("CALCULATED_RATIO_PROVENANCE", cp, "Calculated ratio requires its source expression and auditable calculation.")
            if c.get("value_status") in {"reported", "inherited"} and not ids:
                add("RATIO_EVIDENCE", cp, "Reported ratio requires evidence.")
            for eid in ids:
                ev = evidence.get(eid, {})
                if ev.get("experiment_id") != recipe.get("experiment_id") or ev.get("source_id") != source.get("id"):
                    add("RATIO_EVIDENCE_BOUNDARY", cp, f"Invalid/cross-experiment ratio evidence {eid}.")
            operands = terms(c)
            if len(operands) < 2 or not all(isinstance(t, dict) for t in operands):
                add("RATIO_TERMS", cp, "Ratio needs at least two structured operands."); continue
            if len({t.get("usage_id") for t in operands}) != len(operands):
                add("RATIO_REPEATED_OPERAND", cp, "Ratio operands must be distinct usages.")
            quantities = []
            for term in operands:
                usage = usages.get(term.get("usage_id"))
                if not usage or usage.get("recipe_id") != recipe["id"] or usage.get("experiment_id") != recipe.get("experiment_id"):
                    add("RATIO_USAGE_BOUNDARY", cp, "Operand is missing or belongs to another recipe/experiment."); continue
                if term.get("material_id") != usage.get("material_id"):
                    add("RATIO_MATERIAL_MISMATCH", cp, "Operand material differs from the referenced usage.")
                if usage.get("not_used"):
                    add("RATIO_UNUSED_OPERAND", cp, "Ratio references an unused component.")
                coefficient = term.get("coefficient")
                if isinstance(coefficient, dict):
                    lo, hi = coefficient.get("min"), coefficient.get("max")
                    if not number(lo) or not number(hi) or lo < 0 or hi < lo:
                        add("RATIO_RANGE", cp, "Invalid coefficient range.")
                    add("RATIO_ARITHMETIC_SKIPPED", cp, "Range/coupled-ratio arithmetic needs source review.", "warning"); continue
                if not number(coefficient) or coefficient <= 0:
                    add("RATIO_COEFFICIENT", cp, "Exact ratio coefficients must be positive numbers."); continue
                qty = absolute(usage, basis)
                if qty is None:
                    if usage.get("amount"):
                        add("RATIO_ARITHMETIC_SKIPPED", cp, "Dose units cannot be converted to the ratio basis.", "warning")
                    continue
                quantities.append(qty / coefficient)
            if len(quantities) >= 2 and not all(math.isclose(v, quantities[0], rel_tol=.005, abs_tol=1e-12) for v in quantities[1:]):
                add("RATIO_AMOUNT_MISMATCH", cp, "Absolute doses contradict the reported ratio (0.5% rounding tolerance).")
            def assertion_matches(a):
                if a.get("subject", {}).get("id") != recipe["id"] or a.get("subject", {}).get("type") != "recipe":
                    return False
                if not str(a.get("predicate", "")).startswith("has_component_"):
                    return False
                v = a.get("value") or {}
                if not isinstance(v, dict): return False
                ats = terms(v)
                # Earlier receiver-compatible assertions used nested numerator/denominator.
                if "numerator" in v and "denominator" in v:
                    ats = [dict(usage_id=v[s].get("usage_id"), material_id=v[s].get("material_id"), coefficient=v[s].get("value")) for s in ("numerator", "denominator")]
                return v.get("basis") == basis and ats == operands and set(a.get("evidence_ids", [])) == set(ids) and a.get("value_status") == c.get("value_status")
            if not any(assertion_matches(a) for a in assertions):
                add("RATIO_ASSERTION_MISSING", cp, "Mirror the constraint as an evidence-linked Assertion on this recipe.")
    return issues
