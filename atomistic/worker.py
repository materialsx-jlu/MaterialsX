"""One request per isolated child; NDJSON progress, atomic JSON results. No network."""
from __future__ import annotations
import contextlib
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import platform
import time
import threading
import stat
import socket

# Locked local weights never need outbound connections. Enforce this in every worker.
def deny_network(*args, **kwargs):
    raise RuntimeError("ATOMISTIC_NETWORK_DISABLED")
socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
socket.create_connection = deny_network
socket.getaddrinfo = deny_network

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I: only this trusted application's modules

PROTOCOL = sys.stdout
WORKER_STARTED = time.monotonic()

def emit(event: str, **payload):
    PROTOCOL.write(json.dumps({"event": event, **payload}, allow_nan=False) + "\n")
    PROTOCOL.flush()

def atomic_json(path: Path, document):
    text = json.dumps(document, indent=2, allow_nan=False) + "\n"
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(text, encoding="utf-8")
    os.replace(temp, path)

def versions():
    names = ["torch", "numpy", "ase", "pymatgen", "pymatgen-core", "torchani", "mace-torch", "chgnet", "sevenn", "e3nn", "torch-geometric", "psutil"]
    result = {"python": sys.version.split()[0]}
    for name in names:
        try:
            result[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            pass
    return result

def check_schema(root: Path, name: str, value):
    from jsonschema import Draft202012Validator
    Draft202012Validator(json.loads((root / "schemas/m6" / f"{name}.json").read_text())).validate(value)

def resource_usage(process, directory):
    """Measure live files/processes; atomic renames and child exits are normal races."""
    import psutil
    rss = process.memory_info().rss
    for child in process.children(recursive=True):
        try:
            rss += child.memory_info().rss
        except psutil.NoSuchProcess:
            continue
    size = 0
    for path in directory.iterdir():
        try:
            info = path.stat()
        except FileNotFoundError:
            continue  # a writer atomically replaced its .tmp after the directory listing
        if stat.S_ISREG(info.st_mode):
            size += info.st_size
    return rss, size

def execute(request: dict):
    from structures import inspect, to_atoms
    root = Path(request["root"])
    if request["operation"] == "inspect":
        def import_watchdog():
            import psutil
            process = psutil.Process()
            while True:
                if process.memory_info().rss > 1024 * 1048576:
                    emit("error", message="IMPORT_MEMORY_LIMIT")
                    os._exit(73)
                time.sleep(0.25)
        threading.Thread(target=import_watchdog, daemon=True).start()
        structure = inspect(Path(request["source"]), request["structureId"], request["artifactId"])
        check_schema(root, "AtomicStructure", structure)
        emit("structure", structure=structure)
        return
    if request["operation"] == "capabilities":
        from adapters import approved_specs, load
        import psutil
        def capability_watchdog():
            process = psutil.Process()
            while True:
                if process.memory_info().rss > 4096 * 1048576:
                    emit("error", message="CAPABILITY_MEMORY_LIMIT")
                    os._exit(73)
                time.sleep(.25)
        threading.Thread(target=capability_watchdog, daemon=True).start()
        calculator, elements, details = load(request["potentialId"], Path(request["weight"]), 4, root)
        emit("capabilities", receipt={"potentialId":request["potentialId"], "sha256":approved_specs(root)[request["potentialId"]]["sha256"], "dependencyLockSha256":request["dependencyLockSha256"], "elements":elements, "loadedMemoryMiB":psutil.Process().memory_info().rss / 1048576, "device":"cpu", "adapter":details})
        return
    if request["operation"] not in ("singlepoint", "relaxation", "md"):
        raise ValueError("UNSUPPORTED_OPERATION")
    from adapters import approved_specs, load, evaluate
    plan = request["plan"]
    check_schema(root, "AtomisticPlan", plan)
    potential_id = plan["potentialId"]
    spec = approved_specs(root)[potential_id]
    if plan["task"]["kind"] != request["operation"] or plan["device"] != "cpu" or plan["dtype"] != spec["dtype"] or plan["head"] is not None:
        raise ValueError("UNSUPPORTED_PLAN")
    if plan["potentialSha256"] != spec["sha256"] or plan["qualityPolicyId"] != ("m6-molecular-screening-v1" if potential_id == "ani-2x-ensemble" else "m6-inorganic-screening-v1"):
        raise ValueError("PLAN_IDENTITY_MISMATCH")
    directory = Path(request["directory"])
    def watchdog():
        import psutil
        process = psutil.Process()
        while True:
            try:
                if time.monotonic() - WORKER_STARTED > plan["budget"]["maxWallSeconds"]:
                    emit("error", message="WALL_TIME_LIMIT")
                    os._exit(76)
                rss, size = resource_usage(process, directory)
                if rss > plan["budget"]["maxMemoryMiB"] * 1048576:
                    emit("error", message="MEMORY_LIMIT")
                    os._exit(73)
                if size > plan["budget"]["maxOutputMiB"] * 1048576:
                    emit("error", message="OUTPUT_SIZE_LIMIT")
                    os._exit(74)
                time.sleep(0.25)
            except Exception:
                emit("error", message="RESOURCE_MONITOR_FAILED")
                os._exit(75)
    threading.Thread(target=watchdog, daemon=True).start()
    data = (directory / "structure.json").read_bytes()
    if hashlib.sha256(data).hexdigest() != plan["structureSha256"]:
        raise ValueError("STRUCTURE_IDENTITY_MISMATCH")
    structure = json.loads(data)
    check_schema(root, "AtomicStructure", structure)
    if structure["id"] != plan["structureId"] or len(structure["atoms"]) > plan["budget"]["maxAtoms"]:
        raise ValueError("PLAN_STRUCTURE_MISMATCH")
    composed=potential_id=='mace-mp-0b3-medium-d3-bj-pbe-si'
    if composed and (request['operation']=='md' or request['operation']=='relaxation' and plan['task']['cellMode']!='fixed'):raise ValueError('COMPOSITION_FIXED_CELL_ONLY')
    native = potential_id == "nep-si-2022-nep4-3body"
    if native and (request["operation"] == "md" or request["operation"] == "relaxation" and plan["task"]["cellMode"] != "fixed"):raise ValueError("NEP_FIXED_CELL_ONLY")
    molecular = potential_id == "ani-2x-ensemble"
    if molecular and (request["operation"] == "md" or request["operation"] == "relaxation" and (plan["task"]["cellMode"] != "fixed" or not structure["cell"])):
        raise ValueError("MOLECULAR_TASK_NOT_SUPPORTED")
    atoms = to_atoms(structure, molecular=molecular)
    emit("progress", status="loading_model")
    calculator, elements, details = load(potential_id, Path(request["weight"]), plan["budget"]["threads"], root)
    atomic_json(directory / "environment.json", {"versions": versions(), "device": "cpu", "dtype": spec["dtype"],
                "potentialId": potential_id, "sha256": spec["sha256"], "elements": elements, "adapter": details,
                **({"optimizationAlgorithm": {"optimizer":"FIRE","dt":.1,"dtmax":.5,"maxstep":.1,"cellFilter":"FrechetCellFilter" if plan["task"].get("cellMode")=="variable" else None,"expCellFactor":len(atoms)}} if request["operation"]=="relaxation" else {}),
                "environmentProfileId": plan["environmentProfileId"], "dependencyLockSha256": request["dependencyLockSha256"], "sourceRevision": request.get("sourceRevision"), "platform": "macos-arm64" if sys.platform=="darwin" and platform.machine()=="arm64" else "windows-x64" if sys.platform=="win32" and platform.machine().lower() in ("amd64", "x86_64") else sys.platform+"-"+platform.machine()})
    emit("progress", status="running")
    started = time.monotonic()
    summary = None
    if request["operation"] == "relaxation":
        from relaxation import run_relaxation
        def check63(name, value):
            from jsonschema import Draft202012Validator
            Draft202012Validator(json.loads((root / "schemas/m63" / f"{name}.json").read_text())).validate(value)
        values, summary = run_relaxation(atoms, calculator, elements, structure, plan, request["relaxationOptions"], directory, request["runId"], atomic_json, emit,
            lambda name, value: check_schema(root, name, value), check63)
    elif request["operation"] == "md":
        from dynamics import run_md
        def check65(name, value):
            from jsonschema import Draft202012Validator
            Draft202012Validator(json.loads((root / "schemas/m65" / f"{name}.json").read_text())).validate(value)
        values, summary = run_md(atoms, calculator, elements, structure, plan, request["mdOptions"], directory, request["runId"], atomic_json, emit, check65)
    else:
        values = evaluate(atoms, calculator, elements)
    result = {"schemaVersion": "m6.0-v1", "runId": request["runId"], "planId": plan["id"], "structureId": structure["id"],
              "potentialId": potential_id, "potentialSha256": spec["sha256"], "atomCount": len(atoms), **values,
              "stopReason": "max_steps" if request["operation"] == "md" else summary["stopReason"] if summary else "singlepoint", "completedSteps": summary["completedSteps"] if summary else 1, "quality": "needs_review", "validationEvidenceIds": []}
    check_schema(root, "AtomisticResult", result)
    atomic_json(directory / "result.json", result)
    atomic_json(directory / "validation.json", {"interface": "passed", "scientificQuality": "needs_review",
                "reason": "No independent DFT reference labels; inference does not validate scientific accuracy.",
                "canonicalUnits": {"energy": "eV-total", "forces": "eV/angstrom", "stress": "eV/angstrom^3-positive-tension"},
                "elapsedCalculationSeconds": time.monotonic() - started, "optimizationStop": summary["stopReason"] if summary else None, "physicalScope": details})
    if request["operation"] == "singlepoint":
        (directory / "report.zh.md").write_text(f"# 单点计算报告\n\n模型：{potential_id}\n\n原子数：{len(atoms)}；总能量：{values['energyEv']:.10f} eV。\n\n原子力见 result.json；周期结构应力为拉伸正，孤立分子才是 stress=null。结构、权重与依赖锁摘要见 plan.json / environment.json。\n\n质量：需科学复核。没有独立 DFT 参考标签，不能据此宣称预测精度通过。\n", encoding="utf-8")
    if request["operation"] == "singlepoint":
        (directory / "report.en.md").write_text(f"# Single-point calculation report\n\nModel: {potential_id}; atoms: {len(atoms)}; total energy: {values['energyEv']:.10f} eV.\n\nForces are recorded in result.json. Periodic stress uses positive tension; isolated molecular stress is null. Structure, weight and dependency identities are in plan.json / environment.json.\n\nScientific status: needs_review. No independent DFT reference labels; this inference does not establish accuracy or relaxation convergence.\n", encoding="utf-8")
    if native:
        atomic_json(directory / "native-engine.json", {"version":"m6.14-v1",**details,"quality":"needs_review"})
        for locale in ("zh","en"):
            path=directory/f"report.{locale}.md"
            if not path.exists():path.write_text((f"# 硅专用 NEP 单点报告\n\n模型：{potential_id}；{len(atoms)} 原子。总能量：{values['energyEv']:.10f} eV。\n" if locale=="zh" else f"# Silicon NEP single-point report\n\nModel: {potential_id}; {len(atoms)} atoms. Total energy: {values['energyEv']:.10f} eV.\n"),encoding="utf-8")
            with path.open("a",encoding="utf-8") as f:f.write("\n原生引擎：NEP_CPU 1.4 C++；Si 映射为类型0。总能量单位 eV，逐原子力 eV/Å，应力=-对称化原子维里之和/体积，拉伸为正。仅纯硅周期探索；质量需科学复核，没有独立 DFT 精度验证。\n" if locale=="zh" else "\nNative NEP_CPU 1.4 C++; Si -> type 0; total eV; forces eV/Å; stress=-sym(virial)/V, positive tension. Pure silicon bulk screening; no independent DFT accuracy validation.\n")
    if molecular:
        scope = "Neutral singlet isolated molecule; eight-member ANI2x mean; short-range, no explicit long-range electrostatics or added dispersion; stress=null. Nonperiodic box volume, if present, is for display only."
        atomic_json(directory / "molecular-scope.json", {"version": "m6.13-v1", "charge": structure["charge"], "spinMultiplicity": structure["spinMultiplicity"], "pbc": structure["pbc"], **details, "quality": "needs_review"})
        for locale in ("zh", "en"):
            path = directory / f"report.{locale}.md"
            if not path.exists(): path.write_text(f"# Single point\n\n{potential_id}; {len(atoms)} atoms; {values['energyEv']:.10f} eV.\n", encoding="utf-8")
            with path.open("a", encoding="utf-8") as f: f.write("\n\n" + scope + "\nNo independent DFT reference labels: needs scientific review.\n")
    if summary and request["operation"] == "relaxation":
        status = "已收敛" if summary["stopReason"] == "converged" else "达到步数上限，未收敛"
        for locale in ("zh", "en"):
            text = (f"# 结构优化报告\n\n状态：{status}；{summary['completedSteps']} 步。\n\n模型：{potential_id}；FIRE，{summary['options']}。\n\n总能量：{summary['initial']['energyEv']:.10f} → {summary['final']['energyEv']:.10f} eV。\n\n最大原子力：{summary['final']['maxForceEvPerAngstrom']:.8f} eV/Å；最大过滤器广义力：{summary['final']['maxFilterForceEvPerAngstrom']:.8f} eV/Å。\n\n" if locale == "zh" else
                f"# Structure relaxation report\n\nStop: {summary['stopReason']}; {summary['completedSteps']} steps.\n\nModel: {potential_id}; FIRE; {summary['options']}.\n\nEnergy: {summary['initial']['energyEv']:.10f} → {summary['final']['energyEv']:.10f} eV.\n\nMaximum atomic force: {summary['final']['maxForceEvPerAngstrom']:.8f} eV/Å; maximum filter force: {summary['final']['maxFilterForceEvPerAngstrom']:.8f} eV/Å.\n\n")
            text += ("固定晶胞以所有原子力向量模长最大值判定；变胞还要求 FrechetCellFilter 广义力（exp_cell_factor=N）达标。外压正值为压缩，变胞目标为 E+pV。位移为最终减初始笛卡尔坐标，未做最小镜像，包含晶胞形变。局部优化不保证全局稳定；需科学复核，没有独立 DFT 精度验证。\n\n每步记录见 steps.json / observables.csv；真实最终结构见 final.json / final.extxyz；依赖、单位和输入谱系见 plan.json / environment.json。\n" if locale == "zh" else
                "Convergence uses the largest atomic force vector norm; variable cell also requires the FrechetCellFilter force norm (exp_cell_factor=N). Positive external pressure is compressive; variable-cell objective is E+pV. Displacement is final minus initial Cartesian position, without MIC, including cell strain. This local minimum does not establish global stability or DFT accuracy; needs scientific review.\n\nSteps: steps.json / observables.csv; final geometry: final.json / final.extxyz; provenance, units and dependency identities: plan.json / environment.json.\n")
            if native: text += "\nNEP_CPU 1.4 native C++; pure Si tutorial checkpoint; fixed-cell only, no independent DFT accuracy validation.\n"
            if molecular: text += "\n" + scope + "\n"
            (directory / f"report.{locale}.md").write_text(text, encoding="utf-8")
    if composed:
        atomic_json(directory/'composition.json',calculator.components)
        atomic_json(directory/'physics-profile.json',{'profile':details['composition'],'sha256':details['profileSha256']})
        atomic_json(directory/'native-engine.json',details['engine'])
        b=calculator.components['baseline']['energyEv'];d=calculator.components['correction']['energyEv']
        for locale in ('zh','en'):
            path=directory/f'report.{locale}.md'
            text=(f'# 组合势分项报告\n\n基线：{b:.10f} eV；PBE-D3(BJ) 两体修正：{d:.10f} eV；总能量：{values["energyEv"]:.10f} eV。\n\n能量、力、应力均按同一结构逐项相加，分项见 composition.json。D3 截断10 Å，配位数截断5 Å，未含 ATM 或静电。仅纯硅固定晶胞探索；不能据此宣称 DFT 精度。\n' if locale=='zh' else f'# Composed potential components\n\nBaseline: {b:.10f} eV; two-body PBE-D3(BJ): {d:.10f} eV; total: {values["energyEv"]:.10f} eV.\n\nEnergy, forces and stress are added on the same structure; see composition.json. Cutoffs 10/5 A, no ATM or electrostatics. Pure-Si fixed-cell screening only; no DFT accuracy claim.\n')
            if summary:text+=('\n真实停止状态：' if locale=='zh' else '\nActual stop: ')+summary['stopReason']+f'; {summary["completedSteps"]} steps.\n'
            path.write_text(text,encoding='utf-8')
    if request["operation"] == "md":
        import psutil
        rss, size = resource_usage(psutil.Process(), directory)
        if rss > plan["budget"]["maxMemoryMiB"] * 1048576: raise ValueError("MEMORY_LIMIT")
        if size > plan["budget"]["maxOutputMiB"] * 1048576: raise ValueError("OUTPUT_SIZE_LIMIT")
    emit("completed")

if __name__ == "__main__":
    try:
        line = sys.stdin.readline(1024 * 1024 + 1)
        if len(line) > 1024 * 1024:
            raise ValueError("REQUEST_TOO_LARGE")
        request = json.loads(line)
        # Upstream libraries print banners; never mix those with the NDJSON protocol.
        with contextlib.redirect_stdout(sys.stderr):
            execute(request)
    except Exception as error:
        emit("error", code=type(error).__name__, message=str(error)[:2000])
        sys.exit(1)
