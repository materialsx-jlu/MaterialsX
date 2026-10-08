---
name: materials-mlip-comparison
description: Compare actual single-point force differences from two compatible potentials on the same immutable structure, retaining versions and evidence. Unaligned total energies cannot be compared; agreement is not accuracy.
license: AGPL-3.0-only
---

# Compare compatible potentials

Require explicit authorization for exploratory comparison or independent production validation. Select once for singlepoint on the same immutable structure. Launch two different eligible potential IDs, using their own evidence IDs, query each to completed, then compare with targetId=first runId and secondaryId=second runId. Report true RMS/max force-vector difference and model/run IDs. Do not average or compare total energies with unknown reference alignment, or mistake model agreement for accuracy.

## Trusted tool contract

Use materials_science when available. Required fields: action, targetId, secondaryId, potentialId, domain, mode, evidenceIds. Unused IDs are null; unused evidenceIds is []. Use only the project-owned IDs returned by tools. A sample name is accepted only by import_sample in local mode. No arbitrary paths, downloads, scripts or substitute calculators.

Platform mode requires the user to choose a structure and permitted task in the model directory and approve the native outbound-summary dialog. Domain/mode must match that scope; do not switch to exploratory or another structure by yourself. Tool output is authoritative. Hard exclusions cannot be overridden. Lack of a tool or permission means explain the precise limitation.

All computations are CPU screening with needs_review: independent DFT errors and training overlap are unknown. Cite actual registry/runtime evidence IDs; never fabricate successful files. Failed, cancelled, interrupted and step-limit jobs do not prove convergence. Molecular preview is allowed; molecules, polymers, surfaces and interfaces are outside the current compute policy.

## Examples

- 中文：对内置 si-diamond 比较两个已验收势的力，先检查能量基准是否兼容。
- English: Compare forces from two validated potentials on bundled si-diamond after checking energy-reference compatibility.

- 中文：比较用户结构的同理论层级模型结果，保留版本；模型一致不等于准确。
- English: Compare same-theory model results for a supplied structure and preserve versions; agreement does not prove accuracy.
