"""Bounded FIRE optimization. No arbitrary optimizer, calculator, scripts or paths."""
from __future__ import annotations
import copy
import hashlib
import io
import json
import os
import time
import numpy as np
from ase import Atoms
from ase.io import write
from ase.filters import FrechetCellFilter
from ase.optimize import FIRE
from adapters import GPA_TO_EV_A3, evaluate


def validate_options(options, task):
    expected = {k: v for k, v in options.items() if k != "cellConstraint"}
    if task != {"kind": "relaxation", **expected}:
        raise ValueError("RELAXATION_PLAN_MISMATCH")
    if options["cellMode"] == "fixed":
        if options["cellConstraint"] != "none" or options["externalPressureGPa"] is not None:
            raise ValueError("FIXED_CELL_PRESSURE_OR_CONSTRAINT")
    elif options["cellConstraint"] not in ("hydrostatic", "full") or options["externalPressureGPa"] is None:
        raise ValueError("VARIABLE_CELL_REQUIRES_EXPLICIT_PRESSURE")


def geometry_guard(atoms, initial_cell):
    cell = np.asarray(atoms.cell, dtype=float)
    if not np.isfinite(atoms.positions).all() or not np.isfinite(cell).all():
        raise ValueError("NONFINITE_OPTIMIZATION_GEOMETRY")
    volume = float(np.linalg.det(cell))
    initial_volume = float(np.linalg.det(initial_cell))
    if atoms.pbc.any() and (volume <= 0 or not .5 <= volume / initial_volume <= 2):
        raise ValueError("RELAXATION_VOLUME_LIMIT")
    singular = np.linalg.svd(np.linalg.solve(initial_cell, cell), compute_uv=False) if atoms.pbc.any() else np.ones(3)
    if singular.min() < .7 or singular.max() > 1.4:
        raise ValueError("RELAXATION_STRAIN_LIMIT")
    minimum = 1e6
    for i in range(len(atoms)-1):
        distances = atoms.get_distances(i, range(i+1, len(atoms)), mic=bool(atoms.pbc.any()))
        if not np.isfinite(distances).all():
            raise ValueError("NONFINITE_DISTANCE")
        minimum = min(minimum, float(distances.min()))
    if minimum < .4:
        raise ValueError("RELAXATION_ATOMIC_OVERLAP")
    return minimum


def extxyz_bytes(atoms, original=None):
    # Only geometry: calculator outputs, inferred properties and constraints are excluded.
    geometry = Atoms(atoms.get_chemical_symbols(), positions=atoms.positions.copy(), cell=atoms.cell.copy(), pbc=atoms.pbc.copy())
    if original and not atoms.pbc.any():
        geometry.info.update(charge=original["charge"], spinMultiplicity=original["spinMultiplicity"])
    text = io.StringIO()
    write(text, geometry, format="extxyz", write_results=False)
    return text.getvalue().encode("utf-8")


def save_geometry(directory, stem, atoms, original, run_id, atomic_json, check):
    raw = extxyz_bytes(atoms, original)
    temp = directory / f"{stem}.extxyz.tmp"
    temp.write_bytes(raw)
    os.replace(temp, directory / f"{stem}.extxyz")
    structure = copy.deepcopy(original)
    structure["id"] = f"{run_id}:{stem}"
    structure["cell"] = atoms.cell.array.tolist()
    for site, position in zip(structure["atoms"], atoms.positions, strict=True):
        site["position"] = position.tolist()
    structure["source"] = {**original["source"], "artifactId": structure["id"], "format": "extxyz",
        "sha256": hashlib.sha256(raw).hexdigest(), "transformations": [*original["source"]["transformations"],
        f"FIRE geometry from {original['id']} SHA256 {original['source']['sha256']}", f"plan {run_id}; atom IDs and order retained"]}
    check("AtomicStructure", structure)
    return structure


def run_relaxation(atoms, calculator, elements, original, plan, options, directory, run_id, atomic_json, emit, check, check63):
    check63("RelaxationOptions", options)
    validate_options(options, plan["task"])
    if options["maxSteps"] > plan["budget"]["maxSteps"]:
        raise ValueError("STEP_BUDGET_EXCEEDED")
    initial_cell = atoms.cell.array.copy()
    pressure = (options["externalPressureGPa"] or 0) * GPA_TO_EV_A3
    atoms.calc = calculator
    target = atoms if options["cellMode"] == "fixed" else FrechetCellFilter(atoms,
        hydrostatic_strain=options["cellConstraint"] == "hydrostatic", scalar_pressure=pressure, exp_cell_factor=len(atoms))
    optimizer = FIRE(target, logfile=None, dt=.1, dtmax=.5, maxstep=.1)
    started = time.monotonic()
    rows = []
    last_event = -1e6
    with (directory / "observables.csv").open("w", encoding="utf-8") as csv:
        csv.write("step,energy_eV,objective_eV,max_atomic_force_eV_per_A,max_filter_force_eV_per_A,volume_A3,min_distance_A,elapsed_s\n")
        for step in range(options["maxSteps"] + 1):
            minimum = geometry_guard(atoms, initial_cell)
            values = evaluate(atoms, calculator, elements)  # real initial single point precedes all steps
            filtered = np.asarray(target.get_forces(), dtype=float)
            if filtered.shape != (len(atoms) + (3 if options["cellMode"] == "variable" else 0), 3) or not np.isfinite(filtered).all():
                raise ValueError("INVALID_FILTER_FORCES")
            row = {"step": step, "energyEv": values["energyEv"], "objectiveEv": float(values["energyEv"] + pressure * atoms.get_volume()),
                "maxForceEvPerAngstrom": float(np.linalg.norm(values["forcesEvPerAngstrom"], axis=1).max()),
                "maxFilterForceEvPerAngstrom": float(np.linalg.norm(filtered, axis=1).max()), "volumeAngstrom3": float(atoms.get_volume()),
                "minimumDistanceAngstrom": minimum, "elapsedSeconds": time.monotonic() - started}
            check63("RelaxationStep", row)
            checkpoint = save_geometry(directory, "last-valid", atoms, original, run_id, atomic_json, check)
            atomic_json(directory / "last-valid.json", {"version": "m6.3-v1", "runId": run_id, "planId": plan["id"], "structure": checkpoint, "step": row})
            rows.append(row)
            csv.write(",".join(str(row[k]) for k in row) + "\n")
            csv.flush()
            if time.monotonic() - last_event >= 1:
                emit("relaxation_step", step=row)
                last_event = time.monotonic()
            converged = max(row["maxForceEvPerAngstrom"], row["maxFilterForceEvPerAngstrom"]) < options["fmaxEvPerAngstrom"]
            if converged or step == options["maxSteps"]:
                break
            optimizer.step(filtered)
            optimizer.nsteps = step + 1
    final = save_geometry(directory, "final", atoms, original, run_id, atomic_json, check)
    atomic_json(directory / "final.json", final)
    final_hash = hashlib.sha256((directory / "final.json").read_bytes()).hexdigest()
    summary = {"version": "m6.3-v1", "runId": run_id, "planId": plan["id"], "structureId": original["id"],
        "finalStructureId": final["id"], "finalStructureSha256": final_hash, "options": options,
        "stopReason": "converged" if converged else "max_steps", "completedSteps": row["step"], "initial": rows[0], "final": row,
        "displacementDefinition": "final-minus-initial-cartesian-no-MIC-includes-cell-strain",
        "displacementsAngstrom": (atoms.positions - np.array([a["position"] for a in original["atoms"]])).tolist(), "quality": "needs_review"}
    check63("RelaxationSummary", summary)
    atomic_json(directory / "relaxation.json", summary)
    atomic_json(directory / "steps.json", rows)
    emit("relaxation_step", step=row)
    return values, summary
