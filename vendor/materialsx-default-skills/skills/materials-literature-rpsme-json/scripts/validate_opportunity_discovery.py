from datetime import datetime
from urllib.parse import urlparse

def validate_discovery(row, evidence_ids):
    errors = []
    assessment = row.get("opportunity_assessment", {})
    if not isinstance(assessment, dict):
        assessment = {}
    keys = ("bottleneck", "causal_hypothesis", "alternative_explanation", "differentiation", "decisive_experiment", "go_no_go", "fastest_action", "expected_contribution", "resource_fit")
    for key in keys:
        value = assessment.get(key)
        if not isinstance(value, dict) or not all(isinstance(value.get(lang), str) and value[lang].strip() for lang in ("zh-CN", "en")):
            errors.append(f"opportunity_assessment.{key} must be bilingual")
    ids = assessment.get("evidence_ids")
    if not isinstance(ids, list) or not ids or any(not isinstance(x,str) or x not in evidence_ids for x in ids):
        errors.append("opportunity_assessment.evidence_ids must reference package evidence")
    pub = row.get("publication_target", {})
    journals = pub.get("journals") if isinstance(pub, dict) else None
    if not isinstance(journals,list) or len(journals) != 3:
        return errors + ["publication_target.journals requires exactly three journals"]
    names = set()
    for rank, journal in enumerate(journals, 1):
        if not isinstance(journal,dict):
            errors.append("journal must be an object")
            continue
        name = str(journal.get("name","")).strip().lower()
        if not name or name in names or journal.get("rank") != rank:
            errors.append("journals need distinct names ordered by rank 1,2,3")
        names.add(name)
        for key in ("fit_reason", "required_evidence", "desk_rejection_risk"):
            value = journal.get(key)
            if not isinstance(value,dict) or not all(isinstance(value.get(lang),str) and value[lang].strip() for lang in ("zh-CN","en")):
                errors.append(f"journal {rank}.{key} must be bilingual")
        if journal.get("positioning") not in ("primary","stretch","fallback"):
            errors.append("journal positioning required")
        if journal.get("readiness") not in ("ready","needs_validation","out_of_scope"):
            errors.append("journal readiness required")
        try:
            url = urlparse(journal.get("scope_url", ""))
            if url.scheme != "https" or not url.hostname:
                errors.append("journal scope_url must be HTTPS")
        except (TypeError, ValueError):
            errors.append("invalid scope_url")
        status = journal.get("verification_status")
        if status not in ("verified","unverified"):
            errors.append("journal verification_status required")
        if status == "verified":
            try:
                stamp = datetime.fromisoformat(journal.get("checked_at","").replace("Z","+00:00"))
                if stamp.tzinfo is None: raise ValueError("timezone required")
            except (TypeError,ValueError,AttributeError):
                errors.append("verified journal requires checked_at timestamp")
    return errors

