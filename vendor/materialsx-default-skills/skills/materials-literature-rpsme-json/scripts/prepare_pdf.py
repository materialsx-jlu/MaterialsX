#!/usr/bin/env python3
"""Index local paper PDF pages; optional page rendering, no network or OCR claims."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from pdf_quality import inspect_page, ocr_page, text_hash


def native_page_text(page):
    """Keep complete native text blocks; visual line sorting can interleave columns."""
    return "\n\n".join(block[4].strip() for block in page.get_text("blocks", sort=False)
                       if len(block) > 6 and block[6] == 0 and block[4].strip()) + "\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--render-pages", default="", help="1-based page selection, e.g. 1,7-8")
    parser.add_argument("--ocr", choices=("never", "auto", "always"), default="auto")
    parser.add_argument("--ocr-language", default="eng", help="Installed Tesseract language codes, e.g. eng+chi_sim")
    args = parser.parse_args()
    try:
        import pymupdf as fitz
    except ImportError:
        parser.error("PyMuPDF missing; install requirements.txt.")
    pdf = args.pdf.expanduser().resolve()
    if not pdf.is_file() or pdf.suffix.lower() != ".pdf":
        parser.error("Input must be an existing local PDF.")
    digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
    try:
        doc = fitz.open(pdf)
    except Exception as exc:
        parser.error(f"Cannot open PDF: {exc}")
    if doc.needs_pass:
        parser.error("PDF is encrypted; provide an accessible copy.")
    selected = set()
    try:
        for group in filter(None, args.render_pages.split(",")):
            parts = [int(p) for p in group.split("-")]
            if len(parts) > 2: raise ValueError()
            start, end = parts[0], parts[-1]
            if start < 1 or end < start or end > len(doc): raise ValueError()
            selected.update(range(start, end + 1))
    except ValueError:
        parser.error("Invalid render page range.")
    target = args.output_dir.expanduser().resolve() / f"pdf-{digest[:16]}"
    target.mkdir(parents=True, exist_ok=True)
    pages, candidates = [], set()
    for index, page in enumerate(doc):
        text = native_page_text(page)
        page_no = index + 1
        candidates.update(re.findall(r"10\.\d{4,9}/[^\s<>]+", text, flags=re.I))
        textfile = target / f"page-{page_no:04d}.txt"
        textfile.write_text(text, encoding="utf-8")
        row = dict(pdf_page=page_no, text_file=textfile.name, character_count=len(text.strip()),
                   text_sha256=text_hash(text), text_origin="pdf_native",
                   text_order="native_complete_blocks",
                   needs_visual_or_ocr_review=len(text.strip()) < 80)
        row["layout_quality"] = inspect_page(page, text)
        row["ocr"], ocr_text = ocr_page(page, args.ocr, row["layout_quality"]["flags"], args.ocr_language)
        if ocr_text is not None:
            ocrfile = target / f"page-{page_no:04d}.ocr.txt"
            ocrfile.write_text(ocr_text, encoding="utf-8")
            row["ocr"].update(text_file=ocrfile.name, text_sha256=text_hash(ocr_text))
        row["needs_visual_or_ocr_review"] = bool(row["layout_quality"]["flags"] or row["ocr"]["status"] != "not_requested")
        if page_no in selected or row["needs_visual_or_ocr_review"]:
            imagefile = target / f"page-{page_no:04d}.png"
            page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(imagefile)
            row["rendered_image"] = imagefile.name
            row["rendered_sha256"] = hashlib.sha256(imagefile.read_bytes()).hexdigest()
        pages.append(row)
    manifest = dict(document_id=f"DOC-{digest[:16]}", filename=pdf.name, sha256=digest,
                    page_count=len(doc), metadata=doc.metadata, doi_candidates=sorted(candidates),
                    preparation_version="literature-p0-1", ocr_mode=args.ocr,
                    warning="DOI candidates may be citations. OCR and layout heuristics are unverified; inspect flagged pages and formulas.",
                    pages=pages)
    (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    doc.close()
    print(json.dumps(dict(manifest=str(target / "manifest.json"), page_count=len(pages),
                         low_text_pages=[p["pdf_page"] for p in pages if p["character_count"] < 80],
                         review_pages=[p["pdf_page"] for p in pages if p["needs_visual_or_ocr_review"]],
                         rendered_pages=[p["pdf_page"] for p in pages if "rendered_image" in p]), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
