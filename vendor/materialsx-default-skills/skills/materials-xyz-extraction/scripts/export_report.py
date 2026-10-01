#!/usr/bin/env python3
"""Export a validated extraction to CSV and a readable Chinese Markdown report."""
import argparse
import csv
import json
from pathlib import Path
from validate_extraction import CATEGORIES, validate

LABELS = dict(zip(sum(CATEGORIES.values(), []), ['配方', '上浆', '预浸方式', '温压历史', '冷却历史',
    '孔隙', '浸渍', '结晶', '取向', '残余应力', '界面', '刚度', '强度', '层间韧性', '疲劳']))
STATUS = {'quantitative': '有定量值', 'qualitative': '定性', 'proxy_only': '仅代理证据',
          'reported_setting': '有工艺设定', 'partial': '部分报告', 'not_reported': '未报告',
          'not_applicable': '不适用', 'not_accessible': '未获取'}


def cell(v):
    if v is None: return ''
    if isinstance(v, (int, float)): return v
    if isinstance(v, (dict, list)): return json.dumps(v, ensure_ascii=False)
    s = str(v)
    # Avoid spreadsheet formula execution for arbitrary paper text.
    return "'" + s if s.startswith(('=', '+', '-', '@', '\t', '\r')) else s


def md(v):
    if isinstance(v, float): return f'{v:g}'
    return str(v).replace('|', '\\|').replace('\n', ' ')


def export(d, out):
    result = validate(d)
    if not result['valid']:
        raise ValueError('\n'.join(result['errors']))
    out.mkdir(parents=True, exist_ok=True)
    (out / 'validation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    evidence = {e['id']: e for e in d['evidence']}
    fields = ['id', 'group_id', 'stage', 'category', 'metric', 'value', 'unit', 'raw_value', 'raw_unit',
              'origin', 'measurement', 'state', 'protocol_id', 'evidence_ids', 'source_locations',
              'normalization', 'inherited_from', 'uncertainty', 'note']
    with (out / 'facts.csv').open('w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader()
        for fact in d['facts']:
            row = {k: cell(fact.get(k)) for k in fields}
            row['source_locations'] = '; '.join(f"p.{evidence[e]['page']} {evidence[e]['locator']}" for e in fact['evidence_ids'])
            w.writerow(row)
    selected = ['molding_temperature', 'molding_pressure', 'holding_time', 'heating_rate', 'cooling_rate',
                'ilss', 'flexural_strength', 'flexural_modulus', 'tensile_strength', 'tensile_modulus']
    rows = []
    for g in d['groups']:
        facts = {}
        for fact in d['facts']:
            if fact['group_id'] == g['id']:
                facts.setdefault(fact['metric'], []).append(fact)
        row = {k: g.get(k) for k in ['id', 'series', 'label', 'batch_id', 'linkage_level', 'possible_duplicate_cluster']}
        for metric in selected:
            observations = facts.get(metric, [])
            if len(observations) > 1:
                row[metric] = [dict(fact_id=f['id'], value=f['value'], unit=f['unit'],
                                    protocol_id=f['protocol_id']) for f in observations]
                row[metric + '_unit'] = 'see individual observations'
            else:
                observation = observations[0] if observations else {}
                row[metric] = observation.get('value')
                row[metric + '_unit'] = observation.get('unit')
        rows.append(row)
    with (out / 'groups.csv').open('w', encoding='utf-8-sig', newline='') as f:
        names = ['id', 'series', 'label', 'batch_id', 'linkage_level', 'possible_duplicate_cluster']
        names += [x for m in selected for x in (m, m + '_unit')]
        w = csv.DictWriter(f, fieldnames=names); w.writeheader()
        for row in rows: w.writerow({k: cell(v) for k, v in row.items()})
    src = d['source']; counts = result['counts']; gs = result['groups']
    lines = ['# 材料 X → Y → Z 提取报告', '', src['title'], '',
             f"DOI：{src.get('doi')}。版本：{src['version_note']}", '',
             f"源文件：{src['path']}；SHA-256：`{src['sha256']}`。", '',
             '## 提取结论', '',
             f"- 工艺组表格记录：{counts['group_records']}；Z 数值单元格：{counts['numeric_Z_cells']}。",
             '- 这些记录不是独立试件数；重复基准保留，实际独立实验样本数未知。',
             f"- 三层均有原文证据：{sum(g['has_reported_xyz'] for g in gs)} 组；三层均有定量测量支持：{sum(g['has_quantitative_xyz'] for g in gs)} 组。",
             f"- 15 类核心字段全覆盖：{sum(g['all_core_fields_covered'] for g in gs)} 组。",
             '- 校验通过仅表示格式、关联和部分单位检查通过；不表示因果关系成立。', '',
             '## 工艺与性能', '', '模量已统一为 MPa；原始 GPa 值在 JSON 和 facts.csv 中保留。', '',
             '| 组 | 温度 °C | 压力 MPa | 保温 min | ILSS MPa | 弯曲强度 MPa | 弯曲模量 MPa | 拉伸强度 MPa | 拉伸模量 MPa |',
             '|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    for r in rows:
        keys = ['id', 'molding_temperature', 'molding_pressure', 'holding_time', 'ilss', 'flexural_strength',
                'flexural_modulus', 'tensile_strength', 'tensile_modulus']
        lines.append('| ' + ' | '.join(md(r.get(k, '')) for k in keys) + ' |')
    lines += ['', '## 15 类字段覆盖', '', '| 类别 | 本文覆盖状态 | 仍缺字段 |', '|---|---|---|']
    for category, label in LABELS.items():
        cs = [c for c in d['coverage'] if c['category'] == category]
        states = sorted({STATUS[c['status']] for c in cs})
        gaps = sorted({m for c in cs for m in c['missing_fields']})
        lines.append(f"| {label} | {'、'.join(states)} | {md('；'.join(gaps) or '本次类别检查未发现缺项')} |")
    lines += ['', '## 候选关系与验证', '']
    for r in d['relations']:
        lines += [f"### {r['id']} · {r['layer']} · {r['kind']}", '', r['claim'], '',
                  f"工艺组：{', '.join(r['group_ids'])}。关联方式：{r['linkage_level']}。", '',
                  '证据：' + '；'.join(f"p.{evidence[e]['page']} {evidence[e]['locator']}" for e in r['evidence_ids']), '',
                  '限制：' + '；'.join(r['limitations']), '',
                  '验证：' + r['validation_experiment'], '']
    lines += ['## 原文冲突与重复风险', '']
    for c in d['conflicts']:
        lines += [f"- **{c['id']}**：{c['description']} 处理：{c['resolution']}；影响：{c['impact']}"]
    for issue in d.get('source_issues', []): lines += [f'- {issue}']
    lines += ['', '## 图表盘点', '', '| 原文位置 | PDF 页码 | 处理 | 说明 |', '|---|---|---|---|']
    for item in d['inventory']:
        lines += [f"| {md(item['locator'])} | {md(item['pages'])} | {item['disposition']} | {md(item['note'])} |"]
    lines += ['', '## 阅读边界', '',
              '本结果按论文工艺组关联 X、Y、Z。定性图像、作者解释、断后状态和数值实测保持分开；未做图像孔隙率估计、曲线数字化或模拟补数。', '',
              '完整字段及证据：extraction.json；事实长表：facts.csv；工艺性能宽表：groups.csv；机器校验：validation.json。', '']
    (out / 'report.md').write_text('\n'.join(lines), encoding='utf-8')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('json_path', type=Path)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    export(json.loads(a.json_path.read_text(encoding='utf-8')), a.out)
    print(f'Exported facts.csv, groups.csv, report.md and validation.json to {a.out}')


if __name__ == '__main__': main()
