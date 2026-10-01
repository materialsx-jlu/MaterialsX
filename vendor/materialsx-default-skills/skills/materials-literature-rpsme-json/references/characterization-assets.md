# Characterization and research assets

Use this reference when a paper contains microscopy, spectra, diffraction, mappings, simulation figures or downloadable research files.

## Evidence layers

Keep four concepts separate:

1. `CharacterizationInstrument`: the reported instrument and a normalization candidate.
2. `InstrumentMention`: the exact source wording, evidence and normalization decision.
3. `CharacterizationEvent`: one technique applied to one specimen/material/state with acquisition and preparation parameters.
4. `MediaArtifact` plus `AssetReference`: the semantic figure/panel and its physical or locator-only asset.

An image is not a measurement. Author-reported morphology belongs in `StructureObservation`; quantitative values belong in `CharacterizationMeasurement` only when explicitly reported or audibly digitized with calibration and uncertainty.

## Origin and availability

Use exactly one origin:

- `native_raw`: author/repository instrument-native file. A PDF image can never receive this label.
- `published_original`: publisher/SI downloadable original figure.
- `pdf_extracted`: embedded PDF raster or page-region crop.
- `derived_thumbnail`: generated preview with `parent_asset_id` and derivation.
- `simulation_input` / `simulation_output`: input or output file, not merely a figure caption.
- `external_reference`: legitimate locator without locally held bytes.

Use `bundled` only when the file will be included in the ZIP and has a verified SHA-256 and byte size. `external` means a resolvable external object, `locator_only` means only document/Figure/Panel positioning is known, and `unavailable` means a known asset cannot be accessed.

## Figure and panel mapping

- Preserve `document_id`, one-based `pdf_page`, Figure, Panel and crop box independently.
- A multipanel Figure should have one panel-level MediaArtifact when claims or specimens differ by panel.
- The same physical file may support multiple MediaArtifacts; reuse its asset ID by SHA-256.
- Do not bundle every PDF bitmap. Logos, page furniture and unrelated panels stay outside the ontology.
- Verify a scale bar visually or from explicit text; do not infer it from image dimensions.
- Record extraction method: embedded object, explicit crop, publisher download or author file.

For a page crop, author a small sidecar in PDF-point coordinates after visually inspecting the rendered page:

```json
{
  "crops": [{
    "pdf_page": 4,
    "figure": "2",
    "panel": "c",
    "media_artifact_id": "MEDIA-...-FIG2C",
    "crop_bbox": {"x0": 72, "y0": 49, "x1": 302, "y1": 332}
  }]
}
```

Use the crop only when no usable embedded object represents the required panel. If a candidate has no `media_artifact_id`, `build_asset_manifest.py` may bind it only by identical SHA-256 or a unique document/Figure/Panel locator. For an otherwise valid candidate, an optional bindings file may map candidate asset ID or SHA-256 to one MediaArtifact ID. Ambiguous candidates remain unmatched.

## Rights

Every asset declares an access level, redistribution flag and basis. PDF-derived media defaults to `private_research`, redistribution false, with the basis stating that it was extracted for evidence review. Unknown rights remain `unknown`; the model must not claim an open licence. The receiving platform owns the effective download permission.
