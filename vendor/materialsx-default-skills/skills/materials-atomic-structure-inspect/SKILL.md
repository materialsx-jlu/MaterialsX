---
name: materials-atomic-structure-inspect
description: Inspect imported or bundled atomic structures for elements, cell, periodic boundaries and blocking issues while preserving the source; inspection is not simulation.
license: AGPL-3.0-only
---

# Inspect atomic structure

Use materials_science inspect (targetId=imported structure ID). If the user explicitly names a bundled sample, use import_sample first in local mode. Explain blocking issue codes and unknown electronic state; do not modify occupancy or original files. Use the 3D view action only when requested.

## Trusted tool contract

Use materials_science when available. Required fields: action, targetId, secondaryId, potentialId, domain, mode, evidenceIds. Unused IDs are null; unused evidenceIds is []. Use only the project-owned IDs returned by tools. A sample name is accepted only by import_sample in local mode. No arbitrary paths, downloads, scripts or substitute calculators.

Platform mode requires the user to choose a structure and permitted task in the model directory and approve the native outbound-summary dialog. Domain/mode must match that scope; do not switch to exploratory or another structure by yourself. Tool output is authoritative. Hard exclusions cannot be overridden. Lack of a tool or permission means explain the precise limitation.

All computations are CPU screening with needs_review: independent DFT errors and training overlap are unknown. Cite actual registry/runtime evidence IDs; never fabricate successful files. Failed, cancelled, interrupted and step-limit jobs do not prove convergence. Molecular preview is allowed; the M6.13 ANI-2x adapter supports explicitly declared neutral singlet isolated molecules. Polymers, surfaces and interfaces remain outside the current compute policy.

## Examples

- 中文：检查内置 si-diamond 样本的晶胞、元素和原子重叠。
- English: Inspect the bundled si-diamond sample for its cell, elements and overlapping atoms.

- 中文：检查用户提供的 CIF 是否存在部分占据；保留原文件。
- English: Check a user-supplied CIF for partial occupancy and preserve the source file.


## M6.13 molecular scope

ANI-2x (`ani-2x-ensemble`) is an eight-member mean, not an independently validated accuracy rank. Use `domain=molecules, mode=exploratory`. Read actual charge and spin first: only charge=0, spinMultiplicity=1, all PBC false, H/C/N/O/S/F/Cl, at most 128 atoms. Unknown XYZ electronic state requires explicit user annotation in the structure panel; never infer neutral charge or singlet spin. Fixed FIRE requires a user-declared nonperiodic display box. Its volume is a display quantity, never molecular volume/density. Molecular stress is null, not zero. Explicit long-range electrostatics, added D3, ions, radicals, molecular crystals, molecular MD, GPU and Windows are not enabled. `interaction=long-range-required` excludes all current short-range adapters; an approved scope cannot be silently downgraded. Use only real result files; retain needs_review and distinguish max_steps from convergence.

中文示例：导入内置 ethanol-neutral，用 ANI-2x 对中性单重态非周期乙醇做单点计算，显示原子力、真实文件和 3D，保留需科学复核。
English example: Import ethanol-neutral and run an ANI-2x neutral singlet isolated ethanol single point; show forces, real artifacts and 3D, retaining needs_review.

## M6.14 silicon native engine

The reviewed `nep-si-2022-nep4-3body` uses pinned NEP_CPU 1.4 C++ through a fixed process adapter, sharing the locked CHGNet Python/ASE environment without upgrading it. Only pure Si, 3D periodic bulk, exploratory single point and fixed-cell FIRE are approved (<=256 atoms, minimum cell singular value >=4 Å, volume/atom >=5 Å³). Actual type map is Si=0, total energy eV, forces eV/Å and ASE stress is -sym(total virial)/volume in positive-tension xx,yy,zz,yz,xz,xy order. Reject other elements, explicit charge/spin, variable cell, MD, GPU and required long-range physics. This is not the full GPUMD GPU simulator. Weights are the exact pinned NEP4 tutorial file; do not infer DFT accuracy, thermal transport or production validity from convergence. Show actual bilingual reports/3D and keep needs_review.

中文例子：用硅专用 NEP 对本项目已导入的 si-diamond 做探索单点；返回真实能量、逐原子力和应力，打开3D，不与其他势绝对能量直接排名。

English example: Run an exploratory silicon NEP single point on imported si-diamond. Return actual energy, per-atom forces, positive-tension stress and 3D; do not rank models by unaligned absolute energy.

## M6.15 fixed additive physics profile / 固定组合势

`mace-mp-0b3-medium-d3-bj-pbe-si` is a workflow using shared raw MACE-MP-0b3 medium weights plus native PBE-D3(BJ) two-body correction. Never add D3 twice or to another baseline/head. Energy, forces and stress add on the same structure; read registered `composition.json` for baseline/correction/total and `physics-profile.json` for parameters. Pure Si, 3D periodic, ≤128 atoms, fixed cell, minimum atom distance 2.3 Å; CPU exploratory SP/FIRE only. No ATM, explicit electrostatics, fields, spin, delta learning or arbitrary multi-head sums; reject those needs. A D3 request uses `interaction=dispersion-required`; electrostatics still uses `long-range-required` and is blocked. No independent DFT accuracy claim.

共享基线权重，无新增模型下载；是组合工作流，不是新训练势。报告每个分项及总量，Fmax 由各自力向量计算，不能直接相加。仅纯硅小型周期结构固定晶胞探索；其他材料需逐类验证，不能推断已全部支持。

- 中文例子：对已导入纯硅周期结构选择显式 D3 色散组合势，运行单点计算，展示基线、修正与总能量、力、应力及 3D，保留需科学复核标记。
- English example: Select the audited MACE + PBE-D3(BJ) profile for imported periodic pure Si, run fixed-cell FIRE, then show convergence, final component energy/force/stress and before/after 3D; retain needs_review.
