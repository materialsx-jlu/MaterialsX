"""Pinned NEP_CPU process calculator. Native virial is converted to ASE positive-tension stress."""
import hashlib,json,subprocess,sys
from pathlib import Path
import numpy as np
from ase.calculators.calculator import Calculator, all_changes

def engine(root):
    m=json.loads((root/'models/potentials/native-m614.json').read_text())
    platform='macos-arm64' if sys.platform=='darwin' else 'unsupported'
    base=root/'native-engines/nep-cpu'
    if not base.exists():base=root/'runtime/native-engines'/platform/'nep-cpu'
    r=json.loads((base/'RUNTIME.json').read_text())
    source_hash=hashlib.sha256(json.dumps(m['engine']['sources'],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    binary=base/'nep-runner'
    if r['version']!='m6.14-v1' or r['platform']!=platform or r['binary']!='nep-runner' or r['sourceRevision']!=m['engine']['revision'] or r['sourceSha256']!=source_hash or r['dependencyLockSha256']!=m['entry']['dependencyLockSha256'] or binary.is_symlink() or hashlib.sha256(binary.read_bytes()).hexdigest()!=r['binarySha256']:
        raise ValueError('NATIVE_ENGINE_IDENTITY_MISMATCH')
    for s in m['engine']['sources']:
        if hashlib.sha256((root/s['path']).read_bytes()).hexdigest()!=s['sha256']:raise ValueError('NATIVE_SOURCE_CHANGED')
    return binary,r

class NativeNEP(Calculator):
    implemented_properties=['energy','forces','stress']
    def __init__(self,weight,root,**kwargs):
        super().__init__(**kwargs);self.weight=weight;self.binary,self.receipt=engine(root)
        if weight.read_text().splitlines()[0].split()!=['nep4','1','Si']:raise ValueError('NEP_ELEMENT_MAPPING_MISMATCH')
    def calculate(self,atoms=None,properties=['energy'],system_changes=all_changes):
        super().calculate(atoms,properties,system_changes);a=self.atoms;n=len(a)
        volume=a.get_volume();sv=np.linalg.svd(a.cell.array,compute_uv=False)
        if n<1 or not a.pbc.all() or set(a.get_chemical_symbols())!={'Si'} or n>256 or sv.min()<4 or sv.max()>200 or volume/n<5 or np.linalg.det(a.cell.array)<=0:raise ValueError('NEP_NATIVE_STRUCTURE_OUTSIDE_POLICY')
        data=str(n)+'\n'+' '.join(format(float(x),'.17g') for x in a.cell.array.flat)+'\n'+' '.join(format(float(x),'.17g') for x in a.positions.flat)+'\n'
        result=subprocess.run([str(self.binary),str(self.weight)],input=data,text=True,capture_output=True,timeout=30,check=False)
        if result.returncode:raise ValueError('NATIVE_ENGINE_FAILED')
        lines=[s[len('MX_NEPCPU_JSON='):] for s in result.stdout.splitlines() if s.startswith('MX_NEPCPU_JSON=')]
        if len(lines)!=1 or len(result.stdout)>1048576:raise ValueError('NATIVE_ENGINE_OUTPUT_INVALID')
        r=json.loads(lines[0]);f=np.asarray(r['forces']);v=np.asarray(r['virialTensorEv']).reshape(3,3)
        if f.shape!=(n,3) or not np.isfinite(f).all() or not np.isfinite(v).all() or not np.isfinite(r['energyEv']):raise ValueError('NATIVE_ENGINE_OUTPUT_INVALID')
        stress=-(v+v.T)/2/volume
        self.results={'energy':r['energyEv'],'forces':f,'stress':stress.flat[[0,4,8,5,2,1]]}
