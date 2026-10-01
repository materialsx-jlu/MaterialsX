# Opportunity discovery v7: decision speed and publishable contribution

Use prompt_version=rpsme-literature-v7-opportunity-discovery for new research-opportunity outputs. Keep Ontology 1.4 and all source extraction contracts.

The goal is to identify a valuable, testable new scientific opportunity quickly. Allocate effort to causal interpretation and differentiation, not a longer paper summary. Keep the validation/extension/platform archetypes, but make them answer different scientific uncertainties.

## Scientific depth
For each card, add opportunity_assessment with bilingual fields:
- bottleneck: the specific unresolved limitation, citing source evidence.
- causal_hypothesis: a mechanism predicting a measurable direction under an explicit intervention.
- alternative_explanation: at least one competing cause; say which observation separates it.
- differentiation: compare the closest related works by system, method, mechanism and outcome. A higher number or a new filler alone is not a new design principle.
- decisive_experiment: the cheapest experiment that distinguishes the hypotheses; define control groups, confounders, independent batches, readout and decision.
- go_no_go: thresholds and uncertainty treatment; proposed numeric targets must be labeled proposed, not source facts. If thresholds lack an application basis, first calibrate them.
- fastest_action: a 7-day deliverable with resources, estimated time/cost assumptions and what a negative result teaches.
- expected_contribution: conditional publishable claim if validated (causal mechanism, design boundary, generalizable rule, measurement method or device insight).
- resource_fit: equipment/access/dependencies, why this is tractable, and what blocks it.
- evidence_ids: nonempty IDs in this source package supporting the bottleneck.

Use an external related-literature search for each genuinely different novelty claim. Store queries, ISO timestamps and 3–5 closest verified papers when available; explain what overlaps and what remains distinct. Never manufacture citations or treat no search hits as proof of novelty. If search fails, retain preliminary and record the gap. Rank by information gained per unit time, feasibility and scientific contribution, not fashionable journal names. Prefer a narrow falsifiable question over broad 'improve performance' proposals.

For BN/epoxy, distinguish surface chemistry from altered cure, porosity, platelet orientation and filler volume fraction. Examples of research questions (not new findings): causal identification of thermal-boundary changes; a falsifiable optimum in grafting density versus filler-contact resistance; a transferable failure boundary linking geometry, thermal cycling and electrical retention. Generic 'use SEM/XPS/DFT' is insufficient without the competing explanations and measured discriminant.

## Top three journal recommendations
Keep publication_target.level/rationale/evidence_gaps for compatibility. Add journals: exactly three distinct objects ordered by rank 1,2,3. Select journals for THIS opportunity, not the source paper's venue. Rank by scope fit and attainable contribution. Do not force a high-impact outlet onto routine replication.
Each object:
- rank (1–3), name (actual journal name)
- positioning: primary | stretch | fallback
- readiness: ready | needs_validation | out_of_scope
- fit_reason: bilingual, tied to mechanism/application and journal scope
- required_evidence: bilingual, the concrete missing results needed before submission
- desk_rejection_risk: bilingual, e.g. incremental advance, weak causality, missing transferability
- scope_url: HTTPS official publisher scope or author-guideline URL
- verification_status: verified | unverified
- checked_at: ISO-8601 timestamp only for actually verified scope.

Browse official publisher scope/author pages and relevant recent papers before recommending. If inaccessible, mark unverified; do not claim verified based on a guessed URL. These are conditional submission targets, never acceptance guarantees or calibrated acceptance probabilities. Do not invent impact factors, JCR/CAS quartiles, charges or turnaround times. Report them only if directly verified with year/category and source.

## Import policy in this user's Materials Ontology OS
The user authorized automatic research-opportunity imports to publish without a human approval step. After validating the complete source package plus v7 cards, POST the package using the configured administrator bearer token to /api/admin/papers/{sourceId}/generate-research-directions?publication=automatic. The source must already be imported and its identifier must match. Read back the returned status and three published direction IDs. This endpoint is a receiver, not an LLM generation API.
The server stores and publishes the three-card set in one transaction, marks publication_mode=automatic and retains audit/version records. Do not set expert_reviewed or forge reviewer timestamps. Authentication and structural/evidence checks still apply. Use publication=manual only when a draft is explicitly wanted; ordinary extraction alone still does not authorize upload. Existing source-experiment review workflows are separate from these opportunity cards.

