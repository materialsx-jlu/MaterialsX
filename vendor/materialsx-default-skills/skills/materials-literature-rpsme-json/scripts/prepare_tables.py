#!/usr/bin/env python3
"""Local HTML/JATS/PDF table candidates and engine-neutral cell-grid adapter.

Does not execute Docling, MaTableGPT or DiSCoMaT. External engines must export the
documented cells envelope; all candidates still require sample/condition review.
"""
import argparse
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path


class Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.table, self.row, self.cell = [], None, None, None
        self.depth, self.caption = 0, False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table":
            self.depth += 1
            if self.depth > 1:
                raise ValueError("Nested tables need an explicit cell export; no silent flattening.")
            self.table = {"rows": [], "caption": ""}
        elif self.table is not None:
            if tag == "tr":
                self.row = []; self.table["rows"].append(self.row)
            elif tag in ("td", "th"):
                if self.row is None:
                    raise ValueError("Table cell without row")
                self.cell = {"text": "", "header": tag == "th",
                             "rowspan": int(attrs.get("rowspan", 1)),
                             "colspan": int(attrs.get("colspan", 1))}
                self.row.append(self.cell)
            elif tag == "caption":
                self.caption = True
            elif tag == "br" and self.cell is not None:
                self.cell["text"] += "\n"

    def handle_endtag(self, tag):
        if tag == "table":
            if self.table is not None:
                self.tables.append(self.table)
            self.table = None; self.depth -= 1
        elif tag in ("td", "th"):
            self.cell = None
        elif tag == "tr":
            self.row = None
        elif tag == "caption":
            self.caption = False

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["text"] += data
        elif self.caption and self.table is not None:
            self.table["caption"] += data


def expand_rows(rows):
    cells, occupied = [], set()
    for r, row in enumerate(rows):
        c = 0
        for raw in row:
            while (r, c) in occupied:
                c += 1
            rs, cs = raw.get("rowspan", 1), raw.get("colspan", 1)
            if not (isinstance(rs, int) and isinstance(cs, int) and 1 <= rs <= 1000 and 1 <= cs <= 1000):
                raise ValueError("Invalid/oversized cell span")
            coords = {(i, j) for i in range(r, r + rs) for j in range(c, c + cs)}
            if coords & occupied:
                raise ValueError("Overlapping merged cells")
            occupied |= coords
            cells.append({**raw, "row": r, "column": c, "rowspan": rs, "colspan": cs})
            c += cs
    return cells


def normalize(table, index, document_id, source_hash):
    cells = table.get("cells")
    if cells is None:
        cells = expand_rows(table.get("rows", []))
    if not cells:
        raise ValueError("Empty table candidate")
    occupied = {}
    for i, cell in enumerate(cells):
        for key in ("row", "column"):
            if type(cell.get(key)) is not int or not 0 <= cell[key] < 10000:
                raise ValueError("Cells require bounded zero-based row/column")
        for key in ("rowspan", "colspan"):
            cell.setdefault(key, 1)
            if type(cell[key]) is not int or not 1 <= cell[key] <= 1000:
                raise ValueError("Invalid cell span")
        if not isinstance(cell.get("text"), str):
            raise ValueError("Cell text must preserve a string, including empty/missing markers")
        cell["cell_id"] = f"T{index}-C{i+1}"
        for r in range(cell["row"], cell["row"] + cell["rowspan"]):
            for c in range(cell["column"], cell["column"] + cell["colspan"]):
                if (r, c) in occupied:
                    raise ValueError("Overlapping cell coordinates")
                occupied[r, c] = cell["cell_id"]
    height = 1 + max(r for r, c in occupied)
    width = 1 + max(c for r, c in occupied)
    flags = ["sample_condition_unit_and_footnote_review_required"]
    if len(occupied) != height * width:
        flags.append("ragged_or_missing_cells")
    if not any(c.get("header") for c in cells):
        flags.append("header_assignment_required")
    header_cells = [c for c in cells if c.get("header")]
    # Retain all headers/caption/footnotes in each row packet. The model determines
    # header hierarchy rather than treating first row or leftmost cell as truth.
    chunks = [{"row": r, "cells": [c for c in cells if c["row"] <= r < c["row"] + c["rowspan"]],
               "header_cells": header_cells, "caption": table.get("caption", ""),
               "footnotes": table.get("footnotes", [])} for r in range(height)]
    return {"table_id": table.get("table_id", f"TABLE-{source_hash[:12]}-{index}"),
            "document_id": document_id, "source_sha256": source_hash,
            "locator": table.get("locator", {}), "caption": table.get("caption", ""),
            "footnotes": table.get("footnotes", []), "cells": cells,
            "row_count": height, "column_count": width, "row_packets": chunks,
            "review_flags": flags, "status": "candidate_not_ontology_fact"}


def read_tables(path, kind):
    if kind == "html":
        parser = Tables(); parser.feed(path.read_text(encoding="utf-8")); parser.close()
        if parser.table is not None:
            raise ValueError("Unclosed table")
        return parser.tables, {"name": "stdlib_html", "version": "p0-1"}
    if kind == "jats":
        import xml.etree.ElementTree as ET
        raw = path.read_text(encoding="utf-8")
        if "<!ENTITY" in raw.upper() or "<!DOCTYPE" in raw.upper():
            raise ValueError("Supply JATS table fragments without DTD/entities; no external entity expansion")
        root = ET.fromstring(raw)
        tables = []
        for elem in root.iter():
            elem.tag = elem.tag.rsplit("}", 1)[-1]
        wrappers = list(root.iter("table-wrap"))
        for wrapper in wrappers or [root]:
            for table in wrapper.iter("table"):
                parser = Tables(); parser.feed(ET.tostring(table, encoding="unicode"))
                for parsed in parser.tables:
                    parsed["caption"] = " ".join("".join(c.itertext()) for c in wrapper.findall("caption"))
                    parsed["footnotes"] = ["".join(c.itertext()) for c in wrapper.findall("table-wrap-foot")]
                    parsed["locator"] = {"element_id": wrapper.get("id")}
                    tables.append(parsed)
        return tables, {"name": "stdlib_jats", "version": "p0-1"}
    if kind == "cells":
        value = json.loads(path.read_text(encoding="utf-8"))
        if value.get("format") != "rpsme-table-cells-v1" or not value.get("engine", {}).get("name") or not value["engine"].get("version"):
            raise ValueError("External export requires format=rpsme-table-cells-v1 and engine name/version")
        return value["tables"], value["engine"]
    import pymupdf as fitz
    tables = []
    with fitz.open(path) as doc:
        for page_no, page in enumerate(doc, 1):
            if not hasattr(page, "find_tables"):
                raise ValueError("This PyMuPDF lacks find_tables; use HTML or external cell export")
            for t in page.find_tables().tables:
                tables.append({"rows": [[{"text": cell if cell is not None else "", "header": False,
                                           "source_missing_cell": cell is None} for cell in row] for row in t.extract()],
                               "locator": {"pdf_page": page_no, "bbox": list(t.bbox)}})
    return tables, {"name": "pymupdf_find_tables", "version": fitz.VersionBind}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--format", choices=("html", "jats", "pdf", "cells"), required=True)
    parser.add_argument("--document-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        parser.error("Output must not overwrite source")
    try:
        tables, engine = read_tables(args.input, args.format)
        digest = hashlib.sha256(args.input.read_bytes()).hexdigest()
        result = {"format": "rpsme-table-candidates-v1", "engine": engine,
                  "source_sha256": digest, "input_format": args.format,
                  "tables": [normalize(t, i, args.document_id, digest) for i, t in enumerate(tables, 1)],
                  "limitations": "No automatic sample assignment, stoichiometric conversion, curve digitization or engine execution. Inspect source footnotes outside HTML table elements."}
        result["status"] = "needs_review" if tables else "no_tables_detected_not_proof_of_absence"
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"output": str(args.output), "table_count": len(tables), "status": result["status"]}))
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
