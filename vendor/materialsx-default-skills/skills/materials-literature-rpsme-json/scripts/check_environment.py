#!/usr/bin/env python3
"""Offline dependency and bundle check."""
import importlib.util
import json
import shutil
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
required = ["SKILL.md", "requirements.txt", "references/literature-extraction.md",
            "references/formulation-contract.md", "references/characterization-assets.md",
            "references/instrument-normalization.md", "references/simulation-reproducibility.md",
            "references/rpsme-patent-package-v2.schema.json", "references/rpsme-bundle-manifest-v1.schema.json",
            "references/ontology-model.md", "scripts/prepare_pdf.py", "scripts/validate_package.py",
            "scripts/literature_checks.py", "scripts/render_package_summary.py", "scripts/extract_pdf_media.py",
            "scripts/build_asset_manifest.py", "scripts/validate_bundle.py", "scripts/package_bundle.py",
            "scripts/normalize_instrument_candidates.py", "scripts/score_simulation_reproducibility.py",
            "scripts/rpsme_ontology_v2/adapter_v13.py", "scripts/rpsme_ontology_v2/bundle.py",
            "scripts/rpsme_ontology_v2/validator.py", "scripts/rpsme_ontology_v2/vocabulary.py"]
required += ["references/extraction-quality-p0.md", "scripts/pdf_quality.py", "scripts/quality_review.py",
             "scripts/prepare_tables.py", "scripts/evaluate_extraction.py"]
required += ["references/advanced-extraction-p1.md", "scripts/p1_common.py", "scripts/digitize_chart.py",
             "scripts/identity_connectors.py", "scripts/literature_batch.py", "scripts/review_dataset.py"]
missing = [p for p in required if not (root / p).is_file()]
deps = {name: importlib.util.find_spec(name) is not None for name in ("jsonschema", "pymupdf", "PIL")}
ready = not missing and all(deps.values()) and sys.version_info >= (3, 10)
print(json.dumps(dict(ready=ready, python=sys.version.split()[0], dependencies=deps,
                     full_schema_validation=deps["jsonschema"], missing_files=missing,
                     optional_ocr_tesseract=bool(shutil.which("tesseract")),
                     optional_identity_dependencies={name: importlib.util.find_spec(name) is not None for name in ("mp_api", "ccdc")}), indent=2))
raise SystemExit(0 if ready else 1)
