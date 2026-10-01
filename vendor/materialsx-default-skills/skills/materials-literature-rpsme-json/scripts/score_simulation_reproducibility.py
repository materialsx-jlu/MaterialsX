#!/usr/bin/env python3
"""Deterministically score source-described simulations without executing inputs."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

REQUIRED = {
    "density_functional_theory": {
        "software", "software_version", "initial_structure", "functional", "pseudopotential_or_basis",
        "cutoff", "k_points", "dispersion", "spin_or_charge", "convergence", "boundary_or_cell",
    },
    "dft": {
        "software", "software_version", "initial_structure", "functional", "pseudopotential_or_basis",
        "cutoff", "k_points", "dispersion", "spin_or_charge", "convergence", "boundary_or_cell",
    },
    "molecular_dynamics": {
        "software", "software_version", "coordinates", "topology", "force_field", "force_field_source",
        "atom_types_or_charges", "box", "pbc", "time_step", "ensemble", "thermostat_or_barostat",
        "cutoff", "electrostatics", "run_protocol", "random_seed", "output_frequency",
    },
    "coarse_grained_molecular_dynamics": {
        "software", "software_version", "coordinates", "topology", "force_field", "force_field_source",
        "mapping", "box", "pbc", "time_step", "ensemble", "thermostat_or_barostat", "cutoff",
        "electrostatics", "run_protocol", "random_seed", "output_frequency",
    },
    "finite_element": {
        "software", "solver", "geometry", "mesh", "element", "constitutive_law", "material_properties",
        "contact", "boundary_conditions", "load", "increments", "convergence",
    },
    "fem": {
        "software", "solver", "geometry", "mesh", "element", "constitutive_law", "material_properties",
        "contact", "boundary_conditions", "load", "increments", "convergence",
    },
    "computational_fluid_dynamics": {
        "software", "solver", "geometry", "mesh", "physical_properties", "phase_or_turbulence_model",
        "inlet_outlet", "discretization", "time_step", "residual_criteria",
    },
    "cfd": {
        "software", "solver", "geometry", "mesh", "physical_properties", "phase_or_turbulence_model",
        "inlet_outlet", "discretization", "time_step", "residual_criteria",
    },
}

ALIASES = {
    "initial_structure": ("structure", "coordinates", "geometry"),
    "pseudopotential_or_basis": ("pseudopotential", "basis", "basis_set"),
    "cutoff": ("cutoff", "cutoff_energy", "energy_cutoff", "lj_cutoff"),
    "boundary_or_cell": ("boundary", "cell", "lattice", "box"),
    "coordinates": ("coordinate", "structure", "data_file"),
    "topology": ("topology", "bond", "connectivity"),
    "force_field_source": ("force_field_source", "parameter_source"),
    "atom_types_or_charges": ("atom_type", "charge", "partial_charge"),
    "pbc": ("pbc", "periodic"),
    "thermostat_or_barostat": ("thermostat", "barostat", "coupling"),
    "electrostatics": ("electrostatic", "pppm", "ewald"),
    "run_protocol": ("run_protocol", "duration", "steps", "equilibration", "production"),
    "random_seed": ("random_seed", "seed"),
    "output_frequency": ("output_frequency", "dump_frequency", "trajectory_output"),
    "constitutive_law": ("constitutive", "material_model"),
    "boundary_conditions": ("boundary_condition", "constraint"),
    "inlet_outlet": ("inlet", "outlet"),
    "phase_or_turbulence_model": ("phase_model", "turbulence"),
    "residual_criteria": ("residual", "convergence"),
}


def token_set(study: dict[str, Any], run: dict[str, Any], parameters: list[dict[str, Any]]) -> set[str]:
    tokens: set[str] = set()
    for field in ("software", "software_version", "solver", "model_name", "random_seed"):
        if run.get(field) not in (None, "", [], {} ) or study.get(field) not in (None, "", [], {}):
            tokens.add(field)
    for namespace in ("input_parameters", "boundary_conditions"):
        value = study.get(namespace)
        if isinstance(value, dict):
            tokens.update(str(key).casefold() for key, item in value.items() if item not in (None, "", [], {}))
    if study.get("material_models"):
        tokens.update({"material_model", "force_field", "functional"})
    if study.get("run_protocol"):
        tokens.add("run_protocol")
    for row in parameters:
        key = str(row.get("parameter_key") or "").casefold()
        if row.get("value") not in (None, "", [], {}):
            tokens.add(key)
            tokens.add(key.rsplit(".", 1)[-1])
    return tokens


def has_field(field: str, tokens: set[str]) -> bool:
    candidates = (field,) + ALIASES.get(field, ())
    return any(any(candidate in token for token in tokens) for candidate in candidates)


def score_package(package: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    result = copy.deepcopy(package)
    entities = result.get("entities", {})
    studies = {row.get("id"): row for row in entities.get("simulation_studies", []) if isinstance(row, dict)}
    parameters = entities.get("simulation_parameters", [])
    by_run: dict[str, list[dict[str, Any]]] = {}
    for row in parameters:
        if isinstance(row, dict):
            by_run.setdefault(str(row.get("simulation_run_id")), []).append(row)
    references = {
        str(row.get("id")): row for row in entities.get("asset_references", [])
        if isinstance(row, dict) and row.get("id")
    }
    input_refs_by_run: dict[str, list[dict[str, Any]]] = {}
    for relation in result.get("relations", []):
        if not isinstance(relation, dict) or relation.get("type") != "INPUT_OF":
            continue
        ref = references.get(str(relation.get("subject", {}).get("id")))
        run_id = str(relation.get("object", {}).get("id"))
        if ref:
            input_refs_by_run.setdefault(run_id, []).append(ref)
    report: list[dict[str, Any]] = []
    for run in entities.get("simulation_runs", []):
        if not isinstance(run, dict):
            continue
        study = studies.get(run.get("simulation_study_id"), {})
        kind = str(study.get("simulation_type") or "").casefold()
        required = REQUIRED.get(kind, {"software", "software_version", "run_protocol"})
        tokens = token_set(study, run, by_run.get(str(run.get("id")), []))
        present = sorted(field for field in required if has_field(field, tokens))
        missing = sorted(required - set(present))
        coverage = len(present) / len(required) if required else 0.0
        software_known = has_field("software", tokens) or has_field("solver", tokens)
        protocol_known = has_field("run_protocol", tokens)
        if software_known and (coverage > 0.15 or protocol_known):
            level = "R2"
        elif software_known or kind:
            level = "R1"
        else:
            level = "R0"
        # Extraction never promotes to R3-R5. Those require receiver-owned
        # static validation/execution proof that cannot originate in a paper.
        input_refs = input_refs_by_run.get(str(run.get("id")), [])
        available_inputs = [row for row in input_refs if row.get("availability_status") in {"bundled", "external"}]
        input_availability = "none"
        if available_inputs:
            roles = {str(row.get("asset_role")) for row in available_inputs}
            input_availability = "complete" if {"input_script", "structure_input"} <= roles else "partial"
        assessment = {
            "level": level,
            "source_parameter_coverage": round(coverage, 4),
            "protocol_completeness": 1.0 if protocol_known else 0.0,
            "input_artifact_availability": input_availability,
            "missing_reproduction_fields": missing,
            "rerun_status": "not_requested",
            "result_match_tolerance": None,
            "result_match_status": "not_evaluated",
            "scored_by": "materials-literature-rpsme-json/score_simulation_reproducibility.py",
        }
        run["reproducibility_assessment"] = copy.deepcopy(assessment)
        run["run_status"] = "input_partial" if level == "R2" else "described"
        study["reproducibility_assessment"] = copy.deepcopy(assessment)
        report.append({"run_id": run.get("id"), "simulation_type": kind, **assessment})
    return result, report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.package.resolve() == args.output.resolve():
        parser.error("--output must not overwrite the input package")
    package = json.loads(args.package.read_text(encoding="utf-8"))
    scored, runs = score_package(package)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(scored, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    report = {"valid": True, "run_count": len(runs), "runs": runs, "output": str(args.output)}
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
