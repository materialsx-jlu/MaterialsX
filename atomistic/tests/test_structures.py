from pathlib import Path
import sys
import pytest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from structures import inspect, to_atoms

ROOT=Path(__file__).resolve().parents[2]
@pytest.mark.parametrize("filename,count,pbc",[("si-diamond.POSCAR",8,[True]*3),("nacl-rocksalt.cif",8,[True]*3),("si-triclinic.extxyz",2,[True]*3),("cu-vacancy.POSCAR",3,[True]*3),("cu-slab.extxyz",4,[True,True,False]),("water.xyz",3,[False]*3),("methane.xyz",5,[False]*3)])
def test_actual_import(filename,count,pbc):
    structure=inspect(ROOT/"samples/atomistic"/filename,"test","source")
    assert len(structure["atoms"])==count and structure["pbc"]==pbc
    assert all(np.isfinite(a["position"]).all() for a in structure["atoms"])
    assert structure["charge"] is None and structure["spinMultiplicity"] is None
    if pbc==[True]*3:
        assert len(to_atoms(structure))==count
    else:
        with pytest.raises(ValueError,match="CORE_REQUIRES_BULK_PBC"):to_atoms(structure)

@pytest.mark.parametrize("filename",["nonfinite.xyz","unknown-element.xyz","singular-cell.POSCAR"])
def test_bad_geometry(filename):
    with pytest.raises((ValueError,KeyError,RuntimeError)):inspect(ROOT/"samples/atomistic"/filename,"test","source")

@pytest.mark.parametrize("filename,code",[("overlap.xyz","ATOMIC_OVERLAP"),("partial-occupancy.cif","DISORDERED_OCCUPANCY")])
def test_readable_but_blocked(filename,code):
    structure=inspect(ROOT/"samples/atomistic"/filename,"test","source")
    assert any(i["code"]==code and i["severity"]=="blocking" for i in structure["issues"])
    with pytest.raises(ValueError,match="BLOCKING_ISSUES"):to_atoms(structure)

def test_extxyz_requires_explicit_pbc(tmp_path):
    file=tmp_path/"unknown.extxyz";file.write_text('1\nLattice="3 0 0 0 3 0 0 0 3" Properties=species:S:1:pos:R:3\nSi 0 0 0\n')
    with pytest.raises(ValueError,match="PBC_REQUIRED"):inspect(file,"test","source")

def test_no_automatic_multiple_frame_selection(tmp_path):
    file=tmp_path/"multi.xyz";file.write_text('1\n\nH 0 0 0\n1\n\nH 0 0 1\n')
    with pytest.raises(ValueError,match="MULTIPLE_FRAMES"):inspect(file,"test","source")
