#!/usr/bin/env python3
"""Convert an explicitly selected research document into bounded, cited text."""
import json
import sys
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

MAX_TEXT = 8 * 1024 * 1024
MAX_PAGES = 2000


class Output:
    def __init__(self):
        self.parts = []
        self.bytes = 0

    def add(self, value):
        value = value.strip() + "\n"
        size = len(value.encode("utf-8"))
        if self.bytes + size > MAX_TEXT:
            raise ValueError("EXTRACTED_TEXT_LIMIT: 文本超过 8 MiB，请拆分文档后分别添加")
        self.parts.append(value)
        self.bytes += size

    def result(self):
        return "\n".join(self.parts)


def pdf(path, output):
    import pymupdf
    with pymupdf.open(path) as document:
        if document.needs_pass:
            raise ValueError("PDF_ENCRYPTED: 请先提供可读取的 PDF")
        if len(document) > MAX_PAGES:
            raise ValueError("PDF_PAGE_LIMIT: 超过 2000 页，请拆分文档")
        ocr_failed = []
        for number, page in enumerate(document, 1):
            text = page.get_text("text", sort=False).strip()
            if len(text) < 80:
                for language in ("eng+chi_sim", "eng"):
                    try:
                        text = page.get_text(textpage=page.get_textpage_ocr(language=language, dpi=200, full=True)).strip() or text
                        break
                    except Exception:
                        if language == "eng":
                            ocr_failed.append(number)
            output.add(f"[PDF 第 {number} 页 / Page {number}]\n{text or '[本页无可提取文本 / No extractable text]'}")
        return {"pageCount": len(document), "ocrUnverifiedPages": ocr_failed}


def docx(path, output):
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    with ZipFile(path) as archive:
        if len(archive.infolist()) > 5000 or sum(i.file_size for i in archive.infolist()) > 128 * 1024 * 1024:
            raise ValueError("DOCX_ARCHIVE_LIMIT: 文档解压后过大")
        if "word/document.xml" not in archive.namelist():
            raise ValueError("DOCX_INVALID: 缺少文档正文")
        root = ET.fromstring(archive.read("word/document.xml"))
        for number, paragraph in enumerate(root.iter(ns + "p"), 1):
            text = "".join(node.text or "" for node in paragraph.iter(ns + "t")).strip()
            if text:
                output.add(f"[DOCX 段落 {number} / Paragraph {number}] {text}")
    return {}


def spreadsheet(path, output):
    from python_calamine import CalamineWorkbook
    if path.suffix.lower() == ".xlsx":
        with ZipFile(path) as archive:
            if len(archive.infolist()) > 5000 or sum(i.file_size for i in archive.infolist()) > 128 * 1024 * 1024:
                raise ValueError("XLSX_ARCHIVE_LIMIT: 工作簿解压后过大")
    with CalamineWorkbook.from_path(path) as workbook:
        if len(workbook.sheet_names) > 50:
            raise ValueError("SHEET_LIMIT: 超过 50 个工作表")
        for name in workbook.sheet_names:
            output.add(f"[工作表 / Sheet: {name}]")
            rows = workbook.get_sheet_by_name(name).to_python(skip_empty_area=False)
            if len(rows) > 100000:
                raise ValueError("ROW_LIMIT: 工作表超过 100000 行")
            for number, row in enumerate(rows, 1):
                if len(row) > 256:
                    raise ValueError("COLUMN_LIMIT: 工作表超过 256 列")
                cells = [f"{column + 1}={str(value)[:1000]}" for column, value in enumerate(row) if value is not None and value != ""]
                if cells:
                    output.add(f"[行 / Row {number}] " + " | ".join(cells))
    return {}


def main():
    path = Path(sys.argv[1])
    output = Output()
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        details = pdf(path, output)
    elif suffix == ".docx":
        details = docx(path, output)
    elif suffix in (".xls", ".xlsx"):
        details = spreadsheet(path, output)
    else:
        raise ValueError("UNSUPPORTED_ATTACHMENT_FORMAT")
    print(json.dumps({"text": output.result(), **details}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
