#!/usr/bin/env python3
"""Extract page-separated text and a reproducible manifest using Poppler."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('pdf', type=Path)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    src = a.pdf.expanduser().resolve(strict=True)
    for tool in ('pdftotext', 'pdfinfo'):
        if not shutil.which(tool):
            p.error(f'{tool} unavailable; use a PDF tool and retain physical page indices.')
    info = subprocess.run(['pdfinfo', str(src)], check=True, capture_output=True, text=True).stdout
    match = re.search(r'^Pages:\s+(\d+)', info, re.M)
    if not match:
        p.error('Cannot determine physical page count.')
    count = int(match.group(1))
    out = a.out.expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    txt = subprocess.run(['pdftotext', '-layout', str(src), '-'], check=True, capture_output=True, text=True).stdout
    pages = txt.split('\f')
    if pages and not pages[-1].strip():
        pages.pop()
    if len(pages) != count:
        p.error(f'Text page count {len(pages)} differs from PDF {count}; inspect manually.')
    for i, page in enumerate(pages, 1):
        (out / f'page-{i:03d}.txt').write_text(page, encoding='utf-8')
    manifest = dict(path=str(src), sha256=hashlib.sha256(src.read_bytes()).hexdigest(),
                    page_count=count, text_method='pdftotext -layout',
                    warning='Text-layer extraction is not visual verification. Check tables, plots and duplicate/hidden text.')
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    (out / 'pdfinfo.txt').write_text(info, encoding='utf-8')
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == '__main__':
    main()
