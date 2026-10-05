import {randomUUID,createHash} from 'node:crypto';
import {dirname,basename,extname,join,resolve} from 'node:path';
import {readOwnedBytes} from '../../../packages/atomistic/src/artifact-io.js';
import {writeScientificFiles} from '../../../packages/agent/src/scientific-artifacts.js';
import {parseExperimentCsv,parseExperimentXlsx} from '../../../packages/agent/src/experiment-input.js';
import {analyzeTensile,type ExperimentTable} from '../../../experiments/tensile.mjs';
import {tensileMarkdown,tensileSvg,tensileCsv} from '../../../packages/agent/src/experiment-report.js';
import {experimentConfigInput,experimentRunInput,type ExperimentDataset,type ExperimentConfig,type ExperimentRun} from '../../../packages/contracts/src/experiments.js';
import type {WorkspaceStore} from './store.js';
import type {ScientificResearch} from './scientific-research.js';
import type {ResearchProject} from '../../../packages/contracts/src/research-project.js';
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const json=(v:unknown)=>JSON.stringify(v,null,2)+'\n';
/** Raw-data companion, sharing WorkspaceStore, grants, source invalidation and the engine tool loop. */
export class ExperimentResearch {
  private busy=new Set<string>();
  constructor(private store:WorkspaceStore,private scientific:ScientificResearch,readonly assetRoot:string,
    private saveProject:(p:ResearchProject,expected:number)=>ResearchProject){}
  private root(projectId:string){this.store.research.project(projectId);return this.store.getProject(projectId)!.path;}
  private idle(projectId:string){if(this.store.listConversations().some(c=>c.projectId===projectId&&this.store.agentJournal.forConversation(c.id).some(s=>s.state==='running')))throw Error('STOP_RESEARCH_BEFORE_EXPERIMENT_EDIT');}
  private async operation<T>(id:string,fn:()=>Promise<T>){this.root(id);if(this.busy.has(id))throw Error('EXPERIMENT_OPERATION_BUSY');this.busy.add(id);try{return await fn();}finally{this.busy.delete(id);}}
  private latest(projectId:string,datasetId:string){return this.store.research.experimentConfigurations(projectId).filter(c=>c.input.datasetId===datasetId).sort((a,b)=>b.revision-a.revision)[0];}
  private dataset(projectId:string,id:string){const d=this.store.research.experimentDatasets(projectId).find(d=>d.id===id);if(!d)throw Error('EXPERIMENT_DATASET_NOT_OWNED');return d;}
  private current(projectId:string,c:ExperimentConfig,taskId:string|null){
    this.scientific.assertCurrent(projectId,c.input.datasetId);this.scientific.assertAccess(projectId,c.input.datasetId);
    const b=taskId?this.store.research.binding(taskId):null,selected=b?.snapshotIds??this.store.research.project(projectId).selected;
    if(taskId&&b?.projectId!==projectId)throw Error('EXPERIMENT_TASK_NOT_OWNED');
    if(!selected.includes(c.input.datasetId)||this.latest(projectId,c.input.datasetId)?.id!==c.id)throw Error('EXPERIMENT_CONFIG_STALE_OR_UNSELECTED');
    if(taskId&&!b!.approvedInputs.some(h=>h.id==='experiment-config:'+c.id&&h.sha256===c.sha256))throw Error('EXPERIMENT_CONFIGURATION_NOT_FROZEN');
  }
  overview(projectId:string){this.root(projectId);return {datasets:this.store.research.experimentDatasets(projectId).filter(d=>!this.scientific.accessDenied(projectId,d.id)),
    configurations:this.store.research.experimentConfigurations(projectId).filter(c=>!this.scientific.accessDenied(projectId,c.input.datasetId)),
    runs:this.store.research.experimentRuns(projectId).map(r=>{
      const stale=r.configurationHashes.some(h=>{const c=this.store.research.experimentConfigurations(projectId).find(c=>c.id===h.id);return !c||this.latest(projectId,c.input.datasetId)?.id!==c.id||this.scientific.invalidSources(projectId).has(c.input.datasetId)||!this.store.research.project(projectId).selected.includes(c.input.datasetId);});
      const denied=r.inputHashes.some(h=>this.scientific.accessDenied(projectId,h.id));
      return {...r,...(stale?{status:'stale' as const}:{}),...(denied?{result:{accessDenied:true},artifacts:[]}:{} )};})};}
  frozenInputs(projectId:string,selected:string[]){return selected.flatMap(id=>{const c=this.latest(projectId,id);return c?[{id:'experiment-config:'+c.id,version:String(c.revision),sha256:c.sha256}]:[];});}
  taskInputs(projectId:string,taskId:string){const b=this.store.research.binding(taskId);if(b?.projectId!==projectId)throw Error('EXPERIMENT_TASK_NOT_OWNED');
    return this.overview(projectId).configurations.filter(c=>b.approvedInputs.some(h=>h.id==='experiment-config:'+c.id&&h.sha256===c.sha256)).map(c=>({configurationId:c.id,datasetId:c.input.datasetId,specimenId:c.input.specimenId,revision:c.revision}));}
  async importFile(projectId:string,path:string){return this.operation(projectId,async()=>{
    this.idle(projectId);const format=extname(path).toLowerCase().slice(1);if(format!=='csv'&&format!=='xlsx')throw Error('EXPERIMENT_FORMAT_UNSUPPORTED');
    const bytes=await readOwnedBytes(dirname(path),path,null,8*1024*1024),table=format==='csv'?parseExperimentCsv(bytes):parseExperimentXlsx(bytes),id=randomUUID();
    const files=await writeScientificFiles(this.root(projectId),id,[{name:'original.'+format,body:bytes},{name:'table.json',body:json(table)}]);
    this.idle(projectId);const d:ExperimentDataset={id,projectId,title:basename(path),format,sheet:table.sheet,createdAt:new Date().toISOString(),columns:table.columns,rows:table.rows.length,original:files[0]!,table:files[1]!,preview:table.rows.slice(0,8)};
    this.store.research.saveExperimentDataset(d);
    this.store.research.saveSnapshot({id,projectId,origin:'project',title:d.title,ref:null,sha256:d.original.sha256,version:id,retrievedAt:d.createdAt,reviewStatus:'needs_review',
      evidence:[{sourceId:id,generation:id,sha256:d.original.sha256,locator:d.original.path}],data:{experiment:{datasetId:id,columns:d.columns,rows:d.rows,original:d.original,table:d.table}},receipts:[]});
    const p=this.store.research.project(projectId);this.saveProject({...p,revision:p.revision+1,selected:[...p.selected,id]},p.revision);return d;
  });}
  private async table(projectId:string,d:ExperimentDataset){const root=this.root(projectId);await readOwnedBytes(root,join(root,d.original.path),d.original.sha256,8*1024*1024);
    return JSON.parse((await readOwnedBytes(root,join(root,d.table.path),d.table.sha256,8*1024*1024)).toString('utf8')) as ExperimentTable;}
  async configure(projectId:string,input:unknown){return this.operation(projectId,async()=>{
    this.idle(projectId);const q=experimentConfigInput.parse(input),d=this.dataset(projectId,q.datasetId);this.scientific.assertCurrent(projectId,d.id);
    const table=await this.table(projectId,d);analyzeTensile([{config:q,table,inputSha256:d.original.sha256}]);this.idle(projectId);
    const value:ExperimentConfig={id:randomUUID(),projectId,revision:q.expectedRevision+1,createdAt:new Date().toISOString(),sha256:sha(json(q)),input:q};
    this.store.research.saveExperimentConfiguration(value);const p=this.store.research.project(projectId);
    this.saveProject({...p,revision:p.revision+1,decisions:[...p.decisions,{at:value.createdAt,origin:'user',text:'Experiment configuration '+value.id+' revision '+value.revision}]},p.revision);return value;
  });}
  async run(projectId:string,taskId:string|null,input:unknown,signal?:AbortSignal){return this.operation(projectId,async()=>{
    if(!taskId)this.idle(projectId);signal?.throwIfAborted();const q=experimentRunInput.parse(input);
    const configurations=q.configurationIds.map(id=>{const c=this.store.research.experimentConfigurations(projectId).find(c=>c.id===id);if(!c)throw Error('EXPERIMENT_CONFIG_NOT_OWNED');this.current(projectId,c,taskId);return c;});
    const samples=[];for(const c of configurations){signal?.throwIfAborted();const d=this.dataset(projectId,c.input.datasetId);samples.push({config:c.input,table:await this.table(projectId,d),inputSha256:d.original.sha256});}
    const result=analyzeTensile(samples,q.independentReplicates),modules=[];
    for(const name of ['tensile.mjs','math.mjs'])modules.push({name,body:await readOwnedBytes(this.assetRoot,join(this.assetRoot,'experiments',name),null,65536)});
    const algorithmSha256=sha(Buffer.concat(modules.map(m=>m.body))),id=randomUUID(),createdAt=new Date().toISOString();
    const summary={...result,curves:result.curves.map(({points,...c})=>({...c,retainedRows:points.length}))};
    const receipt:ExperimentRun={id,projectId,taskId,createdAt,policyVersion:'ua8-tensile-v1',scientificStatus:'needs_review',productionApproved:false,status:'completed',request:q,
      configurationHashes:configurations.map(c=>({id:c.id,sha256:c.sha256})),inputHashes:configurations.map(c=>{const d=this.dataset(projectId,c.input.datasetId);return {id:d.id,sha256:d.original.sha256};}),algorithmSha256,result:summary,artifacts:[]};
    const script="import {readFileSync,writeFileSync} from 'node:fs';\nimport {createHash} from 'node:crypto';\nimport {analyzeTensile} from './tensile.mjs';\nconst input=JSON.parse(readFileSync(new URL('./input.json',import.meta.url),'utf8'));\nconst env=JSON.parse(readFileSync(new URL('./environment.json',import.meta.url),'utf8'));\nfor(const [name,digest] of Object.entries(env.files)){if(createHash('sha256').update(readFileSync(new URL('./'+name,import.meta.url))).digest('hex')!==digest)throw Error('REPLAY_INPUT_CHANGED:'+name);}\nwriteFileSync(new URL('./replay-result.json',import.meta.url),JSON.stringify(analyzeTensile(input.samples,input.independentReplicates),null,2)+'\\n');\n";
    const replayInput=json({samples,independentReplicates:q.independentReplicates}),params=json({request:q,configurations}),environment=json({policyVersion:receipt.policyVersion,algorithmSha256,node:process.versions.node,platform:process.platform,arch:process.arch,dependencies:'Node standard library only',files:Object.fromEntries([...modules.map(m=>[m.name,sha(m.body)]),['input.json',sha(replayInput)],['params.json',sha(params)],['replay.mjs',sha(script)]])});
    signal?.throwIfAborted();receipt.artifacts=await writeScientificFiles(this.root(projectId),id,[{name:'result.json',body:json({...receipt,result})},
      {name:'report.md',body:tensileMarkdown(result)},{name:'chart.svg',body:tensileSvg(result)},{name:'points.csv',body:tensileCsv(result)},
      {name:'input.json',body:replayInput},{name:'params.json',body:params},{name:'environment.json',body:environment},{name:'replay.mjs',body:script},...modules]);
    signal?.throwIfAborted();for(const c of configurations){this.current(projectId,c,taskId);await this.table(projectId,this.dataset(projectId,c.input.datasetId));}
    if(!taskId)this.idle(projectId);return this.store.research.saveExperimentRun(receipt);
  });}
  async preview(projectId:string,runId:string,path:string){const r=this.overview(projectId).runs.find(r=>r.id===runId),a=r?.artifacts.find(a=>a.path===path);if(!a)throw Error('EXPERIMENT_ARTIFACT_NOT_OWNED');
    const root=this.root(projectId);return (await readOwnedBytes(root,join(root,path),a.sha256,8*1024*1024)).toString('utf8');}
  async verifyTask(taskId:string){const b=this.store.research.binding(taskId);if(!b)return;
    for(const r of this.overview(b.projectId).runs.filter(r=>r.taskId===taskId)){
      if(r.status==='stale'||!r.artifacts.length)throw Error('EXPERIMENT_RESULT_STALE');
      for(const h of r.configurationHashes){const c=this.store.research.experimentConfigurations(b.projectId).find(c=>c.id===h.id)!;this.current(b.projectId,c,taskId);await this.table(b.projectId,this.dataset(b.projectId,c.input.datasetId));}
      for(const a of r.artifacts)await this.preview(b.projectId,r.id,a.path);
    }
  }
  async resolveTaskArtifact(taskId:string,stepId:string,name:string){
    const file:Record<string,string>={'实验 JSON':'result.json','实验报告':'report.md','应力应变图':'chart.svg','实验数据表':'points.csv','复算脚本':'replay.mjs'};
    if(!file[name])return null;const b=this.store.research.binding(taskId),s=this.store.agentJournal.read(taskId);if(!b||!s)return null;
    const owned=new Set(s.attempts.filter(a=>a.method==='experiment_analyze'&&a.stepId===stepId&&a.planRevision===s.planRevision&&a.state==='completed'&&a.resultRef).map(a=>{
      const receipt=this.store.agentJournal.readResult(taskId,a.resultRef!) as {content?:Array<{text?:string}>};try{return JSON.parse(receipt.content?.[0]?.text??'null')?.id;}catch{return null;}}));
    const matches=this.overview(b.projectId).runs.filter(r=>r.taskId===taskId&&owned.has(r.id)&&r.status==='completed').flatMap(r=>r.artifacts.filter(a=>basename(a.path)===file[name]).map(a=>({r,a})));
    if(matches.length!==1)return null;const {r,a}=matches[0]!;await this.preview(b.projectId,r.id,a.path);return join(this.root(b.projectId),a.path);
  }
}
