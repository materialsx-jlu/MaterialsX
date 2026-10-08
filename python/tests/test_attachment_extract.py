import json
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile


SCRIPT = Path(__file__).resolve().parents[2] / "vendor/materialsx-default-skills/scripts/extract-attachment.py"


def extract(path):
    completed = subprocess.run([sys.executable, "-I", str(SCRIPT), str(path)], capture_output=True, text=True, check=True)
    return json.loads(completed.stdout)


def test_pdf_keeps_real_page_numbers(tmp_path):
    import pymupdf
    path = tmp_path / "paper.pdf"
    document = pymupdf.open()
    for value in ("first experiment", "second experiment"):
        page = document.new_page()
        page.insert_text((72, 72), value)
    document.save(path)
    result = extract(path)
    assert result["pageCount"] == 2
    assert "[PDF 第 1 页" in result["text"] and "first experiment" in result["text"]
    assert "[PDF 第 2 页" in result["text"] and "second experiment" in result["text"]


def test_docx_paragraphs_are_extracted(tmp_path):
    path = tmp_path / "notes.docx"
    with ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>配方 A</w:t></w:r></w:p><w:p><w:r><w:t>工艺 120 ℃</w:t></w:r></w:p></w:body></w:document>')
    result = extract(path)
    assert "[DOCX 段落 1 / Paragraph 1] 配方 A" in result["text"]
    assert "[DOCX 段落 2 / Paragraph 2] 工艺 120 ℃" in result["text"]


def test_xls_and_xlsx_have_sheet_and_row_locations(tmp_path):
    import xlwt
    xls = tmp_path / "measurements.xls"
    book = xlwt.Workbook()
    sheet = book.add_sheet("性能")
    sheet.write(0, 0, "样品")
    sheet.write(1, 0, "A")
    sheet.write(1, 1, 42)
    book.save(str(xls))
    assert "[行 / Row 2] 1=A | 2=42" in extract(xls)["text"]

    xlsx = tmp_path / "measurements.xlsx"
    with ZipFile(xlsx, "w") as archive:
        archive.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        archive.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="性能" sheetId="1" r:id="rId1"/></sheets></workbook>')
        archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        archive.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>样品</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>A</t></is></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>')
    assert "[工作表 / Sheet: 性能]" in extract(xlsx)["text"]
    assert "[行 / Row 2] 1=A | 2=42" in extract(xlsx)["text"]
