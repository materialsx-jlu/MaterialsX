"""Only the reviewed, immutable core/extension checkpoints can be deserialized."""
from __future__ import annotations
import hashlib
from pathlib import Path
import numpy as np

GPA_TO_EV_A3 = 0.006241509074460762  # exact SI elementary charge
CORE = {
    "mace-mp-0b3-medium": {"family": "mace", "sha256": "2f2be696351ac9e94fbe01cdfb6f017679acdbd2db7645209ef55fec9826b012", "bytes": 79472952, "dtype": "float64"},
    "chgnet-r2scan": {"family": "chgnet", "sha256": "8eba3db0f35a2788bb3ae22885ad340591e27996f213c6643af522a633b50dad", "bytes": 4872387, "dtype": "float32"},
    "chgnet-0.3.0": {"family": "chgnet", "sha256": "d14ab7c0f093efe64b60a7bcd540bca10e74fb7f46c86108a079af60524659d1", "bytes": 4863221, "dtype": "float32"},
}

def approved_specs(root: Path):
    import json, re
    specs = dict(CORE)
    manifest = json.loads((root / "models/potentials/packages-m68.json").read_text())
    if manifest["version"] != "m6.8-v1":
        raise ValueError("PACKAGE_MANIFEST_VERSION")
    entries = list(manifest["entries"])
    expansion = root / "models/potentials/adapters-m610.json"
    if expansion.exists():
        extra = json.loads(expansion.read_text())
        if extra["version"] != "m6.10-v1":
            raise ValueError("ADAPTER_MANIFEST_VERSION")
        for e in extra["entries"]:
            if e["family"] != "sevennet" or e["adapter"] != "sevennet-ase" or e["potentialId"] != "sevennet-0-11jul2024" or e["dtype"] != "float32":
                raise ValueError("PACKAGE_ADAPTER_NOT_APPROVED")
            entries.append(e)
    molecular = root / "models/potentials/molecules-m613.json"
    if molecular.exists():
        m = json.loads(molecular.read_text())
        if m["version"] != "m6.13-v1" or m["entry"]["potentialId"] != "ani-2x-ensemble" or m["entry"]["family"] != "ani" or m["entry"]["adapter"] != "torchani-ase":
            raise ValueError("PACKAGE_ADAPTER_NOT_APPROVED")
        entries.append(m["entry"])
    native = root / 'models/potentials/native-m614.json'
    if native.exists():
        m=json.loads(native.read_text())
        if m['version']!='m6.14-v1' or m['entry']['potentialId']!='nep-si-2022-nep4-3body': raise ValueError('PACKAGE_ADAPTER_NOT_APPROVED')
        entries.append(m['entry'])
    physics=root/'models/potentials/physics-m615.json'
    if physics.exists():
        from composed import manifest
        entries.append(manifest(root)['entry'])
    for e in entries:
        if e["family"] not in ("mace", "chgnet", "sevennet", "ani", "nep") or not re.fullmatch(r"[a-z][a-z0-9.-]{0,95}", e["potentialId"]):
            raise ValueError("PACKAGE_ADAPTER_NOT_APPROVED")
        if hashlib.sha256((root / "atomistic/environments" / ("chgnet" if e["family"]=="nep" else e["family"]) / "uv.lock").read_bytes()).hexdigest() != e["dependencyLockSha256"]:
            raise ValueError("PACKAGE_ENVIRONMENT_MISMATCH")
        for n in e["notices"]:
            if not re.fullmatch(r"docs/m6/licenses/[a-zA-Z0-9.-]+", n["path"]) or hashlib.sha256((root / n["path"]).read_bytes()).hexdigest() != n["sha256"]:
                raise ValueError("PACKAGE_NOTICE_MISMATCH")
        spec = {k: e[k] for k in ("family", "sha256", "bytes", "dtype")}
        if e["potentialId"] in CORE and spec != CORE[e["potentialId"]]:
            raise ValueError("CORE_IDENTITY_CHANGED")
        specs[e["potentialId"]] = spec
    return specs


def load(potential_id: str, weight: Path, threads: int, root: Path | None = None):
    spec = (approved_specs(root) if root else CORE)[potential_id]
    if weight.stat().st_size != spec["bytes"] or hashlib.file_digest(weight.open("rb"), "sha256").hexdigest() != spec["sha256"]:
        raise ValueError("WEIGHT_IDENTITY_MISMATCH")
    if spec['family']=='nep':
        from native_nep import NativeNEP
        calc=NativeNEP(weight,root)
        return calc,['Si'],{'nativeEnergy':'eV-total','nativeStress':'eV atomic virial tensor','stressFactor':-1.0,'graphConverter':'nep-cpu-native','elementTypeMap':{'Si':0},'engine':calc.receipt,'longRange':'absent','dispersion':'not-added','aseStress':'positive-tension-xx,yy,zz,yz,xz,xy'}
    import torch
    torch.set_num_threads(threads)
    torch.set_num_interop_threads(1)
    if spec["family"] == "ani":
        import torchani
        from torchani.arch import Assembler
        # Explicit assembly matches pinned upstream ANI2x(); no HF/cache/network lookup or pickle objects.
        asm = Assembler(periodic_table_index=True)
        from torchani.utils import SYMBOLS_2X
        asm.set_symbols(SYMBOLS_2X)
        asm.set_global_cutoff_fn("cosine")
        asm.set_aev_computer(radial="ani2x", angular="ani2x", strategy="pyaev")
        asm.set_atomic_networks(ctor="ani2x")
        asm.set_neighborlist("all_pairs")
        asm.set_gsaes_as_self_energies("wb97x-631gd")
        model = asm.assemble(8)
        model.load_state_dict(torch.load(str(weight), map_location="cpu", weights_only=True), strict=True)
        model.requires_grad_(False).to(device="cpu", dtype=torch.float64)
        elements = list(model.symbols)
        if elements != ["H", "C", "N", "O", "S", "F", "Cl"] or len(model) != 8:
            raise ValueError("CHECKPOINT_ELEMENT_OR_ENSEMBLE_MISMATCH")
        calculator = model.ase()
        details = {"nativeEnergy": "Hartree", "aseEnergy": "eV-total", "nativeStress": "not-applicable", "graphConverter": "torchani-pyaev",
                   "ensembleMembers": 8, "reduction": "mean", "charge": 0, "spinMultiplicity": 1, "boundary": "isolated",
                   "longRange": "absent", "dispersion": "not-added", "stress": "not-applicable"}
    elif spec["family"] == "mace":
        from mace.calculators import MACECalculator
        calculator = MACECalculator(model_paths=str(weight), device="cpu", default_dtype="float64")
        from ase.data import chemical_symbols
        elements = [chemical_symbols[int(z)] for z in calculator.models[0].atomic_numbers]
        details = {"nativeEnergy": "eV-total", "nativeStress": "eV/angstrom^3", "stressFactor": 1.0, "graphConverter": "mace"}
    elif spec["family"] == "sevennet":
        from sevenn.calculator import SevenNetCalculator
        from ase.data import chemical_symbols
        calculator = SevenNetCalculator(model=str(weight), file_type="checkpoint", device="cpu", enable_cueq=False, enable_oeq=False)
        elements = [chemical_symbols[int(z)] for z in sorted(calculator.type_map)]
        if next(calculator.model.parameters()).dtype != torch.float32:
            raise ValueError("CHECKPOINT_DTYPE_MISMATCH")
        # Official ASE adapter negates pressure-like native stress and reorders xy,yz,xz -> yz,xz,xy.
        details = {"nativeEnergy": "eV-total", "nativeStress": "eV/angstrom^3-positive-compression",
                   "stressFactor": -1.0, "graphConverter": "sevennet-ase", "aseStress": "positive-tension-xx,yy,zz,yz,xz,xy",
                   "backend": "torch-e3nn-cpu", "dispersionCorrection": False, "modal": None}
    else:
        from chgnet.model.model import CHGNet
        from chgnet.model.dynamics import CHGNetCalculator
        from chgnet.graph.converter import CrystalGraphConverter
        from ase.data import chemical_symbols
        model = CHGNet.from_file(str(weight))
        # Pure Python converter avoids a required platform-specific native extension.
        model.graph_converter = CrystalGraphConverter(atom_graph_cutoff=model.graph_converter.atom_graph_cutoff,
            bond_graph_cutoff=model.graph_converter.bond_graph_cutoff, algorithm="legacy", on_isolated_atoms="error")
        calculator = CHGNetCalculator(model=model, use_device="cpu", stress_weight=GPA_TO_EV_A3, on_isolated_atoms="error")
        elements = chemical_symbols[1:95]  # actual embedding has 94 rows; assert before advertising coverage
        if model.atom_embedding.embedding.num_embeddings != 94:
            raise ValueError("ELEMENT_EMBEDDING_CHANGED")
        details = {"nativeEnergy": "eV/atom" if model.is_intensive else "eV-total", "nativeStress": "GPa",
                   "stressFactor": GPA_TO_EV_A3, "graphConverter": "legacy-python"}
    if potential_id=='mace-mp-0b3-medium-d3-bj-pbe-si':
        from composed import ComposedCalculator
        calculator=ComposedCalculator(calculator,root);elements=['Si'];m=calculator.correction.manifest
        details.update(composition=m['profile'],profileSha256=m['profileSha256'],baselineId=m['profile']['baseline']['id'],dispersion='D3(BJ)-two-body',electrostatics=False,atm=False,engine=calculator.correction.receipt)
    return calculator, elements, details

def evaluate(atoms, calculator, elements):
    if not set(atoms.get_chemical_symbols()).issubset(elements):
        raise ValueError("ELEMENT_NOT_SUPPORTED")
    atoms.calc = calculator
    energy = float(atoms.get_potential_energy())
    forces = np.asarray(atoms.get_forces(apply_constraint=False), dtype=float)
    stress = np.asarray(atoms.get_stress(voigt=True, apply_constraint=False), dtype=float) if atoms.pbc.any() else None
    if forces.shape != (len(atoms), 3) or (stress is not None and stress.shape != (6,)) or not (np.isfinite(energy) and np.isfinite(forces).all() and (stress is None or np.isfinite(stress).all())):
        raise ValueError("NONFINITE_OR_INVALID_OUTPUT")
    return {"energyEv": energy, "forcesEvPerAngstrom": forces.tolist(),
            "stress": {"unit": "eV/angstrom^3", "sign": "positive-tension", "order": "xx,yy,zz,yz,xz,xy", "values": stress.tolist()} if stress is not None else None}
