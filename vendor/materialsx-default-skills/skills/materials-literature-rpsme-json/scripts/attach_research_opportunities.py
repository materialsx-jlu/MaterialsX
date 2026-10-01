#!/usr/bin/env python3
"""Attach reviewed opportunity content to a 1.3 package without inventing facts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from validate_research_opportunities import validate


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_package", type=Path)
    parser.add_argument("extension", type=Path, help="JSON object containing paper_analysis and research_opportunities")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    base = json.loads(args.base_package.read_text(encoding="utf-8"))
    extension = json.loads(args.extension.read_text(encoding="utf-8"))
    if base.get("schema_version") != "rpsme-ontology-1.3":
        raise SystemExit("base_package must be a validated rpsme-ontology-1.3 package")
    if set(extension) - {"paper_analysis", "research_opportunities"}:
        raise SystemExit("extension may contain only paper_analysis and research_opportunities")
    if "paper_analysis" not in extension or "research_opportunities" not in extension:
        raise SystemExit("extension requires paper_analysis and research_opportunities")
    result = dict(base)
    result["schema_version"] = "rpsme-ontology-1.4"
    result["prompt_version"] = ("rpsme-literature-v8-material-identity" if base.get("prompt_version") == "rpsme-literature-v8-material-identity"
                                else "rpsme-literature-v7-opportunity-discovery")
    result.update(extension)
    errors = validate(result)
    if errors:
        raise SystemExit(json.dumps({"valid": False, "errors": errors}, ensure_ascii=False, indent=2))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"valid": True, "output": str(args.output)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
