"""Analytic/ASE calculators verify control logic; these are not MLIP accuracy labels."""
from pathlib import Path
import sys
import json
import numpy as np
import pytest
from ase import Atoms
from ase.calculators.calculator import Calculator, all_changes
from ase.calculators.emt import EMT
from ase.build import bulk
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from relaxation import run_relaxation, geometry_guard, validate_options
from adapters import GPA_TO_EV_A3
from worker import atomic_json, check_schema
ROOT=Path(__file__).resolve().parents[2]

class Harmonic(Calculator):
    implemented_properties=['energy','forces','stress']
    def __init__(self,reference,**kw):super().__init__(**kw);self.reference=reference
    def calculate(self,atoms=None,properties=None,system_changes=all_changes):
        super().calculate(atoms,properties,system_changes)
        delta=self.atoms.positions-self.reference
        self.results={'energy':float(.5*np.sum(delta**2)),'forces':-delta,'stress':np.zeros(6)}


def execute(tmp_path,atoms,calculator,mode='fixed',pressure=None,steps=30,fmax=.05,constraint='none'):
    tmp_path.mkdir(exist_ok=True)
    original={'schemaVersion':'m6.0-v1','id':'source','coordinateUnit':'angstrom','atoms':[{'id':f'a{i}','element':e,'position':p.tolist(),'occupancy':1} for i,(e,p) in enumerate(zip(atoms.get_chemical_symbols(),atoms.positions))],
      'cell':atoms.cell.array.tolist(),'pbc':[True]*3,'charge':None,'spinMultiplicity':None,'source':{'artifactId':'source','sha256':'a'*64,'format':'extxyz','provenance':'team-synthetic','license':'team synthetic fixture','transformations':[]},'issues':[]}
    options={'optimizer':'FIRE','cellMode':mode,'cellConstraint':constraint,'externalPressureGPa':pressure,'maxSteps':steps,'fmaxEvPerAngstrom':fmax}
    task={'kind':'relaxation',**{k:v for k,v in options.items() if k!='cellConstraint'}}
    plan={'id':'test-run','task':task,'budget':{'maxSteps':steps}}
    def check63(name,value):
        from jsonschema import Draft202012Validator
        Draft202012Validator(json.loads((ROOT/'schemas/m63'/f'{name}.json').read_text())).validate(value)
    return run_relaxation(atoms,calculator,['Cu','Si'],original,plan,options,tmp_path,'test-run',atomic_json,lambda *a,**k:None,lambda name,value:check_schema(ROOT,name,value),check63)


def test_vector_norm_and_actual_step_limit(tmp_path):
    a=Atoms('Si',positions=[[.03,.03,.03]],cell=[4,4,4],pbc=True)
    _,s=execute(tmp_path,a,Harmonic(np.zeros((1,3))),steps=1)
    assert s['initial']['maxForceEvPerAngstrom']>.05
    assert s['stopReason']=='max_steps' and s['completedSteps']==1
    rows=json.loads((tmp_path/'steps.json').read_text());assert len(rows)==2
    assert np.allclose(s['displacementsAngstrom'][0],a.positions[0]-[.03]*3)


def test_fixed_convergence_keeps_cell_and_original(tmp_path):
    a=Atoms('Si',positions=[[.15,0,0]],cell=[4,4,4],pbc=True)
    initial=a.cell.array.copy();_,s=execute(tmp_path,a,Harmonic(np.zeros((1,3))),steps=100)
    assert s['stopReason']=='converged' and s['final']['maxForceEvPerAngstrom']<.05
    assert s['final']['energyEv']<s['initial']['energyEv']
    assert np.array_equal(a.cell,initial)
    assert (tmp_path/'final.extxyz').is_file() and (tmp_path/'last-valid.json').is_file()


def test_variable_cell_requires_filter_force_not_only_atomic_force(tmp_path):
    a=bulk('Cu','fcc',a=3.9,cubic=True)
    _,s=execute(tmp_path,a,EMT(),mode='variable',pressure=0,steps=1,fmax=.001,constraint='hydrostatic')
    assert s['initial']['maxForceEvPerAngstrom']<.001
    assert s['initial']['maxFilterForceEvPerAngstrom']>.001
    assert s['stopReason']=='max_steps'
    assert s['final']['volumeAngstrom3']<s['initial']['volumeAngstrom3']
    ratios=np.diag(a.cell)/3.9;assert np.allclose(ratios,ratios[0])


def test_pressure_sign_and_enthalpy(tmp_path):
    volumes=[]
    for pressure in [-1,1]:
        a=bulk('Cu','fcc',a=3.59,cubic=True)
        _,s=execute(tmp_path/str(pressure),a,EMT(),mode='variable',pressure=pressure,steps=1,fmax=.001,constraint='hydrostatic')
        for row in (s['initial'],s['final']):assert row['objectiveEv']==pytest.approx(row['energyEv']+pressure*GPA_TO_EV_A3*row['volumeAngstrom3'])
        volumes.append(s['final']['volumeAngstrom3'])
    assert volumes[1]<volumes[0]


def test_geometry_abort_does_not_publish_final(tmp_path):
    a=Atoms('Si2',positions=[[0,0,0],[.1,0,0]],cell=[4,4,4],pbc=True)
    with pytest.raises(ValueError,match='OVERLAP'):execute(tmp_path,a,Harmonic(a.positions.copy()))
    assert not (tmp_path/'final.json').exists()
    a.cell*=2
    with pytest.raises(ValueError,match='VOLUME_LIMIT'):geometry_guard(a,np.eye(3)*4)


def test_no_implicit_pressure_or_strain():
    options={'optimizer':'FIRE','cellMode':'variable','cellConstraint':'full','externalPressureGPa':None,'maxSteps':2,'fmaxEvPerAngstrom':.01}
    task={'kind':'relaxation',**{k:v for k,v in options.items() if k!='cellConstraint'}}
    with pytest.raises(ValueError,match='EXPLICIT_PRESSURE'):validate_options(options,task)
