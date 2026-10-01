# Research-opportunity extension (Ontology 1.4)

For all new outputs, also read [opportunity-discovery-v7.md](opportunity-discovery-v7.md). It defines the scientific-depth fields, top-three journal recommendations and the user's automatic-publication policy; these override older draft-only instructions below when automatic import is authorized.

This is an optional post-extraction stage. Run it only when the user asks for research directions, opportunity cards, future work, or the Materials Ontology OS VIP discovery feature. Source extraction remains unchanged and must validate before this stage starts.

Set `schema_version=rpsme-ontology-1.4` only when both `paper_analysis` and `research_opportunities` are present. Otherwise keep Ontology 1.3. Keep all existing 1.3 bundle and asset fields.

## Evidence boundary

- `paper_analysis.paper_facts` contains only source-supported statements and non-empty `evidence_ids`.
- `reasoned_inference` contains deductions from those facts and identifies its factual basis.
- `unverified_assumptions` contains claims that need new experiments. Never phrase them as paper results.
- Direction generation must not mutate recipes, results, evidence, or other extracted source facts.

## Required output

Write one bilingual `paper_analysis.core_contribution` and exactly three bilingual opportunities:

1. `ordinal=1`, `archetype=validation`: low-risk causal validation.
2. `ordinal=2`, `archetype=extension`: medium-risk extension or process-window study.
3. `ordinal=3`, `archetype=platform`: high-upside platform or translation bet.

Each opportunity requires: stable ID, title, objective, rationale, research question, falsifiable hypothesis, novelty, evidence layers, minimum validation, detailed experiment design, an explicit simulation plan (`applicable` or `not_applicable`), 7/30/90-day and full-project milestones, currency/min/max budget with assumptions and inclusions/exclusions, owner, risks, stop conditions, seven 1–10 scores with bilingual reasons, publication target with evidence gaps, normalized bilingual keywords, `do|observe|drop`, and three next-seven-day actions.

Every card also requires `value_status=derived` and one novelty state:

- `preliminary`: based only on the source paper and internal nearby records. It must not claim a global or world first.
- `literature_screened`: allowed only after an external related-literature search; store `novelty_screening.query`, ISO-8601 `searched_at`, provider and `competing_papers` (DOI/title/year where available). Search results support review but do not prove novelty.
- `expert_reviewed`: allowed only after a named human expert review; store `expert_review.reviewer` and ISO-8601 `reviewed_at`.

Each keyword declares `source=controlled_vocabulary|auto_generated` and `status=active|pending_review`. A new auto-generated term must be `pending_review`; only an exact controlled-vocabulary match may be emitted as active. Keyword moderation in Materials Ontology OS remains authoritative.

The experiment design must name samples, variables, controls, process, characterization, performance tests, statistics, sample size, success criteria, failure criteria, and the next decision. The seven score dimensions are `feasibility`, `scientific_value`, `novelty`, `difficulty`, `cost`, `competition`, and `publication_potential`. A score without a bilingual reason fails validation.

The three cards must test different uncertainty classes; paraphrases at different scales fail review. Use SEM/TEM, FTIR/XPS, XRD/GIWAXS, TRPL/PLQY and similar measurements only when they answer a stated hypothesis. DFT/MD/FEM/CFD suggestions must name expected outputs and experimental validation.

Run the quality gate after the ordinary package validator:

```bash
python3 <skill-directory>/scripts/validate_research_opportunities.py OUTPUT.rpsme.v2.json
```

Do not publish a card when required bilingual text is absent, the analysis does not have exactly three distinct archetypes, a score is outside 1–10 or lacks a reason, paper facts lack evidence, budget bounds are invalid, simulation cross-validation is missing, or stop conditions are missing. The Skill creates drafts only; publication is a separate Materials Ontology OS administrator action.

When `recommendation=do` but feasibility or scientific value is below 7, include bilingual `recommendation_exception_reason`. Never convert a preliminary novelty judgment into `literature_screened` merely because a search was requested but failed.
