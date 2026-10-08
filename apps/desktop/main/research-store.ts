import type { DatabaseSync } from 'node:sqlite';
import {methodPackageState,type MethodPackageState} from '../../../packages/contracts/src/method-packages.js';
import {longJobConfig,longJobSchema,campaignSchema,type LongJobConfig,type LongJob,type ResearchCampaign} from '../../../packages/contracts/src/campaigns.js';
import { AgentError } from '../../../packages/contracts/src/agent.js';
import { researchProjectSchema,researchSnapshotSchema,researchBindingSchema,deliveryRecordSchema,sourceReceiptSchema,defaultDeliveryContract,
  type ResearchProject,type ResearchSnapshot,type ResearchBinding,type DeliveryRecord,type SourceReceipt,type ResearchOverview,type MoosRef } from '../../../packages/contracts/src/research-project.js';
import {researchGoalPlanSchema,type ResearchGoalPlan} from '../../../packages/contracts/src/research-goal.js';
import {qualityReportSchema,sourceNoticeSchema,type QualityReport,type SourceNotice} from '../../../packages/contracts/src/scientific-quality.js';
import {methodAssessmentSchema,methodAnalysisSchema,type MethodAssessment,type MethodAnalysis} from '../../../packages/contracts/src/research-methods.js';
import {experimentDatasetSchema,experimentConfigSchema,experimentRunSchema,type ExperimentDataset,type ExperimentConfig,type ExperimentRun} from '../../../packages/contracts/src/experiments.js';
import {studySchema,feedbackSchema,nextDesignSchema,type ResearchStudy,type ExperimentFeedback,type NextExperimentDesign} from '../../../packages/contracts/src/next-experiment.js';
/** References and immutable receipts in WorkspaceStore's existing SQLite database. No duplicate plan store. */
export class ResearchStore {
  longJobConfigurations(projectId:string){this.owner(projectId);return this.rows('long_job_configuration:').map(v=>longJobConfig.parse(v)).filter(v=>v.projectId===projectId);}
  saveLongJobConfiguration(value:LongJobConfig){const v=longJobConfig.parse(value);this.owner(v.projectId);this.put('long_job_configuration:'+v.id,v,true);return v;}
  longJobs(projectId:string){this.owner(projectId);return this.rows('long_job:').map(v=>longJobSchema.parse(v)).filter(v=>v.projectId===projectId);}
  campaigns(projectId:string){this.owner(projectId);return this.rows('research_campaign:').map(v=>campaignSchema.parse(v)).filter(v=>v.projectId===projectId);}
  saveLongJob(value:LongJob,previous:LongJob|null){return this.transaction(()=>{const v=longJobSchema.parse(value);this.scientificOwner(v.projectId,v.taskId);const old=this.get('long_job:'+v.id);
    if(JSON.stringify(old)!==JSON.stringify(previous))throw Error('LONG_JOB_STATE_CONFLICT');
    if(previous){for(const key of ['id','projectId','taskId','stepId','planRevision','configurationId','configurationSha256','provider','createdAt','elapsedUntil','manifestSha256','nonce','cost','scientificStatus'] as const)if(JSON.stringify(v[key])!==JSON.stringify(previous[key]))throw Error('LONG_JOB_IDENTITY_IMMUTABLE');}
    this.put('long_job:'+v.id,v);return v;});}
  createCampaignJob(job:LongJob,campaign:ResearchCampaign){return this.transaction(()=>{
    const j=longJobSchema.parse(job),c=campaignSchema.parse(campaign);this.scientificOwner(j.projectId,j.taskId);
    if(c.taskId!==j.taskId||c.projectId!==j.projectId||c.elapsedUntil!==j.elapsedUntil)throw Error('CAMPAIGN_JOB_SCOPE');
    const old=this.get('research_campaign:'+c.id);if(old&&JSON.stringify(old)!==JSON.stringify(c))throw Error('CAMPAIGN_STATE_CONFLICT');
    if(c.jobIds.length>=32||c.jobIds.includes(j.id))throw Error('CAMPAIGN_JOB_LIMIT');
    this.saveLongJob(j,null);this.put('research_campaign:'+c.id,{...c,jobIds:[...c.jobIds,j.id]});return j;
  });}
  methodPackageState():MethodPackageState{return methodPackageState.parse(this.get('method_packages:state')??{version:'ua10-state-v1',candidates:[],reviews:[],releases:[],references:[]});}
  saveMethodPackageState(value:MethodPackageState,expected:MethodPackageState){return this.transaction(()=>{if(JSON.stringify(this.methodPackageState())!==JSON.stringify(expected))throw Error('METHOD_PACKAGE_STATE_CONFLICT');const next=methodPackageState.parse(value);this.put('method_packages:state',next);return next;});}
  constructor(private db:DatabaseSync){}
  private transaction<T>(fn:()=>T):T{const owner=!this.db.isTransaction;if(owner)this.db.exec('BEGIN IMMEDIATE');try{const value=fn();if(owner)this.db.exec('COMMIT');return value;}catch(e){if(owner)this.db.exec('ROLLBACK');throw e;}}
  private get(key:string):unknown {const r=this.db.prepare('SELECT value FROM app_meta WHERE key=?').get(key);return r?JSON.parse(String(r.value)):null;}
  private put(key:string,value:unknown,immutable=false){
    const body=JSON.stringify(value);if(Buffer.byteLength(body)>1024*1024)throw new AgentError('BUDGET_EXCEEDED','Research snapshot exceeds 1 MiB');
    const old=this.get(key);if(immutable&&old&&JSON.stringify(old)!==body)throw new AgentError('CONFLICT','Immutable research receipt conflict');
    this.db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,body);
  }
  private owner(projectId:string){if(!this.db.prepare('SELECT id FROM projects WHERE id=?').get(projectId))throw new AgentError('PERMISSION_DENIED','Research project not found');}
  private rows(prefix:string):unknown[]{return this.db.prepare('SELECT value FROM app_meta WHERE key LIKE ? ORDER BY key').all(prefix+'%').map(r=>JSON.parse(String(r.value)));}
  project(id:string):ResearchProject {
    this.owner(id);const stored=this.get('research_project:'+id);if(stored)return researchProjectSchema.parse(stored);
    const p:ResearchProject={schemaVersion:'research-project-v1',projectId:id,revision:1,materialSystem:'',conditions:[],samples:[],selected:[],withdrawn:[],decisions:[],delivery:defaultDeliveryContract(),updatedAt:new Date().toISOString()};
    this.put('research_project:'+id,p);return p;
  }
  saveProject(value:ResearchProject,expected:number){return this.transaction(()=>{
    const p=researchProjectSchema.parse(value),old=this.project(p.projectId);
    if(old.revision!==expected||p.revision!==expected+1)throw new AgentError('CONFLICT','Research project revision conflict');
    for(const id of [...p.selected,...p.withdrawn,...p.samples.flatMap(s=>s.snapshotId?[s.snapshotId]:[])])this.snapshot(p.projectId,id);
    if(p.activeStudyId&&!this.studies(p.projectId).some(s=>s.id===p.activeStudyId))throw Error('STUDY_NOT_OWNED');
    if(p.selected.some(id=>p.withdrawn.includes(id)))throw new AgentError('CONFLICT','Withdrawn source cannot remain selected');
    this.put(`research_project_revision:${p.projectId}:${old.revision}`,old,true);
    p.updatedAt=new Date().toISOString();this.put('research_project:'+p.projectId,p);this.put(`research_project_revision:${p.projectId}:${p.revision}`,p,true);return p;});
  }
  snapshot(projectId:string,id:string):ResearchSnapshot {
    this.owner(projectId);const v=researchSnapshotSchema.parse(this.get('research_snapshot:'+id));if(v.projectId!==projectId)throw new AgentError('PERMISSION_DENIED','Snapshot belongs to another project');return v;
  }
  snapshots(projectId:string){return this.rows('research_snapshot:').map(v=>researchSnapshotSchema.parse(v)).filter(v=>v.projectId===projectId);}
  saveSnapshot(value:ResearchSnapshot){const s=researchSnapshotSchema.parse(value);this.owner(s.projectId);this.put('research_snapshot:'+s.id,s,true);return s;}
  binding(taskId:string):ResearchBinding|null {const v=this.get('research_binding:'+taskId);return v?researchBindingSchema.parse(v):null;}
  saveBinding(value:ResearchBinding,revision=false){return this.transaction(()=>{const b=researchBindingSchema.parse(value);this.owner(b.projectId);
    if(this.db.prepare('SELECT project_id FROM runs WHERE id=?').get(b.taskId)?.project_id!==b.projectId)throw new AgentError('PERMISSION_DENIED','Task scope mismatch');
    const old=this.binding(b.taskId);if(old&&JSON.stringify(revision?{...old,snapshotIds:[],approvedInputs:[],conditions:[],materialSystem:'',samples:[],projectRevision:0}:{...old,snapshotIds:[]})!==JSON.stringify(revision?{...b,snapshotIds:[],approvedInputs:[],conditions:[],materialSystem:'',samples:[],projectRevision:0}:{...b,snapshotIds:[]}))throw new AgentError('CONFLICT','Task delivery criteria are frozen before execution');
    if(old&&!revision&&old.snapshotIds.some(id=>!b.snapshotIds.includes(id)))throw new AgentError('CONFLICT','Task source receipts are append-only');
    for(const id of b.snapshotIds)this.snapshot(b.projectId,id);this.put('research_binding:'+b.taskId,b);return b;});
  }
  queryDenied(projectId:string,query:string){this.owner(projectId);const normalized=query.normalize('NFKC').toLowerCase().trim();const row=this.rows('research_source_receipt:').map(v=>sourceReceiptSchema.parse(v)).filter(r=>r.projectId===projectId&&r.origin==='moos'&&r.tool==='moos_search'&&String((r.args as any)?.query??'').normalize('NFKC').toLowerCase().trim()===normalized).sort((a,b)=>b.at.localeCompare(a.at))[0];return row?.outcome==='denied';}
  private sourceKey(projectId:string,ref:MoosRef){return `research_source_state:${projectId}:${ref.connectionId}:${ref.sourceId}:${ref.experimentId}:${ref.generation}:${ref.projectionSha256}`;}
  sourceState(projectId:string,snapshotId:string):SourceReceipt['outcome']|null {
    const row=this.db.prepare("SELECT json_extract(value,'$.ref') AS ref,json_extract(value,'$.projectId') AS project FROM app_meta WHERE key=?").get('research_snapshot:'+snapshotId);
    if(!row||row.project!==projectId)throw new AgentError('PERMISSION_DENIED','Snapshot source scope mismatch');
    const ref=row.ref?JSON.parse(String(row.ref)) as MoosRef:null;const state=ref?this.get(this.sourceKey(projectId,ref)) as {outcome:SourceReceipt['outcome']}|null:null;return state?.outcome??null;
  }
  receipt(value:SourceReceipt){const v=sourceReceiptSchema.parse(value);this.owner(v.projectId);this.put('research_source_receipt:'+v.id,v,true);
    const ref=(v.args as any)?.ref as MoosRef|undefined;if(v.tool==='moos_get_experiment'&&ref){const key=this.sourceKey(v.projectId,ref),old=this.get(key) as {outcome:SourceReceipt['outcome']}|null;if(!(['unavailable','cancelled'].includes(v.outcome)&&old&&['denied','stale','invalid'].includes(old.outcome)))this.put(key,{outcome:v.outcome,at:v.at});}return v;
  }
  delivery(value:DeliveryRecord){const d=deliveryRecordSchema.parse(value),b=this.binding(d.taskId);if(!b||b.projectId!==d.projectId)throw new AgentError('PERMISSION_DENIED','Delivery task mismatch');this.put('research_delivery:'+d.id,d,true);return d;}
  deliveries(projectId:string){this.owner(projectId);return this.rows('research_delivery:').map(v=>deliveryRecordSchema.parse(v)).filter(v=>v.projectId===projectId);}
  private scientificOwner(projectId:string,taskId:string|null){this.owner(projectId);if(taskId&&this.db.prepare('SELECT project_id FROM runs WHERE id=?').get(taskId)?.project_id!==projectId)throw new AgentError('PERMISSION_DENIED','Scientific task scope mismatch');}
  qualityReports(projectId:string){this.owner(projectId);return this.rows('research_quality:').map(v=>qualityReportSchema.parse(v)).filter(v=>v.projectId===projectId);}
  saveQuality(value:QualityReport){const q=qualityReportSchema.parse(value);this.scientificOwner(q.projectId,q.taskId);if(q.scientificStatus!=='needs_review')throw Error('SCIENTIFIC_REVIEW_NOT_GRANTED');for(const s of q.inputs){const actual=this.snapshot(q.projectId,s.id);if(actual.sha256!==s.sha256||actual.version!==s.version)throw Error('QUALITY_INPUT_CHANGED');}this.put('research_quality:'+q.id,q,true);return q;}
  sourceNotices(projectId:string){this.owner(projectId);return this.rows('research_notice:').map(v=>sourceNoticeSchema.parse(v)).filter(v=>v.projectId===projectId);}
  saveSourceNotice(value:SourceNotice){const n=sourceNoticeSchema.parse(value);this.owner(n.projectId);const old=this.snapshot(n.projectId,n.snapshotId);if(n.replacementSnapshotId){const next=this.snapshot(n.projectId,n.replacementSnapshotId);if(next.id===old.id||next.sha256===old.sha256&&next.version===old.version)throw Error('SOURCE_REPLACEMENT_NOT_NEW');}this.put('research_notice:'+n.id,n,true);return n;}
  methodAssessments(projectId:string){this.owner(projectId);return this.rows('research_method_assessment:').map(v=>methodAssessmentSchema.parse(v)).filter(v=>v.projectId===projectId);}
  saveMethodAssessment(value:MethodAssessment){const a=methodAssessmentSchema.parse(value);this.scientificOwner(a.projectId,a.taskId);for(const s of a.inputHashes){const actual=this.snapshot(a.projectId,s.id);if(actual.sha256!==s.sha256||actual.version!==s.version)throw Error('METHOD_INPUT_CHANGED');}this.put('research_method_assessment:'+a.id,a,true);return a;}
  methodAnalyses(projectId:string){this.owner(projectId);return this.rows('research_method_analysis:').map(v=>methodAnalysisSchema.parse(v)).filter(v=>v.projectId===projectId);}
  experimentDatasets(projectId:string){this.owner(projectId);return this.rows('experiment_dataset:').map(v=>experimentDatasetSchema.parse(v)).filter(v=>v.projectId===projectId);}
  saveExperimentDataset(value:ExperimentDataset){const v=experimentDatasetSchema.parse(value);this.owner(v.projectId);this.put('experiment_dataset:'+v.id,v,true);return v;}
  experimentConfigurations(projectId:string){this.owner(projectId);return this.rows('experiment_config:').map(v=>experimentConfigSchema.parse(v)).filter(v=>v.projectId===projectId);}
  saveExperimentConfiguration(value:ExperimentConfig){return this.transaction(()=>{const v=experimentConfigSchema.parse(value);this.owner(v.projectId);
    if(!this.experimentDatasets(v.projectId).some(d=>d.id===v.input.datasetId))throw Error('EXPERIMENT_DATASET_NOT_OWNED');
    const latest=this.experimentConfigurations(v.projectId).filter(c=>c.input.datasetId===v.input.datasetId).sort((a,b)=>b.revision-a.revision)[0];
    if((latest?.revision??0)!==v.input.expectedRevision||v.revision!==v.input.expectedRevision+1)throw Error('EXPERIMENT_REVISION_CONFLICT');
    this.put('experiment_config:'+v.id,v,true);return v;});}
  experimentRuns(projectId:string){this.owner(projectId);return this.rows('experiment_run:').map(v=>experimentRunSchema.parse(v)).filter(v=>v.projectId===projectId);}
  saveExperimentRun(value:ExperimentRun){const v=experimentRunSchema.parse(value);this.scientificOwner(v.projectId,v.taskId);
    for(const h of v.configurationHashes)if(!this.experimentConfigurations(v.projectId).some(c=>c.id===h.id&&c.sha256===h.sha256))throw Error('EXPERIMENT_CONFIG_NOT_OWNED');
    this.put('experiment_run:'+v.id,v,true);return v;}
  saveMethodAnalysis(value:MethodAnalysis){const a=methodAnalysisSchema.parse(value),assessment=this.methodAssessments(a.projectId).find(v=>v.id===a.assessmentId);this.scientificOwner(a.projectId,a.taskId);if(!assessment||assessment.taskId!==a.taskId||!assessment.candidates.some(c=>c.methodId===a.methodId))throw Error('METHOD_ASSESSMENT_NOT_OWNED_OR_EXCLUDED');this.put('research_method_analysis:'+a.id,a,true);return a;}
  studies(projectId:string){this.owner(projectId);return this.rows('research_study:').map(v=>studySchema.parse(v)).filter(v=>v.projectId===projectId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));}
  feedback(projectId:string){this.owner(projectId);return this.rows('experiment_feedback:').map(v=>feedbackSchema.parse(v)).filter(v=>v.projectId===projectId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));}
  nextDesigns(projectId:string){this.owner(projectId);return this.rows('next_design:').map(v=>nextDesignSchema.parse(v)).filter(v=>v.projectId===projectId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));}
  saveStudy(value:ResearchStudy){return this.transaction(()=>{const s=studySchema.parse(value),p=this.project(s.projectId);for(const id of s.input.snapshotIds)this.snapshot(p.projectId,id);
    this.put('research_study:'+s.id,s,true);this.saveProject({...p,revision:p.revision+1,activeStudyId:s.id,materialSystem:s.input.materialSystem,decisions:[...p.decisions,{at:s.createdAt,origin:'user' as const,text:'Research study '+s.id}].slice(-200)},s.input.expectedProjectRevision);return s;});}
  saveFeedback(value:ExperimentFeedback){return this.transaction(()=>{const f=feedbackSchema.parse(value),p=this.project(f.projectId),d=this.nextDesigns(p.projectId).find(d=>d.id===f.input.designId);
    if(!d||d.studyId!==f.studyId||p.activeStudyId!==f.studyId||!d.result.schedule.some(r=>r.id===f.input.plannedRunId))throw Error('FEEDBACK_DESIGN_NOT_OWNED_OR_CURRENT');
    for(const id of f.sourceSnapshotIds)this.snapshot(p.projectId,id);
    const all=this.feedback(p.projectId),current=all.filter(v=>v.input.designId===f.input.designId&&v.input.plannedRunId===f.input.plannedRunId&&!all.some(n=>n.input.supersedes===v.id));
    if(current.length?(current.length!==1||f.input.supersedes!==current[0]!.id):f.input.supersedes!==null)throw Error('FEEDBACK_CORRECTION_CONFLICT');
    this.put('experiment_feedback:'+f.id,f,true);this.saveProject({...p,revision:p.revision+1,decisions:[...p.decisions,{at:f.createdAt,origin:'user' as const,text:'Experimental feedback '+f.id+' ('+f.input.outcome+')'}].slice(-200)},f.input.expectedProjectRevision);return f;});}
  saveNextDesign(value:NextExperimentDesign){const d=nextDesignSchema.parse(value);this.scientificOwner(d.projectId,d.taskId);
    if(!this.studies(d.projectId).some(s=>s.id===d.studyId&&s.sha256===d.studySha256))throw Error('DESIGN_STUDY_NOT_OWNED');
    for(const h of d.feedbackHashes)if(!this.feedback(d.projectId).some(f=>f.id===h.id&&f.sha256===h.sha256))throw Error('DESIGN_FEEDBACK_NOT_OWNED');
    for(const h of d.sourceHashes)if(this.snapshot(d.projectId,h.id).sha256!==h.sha256)throw Error('DESIGN_SOURCE_CHANGED');this.put('next_design:'+d.id,d,true);return d;}
  history(plan:ResearchGoalPlan){this.put(`research_plan_history:${plan.task.taskId}:${String(plan.planRevision).padStart(8,'0')}`,plan,true);}
  overview(projectId:string):ResearchOverview {return {project:this.project(projectId),snapshots:this.snapshots(projectId),
    receipts:this.rows('research_source_receipt:').map(v=>sourceReceiptSchema.parse(v)).filter(v=>v.projectId===projectId).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,100),
    deliveries:this.deliveries(projectId),projectHistory:this.rows('research_project_revision:'+projectId+':').map(v=>researchProjectSchema.parse(v)).sort((a,b)=>a.revision-b.revision),bindings:this.rows('research_binding:').map(v=>researchBindingSchema.parse(v)).filter(v=>v.projectId===projectId),
    planHistory:this.rows('research_plan_history:').map(v=>researchGoalPlanSchema.parse(v)).filter(v=>v.task.projectId===projectId)};}
}
