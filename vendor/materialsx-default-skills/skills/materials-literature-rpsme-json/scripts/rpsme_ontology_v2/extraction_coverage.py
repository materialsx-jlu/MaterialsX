"""Audit model-authored source inventories against delivered fields, without I/O.

This checks inventory-to-package retention, not whether the inventory exhausts
the source or whether its statements are scientifically correct.
"""
from __future__ import annotations


VERSION = "rpsme-source-coverage-v1"
PROMPTS = {"rpsme-literature-v4-source-coverage", "rpsme-patent-v12-source-coverage"}
CATEGORIES = {
    "ingredient": {"ingredient_usages", "process_feeds"},
    "specification": {"materials", "ingredient_usages", "process_feeds"},
    "formulation": {"recipes", "ingredient_usages"},
    "process": {"process_steps"},
    "parameter": {"process_steps"},
    "flow": {"relations"},
}


def _rows(value):
    return [r for r in value if isinstance(r, dict)] if isinstance(value, list) else []


def _obj(value):
    return value if isinstance(value, dict) else {}


def _present(value):
    if value is None or value == {} or value == []:
        return False
    if isinstance(value, str):
        return value.strip().lower() not in {"", "nr", "unknown", "not_reported", "未提供", "未报告", "—"}
    return True  # A reported zero is a value.


def _pointer(row, pointer):
    if not isinstance(pointer, str) or not pointer.startswith("/"):
        raise ValueError("Use a non-root JSON Pointer to a specific field")
    value = row
    for part in pointer[1:].split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(value, list):
            if not part.isdigit():
                raise ValueError("Invalid list index")
            value = value[int(part)]
        else:
            value = value[part]
    return value


def check_extraction_coverage(package, required=False):
    issues = []
    def add(code, path, message, severity="error"):
        issues.append(dict(severity=severity, code=code, path=path, message=message))

    ledger = _obj(_obj(_obj(package.get("source")).get("profile")).get("extraction_coverage"))
    required = required or package.get("prompt_version") in PROMPTS
    base = "$.source.profile.extraction_coverage"
    if not ledger:
        add("SOURCE_COVERAGE_MISSING", base, "没有原文事实清单，不能判定抽取完整性。", "error" if required else "warning")
        return dict(coverage_checked=False, source_coverage_complete=False, issues=issues)
    if ledger.get("version") != VERSION:
        add("SOURCE_COVERAGE_VERSION", base, "不支持的原文覆盖清单版本。")

    entities = _obj(package.get("entities"))
    collections = {key: _rows(value) for key, value in entities.items()}
    collections["relations"] = _rows(package.get("relations"))
    indexes = {key: {row.get("id"): row for row in rows} for key, rows in collections.items()}
    records = {r.get("id"): r for r in _rows(package.get("experiment_records"))}
    evidence = {r.get("id"): r for r in _rows(package.get("evidence"))}
    facts = _rows(ledger.get("facts"))
    samples = _rows(ledger.get("samples"))
    if not facts:
        add("SOURCE_FACTS_EMPTY", base, "必须先从原文登记事实，再核对输出；空清单不能证明完整。")
    sample_ids = [r.get("experiment_id") for r in samples]
    if len(sample_ids) != len(set(sample_ids)) or set(sample_ids) != set(records):
        add("SOURCE_SAMPLE_COVERAGE", base, "样品清单必须与所有保留实验一一对应。")

    documents = _rows(_obj(package.get("document_set")).get("documents"))
    reviewed = _rows(ledger.get("reviewed_sources"))
    reviewed_ids = {r.get("document_id") for r in reviewed}
    if not reviewed or any(not _present(r.get("locator")) for r in reviewed):
        add("SOURCE_REVIEW_MISSING", base, "记录实际核对的正文、SI 或专利网页及方法/表格位置。")
    if any(d.get("document_id") not in reviewed_ids for d in documents):
        add("SOURCE_DOCUMENT_UNREVIEWED", base, "有输入文档未核对；记录不可访问原因并保留待核查状态。")
    source_gaps = [r for r in reviewed if r.get("status") != "reviewed"]
    for row in source_gaps:
        if not _present(row.get("reason")):
            add("SOURCE_ACCESS_REASON", base, "未完成文档核对必须解释原因。")
    seen = set()
    unresolved = 0
    encoded = 0
    for i, fact in enumerate(facts):
        path = f"{base}.facts[{i}]"
        fid = fact.get("id")
        if not isinstance(fid, str) or not fid or fid in seen:
            add("SOURCE_FACT_ID", path, "原文事实 ID 必须唯一且非空。")
        seen.add(fid)
        exp = fact.get("experiment_id")
        category = fact.get("category")
        if exp not in records or category not in CATEGORIES:
            add("SOURCE_FACT_SCOPE", path, "事实必须属于保留实验和受支持类别。")
        if not _present(fact.get("locator")):
            add("SOURCE_FACT_LOCATOR", path, "事实或缺失判断必须说明核对的原文位置。")
        disposition = fact.get("disposition")
        if disposition not in {"encoded", "source_not_reported", "not_applicable", "unresolved"}:
            add("SOURCE_FACT_DISPOSITION", path, "每项事实必须说明已编码、原文未报告、不适用或待核查。")
            continue
        if disposition != "encoded":
            if not _present(fact.get("reason")):
                add("SOURCE_FACT_REASON", path, "缺失或不适用不能只写状态，必须说明原因。")
            if disposition == "unresolved":
                unresolved += 1
                if records.get(exp, {}).get("record_status") == "ready_for_primary_review":
                    add("SOURCE_UNRESOLVED_STATUS", path, "尚未完成抽取补漏的实验必须标为 needs_extraction_review 或 needs_source_action。")
            continue
        encoded += 1
        if not _present(fact.get("source_text")):
            add("SOURCE_FACT_QUOTE", path, "已编码事实必须保留原文片段。")
        refs = fact.get("evidence_ids")
        if not isinstance(refs, list) or not refs or any(e not in evidence for e in refs):
            add("SOURCE_FACT_EVIDENCE", path, "已编码事实必须引用存在的证据。")
        targets = _rows(fact.get("targets"))
        if not targets:
            add("SOURCE_FACT_DROPPED", path, "原文存在的事实没有输出字段。")
        for target in targets:
            collection = target.get("collection")
            row = indexes.get(collection, {}).get(target.get("id"))
            if row is None or collection not in CATEGORIES.get(category, set()):
                add("SOURCE_TARGET_MISSING", path, "对应实体已丢失，或事实被放入错误类别。")
                continue
            if row.get("experiment_id") and row["experiment_id"] != exp:
                add("SOURCE_TARGET_EXPERIMENT", path, "事实不能用另一个样品的实体代替。")
            try:
                actual = _pointer(row, target.get("pointer"))
                if not _present(actual) or "expected" not in target or actual != target["expected"]:
                    add("SOURCE_FIELD_LOST", path, "对应字段为空或与原文清单登记值不一致。")
                pointer = target.get("pointer", "")
                if category in {"specification", "formulation", "parameter"} and pointer in {"/id", "/display_name_zh", "/source_text", "/operation_type", "/recipe_type"}:
                    add("SOURCE_TARGET_TOO_BROAD", path, "规格、配比和参数必须核对具体字段，不能只核对名称或整段原文。")
            except (KeyError, IndexError, TypeError, ValueError):
                add("SOURCE_FIELD_LOST", path, "对应字段路径不存在。")

    for sample in samples:
        exp = sample.get("experiment_id")
        for category in ("ingredient", "formulation", "process"):
            if not any(f.get("experiment_id") == exp and f.get("category") == category for f in facts):
                add("SOURCE_CATEGORY_UNCHECKED", base, f"{exp}: 尚未检查 {category}，不能跳过整个维度。")
    for recipe in collections.get("recipes", []):
        if not any(u.get("recipe_id") == recipe.get("id") and u.get("experiment_id") == recipe.get("experiment_id") for u in collections.get("ingredient_usages", [])):
            add("SOURCE_EMPTY_RECIPE", base, f"配方 {recipe.get('id')} 有节点但没有组分。")
    for route in collections.get("process_routes", []):
        if not any(s.get("route_id") == route.get("id") and s.get("experiment_id") == route.get("experiment_id") for s in collections.get("process_steps", [])):
            add("SOURCE_EMPTY_PROCESS", base, f"工艺路线 {route.get('id')} 没有具体步骤。")

    return dict(coverage_checked=True, source_coverage_complete=not issues and not unresolved and not source_gaps,
                inventoried_facts=len(facts), encoded_facts=encoded, unresolved_facts=unresolved,
                inaccessible_sources=len(source_gaps), issues=issues)
