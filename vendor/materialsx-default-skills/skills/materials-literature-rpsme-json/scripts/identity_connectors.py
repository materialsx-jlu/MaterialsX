#!/usr/bin/env python3
"""Opt-in, read-only identity candidates. Never merge or approve material identities."""
import argparse
import json
import os
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from p1_common import load, save, utcnow
from quality_review import digest

ALLOWED_HOSTS = {"pubchem.ncbi.nlm.nih.gov", "www.ebi.ac.uk", "api.crossref.org"}


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urllib.parse.urlsplit(newurl)
        if target.scheme != "https" or target.hostname != urllib.parse.urlsplit(req.full_url).hostname:
            raise ValueError("Cross-host/insecure redirect refused")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def get_json(url, transport="urllib"):
    target = urllib.parse.urlsplit(url)
    if target.scheme != "https" or target.hostname not in ALLOWED_HOSTS or target.username or target.password or target.port not in (None, 443):
        raise ValueError("Unapproved API endpoint")
    if transport == "curl":
        # Explicit optional transport for hosts with curl-managed proxy settings.
        # No shell, credentials, redirect or arbitrary host support.
        cp = subprocess.run(["curl", "--silent", "--show-error", "--max-time", "20", "--max-filesize", "4194304",
                             "--proto", "=https", "--max-redirs", "0", "--write-out", "\n%{http_code}",
                             "--header", "Accept: application/json", url], capture_output=True, timeout=25)
        body, _, code = cp.stdout.rpartition(b"\n")
        if cp.returncode or not code.isdigit():
            raise OSError("Public API transport failed")
        if int(code) != 200:
            raise urllib.error.HTTPError(url, int(code), "API response", {}, None)
        if len(body) > 4*1024*1024:
            raise ValueError("API response too large")
        return json.loads(body)
    if transport != "urllib":
        raise ValueError("Unknown HTTP transport")
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "RPSME-Literature-Skill/1.7.1"})
    with urllib.request.build_opener(SafeRedirect()).open(req, timeout=20) as response:
        raw = response.read(4*1024*1024+1)
    if len(raw) > 4*1024*1024:
        raise ValueError("API response too large")
    return json.loads(raw)


def cas_format(value):
    if not re.fullmatch(r"\d{2,7}-\d{2}-\d", value):
        return False
    digits = value.replace("-", "")
    return sum(int(d)*i for i, d in enumerate(reversed(digits[:-1]), 1)) % 10 == int(digits[-1])


def candidate(provider, external_id, name, identifiers, snapshot, url, accessed):
    return {"provider": provider, "external_id": external_id, "name": name,
            "identifiers": [{"type": k, "value": v, "evidence_ids": [],
                             "reference": {"url": url, "accessed_at": accessed, "quote": str(v)}}
                            for k, v in identifiers if isinstance(v, str) and v.strip()],
            "snapshot_sha256": digest(snapshot), "reference_url": url,
            "status": "pending_review", "verified": False,
            "warning": "Database identity candidate only; check salts, hydration, mixtures, polymorphs and exact paper usage."}


def pubchem(query, fetch, accessed):
    base = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/"
    mode = "cid" if re.fullmatch(r"\d+", query) else "name"
    url = base + mode + "/" + urllib.parse.quote(query, safe="") + "/property/MolecularFormula,InChIKey,ConnectivitySMILES/JSON"
    data = fetch(url)
    candidates, snapshots = [], [{"url": url, "accessed_at": accessed, "payload": data}]
    for row in data.get("PropertyTable", {}).get("Properties", [])[:5]:
        cid = str(row["CID"])
        props = [(kind, row.get(key)) for kind, key in (("formula", "MolecularFormula"), ("inchi_key", "InChIKey"), ("canonical_smiles", "ConnectivitySMILES"))]
        c = candidate("pubchem", "CID:"+cid, query, props, data, url, accessed)
        # CAS-looking synonyms are only candidates, never an authoritative assignment.
        synurl = base+"cid/"+cid+"/synonyms/JSON"
        try:
            syn = fetch(synurl)
            snapshots.append({"url": synurl, "accessed_at": accessed, "payload": syn})
            names = [s for info in syn.get("InformationList", {}).get("Information", []) for s in info.get("Synonym", [])]
            c["cas_synonym_candidates"] = [{"value": s, "status": "unverified_synonym", "checksum_valid": True,
                                            "reference": {"url": synurl, "accessed_at": accessed, "quote": s}} for s in names if cas_format(s)]
        except (OSError, ValueError):
            c["cas_lookup_status"] = "unavailable"
        candidates.append(c)
    return candidates, snapshots


def chebi(query, fetch, accessed):
    base = "https://www.ebi.ac.uk/chebi/backend/api/public/"
    if re.fullmatch(r"(?:CHEBI:)?\d+", query, re.I):
        url = base+"compound/"+query.split(":")[-1]+"/"
        data = fetch(url)
        payloads = [(url, data)]
    else:
        url = base+"es_search/?"+urllib.parse.urlencode({"term": query, "size": 5})
        data = fetch(url)
        # Search payload is preserved even if the public API changes shape.
        hits = data.get("results", [])
        if isinstance(hits, dict):
            hits = hits.get("results", [])
        payloads = []
        for hit in hits[:5]:
            cid = str(hit.get("chebi_id", hit.get("id", hit.get("_id", "")))).split(":")[-1]
            if cid.isdigit():
                detail_url = base+"compound/"+cid+"/"
                payloads.append((detail_url, fetch(detail_url)))
        if not payloads:
            return [], [{"url": url, "accessed_at": accessed, "payload": data}]
    candidates = []
    snapshots = [{"url": url, "accessed_at": accessed, "payload": data}]
    for ref, body in payloads:
        row = body
        cid = str(row.get("chebi_accession", row.get("chebi_id", row.get("id", ""))))
        props = []
        formula = row.get("formula")
        if isinstance(formula, str):
            props.append(("formula", formula))
        chemical = row.get("chemical_data", {}) or {}
        if isinstance(chemical, dict):
            props.append(("formula", chemical.get("formula")))
        structure = row.get("default_structure", {}) or {}
        if isinstance(structure, dict):
            props.extend([( "inchi_key", structure.get("standard_inchi_key"))])
            # ChEBI SMILES is preserved as a candidate, not mislabeled canonical.
        if cid:
            c = candidate("chebi", cid if cid.upper().startswith("CHEBI:") else "CHEBI:"+cid,
                          row.get("name", query), props, body, ref, accessed)
            c["source_smiles"] = structure.get("smiles") if isinstance(structure, dict) else None
            candidates.append(c)
        if ref != url:
            snapshots.append({"url": ref, "accessed_at": accessed, "payload": body})
    return candidates, snapshots


def materials_project(query, accessed):
    if not os.environ.get("MP_API_KEY"):
        return {"status": "requires_api_key", "candidates": [], "snapshots": []}
    try:
        from mp_api.client import MPRester
    except ImportError:
        return {"status": "requires_optional_mp_api_dependency", "candidates": [], "snapshots": []}
    with MPRester(os.environ["MP_API_KEY"], mute_progress_bars=True, timeout=20) as client:
        selector = {"material_ids": [query]} if re.fullmatch(r"mp-\d+", query) else {"formula": query}
        docs = client.materials.summary.search(**selector, fields=["material_id", "formula_pretty"], num_chunks=1, chunk_size=5)
    payload = [{"material_id": str(r.material_id), "formula_pretty": r.formula_pretty} for r in docs]
    candidates = [candidate("materials_project", r["material_id"], r["formula_pretty"], [("formula", r["formula_pretty"])],
                            payload, "https://materialsproject.org/materials/"+r["material_id"], accessed) for r in payload]
    return {"status": "candidates" if candidates else "not_found", "candidates": candidates,
            "snapshots": [{"method": "mp_api.materials.summary.search", "selector": selector, "accessed_at": accessed, "payload": payload}],
            "warning": "Calculated crystal records do not establish equivalence to a synthesized experimental sample."}


def csd(query, accessed):
    if not re.fullmatch(r"[A-Za-z]{6}(?:\d{2})?", query):
        return {"status": "requires_exact_csd_refcode", "candidates": [], "snapshots": []}
    try:
        from ccdc import io
    except ImportError:
        return {"status": "requires_licensed_csd_sdk_and_database", "candidates": [], "snapshots": []}
    reader = io.EntryReader("CSD")
    entry = reader.entry(query.upper())
    payload = {"identifier": entry.identifier, "formula": entry.molecule.formula}
    url = "https://www.ccdc.cam.ac.uk/structures/StructureSummary?pid="+urllib.parse.quote(entry.identifier, safe="")
    return {"status": "candidates", "candidates": [candidate("csd", entry.identifier, entry.identifier,
            [("formula", entry.molecule.formula)], payload, url, accessed)],
            "snapshots": [{"method": "ccdc.io.EntryReader(CSD).entry", "accessed_at": accessed, "payload": payload}],
            "redistribution": "restricted_by_local_csd_licence"}


def resolve(provider, query, online=False, fetch=get_json):
    if provider not in ("pubchem", "chebi", "materials_project", "csd") or not isinstance(query, str) or not query.strip() or len(query) > 300:
        raise ValueError("Invalid provider/query")
    report = {"format": "rpsme-identity-candidates-v1", "provider": provider, "query": query,
              "accessed_at": utcnow(), "status": "offline_no_lookup", "candidates": [], "snapshots": [],
              "registry_writes": False, "expert_verified": False}
    if not online:
        return report
    try:
        if provider in ("materials_project", "csd"):
            report.update((materials_project if provider == "materials_project" else csd)(query, report["accessed_at"]))
        else:
            candidates, snapshots = (pubchem if provider == "pubchem" else chebi)(query, fetch, report["accessed_at"])
            report.update(candidates=candidates, snapshots=snapshots, status="candidates" if candidates else "not_found_or_unrecognized_response")
    except urllib.error.HTTPError as exc:
        report.update(status="not_found" if exc.code == 404 else "retryable" if exc.code in (429, 500, 502, 503, 504) else "access_error", http_status=exc.code)
    except Exception as exc:
        # SDK exceptions can embed request headers/API keys. Never echo them.
        report.update(status="lookup_failed", error_type=type(exc).__name__)
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("provider", choices=("pubchem", "chebi", "materials_project", "csd")); p.add_argument("query")
    p.add_argument("--online", action="store_true", help="Authorize this lookup only; no bulk enrichment or registry writes")
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--transport", choices=("urllib", "curl"), default="urllib")
    a = p.parse_args()
    try:
        result = resolve(a.provider, a.query, a.online, fetch=lambda url: get_json(url, a.transport))
        save(a.output, result)
        print(json.dumps({"status": result["status"], "candidate_count": len(result["candidates"]), "output": str(a.output)}))
        return 0 if result["status"] in ("candidates", "offline_no_lookup", "not_found") else 2
    except (OSError, ValueError) as exc:
        p.error(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
