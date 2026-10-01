"""Deterministic and non-executing validation for RPSME Bundle 1.0.

The validator reads archive members as data, verifies the manifest and hashes,
and never extracts or executes uploaded content.
"""

from __future__ import annotations

import hashlib
import json
import posixpath
import re
import stat
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO

from .validator import ValidationIssue, ValidationReport, validate_package
from .vocabulary import BUNDLE_VERSION


@dataclass(frozen=True)
class BundleLimits:
    max_archive_bytes: int = 2 * 1024**3
    max_uncompressed_bytes: int = 10 * 1024**3
    max_file_count: int = 10_000
    max_single_file_bytes: int = 4 * 1024**3
    max_compression_ratio: float = 200.0
    max_manifest_bytes: int = 10 * 1024**2
    max_ontology_bytes: int = 100 * 1024**2


DEFAULT_BUNDLE_LIMITS = BundleLimits()


def _issue(severity: str, code: str, path: str, message: str) -> ValidationIssue:
    return ValidationIssue(severity, code, path, message)


def _safe_relative_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or "\x00" in value or "\\" in value or re.match(r"^[A-Za-z]:", value):
        return False
    candidate = PurePosixPath(value)
    if candidate.is_absolute() or any(part in {"", ".", ".."} for part in candidate.parts):
        return False
    return posixpath.normpath(value) == value and not value.startswith("/")


def _sha256_stream(handle: BinaryIO) -> str:
    digest = hashlib.sha256()
    while chunk := handle.read(1024 * 1024):
        digest.update(chunk)
    return digest.hexdigest()


def _jsonschema_issues(value: dict[str, Any], schema_path: Path, prefix: str) -> list[ValidationIssue]:
    try:
        import jsonschema  # type: ignore
    except ImportError:
        return []
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())
    result: list[ValidationIssue] = []
    for error in sorted(validator.iter_errors(value), key=lambda item: list(item.absolute_path)):
        suffix = "".join(f"[{part}]" if isinstance(part, int) else f".{part}" for part in error.absolute_path)
        result.append(_issue("error", "BUNDLE_SCHEMA", f"{prefix}{suffix}", error.message))
    return result


def validate_bundle_manifest(
    manifest: dict[str, Any], schema_path: str | Path | None = None,
) -> ValidationReport:
    issues: list[ValidationIssue] = []
    if schema_path:
        issues.extend(_jsonschema_issues(manifest, Path(schema_path), "$"))
    if manifest.get("bundle_version") != BUNDLE_VERSION:
        issues.append(_issue("error", "BUNDLE_VERSION", "$.bundle_version", f"expected {BUNDLE_VERSION}"))

    files = manifest.get("files") if isinstance(manifest.get("files"), list) else []
    paths: set[str] = set()
    asset_ids: set[str] = set()
    for index, row in enumerate(files):
        path = f"$.files[{index}]"
        if not isinstance(row, dict):
            issues.append(_issue("error", "BUNDLE_FILE", path, "file entry must be an object"))
            continue
        relative = row.get("relative_path")
        if not _safe_relative_path(relative):
            issues.append(_issue("error", "UNSAFE_PATH", f"{path}.relative_path", "path must be a normalized POSIX relative path without dot segments"))
        elif relative in paths:
            issues.append(_issue("error", "DUPLICATE_PATH", f"{path}.relative_path", f"duplicate path {relative!r}"))
        else:
            paths.add(relative)
        checksum = row.get("sha256")
        if not isinstance(checksum, str) or len(checksum) != 64 or any(char not in "0123456789abcdef" for char in checksum):
            issues.append(_issue("error", "INVALID_HASH", f"{path}.sha256", "sha256 must contain 64 lowercase hexadecimal characters"))
        asset_id = row.get("asset_id")
        if row.get("role") not in {"ontology", "validation"}:
            if not isinstance(asset_id, str) or not asset_id:
                issues.append(_issue("error", "ASSET_ID", f"{path}.asset_id", "non-ontology file requires asset_id"))
            elif asset_id in asset_ids:
                issues.append(_issue("error", "DUPLICATE_ASSET", f"{path}.asset_id", "one bundle manifest may contain one physical file per asset id"))
            else:
                asset_ids.add(asset_id)

    ontology_path = manifest.get("ontology_path")
    ontology_rows = [row for row in files if isinstance(row, dict) and row.get("role") == "ontology"]
    if len(ontology_rows) != 1:
        issues.append(_issue("error", "ONTOLOGY_FILE", "$.files", "manifest requires exactly one ontology file"))
    elif ontology_rows[0].get("relative_path") != ontology_path:
        issues.append(_issue("error", "ONTOLOGY_FILE", "$.ontology_path", "ontology_path must identify the ontology file entry"))
    if ontology_rows and ontology_rows[0].get("sha256") != manifest.get("ontology_sha256"):
        issues.append(_issue("error", "ONTOLOGY_HASH", "$.ontology_sha256", "ontology_sha256 must equal the ontology file hash"))
    return ValidationReport(issues)


def validate_bundle(
    archive_path: str | Path,
    *,
    manifest_schema_path: str | Path,
    package_schema_path: str | Path,
    limits: BundleLimits = DEFAULT_BUNDLE_LIMITS,
) -> ValidationReport:
    """Validate a bundle without extracting it or executing any member."""

    archive = Path(archive_path)
    issues: list[ValidationIssue] = []
    if archive.stat().st_size > limits.max_archive_bytes:
        issues.append(_issue("error", "ARCHIVE_SIZE", "$", "compressed archive exceeds configured size limit"))
        return ValidationReport(issues)
    try:
        bundle = zipfile.ZipFile(archive)
    except (OSError, zipfile.BadZipFile) as error:
        return ValidationReport([_issue("error", "INVALID_ARCHIVE", "$", str(error))])

    with bundle:
        members = [item for item in bundle.infolist() if not item.is_dir()]
        if len(members) > limits.max_file_count:
            issues.append(_issue("error", "FILE_COUNT", "$", "bundle contains too many files"))
        total_uncompressed = sum(item.file_size for item in members)
        if total_uncompressed > limits.max_uncompressed_bytes:
            issues.append(_issue("error", "UNCOMPRESSED_SIZE", "$", "bundle exceeds configured uncompressed size limit"))
        normalized_names: set[str] = set()
        for index, item in enumerate(members):
            member_path = f"$archive[{index}]"
            if not _safe_relative_path(item.filename):
                issues.append(_issue("error", "UNSAFE_PATH", member_path, f"unsafe archive path {item.filename!r}"))
            normalized = posixpath.normcase(posixpath.normpath(item.filename))
            if normalized in normalized_names:
                issues.append(_issue("error", "DUPLICATE_PATH", member_path, f"duplicate normalized archive path {item.filename!r}"))
            normalized_names.add(normalized)
            mode = item.external_attr >> 16
            if stat.S_ISLNK(mode):
                issues.append(_issue("error", "SYMLINK", member_path, "symbolic links are forbidden"))
            if item.file_size > limits.max_single_file_bytes:
                issues.append(_issue("error", "SINGLE_FILE_SIZE", member_path, f"{item.filename!r} exceeds the per-file limit"))
            ratio = item.file_size / max(item.compress_size, 1)
            if ratio > limits.max_compression_ratio:
                issues.append(_issue("error", "COMPRESSION_RATIO", member_path, f"{item.filename!r} exceeds the compression-ratio limit"))

        names = {item.filename for item in members}
        if "manifest.json" not in names:
            issues.append(_issue("error", "MISSING_MANIFEST", "$", "manifest.json is required at the archive root"))
            return ValidationReport(issues)
        manifest_info = bundle.getinfo("manifest.json")
        if manifest_info.file_size > limits.max_manifest_bytes:
            issues.append(_issue("error", "MANIFEST_SIZE", "$.manifest", "manifest exceeds configured size limit"))
            return ValidationReport(issues)
        try:
            manifest = json.loads(bundle.read("manifest.json"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            issues.append(_issue("error", "INVALID_MANIFEST", "$.manifest", str(error)))
            return ValidationReport(issues)
        if not isinstance(manifest, dict):
            issues.append(_issue("error", "INVALID_MANIFEST", "$.manifest", "manifest must be a JSON object"))
            return ValidationReport(issues)
        issues.extend(validate_bundle_manifest(manifest, manifest_schema_path).issues)

        rows = [row for row in manifest.get("files", []) if isinstance(row, dict)]
        manifest_paths = {str(row.get("relative_path")) for row in rows}
        archive_paths = names - {"manifest.json"}
        for missing in sorted(manifest_paths - archive_paths):
            issues.append(_issue("error", "MISSING_FILE", "$.files", f"manifested file is missing: {missing}"))
        for extra in sorted(archive_paths - manifest_paths):
            issues.append(_issue("error", "UNMANIFESTED_FILE", "$archive", f"archive contains unmanifested file: {extra}"))

        for index, row in enumerate(rows):
            relative = row.get("relative_path")
            if relative not in archive_paths:
                continue
            info = bundle.getinfo(relative)
            if info.file_size != row.get("byte_size"):
                issues.append(_issue("error", "FILE_SIZE_MISMATCH", f"$.files[{index}].byte_size", f"size differs for {relative}"))
            with bundle.open(info) as handle:
                checksum = _sha256_stream(handle)
            if checksum != row.get("sha256"):
                issues.append(_issue("error", "HASH_MISMATCH", f"$.files[{index}].sha256", f"hash differs for {relative}"))

        ontology_path = manifest.get("ontology_path")
        if ontology_path in archive_paths:
            ontology_info = bundle.getinfo(ontology_path)
            if ontology_info.file_size > limits.max_ontology_bytes:
                issues.append(_issue("error", "ONTOLOGY_SIZE", "$.ontology_path", "ontology JSON exceeds configured size limit"))
            else:
                try:
                    package = json.loads(bundle.read(ontology_path))
                except (UnicodeDecodeError, json.JSONDecodeError) as error:
                    issues.append(_issue("error", "INVALID_ONTOLOGY", "$.ontology_path", str(error)))
                else:
                    if not isinstance(package, dict):
                        issues.append(_issue("error", "INVALID_ONTOLOGY", "$.ontology_path", "ontology payload must be an object"))
                    else:
                        package_report = validate_package(package, package_schema_path)
                        issues.extend(package_report.issues)
                        embedded = package.get("asset_manifest", {}).get("assets", []) if isinstance(package.get("asset_manifest"), dict) else []
                        embedded_by_id = {row.get("asset_id"): row for row in embedded if isinstance(row, dict)}
                        for index, row in enumerate(rows):
                            asset_id = row.get("asset_id")
                            if not asset_id:
                                continue
                            candidate = embedded_by_id.get(asset_id)
                            if candidate is None:
                                issues.append(_issue("error", "ASSET_NOT_DECLARED", f"$.files[{index}].asset_id", "bundle asset is absent from ontology asset_manifest"))
                            elif candidate.get("sha256") != row.get("sha256") or candidate.get("byte_size") != row.get("byte_size"):
                                issues.append(_issue("error", "ASSET_METADATA_MISMATCH", f"$.files[{index}]", "bundle and ontology asset metadata differ"))
    return ValidationReport(issues)
