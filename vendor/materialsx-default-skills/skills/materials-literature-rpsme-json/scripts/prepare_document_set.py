#!/usr/bin/env python3
"""Prepare one main paper PDF plus any number of same-work companion PDFs."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def prepare(script: Path, pdf: Path, output: Path, render_pages: str, ocr="auto", language="eng") -> dict:
    command = [sys.executable, str(script), str(pdf), "--output-dir", str(output)]
    command += ["--ocr", ocr, "--ocr-language", language]
    if render_pages:
        command += ["--render-pages", render_pages]
    completed = subprocess.run(command, check=True, capture_output=True, text=True)
    result = json.loads(completed.stdout)
    manifest_path = Path(result["manifest"])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["manifest"] = str(manifest_path)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--main", type=Path, required=True)
    parser.add_argument("--supplementary", type=Path, action="append", default=[])
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--render-main", default="")
    parser.add_argument("--render-supplementary", default="")
    parser.add_argument("--ocr", choices=("never", "auto", "always"), default="auto")
    parser.add_argument("--ocr-language", default="eng")
    args = parser.parse_args()
    script = Path(__file__).with_name("prepare_pdf.py")
    documents = []
    for role, pdf, pages in [
        ("main", args.main, args.render_main),
        *(("supplementary", item, args.render_supplementary) for item in args.supplementary),
    ]:
        manifest = prepare(script, pdf.expanduser().resolve(), args.output_dir.expanduser().resolve(), pages, args.ocr, args.ocr_language)
        documents.append({
            "document_id": manifest["document_id"], "role": role,
            "filename": manifest["filename"], "sha256": manifest["sha256"],
            "page_count": manifest["page_count"], "mime_type": "application/pdf",
            "manifest": manifest["manifest"], "doi_candidates": manifest.get("doi_candidates", []),
            # The RPSME contract permits profile to be omitted, but emitting an
            # explicit object keeps older database receivers interoperable.
            "profile": {},
        })
    hashes = [row["sha256"] for row in documents]
    if len(hashes) != len(set(hashes)):
        parser.error("The document set contains the same PDF more than once.")
    result = {
        "primary_document_id": documents[0]["document_id"],
        "documents": documents,
        "relationship_check": {
            "status": "requires_source_review" if len(documents) > 1 else "main_only",
            "instruction": "Verify title/DOI/article number association; DOI candidates may be citations.",
        },
    }
    target = args.output_dir.expanduser().resolve() / "document-set.manifest.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"manifest": str(target), **result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
