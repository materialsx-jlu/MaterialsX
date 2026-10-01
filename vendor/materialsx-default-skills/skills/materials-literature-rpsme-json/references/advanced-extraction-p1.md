# P1 capability tools — Skill 1.7.0

Read only the applicable section when a paper needs chart digitization, external
identity lookup, a batch run or a correction-dataset export. P0 final quality gates,
material-identity proposals and optional research opportunities remain unchanged.
All helpers resolve paths from the caller's workspace. Examples are illustrative,
not paper facts. Never fabricate completed calibration or human review records.

## 1. Calibrated chart digitization

First view the actual source image with the host image tool. Identify the panel,
axis types/units, two tick anchors per axis, plot crop, source document/page, legend
and exact sample mapping. Then supply a calibration spec to:

```bash
python3 scripts/digitize_chart.py PANEL.png --spec calibration.json --output digitization.json
```

Spec shape:

```json
{
  "image_sha256": "SHA256-OF-THE-ACTUAL-IMAGE",
  "axis_geometry": "axis_aligned",
  "source": {"document_id": "DOC-MAIN", "pdf_page": 4, "figure": "2", "panel": "b"},
  "plot_bbox": [10, 10, 91, 91],
  "axes": {
    "x": {"label": "time", "unit": "ns", "scale": "linear", "anchors": [
      {"pixel": 10, "value": 0, "pixel_error": 0.5, "value_error": 0},
      {"pixel": 90, "value": 100, "pixel_error": 0.5, "value_error": 0}]},
    "y": {"label": "intensity", "unit": "a.u.", "scale": "log10", "anchors": [
      {"pixel": 90, "value": 1, "pixel_error": 0.5, "value_error": 0},
      {"pixel": 10, "value": 1000, "pixel_error": 0.5, "value_error": 0}]}
  },
  "series": [{"series_id": "CURVE-A", "sample_id": "EXP-A",
    "legend_evidence": "Actual legend/caption establishing this curve's sample",
    "mode": "selected_pixels", "points": [{"x": 50, "y": 50,
      "pixel_error_x": 0.5, "pixel_error_y": 1}]}]
}
```

Pixel coordinates refer to this exact image, origin top-left, y downward; plot_bbox
is [left,top,right,bottom] with exclusive end bounds. `linear` and `log10` axes are
supported, including reversed numeric direction. Other transforms, rotated plots,
broken axes and 3D plots are unsupported. Split distinct axes into separate specs.
Points outside the calibration interval require explicit `allow_extrapolation=true`.

For an isolated colored curve use `mode=color_trace`, `rgb=[255,0,0]`, optional
`color_tolerance=20` (RGB Euclidean distance) and `x_step=1` instead of selected pixels.
Choose the plot crop to exclude legends/borders. Per-column contiguous color pixels
yield a centerline and pixel bound; multiple disjoint matches are skipped and reported.
The helper does not resolve overlapping curves, detect axes/legends or prove that a
matching-color graphic is a data point. Inspect the returned point list against the
source; prefer explicit selected pixels for ambiguous/scatter/monochrome panels.

The output retains image/spec hashes, source/series mapping, raw pixels, calibrated
points and propagated lower/upper bounds from pixel and calibration-anchor errors.
Bounds are not a statistical confidence interval or instrument precision. If the
paper has error bars, explicitly supply point.error_bar_y_pixels=[p0,p1] and the
series.error_bar_meaning from the source; these are stored separately from digitizer
uncertainty. Do not infer SD, SEM, sample count or error-bar meaning.

Only after visual review map points to suitable RPSME measurements/properties with
`value_status=digitized`, the actual caption/legend evidence and a profile.digitization
provenance reference to the saved report/calibration. Do not label extracted image
numbers `reported`, infer fitted TRPL lifetimes without an explicit fit, or convert
the image asset to native_raw. This tool does not modify packages or import results.

## 2. Read-only material identity connectors

```bash
python3 scripts/identity_connectors.py pubchem ethanol --online --output pubchem.json
python3 scripts/identity_connectors.py chebi CHEBI:16236 --online --output chebi.json
python3 scripts/identity_connectors.py materials_project mp-149 --online --output mp.json
python3 scripts/identity_connectors.py csd ACTUAL_REFCODE --online --output csd.json
```

Without `--online` no provider is queried. Public HTTP uses urllib by default;
`--transport curl` is available for host proxy compatibility. Queries are bounded,
endpoints allowlisted, requests read-only and redirects restricted. Raw public
response snapshots, retrieval times, hashes and candidate provenance are preserved.
No bulk registry write, identity approval, cross-paper merge or purchase is performed.

- PubChem: PUG REST name/CID lookup supplies formula, InChIKey and connectivity
  SMILES candidates. Preserve the latter's non-isomeric connectivity semantics.
  CAS-shaped synonyms have checksum checks but remain **unverified synonyms**;
  select CAS only after a primary-source identity check.
- ChEBI: public text search plus compound details, or direct CHEBI ID. Retain
  formula/InChIKey; source SMILES is not relabeled canonical. Multiple hits stay
  separate, including isotopes, salts and hydration differences.
- Materials Project: requires `MP_API_KEY` in the runtime environment and optional
  `mp-api` installed in a suitable isolated environment. Uses the official client
  for a bounded summary query by mp-ID or formula. Neither key nor exception detail
  is written into reports. Missing credentials/dependencies remain explicit. A
  calculated structure is not an experimentally synthesized sample identity.
- CSD: exact refcode lookup through an already installed/licensed local CCDC Python
  API and CSD database. Without it return a restricted/unavailable state. No public
  website scraping, commercial API emulation or redistribution of licensed crystals.

Treat records as enrichment candidates. Check actual paper usage against hydration,
salt, stereochemistry, mixture and phase. Preserve conflicts and unresolved identities.
After source review, use only the allowed identifier types in
material-identity-resolution.md; external IDs belong in ordinary profile notes, not
invented registry material_id fields. Synthesized materials still have an empty
identity_resolution.identifiers array and require DOI/experiment/composition evidence.
The Materials Ontology OS receiver alone assigns canonical internal IDs.

API references checked for this implementation:
[PubChem PUG REST](https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest),
[ChEBI public API](https://www.ebi.ac.uk/chebi/backend/api/docs/),
[Materials Project querying](https://docs.materialsproject.org/downloading-data/using-the-api/querying-data),
[CCDC entry reader](https://downloads.ccdc.cam.ac.uk/documentation/API/descriptive_docs/io.html).

## 3. Paper discovery and durable host-worker scheduling

```bash
python3 scripts/literature_batch.py discover "perovskite luminescence" --limit 20 --output discovery.json
python3 scripts/literature_batch.py scan LOCAL_PAPERS --output pairing-candidates.json
```

Discovery searches Crossref journal metadata, not full text; experimental relevance
still requires review. The scan suggests main/SI groupings by folder/name only.
Neither downloads publisher PDFs, bypasses paywalls nor auto-confirms associations.
Use local files supplied by the user or lawfully acquired separately. Inspect titles,
DOIs and front matter, then create a batch manifest (relative PDF paths resolve from
the manifest's directory):

```json
{
  "budget": {"tokens": 1000000, "cost_microunits": 10000000, "currency": "USD"},
  "max_attempts": 3,
  "papers": [{"paper_id": "ACTUAL-DOI", "main_pdf": "article.pdf",
    "supplementary_pdfs": ["si.pdf"], "research_directions": true,
    "association": {"confirmed": false, "reason": ""},
    "reservation": {"tokens": 100000, "cost_microunits": 1000000}}]
}
```

Set budgets based on the actual selected host/model and user's limits; example
numbers are not prices. One currency unit equals 1,000,000 integer microunits.
Each attempt reserves the configured maximum before execution. Both successful
and failed attempts consume reported usage. The scheduler cannot enforce spending
inside an external worker; workers must honor reservations and stop before limits.

```bash
python3 scripts/literature_batch.py init batch.json --db batch.sqlite
python3 scripts/literature_batch.py status --db batch.sqlite
python3 scripts/literature_batch.py confirm-source --db batch.sqlite --job JOB_ID --actor REVIEWER --reason "Actual title/DOI association check"
python3 scripts/literature_batch.py claim --db batch.sqlite --worker HOST_WORKER --lease-seconds 900
python3 scripts/literature_batch.py renew --db batch.sqlite --job JOB_ID --lease LEASE_TOKEN --lease-seconds 900
python3 scripts/literature_batch.py finish --db batch.sqlite --job JOB_ID --lease LEASE_TOKEN --receipt receipt.json
```

`claim` atomically leases one job to the current host worker. Follow this Skill for
that single main/SI set, requested directions and P0 validation; renew while actively
working. Claiming is not model execution: no background LLM process or shell command
is launched. Additional workers need user-authorized host sessions; the queue does
not authorize spawning agents. Do not start an unbounded corpus run merely because
the user asked to implement this scheduler.

Receipt fields:

```json
{
  "outcome": "succeeded",
  "package": "/ABSOLUTE/PATH/final.rpsme.v2.json",
  "package_sha256": "EXACT-FINAL-FILE-HASH",
  "documents": "/ABSOLUTE/PATH/document-set.manifest.json",
  "quality_review": "/ABSOLUTE/PATH/completed-review.json",
  "usage": {"tokens": 12345, "cost_microunits": 100000, "currency": "USD",
    "basis": "provider_report"}
}
```

Use absolute receipt artifact paths. Include `bundle` for asset-bearing packages.
Successful completion re-runs P0/coverage validation, checks claimed source/DOI and
requested directions, and validates bundle/companion integrity. It never trusts a
standalone `valid=true` flag. Upload remains a separate explicitly authorized action.

Other outcomes: `retryable`, `failed`, `unknown`. Known outcomes require usage with
a truthful basis (provider_report, local_meter, declared_estimate or no_billable_call);
unknown cost is not zero. Retryable failures wait with bounded exponential backoff
and respect maximum attempts/remaining budgets. Worker interruptions and expired
leases retain reservations in needs_reconciliation; never retry blindly. Supply
an actual reconciled receipt and reconciliation_reason to release them. Identical
receipts within one lease are idempotent; new attempts account usage separately.
Overruns record actual supplied usage and block new dispatch. Budget changes/queue
migration after an overrun require explicit planning, not silent counter resets.
This local queue is separate from the product PostgreSQL database and is not a
deployed autonomous crawler or Temporal worker.

## 4. Human corrections to versioned training examples

```bash
python3 scripts/review_dataset.py record --before original.json --after corrected.json --review correction-review.json --documents document-set.manifest.json --ledger corrections.sqlite
python3 scripts/review_dataset.py export --ledger corrections.sqlite --output-dir DATASET_NEW_VERSION
```

Review shape: before_sha256 and after_sha256 are canonical JSON hashes produced by
quality_review.digest (not byte hashes); status is proposed/accepted/rejected;
reviewer has kind=human|model, name and reviewed_at; adjudicator has the same fields.
For export, reviewer and adjudicator must be distinct named humans, status accepted,
synthetic false, and licence={training_allowed:true,basis:"Actual rights basis"}.
Offline declarations cannot authenticate these identities: never invent reviewers,
human acceptance or rights. Model self-review is proposed data, not expert labels.

Each changes entry has id (optional), pointer (whole-package JSON Pointer), task,
error_type, reason and evidence={document_id,pdf_page,quote}. Evidence must actually
relocate in prepared source text. Task is material_entity, table, sample_relation
or structured_field. Error types are material_identity, ingredient_amount,
process_step, condition, performance, sample_link, evidence_locator, table_structure,
omission, hallucination and no_error. Missing versus null is retained. The tool reads
before/after field values rather than trusting the reviewer-supplied replacement.

Corrections are append-only and idempotent. Use a new ID plus supersedes=OLD_ID to
revise an event; old audit records remain. Conflicting current annotations are excluded.
Accepted rights withdrawal can supersede prior training permission. Store source
hashes and both package snapshots separately; raw-source review never executes content.

Export creates new train/dev/test JSONL and dataset-report.json. Whole DOI groups,
shared source hashes and exact repeated source spans stay in one connected split
group. Default deterministic split is 75/15/10 by group hash; small datasets may
have empty splits, which blocks training readiness. Check class balance, valid
negative examples and harder leakage (near-duplicates/overlapping spans) manually.
Synthetic fixtures, model-only review, unauthorised content and unresolved conflicts
are excluded. Dataset hashes and error histograms support reproducible comparisons.

These are field/task-conditioned supervised examples, not a pretrained materials
model or automatically expert-labelled benchmark. Actual fine-tuning needs adequate
real annotations, a user-selected model, compute budget and independent held-out
evaluation. P1 does not start training, buy compute or upload a dataset. Use the P0
evaluator on held-out papers before claiming a specialist model improves extraction.
