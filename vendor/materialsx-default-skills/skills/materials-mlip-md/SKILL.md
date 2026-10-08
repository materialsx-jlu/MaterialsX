---
name: materials-mlip-md
description: Run bounded fixed-cell NVE/NVT molecular dynamics with verified core potentials; generate actual trajectories, ensemble diagnostics and bilingual reports. Exploratory inorganic bulk crystals only, with local 3D playback/export and needs_review quality.
license: AGPL-3.0-only
---

# Run short molecular dynamics

Use the trusted local CPU executor. The input must be a project-owned imported structure, compatible with actual checkpoint element coverage, bulk PBC and the explicitly chosen inorganic-crystals domain. Production mode remains blocked without independent DFT evidence; do not silently switch the user’s domain/mode. Never bypass exclusions with bash, downloads, substitute calculators or fabricated trajectories.

With `materials_science`, use `select`, citing real eligible evidence IDs, then `md`, followed by `get` until terminal. All seven fields are required: action, targetId, secondaryId, potentialId, domain, mode, evidenceIds. Unused IDs are null and unused evidenceIds is []. Locally `select` uses secondaryId=md. Platform selection/task options are frozen by the user’s structure/task scope and native summary consent; secondaryId is null. `md` uses targetId=assessment ID, eligible potentialId and candidate evidenceIds. Local dispatcher defaults: NVE, 200 steps, 0.5 fs, initial 300 K, sample every 10, seed 20261001, no thermostat. For explicit local parameters use `run_atomic_md` with the assessment ID, evidence IDs, potential ID and mdOptions; platform parameters must come from the approved scope.

`mdOptions`: ensemble nve/nvt; steps 1–2000; timestepFs 0.01–1; temperatureK 1–1000; sampleEvery 1–steps; seed 0–4294967295; frictionInverseFs null for NVE or explicitly 0.001–0.1 for NVT. NVE uses Velocity Verlet; NVT uses Langevin, friction in fs^-1. Current policy fixes the cell, uses 3N degrees of freedom, exact-temperature Maxwell–Boltzmann initialization/PCG64, and retains COM motion. H/He requires timestep ≤0.25 fs; eligibility and timestep do not themselves prove numerical stability. Default per-job limits: 256 atoms, 600 seconds, 4096 MiB, 64 MiB output; one heavy job at a time.

Read actual saved steps/time/units and registered hashed files. Coordinates, full velocities/forces, frame arrays and local paths stay on the device in platform mode; only bounded scalar diagnostics and artifact IDs/hashes go to the model. The card opens a local lazy 3D player; extxyz export contains unwrapped positions (Å), velocity_A_per_fs (Å/fs), step and time_fs (fs). Initial/final valid frames are retained even when the final step is not a sampling multiple. Failure, cancellation and restart preserve partial valid frames when available, with an incomplete label and no successful result. Geometry reuse starts a NEW segment; complete integrator/RNG state is not saved, so never call it a continuation.

NVE drift is the least-squares slope of total energy across all integration steps, in meV/atom/ps. Its engineering threshold requires at least 1000 fs and |slope| ≤1; shorter runs are insufficient, not passed. NVT reports mean temperature in the final half; at least 500 fs and relative error ≤20% is an engineering smoke check only. Thermostat temperature control is not energy conservation. NaN/Inf, overlap, extreme force/temperature/velocity/displacement, model errors and resource limits stop execution. Short trajectories do not establish diffusion, phase transitions, thermodynamic ensembles, long-term thermal stability or DFT accuracy; keep needs_review even after engineering checks pass.

`materials_science compare` accepts two completed MD job IDs on the same immutable input, identical options/initial velocities, and different core potentials. Compare temperature and within-model energy changes, never unaligned absolute energies or an invented accuracy ranking. Multi-model agreement does not establish accuracy.

## Examples

- 中文：对本项目已导入的 si-diamond 用 CHGNet 做探索 NVE，300 K 初始化，200 步 ×0.5 fs，每 10 步采样，种子 20261001。查询真实终态、轨迹和漂移，明确 100 fs 不足以通过 1000 fs 漂移诊断。
- English: Run exploratory CHGNet NVE on this project’s imported si-diamond: initial 300 K, 200 ×0.5 fs, sample10, seed20261001. Query real terminal state, frames and drift; disclose the insufficient 100 fs duration.
- 中文：对本项目已导入的周期晶体用 MACE 做探索 NVT，300 K，200 步 ×0.5 fs，Langevin 摩擦 0.01 fs^-1，每 10 步采样，种子 20261001。保留真实时间/速度，报告温度诊断，不推断长期稳定性。
- English: Run exploratory MACE NVT on this project’s imported periodic crystal: 300 K, 200 ×0.5 fs, Langevin friction0.01 fs^-1, sample10, seed20261001. Preserve true time/velocities and report temperature diagnostics without long-term stability claims.
