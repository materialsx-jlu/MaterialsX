"""Conservative page diagnostics; heuristics are review hints, not layout truth."""
import hashlib


def text_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def inspect_page(page, native_text):
    blocks = [b for b in page.get_text("blocks") if len(b) > 6 and b[6] == 0]
    midpoint = page.rect.width / 2
    left = [b for b in blocks if b[2] < midpoint + 15 and b[0] < midpoint - 30]
    right = [b for b in blocks if b[0] > midpoint - 15]
    columns = any(min(a[3], b[3]) > max(a[1], b[1]) for a in left for b in right)
    image_area = sum(max(0, r[2]-r[0]) * max(0, r[3]-r[1])
                     for image in page.get_image_info() for r in [image["bbox"]])
    image_fraction = min(1, image_area / max(1, page.rect.width * page.rect.height))
    flags = []
    if len(native_text.strip()) < 80:
        flags.append("scan_candidate" if image_fraction > .4 else "low_text_or_blank")
    if columns:
        flags.append("possible_multicolumn_reading_order")
    if "\ufffd" in native_text or "(cid:" in native_text:
        flags.append("possible_formula_or_font_corruption")
    return {"flags": flags, "image_fraction": round(image_fraction, 4),
            "blocks": [{"bbox": list(b[:4]), "text": b[4]} for b in blocks],
            "heuristic_only": True}


def ocr_page(page, mode, flags, language):
    if mode == "never" or (mode == "auto" and "scan_candidate" not in flags):
        return {"status": "not_requested"}, None
    try:
        tp = page.get_textpage_ocr(language=language, dpi=300, full=True)
        text = page.get_text(textpage=tp, sort=True)
        return {"status": "performed_unverified" if text.strip() else "empty",
                "engine": "pymupdf_tesseract", "language": language, "dpi": 300}, text
    except Exception as exc:
        return {"status": "unavailable_or_failed", "error": str(exc),
                "instruction": "Use host OCR or visually transcribe; keep gaps unresolved."}, None
