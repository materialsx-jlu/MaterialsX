from pathlib import Path
import shutil

from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
from PIL import Image, ImageDraw, ImageFont
import pytest

from materialsx_m0.documents import extract_pdf, extract_scanned_pdf


def test_two_extractors_preserve_page_level_text(tmp_path: Path) -> None:
    source = tmp_path / "复合材料样例.pdf"
    canvas = Canvas(str(source), pagesize=A4)
    canvas.drawString(72, 760, "Sample C-01: epoxy 70 wt%, carbon fiber 30 wt%")
    canvas.drawString(72, 740, "Tensile strength: 812 MPa at 23 C")
    canvas.showPage()
    canvas.drawString(72, 760, "Process: cure 120 C for 2 h")
    canvas.save()

    result = extract_pdf(source)

    assert result.page_count == 2
    assert "812 MPa" in result.pypdf_pages[0].text
    assert "812 MPa" in result.pdfplumber_pages[0].text
    assert result.pdfplumber_pages[0].bbox_count > 0
    assert len(result.source_sha256) == 64


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="Tesseract is an optional host dependency")
def test_scanned_pdf_ocr_keeps_page_and_confidence_evidence(tmp_path: Path) -> None:
    source = tmp_path / "扫描材料样例.pdf"
    canvas = Canvas(str(source), pagesize=A4)
    for text in ("MaterialsX tensile strength 812 MPa", "Cure temperature 120 C for 2 hours"):
        image = Image.new("RGB", (1600, 300), "white")
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default(size=72)
        draw.text((60, 100), text, fill="black", font=font)
        canvas.drawImage(ImageReader(image), 50, 590, width=500, height=94)
        canvas.showPage()
    canvas.save()

    result = extract_scanned_pdf(source, languages="eng")

    assert result.page_count == 2
    assert "812" in result.pages[0].text
    assert "120" in result.pages[1].text
    assert all(page.mean_confidence > 0 for page in result.pages)
    assert len(result.source_sha256) == 64
