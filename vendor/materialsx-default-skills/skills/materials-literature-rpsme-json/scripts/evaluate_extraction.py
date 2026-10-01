#!/usr/bin/env python3
"""Paper-disjoint, one-to-one extraction evaluation. Never creates expert labels."""
import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from quality_review import digest, normalize_quote


# Small, explicit whitelist. No wt%/mol%/volume-fraction conflation.
UNITS = {"g": ("mass", 1, 0), "mg": ("mass", .001, 0), "kg": ("mass", 1000, 0),
         "µg": ("mass", 1e-6, 0), "μg": ("mass", 1e-6, 0),
         "L": ("volume", 1, 0), "mL": ("volume", .001, 0), "µL": ("volume", 1e-6, 0),
         "μL": ("volume", 1e-6, 0), "s": ("time", 1, 0), "min": ("time", 60, 0), "h": ("time", 3600, 0),
         "K": ("temperature", 1, 0), "°C": ("temperature", 1, 273.15),
         "nm": ("length", 1e-9, 0), "µm": ("length", 1e-6, 0), "mm": ("length", .001, 0),
         "mol": ("amount", 1, 0), "mmol": ("amount", .001, 0)}
KEYS = ("sample", "material", "field", "conditions", "basis", "value_status")


def paper_key(value):
    text = value.strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if text.startswith(prefix):
            text = text[len(prefix):].strip()
    return text


def numeric(value):
    return type(value) in (int, float) and math.isfinite(value)


def equivalent(gold, pred, require_evidence=False):
    if any(gold.get(k) != pred.get(k) for k in KEYS):
        return False
    a, b, au, bu = gold["value"], pred["value"], gold.get("unit"), pred.get("unit")
    if numeric(a) and numeric(b):
        ua, ub = UNITS.get(au, (au, 1, 0)), UNITS.get(bu, (bu, 1, 0))
        if ua[0] != ub[0]:
            return False
        a, b = a * ua[1] + ua[2], b * ub[1] + ub[2]
        tol = gold.get("tolerance", {})
        if not math.isclose(a, b, rel_tol=tol.get("relative", 0), abs_tol=tol.get("absolute_base_unit", 1e-12)):
            return False
    elif type(a) is not type(b) or a != b or au != bu:
        return False
    if require_evidence:
        ga, pa = gold.get("evidence", {}), pred.get("evidence", {})
        if not ga or any(ga.get(k) != pa.get(k) for k in ("document_id", "pdf_page")):
            return False
        if not normalize_quote(ga.get("quote", "")) or normalize_quote(ga["quote"]) != normalize_quote(pa.get("quote", "")):
            return False
    return True


def matching(gold, predictions, evidence=False):
    # Maximum bipartite match avoids greedy-order bias with overlapping tolerances.
    owner = {}
    def augment(i, seen):
        for j, pred in enumerate(predictions):
            if j in seen or not equivalent(gold[i], pred, evidence):
                continue
            seen.add(j)
            if j not in owner or augment(owner[j], seen):
                owner[j] = i
                return True
        return False
    for i in range(len(gold)):
        augment(i, set())
    return len(owner)


def score(tp, predicted, expected):
    precision = tp / predicted if predicted else 0.0
    recall = tp / expected if expected else None
    f1 = 2*tp/(predicted+expected) if predicted+expected else None
    return dict(true_positive=tp, false_positive=predicted-tp, false_negative=expected-tp,
                precision=precision, recall=recall, f1=f1)


def validate_case(case, gold=False):
    if not isinstance(case.get("paper_id"), str) or not paper_key(case["paper_id"]):
        raise ValueError("Each case needs a real paper_id")
    rows = case.get("facts")
    if not isinstance(rows, list):
        raise ValueError("Each case needs a facts array")
    if gold and not rows:
        raise ValueError("Empty/unannotated cases are not benchmark truth")
    for fact in rows:
        if any(k not in fact for k in (*KEYS, "value", "unit")):
            raise ValueError("Fact needs sample/material/field/conditions/basis/value_status/value/unit")
        if not fact["sample"] or not fact["field"] or not fact["value_status"] or not isinstance(fact["conditions"], dict):
            raise ValueError("Fact sample, field, status and structured conditions are required")
        tolerance = fact.get("tolerance", {})
        if any(not numeric(v) or v < 0 for v in tolerance.values()):
            raise ValueError("Tolerance must be finite and nonnegative")
        if isinstance(fact["value"], float) and not math.isfinite(fact["value"]):
            raise ValueError("Nonfinite values cannot be benchmark labels")


def evaluate(gold, predictions, allow_draft=False):
    if gold.get("format") != "rpsme-extraction-benchmark-v1" or predictions.get("format") != "rpsme-extraction-predictions-v1":
        raise ValueError("Unsupported benchmark/prediction format")
    cases = gold.get("cases", [])
    if not cases:
        raise ValueError("No annotated cases; template is not an expert benchmark")
    gmap, pmap, draft = {}, {}, False
    for case in cases:
        validate_case(case, gold=True)
        key = paper_key(case["paper_id"])
        if key in gmap:
            raise ValueError("Paper duplicated across cases/splits; main/SI must stay in one case")
        if case.get("split") not in ("train", "dev", "test"):
            raise ValueError("Assign split at paper level")
        approved = (case.get("annotation_status") == "expert_reviewed" and case.get("reviewers")
                    and all(r.get("name") and r.get("reviewed_at") for r in case["reviewers"]))
        draft |= not bool(approved)
        if not approved and not allow_draft:
            raise ValueError("Gold labels lack declared expert review; use --allow-draft for QA only")
        gmap[key] = case
    for case in predictions.get("cases", []):
        validate_case(case)
        key = paper_key(case["paper_id"])
        if key in pmap or key not in gmap:
            raise ValueError("Duplicate or unknown predicted paper; evaluate an explicit paper set")
        pmap[key] = case
    grouped = defaultdict(lambda: [0, 0, 0, 0])
    per_paper = []
    for key, case in gmap.items():
        expected, predicted = case["facts"], pmap.get(key, {}).get("facts", [])
        tp, etp = matching(expected, predicted), matching(expected, predicted, True)
        per_paper.append({"paper_id": key, "split": case["split"],
                          "facts": score(tp, len(predicted), len(expected)),
                          "facts_with_exact_evidence": score(etp, len(predicted), len(expected))})
        for field in {f["field"] for f in expected + predicted}:
            gs, ps = [f for f in expected if f["field"] == field], [f for f in predicted if f["field"] == field]
            row = grouped[field]
            for i, n in enumerate((matching(gs, ps), len(ps), len(gs), matching(gs, ps, True))):
                row[i] += n
    total = [sum(r[i] for r in grouped.values()) for i in range(4)]
    return {"mode": "draft_or_synthetic_qa" if draft else "declared_expert_labels",
            "expert_identity_authenticated": False, "gold_sha256": digest(gold), "prediction_sha256": digest(predictions),
            "paper_count": len(cases), "facts": score(*total[:3]),
            "facts_with_exact_evidence": score(total[3], total[1], total[2]),
            "by_field": {k: score(*v[:3]) for k, v in grouped.items()}, "by_paper": per_paper,
            "limitation": "Only annotated fields are evaluated. Exact evidence scoring may reject alternate valid spans. Software QA is not measured extraction accuracy."}


def pointer(value, path):
    if not isinstance(path, str) or not path.startswith("/"):
        raise ValueError("Projection needs an absolute JSON Pointer")
    for token in path[1:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        value = value[int(token)] if isinstance(value, list) else value[token]
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init"); init.add_argument("--output", type=Path, required=True)
    run = sub.add_parser("evaluate")
    run.add_argument("gold", type=Path); run.add_argument("predictions", type=Path)
    run.add_argument("--allow-draft", action="store_true"); run.add_argument("--output", type=Path, required=True)
    project = sub.add_parser("project")
    project.add_argument("package", type=Path); project.add_argument("mapping", type=Path)
    project.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve() in {v.resolve() for k, v in vars(args).items() if isinstance(v, Path) and k != "output"}:
        parser.error("Output must not overwrite an input")
    try:
        if args.command == "init":
            if args.output.exists():
                raise ValueError("Refusing to overwrite existing annotation dataset")
            result = {"format": "rpsme-extraction-benchmark-v1", "target_paper_count": 50,
                      "annotation_status": "unannotated", "cases": [],
                      "instructions": "Select 50–100 diverse real papers with main/SI. Label sample, raw ingredient, process, measurement and evidence manually. Keep one DOI in one split. Record annotator and independent reviewer. Do not relabel model outputs as expert gold."}
        elif args.command == "project":
            package = json.loads(args.package.read_text(encoding="utf-8"))
            mapping = json.loads(args.mapping.read_text(encoding="utf-8"))
            facts, missing = [], []
            for row in mapping["facts"]:
                try:
                    # Every predicted attribute is read from output, not copied
                    # from gold. Missing paths remain FN, never filled with gold.
                    facts.append({k: pointer(package, v) for k, v in row.items()})
                except (KeyError, IndexError, ValueError, TypeError):
                    missing.append(row)
            result = {"format": "rpsme-extraction-predictions-v1", "package_sha256": digest(package),
                      "mapping_sha256": digest(mapping), "missing_projection_rows": missing,
                      "cases": [{"paper_id": mapping["paper_id"], "facts": facts}],
                      "warning": "Projection must enumerate all predicted facts in evaluated fields, including extras, or precision is biased."}
        else:
            result = evaluate(json.loads(args.gold.read_text(encoding="utf-8")),
                              json.loads(args.predictions.read_text(encoding="utf-8")), args.allow_draft)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"output": str(args.output), "mode": result.get("mode", args.command)}))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
