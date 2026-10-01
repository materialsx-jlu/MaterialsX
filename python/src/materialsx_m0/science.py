from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class AseProbeResult:
    formula: str
    calculator: str
    potential_energy_ev: float
    max_force_ev_per_angstrom: float

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def run_ase_probe() -> AseProbeResult:
    """Run a deterministic local ASE/EMT calculation without an external solver."""
    import numpy as np
    from ase.build import bulk
    from ase.calculators.emt import EMT

    atoms = bulk("Cu", "fcc", a=3.6)
    atoms.calc = EMT()
    energy = float(atoms.get_potential_energy())
    forces = atoms.get_forces()
    max_force = float(np.linalg.norm(forces, axis=1).max())
    if not (-1.0 < energy < 1.0):
        raise ValueError(f"Unexpected Cu EMT energy: {energy}")
    return AseProbeResult(
        formula=atoms.get_chemical_formula(),
        calculator="ASE/EMT",
        potential_energy_ev=energy,
        max_force_ev_per_angstrom=max_force,
    )
