#!/usr/bin/env python3
"""Conservatively normalize source-reported instrument manufacturer/model candidates."""

from __future__ import annotations

import argparse
import copy
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

ALIASES = {
    "fei": "FEI",
    "thermo fisher scientific": "Thermo Fisher Scientific",
    "thermo scientific": "Thermo Scientific",
    "jeol": "JEOL",
    "bruker": "Bruker",
    "zeiss": "Zeiss",
    "carl zeiss": "Zeiss",
    "hitachi": "Hitachi",
    "rigaku": "Rigaku",
    "malvern panalytical": "Malvern Panalytical",
    "oxford instruments": "Oxford Instruments",
    "edinburgh instruments": "Edinburgh Instruments",
}


def clean(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    value = unicodedata.normalize("NFKC", value).replace("–", "-").replace("—", "-")
    return " ".join(value.split())


def normalize_manufacturer(value: Any) -> str | None:
    cleaned = clean(value)
    if not cleaned:
        return None
    return ALIASES.get(cleaned.casefold(), cleaned)


def suspicious(value: str | None) -> bool:
    return bool(value and ("�" in value or "?" in value or re.search(r"\b(?:unknown|unclear|待定|不详)\b", value, re.I)))


def candidate(manufacturer: Any, model: Any) -> tuple[str, dict[str, Any] | None, float | None]:
    maker = normalize_manufacturer(manufacturer)
    model_name = clean(model)
    if suspicious(maker) or suspicious(model_name):
        return "conflict", None, None
    if maker and model_name:
        return "resolved", {
            "canonical_key": f"{maker.casefold()}::{model_name.casefold()}",
            "manufacturer_normalized": maker,
            "model_normalized": model_name,
            "confidence": 1.0,
        }, 1.0
    if model_name:
        return "candidate", {"model_normalized": model_name, "confidence": 0.5}, 0.5
    return "unresolved_model", None, None


def normalize_package(package: dict[str, Any]) -> tuple[dict[str, Any], dict[str, int]]:
    result = copy.deepcopy(package)
    entities = result.get("entities", {})
    instruments = {row.get("id"): row for row in entities.get("characterization_instruments", []) if isinstance(row, dict)}
    counts = {"resolved": 0, "candidate": 0, "unresolved_model": 0, "conflict": 0}
    for mention in entities.get("instrument_mentions", []):
        if not isinstance(mention, dict):
            continue
        instrument = None
        mention_id = mention.get("id")
        for relation in result.get("relations", []):
            if relation.get("type") == "RESOLVES_TO" and relation.get("subject", {}).get("id") == mention_id:
                instrument = instruments.get(relation.get("object", {}).get("id"))
                break
        maker_raw = mention.get("manufacturer_raw")
        model_raw = mention.get("model_raw")
        if instrument:
            maker_raw = maker_raw or instrument.get("manufacturer")
            model_raw = model_raw or instrument.get("model")
        status, normalized, confidence = candidate(maker_raw, model_raw)
        mention["manufacturer_raw"] = clean(maker_raw)
        mention["model_raw"] = clean(model_raw)
        mention["normalization_status"] = status
        mention["instrument_model_candidate"] = normalized
        mention["normalization_confidence"] = confidence
        counts[status] += 1
        if instrument is not None:
            instrument["manufacturer"] = normalize_manufacturer(maker_raw)
            instrument["model"] = clean(model_raw)
            instrument["normalization_status"] = status
            instrument["instrument_model_candidate"] = copy.deepcopy(normalized)
    resolved_mentions = {
        row.get("id") for row in entities.get("instrument_mentions", [])
        if isinstance(row, dict) and row.get("normalization_status") == "resolved"
    }
    # A stale RESOLVES_TO edge would turn a low-confidence candidate into a
    # false canonical identity, so remove it when resolution is no longer safe.
    result["relations"] = [
        row for row in result.get("relations", [])
        if not (
            isinstance(row, dict)
            and row.get("type") == "RESOLVES_TO"
            and row.get("subject", {}).get("id") not in resolved_mentions
        )
    ]
    return result, counts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.package.resolve() == args.output.resolve():
        parser.error("--output must not overwrite the input package")
    package = json.loads(args.package.read_text(encoding="utf-8"))
    normalized, counts = normalize_package(package)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(normalized, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    report = {"valid": True, "output": str(args.output), "counts": counts}
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
