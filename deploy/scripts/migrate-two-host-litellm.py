#!/usr/bin/env python3
"""Run on the LiteLLM host for the isolated preview database only."""

import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

runtime = Path("/var/lib/materialsx-litellm")
venv = runtime / ".venv"
values = {}
for line in (runtime / "secrets.env").read_text().splitlines():
    if line and not line.startswith("#"):
        key, value = line.split("=", 1)
        values[key] = value
db = urlsplit(values["DATABASE_URL"])
assert db.hostname == "127.0.0.1" and db.path == "/mx_litellm" and db.username == "mx_litellm"
environment = dict(os.environ)
environment.update(values)
environment.update({
    "DISABLE_SCHEMA_UPDATE": "false",
    "STORE_MODEL_IN_DB": "False",
    "LITELLM_LOCAL_MODEL_COST_MAP": "true",
    "LITELLM_LOG": "ERROR",
    "NO_PROXY": "localhost,127.0.0.1,::1",
    "no_proxy": "localhost,127.0.0.1,::1",
    "PGPASSWORD": unquote(db.password or ""),
    "PGSSLMODE": "verify-full",
    "PGSSLROOTCERT": str(runtime / "pg-ca.crt"),
    "LD_LIBRARY_PATH": "/opt/materialsx-musl-libs/1.2.2/lib",
    "PATH": ":".join([
        "/opt/materialsx-node16/16.20.2/bin",
        str(venv / "bin"),
        "/opt/materialsx-postgresql/16.13/bin",
        os.environ.get("PATH", ""),
    ]),
})
backup_dir = runtime / "backups"
backup_dir.mkdir(mode=0o700, exist_ok=True)
log_dir = runtime / "logs"
log_dir.mkdir(mode=0o700, exist_ok=True)


def run(label, command, timeout=240):
    with (log_dir / "migration.log").open("a", encoding="utf-8") as log:
        log.write(f"\n== {label} ==\n")
        log.flush()
        result = subprocess.run(command, env=environment, cwd=runtime, stdout=log, stderr=log, timeout=timeout)
    if result.returncode:
        raise SystemExit(f"{label}-failed-see-private-migration-log")
    print(label + "-ok")


if "--post-migrate" not in sys.argv[1:]:
    run("litellm-db-backup", [
        "/opt/materialsx-postgresql/16.13/bin/pg_dump", "-Fc", "-f",
        str(backup_dir / "before-preview-migration.dump"), "-h", db.hostname,
        "-p", str(db.port or 5432), "-U", db.username, db.path[1:],
    ], timeout=60)
    run("litellm-schema-migration", [str(venv / "bin/python"), "-m", "litellm.proxy.prisma_migration"])
source_schema = (venv / "lib/python3.12/site-packages/litellm_proxy_extras/schema.prisma").read_text()
native_schema, count = re.subn(r"^\s*binaryTargets\s*=\s*\[[^\n]*\]", '  binaryTargets = ["native"]', source_schema, count=1, flags=re.MULTILINE)
assert count == 1
schema = runtime / "schema.prisma"
schema.write_text(native_schema)
schema.chmod(0o600)
run("litellm-prisma-client", [str(venv / "bin/python"), "-m", "prisma", "generate", "--schema", str(schema)])
run("litellm-prisma-import", [str(venv / "bin/python"), "-c", "from prisma import Prisma; from prisma.types import DatasourceOverride"])
run("litellm-spend-indexes", [
    "/opt/materialsx-postgresql/16.13/bin/psql", "-h", db.hostname,
    "-p", str(db.port or 5432), "-U", db.username, "-d", db.path[1:],
    "-v", "ON_ERROR_STOP=1", "-c",
    'CREATE INDEX IF NOT EXISTS "LiteLLM_SpendLogs_litellm_call_id_idx" ON "LiteLLM_SpendLogs"("litellm_call_id"); '
    'CREATE INDEX IF NOT EXISTS "LiteLLM_SpendLogs_api_key_startTime_idx" ON "LiteLLM_SpendLogs"("api_key", "startTime");',
])
