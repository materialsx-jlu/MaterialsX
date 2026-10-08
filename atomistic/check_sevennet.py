"""Engineering derivative/order checks, not a comparison to independent DFT labels."""
import json
import socket
import sys
from pathlib import Path

def deny(*args, **kwargs):
    raise RuntimeError("ATOMISTIC_NETWORK_DISABLED")

socket.socket.connect = deny
socket.create_connection = deny
socket.getaddrinfo = deny
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
from ase.io import read
from ase.stress import voigt_6_to_full_3x3_stress
from adapters import load, evaluate

root, weight, output = map(Path, sys.argv[1:4])
calculator, elements, details = load("sevennet-0-11jul2024", weight, 4, root)
atoms = read(root / "samples/atomistic/si-diamond.POSCAR", format="vasp")
atoms.positions[0] += [.15, -.06, .04]
result = evaluate(atoms, calculator, elements)
epsilon = .002
force_checks = []
for axis in range(3):
    energies = []
    for sign in [1, -1]:
        displaced = atoms.copy()
        displaced.positions[0, axis] += sign * epsilon
        energies.append(evaluate(displaced, calculator, elements)["energyEv"])
    fd = -(energies[0] - energies[1]) / (2 * epsilon)
    actual = result["forcesEvPerAngstrom"][0][axis]
    force_checks.append({"axis": axis, "actual": actual, "finiteDifference": fd, "error": abs(actual - fd)})
stress_checks = []
for k, (i, j) in enumerate([(0, 0), (1, 1), (2, 2), (1, 2), (0, 2), (0, 1)]):
    strain = np.zeros((3, 3))
    if i == j:
        strain[i, j] = 1
    else:
        strain[i, j] = strain[j, i] = .5
    energies = []
    for sign in [1, -1]:
        deformed = atoms.copy()
        deformed.set_cell(atoms.cell.array @ (np.eye(3) + sign * epsilon * strain), scale_atoms=True)
        energies.append(evaluate(deformed, calculator, elements)["energyEv"])
    fd = (energies[0] - energies[1]) / (2 * epsilon * atoms.get_volume())
    actual = result["stress"]["values"][k]
    stress_checks.append({"voigt": ["xx", "yy", "zz", "yz", "xz", "xy"][k], "actual": actual, "finiteDifference": fd, "error": abs(actual - fd)})
rotation = np.array([[0., -1., 0.], [1., 0., 0.], [0., 0., 1.]])
rotated = atoms.copy()
rotated.set_cell(atoms.cell.array @ rotation.T, scale_atoms=False)
rotated.positions = atoms.positions @ rotation.T
rr = evaluate(rotated, calculator, elements)
permuted = atoms[np.arange(len(atoms))[::-1]]
pr = evaluate(permuted, calculator, elements)
checks = {
    "forceDerivativeMaxErrorEvPerAngstrom": max(c["error"] for c in force_checks),
    "stressDerivativeMaxErrorEvPerAngstrom3": max(c["error"] for c in stress_checks),
    "rotationEnergyErrorEv": abs(rr["energyEv"] - result["energyEv"]),
    "rotationForceMaxErrorEvPerAngstrom": float(np.max(np.abs(np.array(rr["forcesEvPerAngstrom"]) - np.array(result["forcesEvPerAngstrom"]) @ rotation.T))),
    "rotationStressMaxErrorEvPerAngstrom3": float(np.max(np.abs(voigt_6_to_full_3x3_stress(rr["stress"]["values"]) - rotation @ voigt_6_to_full_3x3_stress(result["stress"]["values"]) @ rotation.T))),
    "permutationForceMaxErrorEvPerAngstrom": float(np.max(np.abs(np.array(pr["forcesEvPerAngstrom"])[::-1] - result["forcesEvPerAngstrom"]))),
}
passed = checks["forceDerivativeMaxErrorEvPerAngstrom"] < .01 and checks["stressDerivativeMaxErrorEvPerAngstrom3"] < .0001 and checks["rotationEnergyErrorEv"] < .001 and checks["rotationForceMaxErrorEvPerAngstrom"] < .001 and checks["rotationStressMaxErrorEvPerAngstrom3"] < .0001 and checks["permutationForceMaxErrorEvPerAngstrom"] < .001
document = {"stage": "M6.10", "passed": passed, "platform": sys.platform, "device": "cpu", "epsilon": epsilon, "elements": elements, "adapter": details, "forceChecks": force_checks, "stressChecks": stress_checks, "checks": checks, "quality": "needs_review", "scope": "Adapter consistency on distorted synthetic Si; not independent scientific accuracy."}
output.write_text(json.dumps(document, indent=2, allow_nan=False) + "\n")
print(json.dumps({"passed": passed, "checks": checks}))
if not passed:
    raise SystemExit(1)
