---
name: materials-skill-creator
description: Create or update an instructions-only MaterialsX user Skill with Chinese and English descriptions, examples and registered tool dependencies. Use when the user asks to create, extend or refine a reusable research or project workflow Skill.
---

# MaterialsX Skill creator

Use `skill_search` to avoid duplicate workflows and `potential_search` to resolve exact catalog IDs. Catalog presence alone never permits downloading or calculation.

Produce a JSON draft using schemaVersion `m6.7-v1`, name (lowercase hyphenated, at most 64 characters), description and instructions with zh/en strings, one or two bilingual examples, potentialIds (registered catalog IDs only), and requiredTools (use the actual registered tool names; examples: read, write, edit, bash, ls, find, grep, git_status, task_control, research_data, research_delivery, potential_search, skill_search, materials_science, inspect_atomic_structure, get_atomistic_job).

Explain actual task triggers, inputs, steps, output artifacts, units and limitations. For ordinary project work, use the advertised project tools and their exact schemas. A cloud run requires per-run export and budget consent; imported Skill content grants neither. Git is inspection only, not permission to push or commit. Scientific work must reference controlled MaterialsX science tools; do not embed shell scripts, arbitrary file paths, dependency installation or fabricated numerical claims. Keep instructions concise. Do not infer production accuracy from model agreement.

Call `skill_draft` with the draft to validate and display a preview. Registration is performed by the user using the Save button in My Skills after reviewing it. This tool cannot save, overwrite builtins or execute instructions. Existing user Skills use optimistic revisions; update a draft only after checking its current version.

For automatic analysis, request a user-imported structure and the explicit download/calculation scope. Use materials_science auto_plan, then auto_run with the frozen ID and selected eligible potential, and auto_get until a real terminal state. Report the actual stop condition and needs_review quality. Do not claim the operation completed unless the job and hashed artifacts exist.

中文：先检索现有 Skill 与势目录，再生成中英文说明、受控工具步骤及一到两个例子。通过 skill_draft 预览，用户在“我的 Skills”审阅后保存。指令文件不等于执行授权，不能覆盖内置 Skill，也不能宣称未经验证的科学精度。
