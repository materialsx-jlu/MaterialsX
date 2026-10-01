#!/usr/bin/env python3
"""Prepare page-indexed evidence for model-authored RPSME fact extraction.

This compatibility entry point intentionally does not invent or classify facts. It
creates a compact handoff that tells an agent which page files to inspect next.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

try:
    import pymupdf
except ImportError:  # pragma: no cover - compatibility with older PyMuPDF
    import fitz as pymupdf


DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.IGNORECASE)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create page-indexed source evidence for the model-authored RPSME extraction stage."
    )
    parser.add_argument("--main-doc", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()

    source = args.main_doc.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    pages_dir = output_dir / "fact-source-pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    source_bytes = source.read_bytes()
    document = pymupdf.open(source)
    page_records: list[dict[str, object]] = []
    doi_candidates: set[str] = set()
    corpus_parts: list[str] = []

    for index, page in enumerate(document, start=1):
        text = page.get_text("text").strip()
        page_path = pages_dir / f"page-{index:04d}.txt"
        page_path.write_text(text + "\n", encoding="utf-8")
        doi_candidates.update(match.rstrip(".,;)") for match in DOI_RE.findall(text))
        page_records.append(
            {
                "page": index,
                "text_path": str(page_path),
                "characters": len(text),
                "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            }
        )
        corpus_parts.append(f"# Page {index}\n\n{text}\n")

    corpus_path = output_dir / "source-corpus.md"
    corpus_path.write_text("\n".join(corpus_parts), encoding="utf-8")
    handoff_path = output_dir / "fact-extraction-handoff.json"
    handoff = {
        "status": "source_prepared",
        "facts_extracted": False,
        "instruction": (
            "Read the required Skill references and the page text files listed here. "
            "The host model must author evidence-linked facts and the RPSME JSON; this helper never invents facts."
        ),
        "main_document": str(source),
        "document_sha256": hashlib.sha256(source_bytes).hexdigest(),
        "page_count": len(page_records),
        "doi_candidates": sorted(doi_candidates),
        "corpus_path": str(corpus_path),
        "pages": page_records,
        "required_next_steps": [
            "Read references/source-coverage.md and references/extraction-quality-p0.md.",
            "Read the schema and remaining references required by SKILL.md.",
            "Inspect every page relevant to methods, samples, tables, figures, and results.",
            "Author the RPSME JSON with exact evidence quotations and locators.",
            "Run quality_review.py, validate_package.py, and render_package_summary.py.",
        ],
    }
    handoff_path.write_text(json.dumps(handoff, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "status": "source_prepared",
                "facts_extracted": False,
                "handoff": str(handoff_path),
                "corpus": str(corpus_path),
                "page_count": len(page_records),
                "next": "Read the handoff and continue model-authored extraction without user confirmation.",
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
