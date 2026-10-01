#!/usr/bin/env python3
"""Bind extracted files to semantic media nodes and build Ontology 1.3 assets."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any

from rpsme_ontology_v2.adapter_v13 import upgrade_package_to_v13


DEFAULT_RIGHTS = {
    "access_level": "private_research",
    "redistribution_allowed": False,
    "rights_basis": "user-supplied PDF extraction; redistribution not established",
    "license": None,
    "notes": "Receiver must apply its own access policy.",
}


def edge_id(kind: str, subject: str, object_: str) -> str:
    digest = hashlib.sha256(f"{kind}|{subject}|{object_}".encode()).hexdigest()[:20].upper()
    return f"EDGE-{digest}"


def locator_key(value: Any) -> tuple[str, str, str]:
    row = value if isinstance(value, dict) else {}
    return (str(row.get("document_id") or ""), str(row.get("figure") or "").casefold(), str(row.get("panel") or "").casefold())


def load_bindings(path: Path | None) -> dict[str, str]:
    if not path:
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    rows = value.get("bindings", value) if isinstance(value, dict) else value
    result: dict[str, str] = {}
    if isinstance(rows, dict):
        return {str(key): str(item) for key, item in rows.items()}
    if isinstance(rows, list):
        for row in rows:
            if isinstance(row, dict) and row.get("media_artifact_id"):
                for key in (row.get("candidate_asset_id"), row.get("sha256")):
                    if key:
                        result[str(key)] = str(row["media_artifact_id"])
    return result


def bind_assets(
    package: dict[str, Any], manifests: list[tuple[Path, dict[str, Any]]], bindings: dict[str, str]
) -> tuple[dict[str, Any], dict[str, str], dict[str, Any]]:
    result = upgrade_package_to_v13(package)
    entities = result["entities"]
    media = {str(row.get("id")): row for row in entities.get("media_artifacts", []) if isinstance(row, dict) and row.get("id")}
    media_by_sha = {str(row.get("sha256")): row for row in media.values() if row.get("sha256")}
    media_by_locator: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for row in media.values():
        key = locator_key(row.get("source_locator"))
        if key[1] or key[2]:
            media_by_locator.setdefault(key, []).append(row)
    assets = {str(row.get("asset_id")): row for row in result["asset_manifest"]["assets"] if isinstance(row, dict)}
    refs = {str(row.get("id")): row for row in entities.get("asset_references", []) if isinstance(row, dict)}
    relations = result.setdefault("relations", [])
    source_map: dict[str, str] = {}
    matched: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []

    for manifest_path, manifest in manifests:
        for candidate in manifest.get("assets", []):
            if not isinstance(candidate, dict):
                continue
            target_id = candidate.get("media_artifact_id") or bindings.get(str(candidate.get("asset_id"))) or bindings.get(str(candidate.get("sha256")))
            target = media.get(str(target_id)) if target_id else media_by_sha.get(str(candidate.get("sha256")))
            candidate_locators = candidate.get("source_locators") or [{
                "document_id": candidate.get("document_id"),
                "pdf_page": candidate.get("pdf_page"),
                "xref": candidate.get("xref"),
                "placements": candidate.get("placements") or [],
                "figure": candidate.get("figure"),
                "panel": candidate.get("panel"),
            }]
            if target is None:
                locators = candidate_locators
                for locator in locators:
                    choices = media_by_locator.get(locator_key(locator), [])
                    if len(choices) == 1:
                        target = choices[0]
                        break
            if target is None:
                unmatched.append({"candidate_asset_id": candidate.get("asset_id"), "sha256": candidate.get("sha256")})
                continue
            previous_asset_id = target.get("asset_id")
            asset_id = str(previous_asset_id or candidate["asset_id"])
            ext = Path(str(candidate["filename"])).suffix.lower() or ".bin"
            source_path = (manifest_path.parent / str(candidate["filename"])).resolve()
            extraction_locator = copy.deepcopy(candidate_locators[0])
            locator = copy.deepcopy(extraction_locator)
            locator.update({key: value for key, value in (target.get("source_locator") or {}).items() if value is not None})
            role = "published_panel" if locator.get("panel") else "published_figure"
            relative_path = f"assets/{'panels' if role == 'published_panel' else 'published'}/{candidate['sha256']}{ext}"
            payload_size = candidate.get("byte_size")
            if not isinstance(payload_size, int):
                payload_size = source_path.stat().st_size
            media_type = str(candidate.get("media_type") or "application/octet-stream")
            if "/" not in media_type:
                media_type = {"jpeg": "image/jpeg", "jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(media_type, "application/octet-stream")
            descriptor = {
                "asset_id": asset_id,
                "relative_path": relative_path,
                "sha256": candidate["sha256"],
                "byte_size": payload_size,
                "media_type": media_type,
                "origin_type": "pdf_extracted",
                "availability_status": "bundled",
                "source_document_id": candidate.get("document_id"),
                "parent_asset_id": None,
                "source_locator": locator,
                "derivation": {"method": candidate.get("capture_method"), "source_pdf": manifest.get("source_pdf"), "extraction_locator": extraction_locator},
                "rights": copy.deepcopy(DEFAULT_RIGHTS),
                "profile": {"pixel_width": candidate.get("pixel_width"), "pixel_height": candidate.get("pixel_height")},
            }
            assets[asset_id] = descriptor
            source_map[relative_path] = str(source_path)
            target_updates = {
                "asset_id": asset_id,
                "sha256": candidate["sha256"],
                "media_type": media_type,
                "origin_type": "pdf_extracted",
                "availability_status": "bundled",
                "storage_uri": None,
                "source_locator": locator,
            }
            if locator.get("crop_bbox"):
                target_updates["crop_bbox"] = locator["crop_bbox"]
            else:
                target.pop("crop_bbox", None)
            target.update(target_updates)
            for peer in media.values():
                if peer is not target and (peer.get("sha256") == candidate["sha256"] or peer.get("asset_id") == asset_id):
                    peer.update({
                        "asset_id": asset_id,
                        "sha256": candidate["sha256"],
                        "media_type": media_type,
                        "origin_type": "pdf_extracted",
                        "availability_status": "bundled",
                        "storage_uri": None,
                    })
                    if not peer.get("crop_bbox"):
                        peer.pop("crop_bbox", None)
            for peer_ref in refs.values():
                if peer_ref.get("asset_id") in {previous_asset_id, asset_id}:
                    peer_ref.update({"asset_id": asset_id, "origin_type": "pdf_extracted", "availability_status": "bundled"})
            linked = None
            for relation in relations:
                if relation.get("type") == "HAS_ASSET" and relation.get("subject", {}).get("id") == target.get("id"):
                    linked = refs.get(str(relation.get("object", {}).get("id")))
                    if linked:
                        break
            if linked is None:
                ref_id = f"AR-{str(target['id'])}"
                linked = {
                    "id": ref_id,
                    "experiment_id": target.get("experiment_id"),
                    "version": 1,
                    "asset_id": asset_id,
                    "asset_role": role,
                    "origin_type": "pdf_extracted",
                    "availability_status": "bundled",
                    "source_locator": locator,
                    "value_status": target.get("value_status") or "reported",
                    "evidence_ids": list(target.get("evidence_ids") or []),
                    "profile": {},
                }
                entities["asset_references"].append(linked)
                refs[ref_id] = linked
                relations.append({
                    "id": edge_id("HAS_ASSET", str(target["id"]), ref_id),
                    "type": "HAS_ASSET",
                    "subject": {"type": "media_artifact", "id": target["id"]},
                    "object": {"type": "asset_reference", "id": ref_id},
                    "value_status": target.get("value_status") or "reported",
                    "evidence_ids": list(target.get("evidence_ids") or []),
                    "profile": {},
                })
            else:
                linked.update({"asset_id": asset_id, "asset_role": role, "origin_type": "pdf_extracted", "availability_status": "bundled", "source_locator": locator})

            thumb = candidate.get("thumbnail")
            if isinstance(thumb, dict):
                thumb_id = str(thumb["asset_id"])
                thumb_path = f"assets/thumbnails/{thumb['sha256']}.webp"
                assets[thumb_id] = {
                    "asset_id": thumb_id,
                    "relative_path": thumb_path,
                    "sha256": thumb["sha256"],
                    "byte_size": thumb["byte_size"],
                    "media_type": thumb["media_type"],
                    "origin_type": "derived_thumbnail",
                    "availability_status": "bundled",
                    "source_document_id": candidate.get("document_id"),
                    "parent_asset_id": asset_id,
                    "source_locator": locator,
                    "derivation": copy.deepcopy(thumb.get("derivation") or {}),
                    "rights": copy.deepcopy(DEFAULT_RIGHTS),
                    "profile": {},
                }
                source_map[thumb_path] = str((manifest_path.parent / str(thumb["filename"])).resolve())
            matched.append({"media_artifact_id": target.get("id"), "asset_id": asset_id, "relative_path": relative_path})

    result["asset_manifest"]["assets"] = sorted(assets.values(), key=lambda row: str(row.get("asset_id")))
    result["bundle"] = {
        "bundle_version": "rpsme-bundle-1.0",
        "delivery_mode": "bundle" if matched else "json_only",
        "manifest_path": "manifest.json" if matched else None,
        "profile": {"bound_asset_count": len(matched)},
    }
    report = {"valid": True, "matched": matched, "unmatched": unmatched, "delivery_mode": result["bundle"]["delivery_mode"]}
    return result, source_map, report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("--media-manifest", type=Path, action="append", default=[])
    parser.add_argument("--bindings", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sources-output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.package.resolve() == args.output.resolve():
        parser.error("--output must not overwrite the input package")
    package = json.loads(args.package.read_text(encoding="utf-8"))
    manifests = [(path.resolve(), json.loads(path.read_text(encoding="utf-8"))) for path in args.media_manifest]
    updated, sources, report = bind_assets(package, manifests, load_bindings(args.bindings))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(updated, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    args.sources_output.parent.mkdir(parents=True, exist_ok=True)
    args.sources_output.write_text(json.dumps({"files": sources}, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({**report, "output": str(args.output), "sources": str(args.sources_output)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
