#!/usr/bin/env python3
"""Portable SQLite host-worker queue. No LLM subprocess, upload, or paywall bypass."""
import argparse
import json
import os
import re
import sqlite3
import time
import uuid
import zipfile
from pathlib import Path
from urllib.parse import urlencode
from evaluate_extraction import paper_key
from identity_connectors import get_json
from p1_common import load, save, sha_file, utcnow
from quality_review import digest


def integer(value, name, minimum=0):
    if type(value) is not int or value < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}")
    return value


def discover(query, limit=20, fetch=get_json):
    integer(limit, "limit", 1)
    if limit > 100 or not query.strip():
        raise ValueError("Use a nonempty query and limit <= 100")
    url = "https://api.crossref.org/works?"+urlencode({"query": query, "rows": limit, "filter": "type:journal-article"})
    response = fetch(url)
    return {"format": "rpsme-discovery-candidates-v1", "query": query, "url": url, "accessed_at": utcnow(),
            "response_sha256": digest(response), "papers": [{"paper_id": paper_key(r["DOI"]), "title": r.get("title", []),
            "doi_url": r.get("URL"), "publisher_links": r.get("link", []), "licence_metadata": r.get("license", []),
            "main_pdf": None, "supplementary_pdfs": [], "status": "needs_local_source_files_and_association"}
            for r in response.get("message", {}).get("items", []) if r.get("DOI")],
            "downloaded": False, "warning": "Search candidates are not verified experimental papers. Links/metadata do not grant redistribution or authenticated access."}


def scan(directory):
    groups = {}
    for path in sorted(p for p in Path(directory).rglob("*") if p.is_file() and p.suffix.lower() == ".pdf"):
        groups.setdefault(str(path.parent), []).append(str(path.resolve()))
    return {"format": "rpsme-pairing-candidates-v1", "groups": [{"directory": parent, "files": files,
            "main_candidates": [f for f in files if not re.search(r"(?:supp|support|esm|\bsi\b)", Path(f).stem, re.I)],
            "si_candidates": [f for f in files if re.search(r"(?:supp|support|esm|\bsi\b)", Path(f).stem, re.I)],
            "association": {"confirmed": False, "reason": "Check main/SI title, DOI and front matter; filenames alone are insufficient"}}
            for parent, files in groups.items()]}


SCHEMA = """
CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
CREATE TABLE jobs (id TEXT PRIMARY KEY, paper_id TEXT UNIQUE, payload TEXT NOT NULL,
 status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, available_at REAL NOT NULL DEFAULT 0,
 lease TEXT, lease_until REAL, reserved_tokens INTEGER NOT NULL DEFAULT 0,
 reserved_cost INTEGER NOT NULL DEFAULT 0, used_tokens INTEGER NOT NULL DEFAULT 0,
 used_cost INTEGER NOT NULL DEFAULT 0);
CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, kind TEXT NOT NULL,
 at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
"""


def event(db, job, kind, payload):
    db.execute("INSERT INTO events(job_id,kind,at,payload) VALUES(?,?,?,?)", (job, kind, utcnow(), json.dumps(payload, ensure_ascii=False)))


def connect(path):
    if not Path(path).is_file():
        raise ValueError("Queue does not exist; initialize explicitly")
    db = sqlite3.connect(path, timeout=10)
    if db.execute("PRAGMA application_id").fetchone()[0] != 1380995889:
        db.close(); raise ValueError("Not an RPSME P1 batch queue")
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=10000")
    return db


def init_queue(path, manifest, base):
    if Path(path).exists():
        raise ValueError("Refusing to overwrite existing queue")
    budget = manifest["budget"]
    integer(budget["tokens"], "token budget", 1); integer(budget["cost_microunits"], "cost budget")
    if not re.fullmatch(r"[A-Z]{3}", budget.get("currency", "")):
        raise ValueError("Budget requires explicit currency; 1 unit = 1,000,000 microunits")
    max_attempts = integer(manifest.get("max_attempts", 3), "max_attempts", 1)
    prepared, keys, owners = [], set(), {}
    for row in manifest["papers"]:
        key = paper_key(row["paper_id"])
        if not key or key in keys:
            raise ValueError("Duplicate/empty paper ID; main/SI belong in one job")
        keys.add(key)
        files = []
        for role, name in [("main", row["main_pdf"]), *(("supplementary", x) for x in row.get("supplementary_pdfs", []))]:
            p = (Path(base)/name).resolve()
            if p.suffix.lower() != ".pdf" or not p.is_file():
                raise ValueError("Queue needs accessible local PDFs")
            h = sha_file(p)
            if h in owners:
                raise ValueError("Same PDF reused across jobs or main/SI roles")
            owners[h] = key
            files.append({"role": role, "path": str(p), "sha256": h})
        reservation = row["reservation"]
        integer(reservation["tokens"], "reserved tokens", 1); integer(reservation["cost_microunits"], "reserved cost")
        association = row.get("association", {})
        confirmed = association.get("confirmed") is True and bool(association.get("reason", "").strip())
        payload = {"paper_id": key, "files": files, "reservation": reservation, "association": association,
                   "pipeline_version": "literature-skill-1.7.1", "research_directions": row.get("research_directions", False)}
        prepared.append((digest(payload)[:24], key, json.dumps(payload), "pending" if confirmed else "needs_source_review"))
    if not prepared:
        raise ValueError("Queue needs at least one paper")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600); os.close(fd)
    db = sqlite3.connect(path)
    try:
        db.executescript(SCHEMA)
        db.execute("PRAGMA application_id=1380995889")
        with db:
            db.execute("INSERT INTO settings VALUES(1,?)", (json.dumps({"budget": budget, "max_attempts": max_attempts}),))
            db.executemany("INSERT INTO jobs(id,paper_id,payload,status) VALUES(?,?,?,?)", prepared)
            event(db, None, "initialized", {"job_count": len(prepared), "manifest_sha256": digest(manifest)})
    finally:
        db.close()
    return {"job_count": len(prepared), "database": str(path)}


def claim(path, worker, lease_seconds=900, now=None):
    integer(lease_seconds, "lease seconds", 1)
    if not worker.strip() or lease_seconds > 86400:
        raise ValueError("Worker identity and bounded lease required")
    now = time.time() if now is None else now
    db = connect(path)
    try:
        db.execute("BEGIN IMMEDIATE")
        for row in db.execute("SELECT id FROM jobs WHERE status='running' AND lease_until<=?", (now,)).fetchall():
            db.execute("UPDATE jobs SET status='needs_reconciliation' WHERE id=?", (row["id"],))
            event(db, row["id"], "lease_expired_unknown_outcome", {})
        settings = json.loads(db.execute("SELECT payload FROM settings").fetchone()[0])
        if db.execute("SELECT 1 FROM jobs WHERE status='budget_overrun' LIMIT 1").fetchone():
            db.commit(); return {"status": "blocked_budget_overrun", "job": None}
        sums = db.execute("SELECT coalesce(sum(used_tokens+reserved_tokens),0),coalesce(sum(used_cost+reserved_cost),0) FROM jobs").fetchone()
        rows = db.execute("SELECT * FROM jobs WHERE status IN ('pending','retry_wait','waiting_budget') AND available_at<=? ORDER BY rowid", (now,)).fetchall()
        result = None
        for row in rows:
            data = json.loads(row["payload"])
            if row["attempts"] >= settings["max_attempts"]:
                db.execute("UPDATE jobs SET status='failed' WHERE id=?", (row["id"],)); continue
            if any(not Path(f["path"]).is_file() or sha_file(f["path"]) != f["sha256"] for f in data["files"]):
                db.execute("UPDATE jobs SET status='source_changed' WHERE id=?", (row["id"],))
                event(db, row["id"], "source_changed", {}); continue
            t, c = data["reservation"]["tokens"], data["reservation"]["cost_microunits"]
            if sums[0]+t > settings["budget"]["tokens"] or sums[1]+c > settings["budget"]["cost_microunits"]:
                db.execute("UPDATE jobs SET status='waiting_budget' WHERE id=?", (row["id"],)); continue
            lease = uuid.uuid4().hex
            db.execute("UPDATE jobs SET status='running', attempts=attempts+1, lease=?,lease_until=?,reserved_tokens=?,reserved_cost=? WHERE id=?",
                       (lease, now+lease_seconds, t, c, row["id"]))
            event(db, row["id"], "claimed", {"worker": worker, "lease": lease})
            result = {"job_id": row["id"], "lease": lease, "lease_until": now+lease_seconds, **data,
                      "instruction": "Run the installed literature Skill on this one main/SI set. No upload is authorized. Complete final P0 validation before submitting a receipt."}
            break
        db.commit()
        return {"status": "claimed", "job": result} if result else {"status": "no_runnable_job", "job": None}
    except Exception:
        db.rollback(); raise
    finally:
        db.close()


def check_result(receipt, job):
    from validate_package import validate
    output, documents, review_path = map(Path, (receipt["package"], receipt["documents"], receipt["quality_review"]))
    package = load(output)
    final_hash = sha_file(output)
    if receipt.get("package_sha256") != final_hash:
        raise ValueError("Receipt must identify exact final package bytes")
    expected = {f["sha256"]: f["role"] for f in job["files"]}
    docrows = package.get("document_set", {}).get("documents", [])
    actual = {r.get("sha256"): r.get("role") for r in docrows}
    doi = package.get("source", {}).get("profile", {}).get("doi", package.get("source", {}).get("publication_number", ""))
    if actual != expected or len(docrows) != len(actual) or paper_key(doi) != job["paper_id"]:
        raise ValueError("Output source/DOI does not match claimed paper")
    result = validate(package, require_coverage=True, documents=documents, review=load(review_path), require_quality=True)
    if not result["valid"]:
        raise ValueError("Final P0/coverage validation failed")
    if job["research_directions"]:
        from validate_research_opportunities import validate as directions
        if directions(package):
            raise ValueError("Requested research-direction validation failed")
    if package.get("bundle", {}).get("delivery_mode") == "bundle":
        from rpsme_ontology_v2.bundle import validate_bundle
        archive = Path(receipt["bundle"])
        root = Path(__file__).resolve().parent.parent
        report = validate_bundle(archive, manifest_schema_path=root/"references/rpsme-bundle-manifest-v1.schema.json",
                                 package_schema_path=root/"references/rpsme-patent-package-v2.schema.json").to_dict()
        if not report["valid"]:
            raise ValueError("Bundle integrity validation failed")
        with zipfile.ZipFile(archive) as z:
            if json.loads(z.read("manifest.json"))["ontology_sha256"] != final_hash:
                raise ValueError("Bundle and external JSON do not match")
    if sha_file(output) != final_hash:
        raise ValueError("Package changed during validation")
    return {"package_sha256": final_hash, "quality_ready": True}


def confirm_source(path, job_id, actor, reason):
    if not actor.strip() or not reason.strip():
        raise ValueError("Explicit actor and title/DOI association reason required")
    db = connect(path)
    try:
        with db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT payload,status FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row or row[1] != "needs_source_review":
                raise ValueError("Only pending source associations can be confirmed")
            data = json.loads(row[0])
            if any(sha_file(f["path"]) != f["sha256"] for f in data["files"]):
                raise ValueError("Source files changed")
            data["association"] = {"confirmed": True, "actor": actor, "reason": reason, "at": utcnow()}
            db.execute("UPDATE jobs SET payload=?,status='pending' WHERE id=?", (json.dumps(data), job_id))
            event(db, job_id, "source_association_confirmed", data["association"])
        return {"status": "pending"}
    finally:
        db.close()


def renew(path, job_id, lease, seconds=900, now=None):
    integer(seconds, "lease extension", 1)
    if seconds > 86400:
        raise ValueError("Lease extension too large")
    now = time.time() if now is None else now
    db = connect(path)
    try:
        with db:
            cur = db.execute("UPDATE jobs SET lease_until=? WHERE id=? AND lease=? AND status='running' AND lease_until>?", (now+seconds, job_id, lease, now))
            if cur.rowcount != 1:
                raise ValueError("Cannot renew expired or stale lease")
            event(db, job_id, "lease_renewed", {"until": now+seconds})
        return {"lease_until": now+seconds}
    finally:
        db.close()


def finish(path, job_id, lease, receipt, now=None):
    now = time.time() if now is None else now
    outcome = receipt.get("outcome")
    if outcome not in ("succeeded", "retryable", "failed", "unknown"):
        raise ValueError("Receipt outcome required")
    db = connect(path)
    try:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row or row["lease"] != lease:
            raise ValueError("Unknown job/stale lease")
        receipt_hash = digest(receipt)
        for prior in db.execute("SELECT payload FROM events WHERE job_id=? AND kind='receipt'", (job_id,)):
            previous = json.loads(prior[0])
            if previous.get("receipt_sha256") == receipt_hash and previous.get("lease") == lease:
                db.commit(); return {"status": row["status"], "idempotent": True}
        late = row["status"] == "needs_reconciliation" or (row["lease_until"] or 0) <= now
        if row["status"] not in ("running", "needs_reconciliation"):
            raise ValueError("Job is not awaiting a result")
        if late and not receipt.get("reconciliation_reason", "").strip():
            raise ValueError("Expired/unknown work requires explicit reconciliation, not an automatic retry")
        if outcome == "unknown":
            db.execute("UPDATE jobs SET status='needs_reconciliation' WHERE id=?", (job_id,))
            event(db, job_id, "unknown", {"reason": receipt.get("reason", "unknown")})
            db.commit(); return {"status": "needs_reconciliation"}
        usage = receipt["usage"]
        t, c = integer(usage["tokens"], "actual tokens"), integer(usage["cost_microunits"], "actual cost")
        settings = json.loads(db.execute("SELECT payload FROM settings").fetchone()[0])
        if usage.get("currency") != settings["budget"]["currency"] or usage.get("basis") not in {"provider_report", "local_meter", "declared_estimate", "no_billable_call"}:
            raise ValueError("Usage currency and source/basis required; unknown is not zero")
        exceeded = t > row["reserved_tokens"] or c > row["reserved_cost"]
        proof = check_result(receipt, json.loads(row["payload"])) if outcome == "succeeded" else {}
        state = "budget_overrun" if exceeded else "succeeded" if outcome == "succeeded" else "retry_wait" if outcome == "retryable" and row["attempts"] < settings["max_attempts"] else "failed"
        backoff = min(3600, 30 * 2**max(0, row["attempts"]-1))
        db.execute("UPDATE jobs SET status=?,used_tokens=used_tokens+?,used_cost=used_cost+?,reserved_tokens=0,reserved_cost=0,available_at=? WHERE id=?",
                   (state, t, c, now+backoff if state == "retry_wait" else now, job_id))
        event(db, job_id, "receipt", {"receipt_sha256": receipt_hash, "lease": lease, "receipt": receipt, "proof": proof, "state": state})
        db.commit(); return {"status": state, "idempotent": False}
    except Exception:
        db.rollback(); raise
    finally:
        db.close()


def status(path):
    db = connect(path)
    try:
        rows = [dict(r) for r in db.execute("SELECT id,paper_id,status,attempts,used_tokens,used_cost,reserved_tokens,reserved_cost FROM jobs")]
        return {"jobs": rows, "settings": json.loads(db.execute("SELECT payload FROM settings").fetchone()[0]),
                "totals": {k: sum(r[k] for r in rows) for k in ("used_tokens", "used_cost", "reserved_tokens", "reserved_cost")},
                "cost_basis": "Worker-reported actual/estimated usage; not a billing-system reconciliation"}
    finally:
        db.close()


def main():
    p = argparse.ArgumentParser(description=__doc__); sub = p.add_subparsers(dest="command", required=True)
    s = sub.add_parser("discover"); s.add_argument("query"); s.add_argument("--limit", type=int, default=20); s.add_argument("--output", type=Path, required=True)
    s.add_argument("--transport", choices=("urllib", "curl"), default="urllib")
    s = sub.add_parser("scan"); s.add_argument("directory", type=Path); s.add_argument("--output", type=Path, required=True)
    s = sub.add_parser("init"); s.add_argument("manifest", type=Path); s.add_argument("--db", type=Path, required=True)
    s = sub.add_parser("claim"); s.add_argument("--db", type=Path, required=True); s.add_argument("--worker", required=True); s.add_argument("--lease-seconds", type=int, default=900)
    s = sub.add_parser("finish"); s.add_argument("--db", type=Path, required=True); s.add_argument("--job", required=True); s.add_argument("--lease", required=True); s.add_argument("--receipt", type=Path, required=True)
    s = sub.add_parser("status"); s.add_argument("--db", type=Path, required=True)
    s = sub.add_parser("confirm-source"); s.add_argument("--db", type=Path, required=True); s.add_argument("--job", required=True)
    s.add_argument("--actor", required=True); s.add_argument("--reason", required=True)
    s = sub.add_parser("renew"); s.add_argument("--db", type=Path, required=True); s.add_argument("--job", required=True)
    s.add_argument("--lease", required=True); s.add_argument("--lease-seconds", type=int, default=900)
    a = p.parse_args()
    try:
        if a.command == "discover": result = discover(a.query, a.limit, fetch=lambda url: get_json(url, a.transport)); save(a.output, result)
        elif a.command == "scan": result = scan(a.directory); save(a.output, result)
        elif a.command == "init": result = init_queue(a.db, load(a.manifest), a.manifest.parent)
        elif a.command == "claim": result = claim(a.db, a.worker, a.lease_seconds)
        elif a.command == "finish": result = finish(a.db, a.job, a.lease, load(a.receipt))
        elif a.command == "confirm-source": result = confirm_source(a.db, a.job, a.actor, a.reason)
        elif a.command == "renew": result = renew(a.db, a.job, a.lease, a.lease_seconds)
        else: result = status(a.db)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, OSError, KeyError, TypeError, sqlite3.Error) as exc:
        p.error(str(exc))


if __name__ == "__main__":
    main()
