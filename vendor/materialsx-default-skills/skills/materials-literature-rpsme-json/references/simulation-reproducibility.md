# Simulation reproducibility

Use this reference when the work reports DFT, MD, coarse-grained MD, FEM, CFD or another computational study.

## Separation

- `SimulationStudy`: scientific question, modeled objects and assumptions.
- `SimulationRun`: one concrete parameter combination, software version, seed and environment.
- `SimulationParameter`: searchable atomic input or control value.
- `AssetReference`: structure, script, force field, mesh, trajectory, log or output file.
- `SimulationResult`: predicted output only.
- `MechanismHypothesis`: author interpretation or separately marked inference.

One study may contain multiple runs. Do not flatten a sweep into one run or store predicted results as experimental properties.

## Required-field checklist

- DFT: software/version, initial structure, functional, pseudopotential or basis, cutoff, k points, dispersion, spin/charge, convergence and boundary/cell.
- MD/CGMD: software/version, coordinates, topology, force field and source, atom types/charges, box/PBC, timestep, ensemble, thermostat/barostat, cutoffs, electrostatics, ordered stages, seed and output frequency.
- FEM: software/solver, geometry, mesh, element, constitutive law, material properties, contact, boundary/load, increments and convergence.
- CFD: software/solver, geometry, mesh, physical properties, phase/turbulence model, inlet/outlet, discretization, timestep and residual criteria.

Preserve raw conflicts. A conventional default is not a reported fact. Put absent requirements in `missing_reproduction_fields`.

## Deterministic levels

- R0: only the existence of a simulation is known.
- R1: software or principal method is known.
- R2: some key parameters/protocol are extracted, but complete input assets or static validation are missing.
- R3: complete input assets exist and a deterministic static checker has passed.
- R4: the platform actually executed the run in a controlled environment.
- R5: R4 plus key outputs match an explicit tolerance.

Model-authored extraction cannot assert R3–R5. Run `score_simulation_reproducibility.py`; the external Skill recalculates every source-described run to R0–R2. Only the receiving platform may later assign R3–R5 from its own static-validation and execution proof. Never execute supplied scripts during extraction or validation.

## Provenance

Use `author_reported` for source descriptions, `author_supplied` for source repository files, `reconstructed_from_text` for platform-reconstructed inputs and `generated_by_platform`/`platform_executed` only for platform-owned work. Results use `author_reported`, `digitized_from_source`, `platform_reproduced` or `platform_predicted` consistently.
