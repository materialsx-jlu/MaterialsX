# Formulation constraints: compatible extension v1

Use ontology 1.1's accepted Recipe.profile.formulation_constraints plus an Assertion on that Recipe. Do not invent top-level collections or graph edge types. Binary fields match the existing detail UI.

```json
{
  "constraint_type": "component_mass_ratio",
  "display_name_zh": "PMA 与 PbI₂ 投料质量比",
  "numerator_usage_id": "USG-PMA",
  "denominator_usage_id": "USG-PBI2",
  "numerator_material_id": "MAT-PMA",
  "denominator_material_id": "MAT-PBI2",
  "numerator_value": 2,
  "denominator_value": 1,
  "basis": "mass",
  "ratio_text": "PMA:PbI₂ = 2:1",
  "source_expression": "PMA:PbI2 weight ratio of 2:1",
  "value_status": "reported",
  "evidence_ids": ["EV-RATIO"]
}
```

Assertion predicate is has_component_mass_ratio, subject the exact recipe, value the same constraint, with matching status/evidence. Both operands must be different active usages in the same recipe/experiment. For molar/volume ratios use component_molar_ratio/component_volume_ratio and basis=molar/volume. Unspecified basis remains unknown/pending with a review finding: “2:1” alone does not imply mass.

For multi-component ratios use constraint_type=component_ratio and terms:[{usage_id, material_id, coefficient}, ...]. Ranges use coefficient:{min,max}; preserve any coupled variation rather than assuming independent bounds. Other concentration/equivalent/sum constraints can retain structured expression and dependencies in the profile. Unsupported arithmetic stays uncomputed and flagged for review. Numerical validation covers exact mass/volume/molar ratios with convertible absolute quantities; skipped arithmetic must be disclosed.

Ratio-only recipes are valid and may omit absolute amounts. Do not put colon strings in amount.original_value. Mass is not molar basis; polymer mass is not molecule count. Do not convert wt% to grams without denominator definition and batch mass. Solids-only, solvent-inclusive, stock and final-device bases differ.

Keep three quantity concepts separate. `amount` is the absolute usage dose only. A ratio term coefficient is a normalized part and belongs in the recipe constraint; it must remain projectable onto every participating usage for display. “Additional 9 mol% PbI₂” is an addition relative to an author-defined reference, not the total PbI₂ dose: keep `amount` absent unless the total absolute dose is independently reported, store the percentage as `IngredientUsage.profile.additional_amount`, and state `additional_amount_basis`. If the reference denominator is not explicit, say so instead of assuming it.

An explicitly reported nominal product formula may be expanded into a precursor `component_molar_ratio` only when precursor identities and charge/halide mapping make the calculation unambiguous. Use `value_status=calculated`, retain `source_expression`, `calculation`, evidence and each usage's `profile.stoichiometric_coefficient`. This recovers normalized formulation information; it does not create grams, millilitres or a prepared batch volume. If competing mappings are chemically possible, preserve the formula and add a review finding rather than selecting one silently.

If PbI₂=0.173 g and mass ratio=2:1 are supported for this batch, PMA=0.346 g is calculated. Store profile.calculation, profile.depends_on_usage_ids, profile.depends_on_constraint (ratio text or ID), amount.normalization_note and value_status=calculated. Schema requires original_value; for this derived amount it holds the calculated number with explicit provenance, not a claim of a direct quote. Directly reported masses may stay reported with their own evidence. No absolute mass may be fabricated from a ratio alone.

Explicit absence goes in Recipe.profile.excluded_components with material_id, canonical_name, reason, value_status=reported and evidence_ids; omit it from active usages. Existing not_used=true usages remain absent and must have no positive dose/introduction. Unknown/never mentioned does not mean absent. A material cannot be active and excluded in the same recipe.

Duplicate detection is event-scoped. Same material/recipe/introduction step/evidence/dose without distinct profile.addition_index is a probable duplicate. Different subrecipes/steps or source-documented repeated additions are valid. Never copy a total dose into every split step. Stock aliquots are separate state transfers.

Before delivery inspect all numeric colon expressions in recipe text, tables and captions. Record a ratio inventory marking each encoded, unresolved or non-formulation (e.g. device stack/coordinates). Validators cannot detect facts never extracted from the PDF; this source coverage pass is required.
