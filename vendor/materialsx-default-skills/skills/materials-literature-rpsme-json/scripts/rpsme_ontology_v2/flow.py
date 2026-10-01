"""Conservative, deterministic material-flow linking; no adjacency-as-consumption.

Relations are authoritative. Legacy strings are linked only by unique exact
names/IDs. Missing and ambiguous inputs remain visible as unresolved findings.
"""
from __future__ import annotations

import hashlib
import re
from typing import Any


def state_key(value: Any) -> str:
    text = re.sub(r"\s+", "", str(value or "")).casefold()
    return re.sub(r"^步骤[0-9]+[a-z]?(?:所得|得到的?|后的?)", "", text)


def enrich_material_flow(package: dict[str, Any]) -> dict[str, Any]:
    entities = package["entities"]
    feeds = entities.setdefault("process_feeds", [])
    relations = package["relations"]
    types = {row["id"]: typ for collection, typ in (
        ("ingredient_usages", "ingredient_usage"), ("process_steps", "process_step"),
        ("materials", "material"), ("material_states", "material_state"),
        ("process_feeds", "process_feed"), ("specimens", "specimen"))
        for row in entities.get(collection, [])}
    triples = {(r["type"], r["subject"]["id"], r["object"]["id"]) for r in relations}
    materials = {m["id"]: m for m in entities["materials"]}
    evidence = {e["id"]: e for e in package["evidence"]}

    def edge(typ: str, a: str, b: str, refs: list[str], reported: bool, method: str) -> None:
        if (typ, a, b) in triples:
            return
        triples.add((typ, a, b))
        relations.append({"id": "EDGE-" + hashlib.sha256(f"{typ}|{a}|{b}".encode()).hexdigest()[:20].upper(),
            "type": typ, "subject": {"id": a, "type": types[a]}, "object": {"id": b, "type": types[b]},
            "value_status": "reported" if reported and refs else "inferred", "evidence_ids": refs,
            "profile": {"inference_method": method, "needs_review": not (reported and refs), "flow_linker_version": "1.1"}})

    for record in package["experiment_records"]:
        experiment = record["id"]
        usages = [u for u in entities["ingredient_usages"] if u.get("experiment_id") == experiment and not u.get("not_used")]
        states = [s for s in entities["material_states"] if s.get("experiment_id") == experiment]
        steps = sorted([s for s in entities["process_steps"] if s.get("experiment_id") == experiment], key=lambda s: s["normalized_order"])
        producer = {r["object"]["id"]: r["subject"]["id"] for r in relations if r["type"] == "PRODUCES"}
        step_by_id = {s["id"]: s for s in steps}
        issues = []
        for step in steps:
            profile = step.setdefault("profile", {})
            refs = [r for r in step.get("evidence_ids", []) if evidence.get(r, {}).get("experiment_id") == experiment]
            text = state_key(step.get("source_text"))
            raw_inputs = profile.get("inputs", [])
            raw_inputs = list(raw_inputs) if isinstance(raw_inputs, list) else [raw_inputs] if isinstance(raw_inputs, str) else []
            # Explicit references emitted by the PDF pipeline; native v2 uses relations.
            raw_inputs += profile.get("input_material_ids", []) if isinstance(profile.get("input_material_ids"), list) else []
            for raw in dict.fromkeys(x for x in raw_inputs if isinstance(x, str) and x.strip()):
                key = state_key(raw)
                candidates = []
                for usage in usages:
                    mat = materials.get(usage["material_id"], {})
                    p = usage.get("profile", {})
                    names = [usage["id"], usage["material_id"], mat.get("canonical_name"), p.get("raw_name"), p.get("raw_material_id")]
                    if key in {state_key(n) for n in names if n}:
                        candidates.append(usage)
                prior = [s for s in states if state_key(s.get("name")) == key and producer.get(s["id"]) in step_by_id and step_by_id[producer[s["id"]]]["normalized_order"] < step["normalized_order"]]
                if len(candidates) == 1 and not prior:
                    edge("INTRODUCED_AT", candidates[0]["id"], step["id"], refs, key in text, "unique_exact_explicit_input")
                elif len(prior) == 1 and not candidates:
                    edge("CONSUMES", step["id"], prior[0]["id"], refs, key in text, "unique_exact_named_input_state")
                else:
                    issues.append({"step_id": step["id"], "input": raw, "reason": "ambiguous" if candidates or prior else "unresolved"})
            for order in profile.get("input_step_orders", []) if isinstance(profile.get("input_step_orders"), list) else []:
                matches = [s for s in states if producer.get(s["id"]) in step_by_id and step_by_id[producer[s["id"]]]["normalized_order"] == order and order < step["normalized_order"]]
                if len(matches) == 1:
                    edge("CONSUMES", step["id"], matches[0]["id"], refs, False, "explicit_input_step_order")
                else:
                    issues.append({"step_id": step["id"], "input_step_order": order, "reason": "ambiguous_or_missing_output"})
            # Some legacy extractors omitted profile.inputs although the
            # atomic source step still explicitly names a recipe ingredient.
            # Bind only uniquely identified materials, at their earliest exact
            # name mention. Duplicate/ambiguous names remain review findings.
            profile_text = state_key(profile)
            for usage in usages:
                if any(t == "INTRODUCED_AT" and a == usage["id"] for t, a, b in triples):
                    continue
                material = materials.get(usage.get("material_id"), {})
                usage_profile = usage.get("profile", {})
                names = [
                    usage_profile.get("raw_name"),
                    usage_profile.get("raw_material_id"),
                    material.get("canonical_name"),
                ]
                tokens = {state_key(name) for name in names if len(state_key(name)) >= 2}
                unique_tokens: set[str] = set()
                for token in tokens:
                    matches = 0
                    for candidate in usages:
                        candidate_material = materials.get(candidate.get("material_id"), {})
                        candidate_profile = candidate.get("profile", {})
                        candidate_tokens = {
                            state_key(candidate_profile.get("raw_name")),
                            state_key(candidate_profile.get("raw_material_id")),
                            state_key(candidate_material.get("canonical_name")),
                        }
                        if token in candidate_tokens:
                            matches += 1
                    if matches == 1:
                        unique_tokens.add(token)
                source_match = bool(text) and any(token in text for token in unique_tokens)
                profile_match = bool(profile_text) and any(token in profile_text for token in unique_tokens)
                if source_match or profile_match:
                    edge(
                        "INTRODUCED_AT", usage["id"], step["id"], refs,
                        source_match,
                        "unique_exact_source_text" if source_match else "unique_exact_step_profile",
                    )
            # Auxiliaries are process inputs, not extra recipe quantities/prices.
            auxiliaries = profile.get("auxiliaries", [])
            for raw in auxiliaries if isinstance(auxiliaries, list) else []:
                if not isinstance(raw, str) or not raw.strip():
                    continue
                if any(state_key(raw) == state_key(materials.get(u["material_id"], {}).get("canonical_name")) for u in usages):
                    continue
                token = hashlib.sha256(f"{experiment}|{step['id']}|{raw}".encode()).hexdigest()[:20].upper()
                feed_id, material_id = f"FEED-{token}", f"MAT-FEED-{token}"
                if feed_id in types:
                    continue
                material = {"id": material_id, "version": 1, "entity_kind": "material_class", "canonical_name": raw,
                    "identity_status": "pending", "profile": {"origin": "reported_process_auxiliary"}}
                entities["materials"].append(material); materials[material_id] = material; types[material_id] = "material"
                feed = {"id": feed_id, "experiment_id": experiment, "version": 1, "material_id": material_id,
                    "display_name_zh": raw, "feed_kind": "auxiliary", "value_status": "reported" if refs else "pending",
                    "evidence_ids": refs, "profile": {"pricing_scope": "not_recipe", "amount_missing_reason": "NOT_REPORTED"}}
                feeds.append(feed); types[feed_id] = "process_feed"
                edge("USES_MATERIAL", feed_id, material_id, refs, state_key(raw) in text, "explicit_process_auxiliary")
                edge("FEEDS", feed_id, step["id"], refs, state_key(raw) in text, "explicit_process_auxiliary")
        for state in states:
            if state.get("state_origin") not in {None, "unknown"}:
                continue
            owner = step_by_id.get(producer.get(state["id"]), {})
            explicit = owner.get("profile", {}).get("output_state_origin")
            if explicit in {"source_reported", "normalized_transition", "inferred"}:
                state["state_origin"] = explicit
            elif state_key(state.get("name")) in state_key(owner.get("source_text")) and owner.get("source_text"):
                state["state_origin"] = "source_reported"
            else:
                state["state_origin"] = "normalized_transition" if owner else "unknown"
        unbound = [u["id"] for u in usages if not any(t == "INTRODUCED_AT" and a == u["id"] for t, a, b in triples)]
        for usage in usages:
            if usage["id"] not in unbound:
                continue
            if not any(item.get("usage_id") == usage["id"] for item in issues):
                material = materials.get(usage.get("material_id"), {})
                issues.append({
                    "usage_id": usage["id"],
                    "input": usage.get("profile", {}).get("raw_name") or material.get("canonical_name") or usage["id"],
                    "reason": "source_joining_step_not_reported",
                })
        specimens = [s for s in entities.get("specimens", []) if s.get("experiment_id") == experiment]
        sourced_specimens = {b for t, a, b in triples if t == "SOURCE_OF"}
        specimen_gaps = [
            {"specimen_id": specimen["id"], "reason": "source_output_state_not_reported_or_ambiguous"}
            for specimen in specimens if specimen["id"] not in sourced_specimens
        ]
        record.setdefault("profile", {})["material_flow"] = {
            "version": "1.1",
            "unbound_usage_ids": unbound,
            "unbound_feed_ids": [
                feed["id"] for feed in feeds
                if feed.get("experiment_id") == experiment and not any(t == "FEEDS" and a == feed["id"] for t, a, b in triples)
            ],
            "unresolved_inputs": issues,
            "specimen_provenance_gaps": specimen_gaps,
        }
    return package
