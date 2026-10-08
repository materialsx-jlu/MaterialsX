"""Bounded, local structure import. No input-provided calculators or Python objects."""
from __future__ import annotations
import hashlib
import re
import warnings
from pathlib import Path
import numpy as np
from ase import Atoms
from ase.io import read

MAX_BYTES = 4 * 1024 * 1024
MAX_ATOMS = 2000

def inspect(path: Path, structure_id: str, artifact_id: str) -> dict:
    data = path.read_bytes()
    if not data or len(data) > MAX_BYTES:
        raise ValueError("STRUCTURE_SIZE_LIMIT")
    text = data.decode("utf-8-sig")
    name = path.name.lower()
    fmt = "poscar" if name.endswith(".poscar") or name in ("poscar", "contcar") else path.suffix.lower().lstrip(".")
    if fmt not in {"cif", "xyz", "extxyz", "poscar"}:
        raise ValueError("UNSUPPORTED_STRUCTURE_FORMAT")
    issues = []
    def issue(code, detail, blocking=False):
        item = {"code": code, "severity": "blocking" if blocking else "warning", "detail": str(detail)[:4000]}
        if item not in issues and len(issues) < 100:
            issues.append(item)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        if fmt == "cif":
            from pymatgen.io.cif import CifParser
            parser = CifParser.from_str(text, check_cif=True)
            structures = parser.parse_structures(primitive=False, check_occu=True, on_error="raise")
            if len(structures) != 1:
                raise ValueError("MULTIPLE_STRUCTURES_NOT_SUPPORTED")
            crystal = structures[0]
            if len(crystal) > MAX_ATOMS:
                raise ValueError("ATOM_COUNT_LIMIT")
            sites = []
            for site in crystal:
                for specie, occupancy in site.species.items():
                    sites.append((specie.symbol, site.coords.tolist(), float(occupancy)))
            if not crystal.is_ordered:
                issue("DISORDERED_OCCUPANCY", "CIF has partial/mixed occupancy; no automatic ordering or renormalization.", True)
            atoms = Atoms([s[0] for s in sites], positions=[s[1] for s in sites], cell=crystal.lattice.matrix, pbc=True)
            occupancies = [s[2] for s in sites]
            for message in parser.warnings:
                issue("CIF_PARSER_WARNING", message)
        else:
            if fmt in ("xyz", "extxyz"):
                count = int(text.splitlines()[0])
                if not 1 <= count <= MAX_ATOMS:
                    raise ValueError("ATOM_COUNT_LIMIT")
                if fmt == "extxyz" and not re.search(r"\bpbc\s*=", text.splitlines()[1], re.I):
                    raise ValueError("EXTXYZ_PBC_REQUIRED")
            frames = read(path, format="vasp" if fmt == "poscar" else fmt, index=":")
            if len(frames) != 1:
                raise ValueError("MULTIPLE_FRAMES_NOT_SUPPORTED")
            atoms = frames[0]
            occupancies = [1.0] * len(atoms)
            if atoms.constraints:
                issue("CONSTRAINTS_PRESENT", "Input constraints are retained in the source; this single-point adapter cannot apply them.", True)
            if fmt == "xyz":
                atoms.pbc = False
                issue("MOLECULE_NO_CHARGE_SPIN", "Plain XYZ specifies neither charge nor spin. No values have been inferred.")
        for warning in caught:
            if not any(i["detail"] == str(warning.message)[:4000] for i in issues):
                issue("PARSER_WARNING", warning.message)
    if not 1 <= len(atoms) <= MAX_ATOMS:
        raise ValueError("ATOM_COUNT_LIMIT")
    if not np.isfinite(atoms.positions).all() or not np.isfinite(atoms.cell.array).all():
        raise ValueError("NONFINITE_GEOMETRY")
    if np.any(atoms.numbers == 0):
        raise ValueError("UNKNOWN_ELEMENT")
    cell = atoms.cell.array.tolist() if np.any(atoms.cell.array) else None
    if atoms.pbc.any() and (cell is None or abs(np.linalg.det(atoms.cell.array)) < 1e-8):
        raise ValueError("SINGULAR_PERIODIC_CELL")
    if any(o <= 0 or o > 1 for o in occupancies):
        raise ValueError("INVALID_OCCUPANCY")
    charge = atoms.info.get("charge") if fmt == "extxyz" else None
    spin = atoms.info.get("spinMultiplicity") if fmt == "extxyz" else None
    for value in (charge, spin):
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, np.integer))):
            raise ValueError("INVALID_ELECTRONIC_STATE")
    if spin is not None and spin < 1:
        raise ValueError("INVALID_ELECTRONIC_STATE")
    # Minimum image works for triclinic and mixed PBC; row-wise memory stays bounded.
    for index in range(len(atoms) - 1):
        distances = atoms.get_distances(index, range(index + 1, len(atoms)), mic=bool(atoms.pbc.any()))
        if np.any(distances < 0.4):
            issue("ATOMIC_OVERLAP", "At least one atom pair is closer than 0.4 angstrom (minimum image).", True)
            break
    return {"schemaVersion": "m6.0-v1", "id": structure_id, "coordinateUnit": "angstrom",
            "atoms": [{"id": f"a{i+1}", "element": symbol, "position": position.tolist(), "occupancy": occupancies[i]}
                      for i, (symbol, position) in enumerate(zip(atoms.get_chemical_symbols(), atoms.positions))],
            "cell": cell, "pbc": atoms.pbc.tolist(), "charge": int(charge) if charge is not None else None, "spinMultiplicity": int(spin) if spin is not None else None,
            "source": {"artifactId": artifact_id, "sha256": hashlib.sha256(data).hexdigest(), "format": fmt,
                       "provenance": "user-file", "license": "user-provided; rights not inferred", "transformations": []}, "issues": issues}

def to_atoms(structure: dict, molecular: bool = False) -> Atoms:
    if any(i["severity"] == "blocking" for i in structure["issues"]):
        raise ValueError("STRUCTURE_HAS_BLOCKING_ISSUES")
    if any(a["occupancy"] != 1 for a in structure["atoms"]):
        raise ValueError("DISORDERED_OCCUPANCY")
    if molecular:
        from ase.data import atomic_numbers
        if structure["pbc"] != [False, False, False] or structure["charge"] != 0 or structure["spinMultiplicity"] != 1:
            raise ValueError("MOLECULAR_BOUNDARY_OR_ELECTRONIC_STATE_UNSUPPORTED")
        if sum(atomic_numbers[a["element"]] for a in structure["atoms"]) % 2:
            raise ValueError("ELECTRON_COUNT_PARITY_MISMATCH")
        if len(structure["atoms"]) > 128:
            raise ValueError("MOLECULAR_ATOM_COUNT_LIMIT")
    elif structure["charge"] is not None or structure["spinMultiplicity"] is not None:
        raise ValueError("CHARGE_SPIN_INPUT_UNSUPPORTED")
    # M6.1 core screening is limited to 3D inorganic bulk, not slabs/molecules/polymer use.
    if not molecular and structure["pbc"] != [True, True, True]:
        raise ValueError("CORE_REQUIRES_BULK_PBC")
    return Atoms([a["element"] for a in structure["atoms"]], positions=[a["position"] for a in structure["atoms"]],
                 cell=structure["cell"], pbc=structure["pbc"])
