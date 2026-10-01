# Source-first preparation coverage

Required for new extractions with `rpsme-literature-v4-source-coverage` or
`rpsme-patent-v12-source-coverage`. Store this audit in the existing extensible
`source.profile`; no receiver Schema change is needed.

## Workflow

Before authoring entities, save `SOURCE.source-inventory.json` from the actual
main text, methods, relevant tables/captions and supplied SI. Register all samples,
subrecipes (including stocks), material additions, adjacent specifications,
doses/ratios/concentrations, operations and reported parameters. Record common
method applicability and sample-specific changes. Preserve the inventory during
assembly; never reconstruct it from final JSON or delete facts to pass the gate.
Add newly discovered facts with source locators; rejected candidates need reasons.

For long works, inventory the whole work first, then extract and save one
preparation family at a time. Review each family against its source before merging.
Optional image/simulation detail must not displace preparation coverage. Never
silently drop a stock preparation, method section or sample to fit a token budget.

After assembly, perform a separate source-first review with the host model:
start at Methods/SI, list expected facts, then inspect corresponding JSON fields.
Check every retained experiment, including controls and inherited variants. One
spot-checked example is insufficient to declare package coverage complete.

## Decisions that prevent recurring omissions

- Keep a named material usage/feed even when its dose is unreported.
- Ratio-only recipes are valid; use structured constraints. Derive mass only
  with a source-supported batch anchor and defined basis.
- Shared methods require original-method AND sample-applicability evidence.
  Hydrate child-local recipes, usages and steps; override changed factors and
  rewire recipe/route/state/flow references. Comparison baselines, name similarity
  or source adjacency alone do not establish preparation ancestry.
- A commercial identity does not reveal internal formulation. Preserve unknown
  composition. Do not invent preparation steps to satisfy non-empty-array checks.
- Measurement-only records may use not_applicable with a scope reason and actual
  specimen/preparation links where supported. A preparation not yet located is
  unresolved_with_reason, not not_applicable.
- Patent HTML correction uses evidence-backed field patches. Missing HTML content
  cannot erase PDF-supported facts; unchanged facts must survive correction.
- Repair named gaps locally and revalidate retained facts. After two focused
  repairs without progress, report the gaps as needs_extraction_review or
  needs_source_action. Do not claim completion or keep rewriting the whole package.

## Embedded ledger

Embed the completed inventory in `source.profile.extraction_coverage`:

```json
{
  "version": "rpsme-source-coverage-v1",
  "reviewed_sources": [
    {"document_id": "DOC-MAIN", "locator": "PDF pp. 3–4, Methods and Table 1", "status": "reviewed"},
    {"document_id": "DOC-SI", "locator": "SI pp. 2–6, preparation methods", "status": "reviewed"}
  ],
  "samples": [{"experiment_id": "EXP-A"}],
  "facts": [{
    "id": "FACT-A-STIR-DURATION", "experiment_id": "EXP-A",
    "category": "parameter", "disposition": "encoded",
    "source_text": "stirred for 2 h", "locator": "DOC-MAIN, PDF p. 3, Methods",
    "evidence_ids": ["EV-STIR"],
    "targets": [
      {"collection": "process_steps", "id": "STEP-A-STIR", "pointer": "/parameters/duration/original_value", "expected": 2},
      {"collection": "process_steps", "id": "STEP-A-STIR", "pointer": "/parameters/duration/original_unit", "expected": "h"}
    ]
  }]
}
```

This shows one fact, not a full inventory. Use real IDs/paths. Target paths are
entity-local JSON Pointers, not whole-package array indexes. `expected` is the
agreed encoded value; preserve original source and calculated/reported provenance
in the entity. Compare value AND unit. For inherited facts, target child entities.

Required categories: ingredient, formulation, process. Also enumerate specification,
parameter and flow whenever present. Every sample needs a decision for each of
the three required categories, including unreported/inapplicable dimensions.

Each fact has id, experiment_id, category, locator and disposition:

- encoded: source_text, evidence_ids and targets with collection/id/pointer/expected.
- source_not_reported: reason identifying checked sections and the precise missing
  field, e.g. mass absent although material identity is known.
- not_applicable: reason explaining the experiment's actual scope.
- unresolved: concrete extraction/assignment/access gap. Affected records cannot
  be ready_for_primary_review.

List all supplied documents in reviewed_sources. Unread sources use status
unavailable and a reason. Patent HTML uses a stable source ID and exact URL/section
locator. Existing evidence must still be checked against the original source.

## Validation and delivery

Run `validate_package.py OUTPUT.rpsme.v2.json --require-coverage`, render the
summary and inspect every sample's usage names, ratios and process parameters.
Repeat final validation after bundle assembly.

- valid: structural, semantic and inventory-to-field checks passed.
- coverage_checked: a source inventory was supplied and checked.
- source_coverage_complete: inventoried facts were accounted for with no unresolved
  extraction/access gaps. Genuine unreported source data may remain empty.

This is not a scientific correctness score or a guarantee of PDF recall. It detects
lost entities/fields, empty recipe/routes, wrong sample targets and skipped inventory
categories. It cannot detect a fact never inventoried or prove that a quote or
missingness explanation is correct. Source-first review is still necessary.

Legacy packages retain compatibility with a coverage warning. New prompt versions
require the ledger. The database and PDF/URL pipeline keep their existing checks;
this additional Skill gate does not imply all import paths enforce the ledger yet.
