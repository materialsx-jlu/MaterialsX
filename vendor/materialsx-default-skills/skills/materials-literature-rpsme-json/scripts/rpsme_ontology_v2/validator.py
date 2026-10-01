"""Package-level structural and semantic validation for RPSME Ontology v2."""

from __future__ import annotations

import json
import posixpath
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from .material_identity import check_material_identities

from .vocabulary import (
    COLLECTION_ENTITY_TYPES,
    BUNDLE_VERSION,
    CONTRACT_SCHEMA_VERSION,
    DOCUMENT_SET_SCHEMA_VERSIONS,
    ENTITY_COLLECTIONS,
    OPTIONAL_ENTITY_COLLECTIONS,
    OPPORTUNITY_SCHEMA_VERSION,
    EXPERIMENT_CONTRACT,
    PACKAGE_VERSION,
    RELATION_ENDPOINTS,
    SCHEMA_VERSION,
    SUPPORTED_SCHEMA_VERSIONS,
    UNIT_DIMENSIONS,
    UNKNOWN_TOKENS,
    VALUE_STATUSES,
)


@dataclass(frozen=True)
class ValidationIssue:
    severity: str
    code: str
    path: str
    message: str


@dataclass
class ValidationReport:
    issues: list[ValidationIssue]

    @property
    def errors(self) -> list[ValidationIssue]:
        return [item for item in self.issues if item.severity == "error"]

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [item for item in self.issues if item.severity == "warning"]

    @property
    def valid(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "error_count": len(self.errors),
            "warning_count": len(self.warnings),
            "issues": [asdict(item) for item in self.issues],
        }


def _rows(value: Any) -> list[dict[str, Any]]:
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _obj(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _flow_token(value: Any) -> str:
    """Normalize only for detecting a source-visible input dropped by assembly."""
    return re.sub(r"[^0-9a-z\u3400-\u9fff]+", "", str(value or "").casefold())


def _detect_jsonschema_issues(package: dict[str, Any], schema_path: Path) -> list[ValidationIssue]:
    try:
        import jsonschema  # type: ignore
    except ImportError:
        return []
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())
    issues = []
    for error in sorted(validator.iter_errors(package), key=lambda item: list(item.absolute_path)):
        path = "$" + "".join(f"[{part}]" if isinstance(part, int) else f".{part}" for part in error.absolute_path)
        issues.append(ValidationIssue("error", "SCHEMA", path, error.message))
    return issues


def validate_package(package: dict[str, Any], schema_path: str | Path | None = None) -> ValidationReport:
    issues: list[ValidationIssue] = []

    def add(severity: str, code: str, path: str, message: str) -> None:
        issues.append(ValidationIssue(severity, code, path, message))

    for path, message in check_material_identities(package):
        add("error", "MATERIAL_IDENTITY", path, message)

    required = {
        "package_version", "schema_version", "experiment_contract", "prompt_version", "generated_at",
        "generator", "source", "experiment_records", "entities", "relations", "assertions", "evidence",
        "quality_assessments",
    }
    for key in sorted(required - set(package)):
        add("error", "REQUIRED", f"$.{key}", "missing required top-level field")
    constants = {
        "package_version": PACKAGE_VERSION,
        "schema_version": SCHEMA_VERSION,
        "experiment_contract": EXPERIMENT_CONTRACT,
    }
    for key, expected in constants.items():
        if package.get(key) != expected and not (key == "schema_version" and package.get(key) in SUPPORTED_SCHEMA_VERSIONS):
            add("error", "VERSION", f"$.{key}", f"expected {expected!r}")

    source = _obj(package.get("source"))
    source_id = source.get("id")
    if not isinstance(source_id, str) or not source_id:
        add("error", "SOURCE_ID", "$.source.id", "source document requires a stable id")
    if not source.get("publication_number"):
        add("error", "PUBLICATION", "$.source.publication_number", "publication number is required")
    if source.get("source_type") not in {
        "patent", "paper", "master_thesis", "doctoral_thesis", "report", "standard", "internal_experiment"
    }:
        add("error", "SOURCE_TYPE", "$.source.source_type", "unsupported material source type")
    source_key = str(source.get("publication_number") or "")
    if source.get("source_type") == "patent" and not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{5,}", source_key):
        add("error", "PUBLICATION", "$.source.publication_number", "patent publication number must match ^[A-Z]{2}[A-Z0-9]{5,}$")
    if source.get("source_type") != "patent" and source_key and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}", source_key):
        add("error", "SOURCE_IDENTIFIER", "$.source.publication_number", "non-patent source identifier contains unsupported characters")
    if source.get("source_type") == "patent" and not source.get("canonical_url"):
        add("error", "SOURCE_URL", "$.source.canonical_url", "patent source requires a canonical URL")
    if "upload" in source or "uploaded_by" in source or "uploaded_at" in source:
        add("error", "RECEIVER_OWNED_FIELD", "$.source", "external packages cannot specify uploader identity or ingestion time")

    document_ids: list[str] = []
    if package.get("schema_version") in DOCUMENT_SET_SCHEMA_VERSIONS:
        document_set = _obj(package.get("document_set"))
        documents = _rows(document_set.get("documents"))
        document_ids = [str(item.get("document_id") or "") for item in documents]
        if not documents:
            add("error", "DOCUMENT_SET", "$.document_set.documents", "ontology 1.2+ requires at least one source document")
        if len(document_ids) != len(set(document_ids)):
            add("error", "DOCUMENT_SET", "$.document_set.documents", "document_id values must be unique")
        primary = document_set.get("primary_document_id")
        if primary not in document_ids:
            add("error", "DOCUMENT_SET", "$.document_set.primary_document_id", "primary document must exist in documents")
        elif next((item for item in documents if item.get("document_id") == primary), {}).get("role") != "main":
            add("error", "DOCUMENT_SET", "$.document_set.primary_document_id", "primary document must have role=main")
        for index, item in enumerate(documents):
            if not re.fullmatch(r"[a-f0-9]{64}", str(item.get("sha256") or "")):
                add("error", "DOCUMENT_HASH", f"$.document_set.documents[{index}].sha256", "sha256 must be 64 lowercase hex characters")

    if package.get("schema_version") in {CONTRACT_SCHEMA_VERSION, OPPORTUNITY_SCHEMA_VERSION}:
        bundle = _obj(package.get("bundle"))
        asset_manifest = _obj(package.get("asset_manifest"))
        if bundle.get("bundle_version") != BUNDLE_VERSION:
            add("error", "BUNDLE_VERSION", "$.bundle.bundle_version", f"ontology 1.3 requires {BUNDLE_VERSION}")
        if bundle.get("delivery_mode") not in {"json_only", "bundle"}:
            add("error", "BUNDLE_MODE", "$.bundle.delivery_mode", "delivery_mode must be json_only or bundle")
        if asset_manifest.get("bundle_version") != BUNDLE_VERSION:
            add("error", "BUNDLE_VERSION", "$.asset_manifest.bundle_version", f"asset manifest must use {BUNDLE_VERSION}")

    entities = _obj(package.get("entities"))
    for collection in ENTITY_COLLECTIONS:
        if collection not in entities and collection not in OPTIONAL_ENTITY_COLLECTIONS:
            add("error", "ENTITY_COLLECTION", f"$.entities.{collection}", "missing entity collection")
        elif collection in entities and not isinstance(entities[collection], list):
            add("error", "ENTITY_COLLECTION", f"$.entities.{collection}", "entity collection must be an array")

    node_types: dict[str, str] = {}
    node_experiments: dict[str, str | None] = {}

    def register(node_id: Any, node_type: str, experiment_id: Any, path: str) -> None:
        if not isinstance(node_id, str) or not node_id:
            add("error", "ENTITY_ID", f"{path}.id", "stable entity id is required")
            return
        if node_id in node_types:
            add("error", "DUPLICATE_ID", f"{path}.id", f"duplicate id {node_id}")
            return
        node_types[node_id] = node_type
        node_experiments[node_id] = experiment_id if isinstance(experiment_id, str) else None

    if isinstance(source_id, str) and source_id:
        register(source_id, "source_document", None, "$.source")
    experiment_records = _rows(package.get("experiment_records"))
    material_flow_by_experiment: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(experiment_records):
        register(row.get("id"), "experiment_record", row.get("id"), f"$.experiment_records[{index}]")
        if isinstance(row.get("id"), str):
            material_flow_by_experiment[row["id"]] = _obj(_obj(row.get("profile")).get("material_flow"))
        if row.get("source_id") != source_id:
            add("error", "SOURCE_BOUNDARY", f"$.experiment_records[{index}].source_id", "experiment must belong to package source")
        if row.get("record_status") not in {"needs_source_action", "needs_extraction_review", "ready_for_primary_review"}:
            add("error", "RECORD_STATUS", f"$.experiment_records[{index}].record_status", "invalid pre-review record status")

    entity_index: dict[str, dict[str, Any]] = {}
    for collection in ENTITY_COLLECTIONS:
        for index, row in enumerate(_rows(entities.get(collection))):
            path = f"$.entities.{collection}[{index}]"
            register(row.get("id"), COLLECTION_ENTITY_TYPES[collection], row.get("experiment_id"), path)
            if isinstance(row.get("id"), str):
                entity_index[row["id"]] = row
            status = row.get("value_status")
            if status is not None and status not in VALUE_STATUSES:
                add("error", "VALUE_STATUS", f"{path}.value_status", f"invalid value status {status!r}")

    experiment_ids = {str(row.get("id")) for row in experiment_records if row.get("id")}
    recipes_by_experiment: dict[str, list[dict[str, Any]]] = {}
    routes_by_experiment: dict[str, list[dict[str, Any]]] = {}
    for recipe in _rows(entities.get("recipes")):
        recipes_by_experiment.setdefault(str(recipe.get("experiment_id") or ""), []).append(recipe)
    for route in _rows(entities.get("process_routes")):
        routes_by_experiment.setdefault(str(route.get("experiment_id") or ""), []).append(route)
    allowed_recipe_scopes = {"direct", "inherited_and_hydrated", "opaque_commercial_product", "not_applicable", "unresolved_with_reason"}
    for index, record in enumerate(experiment_records):
        record_id = str(record.get("id") or "")
        profile = _obj(record.get("profile"))
        parent_id = str(profile.get("preparation_parent_experiment_id") or "")
        scope = _obj(profile.get("recipe_scope"))
        scope_status = str(scope.get("status") or "")
        if scope_status and scope_status not in allowed_recipe_scopes:
            add("error", "RECIPE_SCOPE", f"$.experiment_records[{index}].profile.recipe_scope.status", "unsupported recipe scope status")
        if parent_id:
            if parent_id == record_id or parent_id not in experiment_ids:
                add("error", "PREPARATION_PARENT", f"$.experiment_records[{index}].profile.preparation_parent_experiment_id", "preparation parent must be another experiment in this package")
            if not recipes_by_experiment.get(record_id):
                add("error", "UNHYDRATED_PREPARATION", f"$.experiment_records[{index}]", "preparation child requires its own experiment-scoped hydrated recipe")
            if not routes_by_experiment.get(record_id):
                add("error", "UNHYDRATED_PREPARATION", f"$.experiment_records[{index}]", "preparation child requires an experiment-scoped process route")
            if scope_status != "inherited_and_hydrated":
                add("error", "RECIPE_SCOPE", f"$.experiment_records[{index}].profile.recipe_scope", "preparation child must declare inherited_and_hydrated recipe scope")
        if not recipes_by_experiment.get(record_id) and not scope_status:
            add("warning", "UNEXPLAINED_EMPTY_RECIPE", f"$.experiment_records[{index}]", "retained experiment has no recipe and no explicit recipe_scope classification")

    evidence_rows = _rows(package.get("evidence"))
    evidence_ids: set[str] = set()
    evidence_by_id: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(evidence_rows):
        path = f"$.evidence[{index}]"
        evidence_id = row.get("id")
        if not isinstance(evidence_id, str) or not evidence_id:
            add("error", "EVIDENCE_ID", f"{path}.id", "evidence id is required")
            continue
        if evidence_id in evidence_ids or evidence_id in node_types:
            add("error", "DUPLICATE_ID", f"{path}.id", f"duplicate id {evidence_id}")
        evidence_ids.add(evidence_id); evidence_by_id[evidence_id] = row
        if row.get("source_id") != source_id:
            add("error", "EVIDENCE_SOURCE", f"{path}.source_id", "evidence must belong to package source")
        document_element = row.get("document_element_id")
        if document_element and node_types.get(document_element) != "document_element":
            add("error", "DANGLING_EVIDENCE_ELEMENT", f"{path}.document_element_id", "document element does not exist")

    def validate_refs(refs: Any, path: str) -> None:
        if refs is None:
            return
        if not isinstance(refs, list):
            add("error", "EVIDENCE_REFS", path, "evidence_ids must be an array")
            return
        for ref in refs:
            if ref not in evidence_ids:
                add("error", "DANGLING_EVIDENCE", path, f"evidence {ref!r} does not exist")

    relation_rows = _rows(package.get("relations"))
    relation_ids: set[str] = set()
    relation_triples: set[tuple[str, str, str]] = set()
    for index, relation in enumerate(relation_rows):
        path = f"$.relations[{index}]"
        relation_id = relation.get("id")
        if not isinstance(relation_id, str) or not relation_id:
            add("error", "RELATION_ID", f"{path}.id", "relation id is required")
        elif relation_id in relation_ids or relation_id in node_types or relation_id in evidence_ids:
            add("error", "DUPLICATE_ID", f"{path}.id", f"duplicate id {relation_id}")
        relation_ids.add(str(relation_id))
        relation_type = relation.get("type")
        subject = _obj(relation.get("subject")); object_ = _obj(relation.get("object"))
        subject_id = subject.get("id"); object_id = object_.get("id")
        subject_type = subject.get("type"); object_type = object_.get("type")
        if node_types.get(subject_id) != subject_type:
            add("error", "RELATION_SUBJECT", f"{path}.subject", "subject reference is missing or its type is incorrect")
        if node_types.get(object_id) != object_type:
            add("error", "RELATION_OBJECT", f"{path}.object", "object reference is missing or its type is incorrect")
        allowed = RELATION_ENDPOINTS.get(str(relation_type))
        if allowed is None:
            add("error", "RELATION_TYPE", f"{path}.type", f"unknown relation type {relation_type!r}")
        elif (subject_type, object_type) not in allowed:
            add("error", "RELATION_ENDPOINTS", path, f"{relation_type} does not allow {subject_type} -> {object_type}")
        status = relation.get("value_status")
        if status not in VALUE_STATUSES:
            add("error", "VALUE_STATUS", f"{path}.value_status", f"invalid value status {status!r}")
        validate_refs(relation.get("evidence_ids", []), f"{path}.evidence_ids")
        if relation_type in {"INTRODUCED_AT", "FEEDS"}:
            refs = relation.get("evidence_ids", [])
            if status in {"reported", "inherited"} and not refs:
                add("error", "FLOW_EVIDENCE", path, "reported feed relation requires evidence")
            if status == "inferred" and not _obj(relation.get("profile")).get("inference_method"):
                add("error", "FLOW_INFERENCE", path, "inferred feed relation requires a method")
            for ref in refs:
                if evidence_by_id.get(ref, {}).get("experiment_id") != node_experiments.get(str(object_id)):
                    add("error", "FLOW_EVIDENCE_BOUNDARY", path, "feed evidence must belong to the target experiment")
        relation_triples.add((str(relation_type), str(subject_id), str(object_id)))
        subject_experiment = node_experiments.get(str(subject_id)); object_experiment = node_experiments.get(str(object_id))
        if subject_experiment and object_experiment and subject_experiment != object_experiment and relation_type not in {"COMPARES_TO", "POSSIBLE_MATCH"}:
            add("error", "EXPERIMENT_BOUNDARY", path, "relation crosses experiment boundaries")

    asset_rows = _rows(_obj(package.get("asset_manifest")).get("assets"))
    delivery_mode = _obj(package.get("bundle")).get("delivery_mode")
    assets_by_id: dict[str, dict[str, Any]] = {}
    asset_paths: set[str] = set()
    for index, asset in enumerate(asset_rows):
        path = f"$.asset_manifest.assets[{index}]"
        asset_id = asset.get("asset_id")
        if not isinstance(asset_id, str) or not asset_id:
            add("error", "ASSET_ID", f"{path}.asset_id", "asset requires a stable id")
        elif asset_id in assets_by_id:
            add("error", "DUPLICATE_ASSET", f"{path}.asset_id", f"duplicate asset id {asset_id}")
        else:
            assets_by_id[asset_id] = asset
        availability = asset.get("availability_status")
        if delivery_mode == "json_only" and availability == "bundled":
            add("error", "BUNDLE_MODE", f"{path}.availability_status", "json_only package cannot declare a bundled asset")
        relative_path = asset.get("relative_path")
        checksum = asset.get("sha256")
        byte_size = asset.get("byte_size")
        if availability == "bundled":
            safe_path = (
                isinstance(relative_path, str) and relative_path and "\\" not in relative_path
                and "\x00" not in relative_path and not relative_path.startswith("/")
                and not re.match(r"^[A-Za-z]:", relative_path)
                and posixpath.normpath(relative_path) == relative_path
                and all(part not in {"", ".", ".."} for part in relative_path.split("/"))
            )
            if not safe_path:
                add("error", "UNSAFE_PATH", f"{path}.relative_path", "bundled asset requires a normalized POSIX relative path")
            elif relative_path in asset_paths:
                add("error", "DUPLICATE_PATH", f"{path}.relative_path", f"duplicate asset path {relative_path}")
            else:
                asset_paths.add(relative_path)
            if not isinstance(checksum, str) or not re.fullmatch(r"[a-f0-9]{64}", checksum):
                add("error", "INVALID_HASH", f"{path}.sha256", "bundled asset requires a lowercase SHA-256")
            if not isinstance(byte_size, int) or byte_size < 0:
                add("error", "ASSET_SIZE", f"{path}.byte_size", "bundled asset requires a non-negative byte size")
        parent_id = asset.get("parent_asset_id")
        if parent_id and parent_id not in {row.get("asset_id") for row in asset_rows}:
            add("error", "DANGLING_ASSET_PARENT", f"{path}.parent_asset_id", "parent asset does not exist")
        source_document_id = asset.get("source_document_id")
        if source_document_id and source_document_id not in document_ids:
            add("error", "DANGLING_ASSET_DOCUMENT", f"{path}.source_document_id", "source document does not exist")

    assertion_ids: set[str] = set()
    assertion_rows = _rows(package.get("assertions"))
    for index, assertion in enumerate(assertion_rows):
        path = f"$.assertions[{index}]"
        assertion_id = assertion.get("id")
        if not isinstance(assertion_id, str) or not assertion_id:
            add("error", "ASSERTION_ID", f"{path}.id", "assertion id is required")
        elif assertion_id in assertion_ids or assertion_id in node_types or assertion_id in evidence_ids or assertion_id in relation_ids:
            add("error", "DUPLICATE_ID", f"{path}.id", f"duplicate id {assertion_id}")
        assertion_ids.add(str(assertion_id))
        subject = _obj(assertion.get("subject")); subject_id = subject.get("id")
        if node_types.get(subject_id) != subject.get("type"):
            add("error", "ASSERTION_SUBJECT", f"{path}.subject", "assertion subject is missing or its type is incorrect")
        status = assertion.get("value_status")
        if status not in VALUE_STATUSES:
            add("error", "VALUE_STATUS", f"{path}.value_status", f"invalid value status {status!r}")
        refs = assertion.get("evidence_ids", [])
        validate_refs(refs, f"{path}.evidence_ids")
        if status == "reported" and not refs:
            add("error", "REPORTED_WITHOUT_EVIDENCE", path, "reported assertion requires source evidence")
        if status == "inferred":
            if not assertion.get("inference_method"):
                add("error", "INFERENCE_PROVENANCE", f"{path}.inference_method", "inferred assertion requires an inference method")
            depends = assertion.get("depends_on_assertion_ids")
            if not isinstance(depends, list) or not depends:
                add("error", "INFERENCE_DEPENDENCIES", f"{path}.depends_on_assertion_ids", "inferred assertion requires at least one dependency id")
        experiment_id = node_experiments.get(str(subject_id))
        for ref in refs if isinstance(refs, list) else []:
            if experiment_id and evidence_by_id.get(ref, {}).get("experiment_id") != experiment_id:
                add("error", "EVIDENCE_BOUNDARY", f"{path}.evidence_ids", "assertion evidence belongs to another experiment")

    for index, assertion in enumerate(assertion_rows):
        for dependency in assertion.get("depends_on_assertion_ids", []) if isinstance(assertion.get("depends_on_assertion_ids"), list) else []:
            if dependency not in assertion_ids:
                add("error", "DANGLING_ASSERTION", f"$.assertions[{index}].depends_on_assertion_ids", f"assertion {dependency!r} does not exist")

    tests = {row.get("id"): row for row in _rows(entities.get("tests"))}
    observations = _rows(entities.get("property_observations"))
    for index, observation in enumerate(observations):
        path = f"$.entities.property_observations[{index}]"
        observation_id = observation.get("id"); test_id = observation.get("test_id")
        if test_id not in tests:
            add("error", "OBSERVATION_TEST", f"{path}.test_id", "property observation requires an existing test")
        if ("YIELDS", str(test_id), str(observation_id)) not in relation_triples:
            add("error", "OBSERVATION_RELATION", path, "property observation requires TEST YIELDS OBSERVATION")
        if test_id in tests and not any(item[0] == "TESTED_BY" and item[2] == test_id for item in relation_triples):
            add("error", "TEST_TARGET", f"$.entities.tests[{test_id}]", "test must be linked to a specimen or material state")
        refs = observation.get("evidence_ids", [])
        validate_refs(refs, f"{path}.evidence_ids")
        if observation.get("value_status") == "reported" and not refs:
            add("error", "REPORTED_WITHOUT_EVIDENCE", path, "reported property observation requires evidence")
        if observation.get("is_relative"):
            if not observation.get("baseline_experiment_id") or not observation.get("baseline_observation_id"):
                add("error", "RELATIVE_BASELINE", path, "relative observation requires baseline experiment and observation")
        measurement = _obj(observation.get("value"))
        original_unit = measurement.get("original_unit") or ""
        normalized_unit = measurement.get("normalized_unit")
        declared_dimension = measurement.get("dimension")
        original_dimension = UNIT_DIMENSIONS.get(str(original_unit), "unclassified")
        if declared_dimension and declared_dimension != original_dimension and original_dimension != "unclassified":
            add("error", "UNIT_DIMENSION", f"{path}.value.dimension", "declared dimension conflicts with original unit")
        if normalized_unit is not None:
            normalized_dimension = UNIT_DIMENSIONS.get(str(normalized_unit), "unclassified")
            if original_dimension != normalized_dimension:
                add("error", "UNIT_INCOMPATIBLE", f"{path}.value.normalized_unit", f"cannot normalize {original_unit!r} to {normalized_unit!r}")
        if measurement.get("original_value") in UNKNOWN_TOKENS and observation.get("value_status") != "pending":
            add("error", "UNKNOWN_SEMANTICS", path, "unknown token must use pending status, not a measured value")

    for index, structure in enumerate(_rows(entities.get("structure_observations"))):
        path = f"$.entities.structure_observations[{index}]"
        if not structure.get("method"):
            add("error", "STRUCTURE_METHOD", f"{path}.method", "structure observation requires a characterization method")
        legacy_target = any(item[0] == "CHARACTERIZES" and item[1] == structure.get("id") for item in relation_triples)
        event_result = any(item[0] == "YIELDS_STRUCTURE" and item[2] == structure.get("id") for item in relation_triples)
        if not legacy_target and not event_result:
            add("error", "STRUCTURE_TARGET", path, "structure observation requires a legacy characterized object or characterization event")

    for index, event in enumerate(_rows(entities.get("characterization_events"))):
        path = f"$.entities.characterization_events[{index}]"
        event_id = event.get("id")
        if not event.get("technique_code"):
            add("error", "CHARACTERIZATION_METHOD", f"{path}.technique_code", "characterization event requires a technique code or NOT_REPORTED")
        if not any(item[0] == "HAS_CHARACTERIZATION" and item[2] == event_id for item in relation_triples):
            add("error", "CHARACTERIZATION_OWNER", path, "characterization event must belong to an experiment")
        if not any(item[0] == "CHARACTERIZES" and item[1] == event_id for item in relation_triples):
            add("error", "CHARACTERIZATION_TARGET", path, "characterization event requires an explicitly characterized object")
        instrument_id = event.get("instrument_id")
        if instrument_id and not any(item[0] == "USES_INSTRUMENT" and item[1] == event_id and item[2] == instrument_id for item in relation_triples):
            add("error", "CHARACTERIZATION_INSTRUMENT", f"{path}.instrument_id", "instrument reference requires a USES_INSTRUMENT relation")
        mention_id = event.get("instrument_mention_id")
        if mention_id:
            if node_types.get(str(mention_id)) != "instrument_mention":
                add("error", "INSTRUMENT_MENTION", f"{path}.instrument_mention_id", "instrument mention does not exist")
            elif ("USES_INSTRUMENT", str(event_id), str(mention_id)) not in relation_triples:
                add("error", "INSTRUMENT_MENTION_RELATION", f"{path}.instrument_mention_id", "instrument mention requires a USES_INSTRUMENT relation")
        for field, target_type in (("specimen_id", "specimen"), ("material_state_id", "material_state"), ("material_id", "material")):
            target_id = event.get(field)
            if target_id and not any(item[0] == "CHARACTERIZES" and item[1] == event_id and item[2] == target_id for item in relation_triples):
                add("error", "CHARACTERIZATION_TARGET", f"{path}.{field}", f"{field} reference requires a CHARACTERIZES relation to {target_type}")

    for index, media in enumerate(_rows(entities.get("media_artifacts"))):
        path = f"$.entities.media_artifacts[{index}]"
        media_id = media.get("id")
        event_id = media.get("characterization_event_id")
        simulation_id = media.get("simulation_study_id")
        simulation_run_id = media.get("simulation_run_id")
        producers = [item for item in (event_id, simulation_id, simulation_run_id) if item]
        if len(producers) != 1:
            add("error", "MEDIA_PROVENANCE", path, "media artifact requires exactly one characterization event, simulation study or simulation run producer")
        elif not any(item[0] == "GENERATES" and item[1] == producers[0] and item[2] == media_id for item in relation_triples):
            add("error", "MEDIA_PROVENANCE", path, "media artifact requires a matching GENERATES relation")
        asset_id = media.get("asset_id")
        if asset_id:
            if asset_id not in assets_by_id:
                add("error", "DANGLING_ASSET", f"{path}.asset_id", "media artifact asset does not exist in asset_manifest")
            linked_refs = [row for row in _rows(entities.get("asset_references")) if row.get("asset_id") == asset_id]
            if not linked_refs or not any(("HAS_ASSET", str(media_id), str(row.get("id"))) in relation_triples for row in linked_refs):
                add("error", "MEDIA_ASSET_RELATION", path, "media asset requires an AssetReference and HAS_ASSET relation")

    for index, mention in enumerate(_rows(entities.get("instrument_mentions"))):
        path = f"$.entities.instrument_mentions[{index}]"
        mention_id = mention.get("id")
        if mention.get("value_status") in {"reported", "inherited"} and not mention.get("evidence_ids"):
            add("error", "INSTRUMENT_MENTION_EVIDENCE", path, "reported instrument mention requires evidence")
        status = mention.get("normalization_status")
        targets = [item for item in relation_triples if item[0] == "RESOLVES_TO" and item[1] == mention_id]
        if status == "resolved" and len(targets) != 1:
            add("error", "INSTRUMENT_RESOLUTION", path, "resolved mention requires exactly one RESOLVES_TO relation")
        if status in {"unresolved_model", "conflict", "not_applicable"} and targets:
            add("error", "INSTRUMENT_RESOLUTION", path, f"{status} mention cannot have a RESOLVES_TO relation")

    for index, simulation in enumerate(_rows(entities.get("simulation_studies"))):
        if simulation.get("value_status") != "predicted":
            add("error", "SIMULATION_TRUTH", f"$.entities.simulation_studies[{index}].value_status", "simulation output must be predicted")
    simulations = {row.get("id"): row for row in _rows(entities.get("simulation_studies"))}
    simulation_runs = {row.get("id"): row for row in _rows(entities.get("simulation_runs"))}
    for index, run in enumerate(_rows(entities.get("simulation_runs"))):
        path = f"$.entities.simulation_runs[{index}]"
        run_id = run.get("id")
        study_id = run.get("simulation_study_id")
        if study_id not in simulations:
            add("error", "DANGLING_SIMULATION_RUN", f"{path}.simulation_study_id", "simulation run requires an existing study")
        if ("HAS_RUN", str(study_id), str(run_id)) not in relation_triples:
            add("error", "SIMULATION_RUN_RELATION", path, "simulation run requires HAS_RUN")
        assessment = _obj(run.get("reproducibility_assessment"))
        level = assessment.get("level")
        run_status = run.get("run_status")
        input_assets = [
            row for row in _rows(entities.get("asset_references"))
            if ("INPUT_OF", str(row.get("id")), str(run_id)) in relation_triples
        ]
        if level in {"R3", "R4", "R5"}:
            if assessment.get("input_artifact_availability") != "complete" or not input_assets:
                add("error", "REPRODUCIBILITY_LEVEL", path, f"{level} requires complete linked input assets")
        if level in {"R4", "R5"} and run_status != "executed":
            add("error", "REPRODUCIBILITY_EXECUTION", path, f"{level} requires an executed run")
        if level == "R5" and assessment.get("result_match_status") != "within_tolerance":
            add("error", "REPRODUCIBILITY_MATCH", path, "R5 requires a result within the declared tolerance")

    for index, parameter in enumerate(_rows(entities.get("simulation_parameters"))):
        path = f"$.entities.simulation_parameters[{index}]"
        run_id = parameter.get("simulation_run_id")
        if run_id not in simulation_runs:
            add("error", "DANGLING_SIMULATION_PARAMETER", f"{path}.simulation_run_id", "simulation parameter requires an existing run")
        if ("HAS_PARAMETER", str(run_id), str(parameter.get("id"))) not in relation_triples:
            add("error", "SIMULATION_PARAMETER_RELATION", path, "simulation parameter requires HAS_PARAMETER")

    for index, asset_ref in enumerate(_rows(entities.get("asset_references"))):
        path = f"$.entities.asset_references[{index}]"
        asset_id = asset_ref.get("asset_id")
        if asset_id not in assets_by_id:
            add("error", "DANGLING_ASSET", f"{path}.asset_id", "asset reference requires an asset_manifest entry")
        ref_id = asset_ref.get("id")
        roles = [item for item in relation_triples if item[1] == ref_id and item[0] in {"INPUT_OF", "OUTPUT_OF"}]
        owners = [item for item in relation_triples if item[2] == ref_id and item[0] == "HAS_ASSET"]
        if not roles and not owners:
            add("error", "ASSET_REFERENCE_OWNER", path, "asset reference must be linked to media or a simulation run")
    for index, result in enumerate(_rows(entities.get("simulation_results"))):
        path = f"$.entities.simulation_results[{index}]"
        simulation_id = result.get("simulation_study_id")
        if result.get("value_status") != "predicted":
            add("error", "SIMULATION_RESULT_TRUTH", f"{path}.value_status", "simulation result must use predicted status")
        if simulation_id not in simulations:
            add("error", "SIMULATION_RESULT_STUDY", f"{path}.simulation_study_id", "simulation result requires an existing study")
        run_id = result.get("simulation_run_id")
        if package.get("schema_version") in {CONTRACT_SCHEMA_VERSION, OPPORTUNITY_SCHEMA_VERSION}:
            if run_id not in simulation_runs:
                add("error", "DANGLING_SIMULATION_RESULT_RUN", f"{path}.simulation_run_id", "ontology 1.3 simulation result requires an existing run")
            if not any(item[0] == "YIELDS_SIMULATION_RESULT" and item[1] == run_id and item[2] == result.get("id") for item in relation_triples):
                add("error", "SIMULATION_RESULT_RELATION", path, "ontology 1.3 simulation result requires SIMULATION_RUN YIELDS_SIMULATION_RESULT")
        elif not any(item[0] == "YIELDS_SIMULATION_RESULT" and item[1] == simulation_id and item[2] == result.get("id") for item in relation_triples):
            add("error", "SIMULATION_RESULT_RELATION", path, "simulation result requires YIELDS_SIMULATION_RESULT")
        if result.get("result_type") == "quantitative" and not _obj(result.get("value")):
            add("error", "SIMULATION_RESULT_VALUE", f"{path}.value", "quantitative simulation result requires a measurement")
    for index, mechanism in enumerate(_rows(entities.get("mechanism_hypotheses"))):
        if mechanism.get("value_status") in {"calculated", "digitized", "predicted"}:
            add("error", "MECHANISM_TRUTH", f"$.entities.mechanism_hypotheses[{index}].value_status", "mechanism is a hypothesis, not a measured or predicted result")

    routes: dict[str, list[dict[str, Any]]] = {}
    for step in _rows(entities.get("process_steps")):
        label = str(step.get("display_name_zh") or "").strip()
        if label and (not any("\u3400" <= c <= "\u9fff" for c in label) or "待术语校对" in label):
            add("error", "PROCESS_DISPLAY_NAME_ZH", f"$.entities.process_steps[{step.get('id')}].display_name_zh", "Use a meaningful Chinese label; keep original wording in source_text. A generic review placeholder is not a process name.")
        routes.setdefault(str(step.get("route_id")), []).append(step)
        validate_refs(step.get("evidence_ids", []), f"$.entities.process_steps[{step.get('id')}].evidence_ids")
        parameters = _obj(step.get("parameters"))
        for key in ("temperature", "duration"):
            value = parameters.get(key)
            if isinstance(value, list) or (isinstance(value, str) and "/" in value):
                add("error", "MIXED_SCHEDULE", f"$.entities.process_steps[{step.get('id')}].parameters.{key}", "multi-stage temperature/time must use paired stages, not parallel arrays or slash strings")
        stages = parameters.get("stages")
        if isinstance(stages, list):
            for stage_index, stage in enumerate(stages):
                if not isinstance(stage, dict) or "temperature" not in stage or "duration" not in stage:
                    add("error", "MIXED_SCHEDULE", f"$.entities.process_steps[{step.get('id')}].parameters.stages[{stage_index}]", "each stage requires a paired temperature and duration")
    for route_id, steps in routes.items():
        orders = [step.get("normalized_order") for step in steps]
        if len(orders) != len(set(orders)):
            add("error", "PROCESS_ORDER", f"$.entities.process_routes[{route_id}]", "process step order must be unique")
        integer_orders = sorted(order for order in orders if isinstance(order, int))
        if integer_orders and integer_orders != list(range(1, len(integer_orders) + 1)):
            add("error", "PROCESS_ORDER", f"$.entities.process_routes[{route_id}]", "process step order must be contiguous from 1")

    producers: dict[str, str] = {}
    consumers: dict[str, list[str]] = {}
    for relation_type, subject_id, object_id in relation_triples:
        if relation_type == "PRODUCES":
            if object_id in producers and producers[object_id] != subject_id:
                add("error" if package.get("schema_version") != "rpsme-ontology-1.0" else "warning", "STATE_MULTIPLE_PRODUCERS", "$.relations", "one state cannot be produced by multiple steps; use distinct state IDs")
            producers[object_id] = subject_id
        elif relation_type == "CONSUMES":
            consumers.setdefault(object_id, []).append(subject_id)
    adjacency: dict[str, set[str]] = {}
    for state_id, producer in producers.items():
        for consumer in consumers.get(state_id, []):
            if producer != consumer or package.get("schema_version") != "rpsme-ontology-1.0":
                adjacency.setdefault(producer, set()).add(consumer)
    visiting: set[str] = set(); visited: set[str] = set()

    def visit(node: str) -> bool:
        if node in visiting:
            return True
        if node in visited:
            return False
        visiting.add(node)
        if any(visit(next_node) for next_node in adjacency.get(node, set())):
            return True
        visiting.remove(node); visited.add(node)
        return False

    if any(visit(node) for node in list(adjacency)):
        add("error", "PROCESS_CYCLE", "$.relations", "process input/output graph contains an unexplained cycle")

    for index, feed in enumerate(_rows(entities.get("process_feeds"))):
        path = f"$.entities.process_feeds[{index}]"
        if node_types.get(feed.get("material_id")) != "material":
            add("error", "FLOW_MATERIAL", path, "process feed requires an existing material")
        if ("USES_MATERIAL", str(feed.get("id")), str(feed.get("material_id"))) not in relation_triples:
            add("error", "FLOW_MATERIAL_RELATION", path, "process feed requires USES_MATERIAL")
        if not any(t == "FEEDS" and s == feed.get("id") for t, s, o in relation_triples):
            add("warning", "UNBOUND_FEED", path, "process input is not bound to a step")
            flow = material_flow_by_experiment.get(str(feed.get("experiment_id")), {})
            declared = feed.get("id") in (flow.get("unbound_feed_ids") if isinstance(flow.get("unbound_feed_ids"), list) else [])
            has_reason = any(
                item.get("feed_id") == feed.get("id") and bool(str(item.get("reason") or "").strip())
                for item in _rows(flow.get("unresolved_inputs"))
            )
            if package.get("schema_version") != "rpsme-ontology-1.0" and (not declared or not has_reason):
                add("error", "UNEXPLAINED_UNBOUND_FEED", path, "unbound process feed requires its id and a concrete reason in experiment profile.material_flow")
    for index, usage in enumerate(_rows(entities.get("ingredient_usages"))):
        bound = any(t == "INTRODUCED_AT" and s == usage.get("id") for t, s, o in relation_triples)
        if usage.get("not_used") and bound:
            add("error", "UNUSED_INPUT", f"$.entities.ingredient_usages[{index}]", "not_used ingredient cannot be introduced")
        elif not bound and not usage.get("not_used"):
            add("warning", "UNBOUND_INGREDIENT", f"$.entities.ingredient_usages[{index}]", "ingredient introduction step is unresolved")
            flow = material_flow_by_experiment.get(str(usage.get("experiment_id")), {})
            declared = usage.get("id") in (flow.get("unbound_usage_ids") if isinstance(flow.get("unbound_usage_ids"), list) else [])
            has_reason = any(
                item.get("usage_id") == usage.get("id") and bool(str(item.get("reason") or "").strip())
                for item in _rows(flow.get("unresolved_inputs"))
            )
            if package.get("schema_version") != "rpsme-ontology-1.0" and (not declared or not has_reason):
                add("error", "UNEXPLAINED_UNBOUND_INGREDIENT", f"$.entities.ingredient_usages[{index}]", "unbound ingredient requires its id and a concrete reason in experiment profile.material_flow")
            # Missing source information is allowed. Dropping a relation even
            # though an atomic step explicitly names the material is not.
            material = entity_index.get(str(usage.get("material_id")), {})
            names = [_obj(usage.get("profile")).get("raw_name"), material.get("canonical_name")]
            step_texts = []
            for step in _rows(entities.get("process_steps")):
                if step.get("experiment_id") == usage.get("experiment_id"):
                    step_texts.append(_flow_token(step.get("source_text")))
                    step_texts.append(_flow_token(json.dumps(_obj(step.get("profile")), ensure_ascii=False)))
            tokens = [_flow_token(name) for name in names if len(_flow_token(name)) >= 2]
            active_usages = [row for row in _rows(entities.get("ingredient_usages")) if row.get("experiment_id") == usage.get("experiment_id") and not row.get("not_used")]
            def uniquely_identifies(token: str) -> bool:
                matches = 0
                for candidate in active_usages:
                    candidate_material = entity_index.get(str(candidate.get("material_id")), {})
                    candidate_tokens = {
                        _flow_token(_obj(candidate.get("profile")).get("raw_name")),
                        _flow_token(candidate_material.get("canonical_name")),
                    }
                    if token in candidate_tokens:
                        matches += 1
                return matches == 1
            if package.get("schema_version") != "rpsme-ontology-1.0" and any(uniquely_identifies(token) and token in text for token in tokens for text in step_texts if text):
                add("error", "FLOW_LINK_DROPPED", f"$.entities.ingredient_usages[{index}]", "a process step explicitly names this ingredient but INTRODUCED_AT is missing")

    for index, specimen in enumerate(_rows(entities.get("specimens"))):
        if any(t == "SOURCE_OF" and o == specimen.get("id") for t, s, o in relation_triples):
            continue
        path = f"$.entities.specimens[{index}]"
        add("warning", "SPECIMEN_SOURCE_GAP", path, "specimen is not linked to a material state")
        flow = material_flow_by_experiment.get(str(specimen.get("experiment_id")), {})
        has_reason = any(
            item.get("specimen_id") == specimen.get("id") and bool(str(item.get("reason") or "").strip())
            for item in _rows(flow.get("specimen_provenance_gaps"))
        )
        if package.get("schema_version") != "rpsme-ontology-1.0" and not has_reason:
            add("error", "UNEXPLAINED_SPECIMEN_SOURCE_GAP", path, "missing specimen provenance requires a concrete reason in experiment profile.material_flow")

    for collection in ENTITY_COLLECTIONS:
        for index, row in enumerate(_rows(entities.get(collection))):
            validate_refs(row.get("evidence_ids", []), f"$.entities.{collection}[{index}].evidence_ids")

    serialized = json.dumps(package, ensure_ascii=False)
    if "[object Object]" in serialized:
        add("error", "RENDER_LEAK", "$", "package contains a JavaScript object rendering leak")
    if "&#x" in serialized:
        add("warning", "HTML_ENTITY", "$", "package contains an encoded HTML entity that should be decoded")

    if schema_path:
        issues = _detect_jsonschema_issues(package, Path(schema_path)) + issues
    return ValidationReport(issues)
