"""Analytic physics/control tests, not MLIP accuracy evidence."""
from pathlib import Path
import sys
import json
import numpy as np
import pytest
from ase import Atoms, units
from ase.calculators.calculator import Calculator, all_changes
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from dynamics import run_md, diagnostics, numerical_guard
from worker import atomic_json
ROOT=Path(__file__).resolve().parents[2]
class Harmonic(Calculator):
    implemented_properties=['energy','forces','stress']
    def __init__(self,reference,fail_after=None):super().__init__();self.reference=reference;self.calls=0;self.fail_after=fail_after
    def calculate(self,atoms=None,properties=None,system_changes=all_changes):
        super().calculate(atoms,properties,system_changes);self.calls+=1
        if self.fail_after and self.calls>=self.fail_after:raise ValueError('MODEL_FAILURE')
        d=self.atoms.positions-self.reference
        self.results={'energy':float(.5*np.sum(d*d)),'forces':-d,'stress':np.zeros(6)}
def execute(directory,ensemble='nve',steps=100,sample=7,seed=20261001,fail_after=None):
    directory.mkdir(exist_ok=True);a=Atoms('Si2',positions=[[0,0,0],[3,3,3]],cell=[8,8,8],pbc=True)
    o=dict(ensemble=ensemble,steps=steps,timestepFs=.5,temperatureK=300,sampleEvery=sample,seed=seed,frictionInverseFs=.01 if ensemble=='nvt' else None)
    original={'id':'input','atoms':[{'element':'Si','position':p.tolist()} for p in a.positions]}
    task={'kind':'md',**{k:v for k,v in o.items() if k!='frictionInverseFs'}}
    plan=dict(id='run',task=task,budget=dict(maxAtoms=256,maxSteps=steps,maxMemoryMiB=4096,maxOutputMiB=64))
    def check(name,value):
        from jsonschema import Draft202012Validator
        Draft202012Validator(json.loads((ROOT/'schemas/m65'/f'{name}.json').read_text())).validate(value)
    return run_md(a,Harmonic(a.positions.copy(),fail_after),['Si'],original,plan,o,directory,'run',atomic_json,lambda *a,**k:None,check)
def test_actual_frames_sampling_final_and_velocity_units(tmp_path):
    _,s=execute(tmp_path,steps=10,sample=3);idx=json.loads((tmp_path/'trajectory-index.json').read_text())
    assert [e['step'] for e in idx['entries']]==[0,3,6,9,10]
    frames=[json.loads(line) for line in (tmp_path/'frames.ndjson').read_text().splitlines()]
    from ase.io import read
    xyz=read(tmp_path/'trajectory.extxyz',index=':')
    assert len(xyz)==len(frames)==5
    initial=np.array(frames[0]['velocitiesAngstromPerFs'])/units.fs
    kinetic=.5*np.sum(xyz[0].get_masses()[:,None]*initial**2)
    assert kinetic==pytest.approx(s['initial']['kineticEnergyEv'])
    assert s['initial']['temperatureK']==pytest.approx(300)
    assert np.allclose(xyz[-1].arrays['velocity_A_per_fs'],frames[-1]['velocitiesAngstromPerFs'],atol=1e-8)
    assert xyz[-1].info['time_fs']==5 and frames[-1]['step']['timeFs']==5
    assert s['nveVerdict']=='insufficient_duration'
def test_seed_reproducibility_and_finite_conserved_harmonic_energy(tmp_path):
    a=tmp_path/'a';b=tmp_path/'b';_,sa=execute(a,steps=100);_,sb=execute(b,steps=100)
    fa=[json.loads(l) for l in (a/'frames.ndjson').read_text().splitlines()];fb=[json.loads(l) for l in (b/'frames.ndjson').read_text().splitlines()]
    assert sa['initialVelocitySha256']==sb['initialVelocitySha256']
    for x,y in zip(fa,fb):assert np.array_equal(x['positionsAngstrom'],y['positionsAngstrom'])
    assert abs(sa['final']['totalEnergyEv']-sa['initial']['totalEnergyEv'])<1e-4
def test_nvt_separate_temperature_diagnostic(tmp_path):
    _,s=execute(tmp_path,ensemble='nvt',steps=100)
    assert s['integrator']=='Langevin' and s['nveVerdict']=='not_applicable' and s['nveDriftMevPerAtomPerPs'] is None
    assert s['nvtVerdict']=='insufficient_duration' and s['nvtMeanTemperatureK']>0
def test_drift_units_and_threshold_do_not_depend_on_thermostat():
    rows=[{'timeFs':i*100,'totalEnergyEv':2+i*.0001,'temperatureK':300} for i in range(11)]
    d=diagnostics(rows,{'ensemble':'nve'},2)
    assert d['nveDriftMevPerAtomPerPs']==pytest.approx(.5)
    assert d['nveVerdict']=='passed'
    rows=[{**r,'totalEnergyEv':r['totalEnergyEv']*3} for r in rows]
    assert diagnostics(rows,{'ensemble':'nve'},2)['nveVerdict']=='failed'
    assert diagnostics(rows,{'ensemble':'nvt','temperatureK':300},2)['nveVerdict']=='not_applicable'
def test_failure_keeps_only_actual_indexed_frames(tmp_path):
    with pytest.raises(ValueError,match='MODEL_FAILURE'):execute(tmp_path,steps=100,sample=1,fail_after=6)
    idx=json.loads((tmp_path/'trajectory-index.json').read_text());assert 0<idx['entries'][-1]['step']<100
    assert not (tmp_path/'md-summary.json').exists()
    import hashlib
    for entry in idx['entries']:
        raw=(tmp_path/'frames.ndjson').read_bytes()[entry['frame']['offset']:entry['frame']['offset']+entry['frame']['bytes']]
        assert hashlib.sha256(raw).hexdigest()==entry['frame']['sha256']
@pytest.mark.parametrize('kind',['nonfinite','temperature','velocity','force','displacement'])
def test_numerical_stops(kind):
    a=Atoms('Si',positions=[[0,0,0]],cell=[5,5,5],pbc=True);a.set_velocities([[0,0,0]])
    prev=a.positions.copy();values={'forcesEvPerAngstrom':[[0,0,0]]};temp=300
    if kind=='nonfinite':a.set_velocities([[np.nan,0,0]])
    if kind=='temperature':temp=5001
    if kind=='velocity':a.set_velocities([[1/units.fs,0,0]])
    if kind=='force':values['forcesEvPerAngstrom']=[[101,0,0]]
    if kind=='displacement':a.positions[0,0]=.201
    with pytest.raises(ValueError,match='MD_'):numerical_guard(a,prev,values,temp)
