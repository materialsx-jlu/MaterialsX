"""Engineering consistency probe only: no independent reference accuracy claim."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
import torch
from ase import Atoms
from ase.build import molecule
from adapters import load, evaluate
root=Path(sys.argv[1]);weight=Path(sys.argv[2]);calculator,elements,details=load('ani-2x-ensemble',weight,4,root)
import torchani.models as published
# Pinned upstream public factory, redirected to the exact reviewed local state dict for this test.
published._fetch_state_dict=lambda *a,**k: torch.load(weight,map_location='cpu',weights_only=True)
reference=published.ANI2x(strategy='pyaev',device='cpu',dtype=torch.float64).ase()
rows=[]
for atoms in [molecule('H2O'),molecule('CH3CH2OH'),Atoms('HF',positions=[[0,0,0],[1.02,0,0]]),Atoms('SH2',positions=[[0,0,0],[1.34,0,0],[-.4,1.2,0]])]:
    actual=evaluate(atoms,calculator,elements);expected=evaluate(atoms,reference,elements)
    assert abs(actual['energyEv']-expected['energyEv'])<1e-9
    assert np.max(np.abs(np.array(actual['forcesEvPerAngstrom'])-expected['forcesEvPerAngstrom']))<1e-8
    original=atoms.positions.copy();eps=1e-4
    atoms.positions[0,0]+=eps;plus=evaluate(atoms,calculator,elements)['energyEv'];atoms.positions[0,0]-=2*eps;minus=evaluate(atoms,calculator,elements)['energyEv'];atoms.positions[:]=original
    finite_difference=-(plus-minus)/(2*eps);error=abs(finite_difference-actual['forcesEvPerAngstrom'][0][0]);assert error<1e-4,error
    atoms.translate([2.4,-.8,1.7]);shifted=evaluate(atoms,calculator,elements);assert abs(actual['energyEv']-shifted['energyEv'])<1e-8
    rows.append({'formula':atoms.get_chemical_formula(),'officialFactoryEnergyDeltaEv':actual['energyEv']-expected['energyEv'],'finiteDifferenceForceErrorEvPerAngstrom':error,'translationEnergyDeltaEv':shifted['energyEv']-actual['energyEv'],'netForceEvPerAngstrom':np.sum(actual['forcesEvPerAngstrom'],axis=0).tolist()})
print(json.dumps({'passed':True,'elements':elements,'adapter':details,'checks':rows,'independentDFTAccuracyValidated':False},allow_nan=False))
