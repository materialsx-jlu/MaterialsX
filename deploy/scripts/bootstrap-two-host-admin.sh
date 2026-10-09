#!/usr/bin/env bash
set -euo pipefail

credentials=/etc/materialsx/secrets/initial-admin.json
if [[ -e "$credentials" ]]; then
  echo 'initial-admin-credentials-already-exist'
  exit 0
fi
umask 077
python3 - "$credentials" <<'PY'
import base64
import json
import os
import sys

with open(sys.argv[1], "x", encoding="utf-8") as output:
    json.dump({
        "email": "admin@mx.jouhu.com",
        "displayName": "MaterialsX Administrator",
        "password": os.urandom(24).hex(),
        "totpSecret": base64.b32encode(os.urandom(20)).decode("ascii").rstrip("="),
    }, output)
    output.write("\n")
PY
chmod 0600 "$credentials"
set -a
# shellcheck disable=SC1091
source /etc/materialsx/secrets/api-migrate.env
set +a
/opt/materialsx/control-plane/current/bin/identityctl --command bootstrap-admin < "$credentials"
echo 'initial-admin-credentials-stored-root-only'
