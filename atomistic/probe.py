"""Real CPU numerical probe against the thresholds frozen before model execution."""
from __future__ import annotations
import contextlib
import hashlib
import json
from pathlib import Path
import platform
import sys
import time
import warnings
import numpy as np
import psutil
from adapters import CORE, load, evaluate
from structures import inspect, to_atoms
from worker import atomic_json, versions

def probe(root: Path, potential_id: str, weight: Path, output: Path):
    policy = json.loads((root / "models/potentials/quality-policy.json").read_text())
    dtype = CORE[potential_id]["dtype"]
    calculator, elements, details = load(potential_id, weight, 4)
    tests=[]
    started=time.monotonic()
    for filename in ["si-diamond.POSCAR", "nacl-rocksalt.cif", "cu-vacancy.POSCAR"]:
        structure=inspect(root / "samples/atomistic" / filename, "probe", "probe-source")
        atoms=to_atoms(structure)
        atoms.positions[0] += [0.073, -0.041, 0.057]  # force must be nonzero; not a trivial equilibrium test
        baseline=evaluate(atoms, calculator, elements)
        forces=np.asarray(baseline["forcesEvPerAngstrom"])
        step=policy["numerical"]["finiteDifferenceStepAngstrom"]
        differences=[]
        for axis in range(3):
            plus=atoms.copy();minus=atoms.copy();plus.positions[0,axis]+=step;minus.positions[0,axis]-=step
            finite_difference=-(evaluate(plus,calculator,elements)["energyEv"]-evaluate(minus,calculator,elements)["energyEv"])/(2*step)
            differences.append(abs(finite_difference-forces[0,axis]))
        translated=atoms.copy();translated.positions += [0.23,0.11,-0.34]
        moved=evaluate(translated,calculator,elements)
        theta=0.37
        rotation=np.array([[np.cos(theta),-np.sin(theta),0],[np.sin(theta),np.cos(theta),0],[0,0,1]])
        rotated=atoms.copy();rotated.positions=atoms.positions@rotation.T;rotated.set_cell(atoms.cell.array@rotation.T)
        turned=evaluate(rotated,calculator,elements)
        strain=0.001
        plus=atoms.copy();minus=atoms.copy()
        plus.set_cell(atoms.cell.array@np.diag([1+strain,1,1]),scale_atoms=True)
        minus.set_cell(atoms.cell.array@np.diag([1-strain,1,1]),scale_atoms=True)
        stress_fd=(evaluate(plus,calculator,elements)["energyEv"]-evaluate(minus,calculator,elements)["energyEv"])/(2*strain*atoms.get_volume())
        stress_error=abs(stress_fd-baseline["stress"]["values"][0])
        metrics={"gradientMaxAbsErrorEvPerAngstrom":max(differences),
          "translationEnergyErrorEvPerAtom":abs(moved["energyEv"]-baseline["energyEv"])/len(atoms),
          "rotationEnergyErrorEvPerAtom":abs(turned["energyEv"]-baseline["energyEv"])/len(atoms),
          "translationForceErrorEvPerAngstrom":float(np.max(np.abs(np.asarray(moved["forcesEvPerAngstrom"])-forces))),
          "rotationForceErrorEvPerAngstrom":float(np.max(np.abs(np.asarray(turned["forcesEvPerAngstrom"])-forces@rotation.T))),
          "stressFiniteDifferenceErrorEvPerAngstromCubed":stress_error,"maxForceEvPerAngstrom":float(np.linalg.norm(forces,axis=1).max())}
        passed=(metrics["maxForceEvPerAngstrom"]>0.001 and metrics["gradientMaxAbsErrorEvPerAngstrom"]<=policy["numerical"]["gradientMaxAbsErrorEvPerAngstrom"][dtype]
          and max(metrics["translationEnergyErrorEvPerAtom"],metrics["rotationEnergyErrorEvPerAtom"])<=policy["numerical"]["translationRotationEnergyToleranceEvPerAtom"][dtype]
          and max(metrics["translationForceErrorEvPerAngstrom"],metrics["rotationForceErrorEvPerAngstrom"])<=policy["numerical"]["forceCovarianceToleranceEvPerAngstrom"][dtype]
          and stress_error<0.001)
        tests.append({"source":filename,"sourceSha256":structure["source"]["sha256"],"atomCount":len(atoms),"metrics":metrics,"passed":bool(passed),"result":baseline})
    receipt={"version":"m6.1-v1","createdAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"platform":platform.system()+"-"+platform.machine(),
       "potentialId":potential_id,"weightSha256":CORE[potential_id]["sha256"],"device":"cpu","dtype":dtype,"versions":versions(),"elements":elements,"adapter":details,
       "policyId":policy["id"],"policySha256":hashlib.sha256((root/"models/potentials/quality-policy.json").read_bytes()).hexdigest(),
       "tests":tests,"numericalPassed":all(t["passed"] for t in tests),"scientificQuality":"needs_review","referenceLabels":0,
       "stressProbeToleranceEvPerAngstromCubed":0.001,"elapsedSeconds":time.monotonic()-started,"rssMiB":psutil.Process().memory_info().rss/1048576}
    output.parent.mkdir(parents=True,exist_ok=True);atomic_json(output,receipt)
    return receipt["numericalPassed"]

if __name__=="__main__":
    with contextlib.redirect_stdout(sys.stderr),warnings.catch_warnings():
        warnings.simplefilter("ignore",category=DeprecationWarning)
        passed=probe(Path(sys.argv[1]),sys.argv[2],Path(sys.argv[3]),Path(sys.argv[4]))
    print(json.dumps({"numericalPassed":passed,"receipt":sys.argv[4]}))
    sys.exit(0 if passed else 1)
