"""Validate M6.0 fixture geometry and hashes with ASE; no MLIP/scientific accuracy claims."""
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
from ase.io import read
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "samples" / "atomistic"
MANIFEST = json.loads((SAMPLES / "manifest.json").read_text())
STRUCTURE_SCHEMA = json.loads((ROOT / "schemas/m6/AtomicStructure.json").read_text())
VALID = [r for r in MANIFEST["samples"] if r["expected"] == "parse-valid"]


@pytest.mark.parametrize("entry", VALID, ids=[r["id"] for r in VALID])
def test_authored_geometry_roundtrip(entry):
    path = SAMPLES / entry["file"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"]
    normalized = json.loads((SAMPLES / entry["normalizedFile"]).read_text())
    Draft202012Validator(STRUCTURE_SCHEMA).validate(normalized)
    assert hashlib.sha256((SAMPLES / entry["normalizedFile"]).read_bytes()).hexdigest() == entry["normalizedSha256"]
    atoms = read(path, format="vasp" if path.suffix == ".POSCAR" else None)
    assert len(atoms) == entry["atomCount"]
    assert atoms.get_chemical_symbols() == [r["element"] for r in normalized["atoms"]]
    np.testing.assert_allclose(atoms.positions, [r["position"] for r in normalized["atoms"]], atol=1e-7)
    np.testing.assert_array_equal(atoms.pbc, normalized["pbc"])
    if normalized["cell"] is not None:
        np.testing.assert_allclose(atoms.cell.array, normalized["cell"], atol=1e-7)
        assert abs(np.linalg.det(atoms.cell.array)) > 1e-8
    assert entry["reference"] is None
    assert not entry["scientificValidationEligible"]
    assert normalized["source"]["provenance"] == "team-synthetic"
    assert "energy" not in atoms.info
    assert atoms.calc is None  # No hidden model output masquerading as DFT labels.


def test_invalid_fixtures_retain_the_adversarial_condition():
    # Parsers may accept these: M6.1 must reject calculation after parsing.
    assert not np.isfinite(read(SAMPLES / "nonfinite.xyz").positions).all()
    atoms = read(SAMPLES / "overlap.xyz")
    assert np.linalg.norm(atoms.positions[0] - atoms.positions[1]) == 0
    assert "0.5" in (SAMPLES / "partial-occupancy.cif").read_text()
    occupancy = read(SAMPLES / "partial-occupancy.cif").info["occupancy"]
    assert any(v < 1 for row in occupancy.values() for v in row.values())
    with pytest.raises((KeyError, ValueError)):
        read(SAMPLES / "unknown-element.xyz")
    assert abs(np.linalg.det(read(SAMPLES / "singular-cell.POSCAR", format="vasp").cell.array)) == 0
    assert json.loads((SAMPLES / "missing-pbc.structure.json").read_text())["pbc"] is None
    for row in MANIFEST["samples"]:
        assert hashlib.sha256((SAMPLES / row["file"]).read_bytes()).hexdigest() == row["sha256"]


def test_exported_schemas_are_valid_json_schema():
    paths = list((ROOT / "schemas/m6").glob("*.json"))
    assert len(paths) == 10
    for path in paths:
        Draft202012Validator.check_schema(json.loads(path.read_text()))
