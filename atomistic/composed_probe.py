"""Native engine mapping/derivative consistency, not independent DFT accuracy."""
import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import numpy as np
from ase.build import bulk
from adapters import load,evaluate
from composed import engine,D3Correction,ComposedCalculator,validate_atoms
import tempfile,shutil
root=Path(sys.argv[1]);calculator,elements,details=load('mace-mp-0b3-medium-d3-bj-pbe-si',Path(sys.argv[2]),4,root)
a=bulk('Si','diamond',a=5.43,cubic=True);a.positions[0]+=[.03,-.02,.01]
r=evaluate(a,calculator,elements);parts=calculator.components
assert abs(parts['correction']['energyEv'])>1e-6
for key in ['forcesEvPerAngstrom','stress']:
 assert np.max(np.abs(np.asarray(parts['total'][key])-np.asarray(parts['baseline'][key])-np.asarray(parts['correction'][key])))<1e-12
assert abs(parts['total']['energyEv']-parts['baseline']['energyEv']-parts['correction']['energyEv'])<1e-12
try:ComposedCalculator(calculator,root);raise AssertionError('nested correction accepted')
except ValueError:pass
bad=a.copy();bad.pbc=False
try:validate_atoms(bad);raise AssertionError('nonPBC accepted')
except ValueError:pass
bad=a.copy();bad.positions[0]=bad.positions[1]+[.1,0,0]
try:validate_atoms(bad);raise AssertionError('close contacts accepted')
except ValueError:pass
eps=1e-5;forces=[];stress=[]
for k in range(3):
    b=a.copy();b.positions[0,k]+=eps;p=evaluate(b,calculator,elements)['energyEv'];b.positions[0,k]-=2*eps;q=evaluate(b,calculator,elements)['energyEv'];error=abs(-(p-q)/(2*eps)-r['forcesEvPerAngstrom'][0][k]);assert error<1e-4,error;forces.append(error)
for k,(i,j) in enumerate([(0,0),(1,1),(2,2),(1,2),(0,2),(0,1)]):
    energies=[]
    for sign in [1,-1]:
        f=np.eye(3);f[i,j]+=sign*eps*(1 if i==j else .5)
        if i!=j:f[j,i]+=sign*eps*.5
        b=a.copy();b.set_cell(a.cell.array@f.T,scale_atoms=True);energies.append(evaluate(b,calculator,elements)['energyEv'])
    derivative=(energies[0]-energies[1])/(2*eps*a.get_volume());error=abs(derivative-r['stress']['values'][k]);assert error<1e-5,error;stress.append(error)
q=np.array([[0,-1,0],[1,0,0],[0,0,1]]);b=a.copy();b.positions=a.positions@q.T;b.set_cell(a.cell.array@q.T);rot=evaluate(b,calculator,elements);assert abs(rot['energyEv']-r['energyEv'])<1e-8;assert np.max(np.abs(np.array(rot['forcesEvPerAngstrom'])-np.array(r['forcesEvPerAngstrom'])@q.T))<1e-8
# Check the analytic correction alone as well, so a small correction cannot hide an inconsistent gradient.
d3=D3Correction(root);a.calc=d3;energy=a.get_potential_energy();df=a.get_forces();ds=a.get_stress();dforce=[];dstress=[]
for k in range(3):
    b=a.copy();b.calc=d3;b.positions[0,k]+=eps;p=b.get_potential_energy();b.positions[0,k]-=2*eps;q=b.get_potential_energy();error=abs(-(p-q)/(2*eps)-df[0,k]);assert error<1e-7,error;dforce.append(error)
for k,(i,j) in enumerate([(0,0),(1,1),(2,2),(1,2),(0,2),(0,1)]):
    energies=[]
    for sign in [1,-1]:
        f=np.eye(3);f[i,j]+=sign*eps*(1 if i==j else .5)
        if i!=j:f[j,i]+=sign*eps*.5
        b=a.copy();b.calc=d3;b.set_cell(a.cell.array@f.T,scale_atoms=True);energies.append(b.get_potential_energy())
    error=abs((energies[0]-energies[1])/(2*eps*a.get_volume())-ds[k]);assert error<1e-8,error;dstress.append(error)
b=a.copy();b.positions+=[1.7,-2.1,.9];b.calc=d3;assert abs(b.get_potential_energy()-energy)<1e-10
bad=a.copy();bad.symbols[0]='C'
try:validate_atoms(bad);raise AssertionError('wrong element accepted')
except ValueError:pass
# Validate binary and source tamper rejection in an isolated copy, never the active engine.
with tempfile.TemporaryDirectory(prefix='mx-nep-identity-') as d:
    isolated=Path(d);manifest=json.loads((root/'models/potentials/physics-m615.json').read_text())
    paths=[s['path'] for s in manifest['engine']['sources']]+['models/potentials/physics-m615.json','models/potentials/composition-profile-m615.json']
    for path in paths:
        target=isolated/path;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/path,target)
    original,receipt,_=engine(root);base=isolated/'native-engines/d3-bj';base.mkdir(parents=True)
    shutil.copyfile(original,base/'d3-runner');shutil.copyfile(original.parent/'RUNTIME.json',base/'RUNTIME.json')
    engine(isolated);(base/'d3-runner').write_bytes(b'tampered')
    try:engine(isolated);raise AssertionError('altered native binary accepted')
    except ValueError as e:assert str(e)=='COMPOSITION_ENGINE_IDENTITY_MISMATCH'
    shutil.copyfile(original,base/'d3-runner');(isolated/'vendor/nep-cpu/nep.h').write_text('tampered')
    try:engine(isolated);raise AssertionError('altered native source accepted')
    except ValueError as e:assert str(e)=='COMPOSITION_SOURCE_CHANGED'
print(json.dumps({'stage':'M6.15','passed':True,'elements':elements,'adapter':details,'energyEv':r['energyEv'],'components':parts,'forceDerivativeErrorsEvPerAngstrom':forces,'stressDerivativeErrorsEvPerAngstrom3':stress,'rotationEnergyDeltaEv':rot['energyEv']-r['energyEv'],'nativeBinaryTamperRejected':True,'nativeSourceTamperRejected':True,'correctionForceDerivativeErrors':dforce,'correctionStressDerivativeErrors':dstress,'translationInvariant':True,'independentDFTAccuracyValidated':False},allow_nan=False))
