#!/usr/bin/env python3
"""Build the published JSON Schema, vocabulary and empty template from one definition."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'references/xyz-v2'
VERSION = '2.0.0'
CATEGORIES = {
 'X': {'formulation':'配方与原料身份','sizing':'上浆与表面处理','impregnation_route':'预浸及浸渍路线',
       'thermopress_history':'温度压力与保温历史','cooling_history':'冷却与卸压历史'},
 'Y': {'porosity':'孔隙','impregnation_quality':'浸渍质量','crystallinity':'结晶状态',
       'orientation':'实际取向与波纹','residual_stress':'残余应力','interface':'界面状态'},
 'Z': {'stiffness':'刚度','strength':'强度','interlaminar_toughness':'层间断裂韧性','fatigue':'疲劳'} }
STATUSES = ['quantitative','qualitative','proxy_only','reported_setting','partial',
            'not_reported','not_applicable','not_accessible','not_yet_extracted']
METRICS = [
 ('X','formulation','material_identity','原料身份','categorical',None),
 ('X','formulation','fiber_volume_fraction','增强体体积分数','scalar','1'),
 ('X','formulation','fiber_mass_fraction','增强体质量分数','scalar','1'),
 ('X','formulation','ply_sequence','设计铺层序列','schedule',None),
 ('X','sizing','sizing_chemistry','上浆化学组成','text',None),
 ('X','sizing','sizing_mass_fraction','上浆质量分数','scalar','1'),
 ('X','impregnation_route','route','预浸或浸渍路线','categorical',None),
 ('X','thermopress_history','film_drying_temperature','薄膜干燥温度','scalar','degC'),
 ('X','thermopress_history','film_drying_time','薄膜干燥时间','scalar','min'),
 ('X','thermopress_history','molding_temperature','成型温度','scalar','degC'),
 ('X','thermopress_history','molding_pressure','成型压力','scalar','MPa'),
 ('X','thermopress_history','holding_time','保温时间','scalar','min'),
 ('X','thermopress_history','heating_rate','升温速率','scalar','degC/min'),
 ('X','thermopress_history','vacuum_absolute_pressure','真空绝对压力','scalar','Pa'),
 ('X','thermopress_history','ordered_program','有序工艺步骤','schedule',None),
 ('X','thermopress_history','temperature_time_curve','温度时间曲线','series',None),
 ('X','thermopress_history','pressure_time_curve','压力时间曲线','series',None),
 ('X','thermopress_history','precompaction','预压状态','categorical',None),
 ('X','cooling_history','cooling_rate','冷却速率','scalar','degC/min'),
 ('X','cooling_history','cooling_endpoint','冷却终点描述','text',None),
 ('Y','porosity','porosity_fraction','孔隙体积分数','scalar','1'),
 ('Y','porosity','pore_size_distribution','孔径分布','series',None),
 ('Y','porosity','internal_defect_map_proxy','内部缺陷图代理','text',None),
 ('Y','impregnation_quality','impregnation_fraction','已浸渍比例','scalar','1'),
 ('Y','impregnation_quality','resin_coverage_fractography','断口树脂覆盖代理','text',None),
 ('Y','crystallinity','crystallinity_fraction','结晶度','scalar','1'),
 ('Y','crystallinity','crystal_phase','晶型','categorical',None),
 ('Y','orientation','orientation_tensor','取向张量','tensor','1'),
 ('Y','orientation','fiber_waviness_amplitude','纤维波纹幅值','scalar','mm'),
 ('Y','orientation','fiber_waviness_wavelength','纤维波纹波长','scalar','mm'),
 ('Y','residual_stress','residual_stress_tensor','残余应力张量','tensor','MPa'),
 ('Y','interface','interface_fractography','断口界面代理','text',None),
 ('Y','interface','interface_shear_strength','尺度明确的界面剪切强度','scalar','MPa'),
 ('Z','stiffness','flexural_modulus','弯曲模量','scalar','MPa'),
 ('Z','stiffness','tensile_modulus','拉伸模量','scalar','MPa'),
 ('Z','stiffness','shear_modulus','剪切模量','scalar','MPa'),
 ('Z','strength','ilss','短梁层间剪切强度','scalar','MPa'),
 ('Z','strength','flexural_strength','弯曲强度','scalar','MPa'),
 ('Z','strength','tensile_strength','拉伸强度','scalar','MPa'),
 ('Z','strength','compressive_strength','压缩强度','scalar','MPa'),
 ('Z','interlaminar_toughness','mode_I_interlaminar_fracture_energy','I型层间断裂能','scalar','J/m2'),
 ('Z','interlaminar_toughness','mode_II_interlaminar_fracture_energy','II型层间断裂能','scalar','J/m2'),
 ('Z','fatigue','fatigue_life','疲劳寿命','scalar','cycle'),
 ('Z','fatigue','sn_curve','S-N曲线','series',None),
]


def obj(properties, required=None):
    return {'type':'object','properties':properties,'required':list(properties) if required is None else required,
            'additionalProperties':False}


def arr(items, minimum=0): return {'type':'array','items':items,'minItems':minimum}
def enum(values): return {'enum':values}
def ref(name): return {'$ref':f'#/$defs/{name}'}
def nullable(schema): return {'anyOf':[schema,{'type':'null'}]}
TEXT = {'type':'string','minLength':1}
ID = {'type':'string','pattern':'^[A-Za-z0-9][A-Za-z0-9_.:-]*$'}
IDS = {'type':'array','items':ID,'uniqueItems':True}
UNKNOWN = {}  # Deliberately limited to original excerpts, method details and provenance payloads.
NUMBER = {'type':'number'}


def build():
    axes = obj({'name':TEXT,'unit':TEXT})
    series = obj({'axes':arr(axes,2),'points':arr(arr(NUMBER,2),1),
                  'condition_note':TEXT})
    tensor = obj({'shape':arr({'type':'integer','minimum':1},1),
                  'components':arr(NUMBER,1),'coordinate_system':TEXT,'component_order':TEXT})
    q = obj({'kind':enum(['scalar','text','categorical','boolean','vector','tensor','series','schedule','image_reference']),
             'data':UNKNOWN,'unit':nullable(TEXT),'basis':nullable(TEXT)})
    q['allOf'] = []
    for kind, data in [('scalar',NUMBER),('text',TEXT),('categorical',TEXT),('boolean',{'type':'boolean'}),
                       ('vector',arr(NUMBER,1)),('tensor',tensor),('series',series),
                       ('schedule',arr({'type':'object'},1)),
                       ('image_reference',obj({'source_id':ID,'page':{'type':'integer','minimum':1},'locator':TEXT}))]:
        q['allOf'].append({'if':{'properties':{'kind':{'const':kind}}},'then':{'properties':{'data':data}}})
    q['allOf'].append({'if':{'properties':{'kind':enum(['scalar','vector','tensor'])}},
                       'then':{'properties':{'unit':TEXT}}})
    uncertain = obj({'type':enum(['SD','SE','CI','range','instrument','other']),
                     'value':UNKNOWN,'unit':nullable(TEXT),'confidence_level':nullable(NUMBER),'note':TEXT})
    observation = obj({
      'id':ID,'metric':TEXT,'label':TEXT,'definition':nullable(TEXT),'value':q,
      'raw':obj({'value':UNKNOWN,'unit':nullable(TEXT)}),
      'origin':enum(['reported','digitized','calculated','simulated','author_interpretation','model_hypothesis']),
      'measurement':enum(['quantitative','qualitative','proxy','not_measurement']),
      'state':enum(['as_manufactured','post_failure','during_process','during_test','not_applicable','unknown']),
      'acquisition':enum(['nominal_setting','measured','inferred','simulated','unknown']),
      'protocol_id':nullable(ID),'specimen_id':nullable(ID),'evidence_ids':IDS,
      'inherited_from':nullable(TEXT),'normalization':nullable(TEXT),'derivation':nullable({'type':'object'}),
      'uncertainty':nullable(uncertain),'qualifiers':{'type':'object'},'note':{'type':'string'}})
    field = obj({'status':enum(STATUSES),'observations':arr(ref('observation')),
                 'missing_fields':arr(TEXT),'note':{'type':'string'}})
    defs = {'quantity':q,'observation':observation,'field':field}
    for stage,cats in CATEGORIES.items(): defs[stage]=obj({cat:ref('field') for cat in cats})
    defs['record'] = obj({'record_id':ID,'source_ids':dict(IDS,minItems=1),
      'material_system_id':ID,'label':TEXT,'series':TEXT,
      'lineage':obj({'generated_id':{'type':'boolean'},'unit':enum(['condition_group','batch','specimen']),
                     'batch_id':nullable(ID),'specimen_ids':IDS,'parent_record_ids':IDS,
                     'same_specimen_xyz':enum(['confirmed','not_confirmed','not_applicable']),
                     'possible_duplicate_cluster':nullable(TEXT),'linkage_evidence_ids':dict(IDS,minItems=1)}),
      'X':ref('X'),'Y':ref('Y'),'Z':ref('Z')})
    fraction = obj({'value':{'type':'number','minimum':0,'maximum':1},
                    'basis':enum(['mass','volume','mole','area','other']),
                    'denominator':TEXT,'evidence_ids':dict(IDS,minItems=1)})
    constituent=obj({'id':ID,'role':enum(['matrix','reinforcement','filler','additive','sizing','coating','precursor','solvent','other']),
       'name':TEXT,'family':enum(['metal','ceramic','polymer','carbon','glass','biological','composite','other','unknown']),
       'grade':nullable(TEXT),'supplier':nullable(TEXT),'fraction':nullable(fraction),
       'attributes':arr(obj({'name':TEXT,'value':q,'raw':obj({'value':UNKNOWN,'unit':nullable(TEXT)}),
                            'normalization':nullable(TEXT),'evidence_ids':dict(IDS,minItems=1)})),
       'evidence_ids':dict(IDS,minItems=1)})
    defs['material_system']=obj({'id':ID,'name':TEXT,
      'family':enum(['metal','ceramic','polymer','carbon','glass','biological','composite','other','unknown']),
      'constituents':arr(constituent,1),'evidence_ids':dict(IDS,minItems=1)})
    defs['source']=obj({'id':ID,'kind':enum(['paper','supplement','experiment_log','simulation_report']),
       'title':TEXT,'doi':nullable(TEXT),'publication_year':nullable({'type':'integer','minimum':1500,'maximum':3000}),
       'version_note':TEXT,'file_name':TEXT,'local_path':nullable(TEXT),
       'sha256':{'type':'string','pattern':'^[0-9a-f]{64}$'},'page_count':{'type':'integer','minimum':1},
       'supplementary_status':TEXT})
    defs['evidence']=obj({'id':ID,'source_id':ID,'page':{'type':'integer','minimum':1},'locator':TEXT,
       'excerpt':TEXT,'excerpt_kind':enum(['verbatim','paraphrase','image_observation']),
       'review':enum(['text_checked','visual_checked'])})
    defs['protocol']=obj({'id':ID,'name':TEXT,'method':TEXT,'standard':nullable(TEXT),
      'conditions':{'type':'object'},'specimen':{'type':'object'},
      'replicates':obj({'minimum':nullable({'type':'integer','minimum':1}),
                       'exact':nullable({'type':'integer','minimum':1}),
                       'batch_replication':nullable({'type':'integer','minimum':1}),
                       'error_bar_definition':nullable(TEXT)}),'evidence_ids':dict(IDS,minItems=1)})
    defs['relation']=obj({'id':ID,'layer':enum(['f1','f2','direct_XZ']),
      'kind':enum(['association','author_mechanism','model_hypothesis','reported_model']),
      'linkage_level':enum(['within_group','across_group_comparison']),
      'record_ids':dict(IDS,minItems=1),'from_observation_ids':dict(IDS,minItems=1),
      'to_observation_ids':dict(IDS,minItems=1),'evidence_ids':IDS,'claim':TEXT,
      'controls':arr(TEXT),'confounders':arr(TEXT),'limitations':arr(TEXT,1),
      'validation_experiment':TEXT,'model':nullable({'type':'object'})})
    defs['quality_issue']=obj({'id':ID,'type':enum(['source_conflict','duplicate_risk','source_quality','linkage_limitation','other']),
       'observation_ids':IDS,'evidence_ids':IDS,'description':TEXT,'resolution':TEXT,'impact':TEXT})
    defs['inventory']=obj({'source_id':ID,'locator':TEXT,'pages':arr({'type':'integer','minimum':1},1),
       'disposition':enum(['extracted','qualitative_only','not_digitized','context_only','not_accessible']),
       'note':TEXT})
    schema=obj({'ontology':obj({'name':{'const':'Materials XYZ Ontology'},'version':{'const':VERSION},
                                'profile':{'const':'reinforced-thermoplastic-composites'}}),
      'document_id':ID,
      'extraction':obj({'status':enum(['template','draft','complete']),'tool':TEXT,'date':{'type':'string','format':'date'},
                        'scope':TEXT,'source_review':enum(['pending','text_only','critical_pages_visual_checked']),
                        'limitations':arr(TEXT)}),
      'sources':arr(ref('source')),'material_systems':arr(ref('material_system')),
      'protocols':arr(ref('protocol')),'evidence':arr(ref('evidence')),'records':arr(ref('record')),
      'relations':arr(ref('relation')),'quality_issues':arr(ref('quality_issue')),
      'inventory':arr(ref('inventory')),'supporting_context':arr({'type':'object'})})
    schema.update({'$schema':'https://json-schema.org/draft/2020-12/schema',
                   '$id':'urn:materials-xyz:schema:2.0.0',
                   'title':'Materials XYZ Ontology 2.0.0 — project data standard', '$defs':defs})
    schema['allOf']=[{'if':{'properties':{'extraction':{'properties':{'status':{'const':'complete'}}}}},
                      'then':{'properties':{k:{'minItems':1} for k in ['sources','material_systems','evidence','records','inventory']}}}]
    vocab={'ontology_version':VERSION,'categories':CATEGORIES,'field_statuses':STATUSES,
           'unit_policy':{'stress_and_modulus':'MPa','temperature':'degC','duration':'min','length':'mm',
                          'dimensionless':'1','fracture_energy':'J/m2','fatigue_life':'cycle'},
           'metrics':{key:dict(stage=s,category=c,label=label,kind=kind,unit=unit) for s,c,key,label,kind,unit in METRICS},
           'extension_policy':'Unregistered metrics must start with ext. and provide a nonempty definition; never guess a standard key.'}
    template={'ontology':{'name':'Materials XYZ Ontology','version':VERSION,'profile':'reinforced-thermoplastic-composites'},
      'document_id':'new-study','extraction':{'status':'template','tool':'materials-xyz-extraction',
        'date':'2026-09-30','scope':'单项研究及已提供的配套材料；填写实际提取日期。','source_review':'pending',
        'limitations':['空模板无来源、无样本、不可用于训练。']},
      **{key:[] for key in ['sources','material_systems','protocols','evidence','records','relations','quality_issues','inventory','supporting_context']}}
    record_template={'record_id':'group-001','source_ids':[],'material_system_id':'material-001','label':'待提取工艺组','series':'待提取',
      'lineage':{'generated_id':True,'unit':'condition_group','batch_id':None,'specimen_ids':[],
                 'parent_record_ids':[],'same_specimen_xyz':'not_confirmed','possible_duplicate_cluster':None,'linkage_evidence_ids':[]},
      **{s:{c:dict(status='not_yet_extracted',observations=[],missing_fields=[],note='提取后逐项审查。') for c in cats} for s,cats in CATEGORIES.items()}}
    ROOT.mkdir(parents=True,exist_ok=True)
    for name,data in [('schema.json',schema),('vocabulary.json',vocab),('template.json',template),('record-template.json',record_template)]:
        (ROOT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'Built schema, vocabulary, empty template and record fragment: {ROOT}')


if __name__=='__main__': build()
