#!/usr/bin/env python3
"""Check prospective public text and staged blobs without printing credentials.

No history/network scan is performed. Binary assets still need manual review.
"""
import argparse
import os
from pathlib import Path
import re
import subprocess
import tempfile


def git(root, *args, check=True, data=None):
    return subprocess.run(["git", "-C", str(root), *args], input=data,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check)


def public_paths(root, repository):
    if repository:
        raw = git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard").stdout
        return sorted(set(os.fsdecode(x) for x in raw.split(b"\0") if x))
    # Honour the real ignore rules before the project has been git-initialized.
    candidates = []
    excluded = {".git", "node_modules", "dist", "runtime", ".venv", "__pycache__",
                ".pytest_cache", "materials-output", "uploads", "outputs", ".cache"}
    for directory, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in excluded]
        candidates.extend((Path(directory) / f).relative_to(root).as_posix() for f in files)
    with tempfile.TemporaryDirectory(prefix="materialsx-ignore-") as tmp:
        temporary = Path(tmp)
        git(temporary, "init", "-q")
        ignore = root / ".gitignore"
        if ignore.exists():
            (temporary / ".gitignore").write_bytes(ignore.read_bytes())
        raw = b"\0".join(os.fsencode(p) for p in candidates) + b"\0"
        result = git(temporary, "check-ignore", "--no-index", "-z", "--stdin", check=False, data=raw)
        if result.returncode not in (0, 1):
            raise RuntimeError("Cannot evaluate ignore rules")
        ignored = {os.fsdecode(x) for x in result.stdout.split(b"\0") if x}
    return sorted(set(candidates) - ignored)


PATTERNS = {
    "api-key-shaped-token": re.compile(rb"\bsk-[A-Za-z0-9_-]{24,}"),
    "github-token": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})"),
    "private-key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----"),
    "aws-access-key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
}


def forbidden(path):
    name = Path(path).name
    return ((name == ".env" or name.startswith(".env.")) and name != ".env.example"
            or Path(path).suffix.lower() in {".p12", ".pfx", ".key", ".pem", ".sqlite", ".sqlite3", ".db"}
            or "materials-output" in Path(path).parts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    root = args.root.resolve()
    probe = git(root, "rev-parse", "--show-toplevel", check=False)
    repository = probe.returncode == 0 and Path(os.fsdecode(probe.stdout).strip()).resolve() == root
    findings, skipped = set(), set()
    inspected = 0

    def scan(path, data, origin):
        nonlocal inspected
        if b"\0" in data:
            skipped.add(path)
            return
        inspected += 1
        for label, pattern in PATTERNS.items():
            if pattern.search(data):
                findings.add((path, origin, label))

    paths = public_paths(root, repository)
    for path in paths:
        if forbidden(path):
            findings.add((path, "working-tree", "private-artifact"))
        file = root / path
        if file.is_symlink():
            skipped.add(path)
        elif file.is_file():
            if file.stat().st_size > 2_000_000:
                skipped.add(path)
            else:
                scan(path, file.read_bytes(), "working-tree")
    if repository:
        # The working tree may be clean while an older secret remains staged.
        entries = git(root, "ls-files", "--stage", "-z").stdout.split(b"\0")
        for entry in entries:
            if not entry:
                continue
            metadata, path_raw = entry.split(b"\t", 1)
            path = os.fsdecode(path_raw)
            mode, oid, _stage = metadata.split()
            if forbidden(path):
                findings.add((path, "index", "private-artifact"))
            if mode == b"160000":
                skipped.add(path)
                continue
            size = int(git(root, "cat-file", "-s", os.fsdecode(oid)).stdout)
            if size > 2_000_000:
                skipped.add(path)
            else:
                scan(path, git(root, "cat-file", "blob", os.fsdecode(oid)).stdout, "index")
    for path, origin, label in sorted(findings):
        print(f"BLOCKED: {path} [{origin}: {label}]")
    print(f"Inspected {inspected} text snapshots; {len(skipped)} binary/large/symlink assets need manual review.")
    print("Scope: current public candidates" + (" and Git index." if repository else " (Git not initialized)."))
    print("Git history, arbitrary credential formats and external logs are not covered.")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
