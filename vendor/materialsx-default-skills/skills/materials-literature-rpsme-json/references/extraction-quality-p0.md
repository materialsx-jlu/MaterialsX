# P0 extraction quality (Skill 1.6.0)

Read this reference for every new extraction. These checks add a quality workflow,
not an accuracy guarantee or expert approval. Keep the receiver's existing Ontology
1.3/1.4 contract and identity-resolution stage. Never upload audit source text or
change database records unless the user requested that operation.

## 1. Layout, formulas and local OCR

`prepare_document_set.py` now runs conservative page diagnostics. It preserves
native page text and its hash, block coordinates, image-coverage hints and rendered
review pages. `--ocr auto` attempts local PyMuPDF/Tesseract only on low-text pages
dominated by images. `--ocr never` disables OCR; `--ocr always` attempts every page.
Choose installed languages with `--ocr-language eng+chi_sim`. OCR errors are recorded,
not replaced by fabricated text. Native text remains immutable; OCR has its own file,
hash and `performed_unverified` status. No paid API or network upload is used.

Low-text, possible two-column order and replacement-glyph flags require visual
review. These heuristics can miss scrambled but plausible text or subtle formula
corruption. Always inspect methods, composition formulas, tables and figures even
when no flag appears. Blank pages and diagrams are not proof of a scanned article.
Main and SI keep distinct document IDs and **physical 1-based PDF pages**, not
printed page numbers. Confirm article association; preparation cannot do that.

## 2. Table-first extraction

Prefer legally accessible publisher HTML/JATS table fragments, then native PDF
tables, then a host visual pass or a separately configured specialist engine.

```bash
python3 scripts/prepare_tables.py paper.html --format html --document-id DOC-MAIN --output tables.json
python3 scripts/prepare_tables.py tables.xml --format jats --document-id DOC-MAIN --output tables.json
python3 scripts/prepare_tables.py paper.pdf --format pdf --document-id DOC-MAIN --output tables.json
python3 scripts/prepare_tables.py external-cells.json --format cells --document-id DOC-MAIN --output tables.json
```

The first two paths retain merged-cell spans, header cells, original strings and
row packets. JATS fragments retain table-wrap captions/footnotes; supply fragments
without DTD/entity declarations. HTML footnotes outside the table must be separately
inventoried. Native PDF candidates preserve table bounding boxes but do not infer
merged cells or header truth. Inspect source renderings before mapping them.

External engines (Docling, MaTableGPT, DiSCoMaT or others) are **not bundled or run**.
An engine-specific caller must adapt its actual output to this supported envelope:

```json
{
  "format": "rpsme-table-cells-v1",
  "engine": {"name": "actual-engine-name", "version": "actual-version"},
  "tables": [{
    "table_id": "TABLE-S1", "locator": {"pdf_page": 2},
    "caption": "Original caption", "footnotes": ["Original footnote"],
    "cells": [
      {"row": 0, "column": 0, "rowspan": 1, "colspan": 1, "header": true, "text": "Sample"},
      {"row": 1, "column": 0, "rowspan": 1, "colspan": 1, "header": false, "text": "A"}
    ]
  }]
}
```

Cells use zero-based row/column. `bbox` and additional provenance can be retained.
Every row packet carries its headers/caption/footnotes. Map source sample labels,
composition basis, original units, conditions, nominal versus measured values and
missing markers before writing RPSME entities. `—` is not zero; mol% is not wt%.
Record table/row/column in evidence locators (and preserve them in profile if the
receiver's locator fields do not support them). Table candidates are not ontology
facts. A zero-table result means no table detected, not table absence. Raster curve
digitization and engine-native adapters remain outside this P0 release.

## 3. Extract → omission scan → evidence check → prune → reconcile

1. **Extract:** retain the original source-first coverage inventory and build the
   draft. For intermediate schema checks only use `--structural-only`.
2. **Omission scan:** start a separate host-model pass from original pages, not from
   the draft summary. Inventory controls, raw inputs, stocks, variant recipes,
   testing conditions, tables, SI and all samples. Then compare with the draft.
   This is a separate reasoning pass, not an independent model or human benchmark.
3. **Evidence check:** generate an audit and pending review template:

   ```bash
   python3 scripts/quality_review.py OUTPUT.rpsme.v2.json --documents WORKDIR/document-set.manifest.json --output OUTPUT.quality-audit.json --template OUTPUT.quality-review.json
   ```

   Exit 1 is expected until review is complete. The audit includes original-page
   text, source-first lexical anchors, exact quote relocation and all dangling
   `evidence_id(s)` references, including core contributions and research cards.
   Only whitespace and soft hyphen normalization are allowed: signs, decimal
   values, units, case and chemical subscripts are not silently changed. Literal
   match establishes textual presence, not scientific entailment or correct sample
   assignment. Web CAS lookup records still require genuine fetched primary-source
   quotations; search URLs and fabricated lookup descriptions are not evidence.
4. **Prune:** remove only demonstrated unsupported *claims* from the working draft,
   or keep them explicitly unresolved. Never delete a named input just because its
   dose is missing. Preserve the original draft and coverage ledger; record exactly
   which claims changed and why in the review notes. Keep source-supported facts.
   This is a host-model repair step, not automatic destructive graph deletion.
5. **Reconcile:** re-check all entity links, sample/condition assignments, units,
   inherited preparation, table evidence and direction-card evidence IDs. Run the
   existing coverage/schema checks. After every JSON/source change regenerate the
   audit/template; review records are bound to the canonical package and prepared
   source hashes. Finish bundling **before** final audit, because bundling changes
   JSON. The external JSON must still exactly match the bundle companion.

Fill the template's four pass notes and each page's review record with concrete
findings. Identify the actual host model/human actor. On each page explicitly check
tables, sample identities and conditions (including a reason when absent).
For review-only findings, `verified_visual` requires a reason and the exact rendered
page SHA-256; quote mismatches additionally require a visually checked transcription
matching the quoted text. Render a missing page using `--render-pages`, regenerate
preparation/audit and review. Hard errors cannot be waived by declaring a review.
Do not auto-fill completed statuses without doing the work. External evidence not
represented by a prepared PDF remains outside automatic relocation and must not be
silently relabeled as a local quote.

```bash
python3 scripts/validate_package.py OUTPUT.rpsme.v2.json --require-coverage --require-quality --documents WORKDIR/document-set.manifest.json --quality-review OUTPUT.quality-review.json --report OUTPUT.validation.json
```

Generator version 1.6.0+ automatically enables this gate unless explicitly running
an intermediate `--structural-only` check. Old packages remain compatible. Failed
or stale reviews block quality-ready delivery; unresolved extractions may be saved
as drafts with `needs_extraction_review`, but must not be described as complete or
automatically submitted as a successfully verified extraction. This is a **Skill
gate**, not a newly deployed backend import gate.

Report `valid`, `coverage_checked`, `source_coverage_complete`,
`extraction_quality_checked` and `extraction_quality_ready` independently.
`scientific_correctness_verified` and `expert_verified` remain false. A supported
quote and completed model review never grant CAS verification, novelty approval
or primary/secondary review authority.

## 4. Gold benchmark and reproducible evaluation

```bash
python3 scripts/evaluate_extraction.py init --output benchmark.json
python3 scripts/evaluate_extraction.py evaluate benchmark.json predictions.json --output metrics.json
```

The initializer creates an **empty annotation template**, with a target of 50
(expandable to 100) real papers. Select varied materials, publishers, scans,
multi-column layouts, tables and main/SI pairs. Label ingredients, compositions,
process parameters, properties, sample/condition links and evidence. Record named
annotators, independent reviewers, timestamps, disagreements and adjudication.
Never turn model-generated records into expert gold by changing a flag. Keep every
DOI and its SI in one train/dev/test split. Hold out entire papers, not table rows.

Each benchmark case has this shape (illustrative, not scientific ground truth):

```json
{
  "paper_id": "REPLACE-WITH-REAL-DOI", "split": "test",
  "annotation_status": "draft", "reviewers": [],
  "facts": [{
    "sample": "source-label", "material": "source-material-name",
    "field": "ingredient.mass", "conditions": {}, "basis": "absolute_dose",
    "value_status": "reported", "value": 1, "unit": "g",
    "evidence": {"document_id": "DOC-MAIN", "pdf_page": 2, "quote": "Exact source quote"},
    "tolerance": {"relative": 0, "absolute_base_unit": 0.000001}
  }]
}
```

Gold envelope: `format=rpsme-extraction-benchmark-v1, cases=[...]`.
Prediction envelope: `format=rpsme-extraction-predictions-v1, cases=[...]`, each case
with paper_id and facts. Predictions must enumerate **all** facts in the evaluated
fields, not just gold matches. `project PACKAGE MAPPING --output predictions.json`
supports explicit mappings: mapping has paper_id and a facts array; each fact maps
all above attributes to whole-package JSON Pointers. All predicted values must be
read from the package, never copied from gold. Missing pointers are reported and
omitted, hence scored as misses. Inventory extra predictions in mapping to avoid
inflated precision. Source aliases need a documented mapping, not fuzzy guesses.

Evaluation uses one-to-one maximum matching (duplicates count as false positives),
sample/material/field/condition/basis/status equality, explicit same-dimension unit
conversions and declared numeric tolerance. Missing is distinct from zero and false.
Reports contain micro precision/recall/F1, per-field/per-paper scores and the stricter
fact-plus-exact-evidence score. Alternate valid quotes can lower the latter; review
disagreements. Record model/prompt version, input hashes, latency and tokens alongside
each baseline. Unknown predicted papers and duplicate DOI/split cases are rejected.

Draft/synthetic cases require `--allow-draft` and are prominently labeled QA. Expert
review declarations are required by default but this offline tool cannot authenticate
reviewers. No expert-labelled corpus or real extraction-accuracy percentage is shipped.
