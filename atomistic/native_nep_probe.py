"""Native engine mapping/derivative consistency, not independent DFT accuracy."""
import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import numpy as np
from ase.build import bulk
from adapters import load,evaluate
from native_nep import engine
import tempfile,shutil
root=Path(sys.argv[1]);calculator,elements,details=load('nep-si-2022-nep4-3body',Path(sys.argv[2]),4,root)
a=bulk('Si','diamond',a=5.43,cubic=True);a.positions[0]+=[.07,-.04,.03]
r=evaluate(a,calculator,elements);eps=1e-5;forces=[];stress=[]
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
# Validate binary and source tamper rejection in an isolated copy, never the active engine.
with tempfile.TemporaryDirectory(prefix='mx-nep-identity-') as d:
    isolated=Path(d);manifest=json.loads((root/'models/potentials/native-m614.json').read_text())
    paths=[s['path'] for s in manifest['engine']['sources']]+['models/potentials/native-m614.json']
    for path in paths:
        target=isolated/path;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/path,target)
    original,receipt=engine(root);base=isolated/'native-engines/nep-cpu';base.mkdir(parents=True)
    shutil.copyfile(original,base/'nep-runner');shutil.copyfile(original.parent/'RUNTIME.json',base/'RUNTIME.json')
    engine(isolated);(base/'nep-runner').write_bytes(b'tampered')
    try:engine(isolated);raise AssertionError('altered native binary accepted')
    except ValueError as e:assert str(e)=='NATIVE_ENGINE_IDENTITY_MISMATCH'
    shutil.copyfile(original,base/'nep-runner');(isolated/'vendor/nep-cpu/nep.h').write_text('tampered')
    try:engine(isolated);raise AssertionError('altered native source accepted')
    except ValueError as e:assert str(e)=='NATIVE_SOURCE_CHANGED'
print(json.dumps({'stage':'M6.14','passed':True,'elements':elements,'adapter':details,'energyEv':r['energyEv'],'forceDerivativeErrorsEvPerAngstrom':forces,'stressDerivativeErrorsEvPerAngstrom3':stress,'rotationEnergyDeltaEv':rot['energyEv']-r['energyEv'],'nativeBinaryTamperRejected':True,'nativeSourceTamperRejected':True,'independentDFTAccuracyValidated':False},allow_nan=False))
