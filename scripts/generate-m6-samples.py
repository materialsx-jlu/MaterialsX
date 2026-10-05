"""Generate small team-authored geometry fixtures. No model or DFT calculations."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'samples' / 'atomistic'
OUT.mkdir(parents=True, exist_ok=True)
VERSION = 'm6.0-v1'
rows = []

def write_case(case_id, fmt, domain, cell, pbc, species, positions, charge=None, spin=None):
    filename = f'{case_id}.{fmt}' if fmt != 'poscar' else f'{case_id}.POSCAR'
    path = OUT / filename
    if fmt == 'poscar':
        ordered = list(dict.fromkeys(species))
        lines = [case_id, '1.0', *[' '.join(map(str, r)) for r in cell], ' '.join(ordered),
                 ' '.join(str(species.count(s)) for s in ordered), 'Cartesian']
        lines += [' '.join(map(str, pos)) for s in ordered for sym, pos in zip(species, positions) if sym == s]
    elif fmt in ['xyz', 'extxyz']:
        comment = 'Team-authored synthetic geometry; not DFT reference'
        if fmt == 'extxyz':
            lattice = ' '.join(str(v) for r in cell for v in r)
            flags = ' '.join('T' if v else 'F' for v in pbc)
            comment = f'Lattice="{lattice}" Properties=species:S:1:pos:R:3 pbc="{flags}"'
        lines = [str(len(species)), comment, *[s+' '+' '.join(map(str,p)) for s,p in zip(species,positions)]]
    else:
        # This fixture is cubic and P1; positions are converted explicitly to fractions.
        a = cell[0][0]
        lines = [f'data_{case_id}', '_cell_length_a '+str(a), '_cell_length_b '+str(a), '_cell_length_c '+str(a),
                 '_cell_angle_alpha 90', '_cell_angle_beta 90', '_cell_angle_gamma 90',
                 "_symmetry_space_group_name_H-M 'P 1'", 'loop_', '_atom_site_label', '_atom_site_type_symbol',
                 '_atom_site_fract_x', '_atom_site_fract_y', '_atom_site_fract_z', '_atom_site_occupancy']
        lines += [s+str(i+1)+' '+s+' '+' '.join(str(v/a) for v in p)+' 1' for i,(s,p) in enumerate(zip(species,positions))]
    path.write_text('\n'.join(lines)+'\n', encoding='utf-8', newline='\n')
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    normalized = {'schemaVersion':VERSION,'id':case_id,'coordinateUnit':'angstrom',
        'atoms':[{'id':f'a{i+1}','element':s,'position':p,'occupancy':1} for i,(s,p) in enumerate(zip(species,positions))],
        'cell':cell,'pbc':pbc,'charge':charge,'spinMultiplicity':spin,
        'source':{'artifactId':'sample-'+case_id,'sha256':digest,'format':fmt,'provenance':'team-synthetic',
                  'license':'AGPL-3.0-only','transformations':[]},'issues':[]}
    normal = OUT / (case_id+'.structure.json')
    normal.write_text(json.dumps(normalized,ensure_ascii=False,indent=2)+'\n', encoding='utf-8', newline='\n')
    rows.append({'id':case_id,'file':filename,'sha256':digest,'normalizedFile':normal.name,
        'normalizedSha256':hashlib.sha256(normal.read_bytes()).hexdigest(),'expected':'parse-valid',
        'domain':domain,'atomCount':len(species),'reference':None,'trainingOverlap':'unknown','scientificValidationEligible':False})

cube = lambda a:[[a,0,0],[0,a,0],[0,0,a]]
fcc = [[0,0,0],[0,.5,.5],[.5,0,.5],[.5,.5,0]]
diamond = fcc+[[x+.25,y+.25,z+.25] for x,y,z in fcc]
write_case('si-diamond','poscar','bulk',cube(5.43),[True]*3,['Si']*8,[[v*5.43 for v in p] for p in diamond])
write_case('nacl-rocksalt','cif','multi-element',cube(5.64),[True]*3,['Na']*4+['Cl']*4,
    [[v*5.64 for v in p] for p in fcc]+[[((v+.5)%1)*5.64 for v in p] for p in fcc])
write_case('si-triclinic','extxyz','nonorthogonal',[[4,0,0],[1,4,0],[.5,.75,4]],[True]*3,['Si','Si'],[[0,0,0],[2.75,2.375,2]])
write_case('cu-vacancy','poscar','defect',cube(3.61),[True]*3,['Cu']*3,[[v*3.61 for v in p] for p in fcc[:3]])
write_case('cu-slab','extxyz','surface',[[3.61,0,0],[0,3.61,0],[0,0,15]],[True,True,False],['Cu']*4,[[0,0,6],[0,1.805,7.805],[1.805,0,7.805],[1.805,1.805,6]])
write_case('water','xyz','molecule',None,[False]*3,['O','H','H'],[[0,0,0],[.9572,0,0],[-.23999,.92663,0]],0,1)
write_case('methane','xyz','organic',None,[False]*3,['C','H','H','H','H'],[[0,0,0],[.629,.629,.629],[.629,-.629,-.629],[-.629,.629,-.629],[-.629,-.629,.629]],0,1)
invalid = {
    'nonfinite.xyz':('2\nNonfinite\nH 0 0 0\nH NaN 0 0\n','NONFINITE_COORDINATE'),
    'overlap.xyz':('2\nCoincident atoms\nH 0 0 0\nH 0 0 0\n','ATOM_OVERLAP'),
    'unknown-element.xyz':('1\nInvalid element\nXx 0 0 0\n','UNKNOWN_ELEMENT'),
    'singular-cell.POSCAR':('Singular cell\n1.0\n1 0 0\n2 0 0\n0 0 1\nSi\n1\nCartesian\n0 0 0\n','SINGULAR_PERIODIC_CELL'),
    'missing-pbc.structure.json':(json.dumps({'schemaVersion':VERSION,'pbc':None})+'\n','MISSING_PERIODICITY'),
}
# Fractional occupancies remain readable for preview but MUST block calculation.
partial = (OUT/'nacl-rocksalt.cif').read_text().replace('Na1 Na 0.0 0.0 0.0 1','Na1 Na 0.0 0.0 0.0 0.5')
invalid['partial-occupancy.cif']=(partial,'PARTIAL_OCCUPANCY')
for filename,(contents,code) in invalid.items():
    path=OUT/filename;path.write_text(contents, encoding='utf-8', newline='\n')
    rows.append({'id':filename.split('.')[0],'file':filename,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
        'normalizedFile':None,'normalizedSha256':None,'expected':'block-calculation','expectedIssue':code,'domain':'invalid',
        'atomCount':None,'reference':None,'trainingOverlap':'unknown','scientificValidationEligible':False})
(OUT/'manifest.json').write_text(json.dumps({'schemaVersion':VERSION,'sampleSetId':'m6-geometry-v1','copyright':'© 2026 吉林大学 AI-DAOS 团队',
    'license':'AGPL-3.0-only','provenance':'Team-authored mathematical fixtures; no paper assets, model outputs, or DFT labels.',
    'purpose':'Parsing, contract, rejection and runner interface tests; not a scientific held-out benchmark.','samples':rows},ensure_ascii=False,indent=2)+'\n', encoding='utf-8', newline='\n')
print(f'Generated {len(rows)} fixtures; 0 scientific reference labels')
