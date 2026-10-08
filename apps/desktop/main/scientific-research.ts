import type {MethodPackages} from './method-packages.js';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {qualityAuditInput,sourceNoticeInput,type ScientificOverview,type SourceImpact} from '../../../packages/contracts/src/scientific-quality.js';
import {methodInput,methodRunInput,type MethodAssessment} from '../../../packages/contracts/src/research-methods.js';
import type {ResearchSnapshot} from '../../../packages/contracts/src/research-project.js';
import type {AtomisticRuntime} from '../../../packages/atomistic/src/runtime.js';
import {requiredInteraction} from '../../../packages/atomistic/src/interaction-requirements.js';
import {readOwnedBytes} from '../../../packages/atomistic/src/artifact-io.js';
import {assessScientificQuality} from '../../../packages/agent/src/scientific-quality.js';
import {assessMethods,methodRegistry,executeFixedMethod} from '../../../packages/agent/src/method-registry.js';
import {writeScientificArtifacts} from '../../../packages/agent/src/scientific-artifacts.js';
import {qualityMarkdown,analysisMarkdown} from '../../../packages/agent/src/research-analysis-report.js';
import {scientificArtifactRole} from '../../../packages/agent/src/research-artifact-roles.js';
import type {WorkspaceStore} from './store.js';
/** ResearchService companion: same SQLite, same task/plan identity, same M6 gate. No second executor or quality store. */
export class ScientificResearch {
  atomistic:Pick<AtomisticRuntime,'assess'> & Partial<Pick<AtomisticRuntime,'listStructures'>>|null=null;
  constructor(private store:WorkspaceStore,private verify?:(s:ResearchSnapshot,taskId:string|null,signal?:AbortSignal)=>Promise<void>,private packages?:MethodPackages){}
  invalidSources(projectId:string){
    const p=this.store.research.project(projectId),notices=this.store.research.sourceNotices(projectId);
    return new Set([...p.withdrawn,...notices.map(n=>n.snapshotId),...this.store.research.snapshots(projectId)
      .filter(s=>['stale','denied','invalid'].includes(this.store.research.sourceState(projectId,s.id)??'')).map(s=>s.id)]);
  }
  assertCurrent(projectId:string,snapshotId:string){if(this.invalidSources(projectId).has(snapshotId))throw Error('SCIENTIFIC_SOURCE_STALE_OR_RETRACTED');}
  accessDenied(projectId:string,snapshotId:string){return this.store.research.sourceState(projectId,snapshotId)==='denied'||this.store.research.sourceNotices(projectId).some(n=>n.snapshotId===snapshotId&&n.kind==='access-denied');}
  assertAccess(projectId:string,snapshotId:string){if(this.accessDenied(projectId,snapshotId))throw Error('SCIENTIFIC_SOURCE_ACCESS_REVOKED');}
  snapshots(projectId:string,ids:string[],taskId:string|null){
    if(new Set(ids).size!==ids.length||ids.length>20)throw Error('SCIENTIFIC_SOURCE_SELECTION_LIMIT');
    const owned=taskId?this.store.research.binding(taskId):null,p=this.store.research.project(projectId);
    if(taskId&&owned?.projectId!==projectId)throw Error('SCIENTIFIC_TASK_NOT_OWNED');
    return ids.map(id=>{if(!(owned?.snapshotIds??p.selected).includes(id))throw Error('SCIENTIFIC_SOURCE_NOT_SELECTED: '+JSON.stringify(id)+'. Copy an exact snapshotId from this task selection: '+JSON.stringify((owned?.snapshotIds??p.selected).slice(0,20))+'. Do not guess, shorten or substitute source IDs.');this.assertAccess(projectId,id);return this.store.research.snapshot(projectId,id);});
  }
  async verifySources(projectId:string,ids:string[],taskId:string|null,signal?:AbortSignal){for(const id of ids){this.assertCurrent(projectId,id);this.assertAccess(projectId,id);await this.verify?.(this.store.research.snapshot(projectId,id),taskId,signal);this.assertCurrent(projectId,id);this.assertAccess(projectId,id);signal?.throwIfAborted();}}
  impact(projectId:string):SourceImpact{
    const invalid=this.invalidSources(projectId),o=this.store.research.overview(projectId),assessments=this.store.research.methodAssessments(projectId);
    const tasks=o.bindings.flatMap(b=>{const plan=this.store.researchPlan(b.taskId);if(!plan||!b.snapshotIds.some(id=>invalid.has(id)))return [];
      // Unknown dependencies conservatively affect every step; explicit refs preserve independent steps.
      const affected=new Set(plan.steps.filter(s=>s.inputRefs.some(id=>invalid.has(id))).map(s=>s.id));
      if(!affected.size)for(const s of plan.steps)affected.add(s.id);
      let changed=true;while(changed){changed=false;for(const s of plan.steps)if(!affected.has(s.id)&&s.dependsOn.some(id=>affected.has(id))){affected.add(s.id);changed=true;}}
      return [{taskId:b.taskId,planRevision:plan.planRevision,stepIds:[...affected]}];});
    return {snapshotIds:[...invalid],tasks,deliveryIds:o.deliveries.filter(d=>d.snapshotIds.some(id=>invalid.has(id))).map(d=>d.id),
      auditIds:this.store.research.qualityReports(projectId).filter(a=>a.inputs.some(s=>invalid.has(s.id))).map(a=>a.id),
      analysisIds:this.store.research.methodAnalyses(projectId).filter(a=>assessments.find(s=>s.id===a.assessmentId)?.inputHashes.some(s=>invalid.has(s.id))||a.methodPackage&&!this.packages?.overview().entries.some(e=>e.pin.sha256===a.methodPackage!.sha256&&e.executable)).map(a=>a.id)};
  }
  overview(projectId:string):ScientificOverview{
    const impact=this.impact(projectId);
    return {impact,methods:methodRegistry,notices:this.store.research.sourceNotices(projectId),assessments:this.store.research.methodAssessments(projectId),
      audits:this.store.research.qualityReports(projectId).map(a=>({...a,...(impact.auditIds.includes(a.id)?{decision:'stale' as const}:{}),...(a.inputs.some(s=>this.accessDenied(projectId,s.id))?{claims:[],artifacts:[]}:{} )})),
      analyses:this.store.research.methodAnalyses(projectId).map(a=>({...a,...(impact.analysisIds.includes(a.id)?{status:'stale' as const}:{}),...(this.store.research.methodAssessments(projectId).find(s=>s.id===a.assessmentId)?.inputHashes.some(s=>this.accessDenied(projectId,s.id))?{result:{accessDenied:true},artifacts:[]}:{} )}))};
  }
  executionCandidates(projectId:string,taskId:string,currentMethodRun=false){
    const state=this.store.agentJournal.read(taskId);if(!state||state.task.projectId!==projectId||state.state!=='running'||state.attempts.some(a=>a.jobs.some(j=>j.state!=='completed')))return [];
    const inflight=state.attempts.filter(a=>['running','unknown'].includes(a.state));
    if(inflight.length>(currentMethodRun?1:0)||inflight.some(a=>a.state==='unknown'||!currentMethodRun||a.method!=='research_method_run'||a.stepId!==state.activeStepId))return [];
    const owned=new Set(state.attempts.filter(a=>a.method==='research_methods'&&a.state==='completed'&&a.planRevision===state.planRevision&&a.resultRef).flatMap(a=>{
      const receipt=this.store.agentJournal.readResult(taskId,a.resultRef!) as {content?:Array<{text?:string}>};
      try{const value=JSON.parse(receipt.content?.[0]?.text??'null');return typeof value?.id==='string'?[value.id]:[];}catch{return [];}
    }));
    const invalid=this.invalidSources(projectId),analyses=this.store.research.methodAnalyses(projectId);
    return this.store.research.methodAssessments(projectId).filter(a=>a.taskId===taskId&&owned.has(a.id)&&
      a.inputHashes.every(h=>{const s=this.store.research.snapshot(projectId,h.id);return !invalid.has(h.id)&&s.sha256===h.sha256&&s.version===h.version;}))
      .flatMap(a=>a.candidates.filter(c=>c.methodId!=='atomistic-screening'&&!analyses.some(r=>r.taskId===taskId&&r.assessmentId===a.id&&r.methodId===c.methodId)).map(c=>({
        tool:'research_method_run',arguments:{assessmentId:a.id,methodId:c.methodId,reason:'This method passed the recorded hard gates for this task; scientific interpretation still requires review.'},
        boundCall:{tool:'research_method_run',arguments:{reason:'This method passed the recorded hard gates for this task; scientific interpretation still requires review.'}},
        policy:'Prefer boundCall when there is exactly one candidate; multiple choices need explicit selection. Candidate only. Choose according to the original task, preserve the grant, and inspect the actual output. No execution or scientific approval by this hint.'
      })));
  }
  notice(projectId:string,input:unknown){
    const q=sourceNoticeInput.parse(input);if(this.store.listConversations().some(c=>c.projectId===projectId&&this.store.agentJournal.forConversation(c.id).some(s=>s.state==='running')))throw Error('STOP_RESEARCH_BEFORE_SOURCE_NOTICE');
    return this.store.research.saveSourceNotice({...q,id:randomUUID(),projectId,at:new Date().toISOString(),origin:'user'});
  }
  async audit(projectId:string,taskId:string|null,input:unknown,snapshots?:ResearchSnapshot[],signal?:AbortSignal){
    const q=qualityAuditInput.parse(input),sources=snapshots??this.snapshots(projectId,q.snapshotIds,taskId),invalid=this.invalidSources(projectId);
    for(const s of sources)if(!invalid.has(s.id))await this.verify?.(s,taskId,signal);
    const relevant=new Set(sources.filter(s=>invalid.has(s.id)).map(s=>s.id));
    const report=assessScientificQuality(projectId,taskId,sources,q.claims,relevant);
    report.artifacts=await writeScientificArtifacts(this.store.getProject(projectId)!.path,report.id,report,qualityMarkdown(report));
    return this.store.research.saveQuality(report);
  }
  async assess(projectId:string,taskId:string|null,input:unknown,signal?:AbortSignal):Promise<MethodAssessment>{
    const request=methodInput.parse(input),ids=[...new Set(request.samples.flatMap(s=>[s.y.snapshotId,...(s.x?[s.x.snapshotId]:[])]))],sources=this.snapshots(projectId,ids,taskId);
    for(const s of sources)if(!this.invalidSources(projectId).has(s.id))await this.verify?.(s,taskId,signal);
    this.store.research.project(projectId);let receipt=null;
    if(request.atomic){const interaction=requiredInteraction(request.question+'\n'+(taskId?this.store.researchPlan(taskId)?.originalRequest??'':''),request.atomic.interaction);if(interaction)request.atomic.interaction=interaction;}
    if(request.atomic&&this.atomistic)receipt=await this.atomistic.assess({projectId,...request.atomic},signal);
    signal?.throwIfAborted();const invalid=this.invalidSources(projectId),relevant=new Set(sources.filter(s=>invalid.has(s.id)).map(s=>s.id));
    const a=assessMethods(projectId,taskId,request,sources,relevant,receipt);if(this.packages){a.packagePins=[];a.candidates=a.candidates.filter(c=>{try{const pin=this.packages!.forMethod(c.methodId,taskId?this.store.research.binding(taskId)?.approvedInputs:undefined);if(pin)a.packagePins!.push(pin);return true;}catch(e){a.exclusions.push({methodId:c.methodId,reasons:[String(e)]});return false;}});}return this.store.research.saveMethodAssessment(a);
  }
  async run(projectId:string,taskId:string|null,input:unknown,signal?:AbortSignal){
    const q=methodRunInput.parse(input),a=this.store.research.methodAssessments(projectId).find(a=>a.id===q.assessmentId);
    if(!a||a.taskId!==taskId)throw Error('METHOD_ASSESSMENT_NOT_OWNED');
    const candidate=a.candidates.find(c=>c.methodId===q.methodId);if(!candidate)throw Error('METHOD_HARD_GATE_EXCLUDED');
    if(q.methodId==='atomistic-screening')throw Error('USE_EXISTING_MATERIALS_SCIENCE_SELECT_AND_RUN_WITH_M6_RECEIPT');
    const sources=this.snapshots(projectId,a.inputHashes.map(s=>s.id),taskId);
    for(const s of sources)await this.verify?.(s,taskId,signal);
    for(const s of sources){this.assertCurrent(projectId,s.id);if(!a.inputHashes.some(h=>h.id===s.id&&h.sha256===s.sha256&&h.version===s.version))throw Error('METHOD_SOURCE_CHANGED');}
    signal?.throwIfAborted();const pin=this.packages?.forMethod(q.methodId,taskId?this.store.research.binding(taskId)?.approvedInputs:undefined);
    if(pin&&!a.packagePins?.some(p=>p.sha256===pin.sha256&&p.version===pin.version))throw Error('METHOD_ASSESSMENT_PACKAGE_CHANGED');
    const reference=pin?this.packages!.ready(pin):null;const execution=executeFixedMethod(a,sources),id=randomUUID(),record={id,assessmentId:a.id,projectId,taskId,methodId:q.methodId,
      createdAt:new Date().toISOString(),reason:q.reason,status:'completed' as const,scientificStatus:'needs_review' as const,productionApproved:false as const,
      ...(pin?{methodPackage:pin,referenceReceipt:reference!.id}:{}),result:execution.result,limitations:[...candidate.limitations,...execution.limitations],artifacts:[] as Array<{path:string;sha256:string;bytes:number}>};
    record.artifacts=await writeScientificArtifacts(this.store.getProject(projectId)!.path,id,{...record,assessment:a,...(reference?{reference}: {})},analysisMarkdown(record,a));
    signal?.throwIfAborted();if(pin)this.packages!.ready(pin);for(const s of sources)this.assertCurrent(projectId,s.id);return this.store.research.saveMethodAnalysis(record);
  }
  async preview(projectId:string,recordId:string,path:string){
    const o=this.overview(projectId),record=[...o.audits,...o.analyses].find(r=>r.id===recordId),artifact=record?.artifacts.find(a=>a.path===path);
    if(!artifact)throw Error('SCIENTIFIC_ARTIFACT_NOT_OWNED');return (await readOwnedBytes(this.store.getProject(projectId)!.path,join(this.store.getProject(projectId)!.path,path),artifact.sha256)).toString('utf8');
  }
  async verifyTaskArtifacts(taskId:string){
    const binding=this.store.research.binding(taskId);if(!binding)return;
    const overview=this.overview(binding.projectId),root=this.store.getProject(binding.projectId)!.path;
    for(const record of [...overview.audits,...overview.analyses].filter(r=>r.taskId===taskId)){
      if('status' in record&&record.status==='stale'||'decision' in record&&record.decision==='stale')throw Error('SCIENTIFIC_TASK_SOURCE_STALE');
      if('methodPackage' in record&&record.methodPackage)this.packages?.ready(record.methodPackage);
      for(const a of record.artifacts)await readOwnedBytes(root,join(root,a.path),a.sha256);
    }
  }
  /** Resolve known report roles from this step's real backend record, never from model text. */
  async resolveTaskArtifact(taskId:string,stepId:string,name:string):Promise<string|null>{
    const role=scientificArtifactRole(name);if(!role)return null;
    const {quality,extension}=role;
    const state=this.store.agentJournal.read(taskId),binding=this.store.research.binding(taskId);
    if(!state||!binding)return null;
    const method=quality?'research_quality':'research_method_run';
    const overview=this.overview(binding.projectId),records=quality?overview.audits:overview.analyses;
    const owned=new Set<string>();
    for(const a of state.attempts.filter(a=>a.stepId===stepId&&a.planRevision===state.planRevision&&a.method===method&&a.state==='completed'&&a.resultRef)){
      const result=this.store.agentJournal.readResult(taskId,a.resultRef!) as {content?:Array<{type:string;text?:string}>};
      const parts=result?.content?.filter(p=>p.type==='text');
      if(parts?.length===1&&parts[0]?.text){const value=JSON.parse(parts[0].text);if(typeof value.id==='string')owned.add(value.id);}
    }
    const matching=records.filter(r=>r.taskId===taskId&&owned.has(r.id)&&
      !('status' in r&&r.status==='stale')&&!('decision' in r&&r.decision==='stale')).flatMap(r=>r.artifacts.filter(a=>a.path.endsWith(extension)));
    if(matching.length!==1)return null; // An ambiguous role needs an explicit actual path.
    const root=this.store.getProject(binding.projectId)!.path,a=matching[0]!;
    const bytes=await readOwnedBytes(root,join(root,a.path),a.sha256);if(bytes.length!==a.bytes)throw Error('SCIENTIFIC_ARTIFACT_SIZE_CHANGED');
    return join(root,a.path);
  }
}
