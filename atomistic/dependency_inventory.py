"""Inventory installed distributions and preserve their bundled license/notice files."""
from pathlib import Path
import hashlib
import importlib.metadata
import json
import shutil
import sys

target=Path(sys.argv[1]);target.mkdir(parents=True,exist_ok=True)
packages=[]
for distribution in sorted(importlib.metadata.distributions(),key=lambda d:d.metadata["Name"].lower()):
    name=distribution.metadata["Name"];licenses=[]
    for file in distribution.files or []:
        if any(part.upper().startswith(("LICENSE","COPYING","NOTICE","AUTHORS")) for part in file.parts):
            source=Path(distribution.locate_file(file))
            if not source.is_file() or source.stat().st_size>4*1024*1024:continue
            data=source.read_bytes();digest=hashlib.sha256(data).hexdigest()
            destination=target/name/digest/source.name;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,destination)
            licenses.append({"path":str(file).replace("\\","/"),"sha256":digest,"notice":str(destination.relative_to(target)).replace("\\","/")})
    packages.append({"name":name,"version":distribution.version,"licenseExpression":distribution.metadata.get("License-Expression"),
        "declaredLicense":distribution.metadata.get("License","")[:1000],"classifiers":[c for c in distribution.metadata.get_all("Classifier",[]) if c.startswith("License")],"licenseFiles":licenses})
(target/"inventory.json").write_text(json.dumps({"python":sys.version.split()[0],"packages":packages},indent=2)+"\n",encoding="utf-8")
