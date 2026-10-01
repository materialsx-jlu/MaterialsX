#!/usr/bin/env python3
"""Extract PDF raster objects and explicit page crops with source provenance."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import mimetypes
from pathlib import Path
from typing import Any


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def mime_for(ext: str) -> str:
    ext = ext.lower().lstrip(".")
    known = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "tif": "image/tiff", "tiff": "image/tiff"}
    return known.get(ext, mimetypes.guess_type(f"x.{ext}")[0] or "application/octet-stream")


def thumbnail(payload: bytes, max_pixels: int) -> bytes | None:
    try:
        from PIL import Image
    except ImportError:
        return None
    with Image.open(io.BytesIO(payload)) as source:
        source.load()
        source.thumbnail((max_pixels, max_pixels))
        image = source if source.mode in {"RGB", "RGBA"} else source.convert("RGB")
        target = io.BytesIO()
        image.save(target, format="WEBP", quality=82, method=6)
        return target.getvalue()


def load_crops(path: Path | None) -> list[dict[str, Any]]:
    if not path:
        return []
    value = json.loads(path.read_text(encoding="utf-8"))
    rows = value.get("crops", []) if isinstance(value, dict) else value
    if not isinstance(rows, list):
        raise ValueError("crop spec must be an array or an object containing crops[]")
    return [row for row in rows if isinstance(row, dict)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--document-id", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--crop-spec", type=Path, help="Optional Figure/Panel crop list; bbox uses PDF points.")
    parser.add_argument("--min-width", type=int, default=240)
    parser.add_argument("--min-height", type=int, default=120)
    parser.add_argument("--crop-dpi", type=int, default=200)
    parser.add_argument("--thumbnail-max-pixels", type=int, default=1200)
    parser.add_argument("--no-thumbnails", action="store_true")
    args = parser.parse_args()
    try:
        import pymupdf as fitz
    except ImportError:
        parser.error("PyMuPDF missing; install requirements.txt.")

    pdf = args.pdf.expanduser().resolve()
    output = args.output_dir.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(pdf)
    candidates: dict[str, dict[str, Any]] = {}

    def add_asset(
        payload: bytes,
        ext: str,
        width: int,
        height: int,
        locator: dict[str, Any],
        method: str,
        *,
        binding: dict[str, Any] | None = None,
    ) -> None:
        digest = sha256(payload)
        filename = f"published/{digest}.{ext.lower()}"
        target = output / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_bytes(payload)
        row = candidates.setdefault(digest, {
            "asset_id": f"ASSET-{digest[:20].upper()}",
            "document_id": args.document_id,
            "filename": filename,
            "sha256": digest,
            "byte_size": len(payload),
            "media_type": mime_for(ext),
            "pixel_width": width,
            "pixel_height": height,
            "origin_type": "pdf_extracted",
            "availability_status": "external",
            "capture_method": method,
            "source_locators": [],
            "profile": {},
        })
        row["source_locators"].append(locator)
        if binding:
            row["media_artifact_id"] = binding.get("media_artifact_id")
            row["figure"] = binding.get("figure")
            row["panel"] = binding.get("panel")
        if args.no_thumbnails:
            return
        thumb = thumbnail(payload, args.thumbnail_max_pixels)
        if not thumb:
            row["profile"]["thumbnail_status"] = "dependency_unavailable"
            return
        thumb_digest = sha256(thumb)
        thumb_name = f"thumbnails/{thumb_digest}.webp"
        thumb_target = output / thumb_name
        thumb_target.parent.mkdir(parents=True, exist_ok=True)
        if not thumb_target.exists():
            thumb_target.write_bytes(thumb)
        row["thumbnail"] = {
            "asset_id": f"ASSET-{thumb_digest[:20].upper()}",
            "parent_asset_id": row["asset_id"],
            "filename": thumb_name,
            "sha256": thumb_digest,
            "byte_size": len(thumb),
            "media_type": "image/webp",
            "origin_type": "derived_thumbnail",
            "availability_status": "external",
            "derivation": {"method": "pillow_thumbnail", "max_pixels": args.thumbnail_max_pixels},
        }

    for page_index, page in enumerate(doc):
        for image in page.get_images(full=True):
            xref, width, height = image[0], image[2], image[3]
            if width < args.min_width or height < args.min_height:
                continue
            extracted = doc.extract_image(xref)
            placements = [
                {"x0": rect.x0, "y0": rect.y0, "x1": rect.x1, "y1": rect.y1, "coordinate_space": "pdf_points"}
                for rect in page.get_image_rects(xref)
            ]
            add_asset(
                extracted["image"], extracted.get("ext", "bin"), width, height,
                {"document_id": args.document_id, "pdf_page": page_index + 1, "xref": xref, "placements": placements},
                "pdf_embedded_image_extraction",
            )

    for index, spec in enumerate(load_crops(args.crop_spec), 1):
        page_number = int(spec.get("pdf_page") or 0)
        bbox = spec.get("crop_bbox") or spec.get("bbox")
        if not 1 <= page_number <= len(doc) or not isinstance(bbox, dict):
            raise ValueError(f"invalid crop #{index}: pdf_page and crop_bbox are required")
        page = doc[page_number - 1]
        rect = fitz.Rect(*(float(bbox[key]) for key in ("x0", "y0", "x1", "y1")))
        if rect.is_empty or not page.rect.contains(rect):
            raise ValueError(f"invalid crop #{index}: bbox must be non-empty and inside page")
        pixmap = page.get_pixmap(matrix=fitz.Matrix(args.crop_dpi / 72, args.crop_dpi / 72), clip=rect, alpha=False)
        payload = pixmap.tobytes("png")
        locator = {
            "document_id": args.document_id,
            "pdf_page": page_number,
            "figure": spec.get("figure"),
            "panel": spec.get("panel"),
            "crop_bbox": {**bbox, "coordinate_space": "pdf_points"},
        }
        add_asset(payload, "png", pixmap.width, pixmap.height, locator, "pdf_page_region_crop", binding=spec)

    doc.close()
    assets = sorted(candidates.values(), key=lambda row: row["sha256"])
    manifest = {
        "manifest_version": "rpsme-pdf-media-candidates-1.0",
        "document_id": args.document_id,
        "source_pdf": pdf.name,
        "origin_policy": "All entries are pdf_extracted; none are instrument native_raw.",
        "assets": assets,
    }
    target = output / f"{args.document_id}.media-manifest.json"
    target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "manifest": str(target),
        "asset_count": len(assets),
        "thumbnail_count": sum(bool(row.get("thumbnail")) for row in assets),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
