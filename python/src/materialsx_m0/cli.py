from __future__ import annotations

import argparse
import json
import shutil

from .documents import extract_pdf
from .science import run_ase_probe


def main() -> None:
    parser = argparse.ArgumentParser(description="MaterialsX M0 scientific probes")
    subparsers = parser.add_subparsers(dest="command", required=True)
    pdf_parser = subparsers.add_parser("pdf")
    pdf_parser.add_argument("path")
    subparsers.add_parser("science")
    subparsers.add_parser("solvers")
    args = parser.parse_args()

    if args.command == "pdf":
        result = extract_pdf(args.path).as_dict()
    elif args.command == "science":
        result = run_ase_probe().as_dict()
    else:
        result = {name: shutil.which(name) for name in ("pw.x", "lmp", "lammps", "docker")}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
