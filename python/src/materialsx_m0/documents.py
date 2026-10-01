from __future__ import annotations

from dataclasses import asdict, dataclass
from hashlib import sha256
from pathlib import Path
import csv
import io
import shutil
import subprocess
import tempfile


@dataclass(frozen=True)
class PageEvidence:
    page: int
    text: str
    bbox_count: int


@dataclass(frozen=True)
class ExtractionResult:
    source_sha256: str
    page_count: int
    pypdf_pages: tuple[PageEvidence, ...]
    pdfplumber_pages: tuple[PageEvidence, ...]

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class OcrPageEvidence:
    page: int
    text: str
    mean_confidence: float
    low_confidence_words: tuple[str, ...]


@dataclass(frozen=True)
class OcrExtractionResult:
    source_sha256: str
    page_count: int
    languages: str
    pages: tuple[OcrPageEvidence, ...]

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def _clean(text: str | None) -> str:
    return " ".join((text or "").split())


def extract_pdf(path: str | Path) -> ExtractionResult:
    """Compare two local text-PDF extraction paths and retain page-level evidence metadata."""
    from pypdf import PdfReader
    import pdfplumber

    source = Path(path)
    payload = source.read_bytes()
    pypdf_reader = PdfReader(source)
    pypdf_pages = tuple(
        PageEvidence(page=index + 1, text=_clean(page.extract_text()), bbox_count=0)
        for index, page in enumerate(pypdf_reader.pages)
    )

    with pdfplumber.open(source) as document:
        plumber_pages = tuple(
            PageEvidence(
                page=index + 1,
                text=_clean(page.extract_text()),
                bbox_count=len(page.extract_words()),
            )
            for index, page in enumerate(document.pages)
        )

    if len(pypdf_pages) != len(plumber_pages):
        raise ValueError("PDF extractors disagree on page count")
    return ExtractionResult(
        source_sha256=sha256(payload).hexdigest(),
        page_count=len(pypdf_pages),
        pypdf_pages=pypdf_pages,
        pdfplumber_pages=plumber_pages,
    )


def extract_scanned_pdf(
    path: str | Path,
    *,
    languages: str = "eng+chi_sim",
    scale: float = 2.5,
    low_confidence_threshold: float = 70.0,
) -> OcrExtractionResult:
    """Render an image-only PDF and retain page-level OCR confidence evidence."""
    if shutil.which("tesseract") is None:
        raise RuntimeError("unsupported: tesseract executable is not installed")

    import pypdfium2 as pdfium

    source = Path(path)
    payload = source.read_bytes()
    document = pdfium.PdfDocument(source)
    pages: list[OcrPageEvidence] = []
    try:
        with tempfile.TemporaryDirectory(prefix="materialsx-ocr-") as temporary:
            for index in range(len(document)):
                image_path = Path(temporary) / f"page-{index + 1}.png"
                page = document[index]
                bitmap = page.render(scale=scale)
                try:
                    bitmap.to_pil().save(image_path)
                finally:
                    bitmap.close()
                    page.close()

                run = subprocess.run(
                    ["tesseract", str(image_path), "stdout", "-l", languages, "tsv"],
                    check=False,
                    capture_output=True,
                    text=True,
                )
                if run.returncode != 0:
                    raise RuntimeError(f"OCR failed for page {index + 1}: {run.stderr.strip()}")
                words: list[str] = []
                confidences: list[float] = []
                low_confidence: list[str] = []
                for row in csv.DictReader(io.StringIO(run.stdout), delimiter="\t"):
                    word = (row.get("text") or "").strip()
                    if not word:
                        continue
                    try:
                        confidence = float(row.get("conf", "-1"))
                    except ValueError:
                        confidence = -1.0
                    words.append(word)
                    if confidence >= 0:
                        confidences.append(confidence)
                        if confidence < low_confidence_threshold:
                            low_confidence.append(word)
                pages.append(
                    OcrPageEvidence(
                        page=index + 1,
                        text=" ".join(words),
                        mean_confidence=round(sum(confidences) / len(confidences), 2) if confidences else 0.0,
                        low_confidence_words=tuple(low_confidence),
                    )
                )
    finally:
        document.close()

    return OcrExtractionResult(
        source_sha256=sha256(payload).hexdigest(),
        page_count=len(pages),
        languages=languages,
        pages=tuple(pages),
    )
