"""Fixed, audited additive baseline + D3(BJ) two-body calculator; never arbitrary sums."""
import hashlib,json,subprocess,sys,platform
from pathlib import Path
import numpy as np
from ase.calculators.calculator import Calculator, all_changes
from ase.geometry import get_distances
ID='mace-mp-0b3-medium-d3-bj-pbe-si'

def manifest(root):
    m=json.loads((root/'models/potentials/physics-m615.json').read_text())
    data=(root/'models/potentials/composition-profile-m615.json').read_bytes()
    if m['version']!='m6.15-v1' or m['profile']['id']!=ID or hashlib.sha256(data).hexdigest()!=m['profileSha256'] or json.loads(data)!=m['profile']:raise ValueError('COMPOSITION_IDENTITY_MISMATCH')
    for s in m['engine']['sources']:
        if hashlib.sha256((root/s['path']).read_bytes()).hexdigest()!=s['sha256']:raise ValueError('COMPOSITION_SOURCE_CHANGED')
    return m

def engine(root):
    m=manifest(root);name='macos-arm64' if sys.platform=='darwin' and platform.machine()=='arm64' else 'unsupported'
    base=root/'native-engines/d3-bj'
    if not base.exists():base=root/'runtime/native-engines'/name/'d3-bj'
    r=json.loads((base/'RUNTIME.json').read_text());binary=base/'d3-runner'
    source_sha=hashlib.sha256(json.dumps(m['engine']['sources'],separators=(',',':')).encode()).hexdigest()
    if r['version']!='m6.15-v1' or r['platform']!=name or r['binary']!='d3-runner' or r['sourceRevision']!=m['engine']['revision'] or r['sourceSha256']!=source_sha or r['profileSha256']!=m['profileSha256'] or r['dependencyLockSha256']!=m['entry']['dependencyLockSha256'] or binary.is_symlink() or hashlib.sha256(binary.read_bytes()).hexdigest()!=r['binarySha256']:raise ValueError('COMPOSITION_ENGINE_IDENTITY_MISMATCH')
    return binary,r,m

def validate_atoms(a):
    n=len(a);sv=np.linalg.svd(a.cell.array,compute_uv=False)
    if n<1 or n>128 or set(a.get_chemical_symbols())!={'Si'} or not a.pbc.all() or sv.min()<4 or sv.max()>200 or np.linalg.det(a.cell.array)<=0 or a.get_volume()/n<5:raise ValueError('COMPOSITION_STRUCTURE_OUTSIDE_POLICY')
    if n>1:
        _,distance=get_distances(a.positions,cell=a.cell,pbc=a.pbc);np.fill_diagonal(distance,np.inf)
        if distance.min()<2.3:raise ValueError('COMPOSITION_MINIMUM_DISTANCE')

def values(atoms,calculator):
    a=atoms.copy();a.calc=calculator
    return {'energyEv':float(a.get_potential_energy()),'forcesEvPerAngstrom':a.get_forces(apply_constraint=False).tolist(),'stress':a.get_stress(voigt=True,apply_constraint=False).tolist()}

class D3Correction(Calculator):
    implemented_properties=['energy','forces','stress']
    def __init__(self,root):super().__init__();self.binary,self.receipt,self.manifest=engine(root)
    def calculate(self,atoms=None,properties=['energy'],system_changes=all_changes):
        super().calculate(atoms,properties,system_changes);a=self.atoms;validate_atoms(a);n=len(a)
        data=str(n)+'\n'+' '.join(format(float(x),'.17g') for x in a.cell.array.flat)+'\n'+' '.join(format(float(x),'.17g') for x in a.positions.flat)+'\n'
        r=subprocess.run([str(self.binary)],input=data,text=True,capture_output=True,timeout=30,check=False)
        lines=[s[len('MX_D3_JSON='):] for s in r.stdout.splitlines() if s.startswith('MX_D3_JSON=')]
        if r.returncode or len(lines)!=1 or len(r.stdout)>1048576:raise ValueError('D3_ENGINE_OUTPUT_INVALID')
        q=json.loads(lines[0]);force=np.asarray(q['forces']);virial=np.asarray(q['virialTensorEv']).reshape(3,3);stress=-(virial+virial.T)/(2*a.get_volume())
        if force.shape!=(n,3) or not np.isfinite(force).all() or not np.isfinite(stress).all() or not np.isfinite(q['energyEv']):raise ValueError('D3_ENGINE_OUTPUT_INVALID')
        self.results={'energy':q['energyEv'],'forces':force,'stress':stress.flat[[0,4,8,5,2,1]]}

class ComposedCalculator(Calculator):
    implemented_properties=['energy','forces','stress']
    def __init__(self,baseline,root):
        super().__init__();self.baseline=baseline;self.correction=D3Correction(root);self.components=None
        # Baseline must be the raw MACE calculator, not a previously corrected composite.
        if baseline.__class__.__name__!='MACECalculator':raise ValueError('BASELINE_ALREADY_COMPOSED_OR_UNKNOWN')
    def calculate(self,atoms=None,properties=['energy'],system_changes=all_changes):
        super().calculate(atoms,properties,system_changes);validate_atoms(self.atoms)
        b=values(self.atoms,self.baseline);d=values(self.atoms,self.correction)
        self.results={'energy':b['energyEv']+d['energyEv'],'forces':np.asarray(b['forcesEvPerAngstrom'])+np.asarray(d['forcesEvPerAngstrom']),'stress':np.asarray(b['stress'])+np.asarray(d['stress'])}
        self.components={'version':'m6.15-v1','profileSha256':self.correction.manifest['profileSha256'],'baseline':b,'correction':d,'total':{'energyEv':self.results['energy'],'forcesEvPerAngstrom':self.results['forces'].tolist(),'stress':self.results['stress'].tolist()},'units':{'energy':'eV','forces':'eV/angstrom','stress':'eV/angstrom^3'},'stressOrder':'xx,yy,zz,yz,xz,xy','stressSign':'positive-tension','quality':'needs_review'}
