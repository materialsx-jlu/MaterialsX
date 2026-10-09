"""Export exact public working-tree sources, including reviewed untracked changes.

No Git history, credentials, runtime, user inputs or model weights enter this ZIP.
Existing secret scanner and ignore rules own the public-candidate policy.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "scripts"))
from importlib.util import spec_from_file_location, module_from_spec
spec = spec_from_file_location("public_secrets", root / "scripts/check-public-secrets.py")
scanner = module_from_spec(spec)
spec.loader.exec_module(scanner)
version = json.loads((root / "package.json").read_text())["version"]
if not re.fullmatch(r"\d+\.\d+\.\d+(?:-preview\.\d+)?", version):
    raise RuntimeError("RELEASE_VERSION_REQUIRED")
target = Path(sys.argv[sys.argv.index("--output") + 1]).resolve() if "--output" in sys.argv else root / "release/dist" / version
target.mkdir(parents=True, exist_ok=True)
subprocess.run([sys.executable, str(root / "scripts/check-public-secrets.py")], cwd=root, check=True)
paths = [name for name in scanner.public_paths(root, True)
         if not name.startswith("website/releases/")]
archive = target / f"MaterialsX-{version}-source.zip"
entries = []
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as out:
    for name in paths:
        path = root / name
        if not path.exists():
            continue  # Deleted old code is not resurrected from Git HEAD.
        if scanner.forbidden(name) or path.is_symlink() or not path.is_file():
            raise RuntimeError(f"Non-public source entry: {name}")
        data = path.read_bytes()
        entries.append({"path":name,"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()})
        out.writestr(f"MaterialsX-{version}/{name}", data)
    out.writestr(f"MaterialsX-{version}/SOURCE_SNAPSHOT.json", json.dumps({
        "version":version,"scope":"public working tree excluding generated release manifests", "files":entries,
    }, ensure_ascii=False, indent=2))
print(json.dumps({"source":str(archive),"files":len(entries),"bytes":archive.stat().st_size}))
