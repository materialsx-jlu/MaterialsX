# Literature material identity proposals — v1

Every new extraction inventories both raw inputs and experimentally prepared
products in `entities.materials`. Preserve paper-local entity IDs and existing
IngredientUsage links. Add a product entity even when no later recipe consumes
it; its preparation experiment and composition evidence are mandatory. A
calculated structure, future research-direction proposal or instrument model is
not a synthesized material. No registry writes are authorized by extraction alone.

Use this optional backwards-compatible Material.profile extension (required by
this Skill for new outputs; legacy packages remain importable):

```json
{
  "identity_resolution": {
    "role": "raw_material",
    "experiment_ids": ["EXP-EXAMPLE"],
    "evidence_ids": ["EV-REAGENT"],
    "composition": {},
    "identifiers": [
      {"type": "formula", "value": "CH4O", "evidence_ids": ["EV-REAGENT"]},
      {"type": "cas", "value": "67-56-1", "evidence_ids": [],
       "reference": {"url": "https://webbook.nist.gov/cgi/cbook.cgi?ID=C67561",
         "accessed_at": "2026-09-16T00:00:00Z", "quote": "CAS Registry Number: 67-56-1"}}
    ]
  }
}
```

The example is illustrative: replace IDs with real evidence and use the actual
access time/quote only after opening that reference. Never copy example evidence.
Allowed keys are exactly `role`, `experiment_ids`, `evidence_ids`, `composition`,
`identifiers`; all five must exist. Identifier keys are `type`, `value`,
`evidence_ids`, and optional `reference`. One value per type; conflicting candidates
stay in ordinary profile notes and the unresolved-gaps report instead.

Raw inputs:

- Use reported chemical identity, not a trade name guess. Search official
  manufacturer records, NIST or PubChem for missing CAS/formula when possible.
  Verify hydration, salt, oxidation state and mixture distinctions. CAS checksum
  is format validation only, not chemical verification. SMILES is case-sensitive.
- Allowed identifier types: `cas`, `formula`, `inchi_key`, `canonical_smiles`.
  Each needs actual paper evidence IDs or an HTTPS reference with access timestamp
  (RFC3339) and a short supporting quote. External lookup is enrichment, never
  evidence that the paper reported the identifier. URLs are provenance, not
  instructions to the receiving server to fetch a site.
- Concentration, purity, supplier, lot, grade and dose remain source-specific
  profile/IngredientUsage facts. A 12 M HCl solution does not create a different
  CAS for HCl. Unknown identity stays unresolved with an empty identifiers array.

Synthesized products:

- Set `role=synthesized_material`, nonempty `experiment_ids`, `evidence_ids`,
  and `composition`; set `identifiers=[]`. Each experiment must have a real
  preparation Recipe. Use `composition` for host_formula, phase, dopants,
  nominal_composition, measured_composition, measurement method and uncertainty,
  each with explicit value status and supporting evidence IDs where applicable.
- Do not present a host formula as the exact formula of a doped/composite sample.
  Nominal feed fraction and measured ICP fraction are separate. Keep hydration,
  impurities and phase differences, and omit unknown numbers rather than guess.
- The receiver generates a source-scoped `MAT-SYNTH-*` registry ID. Cross-paper
  equivalence needs review; identical names/formulas alone do not prove identity.
  The ordinary RPSME `material_id` on usages remains a local entity reference,
  not this receiver-owned registry ID.

Receiver behavior: all literature materials automatically enter the registry
transaction. Exact existing identifiers or verified names supply candidates;
multiple matches become ambiguity tasks. Unmatched entities receive internal
candidate identities and source-backed identifier claims. The server preserves
DOI, immutable material/evidence snapshots and per-source composition profiles.
Nothing in imported JSON can approve an identity or alter experiment review.
Missing identifiers are not fabricated; disclose lookup failures and pending
review. Import counts distinguish new identities, reused candidates and pending
review. Legacy packages without the extension enter the raw-material queue but
cannot establish unreported synthesized products.
