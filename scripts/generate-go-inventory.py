"""Capture pinned Go module versions and original notices; never read runtime config."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
raw = '\n'.join(subprocess.check_output(['go','-C',str(root/'services/control-plane'),'list','-deps','-json','./cmd/identity','./cmd/identityctl'], text=True, env={**os.environ, 'GOOS': system, 'GOARCH': arch, 'CGO_ENABLED': '0'}) for system, arch in [('darwin','arm64'),('windows','amd64'),('linux','amd64')])
decoder = json.JSONDecoder()
modules = []
notices = []
while raw.strip():
    item, end = decoder.raw_decode(raw.lstrip())
    raw = raw.lstrip()[end:]
    item = item.get('Module')
    if not item or item.get('Main') or any(m['module'] == item['Path'] for m in modules):
        continue
    license_file = Path(item['Dir'])/'LICENSE'
    text = license_file.read_text()
    path, version = item['Path'], item['Version']
    modules.append({'module': path, 'version': version, 'licenseFile': 'LICENSE', 'licenseSha256': hashlib.sha256(license_file.read_bytes()).hexdigest()})
    notices.append(f'{path} {version}\n' + '='*72 + '\n' + text)
output = root/'docs/third-party'
output.mkdir(parents=True, exist_ok=True)
(output/'go-dependencies.json').write_text(json.dumps({'source':'Go cmd/identity and cmd/identityctl imports for macOS arm64, Windows x64, Linux x64; standard library and dependency tests excluded','modules': sorted(modules, key=lambda m: m['module'])},ensure_ascii=False,indent=2)+'\n')
(output/'GO_LICENSES.txt').write_text('\n\n'.join(notices)+'\n')
print(f'Captured {len(modules)} Go modules and original LICENSE texts')
