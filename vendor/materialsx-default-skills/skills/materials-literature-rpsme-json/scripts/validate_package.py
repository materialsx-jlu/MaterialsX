#!/usr/bin/env python3
"""Validate receiver compatibility and literature-specific formulation semantics."""
import argparse
import importlib.util
import json
from pathlib import Path
from rpsme_ontology_v2 import validate_package
from literature_checks import check_literature
from rpsme_ontology_v2.extraction_coverage import check_extraction_coverage
from quality_review import audit, evidence_reference_issues


def validate(value, require_coverage=False, documents=None, review=None, require_quality=False, structural_only=False):
    schema = Path(__file__).resolve().parent.parent / "references/rpsme-patent-package-v2.schema.json"
    full = importlib.util.find_spec("jsonschema") is not None
    core = validate_package(value, schema).to_dict()
    issues = core["issues"]
    issues.extend(evidence_reference_issues(value))
    if not full:
        issues.append(dict(severity="error", code="MISSING_JSONSCHEMA", path="$", message="Install requirements.txt to complete Schema validation."))
    if core["valid"]:
        try:
            issues.extend(check_literature(value))
        except (TypeError, KeyError, AttributeError, ValueError) as exc:
            issues.append(dict(severity="error", code="LITERATURE_EXTENSION_SHAPE", path="$", message=f"Malformed literature extension: {exc}"))
    coverage = check_extraction_coverage(value, required=require_coverage)
    issues.extend(coverage.pop("issues"))
    generator = value.get("generator", {})
    version = generator.get("version", "0").split(".")
    new_skill = generator.get("name") == "materials-literature-rpsme-json" and tuple(int(p) for p in version if p.isdigit()) >= (1, 6, 0)
    quality = None
    quality_required = require_quality or (new_skill and not structural_only)
    if quality_required or documents:
        try:
            if not documents:
                raise ValueError("P0 requires --documents and a completed --quality-review. Use --structural-only only for intermediate drafts.")
            quality = audit(value, documents, review)
            if not quality["quality_ready"]:
                issues.append(dict(severity="error", code="EXTRACTION_QUALITY_PENDING", path="$",
                                   message="; ".join(quality["review_issues"]) or "Source findings require repair"))
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
            issues.append(dict(severity="error", code="EXTRACTION_QUALITY_INPUT", path="$", message=str(exc)))
    errors = sum(i["severity"] == "error" for i in issues)
    return dict(valid=errors == 0, full_schema_validation=full, error_count=errors,
                warning_count=sum(i["severity"] == "warning" for i in issues), issues=issues,
                source_key=value.get("source", {}).get("publication_number"),
                experiment_count=len(value.get("experiment_records", [])),
                counts={key: len(rows) for key, rows in value.get("entities", {}).items() if isinstance(rows, list)},
                extraction_quality_checked=quality is not None,
                extraction_quality_ready=quality["quality_ready"] if quality else False,
                quality_review=quality, intermediate_structural_only=structural_only,
                **coverage)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--warnings-as-errors", action="store_true")
    parser.add_argument("--require-coverage", action="store_true", help="Require a source-first preparation fact inventory")
    parser.add_argument("--documents", type=Path, help="Prepared document-set.manifest.json")
    parser.add_argument("--quality-review", type=Path, help="Completed P0 host/human review JSON")
    parser.add_argument("--require-quality", action="store_true", help="Enforce P0 even for older packages")
    parser.add_argument("--structural-only", action="store_true", help="Intermediate drafts only: skip automatic 1.6+ P0 delivery gate")
    args = parser.parse_args()
    try:
        value = json.loads(args.package.read_text(encoding="utf-8"))
        review = json.loads(args.quality_review.read_text(encoding="utf-8")) if args.quality_review else None
        report = validate(value, args.require_coverage, args.documents, review, args.require_quality, args.structural_only)
    except (OSError, ValueError, TypeError, AttributeError) as exc:
        report = dict(valid=False, error_count=1, warning_count=0, issues=[dict(severity="error", code="INPUT", path="$", message=str(exc))])
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        if args.report.resolve() in {p.resolve() for p in (args.package, args.documents, args.quality_review) if p}:
            parser.error("Report path must not overwrite input JSON.")
        args.report.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return int(not report["valid"] or (args.warnings_as_errors and report["warning_count"]))


if __name__ == "__main__":
    raise SystemExit(main())
