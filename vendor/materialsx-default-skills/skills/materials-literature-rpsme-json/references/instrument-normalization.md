# Instrument normalization

Use this reference after extracting source-faithful instrument mentions.

## Identity boundary

`InstrumentModel` means a global manufacturer/model identity, not a laboratory instrument instance. Institution, serial number or asset tag is required before asserting an instance.

For every reported mention preserve:

- `raw_text`, `manufacturer_raw`, `model_raw`;
- technique code and same-context evidence;
- `normalization_status`, confidence and optional candidate.

## Status rules

- `resolved`: both manufacturer and model are explicit and the normalization is mechanically unambiguous.
- `candidate`: a plausible normalization exists but manufacturer/model parsing, aliasing or OCR needs review.
- `unresolved_model`: only the technique or manufacturer is known.
- `conflict`: source passages disagree or OCR creates incompatible candidates.
- `not_applicable`: the method does not use a named instrument model.

Never use `SEM`, `TEM`, `XRD` or another technique name as a model. Never merge instruments merely because their technique is the same.

## Canonicalization

Normalize Unicode width, repeated whitespace and dash variants. Preserve meaningful model punctuation. Use a conservative manufacturer alias table only for well-known spelling variants; do not guess a manufacturer from a model prefix. Canonical key is `manufacturer.casefold()::model.casefold()` after whitespace normalization.

OCR replacement characters, question marks inside model tokens, incomplete suffixes and two manufacturers in one phrase require candidate/conflict status. The deterministic normalizer may lower a status but must not invent missing source tokens.

Connect an event to the mention with `USES_INSTRUMENT`. When resolved, connect mention to the experiment-scoped CharacterizationInstrument candidate with `RESOLVES_TO`. Global catalogue creation is receiver-owned.

