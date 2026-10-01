"""Lossless deterministic upgrade from RPSME Ontology 1.0-1.2 to 1.3.

This adapter creates compatibility mentions/runs/references only from facts
already present in the source package. It never claims that an asset is bundled
or that a simulation is reproducible when the required files are absent.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from typing import Any

from .vocabulary import BUNDLE_VERSION, CONTRACT_SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS


NEW_COLLECTIONS = ("instrument_mentions", "simulation_runs", "simulation_parameters", "asset_references")


def _rows(value: Any) -> list[dict[str, Any]]:
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _obj(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _token(value: str) -> str:
    readable = re.sub(r"[^A-Z0-9._:-]+", "-", value.upper()).strip("-")
    if readable and len(readable) <= 72:
        return readable
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:16].upper()
    return f"V13-{digest}"


def _edge_id(kind: str, subject: str, object_: str) -> str:
    digest = hashlib.sha256(f"{kind}|{subject}|{object_}".encode()).hexdigest()[:20].upper()
    return f"EDGE-{digest}"


def _add_relation(relations: list[dict[str, Any]], kind: str, subject_type: str, subject: str, object_type: str, object_: str, evidence_ids: list[str]) -> None:
    triple = (kind, subject, object_)
    if any((row.get("type"), _obj(row.get("subject")).get("id"), _obj(row.get("object")).get("id")) == triple for row in relations):
        return
    relations.append({
        "id": _edge_id(kind, subject, object_),
        "type": kind,
        "subject": {"type": subject_type, "id": subject},
        "object": {"type": object_type, "id": object_},
        "value_status": "reported" if evidence_ids else "inferred",
        "evidence_ids": evidence_ids,
        "profile": {} if evidence_ids else {"inference_method": "deterministic_v1.3_compatibility_adapter"},
    })


def _flatten_parameters(prefix: str, value: Any) -> list[tuple[str, Any]]:
    if isinstance(value, dict):
        result: list[tuple[str, Any]] = []
        for key in sorted(value):
            result.extend(_flatten_parameters(f"{prefix}.{key}" if prefix else str(key), value[key]))
        return result
    if isinstance(value, list):
        return [(prefix, copy.deepcopy(value))]
    return [(prefix, copy.deepcopy(value))]


def _reproducibility(study: dict[str, Any], parameter_count: int) -> dict[str, Any]:
    software_known = bool(study.get("software") or study.get("solver"))
    protocol_known = bool(study.get("run_protocol"))
    if software_known and (parameter_count or protocol_known):
        level = "R2"
    elif software_known or study.get("simulation_type"):
        level = "R1"
    else:
        level = "R0"
    missing = ["complete_input_structure", "complete_input_script"]
    if not study.get("software_version"):
        missing.append("software_version")
    if not study.get("run_protocol"):
        missing.append("complete_run_protocol")
    return {
        "level": level,
        "source_parameter_coverage": min(1.0, parameter_count / 8) if parameter_count else 0.0,
        "protocol_completeness": 0.5 if protocol_known else 0.0,
        "input_artifact_availability": "none",
        "missing_reproduction_fields": missing,
        "rerun_status": "not_requested",
        "result_match_tolerance": None,
        "result_match_status": "not_evaluated",
    }


def upgrade_package_to_v13(package: dict[str, Any]) -> dict[str, Any]:
    """Return a deterministic, non-mutating 1.3 compatibility package."""

    source_version = package.get("schema_version")
    if source_version not in SUPPORTED_SCHEMA_VERSIONS:
        raise ValueError(f"unsupported source schema version: {source_version!r}")
    if source_version == CONTRACT_SCHEMA_VERSION:
        return copy.deepcopy(package)
    if not _obj(package.get("document_set")).get("documents"):
        raise ValueError("upgrading ontology 1.0/1.1 to 1.3 requires a verified document_set with file hashes and page counts")
    result = copy.deepcopy(package)
    result["schema_version"] = CONTRACT_SCHEMA_VERSION
    result["bundle"] = {"bundle_version": BUNDLE_VERSION, "delivery_mode": "json_only", "manifest_path": None, "profile": {}}
    result["asset_manifest"] = {"bundle_version": BUNDLE_VERSION, "assets": [], "profile": {"content_addressed": True}}
    entities = result.setdefault("entities", {})
    for collection in NEW_COLLECTIONS:
        entities[collection] = []
    relations = result.setdefault("relations", [])

    instruments = {row.get("id"): row for row in _rows(entities.get("characterization_instruments"))}
    mentions_by_instrument: dict[str, str] = {}
    for instrument_id, instrument in instruments.items():
        if not instrument_id:
            continue
        manufacturer = instrument.get("manufacturer")
        model = instrument.get("model")
        evidence_ids = list(instrument.get("evidence_ids") or [])
        resolved = bool(manufacturer and model)
        status = "resolved" if resolved else "unresolved_model"
        candidate = None
        if resolved:
            canonical_key = f"{str(manufacturer).strip().casefold()}::{str(model).strip().casefold()}"
            candidate = {
                "canonical_key": canonical_key,
                "manufacturer_normalized": str(manufacturer).strip(),
                "model_normalized": str(model).strip(),
                "confidence": 1.0,
            }
        instrument["normalization_status"] = status
        instrument["instrument_model_candidate"] = copy.deepcopy(candidate)
        mention_id = f"IM-{_token(str(instrument_id))}"
        mentions_by_instrument[str(instrument_id)] = mention_id
        raw = " ".join(str(value).strip() for value in (manufacturer, model, instrument.get("technique_code")) if value)
        entities["instrument_mentions"].append({
            "id": mention_id,
            "experiment_id": instrument.get("experiment_id"),
            "version": 1,
            "technique_code": instrument.get("technique_code") or "NOT_REPORTED",
            "raw_text": raw or "原文仅报告表征技术，未报告仪器型号",
            "manufacturer_raw": manufacturer,
            "model_raw": model,
            "normalization_status": status,
            "instrument_model_candidate": copy.deepcopy(candidate),
            "normalization_confidence": 1.0 if resolved else None,
            "value_status": "reported" if evidence_ids else "pending",
            "evidence_ids": evidence_ids,
            "profile": {"adapter_origin": "characterization_instrument"},
        })
        if resolved:
            _add_relation(relations, "RESOLVES_TO", "instrument_mention", mention_id, "characterization_instrument", str(instrument_id), evidence_ids)

    for event in _rows(entities.get("characterization_events")):
        event["acquisition_completeness"] = "partial" if event.get("acquisition_parameters") else "minimal"
        instrument_id = event.get("instrument_id")
        mention_id = mentions_by_instrument.get(str(instrument_id))
        if mention_id:
            event["instrument_mention_id"] = mention_id
            _add_relation(relations, "USES_INSTRUMENT", "characterization_event", str(event.get("id")), "instrument_mention", mention_id, list(event.get("evidence_ids") or []))

    assets: dict[str, dict[str, Any]] = {}
    asset_id_by_hash: dict[str, str] = {}
    for media in _rows(entities.get("media_artifacts")):
        checksum = media.get("sha256")
        asset_id = asset_id_by_hash.get(str(checksum)) if checksum else None
        if not asset_id:
            asset_id = f"ASSET-{str(checksum)[:20].upper()}" if checksum else f"ASSET-{_token(str(media.get('id')))}"
            if checksum:
                asset_id_by_hash[str(checksum)] = asset_id
        origin_type = media.get("origin_type") or "pdf_extracted"
        availability = "external" if checksum and media.get("storage_uri") else "locator_only"
        if asset_id not in assets:
            assets[asset_id] = {
                "asset_id": asset_id,
                "relative_path": None,
                "sha256": checksum if isinstance(checksum, str) else None,
                "byte_size": _obj(media.get("profile")).get("byte_size"),
                "media_type": media.get("media_type") or "application/octet-stream",
                "origin_type": origin_type,
                "availability_status": availability,
                "source_document_id": _obj(media.get("source_locator")).get("document_id"),
                "parent_asset_id": media.get("parent_asset_id"),
                "source_locator": copy.deepcopy(media.get("source_locator") or {}),
                "derivation": {},
                "rights": {"access_level": "unknown", "redistribution_allowed": None, "rights_basis": "not_reported_by_legacy_package", "license": None, "notes": None},
                "profile": {"legacy_storage_uri": media.get("storage_uri")},
            }
        media["asset_id"] = asset_id
        media["origin_type"] = origin_type
        media["availability_status"] = availability
        ref_id = f"AR-{_token(str(media.get('id')))}"
        entities["asset_references"].append({
            "id": ref_id,
            "experiment_id": media.get("experiment_id"),
            "version": 1,
            "asset_id": asset_id,
            "asset_role": "published_panel" if _obj(media.get("source_locator")).get("panel") else "published_figure",
            "origin_type": origin_type,
            "availability_status": availability,
            "source_locator": copy.deepcopy(media.get("source_locator") or {}),
            "value_status": media.get("value_status") or "reported",
            "evidence_ids": list(media.get("evidence_ids") or []),
            "profile": {},
        })
        _add_relation(relations, "HAS_ASSET", "media_artifact", str(media.get("id")), "asset_reference", ref_id, list(media.get("evidence_ids") or []))
    result["asset_manifest"]["assets"] = list(assets.values())

    run_by_study: dict[str, str] = {}
    for study in _rows(entities.get("simulation_studies")):
        study_id = str(study.get("id"))
        evidence_ids = list(study.get("evidence_ids") or [])
        flattened: list[tuple[str, str, Any, str]] = []
        for namespace, role in (("input_parameters", "method"), ("boundary_conditions", "boundary_condition"), ("material_models", "model"), ("run_protocol", "runtime")):
            for key, value in _flatten_parameters("", study.get(namespace)):
                if key:
                    flattened.append((namespace, key, value, role))
        assessment = _reproducibility(study, len(flattened))
        study["scientific_question"] = study.get("scientific_question") or _obj(study.get("profile")).get("scientific_question")
        study["modeled_entity_refs"] = study.get("modeled_entity_refs") or []
        study["reproducibility_assessment"] = copy.deepcopy(assessment)
        run_id = f"RUN-{_token(study_id)}-LEGACY"
        run_by_study[study_id] = run_id
        entities["simulation_runs"].append({
            "id": run_id,
            "experiment_id": study.get("experiment_id"),
            "version": 1,
            "simulation_study_id": study_id,
            "run_label": "来源报告运行（1.3 兼容拆分）",
            "origin_type": "author_reported",
            "run_status": "input_partial" if flattened else "described",
            "software": study.get("software"),
            "software_version": study.get("software_version"),
            "solver": study.get("solver"),
            "environment": {},
            "random_seed": None,
            "reproducibility_assessment": copy.deepcopy(assessment),
            "value_status": "reported" if evidence_ids else "pending",
            "evidence_ids": evidence_ids,
            "profile": {"adapter_origin": "legacy_simulation_study"},
        })
        _add_relation(relations, "HAS_RUN", "simulation_study", study_id, "simulation_run", run_id, evidence_ids)
        for ordinal, (namespace, key, value, role) in enumerate(flattened, 1):
            parameter_id = f"PARAM-{_token(study_id)}-{ordinal:03d}"
            entities["simulation_parameters"].append({
                "id": parameter_id,
                "experiment_id": study.get("experiment_id"),
                "version": 1,
                "simulation_run_id": run_id,
                "namespace": namespace,
                "parameter_key": key,
                "parameter_role": role,
                "value": value,
                "unit": None,
                "dimension": None,
                "normalized_value": None,
                "normalized_unit": None,
                "value_status": "reported" if evidence_ids else "pending",
                "evidence_ids": evidence_ids,
                "profile": {},
            })
            _add_relation(relations, "HAS_PARAMETER", "simulation_run", run_id, "simulation_parameter", parameter_id, evidence_ids)

    for simulation_result in _rows(entities.get("simulation_results")):
        study_id = str(simulation_result.get("simulation_study_id"))
        run_id = run_by_study.get(study_id)
        if not run_id:
            continue
        simulation_result["simulation_run_id"] = run_id
        simulation_result["provenance_status"] = simulation_result.get("provenance_status") or "author_reported"
        simulation_result.setdefault("result_tolerance", None)
        _add_relation(relations, "YIELDS_SIMULATION_RESULT", "simulation_run", run_id, "simulation_result", str(simulation_result.get("id")), list(simulation_result.get("evidence_ids") or []))

    migration = result.setdefault("migration", {})
    migration.update({
        "source_schema_version": source_version,
        "target_schema_version": CONTRACT_SCHEMA_VERSION,
        "adapter": "upgrade_package_to_v13",
        "loss_policy": "preserve_all_legacy_fields_and_add_compatibility_entities",
    })
    return result


def canonical_json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
