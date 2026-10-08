import {randomUUID,createHash} from 'node:crypto';
import {basename,join} from 'node:path';
import {readOwnedBytes} from '../../../packages/atomistic/src/artifact-io.js';
import {writeScientificFiles} from '../../../packages/agent/src/scientific-artifacts.js';
import {sourceHash} from '../../../packages/agent/src/data-source-router.js';
import {nextExperimentCsv,nextExperimentMarkdown} from '../../../packages/agent/src/next-experiment-report.js';
import {studyInput,feedbackInput,feedbackSchema,nextDesignInput,nextDesignResultSchema,type ResearchStudy,type ExperimentFeedback,type NextExperimentDesign,type NextExperimentOverview} from '../../../packages/contracts/src/next-experiment.js';
import {designNext,feasible} from '../../../experiments/next-design.mjs';
import {resolveFeedbackSource} from './next-experiment-sources.js';
import type {WorkspaceStore} from './store.js';
import type {ScientificResearch} from './scientific-research.js';
import type {ExperimentResearch} from './experiment-research.js';
const json=(v:unknown)=>JSON.stringify(v,null,2)+'\n',sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
/** Same project, source policy and supervised engine loop. Designs do not execute physical experiments. */
export class NextExperimentResearch {
  private busy=new Set<string>();
  constructor(private store:WorkspaceStore,private scientific:ScientificResearch,private experiments:ExperimentResearch,private assetRoot:string){}
  private root(id:string){this.store.research.project(id);return this.store.getProject(id)!.path;}
  private assertIdleTask(id:string){if(this.store.listConversations().some(c=>c.projectId===id&&this.store.agentJournal.forConversation(c.id).some(s=>s.state==='running')))throw Error('STOP_RESEARCH_BEFORE_STUDY_EDIT');}
  private idle(id:string){this.assertIdleTask(id);if(this.busy.has(id))throw Error('NEXT_EXPERIMENT_BUSY');}
  private study(id:string,studyId:string){const s=this.store.research.studies(id).find(s=>s.id===studyId);if(!s)throw Error('STUDY_NOT_OWNED');return s;}
  private latest(id:string,studyId:string){const all=this.store.research.feedback(id);return all.filter(f=>f.studyId===studyId&&!all.some(n=>n.input.supersedes===f.id));}
  private sources(s:ResearchStudy,feedback:ExperimentFeedback[]){return [...new Set([...s.input.snapshotIds,...feedback.flatMap(f=>f.sourceSnapshotIds)])];}
  private current(id:string,s:ResearchStudy,feedback:ExperimentFeedback[],taskId:string|null){
    const p=this.store.research.project(id),b=taskId?this.store.research.binding(taskId):null;
    if(p.activeStudyId!==s.id||p.materialSystem!==s.input.materialSystem)throw Error('STUDY_VERSION_OR_MATERIAL_CHANGED');if(taskId&&b?.projectId!==id)throw Error('NEXT_EXPERIMENT_TASK_NOT_OWNED');
    for(const source of this.sources(s,feedback)){this.scientific.assertCurrent(id,source);this.scientific.assertAccess(id,source);if(!(b?.snapshotIds??p.selected).includes(source))throw Error('FEEDBACK_SOURCE_NOT_SELECTED');}
    if(taskId){const actual=this.frozenInputs(id);for(const h of actual)if(!b!.approvedInputs.some(v=>v.id===h.id&&v.sha256===h.sha256))throw Error('STUDY_OR_FEEDBACK_NOT_FROZEN');}
  }
  frozenInputs(id:string){const p=this.store.research.project(id);if(!p.activeStudyId)return [];const s=this.study(id,p.activeStudyId);return [{id:'research-study:'+s.id,version:s.id,sha256:s.sha256},...this.latest(id,s.id).map(f=>({id:'experiment-feedback:'+f.id,version:f.id,sha256:f.sha256}))];}
  overview(id:string):NextExperimentOverview{
    const p=this.store.research.project(id),invalid=this.scientific.invalidSources(id),denied=(ids:string[])=>ids.some(k=>this.scientific.accessDenied(id,k)),studies=this.store.research.studies(id).filter(s=>!denied(s.input.snapshotIds)),feedback=this.store.research.feedback(id).filter(f=>!denied(f.sourceSnapshotIds));
    return {projectRevision:p.revision,study:studies.find(s=>s.id===p.activeStudyId)??null,studies,feedback,designs:this.store.research.nextDesigns(id).filter(d=>!denied(d.sourceHashes.map(h=>h.id))).map(d=>({...d,
      historical:d.studyId!==p.activeStudyId||this.study(id,d.studyId).input.materialSystem!==p.materialSystem||JSON.stringify(d.feedbackHashes)!==JSON.stringify(this.latest(id,d.studyId).map(f=>({id:f.id,sha256:f.sha256}))),
      sourceInvalid:d.sourceHashes.some(h=>invalid.has(h.id)||!p.selected.includes(h.id))}))};
  }
  saveStudy(id:string,input:unknown){this.idle(id);const q=studyInput.parse(input);if(!feasible(q,q.control))throw Error('CONTROL_VIOLATES_FACTOR_OR_LINEAR_CONSTRAINT');
    const p=this.store.research.project(id);for(const source of q.snapshotIds){this.scientific.assertCurrent(id,source);if(!p.selected.includes(source))throw Error('STUDY_SOURCE_NOT_SELECTED');}
    return this.store.research.saveStudy({id:randomUUID(),projectId:id,createdAt:new Date().toISOString(),sha256:sourceHash(q),input:q});
  }
  async feedback(id:string,input:unknown){this.idle(id);this.busy.add(id);try{
    const q=feedbackInput.parse(input),p=this.store.research.project(id),d=this.store.research.nextDesigns(id).find(d=>d.id===q.designId);if(!d)throw Error('DESIGN_NOT_OWNED');
    const s=this.study(id,d.studyId);this.current(id,s,[],null);const run=d.result.schedule.find(r=>r.id===q.plannedRunId);if(!run)throw Error('PLANNED_RUN_NOT_OWNED');
    if(Object.keys(q.actualFactors).length!==s.input.factors.length||s.input.factors.some(f=>q.actualFactors[f.key]===undefined))throw Error('FEEDBACK_FACTOR_KEYS_REQUIRED');
    const resolved=await resolveFeedbackSource(this.store,this.scientific,this.experiments,id,s,q),deviations=[];
    if(!feasible(s.input,q.actualFactors))deviations.push('OUTSIDE_DESIGN_BOUNDS_OR_CONSTRAINTS');
    if(s.input.factors.some(f=>run.factors[f.key]!==q.actualFactors[f.key]))deviations.push('ACTUAL_FACTORS_DIFFER_FROM_PLAN');
    if(resolved.unit!==s.input.response.unit)throw Error('FEEDBACK_UNIT_MISMATCH_NO_AUTOMATIC_CONVERSION');
    if(q.source&&resolved.conditions!==s.input.measurementConditions)deviations.push('MEASUREMENT_CONDITIONS_DIFFER');
    if(deviations.length&&q.outcome==='measured')throw Error('REPORT_DEVIATED_OUTCOME_FOR_CHANGED_CONDITIONS');
    if(q.outcome==='deviated')deviations.push('USER_REPORTED_DEVIATION');
    this.current(id,s,[],null);for(const k of resolved.sourceSnapshotIds){this.scientific.assertCurrent(id,k);if(!p.selected.includes(k))throw Error('FEEDBACK_SOURCE_NOT_SELECTED');}
    this.assertIdleTask(id);const all=this.store.research.feedback(id),active=all.filter(f=>f.studyId===s.id&&!all.some(n=>n.input.supersedes===f.id)&&f.id!==q.supersedes);
    if(resolved.sourceIdentity&&active.some(f=>f.sourceIdentity===resolved.sourceIdentity))throw Error('SOURCE_ALREADY_USED_AS_EXPERIMENTAL_UNIT');
    if(all.length>=400)throw Error('FEEDBACK_LIMIT_400');
    const body={id:randomUUID(),projectId:id,studyId:s.id,createdAt:new Date().toISOString(),input:q,...resolved,scientificStatus:'needs_review' as const,deviations};
    return this.store.research.saveFeedback(feedbackSchema.parse({...body,sha256:sourceHash(body)}));
  }finally{this.busy.delete(id);}}
  async design(id:string,taskId:string|null,input:unknown,signal?:AbortSignal){if(!taskId)this.idle(id);if(this.busy.has(id))throw Error('NEXT_EXPERIMENT_BUSY');this.busy.add(id);try{
    signal?.throwIfAborted();const q=nextDesignInput.parse(input),s=this.study(id,q.studyId),feedback=this.latest(id,s.id);this.current(id,s,feedback,taskId);await this.scientific.verifySources(id,this.sources(s,feedback),taskId,signal);
    for(const f of feedback)if(f.input.source){const resolved=await resolveFeedbackSource(this.store,this.scientific,this.experiments,id,s,f.input);if(resolved.value!==f.value||resolved.unit!==f.unit||resolved.sourceIdentity!==f.sourceIdentity)throw Error('FEEDBACK_SOURCE_CHANGED');}
    const result=nextDesignResultSchema.parse(designNext(s.input,q,feedback)),modules=[];
    for(const name of ['next-design.mjs','gaussian-process.mjs','math.mjs'])modules.push({name,body:await readOwnedBytes(this.assetRoot,join(this.assetRoot,'experiments',name),null,65536)});
    const d:NextExperimentDesign={id:randomUUID(),projectId:id,taskId,studyId:s.id,studySha256:s.sha256,createdAt:new Date().toISOString(),policyVersion:'ua9-design-v1',request:q,feedbackHashes:feedback.map(f=>({id:f.id,sha256:f.sha256})),sourceHashes:this.sources(s,feedback).map(k=>({id:k,sha256:this.store.research.snapshot(id,k).sha256})),result,artifacts:[]};
    const script="import {readFileSync,writeFileSync} from 'node:fs';\nimport {createHash} from 'node:crypto';\nimport {designNext} from './next-design.mjs';\nconst input=JSON.parse(readFileSync(new URL('./input.json',import.meta.url),'utf8'));\nconst env=JSON.parse(readFileSync(new URL('./environment.json',import.meta.url),'utf8'));\nfor(const [name,digest] of Object.entries(env.files))if(createHash('sha256').update(readFileSync(new URL('./'+name,import.meta.url))).digest('hex')!==digest)throw Error('REPLAY_INPUT_CHANGED:'+name);\nwriteFileSync(new URL('./replay-result.json',import.meta.url),JSON.stringify(designNext(input.study,input.request,input.feedback),null,2)+'\\n');\n";
    const inputs=json({study:s.input,request:q,feedback}),environment=json({policyVersion:d.policyVersion,node:process.versions.node,platform:process.platform,arch:process.arch,dependencies:'Node standard library only',files:Object.fromEntries([...modules.map(m=>[m.name,sha(m.body)]),['input.json',sha(inputs)],['replay.mjs',sha(script)]])});
    signal?.throwIfAborted();d.artifacts=await writeScientificFiles(this.root(id),d.id,[{name:'design.json',body:json(d)},{name:'report.md',body:nextExperimentMarkdown(d,s)},{name:'candidates.csv',body:nextExperimentCsv(d,s,false)},{name:'schedule.csv',body:nextExperimentCsv(d,s,true)},{name:'input.json',body:inputs},{name:'environment.json',body:environment},{name:'replay.mjs',body:script},...modules]);
    signal?.throwIfAborted();await this.scientific.verifySources(id,this.sources(s,feedback),taskId,signal);this.current(id,s,feedback,taskId);if(!taskId)this.assertIdleTask(id);for(const f of feedback)if(f.input.source)await resolveFeedbackSource(this.store,this.scientific,this.experiments,id,s,f.input);if(JSON.stringify(this.latest(id,s.id))!==JSON.stringify(feedback))throw Error('FEEDBACK_CHANGED_DURING_DESIGN');return this.store.research.saveNextDesign(d);
  }finally{this.busy.delete(id);}}
  async preview(id:string,designId:string,path:string){const d=this.overview(id).designs.find(d=>d.id===designId),a=d?.artifacts.find(a=>a.path===path);if(!a)throw Error('NEXT_EXPERIMENT_ARTIFACT_NOT_OWNED');const root=this.root(id);return (await readOwnedBytes(root,join(root,path),a.sha256,8*1024*1024)).toString('utf8');}
  read(taskId:string,offset:number,limit:number){const b=this.store.research.binding(taskId);if(!b)throw Error('STUDY_TASK_NOT_OWNED');const p=this.store.research.project(b.projectId);if(!p.activeStudyId)return {study:null,feedback:[],total:0,nextOffset:null};const s=this.study(b.projectId,p.activeStudyId),f=this.latest(b.projectId,s.id);this.current(b.projectId,s,f,taskId);return {study:s,feedback:f.slice(offset,offset+limit),total:f.length,nextOffset:offset+limit<f.length?offset+limit:null};}
  private completedIds(taskId:string,stepId?:string){const journal=this.store.agentJournal.read(taskId),byStep=new Map<string,string>();if(!journal)return new Set<string>();
    for(const a of journal.attempts.filter(a=>a.method==='next_experiment_design'&&a.planRevision===journal.planRevision&&a.state==='completed'&&a.resultRef&&(!stepId||a.stepId===stepId))){
      try{const value=JSON.parse((this.store.agentJournal.readResult(taskId,a.resultRef!) as {content:Array<{text:string}>}).content[0]!.text);if(typeof value.id==='string')byStep.set(a.stepId,value.id);}catch{byStep.delete(a.stepId);}}
    return new Set(byStep.values());}
  taskDesigns(taskId:string){const b=this.store.research.binding(taskId);if(!b)return [];const owned=this.completedIds(taskId);return this.overview(b.projectId).designs.filter(d=>d.taskId===taskId&&owned.has(d.id));}
  async verifyTask(taskId:string){const b=this.store.research.binding(taskId);if(!b)return;for(const d of this.taskDesigns(taskId)){if(d.historical||d.sourceInvalid||d.result.status!=='planned')throw Error('NEXT_EXPERIMENT_BLOCKED_OR_STALE');
    const study=this.study(b.projectId,d.studyId),feedback=this.latest(b.projectId,d.studyId);this.current(b.projectId,study,feedback,taskId);await this.scientific.verifySources(b.projectId,this.sources(study,feedback),taskId);for(const f of feedback)if(f.input.source)await resolveFeedbackSource(this.store,this.scientific,this.experiments,b.projectId,study,f.input);for(const a of d.artifacts)await this.preview(b.projectId,d.id,a.path);}}
  async resolveTaskArtifact(taskId:string,stepId:string,name:string){const files:Record<string,string>={'实验方案 JSON':'design.json','实验方案报告':'report.md','候选表':'candidates.csv','实验顺序表':'schedule.csv','方案复算脚本':'replay.mjs'};if(!files[name])return null;
    const b=this.store.research.binding(taskId);if(!b)return null;const owned=this.completedIds(taskId,stepId);
    const matches=this.overview(b.projectId).designs.filter(d=>d.taskId===taskId&&owned.has(d.id)&&!d.historical&&!d.sourceInvalid&&d.result.status==='planned').flatMap(d=>d.artifacts.filter(a=>basename(a.path)===files[name]).map(a=>({d,a})));if(matches.length!==1)return null;
    const {d,a}=matches[0]!;await this.preview(b.projectId,d.id,a.path);return join(this.root(b.projectId),a.path);}
}
