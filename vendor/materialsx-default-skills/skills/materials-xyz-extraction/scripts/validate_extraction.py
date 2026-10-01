#!/usr/bin/env python3
"""Validate the XYZ contract and sample/evidence links; stdlib only, no PDF truth check."""
import argparse
from collections import Counter
import json
import math
from pathlib import Path
import re

CATEGORIES = {
    'X': ['formulation', 'sizing', 'impregnation_route', 'thermopress_history', 'cooling_history'],
    'Y': ['porosity', 'impregnation_quality', 'crystallinity', 'orientation', 'residual_stress', 'interface'],
    'Z': ['stiffness', 'strength', 'interlaminar_toughness', 'fatigue'],
}
CATEGORY_STAGE = {c: s for s, cs in CATEGORIES.items() for c in cs}
STATUSES = {'quantitative', 'qualitative', 'proxy_only', 'reported_setting', 'partial',
            'not_reported', 'not_applicable', 'not_accessible'}
ORIGINS = {'reported', 'digitized', 'calculated', 'simulated', 'author_interpretation', 'model_hypothesis'}
STATES = {'as_manufactured', 'post_failure', 'during_process', 'during_test', 'not_applicable', 'unknown'}


def numeric(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validate(d):
    errors, warnings = [], []
    def err(message):
        errors.append(message)
    def need(obj, keys, where):
        for key in keys:
            if key not in obj:
                err(f'{where}: missing {key}')
    def index(key):
        value = d.get(key)
        if not isinstance(value, list):
            err(f'{key}: expected list')
            return {}
        result = {}
        for obj in value:
            if not isinstance(obj, dict) or not isinstance(obj.get('id'), str):
                err(f'{key}: object with string id required')
                continue
            if obj['id'] in result:
                err(f'{key}: duplicate id {obj["id"]}')
            result[obj['id']] = obj
        return result
    def refs(obj, key, target, where, nonempty=False):
        values = obj.get(key)
        if not isinstance(values, list):
            err(f'{where}: {key} must be a list')
            return []
        if nonempty and not values:
            err(f'{where}: {key} cannot be empty')
        for v in values:
            if not isinstance(v, str) or v not in target:
                err(f'{where}: unknown {key} reference {v}')
        return [v for v in values if isinstance(v, str) and v in target]

    if not isinstance(d, dict):
        return {'valid': False, 'errors': ['Root must be an object'], 'warnings': []}
    need(d, ['schema_version', 'source', 'material_systems', 'groups', 'protocols', 'evidence',
             'facts', 'coverage', 'relations', 'conflicts', 'inventory'], 'root')
    if d.get('schema_version') != 'materials-xyz-1.0':
        err('Unsupported schema_version')
    source = d.get('source', {})
    if not isinstance(source, dict):
        source = {}; err('source must be an object')
    need(source, ['id', 'path', 'sha256', 'page_count', 'title', 'doi', 'publication_year',
                  'version_note', 'supplementary_status'], 'source')
    if not re.fullmatch('[0-9a-f]{64}', str(source.get('sha256', ''))):
        err('source.sha256 must contain 64 lowercase hexadecimal characters')
    page_count = source.get('page_count')
    if type(page_count) is not int or page_count < 1:
        err('source.page_count must be positive integer'); page_count = 0
    materials, groups, protocols, evidence, facts, relations, conflicts = [index(k) for k in
        ('material_systems', 'groups', 'protocols', 'evidence', 'facts', 'relations', 'conflicts')]
    for eid, e in evidence.items():
        need(e, ['source_id', 'page', 'locator', 'excerpt', 'excerpt_kind', 'review'], eid)
        if e.get('excerpt_kind') not in {'verbatim', 'paraphrase', 'image_observation'}:
            err(f'{eid}: specify whether evidence text is a quote, paraphrase or image observation')
        if e.get('source_id') != source.get('id'):
            err(f'{eid}: wrong source_id')
        if type(e.get('page')) is not int or not 1 <= e['page'] <= page_count:
            err(f'{eid}: page outside PDF')
        if e.get('review') not in {'text_checked', 'visual_checked'}:
            err(f'{eid}: invalid review state')
        if not e.get('locator') or not e.get('excerpt'):
            err(f'{eid}: empty locator/excerpt')
    for mid, m in materials.items():
        need(m, ['name', 'family', 'constituents', 'evidence_ids'], mid)
        refs(m, 'evidence_ids', evidence, mid, True)
    for gid, g in groups.items():
        need(g, ['label', 'generated_id', 'series', 'material_system_id', 'batch_id',
                 'specimen_ids', 'linkage_level', 'possible_duplicate_cluster', 'evidence_ids'], gid)
        if g.get('material_system_id') not in materials:
            err(f'{gid}: unknown material system')
        if g.get('linkage_level') not in {'condition_group', 'batch', 'specimen'}:
            err(f'{gid}: invalid linkage_level')
        if g.get('linkage_level') == 'specimen' and not g.get('specimen_ids'):
            err(f'{gid}: specimen linkage without specimen IDs')
        if g.get('linkage_level') == 'batch' and not g.get('batch_id'):
            err(f'{gid}: batch linkage without batch ID')
        refs(g, 'evidence_ids', evidence, gid, True)
    for pid, p in protocols.items():
        need(p, ['name', 'method', 'standard', 'conditions', 'specimen', 'replicates', 'evidence_ids'], pid)
        refs(p, 'evidence_ids', evidence, pid, True)
        rep = p.get('replicates', {})
        if isinstance(rep, dict) and rep.get('exact') is not None and rep.get('minimum') is not None:
            if rep['exact'] < rep['minimum']:
                err(f'{pid}: exact replicates less than minimum')
    for fid, f in facts.items():
        need(f, ['group_id', 'stage', 'category', 'metric', 'value', 'unit', 'raw_value', 'raw_unit',
                 'normalization', 'origin', 'measurement', 'state', 'protocol_id', 'evidence_ids',
                 'inherited_from', 'uncertainty', 'note'], fid)
        if f.get('group_id') not in groups:
            err(f'{fid}: unknown group_id')
        if CATEGORY_STAGE.get(f.get('category')) != f.get('stage') or f.get('stage') not in CATEGORIES:
            err(f'{fid}: category/stage mismatch')
        if f.get('origin') not in ORIGINS:
            err(f'{fid}: invalid origin')
        if f.get('measurement') not in {'quantitative', 'qualitative', 'proxy', 'not_measurement'}:
            err(f'{fid}: invalid measurement')
        if f.get('state') not in STATES:
            err(f'{fid}: invalid state')
        refs(f, 'evidence_ids', evidence, fid, f.get('origin') != 'model_hypothesis')
        if f.get('protocol_id') is not None and f['protocol_id'] not in protocols:
            err(f'{fid}: unknown protocol_id')
        if f.get('stage') in {'Y', 'Z'} and f.get('measurement') == 'quantitative' and not f.get('protocol_id'):
            err(f'{fid}: quantitative Y/Z requires a protocol')
        if f.get('value') is None and not f.get('note'):
            err(f'{fid}: missing value needs reason')
        if f.get('measurement') == 'quantitative' and f.get('value') is not None:
            if not (numeric(f['value']) or isinstance(f['value'], (list, dict))):
                err(f'{fid}: quantitative value must be numeric or structured')
            if not f.get('unit'):
                err(f'{fid}: quantitative value requires unit; use 1 for dimensionless')
        metric = f.get('metric', '').lower()
        if ('ilss' in metric or 'short_beam_strength' in metric) and f.get('category') != 'strength':
            err(f'{fid}: ILSS must be Z strength, not fracture toughness or interface')
        if metric in {'porosity_fraction', 'crystallinity_fraction', 'fiber_volume_fraction'}:
            if f.get('unit') != '1' or not numeric(f.get('value')) or not 0 <= f['value'] <= 1:
                err(f'{fid}: fraction requires unit 1 and numeric value in [0,1]')
        for origin, required in [('digitized', 'digitization'), ('calculated', 'calculation'), ('simulated', 'simulation')]:
            if f.get('origin') == origin and not f.get(required):
                err(f'{fid}: {origin} requires {required} provenance')
        raw, value = f.get('raw_value'), f.get('value')
        if numeric(raw) and numeric(value):
            ru, u = f.get('raw_unit'), f.get('unit')
            factors = {('GPa', 'MPa'): 1000, ('kJ/m2', 'J/m2'): 1000, ('%', '1'): .01,
                       ('h', 'min'): 60, ('s', 'min'): 1/60, ('um', 'mm'): .001}
            if ru == u and not math.isclose(raw, value, rel_tol=1e-9, abs_tol=1e-10):
                err(f'{fid}: raw/normalized values differ with same unit')
            elif (ru, u) in factors and not math.isclose(raw * factors[(ru, u)], value, rel_tol=1e-9, abs_tol=1e-10):
                err(f'{fid}: incorrect unit conversion {ru} -> {u}')
            elif ru != u and (ru, u) not in factors and not f.get('normalization'):
                err(f'{fid}: unit conversion needs explicit formula')
        if f.get('state') == 'post_failure' and f.get('stage') == 'Y':
            warnings.append(f'{fid}: post-failure Y is not an initial mediator measurement')

    coverage = d.get('coverage', [])
    seen = set()
    if not isinstance(coverage, list):
        coverage = []; err('coverage must be a list')
    for c in coverage:
        if not isinstance(c, dict):
            err('coverage entry must be object'); continue
        need(c, ['group_id', 'category', 'status', 'fact_ids', 'missing_fields', 'note'], 'coverage')
        key = (c.get('group_id'), c.get('category'))
        label = '/'.join(str(x) for x in key)
        if key in seen: err(f'{label}: duplicate coverage')
        seen.add(key)
        if key[0] not in groups or key[1] not in CATEGORY_STAGE:
            err(f'{label}: unknown group/category')
        if c.get('status') not in STATUSES:
            err(f'{label}: invalid coverage status')
        ids = refs(c, 'fact_ids', facts, label)
        for fid in ids:
            if (facts[fid].get('group_id'), facts[fid].get('category')) != key:
                err(f'{label}: coverage fact belongs to different group/category')
        if c.get('status') not in {'not_reported', 'not_applicable', 'not_accessible'} and not ids:
            err(f'{label}: claimed coverage without facts')
        if c.get('status') == 'quantitative' and not any(
            facts[f].get('measurement') == 'quantitative' and facts[f].get('value') is not None for f in ids):
            err(f'{label}: quantitative coverage without quantitative fact')
        if c.get('status') in {'not_reported', 'not_accessible'} and not c.get('missing_fields'):
            err(f'{label}: missing coverage requires missing_fields')
        if c.get('status') == 'not_applicable' and not c.get('note'):
            err(f'{label}: not_applicable requires explanation')
    for gid in groups:
        for category in CATEGORY_STAGE:
            if (gid, category) not in seen:
                err(f'{gid}/{category}: missing coverage audit')
    for rid, r in relations.items():
        need(r, ['layer', 'kind', 'linkage_level', 'group_ids', 'from_fact_ids', 'to_fact_ids', 'evidence_ids',
                 'claim', 'controls', 'confounders', 'limitations', 'validation_experiment'], rid)
        gids = refs(r, 'group_ids', groups, rid, True)
        left = refs(r, 'from_fact_ids', facts, rid, True)
        right = refs(r, 'to_fact_ids', facts, rid, True)
        refs(r, 'evidence_ids', evidence, rid, r.get('kind') != 'model_hypothesis')
        expected = {'f1': ('X', 'Y'), 'f2': ('Y', 'Z'), 'direct_XZ': ('X', 'Z')}.get(r.get('layer'))
        if not expected:
            err(f'{rid}: invalid relation layer')
        else:
            for ids, stage in zip((left, right), expected):
                if any(facts[f].get('stage') != stage for f in ids):
                    err(f'{rid}: endpoint stage incompatible with {r["layer"]}')
        if r.get('kind') not in {'association', 'author_mechanism', 'model_hypothesis', 'reported_model'}:
            err(f'{rid}: invalid/overstated causal kind')
        if r.get('kind') == 'reported_model' and not r.get('model'):
            err(f'{rid}: reported_model requires equation/model, parameters and applicability record')
        endpoint_groups = {facts[f].get('group_id') for f in left + right}
        if not endpoint_groups.issubset(set(gids)):
            err(f'{rid}: endpoint group outside declared groups')
        if r.get('linkage_level') not in {'within_group', 'across_group_comparison'}:
            err(f'{rid}: invalid relation linkage_level')
        if r.get('linkage_level') == 'within_group' and len(endpoint_groups) != 1:
            err(f'{rid}: within_group relation crosses groups')
        if r.get('kind') == 'association' and r.get('layer') == 'f2' and any(
            facts[f].get('state') == 'post_failure' for f in left):
            err(f'{rid}: post-failure Y cannot be a pre-failure f2 association; use mechanism/hypothesis with limitations')
        if not r.get('limitations') or not r.get('validation_experiment'):
            err(f'{rid}: candidate relation needs limitations and validation experiment')
    for cid, c in conflicts.items():
        need(c, ['fact_ids', 'description', 'resolution', 'impact'], cid)
        refs(c, 'fact_ids', facts, cid, True)
    if not isinstance(d.get('inventory'), list) or not d.get('inventory'):
        err('inventory must be a nonempty list')
    else:
        for entry in d['inventory']:
            need(entry, ['locator', 'pages', 'disposition', 'note'], 'inventory')
    # Check nested numeric values, including curves/tensors, for non-JSON numbers.
    def finite_walk(v):
        if isinstance(v, float) and not math.isfinite(v): err('Non-finite numeric value anywhere in document')
        elif isinstance(v, dict):
            for child in v.values(): finite_walk(child)
        elif isinstance(v, list):
            for child in v: finite_walk(child)
    finite_walk(d)
    summaries = []
    for gid in groups:
        fs = [f for f in facts.values() if f.get('group_id') == gid and f.get('value') is not None]
        reported_stages = {f.get('stage') for f in fs if f.get('origin') in {'reported', 'digitized'}}
        quantitative_stages = {f.get('stage') for f in fs if f.get('origin') in {'reported', 'digitized'}
                               and f.get('measurement') == 'quantitative' and f.get('state') != 'post_failure'}
        cs = [c for c in coverage if isinstance(c, dict) and c.get('group_id') == gid]
        full = len(cs) == 15 and all(c.get('status') in {'quantitative', 'qualitative', 'reported_setting', 'not_applicable'}
                                     and not c.get('missing_fields') for c in cs)
        summaries.append({'group_id': gid, 'has_reported_xyz': set('XYZ').issubset(reported_stages),
                          'has_quantitative_xyz': set('XYZ').issubset(quantitative_stages),
                          'all_core_fields_covered': full,
                          'categories_with_gaps': [c['category'] for c in cs if c.get('missing_fields')]})
    clusters = Counter(g.get('possible_duplicate_cluster') for g in groups.values() if g.get('possible_duplicate_cluster'))
    return {'valid': not errors, 'errors': errors, 'warnings': warnings,
            'scope': 'Contract/reference/unit checks only; source truth and completeness require human/LLM page review.',
            'counts': {'group_records': len(groups), 'facts': len(facts), 'evidence': len(evidence),
                       'numeric_Z_cells': sum(f.get('stage') == 'Z' and numeric(f.get('value')) for f in facts.values()),
                       'independent_experimental_samples': None,
                       'possible_duplicate_clusters': dict(clusters)},
            'groups': summaries}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('json_path', type=Path)
    p.add_argument('--summary', type=Path)
    a = p.parse_args()
    try:
        result = validate(json.loads(a.json_path.read_text(encoding='utf-8')))
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
        result = {'valid': False, 'errors': [f'Cannot validate input: {exc}'], 'warnings': []}
    output = json.dumps(result, ensure_ascii=False, indent=2)
    if a.summary:
        a.summary.parent.mkdir(parents=True, exist_ok=True)
        a.summary.write_text(output + '\n', encoding='utf-8')
    print(output)
    raise SystemExit(0 if result['valid'] else 1)


if __name__ == '__main__':
    main()
