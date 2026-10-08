import {randomUUID} from 'node:crypto';
import {methodDescriptorSchema,methodInput,type MethodDescriptor,type MethodAssessment,type MethodRequest} from '../../contracts/src/research-methods.js';
import type {ResearchSnapshot} from '../../contracts/src/research-project.js';
import {ownedRow,sourceRows,comparisonSignature,compositionBasis,energyReference,leakageGroup,independentSample,stable} from './scientific-quality.js';
import {describe,fitLine,errorMetrics,mean} from './research-math.js';
import {sourceHash} from './data-source-router.js';
import type {SelectionAssessment} from '../../contracts/src/potential-packages.js';
export const methodRegistry:MethodDescriptor[]=[
  {id:'descriptive-summary',name:{zh:'原值描述统计',en:'Descriptive summary'},description:{zh:'相同单位与测试条件下汇总原值；独立重复未明确时不计算标准误。',en:'Summarize matching source values; no standard error without identified independent replicates.'},qualification:'fixed-algorithm',scope:['reported numeric observations'],requiredInputs:['owned observations','original unit','matching property/basis/conditions'],tool:'research_method_run',productionApproved:false},
  {id:'linear-fit',name:{zh:'线性最小二乘拟合',en:'Linear least squares'},description:{zh:'对选定成对观测拟合直线，显示残差和输入范围。拟合优度不代表预测准确。',en:'Fit selected paired observations; show residuals and input domain. Fit quality is not predictive accuracy.'},qualification:'fixed-algorithm',scope:['one numeric predictor','fixed original units'],requiredInputs:['at least 3 paired observations','matching source/conditions','nonconstant predictor'],tool:'research_method_run',productionApproved:false},
  {id:'grouped-linear-validation',name:{zh:'分组留出与基线对照',en:'Grouped holdout and baseline'},description:{zh:'按来源隔离训练、验证、测试，比较线性模型与训练集均值基线，单独显示外推点。',en:'Separate train/validation/test by source; compare linear prediction with the training-mean baseline and flag extrapolation.'},qualification:'fixed-algorithm',scope:['one numeric predictor','source-grouped evaluation'],requiredInputs:['frozen split labels','3 train + 1 validation + 2 test source groups','no source/sample leakage'],tool:'research_method_run',productionApproved:false},
  {id:'atomistic-screening',name:{zh:'已验证势的结构试算',en:'Qualified potential screening'},description:{zh:'使用现有 M6 检查结构、元素、物理范围、权重和环境；此处只给出路由，不新建计算器。',en:'Delegate structure, elements, physics, weights and environment gates to M6; return a route to the existing calculator.'},qualification:'delegated-m6',scope:['M6 qualified task/domain only'],requiredInputs:['imported project structure','M6 eligible runtime receipt','existing scientific execution authorization'],tool:'materials_science',productionApproved:false},
].map(m=>methodDescriptorSchema.parse(m));
export type MethodPoint={id:string;x:number|null;y:number;unit:string;xUnit:string|null;sourceGroup:string;sample:string|null;xRef:string|null;yRef:string;split?:'train'|'validation'|'test'};
export function methodPoints(request:MethodRequest,snapshots:ResearchSnapshot[]){
  const points:MethodPoint[]=[],reasons:string[]=[],seen=new Set<string>(),signatures=new Set<string>(),xSignatures=new Set<string>();
  const get=(ref:{snapshotId:string;observationId:string})=>{
    const s=snapshots.find(s=>s.id===ref.snapshotId);if(!s)throw Error('METHOD_SOURCE_NOT_OWNED');
    return {s,r:ownedRow(s,'observations',ref.observationId)};
  };
  for(const p of request.samples){
    const {s,r}=get(p.y),ref=s.id+':'+String(r.id),key=leakageGroup(s,r)+':'+stable({...r,id:null})+':'+(p.x?stable(get(p.x).r):'');
    if(seen.has(key)||points.some(p=>p.yRef===ref))reasons.push('DUPLICATE_SOURCE_OBSERVATION');seen.add(key);
    if(typeof r.value!=='number'||!Number.isFinite(r.value))reasons.push('NUMERIC_Y_REQUIRED');
    if(request.task==='validate'&&(r.origin??r.value_origin)==='predicted')reasons.push('PREDICTED_TARGET_IS_NOT_REFERENCE');
    if(typeof r.unit!=='string'||!r.unit.trim())reasons.push('ORIGINAL_UNIT_REQUIRED');
    if(!r.property||!r.conditions||typeof r.conditions!=='object'||!Object.keys(r.conditions).length)reasons.push('PROPERTY_AND_CONDITIONS_REQUIRED');
    if(/fraction|content|loading|含量|比例/i.test(String(r.property))&&compositionBasis(r)===null)reasons.push('COMPOSITION_BASIS_REQUIRED');
    if(/energy|能量/i.test(String(r.property))&&energyReference(r)===null)reasons.push('ENERGY_REFERENCE_REQUIRED');
    const evidence=r.evidence_ids as unknown[]|undefined;
    if(!Array.isArray(evidence)||!evidence.length||!evidence.every(id=>s.evidence.some(e=>e.locator===id)&&sourceRows(s,'readEvidence').some(e=>e.id===id||e.evidence_id===id)))reasons.push('READ_EVIDENCE_REQUIRED');
    signatures.add(comparisonSignature(r));
    let x:number|null=null,xUnit:string|null=null,xRef:string|null=null;
    if(request.task!=='summarize'){
      if(!p.x)reasons.push('PAIRED_X_REQUIRED');
      else{const a=get(p.x);x=typeof a.r.value==='number'?a.r.value:null;xUnit=typeof a.r.unit==='string'?a.r.unit:null;xRef=a.s.id+':'+String(a.r.id);
        if(x===null||!Number.isFinite(x)||!xUnit?.trim())reasons.push('NUMERIC_X_AND_UNIT_REQUIRED');
        if(!a.r.property||!a.r.conditions||stable(a.r.conditions)!==stable(r.conditions)||leakageGroup(a.s,a.r)!==leakageGroup(s,r))reasons.push('PAIR_CONDITION_OR_SOURCE_MISMATCH');
        if(independentSample(a.s,a.r)!==independentSample(s,r))reasons.push('PAIR_SPECIMEN_MISMATCH');
        const e=a.r.evidence_ids;if(!Array.isArray(e)||!e.length||!e.every(id=>a.s.evidence.some(v=>v.locator===id)&&sourceRows(a.s,'readEvidence').some(v=>v.id===id||v.evidence_id===id)))reasons.push('X_READ_EVIDENCE_REQUIRED');
        xSignatures.add(comparisonSignature(a.r));
        if(/fraction|content|loading|含量|比例/i.test(String(a.r.property))&&compositionBasis(a.r)===null)reasons.push('X_COMPOSITION_BASIS_REQUIRED');
        if(/energy|能量/i.test(String(a.r.property))&&energyReference(a.r)===null)reasons.push('X_ENERGY_REFERENCE_REQUIRED');
      }
    }
    points.push({id:p.id,x,y:Number(r.value),unit:String(r.unit??''),xUnit,sourceGroup:leakageGroup(s,r),sample:independentSample(s,r),xRef,yRef:ref,...(p.split?{split:p.split}:{})});
  }
  if(signatures.size>1||xSignatures.size>1)reasons.push('UNITS_PROPERTY_BASIS_OR_CONDITIONS_NOT_COMPARABLE');
  return {points,reasons:[...new Set(reasons)]};
}
export function splitChecks(points:MethodPoint[]){
  const reasons:string[]=[],groupSplits=new Map<string,string>();
  for(const p of points){if(!p.split){reasons.push('FROZEN_SPLIT_REQUIRED');continue;}const old=groupSplits.get(p.sourceGroup);if(old&&old!==p.split)reasons.push('SOURCE_GROUP_LEAKAGE');groupSplits.set(p.sourceGroup,p.split);}
  for(const [split,n]of [['train',3],['validation',1],['test',2]] as const)
    if(new Set(points.filter(p=>p.split===split).map(p=>p.sourceGroup)).size<n)reasons.push('INSUFFICIENT_'+split.toUpperCase()+'_GROUPS');
  return [...new Set(reasons)];
}
export function assessMethods(projectId:string,taskId:string|null,input:unknown,snapshots:ResearchSnapshot[],invalidSources:Set<string>,atomicReceipt:SelectionAssessment|null=null):MethodAssessment{
  const request=methodInput.parse(input),candidates:MethodAssessment['candidates']=[],exclusions:MethodAssessment['exclusions']=[];
  const parsed=request.task==='atomistic'?{points:[],reasons:[]}:methodPoints(request,snapshots);
  const common=[...parsed.reasons,...(invalidSources.size?['SOURCE_VERSION_INVALID']:[]),...(snapshots.some(s=>sourceHash(s.data)!==s.sha256)?['SOURCE_HASH_MISMATCH']:[])];
  for(const m of methodRegistry){
    const reasons:string[]=[...common];
    const matches={summarize:'descriptive-summary',fit:'linear-fit',validate:'grouped-linear-validation',atomistic:'atomistic-screening'}[request.task];
    if(m.id!==matches)reasons.push('TASK_OUTSIDE_METHOD_SCOPE');
    if(m.id==='atomistic-screening'){
      if(!atomicReceipt)reasons.push('M6_QUALIFICATION_REQUIRED');
      else if(!atomicReceipt.selection.candidates.length)reasons.push('NO_M6_ELIGIBLE_POTENTIAL');
    }else if(request.task!=='atomistic'){
      if(m.id!=='descriptive-summary'&&parsed.points.length<3)reasons.push('FIT_REQUIRES_THREE_POINTS');
      if(m.id!=='descriptive-summary'&&new Set(parsed.points.map(p=>p.x)).size<2)reasons.push('DEGENERATE_PREDICTOR');
      if(m.id==='grouped-linear-validation')reasons.push(...splitChecks(parsed.points));
    }
    if(reasons.length)exclusions.push({methodId:m.id,reasons:[...new Set(reasons)]});
    else candidates.push({methodId:m.id,evidenceIds:[m.id==='atomistic-screening'?'m6:'+atomicReceipt!.id:'policy:ua7-methods-v1',...snapshots.map(s=>'source:'+s.id+':'+s.sha256)],
      limitations:['Scientific conclusions require review.','No automatic unit/basis conversion, causal inference or production approval.',...(m.id==='atomistic-screening'?['Model agreement is not accuracy; M6 exclusions and theory/energy-reference policy remain in force.']:[])]});
  }
  return {id:randomUUID(),projectId,taskId,createdAt:new Date().toISOString(),registryVersion:'ua7-methods-v1',request,
    inputHashes:snapshots.map(s=>({id:s.id,version:s.version,sha256:s.sha256})),candidates,exclusions,atomicReceipt};
}
export function executeFixedMethod(assessment:MethodAssessment,snapshots:ResearchSnapshot[]){
  const {points,reasons}=methodPoints(assessment.request,snapshots);if(reasons.length)throw Error('METHOD_INPUT_INVALID:'+reasons.join(','));
  const independent=points.every(p=>p.sample!==null)&&new Set(points.map(p=>p.sample)).size===points.length;
  if(assessment.request.task==='summarize')return {result:{...describe(points.map(p=>p.y),independent),unit:points[0]!.unit,points},
    limitations:[...(independent?[]:['Independent replicate identities are missing or repeated; SD and SEM are omitted.']),'Descriptive mean of selected rows only; not a pooled meta-analysis or population estimate.']};
  const selected=assessment.request.task==='validate'?points.filter(p=>p.split==='train'):points;
  const fit=fitLine(selected.map(p=>({x:p.x!,y:p.y}))),{predict,...parameters}=fit;
  const result:Record<string,unknown>={...parameters,xUnit:points[0]!.xUnit,yUnit:points[0]!.unit,slopeUnit:points[0]!.unit+'/'+points[0]!.xUnit,points,
    interpretation:'Least-squares slope; never automatically labeled modulus, causal effect or validated material law.'};
  const limitations=['No confidence/prediction interval without a reviewed noise and independence model.','Predictions outside the training x range are extrapolation.'];
  if(assessment.request.task==='validate'){
    const splits=splitChecks(points);if(splits.length)throw Error('METHOD_SPLIT_INVALID:'+splits.join(','));
    const baseline=mean(selected.map(p=>p.y));
    result.validation=['validation','test'].map(split=>{const held=points.filter(p=>p.split===split);return {split,
      linear:errorMetrics(held.map(p=>p.y),held.map(p=>predict(p.x!))),baseline:errorMetrics(held.map(p=>p.y),held.map(()=>baseline)),
      predictions:held.map(p=>({id:p.id,actual:p.y,predicted:predict(p.x!),baseline,extrapolation:p.x!<fit.trainingDomain.min||p.x!>fit.trainingDomain.max}))};});
    result.splitPolicy='Original source/document groups are disjoint; no preprocessing or fitting on validation/test. No hyperparameter search.';
    limitations.push('User-selected split is frozen before fitting, not an independently reviewed benchmark. Validation/test rows are reported, never used to refit.');
  }
  return {result,limitations};
}
