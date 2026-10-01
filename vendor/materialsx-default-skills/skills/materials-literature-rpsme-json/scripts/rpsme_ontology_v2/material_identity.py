"""Semantic identity-proposal gate shared with the literature Skill.

No public lookup, registry writes or scientific approvals occur in validation.
"""
import re
from datetime import datetime
from urllib.parse import urlsplit


def check_material_identities(package):
    errors = []
    entities = package.get("entities") or {}
    evidence = {e.get("id"): e for e in package.get("evidence", []) if isinstance(e, dict)}
    experiments = {e.get("id") for e in package.get("experiment_records", []) if isinstance(e, dict)}
    prepared = {e.get("experiment_id") for e in entities.get("recipes", []) if isinstance(e, dict)}
    for index, material in enumerate(entities.get("materials", [])):
        path = f"$.entities.materials[{index}].profile.identity_resolution"
        if not isinstance(material, dict):
            continue
        profile = material.get("profile") or {}
        if "identity_resolution" not in profile:
            continue
        def fail(message):
            errors.append((path, message))
        def check_refs(ids):
            if not isinstance(ids, list) or any(not isinstance(i, str) for i in ids):
                fail("evidence_ids must be strings")
                return
            for key in ids:
                e = evidence.get(key, {})
                if not str(e.get("evidence_text", "")).strip() or not e.get("locator"):
                    fail(f"missing evidence text/locator: {key}")
        p = profile["identity_resolution"]
        if not isinstance(p, dict):
            fail("identity_resolution must be an object")
            continue
        keys = {"role", "experiment_ids", "evidence_ids", "composition", "identifiers"}
        if set(p) != keys:
            fail("identity_resolution requires exactly role, experiment_ids, evidence_ids, composition, identifiers")
        if p.get("role") not in ("raw_material", "synthesized_material"):
            fail("unsupported role")
        check_refs(p.get("evidence_ids", []))
        ids = p.get("experiment_ids", [])
        if not isinstance(ids, list) or any(not isinstance(i, str) or i not in experiments for i in ids):
            fail("unknown experiment_ids")
            ids = []
        if not isinstance(p.get("composition"), dict):
            fail("composition must be an object")
        identifiers = p.get("identifiers", [])
        if not isinstance(identifiers, list):
            fail("identifiers must be an array")
            continue
        if p.get("role") == "synthesized_material":
            if not p.get("evidence_ids") or not ids or not p.get("composition") or any(i not in prepared for i in ids):
                fail("synthesized material requires composition, evidence and experimentally prepared recipes")
            if identifiers:
                fail("synthetic products use composition, not exact chemical identifiers")
        seen = set()
        for identifier in identifiers:
            if not isinstance(identifier, dict):
                fail("identifier must be an object")
                continue
            if not {"type", "value", "evidence_ids"} <= set(identifier) or set(identifier) - {"type", "value", "evidence_ids", "reference"}:
                fail("invalid identifier fields")
            kind, value = identifier.get("type"), identifier.get("value")
            if not isinstance(kind, str) or kind not in {"cas", "formula", "inchi_key", "canonical_smiles"}:
                fail("unsupported identifier type")
                continue
            if kind in seen:
                fail("duplicate identifier type")
            seen.add(kind)
            if not isinstance(value, str) or not value.strip() or len(value.strip()) > 1000:
                fail("invalid identifier value")
                continue
            value = value.strip()
            if kind == "cas":
                digits = value.replace("-", "")
                if not re.fullmatch(r"[0-9]{2,7}-[0-9]{2}-[0-9]", value) or sum((i+1)*int(d) for i, d in enumerate(reversed(digits[:-1]))) % 10 != int(digits[-1]):
                    fail("invalid CAS checksum")
            if kind == "inchi_key" and not re.fullmatch(r"[A-Z]{14}-[A-Z]{10}-[A-Z]", value):
                fail("invalid InChIKey")
            check_refs(identifier.get("evidence_ids", []))
            reference = identifier.get("reference")
            if not identifier.get("evidence_ids") and reference is None:
                fail("identifier requires paper evidence or external reference")
            if reference is not None:
                try:
                    assert set(reference) == {"url", "accessed_at", "quote"}
                    url = urlsplit(reference["url"])
                    assert url.scheme == "https" and url.hostname and not url.username and reference["quote"].strip()
                    assert datetime.fromisoformat(reference["accessed_at"].replace("Z", "+00:00")).tzinfo is not None
                except (AssertionError, ValueError, TypeError, KeyError, AttributeError):
                    fail("invalid HTTPS reference, quote or RFC3339 accessed_at")
    return errors
