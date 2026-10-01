#!/usr/bin/env python3
"""Validate XYZ v2, migrate legacy v1, and export traceable training candidates."""
import argparse
import copy
from datetime import date
import json
import math
from pathlib import Path
import sys


def standard_root():
    skill = Path(__file__).resolve().parents[1] / 'references/xyz-v2'
    return skill if (skill/'schema.json').exists() else Path(__file__).resolve().parents[1]


def read(path): return json.loads(Path(path).read_text(encoding='utf-8'))
def save(path, data):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
def number(v): return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)
def unit(u): return {'°C':'degC','°C/min':'degC/min','μm':'um'}.get(u,u)
def quantity(kind,data,u=None,basis=None): return dict(kind=kind,data=data,unit=u,basis=basis)
def walk_observations(d):
    for record in d['records']:
        for stage in ['X','Y','Z']:
            for category,field in record[stage].items():
                for obs in field['observations']:
                    yield record,stage,category,obs


def validate(d, root=None, allow_incomplete=False):
    try:
        from jsonschema import Draft202012Validator, FormatChecker
    except ImportError:
        raise RuntimeError('jsonschema is required. Install requirements.txt into a virtual environment; validation has NOT run.')
    root = Path(root or standard_root())
    schema, vocab = read(root/'schema.json'), read(root/'vocabulary.json')
    Draft202012Validator.check_schema(schema)
    structural = list(Draft202012Validator(schema,format_checker=FormatChecker()).iter_errors(d))
    errors = [f"{'/'.join(map(str,e.absolute_path)) or 'root'}: {e.message}" for e in structural]
    result = {'valid':False,'schema_valid':not structural,'errors':errors,'warnings':[],
              'scope':'Structure and selected semantics; does not establish source truth, extraction completeness or causality.'}
    if structural: return result
    warn = result['warnings']
    def check(condition,message):
        if not condition: errors.append(message)
    def indexed(items,key,label):
        ids=[i[key] for i in items]
        check(len(ids)==len(set(ids)),f'{label}: duplicate IDs')
        return {i[key]:i for i in items}
    sources=indexed(d['sources'],'id','sources')
    evidence=indexed(d['evidence'],'id','evidence')
    materials=indexed(d['material_systems'],'id','material_systems')
    protocols=indexed(d['protocols'],'id','protocols')
    records=indexed(d['records'],'record_id','records')
    indexed(d['relations'],'id','relations'); indexed(d['quality_issues'],'id','quality_issues')
    observations={}
    for r,s,c,o in walk_observations(d):
        check(o['id'] not in observations,f'{o["id"]}: duplicate observation ID')
        observations[o['id']]=(r,s,c,o)
    def references(ids,target,where):
        for value in ids: check(value in target,f'{where}: unknown reference {value}')
    def finite(v):
        if isinstance(v,float): check(math.isfinite(v),'Non-finite JSON numeric value')
        elif isinstance(v,dict):
            for x in v.values(): finite(x)
        elif isinstance(v,list):
            for x in v: finite(x)
    finite(d)
    complete = d['extraction']['status']=='complete'
    check(complete or allow_incomplete,'Document is not complete; templates/drafts cannot pass completed-extraction validation')
    if complete: check(d['extraction']['source_review']!='pending','Complete extraction has pending source review')
    for e in evidence.values():
        references([e['source_id']],sources,e['id'])
        if e['source_id'] in sources:
            check(e['page']<=sources[e['source_id']]['page_count'],f'{e["id"]}: page outside source')
    for m in materials.values():
        references(m['evidence_ids'],evidence,m['id'])
        indexed(m['constituents'],'id',m['id']+'.constituents')
        for c in m['constituents']:
            references(c['evidence_ids'],evidence,c['id'])
            if c['fraction']: references(c['fraction']['evidence_ids'],evidence,c['id']+'.fraction')
            for a in c['attributes']: references(a['evidence_ids'],evidence,c['id']+'.attributes')
    for p in protocols.values():
        references(p['evidence_ids'],evidence,p['id'])
        rep=p['replicates']
        if rep['minimum'] is not None and rep['exact'] is not None:
            check(rep['exact']>=rep['minimum'],f'{p["id"]}: inconsistent replicate counts')
    for rid,r in records.items():
        references(r['source_ids'],sources,rid)
        references([r['material_system_id']],materials,rid)
        lin=r['lineage']
        references(lin['linkage_evidence_ids'],evidence,rid)
        references(lin['parent_record_ids'],records,rid)
        check(rid not in lin['parent_record_ids'],f'{rid}: record cannot be its own parent')
        if lin['unit']=='batch': check(bool(lin['batch_id']),f'{rid}: batch lineage missing batch_id')
        if lin['unit']=='specimen': check(bool(lin['specimen_ids']),f'{rid}: specimen lineage missing specimen IDs')
        if lin['same_specimen_xyz']=='confirmed':
            check(lin['unit']=='specimen' and len(lin['specimen_ids'])==1,
                  f'{rid}: same-specimen claim requires an explicit single-specimen record')
        for stage in ['X','Y','Z']:
            for category,field in r[stage].items():
                at=f'{rid}.{stage}.{category}'; obs=field['observations']; status=field['status']
                if complete: check(status!='not_yet_extracted',f'{at}: unaudited field in complete document')
                if status in ['not_reported','not_accessible','not_applicable','not_yet_extracted']:
                    check(not obs,f'{at}: missing/inapplicable field cannot contain observations')
                else: check(bool(obs),f'{at}: coverage claim without observations')
                if status in ['not_reported','not_accessible']:
                    check(bool(field['missing_fields']),f'{at}: missing_fields must explain absence')
                if status=='not_applicable': check(bool(field['note']),f'{at}: inapplicability needs a reason')
                if status=='quantitative': check(any(o['measurement']=='quantitative' for o in obs),f'{at}: no quantitative observation')
    for oid,(r,stage,category,o) in observations.items():
        q=o['value']; metric=o['metric']; definition=vocab['metrics'].get(metric)
        if definition:
            check((stage,category)==(definition['stage'],definition['category']),f'{oid}: wrong ontology category for {metric}')
            check(q['kind']==definition['kind'],f'{oid}: wrong value kind for {metric}')
            check(q['unit']==definition['unit'],f'{oid}: noncanonical unit for {metric}')
        else:
            check(metric.startswith('ext.') and bool(o['definition']),f'{oid}: custom metric requires ext. namespace and definition')
        references(o['evidence_ids'],evidence,oid)
        if o['origin']!='model_hypothesis': check(bool(o['evidence_ids']),f'{oid}: missing source evidence')
        for eid in o['evidence_ids']:
            if eid in evidence: check(evidence[eid]['source_id'] in r['source_ids'],f'{oid}: evidence outside record sources')
        if o['protocol_id'] is not None: references([o['protocol_id']],protocols,oid)
        if stage in ['Y','Z'] and o['measurement']=='quantitative':
            check(o['protocol_id'] is not None,f'{oid}: quantitative Y/Z requires protocol')
        if o['specimen_id'] is not None:
            check(o['specimen_id'] in r['lineage']['specimen_ids'],f'{oid}: specimen outside record lineage')
        if r['lineage']['same_specimen_xyz']=='confirmed':
            check(o['specimen_id'] in r['lineage']['specimen_ids'],f'{oid}: same-specimen claim lacks observation linkage')
        if o['measurement']=='quantitative':
            check(q['kind'] in ['scalar','vector','tensor','series'],f'{oid}: nonnumeric quantitative observation')
        if o['origin'] in ['digitized','calculated','simulated']:
            check(bool(o['derivation']),f'{oid}: {o["origin"]} requires derivation')
        if o['origin']=='simulated': check(o['acquisition']=='simulated',f'{oid}: simulation tagged as measurement')
        if metric.endswith('_fraction') and q['kind']=='scalar':
            check(q['unit']=='1' and 0<=q['data']<=1,f'{oid}: invalid physical fraction')
            check(bool(q['basis']),f'{oid}: fraction requires basis/denominator')
        if q['kind']=='tensor':
            check(math.prod(q['data']['shape'])==len(q['data']['components']),f'{oid}: tensor shape mismatch')
        if q['kind']=='series':
            check(all(len(p)==len(q['data']['axes']) for p in q['data']['points']),f'{oid}: series axes/point dimensions mismatch')
        if q['kind']=='image_reference':
            references([q['data']['source_id']],sources,oid)
            if q['data']['source_id'] in sources:
                check(q['data']['page']<=sources[q['data']['source_id']]['page_count'],f'{oid}: image page outside source')
        raw=o['raw']
        if q['kind']=='scalar' and number(raw['value']):
            ru,cu=unit(raw['unit']),q['unit']; value=q['data']
            factors={('GPa','MPa'):1000,('kJ/m2','J/m2'):1000,('%','1'):.01,
                     ('h','min'):60,('s','min'):1/60,('um','mm'):.001,('cm','mm'):10}
            factor=1 if ru==cu else factors.get((ru,cu))
            if factor is not None:
                check(math.isclose(raw['value']*factor,value,rel_tol=1e-9,abs_tol=1e-10),f'{oid}: wrong unit conversion')
            if ru!=cu: check(bool(o['normalization']),f'{oid}: missing conversion formula')
        if stage=='Y' and o['state']=='post_failure': warn.append(f'{oid}: excluded from initial-state quantitative Y training features')
    for relation in d['relations']:
        rid=relation['id']; references(relation['record_ids'],records,rid)
        references(relation['evidence_ids'],evidence,rid)
        if relation['kind']!='model_hypothesis': check(bool(relation['evidence_ids']),f'{rid}: missing relation evidence')
        references(relation['from_observation_ids'],observations,rid)
        references(relation['to_observation_ids'],observations,rid)
        left=[observations[x] for x in relation['from_observation_ids'] if x in observations]
        right=[observations[x] for x in relation['to_observation_ids'] if x in observations]
        expected={'f1':('X','Y'),'f2':('Y','Z'),'direct_XZ':('X','Z')}[relation['layer']]
        check(all(x[1]==expected[0] for x in left) and all(x[1]==expected[1] for x in right),f'{rid}: endpoint stage mismatch')
        lg={x[0]['record_id'] for x in left}; rg={x[0]['record_id'] for x in right}
        check((lg|rg)<=set(relation['record_ids']),f'{rid}: undeclared endpoint record')
        check(lg==rg,f'{rid}: endpoint records do not match; do not link another groups Y as this groups input')
        if relation['linkage_level']=='within_group': check(len(lg|rg)==1,f'{rid}: within_group crosses records')
        if relation['layer']=='f2' and relation['kind'] in ['association','reported_model']:
            check(not any(x[3]['state']=='post_failure' for x in left),f'{rid}: post-failure Y cannot be forward mediator association/model')
        if relation['kind']=='reported_model': check(bool(relation['model']),f'{rid}: reported_model lacks model description')
    for issue in d['quality_issues']:
        references(issue['observation_ids'],observations,issue['id'])
        references(issue['evidence_ids'],evidence,issue['id'])
    for item in d['inventory']:
        references([item['source_id']],sources,'inventory')
        if item['source_id'] in sources:
            check(all(p<=sources[item['source_id']]['page_count'] for p in item['pages']),'Inventory page outside source')
    result['valid']=not errors
    result['counts']={'records':len(records),'observations':len(observations),'evidence':len(evidence),
                       'numeric_Z_cells':sum(s=='Z' and o['value']['kind']=='scalar' for _,s,_,o in observations.values()),
                       'independent_experimental_samples':None}
    result['template_only']=not complete
    return result


def migrate_v1(old):
    if old.get('schema_version')!='materials-xyz-1.0': raise ValueError('Expected materials-xyz-1.0')
    vocab=read(standard_root()/'vocabulary.json')
    s=old['source']; sid=s['id']
    d=read(standard_root()/'template.json')
    d['document_id']='study-'+(s.get('doi') or s['sha256'][:12]).replace('/','-')
    d['extraction']={'status':'complete','tool':'materials-xyz-extraction/v2 migration',
       'date':date.today().isoformat(),'scope':'转换已有v1提取结果；未新增原文事实。',
       'source_review':'critical_pages_visual_checked' if any(e['review']=='visual_checked' for e in old['evidence']) else 'text_only',
       'limitations':['复用原有来源核查标记；迁移不等于重新审阅论文。','本体完整不表示字段齐全或因果关系已识别。']}
    d['sources']=[{'id':sid,'kind':'paper','title':s['title'],'doi':s.get('doi'),
      'publication_year':s['publication_year'],'version_note':s['version_note'],
      'file_name':Path(s['path']).name,'local_path':s['path'],'sha256':s['sha256'],
      'page_count':s['page_count'],'supplementary_status':s['supplementary_status']}]
    d['evidence']=copy.deepcopy(old['evidence'])
    for e in d['evidence']: e.setdefault('excerpt_kind','paraphrase')
    for m in old['material_systems']:
        constituents=[]
        for i,c in enumerate(m['constituents']):
            attrs=[]
            if c.get('architecture'):
                attrs.append(dict(name='architecture',value=quantity('categorical',c['architecture']),
                                  raw={'value':c['architecture'],'unit':None},normalization=None,evidence_ids=m['evidence_ids']))
            if c.get('film_thickness'):
                val=c['film_thickness']
                if unit(val['unit'])!='um': raise ValueError('Review unsupported film thickness unit before migration')
                attrs.append(dict(name='film_thickness',value=quantity('scalar',val['value']/1000,'mm'),
                                  raw={'value':val['value'],'unit':val['unit']},normalization='mm = um / 1000',evidence_ids=m['evidence_ids']))
            fraction=None
            if c.get('fraction') is not None:
                if not number(c['fraction']) or c.get('fraction_basis') not in ['mass','volume','mole','area']:
                    raise ValueError('Review legacy composition value/basis before migration')
                fraction={'value':c['fraction'],'basis':c['fraction_basis'],
                          'denominator':'material system as reported','evidence_ids':m['evidence_ids']}
            # Only explicitly represented attributes are normalized; remaining legacy details are preserved in supporting_context.
            constituents.append(dict(id=f'{m["id"]}.component{i+1}',role=c['role'],name=c['name'],
               family={'carbon_nonmetal':'carbon','thermoplastic_polymer':'polymer'}.get(c.get('family'),'unknown'),
               grade=c.get('grade'),supplier=c.get('supplier'),fraction=fraction,attributes=attrs,evidence_ids=m['evidence_ids']))
        d['material_systems'].append(dict(id=m['id'],name=m['name'],family='composite',constituents=constituents,evidence_ids=m['evidence_ids']))
    for p in old['protocols']:
        p=copy.deepcopy(p)
        p['replicates']={k:p.get('replicates',{}).get(k) for k in ['minimum','exact','batch_replication','error_bar_definition']}
        d['protocols'].append(p)
    coverage={(c['group_id'],c['category']):c for c in old['coverage']}
    for g in old['groups']:
        r=dict(record_id=g['id'],source_ids=[sid],material_system_id=g['material_system_id'],label=g['label'],series=g['series'],
          lineage=dict(generated_id=g['generated_id'],unit=g['linkage_level'],batch_id=g['batch_id'],specimen_ids=g['specimen_ids'],
                       parent_record_ids=[],same_specimen_xyz='not_confirmed',possible_duplicate_cluster=g['possible_duplicate_cluster'],
                       linkage_evidence_ids=g['evidence_ids']))
        for stage,cats in vocab['categories'].items():
            r[stage]={}
            for category in cats:
                cv=coverage[(g['id'],category)]
                r[stage][category]=dict(status=cv['status'],observations=[],missing_fields=cv['missing_fields'],note=cv['note'])
        for f in old['facts']:
            if f['group_id']!=g['id']: continue
            if f['value'] is None:
                field=r[f['stage']][f['category']]
                field['missing_fields'].append(f['metric']+': '+f.get('note','missing'))
                continue
            spec=vocab['metrics'].get(f['metric'])
            if not spec: raise ValueError(f'Unmapped metric {f["metric"]}; define it explicitly before migration')
            acquisition=('nominal_setting' if f['stage']=='X' else
                         'simulated' if f['origin']=='simulated' else
                         'inferred' if f['origin'] in ['author_interpretation','model_hypothesis','calculated'] else 'measured')
            o=dict(id=f['id'],metric=f['metric'],label=spec['label'],definition=None,
              value=quantity(spec['kind'],f['value'],unit(f['unit'])),raw={'value':f['raw_value'],'unit':f['raw_unit']},
              origin=f['origin'],measurement=f['measurement'],state=f['state'],acquisition=acquisition,
              protocol_id=f['protocol_id'],specimen_id=None,evidence_ids=f['evidence_ids'],
              inherited_from=f['inherited_from'],normalization=f['normalization'],
              derivation=f.get('derivation') or f.get('digitization') or f.get('calculation') or f.get('simulation'),
              uncertainty=f.get('uncertainty'),qualifiers={},note=f['note'])
            if spec['kind']=='schedule': o['qualifiers']['history_type']='nominal_program'
            r[f['stage']][f['category']]['observations'].append(o)
        d['records'].append(r)
    for rel in old['relations']:
        r=copy.deepcopy(rel); r['record_ids']=r.pop('group_ids')
        r['from_observation_ids']=r.pop('from_fact_ids'); r['to_observation_ids']=r.pop('to_fact_ids'); r['model']=r.get('model')
        d['relations'].append(r)
    facts={f['id']:f for f in old['facts']}
    for conflict in old['conflicts']:
        d['quality_issues'].append(dict(id=conflict['id'],type='source_conflict',observation_ids=conflict['fact_ids'],
            evidence_ids=sorted({e for fid in conflict['fact_ids'] for e in facts[fid]['evidence_ids']}),
            description=conflict['description'],resolution=conflict['resolution'],impact=conflict['impact']))
    for i,issue in enumerate(old.get('source_issues',[]),1):
        d['quality_issues'].append(dict(id=f'source-issue-{i}',type='source_quality',observation_ids=[],evidence_ids=[],
            description=issue,resolution='retained_as_limitation',impact='训练前须保留此证据边界。'))
    d['inventory']=[dict(source_id=sid,**item) for item in old['inventory']]
    d['supporting_context']=copy.deepcopy(old.get('source_context',[]))
    d['supporting_context'].append({'migration_legacy_material_systems':copy.deepcopy(old['material_systems']),
                                  'note':'保存迁移前材料描述；未覆盖的属性不自动转成训练特征。'})
    return d


def subset(d, record_id):
    out=copy.deepcopy(d)
    out['records']=[r for r in out['records'] if r['record_id']==record_id]
    if not out['records']: raise ValueError('Unknown record_id: '+record_id)
    # Keep all study evidence/protocols to preserve provenance, but omit relations requiring other records.
    ids={o['id'] for _,_,_,o in walk_observations(out)}
    out['relations']=[r for r in out['relations'] if set(r['record_ids'])<={record_id}]
    for issue in out['quality_issues']: issue['observation_ids']=[x for x in issue['observation_ids'] if x in ids]
    out['extraction']['scope']=f'单条工艺组{record_id}示例；来源清单为整篇研究，上下文不代表全部记录已包含。'
    return out


def training_rows(d):
    conflicts={oid for q in d['quality_issues'] if q['resolution']=='unresolved' for oid in q['observation_ids']}
    src={s['id']:s for s in d['sources']}
    rows=[]
    for r in d['records']:
        grouped={'X':{},'Y':{},'Z':{}}; excluded=[]
        for stage in grouped:
            for cat,field in r[stage].items():
                for o in field['observations']:
                    initial_y=(o['measurement']=='quantitative' and o['state'] in ['as_manufactured','during_process'])
                    accepted=(o['origin'] in ['reported','digitized'] and o['id'] not in conflicts and
                              (stage=='X' or (stage=='Y' and initial_y) or (stage=='Z' and o['measurement']=='quantitative')))
                    if accepted:
                        grouped[stage][o['id']]={'metric':o['metric'],'category':cat,'value':o['value'],
                            'protocol_id':o['protocol_id'],'evidence_ids':o['evidence_ids'],'acquisition':o['acquisition']}
                    else:
                        reason=('unresolved_source_conflict' if o['id'] in conflicts else 'not_direct_quantitative_initial_Y_or_target')
                        excluded.append(dict(observation_id=o['id'],stage=stage,reason=reason))
        source_keys=sorted({src[s]['doi'] or src[s]['sha256'] for s in r['source_ids']})
        rows.append({'record_id':r['record_id'],'document_id':d['document_id'],
          'material_system_id':r['material_system_id'],'source_ids':r['source_ids'],
          'split_group':'study:'+'|'.join(source_keys),'possible_duplicate_cluster':r['lineage']['possible_duplicate_cluster'],
          'lineage_unit':r['lineage']['unit'],'features_and_targets':grouped,
          'missingness':{s:{c:{'status':f['status'],'missing_fields':f['missing_fields']} for c,f in r[s].items()} for s in ['X','Y','Z']},
          'candidate_task_fields':{'X_to_Z':bool(grouped['X'] and grouped['Z']),
                                   'X_to_quantitative_Y':bool(grouped['X'] and grouped['Y']),
                                   'quantitative_Y_to_Z':bool(grouped['Y'] and grouped['Z']),
                                   'quantitative_XYZ_chain':bool(grouped['X'] and grouped['Y'] and grouped['Z'])},
          'excluded_from_numeric_view':excluded,
          'note':'候选训练字段；无插补、无标准化拟合、无随机划分。材料属性和测试条件需通过ID连接主档；不构成可识别因果模型。'})
    return rows


def main():
    p=argparse.ArgumentParser(description=__doc__)
    sub=p.add_subparsers(dest='command',required=True)
    v=sub.add_parser('validate'); v.add_argument('input',type=Path); v.add_argument('--report',type=Path); v.add_argument('--allow-incomplete',action='store_true')
    m=sub.add_parser('migrate-v1'); m.add_argument('input',type=Path); m.add_argument('--out',type=Path,required=True); m.add_argument('--record',default=None)
    t=sub.add_parser('training'); t.add_argument('input',type=Path); t.add_argument('--out',type=Path,required=True)
    a=p.parse_args()
    try:
        data=read(a.input)
        if a.command=='migrate-v1':
            data=migrate_v1(data)
            if a.record: data=subset(data,a.record)
        result=validate(data,allow_incomplete=getattr(a,'allow_incomplete',False))
        if a.command=='validate':
            if a.report: save(a.report,result)
            print(json.dumps(result,ensure_ascii=False,indent=2))
        if not result['valid']:
            if a.command!='validate': print(json.dumps(result,ensure_ascii=False,indent=2))
            raise SystemExit(1)
        if a.command=='migrate-v1':
            save(a.out,data); print(f'Validated v2 extraction saved: {a.out}')
        if a.command=='training':
            rows=training_rows(data); a.out.parent.mkdir(parents=True,exist_ok=True)
            a.out.write_text(''.join(json.dumps(row,ensure_ascii=False,allow_nan=False)+'\n' for row in rows),encoding='utf-8')
            print(f'Exported {len(rows)} candidate training rows to {a.out}')
    except (OSError,ValueError,RuntimeError) as exc:
        print(str(exc),file=sys.stderr); raise SystemExit(2)


if __name__=='__main__': main()
