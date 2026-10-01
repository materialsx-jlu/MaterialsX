#!/usr/bin/env python3
"""Validate an RPSME Bundle without extracting or executing its members."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from rpsme_ontology_v2.bundle import validate_bundle


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    report = validate_bundle(
        args.bundle,
        manifest_schema_path=root / "references/rpsme-bundle-manifest-v1.schema.json",
        package_schema_path=root / "references/rpsme-patent-package-v2.schema.json",
    ).to_dict()
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
