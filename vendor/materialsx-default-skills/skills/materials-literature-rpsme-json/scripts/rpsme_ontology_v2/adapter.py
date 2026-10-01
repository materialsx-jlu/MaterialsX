"""Deterministic v1 / legacy-dataset to RPSME Ontology v2 adapter.

The adapter changes representation only. It never invents a missing material
grade, process parameter, specimen geometry, test condition or property value.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections import Counter
from typing import Any, Iterable
from .flow import enrich_material_flow, state_key

from .vocabulary import (
    CHARACTERIZATION_TECHNIQUES,
    ENTITY_COLLECTIONS,
    EXPERIMENT_CONTRACT,
    PACKAGE_VERSION,
    PROMPT_VERSION,
    SCHEMA_VERSION,
    UNIT_DIMENSIONS,
)


def _technique_code(value: Any) -> str:
    text = str(value or "").strip()
    folded = text.upper().replace("－", "-")
    aliases = (
        ("TEM", ("HRTEM", "TEM", "透射电子显微", "透射电镜")),
        ("SEM", ("FESEM", "FE-SEM", "SEM", "扫描电子显微", "扫描电镜")),
        ("AFM", ("AFM", "原子力显微")),
        ("OM", ("金相显微", "光学显微", "OPTICAL MICROSCOP", " OM ")),
    )
    padded = f" {folded} "
    for code, candidates in aliases:
        if any(candidate in padded or candidate in text for candidate in candidates):
            return code
    compact = re.sub(r"[^A-Z0-9]+", "", folded)
    return compact[:24] if compact else "NOT_REPORTED"


def _observation_rows(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        return [value]
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, dict):
            result.append(item)
        elif _known(item):
            result.append({"description": str(item)})
    return result


def _artifact_type(value: Any, image_type: Any) -> str:
    raw = str(value or image_type or "image").strip().lower().replace("-", "_").replace(" ", "_")
    allowed = {"image", "figure", "elemental_map", "diffraction_pattern", "height_map", "force_map", "data_cube", "other"}
    aliases = {
        "micrograph": "image", "microscopy_image": "image", "sem_image": "image", "tem_image": "image",
        "mapping": "elemental_map", "element_mapping": "elemental_map", "eds_map": "elemental_map",
        "electron_diffraction": "diffraction_pattern", "saed": "diffraction_pattern",
        "topography": "height_map", "topography_map": "height_map", "adhesion_map": "force_map",
    }
    return raw if raw in allowed else aliases.get(raw, "other")


def _rows(value: Any) -> list[dict[str, Any]]:
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _obj(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _known(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() not in {"", "NR", "NOT_REPORTED", "PENDING", "NA"}
    return True


def _token(value: str, fallback_prefix: str = "X") -> str:
    ascii_token = re.sub(r"[^A-Z0-9]+", "-", value.upper()).strip("-")
    if ascii_token:
        if len(ascii_token) <= 72:
            return ascii_token
        # A plain prefix truncation aliases distinct long material identities.
        # Keep the readable prefix while making the full source value part of
        # the stable ID.
        digest = hashlib.sha256(ascii_token.encode("utf-8")).hexdigest()[:12].upper()
        return f"{ascii_token[:59]}-{digest}"
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:12].upper()
    return f"{fallback_prefix}-{digest}"


def _edge_id(relation_type: str, subject_id: str, object_id: str) -> str:
    raw = f"{relation_type}|{subject_id}|{object_id}"
    return "EDGE-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20].upper()


def _assertion_id(subject_id: str, predicate: str, ordinal: int = 1) -> str:
    raw = f"{subject_id}|{predicate}|{ordinal}"
    return "AST-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20].upper()


def _measurement(value: Any, unit: Any, normalized_value: Any = None, normalized_unit: Any = None) -> dict[str, Any] | None:
    if not _known(value) and not _known(normalized_value):
        return None
    original_unit = unit if isinstance(unit, str) else None
    normalized_unit = normalized_unit if isinstance(normalized_unit, str) else None
    effective_unit = normalized_unit or original_unit or ""
    result: dict[str, Any] = {
        "original_value": copy.deepcopy(value if _known(value) else normalized_value),
        "original_unit": original_unit,
        "dimension": UNIT_DIMENSIONS.get(effective_unit, "unclassified"),
    }
    if _known(normalized_value):
        normalized = copy.deepcopy(normalized_value)
        if isinstance(normalized, str) and re.fullmatch(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", normalized.strip()):
            normalized = float(normalized)
        result["normalized_value"] = normalized
        result["normalized_unit"] = normalized_unit
    return result


def _canonical_property_type(value: Any) -> str:
    raw = str(value or "").strip()
    compact = re.sub(r"[\s_-]+", "", raw).casefold()
    aliases = {
        "ilss": "interlaminar_shear_strength",
        "interlaminarshearstrength": "interlaminar_shear_strength",
        "层间剪切强度": "interlaminar_shear_strength",
        "弯曲强度": "flexural_strength",
        "flexuralstrength": "flexural_strength",
    }
    return aliases.get(compact, raw)


def _source_for(publication: str, value: dict[str, Any]) -> dict[str, Any]:
    direct = _obj(value.get("source"))
    if direct and direct.get("publication_number") == publication:
        return direct
    for source in _rows(value.get("sources")):
        if source.get("publication_number") == publication:
            return source
    raise ValueError(f"source metadata not found for {publication}")


def _evidence_refs(row: dict[str, Any], available: list[str], fallback: bool = False) -> list[str]:
    raw = row.get("evidence_ids") or row.get("evidence_id") or row.get("evidence_ref") or []
    refs = [raw] if isinstance(raw, str) else [item for item in raw if isinstance(item, str)] if isinstance(raw, list) else []
    resolved: list[str] = []
    for ref in refs:
        if ref in available:
            resolved.append(ref)
            continue
        normalized = ref.upper().replace("_", "-")
        candidates = [item for item in available if item.upper().replace("_", "-").endswith(normalized)]
        if len(candidates) == 1:
            resolved.append(candidates[0])
    if not resolved and fallback:
        return available[:]
    return list(dict.fromkeys(resolved))


def _material_kind(identity: dict[str, Any]) -> str:
    level = str(identity.get("identity_level") or "").lower()
    if level in {"exact_chemical", "chemical_identity"}:
        return "chemical"
    if level == "trade_grade":
        return "commercial_product"
    if level == "specified_polymer":
        return "substance"
    return "material_class"


def _basis_type(basis: str, unit: Any) -> str:
    text = f"{basis} {unit or ''}".lower()
    if "parts_by_mass" in text or "质量份" in text:
        return "mass_parts"
    if "wt%" in text or "mass_fraction" in text or "质量分数" in text:
        return "mass_fraction"
    if "vol%" in text or "volume_fraction" in text:
        return "volume_fraction"
    if unit in {"g", "kg", "mg"}:
        return "actual_mass"
    if unit in {"mL", "L"}:
        return "actual_volume"
    if unit == "mol":
        return "amount_of_substance"
    return "source_defined"


def _status(value: Any) -> str:
    candidate = str(value or "pending").lower()
    if candidate == "reported_range":
        return "reported"
    return candidate if candidate in {"reported", "inherited", "calculated", "digitized", "predicted", "inferred", "pending"} else "pending"


def _aggregate_status(inheritance_status: Any) -> str:
    text = str(inheritance_status or "").lower()
    if "inherit" in text or "common" in text or "沿用" in text:
        return "inherited"
    return "reported"


def _strip(source: dict[str, Any], *keys: str) -> dict[str, Any]:
    return {key: copy.deepcopy(value) for key, value in source.items() if key not in keys}


def _specimen_variants(experiment_id: str, specimen: dict[str, Any]) -> list[dict[str, Any]]:
    base = {"experiment_id": experiment_id, "version": 1, "value_status": "reported" if specimen else "pending"}
    variants: list[dict[str, Any]] = []
    if "resin_plate_thickness" in specimen:
        variants.append({**base, "id": f"SP-{_token(experiment_id)}-RESIN-PLATE", "specimen_kind": "resin_plate", "name": "树脂板试样", "profile": {"thickness": copy.deepcopy(specimen["resin_plate_thickness"])}})
    if "prepreg" in specimen:
        variants.append({**base, "id": f"SP-{_token(experiment_id)}-COMPOSITE", "specimen_kind": "composite_laminate", "name": "预浸料复合材料试样", "profile": copy.deepcopy(_obj(specimen.get("prepreg")))})
    if not variants:
        variants.append({**base, "id": f"SP-{_token(experiment_id)}-01", "specimen_kind": "reported_specimen", "name": str(specimen.get("description") or specimen.get("material") or "来源报告试样"), "profile": copy.deepcopy(specimen)})
    return variants


def _property_specimen(property_name: str, specimens: list[dict[str, Any]]) -> dict[str, Any]:
    resin = next((row for row in specimens if row["specimen_kind"] == "resin_plate"), None)
    composite = next((row for row in specimens if row["specimen_kind"] == "composite_laminate"), None)
    if property_name.startswith("resin_plate_") and resin:
        return resin
    if (property_name.startswith("composite_") or "interlaminar" in property_name.lower() or property_name.upper() == "ILSS") and composite:
        return composite
    return specimens[0]


def adapt_v1_package(
    value: dict[str, Any], experiment_codes: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Convert one patent's v1 records into a deterministic, unreviewed v2 package."""
    requested = set(experiment_codes or [])
    experiments = [row for row in _rows(value.get("experiments")) if not requested or row.get("experiment_code") in requested]
    if not experiments:
        raise ValueError("no experiments selected")
    publications = {str(row.get("source_publication_number") or "").upper() for row in experiments}
    if "" in publications or len(publications) != 1:
        raise ValueError("a v2 patent package must contain experiments from exactly one publication")
    publication = next(iter(publications))
    source_v1 = _source_for(publication, value)
    # Legacy extractors often reused short local evidence labels (E1, E2,
    # etc.) in every experiment.  They are unambiguous inside one legacy row
    # but collide in a package-wide graph, so only colliding or schema-invalid
    # labels are deterministically namespaced by experiment.
    evidence_code_counts: Counter[str] = Counter()
    for experiment in experiments:
        for old_evidence in _rows(experiment.get("evidence")):
            raw_code = str(old_evidence.get("evidence_code") or "").strip()
            if raw_code:
                evidence_code_counts[raw_code] += 1
    source_id = f"SRC-PATENT-{publication}"
    source = {
        "id": source_id,
        "source_type": "patent",
        "publication_number": publication,
        "title": source_v1.get("title") or publication,
        "jurisdiction": source_v1.get("jurisdiction") or publication[:2],
        "application_date": source_v1.get("application_date"),
        "publication_date": source_v1.get("publication_date"),
        "canonical_url": source_v1.get("canonical_url"),
        "language": source_v1.get("language") or "und",
        "profile": _strip(source_v1, "upload"),
    }
    entities: dict[str, list[dict[str, Any]]] = {name: [] for name in ENTITY_COLLECTIONS}
    relations: list[dict[str, Any]] = []
    assertions: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    quality_assessments: list[dict[str, Any]] = []
    experiment_records: list[dict[str, Any]] = []
    entity_types: dict[str, str] = {source_id: "source_document"}
    entity_types.update({str(row["experiment_code"]): "experiment_record" for row in experiments})
    material_ids: dict[str, str] = {}
    material_keys_by_id: dict[str, str] = {}

    def add_relation(relation_type: str, subject_id: str, object_id: str, status: str = "reported", evidence_ids: list[str] | None = None, profile: dict[str, Any] | None = None) -> None:
        relations.append({
            "id": _edge_id(relation_type, subject_id, object_id), "type": relation_type,
            "subject": {"type": entity_types[subject_id], "id": subject_id},
            "object": {"type": entity_types[object_id], "id": object_id},
            "value_status": status, "evidence_ids": evidence_ids or [], "profile": profile or {},
        })

    def add_assertion(subject_id: str, field_path: str, predicate: str, status: str, evidence_ids: list[str], value_: Any, inference_method: str | None = None, depends: list[str] | None = None) -> None:
        assertion = {
            "id": _assertion_id(subject_id, predicate, len(assertions) + 1),
            "subject": {"type": entity_types[subject_id], "id": subject_id, "field_path": field_path},
            "predicate": predicate, "value_status": status, "value": copy.deepcopy(value_),
            "evidence_ids": evidence_ids,
        }
        if inference_method:
            assertion["inference_method"] = inference_method
            assertion["depends_on_assertion_ids"] = depends or []
        assertions.append(assertion)

    included_experiments = {str(row.get("experiment_code")) for row in experiments}
    for experiment in experiments:
        experiment_id = str(experiment["experiment_code"])
        experiment_records.append({
            "id": experiment_id, "source_id": source_id, "label": experiment.get("experiment_label") or experiment_id,
            "experiment_type": experiment.get("experiment_type") or ("comparative" if experiment.get("is_comparative") else "example"),
            "material_family": experiment.get("material_family") or "unclassified",
            "is_comparative": bool(experiment.get("is_comparative")),
            "baseline_experiment_id": experiment.get("baseline_experiment_code"),
            "record_status": "needs_extraction_review", "version": 1,
            "profile": {"legacy_snapshot": copy.deepcopy(experiment), "migration_source": "deterministic_v1_adapter"},
        })
        add_relation("REPORTS", source_id, experiment_id)

        experiment_evidence: list[str] = []
        for ordinal, old_evidence in enumerate(_rows(experiment.get("evidence")), start=1):
            raw_evidence_id = str(old_evidence.get("evidence_code") or "").strip()
            if not raw_evidence_id:
                evidence_id = f"EV-{_token(experiment_id)}-{ordinal:03d}"
            elif len(raw_evidence_id) < 4 or evidence_code_counts[raw_evidence_id] > 1:
                evidence_id = f"EV-{_token(experiment_id)}-{_token(raw_evidence_id, 'EVIDENCE')}"
            else:
                evidence_id = raw_evidence_id
            if evidence_id in experiment_evidence:
                evidence_id = f"{evidence_id}-{ordinal}"
            experiment_evidence.append(evidence_id)
            element_id = f"DE-{_token(evidence_id)}"
            element = {
                "id": element_id, "source_id": source_id, "experiment_id": experiment_id, "version": 1,
                "element_type": "source_locator", "locator": copy.deepcopy(_obj(old_evidence.get("source_locator"))),
                "text": old_evidence.get("evidence_text") or "来源定位（旧记录未保存引文）",
            }
            entities["document_elements"].append(element)
            entity_types[element_id] = "document_element"
            evidence.append({
                "id": evidence_id, "source_id": source_id, "document_element_id": element_id,
                "experiment_id": experiment_id, "field_path": old_evidence.get("field_path") or "legacy_scope",
                "evidence_text": old_evidence.get("evidence_text") or "来源定位（旧记录未保存引文）",
                "locator": copy.deepcopy(_obj(old_evidence.get("source_locator"))),
                "extraction_method": old_evidence.get("extraction_method") or "legacy_migration",
                "extraction_confidence": old_evidence.get("extraction_confidence", 0.5),
            })

        recipe = _obj(experiment.get("recipe"))
        recipe_id = f"REC-{_token(experiment_id)}"
        recipe_entity = {
            "id": recipe_id, "experiment_id": experiment_id, "version": 1,
            "recipe_type": recipe.get("recipe_type") or "source_formulation",
            "basis": recipe.get("basis") or "unknown", "value_status": _aggregate_status(recipe.get("inheritance_status")),
            "profile": _strip(recipe, "ingredients", "recipe_type", "basis"),
        }
        entities["recipes"].append(recipe_entity); entity_types[recipe_id] = "recipe"
        add_relation("HAS_RECIPE", experiment_id, recipe_id, recipe_entity["value_status"], experiment_evidence)

        for ordinal, ingredient in enumerate(_rows(recipe.get("ingredients")), start=1):
            identity = _obj(ingredient.get("material_identity"))
            raw_material_id = str(ingredient.get("raw_material_id") or identity.get("raw_material_id") or ingredient.get("raw_name") or f"MATERIAL-{ordinal}")
            material_key = raw_material_id.upper()
            material_id = material_ids.get(material_key)
            if not material_id:
                material_id = f"MAT-{publication}-{_token(raw_material_id, 'MATERIAL')}"
                if material_id in material_keys_by_id and material_keys_by_id[material_id] != material_key:
                    digest = hashlib.sha256(material_key.encode("utf-8")).hexdigest()[:12].upper()
                    material_id = f"{material_id}-{digest}"
                material_ids[material_key] = material_id
                material_keys_by_id[material_id] = material_key
                material = {
                    "id": material_id, "version": 1, "entity_kind": _material_kind(identity),
                    "canonical_name": identity.get("canonical_name") or ingredient.get("raw_name") or raw_material_id,
                    "identity_status": identity.get("identity_status") or "pending",
                    "profile": copy.deepcopy(identity),
                }
                entities["materials"].append(material); entity_types[material_id] = "material"
            usage_id = f"USG-{_token(experiment_id)}-{ordinal:03d}"
            evidence_ids = _evidence_refs(ingredient, experiment_evidence, fallback=True)
            amount = _measurement(ingredient.get("amount"), ingredient.get("unit"))
            usage = {
                "id": usage_id, "experiment_id": experiment_id, "recipe_id": recipe_id,
                "material_id": material_id, "version": 1, "role": ingredient.get("role") or "unspecified",
                "basis_type": _basis_type(str(ingredient.get("basis") or recipe.get("basis") or ""), ingredient.get("unit")),
                "basis": ingredient.get("basis") or recipe.get("basis") or "unknown",
                "value_status": _status(ingredient.get("value_status")) if ingredient.get("value_status") else ("reported" if _known(ingredient.get("amount")) or ingredient.get("not_used") else "pending"), "not_used": bool(ingredient.get("not_used")),
                "evidence_ids": evidence_ids, "profile": _strip(ingredient, "material_identity", "evidence_ids", "amount", "unit"),
            }
            if amount is not None:
                usage["amount"] = amount
            entities["ingredient_usages"].append(usage); entity_types[usage_id] = "ingredient_usage"
            add_relation("HAS_USAGE", recipe_id, usage_id, usage["value_status"], evidence_ids)
            add_relation("USES_MATERIAL", usage_id, material_id, usage["value_status"], evidence_ids)
            if amount is not None and evidence_ids:
                add_assertion(usage_id, "amount", "HAS_REPORTED_AMOUNT", usage["value_status"], evidence_ids, amount)

        process = _obj(experiment.get("process"))
        route_id = f"ROUTE-{_token(experiment_id)}"
        route = {"id": route_id, "experiment_id": experiment_id, "version": 1, "route_type": process.get("process_type") or "reported_route", "value_status": _aggregate_status(process.get("inheritance_status")), "profile": _strip(process, "steps", "process_type")}
        entities["process_routes"].append(route); entity_types[route_id] = "process_route"
        add_relation("HAS_ROUTE", experiment_id, route_id, route["value_status"], experiment_evidence)
        known_states: list[tuple[str, str]] = []
        outputs_by_source: dict[tuple[str, str], list[str]] = {}
        input_link_methods: dict[tuple[int, str], str] = {}

        def state_for(label: str, step_order: int, direction: str, status: str, refs: list[str]) -> str:
            normalized = state_key(label)
            if direction == "IN":
                source_ref = re.match(r"^步骤\s*(\d+)\s*([a-z]?)\s*(?:所得|得到|后的?)", label, re.IGNORECASE)
                if source_ref:
                    candidates = outputs_by_source.get((source_ref[1], source_ref[2].lower()), [])
                    if len(candidates) == 1:
                        input_link_methods[(step_order, candidates[0])] = "explicit_source_step_reference"
                        return candidates[0]
                candidates = [sid for name, sid in known_states if normalized == name]
                if len(candidates) == 1:
                    return candidates[0]
            state_id = f"STATE-{_token(experiment_id)}-{step_order:03d}-{direction}"
            entities["material_states"].append({"id": state_id, "experiment_id": experiment_id, "version": 1, "name": label, "state_origin": "unknown", "value_status": status, "evidence_ids": refs, "profile": {"migration_note": "materialized from explicit v1 process state text"}})
            entity_types[state_id] = "material_state"; known_states.append((normalized, state_id))
            return state_id

        for ordinal, step in enumerate(_rows(process.get("steps")), start=1):
            order = step.get("order") if isinstance(step.get("order"), int) else ordinal
            step_id = f"STEP-{_token(experiment_id)}-{order:03d}"
            refs = _evidence_refs(step, experiment_evidence, fallback=True)
            parameter_keys = ["temperature", "duration", "pressure", "material_usage", "speed", "power", "repeat_count", "stages"]
            # A paired stage schedule is authoritative. Parallel temperature
            # and duration arrays are only a legacy display projection.
            if isinstance(step.get("stages"), list):
                parameter_keys = [key for key in parameter_keys if key not in {"temperature", "duration"}]
            parameters = {key: copy.deepcopy(step[key]) for key in parameter_keys if key in step}
            temperatures = step.get("temperature")
            durations = step.get("duration")
            if (
                "stages" not in parameters
                and isinstance(temperatures, list)
                and isinstance(durations, list)
                and len(temperatures) == len(durations)
                and temperatures
            ):
                parameters.pop("temperature", None)
                parameters.pop("duration", None)
                parameters["stages"] = [
                    {"stage": index, "temperature": copy.deepcopy(temperature), "duration": copy.deepcopy(duration)}
                    for index, (temperature, duration) in enumerate(zip(temperatures, durations), start=1)
                ]
            step_entity = {
                "id": step_id, "experiment_id": experiment_id, "route_id": route_id, "version": 1,
                "normalized_order": order, "source_step": step.get("source_step", f"N{order}"),
                "source_substep": step.get("source_substep"), "operation_type": step.get("type") or "reported_operation",
                "display_name_zh": step.get("display_name_zh") or str(step.get("type") or "工艺步骤（待校对）"),
                "source_text": step.get("source_text_zh") or step.get("source_text") or "",
                "value_status": route["value_status"], "parameters": parameters, "evidence_ids": refs,
                "profile": _strip(step, "order", "source_step", "source_substep", "type", "display_name_zh", "source_text_zh", "source_text", "input_state", "output_state", "evidence_ids", *parameters.keys()),
            }
            entities["process_steps"].append(step_entity); entity_types[step_id] = "process_step"
            add_relation("HAS_STEP", route_id, step_id, step_entity["value_status"], refs)
            if _known(step.get("input_state")):
                state_id = state_for(str(step["input_state"]), order, "IN", "reported", refs)
                method = input_link_methods.get((order, state_id))
                add_relation("CONSUMES", step_id, state_id, "inferred" if method else "reported", refs, {"inference_method": method, "needs_review": True} if method else {})
            if _known(step.get("output_state")):
                state_id = state_for(str(step["output_state"]), order, "OUT", "reported", refs)
                add_relation("PRODUCES", step_id, state_id, "reported", refs)
                source_key = (str(step_entity["source_step"]), str(step_entity.get("source_substep") or "").lower())
                outputs_by_source.setdefault(source_key, []).append(state_id)
            if refs:
                add_assertion(step_id, "source_text", "REPORTS_PROCESS_STEP", step_entity["value_status"], refs, step_entity["source_text"] or step_entity["display_name_zh"])

        specimens = _specimen_variants(experiment_id, _obj(experiment.get("specimen")))
        for specimen in specimens:
            refs = _evidence_refs(_obj(experiment.get("specimen")), experiment_evidence, fallback=True)
            specimen["evidence_ids"] = refs
            entities["specimens"].append(specimen); entity_types[specimen["id"]] = "specimen"
            add_relation("HAS_SPECIMEN", experiment_id, specimen["id"], specimen["value_status"], refs)
        for specimen in specimens:
            order = specimen.get("profile", {}).get("source_output_step_order") or _obj(experiment.get("specimen")).get("source_output_step_order")
            owner = f"STEP-{_token(experiment_id)}-{order:03d}" if isinstance(order, int) else None
            outputs = [r["object"]["id"] for r in relations if r["type"] == "PRODUCES" and r["subject"]["id"] == owner]
            if len(outputs) == 1:
                add_relation("SOURCE_OF", outputs[0], specimen["id"], "inferred", specimen["evidence_ids"], {"inference_method": "explicit_specimen_output_step", "needs_review": True})
            elif len(specimens) == 1:
                # Never attach the last state to an arbitrary multi-specimen row.
                outputs = [r["object"]["id"] for r in relations if r["type"] == "PRODUCES" and r["subject"]["id"].startswith(f"STEP-{_token(experiment_id)}-")]
                if outputs:
                    add_relation("SOURCE_OF", outputs[-1], specimen["id"], "inferred", [], {"inference_method": "last_explicit_process_output_to_single_specimen", "needs_review": True})

        test_profile = _obj(experiment.get("test"))
        for ordinal, prop in enumerate(_rows(experiment.get("properties")), start=1):
            source_property_name = str(prop.get("property_name") or f"property_{ordinal}")
            property_name = _canonical_property_type(source_property_name)
            specimen = _property_specimen(property_name, specimens)
            refs = _evidence_refs(prop, experiment_evidence, fallback=True)
            test_id = f"TEST-{_token(experiment_id)}-{ordinal:03d}"
            test = {
                "id": test_id, "experiment_id": experiment_id, "specimen_id": specimen["id"], "version": 1,
                "test_type": property_name, "method": test_profile.get("method") or test_profile.get("standard") or test_profile.get("property_type") or "NOT_REPORTED",
                "conditions": {**_strip(test_profile, "evidence_ids"), **_obj(prop.get("conditions"))},
                "value_status": "reported" if test_profile else "pending", "evidence_ids": refs,
            }
            entities["tests"].append(test); entity_types[test_id] = "test"
            add_relation("TESTED_BY", specimen["id"], test_id, test["value_status"], refs)
            observation_id = f"OBS-{_token(experiment_id)}-{ordinal:03d}"
            measurement = _measurement(prop.get("original_value"), prop.get("original_unit"), prop.get("normalized_value"), prop.get("normalized_unit"))
            observation_profile = _strip(prop, "property_name", "display_name_zh", "original_value", "original_unit", "normalized_value", "normalized_unit", "value_status", "conditions", "evidence_ids")
            if property_name != source_property_name:
                observation_profile["source_property_name"] = source_property_name
            observation = {
                "id": observation_id, "experiment_id": experiment_id, "test_id": test_id, "version": 1,
                "property_type": property_name, "display_name_zh": prop.get("display_name_zh") or source_property_name,
                "value_status": _status(prop.get("value_status")), "conditions": copy.deepcopy(_obj(prop.get("conditions"))),
                "evidence_ids": refs, "profile": observation_profile,
            }
            if measurement is not None:
                observation["value"] = measurement
            if prop.get("is_relative") or prop.get("baseline_observation_id"):
                observation["is_relative"] = True
                observation["baseline_experiment_id"] = prop.get("baseline_experiment_id") or experiment.get("baseline_experiment_code")
                observation["baseline_observation_id"] = prop.get("baseline_observation_id")
            entities["property_observations"].append(observation); entity_types[observation_id] = "property_observation"
            add_relation("YIELDS", test_id, observation_id, observation["value_status"], refs)
            if measurement is not None and refs:
                add_assertion(observation_id, "value", "HAS_PROPERTY_VALUE", observation["value_status"], refs, measurement)

        structure = _obj(experiment.get("structure"))
        characterization = _obj(experiment.get("characterization"))
        characterization_events = _rows(characterization.get("events"))
        if not characterization_events and structure:
            # Legacy aggregates stored method, images and observations together.
            # Materialize one event without inventing an instrument model or an
            # acquisition setting; the original structure object stays in profile.
            characterization_events = [{
                "method": structure.get("method") or structure.get("characterization_method"),
                "instrument": _obj(structure.get("instrument")),
                "acquisition_parameters": _obj(structure.get("acquisition_parameters")),
                "sample_preparation": _obj(structure.get("sample_preparation")),
                "media_artifacts": structure.get("media_artifacts") or structure.get("images") or structure.get("figures") or [],
                "observations": structure.get("observed_results") or structure.get("observations") or [],
                "evidence_ids": structure.get("evidence_ids") or structure.get("evidence_id") or [],
                "legacy_structure_profile": copy.deepcopy(structure),
            }]

        for event_ordinal, event in enumerate(characterization_events, start=1):
            instrument_source = _obj(event.get("instrument"))
            raw_method = (
                event.get("technique_code") or event.get("abbreviation") or event.get("method")
                or instrument_source.get("technique_code") or instrument_source.get("abbreviation")
                or instrument_source.get("name") or "NOT_REPORTED"
            )
            technique_code = _technique_code(raw_method)
            catalog = copy.deepcopy(CHARACTERIZATION_TECHNIQUES.get(technique_code, {}))
            refs = _evidence_refs(event, experiment_evidence, fallback=True)
            event_status = "reported" if technique_code != "NOT_REPORTED" and refs else "pending"
            target_source = _obj(event.get("target"))
            explicit_target_value = (
                event.get("specimen_id") or event.get("material_state_id") or event.get("material_id")
                or target_source.get("id") or target_source.get("entity_id")
            )
            explicit_target_id = (
                explicit_target_value
                if isinstance(explicit_target_value, str)
                and entity_types.get(explicit_target_value) in {"specimen", "material_state", "material"}
                else None
            )
            target_id = explicit_target_id or specimens[0]["id"]
            target_type = entity_types[target_id]
            target_status = event_status
            target_resolution = "explicit_entity_id" if explicit_target_id else "single_reported_specimen"
            target_name = str(target_source.get("name") or event.get("target_name") or event.get("target_specimen_kind") or "").strip().casefold()
            if target_name and not explicit_target_id:
                candidates = [
                    row for row in specimens
                    if target_name in str(row.get("name") or "").casefold()
                    or target_name == str(row.get("specimen_kind") or "").casefold()
                ]
                if len(candidates) == 1:
                    target_id = candidates[0]["id"]
                    target_type = "specimen"
                    target_resolution = "matched_reported_specimen"
            if len(specimens) > 1 and target_resolution == "single_reported_specimen":
                # Preserve a connected graph for legacy records while making the
                # unresolved target explicit instead of presenting it as fact.
                target_status = "pending"
                target_resolution = "ambiguous_default_first_specimen_needs_review"
            instrument_id: str | None = None
            if technique_code != "NOT_REPORTED":
                instrument_id = f"INST-{_token(experiment_id)}-{_token(technique_code)}-{event_ordinal:03d}"
                instrument = {
                    "id": instrument_id, "experiment_id": experiment_id, "version": 1,
                    "instrument_type": instrument_source.get("instrument_type") or catalog.get("instrument_type") or "characterization_instrument",
                    "technique_code": technique_code,
                    "display_name_zh": instrument_source.get("display_name_zh") or catalog.get("display_name_zh") or str(raw_method),
                    "abbreviation": instrument_source.get("abbreviation") or technique_code,
                    "manufacturer": instrument_source.get("manufacturer"), "model": instrument_source.get("model"),
                    "reported_spatial_resolution": copy.deepcopy(instrument_source.get("reported_spatial_resolution")),
                    "capability_reference": catalog,
                    "value_status": event_status, "evidence_ids": refs,
                    "profile": _strip(instrument_source, "instrument_type", "technique_code", "display_name_zh", "abbreviation", "manufacturer", "model", "reported_spatial_resolution", "evidence_ids"),
                }
                entities["characterization_instruments"].append(instrument)
                entity_types[instrument_id] = "characterization_instrument"

            event_id = f"CHAR-{_token(experiment_id)}-{event_ordinal:03d}"
            event_entity = {
                "id": event_id, "experiment_id": experiment_id, "version": 1,
                "instrument_id": instrument_id,
                "technique_code": technique_code,
                "acquisition_parameters": copy.deepcopy(_obj(event.get("acquisition_parameters"))),
                "sample_preparation": copy.deepcopy(_obj(event.get("sample_preparation"))),
                "value_status": event_status, "evidence_ids": refs,
                "profile": {
                    **_strip(event, "instrument", "technique_code", "abbreviation", "method", "acquisition_parameters", "sample_preparation", "media_artifacts", "media", "images", "figures", "observations", "evidence_ids"),
                    "target_resolution": target_resolution,
                },
            }
            event_entity[{"specimen": "specimen_id", "material_state": "material_state_id", "material": "material_id"}[target_type]] = target_id
            entities["characterization_events"].append(event_entity)
            entity_types[event_id] = "characterization_event"
            add_relation("HAS_CHARACTERIZATION", experiment_id, event_id, event_status, refs)
            add_relation("CHARACTERIZES", event_id, target_id, target_status, refs, {"target_resolution": target_resolution})
            if instrument_id:
                add_relation("USES_INSTRUMENT", event_id, instrument_id, event_status, refs)

            media_ids: list[str] = []
            media_rows = _rows(event.get("media_artifacts") or event.get("media") or event.get("images") or event.get("figures"))
            for media_ordinal, media in enumerate(media_rows, start=1):
                media_id = f"MEDIA-{_token(experiment_id)}-{event_ordinal:03d}-{media_ordinal:03d}"
                media_refs = _evidence_refs(media, experiment_evidence) or refs
                media_entity = {
                    "id": media_id, "experiment_id": experiment_id,
                    "characterization_event_id": event_id, "version": 1,
                    "artifact_type": _artifact_type(media.get("artifact_type"), media.get("image_type")),
                    "media_type": media.get("media_type") or "image/unknown",
                    "image_type": media.get("image_type"),
                    "source_locator": copy.deepcopy(_obj(media.get("source_locator"))),
                    "storage_uri": media.get("storage_uri"),
                    "channels": copy.deepcopy(media.get("channels") if isinstance(media.get("channels"), list) else []),
                    "scale_bar": copy.deepcopy(_obj(media.get("scale_bar"))),
                    "value_status": "reported" if media_refs else "pending", "evidence_ids": media_refs,
                    "profile": _strip(media, "artifact_type", "media_type", "image_type", "source_locator", "storage_uri", "channels", "scale_bar", "evidence_ids"),
                }
                entities["media_artifacts"].append(media_entity)
                entity_types[media_id] = "media_artifact"
                media_ids.append(media_id)
                add_relation("GENERATES", event_id, media_id, media_entity["value_status"], media_refs)

            observations = _observation_rows(event.get("observations"))
            if not observations and event.get("legacy_structure_profile"):
                observations = [{
                    "observation_type": structure.get("observation_type") or "reported_structure",
                    "description": structure.get("description") or structure.get("finding") or structure.get("result"),
                    "quantitative_descriptors": _obj(structure.get("quantitative_descriptors")),
                    "evidence_ids": structure.get("evidence_ids") or structure.get("evidence_id") or [],
                    "legacy_structure_profile": copy.deepcopy(structure),
                }]
            for observation_ordinal, observation in enumerate(observations, start=1):
                structure_id = f"STRUCT-{_token(experiment_id)}-{event_ordinal:03d}-{observation_ordinal:03d}"
                observation_refs = _evidence_refs(observation, experiment_evidence) or refs
                structure_entity = {
                    "id": structure_id, "experiment_id": experiment_id, "version": 1,
                    "method": technique_code, "characterization_event_id": event_id,
                    "observation_type": observation.get("observation_type") or observation.get("type") or "reported_structure",
                    "description": observation.get("description") or observation.get("finding") or observation.get("result"),
                    "quantitative_descriptors": copy.deepcopy(_obj(observation.get("quantitative_descriptors"))),
                    "value_status": "reported" if observation_refs else "pending", "evidence_ids": observation_refs,
                    "profile": _strip(observation, "observation_type", "type", "description", "finding", "result", "quantitative_descriptors", "evidence_ids"),
                }
                entities["structure_observations"].append(structure_entity)
                entity_types[structure_id] = "structure_observation"
                add_relation("YIELDS_STRUCTURE", event_id, structure_id, structure_entity["value_status"], observation_refs)
                requested_media = observation.get("media_artifact_ids") if isinstance(observation.get("media_artifact_ids"), list) else media_ids
                for media_id in requested_media:
                    if media_id in entity_types and entity_types[media_id] == "media_artifact":
                        add_relation("DERIVED_FROM", structure_id, media_id, structure_entity["value_status"], observation_refs)

        mechanism = _obj(experiment.get("mechanism"))
        if any(_known(v) for v in mechanism.values()):
            mechanism_id = f"MECH-{_token(experiment_id)}-001"
            refs = _evidence_refs(mechanism, experiment_evidence)
            mechanism_entity = {"id": mechanism_id, "experiment_id": experiment_id, "version": 1, "mechanism_type": mechanism.get("mechanism_type") or "source_hypothesis", "description": mechanism.get("description") or json.dumps(mechanism, ensure_ascii=False, sort_keys=True), "value_status": "inferred" if not refs else "reported", "evidence_ids": refs, "profile": copy.deepcopy(mechanism)}
            entities["mechanism_hypotheses"].append(mechanism_entity); entity_types[mechanism_id] = "mechanism_hypothesis"
            add_relation("HAS_MECHANISM", experiment_id, mechanism_id, mechanism_entity["value_status"], refs)

        simulation = _obj(experiment.get("simulation"))
        if simulation.get("simulation_available") is True:
            simulation_id = f"SIM-{_token(experiment_id)}-001"
            refs = _evidence_refs(simulation, experiment_evidence)
            simulation_entity = {"id": simulation_id, "experiment_id": experiment_id, "version": 1, "simulation_type": simulation.get("simulation_type") or "unspecified", "scale": simulation.get("scale") or "unspecified", "value_status": "predicted", "evidence_ids": refs, "profile": copy.deepcopy(simulation)}
            entities["simulation_studies"].append(simulation_entity); entity_types[simulation_id] = "simulation_study"
            add_relation("HAS_SIMULATION", experiment_id, simulation_id, "predicted", refs)

        baseline = experiment.get("baseline_experiment_code")
        if baseline and baseline in included_experiments:
            comparison_id = f"CMP-{_token(experiment_id)}-TO-{_token(str(baseline))}"
            comparison = {"id": comparison_id, "experiment_id": experiment_id, "baseline_experiment_id": baseline, "version": 1, "comparability_status": "needs_review", "value_status": "reported", "profile": {"migration_note": "baseline link preserved from v1"}}
            entities["comparisons"].append(comparison); entity_types[comparison_id] = "comparison"
            add_relation("HAS_COMPARISON", experiment_id, comparison_id, "reported", experiment_evidence)
            add_relation("COMPARES_TO", comparison_id, str(baseline), "reported", experiment_evidence)

        quality = _obj(experiment.get("quality"))
        quality_assessments.append({
            "id": f"QA-{_token(experiment_id)}-MIGRATION", "experiment_id": experiment_id,
            "assessment_type": "legacy_migration", "dimensions": copy.deepcopy(_obj(quality.get("dimensions")) or quality),
            "overall_score": quality.get("overall_score"), "status": "needs_review",
            "profile": {"execution_readiness": copy.deepcopy(experiment.get("execution_readiness"))},
        })

    generated_at = value.get("generated_at")
    if not generated_at:
        curated = str(value.get("curated_at") or "1970-01-01")
        generated_at = curated if "T" in curated else f"{curated}T00:00:00Z"
    package = {
        # The v1 adapter deliberately emits the established 1.1 contract.
        # Ontology 1.2 requires a real multi-document manifest and must not be
        # fabricated while adapting legacy rows.
        "package_version": PACKAGE_VERSION, "schema_version": "rpsme-ontology-1.1",
        "experiment_contract": EXPERIMENT_CONTRACT, "prompt_version": PROMPT_VERSION,
        "generated_at": generated_at,
        "generator": {"name": "materials-knowledge-os-v1-to-v2-adapter", "version": "1.0.0", "deterministic": True},
        "source": source, "experiment_records": experiment_records, "entities": entities,
        "relations": relations, "assertions": assertions, "evidence": evidence,
        "quality_assessments": quality_assessments,
        "migration": {"source_contract": value.get("package_version") or value.get("dataset_version") or value.get("schema_version"), "loss_policy": "preserve_in_experiment_record.profile.legacy_snapshot", "review_status": "needs_extraction_review"},
    }
    return enrich_material_flow(package)
