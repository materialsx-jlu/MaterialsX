from materialsx_m0.science import run_ase_probe


def test_ase_emt_probe_is_finite_and_tagged() -> None:
    result = run_ase_probe()
    assert result.formula == "Cu"
    assert result.calculator == "ASE/EMT"
    assert -1.0 < result.potential_energy_ev < 1.0
    assert result.max_force_ev_per_angstrom < 1e-8
