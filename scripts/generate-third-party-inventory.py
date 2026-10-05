#!/usr/bin/env python3
"""Regenerate dependency declarations; this is an inventory, not legal clearance."""
import email
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "docs/third-party"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_url(value):
    if not value:
        return None
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return urlunsplit((parts.scheme, parts.hostname, parts.path, "", ""))


def license_files(base):
    result = []
    if not base.exists():
        return result
    for file in sorted(base.rglob("*")):
        if not file.is_file() or "node_modules" in file.relative_to(base).parts[:-1]:
            continue
        if re.match(r"^(?:licen[cs]e|copying|notice)(?:[._-]|$)", file.name, re.I):
            result.append({"path": file.relative_to(ROOT).as_posix(), "sha256": digest(file)})
    return result


def save(name, document):
    (OUTPUT / name).write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n")


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    root_package = json.loads((ROOT / "package.json").read_text())
    lock = json.loads((ROOT / "package-lock.json").read_text())
    direct = set(root_package["dependencies"])
    development = set(root_package["devDependencies"])
    npm = []
    for path, package in sorted(lock["packages"].items()):
        if not path:
            continue
        name = package.get("name") or path.rsplit("node_modules/", 1)[-1]
        declared = package.get("license")
        files = license_files(ROOT / path)
        npm.append({"name": name, "version": package.get("version"), "installPath": path,
                    "direct": name in direct or name in development, "dev": package.get("dev", False),
                    "optional": package.get("optional", False), "declaredLicense": declared,
                    "source": safe_url(package.get("resolved")), "integrity": package.get("integrity"),
                    "licenseFiles": files,
                    "review": "notice-found-not-legally-cleared" if files else "metadata-only-review-required"})
    save("npm-dependencies.json", {"scope": "lockfile including development and platform-optional packages",
                                  "lockSha256": digest(ROOT / "package-lock.json"), "packages": npm})
    environments = {}
    for name, relative in {
        "development": "python/.venv/lib/python3.12/site-packages",
        "macos-arm64": "runtime/skill-python/macos-arm64/lib/python3.12/site-packages",
        "windows-x64": "runtime/skill-python/windows-x64/Lib/site-packages",
        "linux-x64": "runtime/skill-python/linux-x64/lib/python3.12/site-packages",
    }.items():
        base = ROOT / relative
        entries = []
        for metadata in sorted(base.glob("*.dist-info/METADATA")):
            message = email.message_from_string(metadata.read_text())
            if message["Name"] == "materialsx-m0":
                continue
            declaration = message["License-Expression"] or message["License"]
            classifiers = [x for x in message.get_all("Classifier", []) if x.startswith("License ::")]
            # Legacy License fields sometimes contain the whole text; identify the notice separately.
            entries.append({"name": message["Name"], "version": message["Version"],
                            "declaredLicense": declaration.splitlines()[0].strip() if declaration else None,
                            "licenseExpression": message["License-Expression"], "classifiers": classifiers,
                            "licenseFiles": license_files(metadata.parent),
                            "metadataSha256": digest(metadata), "review": "review-required"})
        environments[name] = {"available": base.exists(), "packages": entries}
    save("python-dependencies.json", {"scope": "local installed snapshots; not a cross-platform wheel certification",
                                     "lockSha256": digest(ROOT / "python/uv.lock"), "environments": environments})
    config = json.loads((ROOT / "skills/kdense-initial.json").read_text())
    skills = []
    for name in sorted(config["skills"]):
        source = ROOT / "vendor/kdense-scientific-agent-skills/skills" / name / "SKILL.md"
        text = source.read_text()
        match = re.search(r"^license:\s*(.+)$", text, re.M)
        skills.append({"name": name, "declaredLicense": match.group(1).strip() if match else None,
                       "skillSha256": digest(source), "review": "skill-declaration-not-dependency-clearance"})
    save("skills-licenses.json", {"source": config["source"], "commit": config["commit"],
                                 "bundleLicense": "MIT", "bundleLicensePath": "vendor/kdense-scientific-agent-skills/LICENSE.md",
                                 "skills": skills,
                                 "customSkills": {"names": ["materials-literature-rpsme-json", "materials-xyz-extraction"],
                                                  "declaredLicense": "AGPL-3.0-only",
                                                  "review": "team-code-authorized-example-data-rights-pending"}})
    print(f"Inventoried {len(npm)} npm entries, {len(skills)} upstream Skills and {len(environments)} Python snapshots.")
    print("Uninstalled platform notices, embedded native libraries and data rights require release review.")


if __name__ == "__main__":
    main()
