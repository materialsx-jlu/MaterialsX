import {recipeProposalInput,buildRecipeProposal,acceptedRecipeProposals,recipeProposalGuidance} from './research-recipe-proposal.js';
import {recipeProposalIssue} from './research-recipe-followup.js';
import {priorRecipeSources} from './research-continuity.js';
import {recipeProposalFollowup} from '../../../packages/agent/src/research-intent.js';
import {recipeScope,recipeScopeMatches} from '../../../packages/agent/src/research-recipe-scope.js';
import {recipeLookup,recipeSnapshots,recipeSourceText,recipeBundle,requestedRecipeCount} from './research-recipe-view.js';
import {CampaignResearch} from './campaign-research.js';
import {campaignToolInput} from '../../../packages/contracts/src/campaigns.js';
import {analysisSummary} from '../../../packages/agent/src/research-analysis-report.js';
import type {ResearchPaperService} from "./paper-service.js";
import {MethodPackages} from './method-packages.js';
import {methodPackageQuery} from '../../../packages/contracts/src/method-packages.js';
import {ScientificResearch} from './scientific-research.js';
import {NextExperimentResearch} from './next-experiment-research.js';
import {nextDesignInput} from '../../../packages/contracts/src/next-experiment.js';
import {ExperimentResearch} from './experiment-research.js';
import {experimentRunInput} from '../../../packages/contracts/src/experiments.js';
import {numericReportRequest,sourceDeliveryRequested,tensileTask,nextExperimentTask} from '../../../packages/agent/src/research-tools.js';
import {extractLocalPdfPath} from '../../../packages/pi-adapter/src/local-session-tools.js';
import {qualityAuditToolInput} from '../../../packages/contracts/src/scientific-quality.js';
import {methodToolInput,methodRunToolInput} from '../../../packages/contracts/src/research-methods.js';
import {randomUUID} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {existsSync} from 'node:fs';
import {z} from 'zod';
import {Type} from 'typebox';
import {defineTool} from '@earendil-works/pi-coding-agent';
import type {WorkspaceStore} from './store.js';
import {MaterialsMcpClient} from '../../../packages/agent/src/mcp-client.js';
import {DataSourceRouter,sourceHash} from '../../../packages/agent/src/data-source-router.js';
import {unreviewedSourceRequested} from '../../../packages/agent/src/research-source-policy.js';
import {ResearchCandidates} from '../../../packages/agent/src/research-candidates.js';
import {writeResearchDelivery} from '../../../packages/agent/src/research-delivery.js';
import {readOwnedBytes} from '../../../packages/atomistic/src/artifact-io.js';
import {AgentError} from '../../../packages/contracts/src/agent.js';
import {moosRefSchema,type MoosRef,type ResearchSnapshot,type ResearchBinding,type ResearchProject} from '../../../packages/contracts/src/research-project.js';
function localMoosClient(options:{directory?:string;origin?:string;client?:MaterialsMcpClient|null}){
    const directory=options.directory?resolve(options.directory):null,origin=new URL(options.origin??'http://127.0.0.1:8080');
    if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)||origin.protocol!=='http:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw Error('MOOS_ORIGIN_MUST_BE_LOOPBACK');
    return options.client!==undefined?options.client:directory&&existsSync(join(directory,'dist/src/server.js'))?new MaterialsMcpClient({command:process.execPath,args:[join(directory,'dist/src/server.js')],cwd:directory,
      env:{PATH:process.env.PATH??'',ELECTRON_RUN_AS_NODE:'1',MOOS_API_ORIGIN:origin.origin,MOOS_CONNECTION_ID:'moos-local',NO_PROXY:'127.0.0.1,localhost,::1'}}):null;
 }
export class ResearchService {
  moosConfigured(projectId:string){return !!(this.teamClient?.(projectId)??this.client);}
  private candidates=new ResearchCandidates();
  teamAccessKey:(id:string)=>string|null=()=>null;
  private teamInput(id:string){const key=this.teamAccessKey(id);return key?[{id:'team-access:'+id,version:key,sha256:key}]:[];}
  teamClient:((id:string)=>MaterialsMcpClient|null|undefined)|null=null;
  authorizeProject:(id:string,cloud:boolean)=>Promise<void>=async()=>{};
  private route(){return new DataSourceRouter(this.store.research,id=>this.teamClient?.(id)??this.client);}
  papers:ResearchPaperService|null=null;
  readonly campaigns:CampaignResearch;
  readonly scientific:ScientificResearch;
  readonly methodPackages:MethodPackages;
  readonly experiments:ExperimentResearch;
  readonly nextExperiments:NextExperimentResearch;
  router:DataSourceRouter;private client:MaterialsMcpClient|null;
  constructor(private store:WorkspaceStore,options:{directory?:string;origin?:string;client?:MaterialsMcpClient|null;assetRoot?:string;jobStateRoot?:string}={}){
    this.client=localMoosClient(options);
    this.router=this.route();
    this.campaigns=new CampaignResearch(store,resolve(options.assetRoot??process.cwd()),resolve(options.jobStateRoot??join(options.assetRoot??process.cwd(),'runtime/long-jobs')));
    this.methodPackages=new MethodPackages(store.research,resolve(options.assetRoot??process.cwd()));
    this.scientific=new ScientificResearch(store,(s,t,signal)=>this.router.verify(s,t,signal),this.methodPackages);
    this.experiments=new ExperimentResearch(store,this.scientific,resolve(options.assetRoot??process.cwd()),(p,e)=>this.save(p,e));
    this.nextExperiments=new NextExperimentResearch(store,this.scientific,this.experiments,resolve(options.assetRoot??process.cwd()));
  }
  async configure(config:import('../../../packages/contracts/src/agent-configuration.js').McpConfiguration,allowMissing=false){
    if(!allowMissing&&config.enabled&&(!config.directory||!existsSync(join(config.directory,'dist/src/server.js'))))throw Error('MOOS_MCP_SERVER_NOT_BUILT');
    const client=localMoosClient({...(config.enabled&&config.directory?{directory:config.directory}:{client:null}),origin:config.origin});
    await this.close();this.client=client;this.router=this.route();
  }
  revisionBinding(taskId:string){const b=this.store.research.binding(taskId);if(!b)throw Error("RESEARCH_BINDING_MISSING");const p=this.store.research.project(b.projectId);return {...b,projectRevision:p.revision,conditions:p.conditions,materialSystem:p.materialSystem,samples:p.samples,snapshotIds:p.selected,approvedInputs:[...this.teamInput(p.projectId),{id:"research-project:"+p.projectId,version:String(p.revision),sha256:sourceHash(p)},...p.selected.map(id=>{const s=this.store.research.snapshot(p.projectId,id);return {id,version:s.version,sha256:s.sha256};}),...this.experiments.frozenInputs(p.projectId,p.selected),...this.nextExperiments.frozenInputs(p.projectId),...this.methodPackages.frozenInputs(),...this.campaigns.frozenInputs(p.projectId)]};}
  async diagnostic(){
    const config=this.store.mcpConfiguration();
    if(!config.enabled)return {id:'mcp-local',name:'MOOS MCP',kind:'mcp' as const,status:'attention' as const,detail:'连接已关闭；在下方启用并保存后重新检测'};
    if(!this.client)return {id:'mcp-local',name:'MOOS MCP',kind:'mcp' as const,status:'attention' as const,detail:'MCP 目录未配置或未构建；请检查下方服务路径'};
    try{await this.client.connect();const project=this.store.listProjects()[0];if(project)await this.router.moos(project.id,null,'moos_status',{});return {id:'mcp-local',name:'MOOS MCP',kind:'mcp' as const,status:'ready' as const,detail:project?'只读连接和数据源已核实 / Read-only transport and source checked':'只读协议已连接；选择项目后检查数据源 / Transport connected; select a project to check data'};
    }catch{
      let detail='MOOS MCP 协议或数据索引不可用；检查 MOOS 后端与 MCP 配置';
      try{const health=await fetch(`${config.origin}/api/health`,{signal:AbortSignal.timeout(2000)});detail=health.ok?'MOOS API 在线，但 MCP 数据接口未就绪；检查知识索引开关和服务日志':'MOOS API 健康检查失败；请检查后端日志';}
      catch{detail=`MOOS API 未运行；请启动 ${config.origin} 后重新检测`;}
      return {id:'mcp-local',name:'MOOS MCP',kind:'mcp' as const,status:'offline' as const,detail};
    }
  }
  async close(){this.candidates.clear();await this.client?.close();}
  begin(taskId:string,projectId:string,content:string,conversationId?:string):ResearchBinding{
    const existing=this.store.research.binding(taskId);if(existing){if((existing.approvedInputs.find(i=>i.id==='team-access:'+projectId)?.sha256??null)!==this.teamAccessKey(projectId))throw Error('TEAM_TASK_AUTHORIZATION_CHANGED');return existing;}
    const p=this.store.research.project(projectId),prior=conversationId?priorRecipeSources(this.store,projectId,conversationId,content,this.teamAccessKey(projectId)):[];
    // Explicit follow-ups use the exact previous delivered sources, not unrelated project selections.
    const snapshots=prior.length?prior:p.selected.map(id=>this.store.research.snapshot(projectId,id)),selected=snapshots.map(s=>s.id);
    for(const s of snapshots){this.scientific.assertCurrent(projectId,s.id);if(p.withdrawn.includes(s.id))throw Error('SOURCE_WITHDRAWN');}
    const approvedInputs=[...this.teamInput(projectId),{id:'research-project:'+projectId,version:String(p.revision),sha256:sourceHash(p)},...snapshots.map(s=>({id:s.id,version:s.version,sha256:s.sha256})),...this.experiments.frozenInputs(projectId,selected),...this.nextExperiments.frozenInputs(projectId),...this.methodPackages.frozenInputs(),...this.campaigns.frozenInputs(p.projectId)];
    return this.store.research.saveBinding({taskId,projectId,projectRevision:p.revision,locale:/[\u3400-\u9fff]/.test(content)?'zh':'en',conditions:p.conditions,materialSystem:p.materialSystem,samples:p.samples,delivery:p.delivery,snapshotIds:selected,approvedInputs,createdAt:new Date().toISOString()});
  }
  context(taskId:string){const b=this.store.research.binding(taskId);return b?{inputVersions:b.approvedInputs,sourceUnits:[...new Set(b.snapshotIds.flatMap(id=>(this.visibleSnapshot(this.store.research.snapshot(b.projectId,id)).data.observations as any[]??[]).map(o=>o.unit).filter((u):u is string=>typeof u==='string'&&u.length>0)))],evidence:b.snapshotIds.flatMap(id=>this.visibleSnapshot(this.store.research.snapshot(b.projectId,id)).evidence),guidance:JSON.stringify({researchProject:{revision:b.projectRevision,materialSystem:b.materialSystem,conditions:b.conditions,samples:b.samples,snapshotIds:b.snapshotIds,dataIndex:b.snapshotIds.slice(0,8).map(id=>{const s=this.visibleSnapshot(this.store.research.snapshot(b.projectId,id));return {snapshotId:id,title:s.title,origin:s.origin,reviewStatus:s.reviewStatus,observations:(s.data.observations as any[]??[]).slice(0,12).map(o=>({id:o.id,property:o.property,unit:o.unit})),studyIds:(s.data.nodes as any[]??[]).filter(n=>n.type==='simulation_study').map(n=>n.id).slice(0,12),moreData:'Use research_data read for bounded source rows'};})},longJobConfigurations:this.campaigns.inputs(taskId),longJobPolicy:'Use campaign_job submit with a frozen configurationId and reason. Queued is not finished. End the model turn while computing. Recovery queries the original ID; never resubmit unknown or completed jobs.',nextExperimentStudy:this.nextExperiments.overview(b.projectId).study,experimentInputs:this.experiments.taskInputs(b.projectId,taskId),recipeProposal:recipeProposalGuidance(this.store,taskId,s=>{try{this.scientific.assertCurrent(s.projectId,s.id);return true;}catch{return false;}}),recipeRetrieval:recipeLookup(this.store.researchPlan(taskId)?.originalRequest??'')?{scope:recipeScope(this.store.researchPlan(taskId)?.originalRequest??''),finalResponse:'After reading the requested distinct source recipes, reply briefly. The host renders original amounts, preparation steps, evidence pages and missing fields directly from verified receipts; do not rewrite long source tables or invent recipe improvements.',requestedCount:requestedRecipeCount(this.store.researchPlan(taskId)?.originalRequest??''),readCount:recipeSnapshots(this.store,taskId).length,candidates:this.recipeReadCandidates(taskId),readHint:'Use action=read_recipes with candidateIds chosen from search for up to five source bundles per call, or read section=recipe for ingredients, processes and linked evidence in one call; select alone does not count as reading.'}:null,deliveryContract:b.delivery,qualityAuditCandidate:!tensileTask(this.store.researchPlan(taskId)?.originalRequest??'')&&!nextExperimentTask(this.store.researchPlan(taskId)?.originalRequest??'')&&b.snapshotIds.length&&b.snapshotIds.length<=20&&!this.store.agentJournal.read(taskId)?.attempts.some(a=>a.method==='research_quality'&&a.state==='completed'&&a.planRevision===this.store.researchPlan(taskId)?.planRevision)?{tool:'research_quality',arguments:{claims:[]},snapshotIds:b.snapshotIds,policy:'Only when source quality checking is required and this step allows it. Copy the actual IDs exactly; never add unrelated fields or guess an ID.'}:null,pendingMethodRuns:this.scientific.executionCandidates(b.projectId,taskId).slice(0,4),
    policy:'Project inputs first, then research_data search on MOOS. For recipe requests: search short relevant keywords (e.g. 水性, waterborne, aqueous); follow nextCursor when a page is filtered or irrelevant; select the exact returned candidateId, then read recipes, ingredients, processes, observations and readEvidence using the returned snapshotId. Search hits alone are not recipes or evidence. Project matches are not the full catalog: use source=moos to get additional distinct recipes when the requested count is not met. Already selected snapshotIds from context can be read directly; never put a snapshot UUID into candidateId. If the original request explicitly allows pending review, use reviewScope=include-unreviewed and preserve pending_review labels; otherwise verified only. Never invent a MOOS configuration error or claim a tool ran without its receipt. Use actual snapshot/observation IDs. Research sources are local only; do not send to cloud without specific export authorization. '+
      (nextExperimentTask(this.store.researchPlan(taskId)?.originalRequest??'')?'For next experiment planning, read next_experiment_data, then use next_experiment_design with the actual active studyId, saved constraints, method, points, seed and reason. Missing study settings require the study editor. Candidate plans do not execute physical experiments. DOE/random/GP proxies are not proof of superiority.':tensileTask(this.store.researchPlan(taskId)?.originalRequest??'')?'For raw tensile analysis, read experimentInputs and experiment_data for exact frozen configuration IDs. Use experiment_analyze with saved metadata/ranges/exclusions, an actual reason, and independentReplicates=false unless the user explicitly establishes independence. Do not route these raw curves through research_methods or source comparison. Missing configurations require the experimental editor; never guess measurement metadata.':numericReportRequest(this.store.researchPlan(taskId)?.originalRequest??'')?'For this numeric task, read the selected observations, check evidence with research_quality, assess eligible methods with research_methods action=assess and task=summarize/fit/validate, then use research_method_run with the returned assessmentId and eligible methodId. This tool writes the requested actual JSON and report. Inspect its results and answer; an additional CSV/SVG source comparison is not requested.':
      'For source comparisons requesting CSV/SVG/report, use research_delivery after data collection. It renders source data and checks frozen criteria, not simulations. General explanations can answer directly.')})}:null;}
  private visibleSnapshot(s:ResearchSnapshot){return this.scientific.accessDenied(s.projectId,s.id)?{...s,data:{accessDenied:true},evidence:[],receipts:[]}:s;}
  deliveries(projectId:string){
    const invalid=this.scientific.invalidSources(projectId);
    return this.store.research.deliveries(projectId).map(d=>{
      const sourceChanged=d.snapshotIds.some(id=>invalid.has(id));
      const planChanged=this.store.researchPlan(d.taskId)?.planRevision!==d.planRevision&&(!d.stepIds.length||d.stepIds.some(id=>this.store.agentJournal.read(d.taskId)?.steps.find(s=>s.id===id)?.state!=='completed'));
      const denied=d.snapshotIds.some(id=>this.scientific.accessDenied(projectId,id));
      return {...d,...(sourceChanged||planChanged?{status:'stale' as const}:{}),...(denied?{sourceResult:{accessDenied:true},artifacts:[]}:{} )};
    });
  }
  overview(id:string){const o=this.store.research.overview(id);o.deliveries=this.deliveries(id);o.snapshots=o.snapshots.map(s=>this.visibleSnapshot(s));return o;}

  deliveryText(taskId:string){const b=this.store.research.binding(taskId),root=b&&this.store.getProject(b.projectId)?.path;if(!b||!root)return '';const d=this.deliveries(b.projectId).filter(d=>d.taskId===taskId).at(-1);
    const labels=b.locale==='zh'?{table:'数据表',chart:'概览图',report:'报告',image:'授权图片'}:{table:'Data table',chart:'Overview',report:'Report',image:'Authorized image'};
    const experiment=this.experiments.overview(b.projectId).runs.filter(r=>r.taskId===taskId&&r.status==='completed').at(-1);
    const next=this.nextExperiments.taskDesigns(taskId).filter(d=>!d.historical&&!d.sourceInvalid).at(-1);
    const analysis=this.scientific.overview(b.projectId).analyses.filter(a=>a.taskId===taskId).at(-1);
    return (next?'\n\n'+(b.locale==='zh'?'下一轮实验方案（尚未执行）：':'Next experiment plan (not executed): ')+next.artifacts.filter(a=>/design.json|report.md|candidates.csv|schedule.csv|replay.mjs$/.test(a.path)).map(a=>'['+a.path.split('/').at(-1)+']('+encodeURI(join(root,a.path))+')').join(' · '):'')+(experiment?'\n\n'+(b.locale==='zh'?'实验分析（待复核）：':'Experiment analysis (review required): ')+experiment.artifacts.filter(a=>/result.json|report.md|chart.svg|points.csv|replay.mjs$/.test(a.path)).map(a=>'['+a.path.split('/').at(-1)+']('+encodeURI(join(root,a.path))+')').join(' · '):'')+(d?'\n\n'+(b.locale==='zh'?'研究交付：':'Research deliverables: ')+d.artifacts.filter(a=>a.kind!=='image').map(a=>'['+labels[a.kind]+']('+encodeURI(join(root,a.path))+')').join(' · ')+'\n'+(b.locale==='zh'?'验收状态：':'Acceptance: ')+d.status+' · '+(b.locale==='zh'?'科学结论待复核。':'Scientific conclusions require review.'):'')+
      (analysis?analysisSummary(analysis,b.locale)+'\n\n'+(b.locale==='zh'?'分析产物（结论待复核）：':'Analysis files (review required): ')+analysis.artifacts.map(a=>'['+(a.path.endsWith('.md')?labels.report:'JSON')+']('+encodeURI(join(root,a.path))+')').join(' · '):'');
  }
  async sourceAnswer(taskId:string){const plan=this.store.researchPlan(taskId);if(!plan||!(recipeLookup(plan.originalRequest)||recipeProposalFollowup(plan.originalRequest)))return null;const snapshots=recipeSnapshots(this.store,taskId);for(const s of snapshots){this.scientific.assertCurrent(s.projectId,s.id);await this.router.verify(s,taskId);}if(recipeProposalFollowup(plan.originalRequest))return acceptedRecipeProposals(this.store,taskId).map(r=>r.text).join('\n\n')||null;return snapshots.length?recipeSourceText(snapshots,requestedRecipeCount(plan.originalRequest)):null;}
  recipeReadCandidates(taskId:string){const b=this.store.research.binding(taskId),plan=this.store.researchPlan(taskId);if(!b||!plan||!recipeLookup(plan.originalRequest))return [];
    const read=new Set(recipeSnapshots(this.store,taskId).map(s=>s.id)),items=new Map<string,unknown>();
    for(const a of this.store.agentJournal.read(taskId)?.attempts??[]){if(a.method!=='research_data'||a.state!=='completed'||a.planRevision!==plan.planRevision||!a.resultRef)continue;
      const receipt=this.store.agentJournal.readResult(taskId,a.resultRef),result=JSON.parse(receipt.content?.find((c:any)=>c.type==='text')?.text??'null');
      for(const item of result?.items??[]){if(!item.candidateId)continue;try{const target=this.candidates.resolveTarget(b.projectId,taskId,item.candidateId);
        if(target.kind==='snapshot'&&read.has(target.snapshotId)||target.kind==='moos'&&recipeSnapshots(this.store,taskId).some(s=>sourceHash(s.ref)===sourceHash(target.ref)))continue;
        items.set(item.candidateId,{candidateId:item.candidateId,title:item.title,label:item.label,arguments:{action:'read_recipes',candidateIds:[item.candidateId]}});
      }catch{/* Expired or scoped handles must be searched again. */}}
    }return [...items.values()].slice(-12);
  }
  recipeRetrievalIssue(taskId:string){const proposal=recipeProposalIssue(this.store,taskId);if(proposal)return proposal;const plan=this.store.researchPlan(taskId);if(!plan||!recipeLookup(plan.originalRequest))return null;
    const read=recipeSnapshots(this.store,taskId).length,required=requestedRecipeCount(plan.originalRequest);
    return read<required?`Incomplete source retrieval: 已读取 ${read}/${required} 个不同的真实 MOOS 配方。Use research_data action=read_recipes,candidateIds=[the exact chosen search handles] to select AND read recipes in one call. Available source choices: ${JSON.stringify(this.recipeReadCandidates(taskId))}. Continue tool execution until ${required} distinct recipes have been read; do not end after one source. Alternatively select exact candidateId, then read section=recipe with returned snapshotId; Sources must match requested material categories; electrospun membranes and non-waterborne films do not count as waterborne cooling paints. When scope filtering removes results, refine the query to ${recipeScope(plan.originalRequest)?.suggestedQuery??'the requested material'}; project matches are partial, use source=moos and approved reviewScope to search more. Do not ask the user for internal IDs or invent missing recipes.`:null;
  }
  deliveryIssue(taskId:string){const plan=this.store.researchPlan(taskId),used=this.store.agentJournal.read(taskId)?.attempts.some(a=>a.method==="research_delivery"&&a.state!=="stale");
    const retrieval=this.recipeRetrievalIssue(taskId);if(retrieval)return retrieval;
    const currentBinding=this.store.research.binding(taskId);if(currentBinding){const overview=this.scientific.overview(currentBinding.projectId);
      if(currentBinding.snapshotIds.some(id=>overview.impact.snapshotIds.includes(id)))return '研究来源已更新或撤回，相关结论失效；请选择新版本并修订受影响步骤 / Research source changed or was withdrawn; revise affected steps';
      if(overview.audits.some(a=>a.taskId===taskId&&a.claims.length&&a.decision!=='usable-with-limitations'))return '结论的字段或证据回链未通过检查 / Claim field/evidence checks failed';}
    const nextBinding=this.store.research.binding(taskId),requestedNext=nextExperimentTask(plan?.originalRequest??'')&&/生成|安排|推荐|generate|produce|recommend|@materials-next-experiment/i.test(plan?.originalRequest??'');
    if(nextBinding&&(plan?.steps.some(s=>s.method==='next_experiment_design')||this.store.agentJournal.read(taskId)?.attempts.some(a=>a.method==='next_experiment_design')||requestedNext)){
      const results=this.nextExperiments.taskDesigns(taskId);
      return !results.length?'实验方案尚未生成 / Experiment plan is missing':results.some(d=>d.historical||d.sourceInvalid||d.result.status!=='planned')?'实验方案被阻止或已失效 / Experiment plan is blocked or stale':null;
    }
    const experimentBinding=this.store.research.binding(taskId);
    if((plan?.steps.some(s=>s.method==='experiment_analyze')||this.store.agentJournal.read(taskId)?.attempts.some(a=>a.method==='experiment_analyze')||tensileTask(plan?.originalRequest??'')&&/分析|计算|提取|生成|拟合|analy|calculate|extract|fit|produce/i.test(plan?.originalRequest??''))&&experimentBinding){const results=this.experiments.overview(experimentBinding.projectId).runs.filter(r=>r.taskId===taskId);if(!results.length)return '实验分析文件尚未生成 / Experiment files are missing';if(results.some(r=>r.status==='stale'))return '实验输入或配置已变更 / Experiment input or configuration changed';return null;}
    const binding=this.store.research.binding(taskId),requested=plan&&sourceDeliveryRequested(plan.originalRequest,!!binding?.snapshotIds.length,extractLocalPdfPath(plan.originalRequest)??undefined);
    const numericOnly=plan&&numericReportRequest(plan.originalRequest);
    if(!used&&numericOnly&&!plan.steps.some(s=>s.method==='research_delivery')&&binding&&
      this.scientific.overview(binding.projectId).analyses.some(a=>a.taskId===taskId&&a.status!=='stale'))return null;
    if(!used&&!requested&&!plan?.steps.some(s=>s.method==="research_delivery"))return null;
    const d=this.deliveries(plan!.task.projectId).filter(d=>d.taskId===taskId&&d.planRevision===plan!.planRevision).at(-1);
    return !d?"研究交付文件尚未生成 / Research deliverables are missing":d.status!=="accepted-with-limitations"?"研究交付未通过逐项检查或来源已失效 / Delivery checks failed or source is stale":null;
  }
  save(value:ResearchProject,expected:number){
    if(this.store.listConversations().filter(c=>c.projectId===value.projectId).some(c=>this.store.agentJournal.forConversation(c.id).some(s=>s.state==='running')))throw new AgentError('CONFLICT','Stop running research before editing project inputs');
    const previous=this.store.research.project(value.projectId);
    const changed=(['materialSystem','conditions','samples','selected','withdrawn','delivery','activeStudyId'] as const).filter(key=>JSON.stringify(previous[key])!==JSON.stringify(value[key]));
    const decisions=changed.length&&JSON.stringify(previous.decisions)===JSON.stringify(value.decisions)?[...value.decisions,{at:new Date().toISOString(),origin:'user' as const,text:'修改 / Revised: '+changed.join(', ')}]:value.decisions;
    return this.store.research.saveProject({...value,decisions},expected);
  }
  private bindSnapshot(projectId:string,taskId:string|null,s:ResearchSnapshot){
    this.scientific.assertCurrent(projectId,s.id);
    if(taskId){if(this.store.research.project(projectId).withdrawn.includes(s.id))throw Error('SOURCE_WITHDRAWN');const b=this.store.research.binding(taskId);if(!b||b.projectId!==projectId)throw new AgentError('PERMISSION_DENIED','Research task scope mismatch');if(!b.snapshotIds.includes(s.id))this.store.research.saveBinding({...b,snapshotIds:[...b.snapshotIds,s.id]});}
    else {const p=this.store.research.project(projectId);if(!p.selected.includes(s.id)&&!p.withdrawn.includes(s.id))this.store.research.saveProject({...p,revision:p.revision+1,selected:[...p.selected,s.id]},p.revision);}
    return s;
  }
  async select(projectId:string,ref:MoosRef,taskId:string|null=null,signal?:AbortSignal){return this.bindSnapshot(projectId,taskId,await this.router.select(projectId,taskId,ref,signal));}
  async import(projectId:string,path:string){
    if(!this.store.getProject(projectId))throw Error('PROJECT_NOT_FOUND');
    // File dialog gives an explicit project input; no private metadata or arbitrary paths inside the document are followed.
    const text=(await readOwnedBytes(dirname(path),path,null,512*1024)).toString('utf8');
    const input=z.strictObject({title:z.string().min(1).max(300),data:z.record(z.string(),z.array(z.record(z.string(),z.unknown())))}).parse(JSON.parse(text));
    const data=input.data,sha256=sourceHash(data);
    const readEvidence=data.readEvidence??[];if(readEvidence.length>200||readEvidence.some(e=>typeof e.id!=='string'||!e.id)||new Set(readEvidence.map(e=>e.id)).size!==readEvidence.length)throw Error('LOCAL_EVIDENCE_ID_INVALID_OR_LIMIT');
    const s=this.store.research.saveSnapshot({id:randomUUID(),projectId,origin:'project',title:input.title,ref:null,sha256,version:sha256,retrievedAt:new Date().toISOString(),reviewStatus:'unreviewed',
      evidence:readEvidence.map(e=>({sourceId:'local:'+sha256,generation:sha256,locator:String(e.id),sha256:sourceHash(e)})),data,receipts:[]});
    return this.bindSnapshot(projectId,null,s);
  }
  async refresh(projectId:string,id:string){
    const old=this.store.research.snapshot(projectId,id);if(!old.ref)throw Error('Local input must be imported again as a new snapshot');
    // A stale generation cannot be silently replaced. Re-search current candidates, then explicitly select a new version.
    await this.router.verify(old,null);return old;
  }
  async image(projectId:string,id:string,mediaId:string){
    this.scientific.assertCurrent(projectId,id);
    const p=this.store.research.project(projectId);if(p.withdrawn.includes(id))throw Error('SOURCE_WITHDRAWN');
    const image=await this.router.image(projectId,null,this.store.research.snapshot(projectId,id),mediaId);const {bytes,...preview}=image;return preview;
  }
  async preview(projectId:string,deliveryId:string,kind:'table'|'chart'|'report'){
    const p=this.store.getProject(projectId),d=this.store.research.deliveries(projectId).find(d=>d.id===deliveryId),a=d?.artifacts.find(a=>a.kind===kind);
    if(!p||!a)throw Error('ARTIFACT_NOT_OWNED');for(const id of d!.snapshotIds)this.scientific.assertAccess(projectId,id);return (await readOwnedBytes(p.path,join(p.path,a.path),a.sha256)).toString('utf8');
  }
  async data(projectId:string,taskId:string,input:unknown,signal?:AbortSignal):Promise<unknown>{
    const q=dataInput.parse(input),b=this.store.research.binding(taskId);if(!b||b.projectId!==projectId)throw Error('RESEARCH_TASK_MISSING');
    if(q.action==='read_current_recipes'){
      if(Object.keys(q).some(k=>k!=='action'))throw Error('CURRENT_RECIPE_READ_REQUIRES_ACTION_ONLY');
      if(!recipeProposalFollowup(this.store.researchPlan(taskId)?.originalRequest??''))throw Error('CURRENT_RECIPE_READ_REQUIRES_SOURCE_PROPOSAL_TASK');
      if(!b.snapshotIds.length||b.snapshotIds.length>5)throw Error('CURRENT_RECIPE_READ_REQUIRES_ONE_TO_FIVE_BOUND_SOURCES');
      const snapshots=[];for(const snapshotId of b.snapshotIds)snapshots.push(await this.data(projectId,taskId,{action:'read',snapshotId,section:'recipe'},signal));
      return {snapshots,qualification:'Original source data only; distinguish proposed changes from these facts. Gaps and pending review remain. No experiment was executed.'};
    }
    if(q.action==='read_recipes'){
      if(!q.candidateIds?.length||q.candidateId||q.snapshotId||q.ref)throw Error('BATCH_RECIPE_REQUIRES_ONLY_SEARCHED_CANDIDATES');
      const snapshots=[];for(const candidateId of q.candidateIds){const selected=await this.data(projectId,taskId,{action:'select',candidateId},signal) as {snapshotId:string};snapshots.push(await this.data(projectId,taskId,{action:'read',snapshotId:selected.snapshotId,section:'recipe'},signal));}
      return {snapshots,qualification:'Source-grounded candidates, not performed experiments. Preserve all gaps and review labels.'};
    }
    if(q.candidateId){
      if(q.action!=='select'||q.ref||q.snapshotId)throw Error('CANDIDATE_SELECT_REQUIRES_ONE_REFERENCE');
      const target=this.candidates.resolveTarget(projectId,taskId,q.candidateId);
      if(target.kind==='moos')q.ref=target.ref;
      else {const snapshot=this.store.research.snapshot(projectId,target.snapshotId);if(snapshot.version!==target.version||snapshot.sha256!==target.sha256)throw Error('MOOS_CANDIDATE_SNAPSHOT_CHANGED');q.snapshotId=target.snapshotId;}
    }
    if(q.action==='context')return {...this.context(taskId),snapshots:b.snapshotIds.map(id=>{const s=this.visibleSnapshot(this.store.research.snapshot(projectId,id));return {id,title:s.title,sha256:s.sha256,reviewStatus:s.reviewStatus,evidence:s.evidence};})};
    const request=this.store.researchPlan(taskId)?.originalRequest??'',followup=recipeProposalFollowup(request);
    const boundRef=q.ref&&b.snapshotIds.some(id=>sourceHash(this.store.research.snapshot(projectId,id).ref)===sourceHash(q.ref));
    if((q.reviewScope==='include-unreviewed'||q.ref?.reviewScope==='include-unreviewed')&&
      (followup?!boundRef:!b.snapshotIds.some(id=>this.store.research.snapshot(projectId,id).reviewStatus!=='verified'))&&
      !unreviewedSourceRequested(request))throw Error('UNREVIEWED_SOURCE_REQUIRES_USER_OPT_IN');
    if(q.action==='search'){
      const result=await this.router.search(projectId,taskId,{query:q.query??'',reviewScope:q.reviewScope??'verified',...(q.source?{source:q.source}:{}),...(q.cursor?{cursor:q.cursor}:{})},signal);
      const request=this.store.researchPlan(taskId)?.originalRequest??'',scope=recipeScope(request);
      const items=result.items.filter((item:any)=>recipeScopeMatches(request,result.origin==='project'?{label:item.title,...(this.store.research.snapshot(projectId,item.snapshotId).data.sourceStatus as any[])?.[0]?.identity}:item));
      return {...result,scope,filteredOutCount:result.items.length-items.length,...(scope?{scopeHint:'Only metadata-matching recipes are returned. Follow nextCursor or refine query to '+scope.suggestedQuery+' if this page is empty; a membrane is not a paint.'}:{}),items:items.map((item:any)=>{const {ref,snapshotId,...summary}=item;return {...summary,candidateId:result.origin==='project'?this.candidates.issueSnapshot(projectId,taskId,this.store.research.snapshot(projectId,snapshotId)):this.candidates.issue(projectId,taskId,moosRefSchema.parse(ref))};}),selectionHint:'All results use candidateId. Select with {action:"select",candidateId:the exact returned handle}; then read the returned snapshotId. Never convert a snapshot UUID into a candidateId.',...(result.origin==='project'?{catalogHint:'These are only selected project records, not the full MOOS catalog. For more recipes search with source="moos" and the same approved reviewScope; follow nextCursor.'}:{})};
    }
    if(q.action==='select'){
      if(q.ref&&q.snapshotId)throw Error('SELECT_REQUIRES_ONE_REFERENCE');
      if(!q.ref&&!q.snapshotId)throw Error('SELECT_REQUIRES_CANDIDATE_OR_SNAPSHOT');
      let s:ResearchSnapshot;
      if(q.ref)s=await this.select(projectId,q.ref,taskId,signal);
      else {s=this.store.research.snapshot(projectId,q.snapshotId!);if(!b.snapshotIds.includes(s.id))throw Error('SNAPSHOT_NOT_SELECTED');this.scientific.assertCurrent(projectId,s.id);if(this.store.research.project(projectId).withdrawn.includes(s.id))throw Error('SOURCE_WITHDRAWN');await this.router.verify(s,taskId,signal);s=this.bindSnapshot(projectId,taskId,s);}
      return {snapshotId:s.id,title:s.title,version:s.version,sha256:s.sha256,reviewStatus:s.reviewStatus,sections:Object.fromEntries(Object.entries(s.data).map(([k,v])=>[k,Array.isArray(v)?v.length:null])),evidence:s.evidence};
    }
    if(!q.snapshotId||!b.snapshotIds.includes(q.snapshotId))throw Error('SNAPSHOT_NOT_SELECTED');
    const s=this.store.research.snapshot(projectId,q.snapshotId),p=this.store.research.project(projectId);
    this.scientific.assertCurrent(projectId,s.id);
    if(p.withdrawn.includes(s.id))throw Error('SOURCE_WITHDRAWN');await this.router.verify(s,taskId,signal);
    if(q.action==='read'){if(q.section==='recipe')return recipeBundle(s);const section=q.section??'observations',rows=s.data[section];if(!Array.isArray(rows))throw Error('SECTION_UNAVAILABLE');const offset=q.offset??0,limit=q.limit??10;return {id:s.id,title:s.title,version:s.version,sha256:s.sha256,reviewStatus:s.reviewStatus,section,rows:rows.slice(offset,offset+limit),nextOffset:offset+limit<rows.length?offset+limit:null,evidence:s.evidence};}
    if(!s.ref)throw Error('MOOS_REFERENCE_REQUIRED');
    if(q.action==='simulation'){if(!q.studyId)throw Error('STUDY_ID_REQUIRED');return (await this.router.moos(projectId,taskId,'moos_get_simulation',{ref:s.ref,studyId:q.studyId},signal)).data;}
    if(q.action==='assets')return (await this.router.moos(projectId,taskId,'moos_search_assets',{ref:s.ref,reviewScope:s.ref.reviewScope,limit:20,...(q.cursor?{cursor:q.cursor}:{})},signal)).data;
    if(q.action==='evidence'){if(!q.evidenceId)throw Error('EVIDENCE_ID_REQUIRED');return (await this.router.moos(projectId,taskId,'moos_get_evidence',{ref:s.ref,evidenceId:q.evidenceId},signal)).data;}
    throw Error('UNSUPPORTED_ACTION');
  }
  async deliver(projectId:string,taskId:string,input:unknown,signal?:AbortSignal){
    const q=deliveryInput.parse(input),binding=this.store.research.binding(taskId),plan=this.store.researchPlan(taskId);
    if(!binding||binding.projectId!==projectId||!plan)throw Error('RESEARCH_TASK_OR_PLAN_MISSING');
    const p=this.store.research.project(projectId);
    const snapshots=q.snapshotIds.map(id=>{if(!binding.snapshotIds.includes(id)||p.withdrawn.includes(id))throw Error('SOURCE_NOT_SELECTED_OR_WITHDRAWN');return this.store.research.snapshot(projectId,id);});
    for(const s of snapshots)this.scientific.assertCurrent(projectId,s.id);
    for(const s of snapshots)await this.router.verify(s,taskId,signal);
    let result:any;
    if(binding.delivery.kind==='comparison'){
      if(!q.selections?.length&&snapshots.length>=2&&snapshots.every(s=>Array.isArray(s.data.observations)&&s.data.observations.length===1))q.selections=snapshots.map(s=>({snapshotId:s.id,observationId:String((s.data.observations as any[])[0].id)}));
      if(!q.selections?.length)throw Error('COMPARISON_REQUIRES_OBSERVATION_IDS: use research_data action=read, section=observations for each selected snapshotId, then provide at least two {snapshotId,observationId} selections. Search results from other experiments cannot be attached to selected snapshot IDs / 请先读取选定快照的观测 ID');
      const selections=q.selections.map(s=>{const snap=snapshots.find(x=>x.id===s.snapshotId);if(!snap?.ref||!(snap.data.observations as any[]??[]).some(o=>o.id===s.observationId))throw Error('COMPARISON_ID_NOT_OWNED: use research_data action=read, section=observations, snapshotId='+s.snapshotId+' and copy only IDs returned for that snapshot. Search candidate IDs require select first / 观测 ID 与快照不匹配');return {ref:snap.ref,observationId:s.observationId};});
      result={...(await this.router.moos(projectId,taskId,'moos_compare_observations',{selections},signal)).data,selections:q.selections};
    }else if(binding.delivery.kind==='simulation-gaps'){
      if(!q.studies?.length)throw Error('SIMULATION_REQUIRES_STUDY_IDS');
      const studies=[];for(const study of q.studies){const s=snapshots.find(x=>x.id===study.snapshotId);if(!s?.ref)throw Error('SIMULATION_ID_NOT_OWNED');studies.push({... (await this.router.moos(projectId,taskId,'moos_get_simulation',{ref:s.ref,studyId:study.studyId},signal)).data,snapshotId:s.id});}
      result={studies,executionPerformed:false};
    }else result={kind:'recipe-process',sourceSnapshots:snapshots.map(s=>s.id)};
    let image:Awaited<ReturnType<DataSourceRouter['image']>>|undefined;
    if(q.image){const s=snapshots.find(s=>s.id===q.image!.snapshotId);if(!s)throw Error('IMAGE_SOURCE_NOT_SELECTED');image=await this.router.image(projectId,taskId,s,q.image.mediaId,signal);}
    const quality=await this.scientific.audit(projectId,taskId,{snapshotIds:q.snapshotIds,claims:[]},snapshots,signal);
    result={...result,scientificQuality:quality};
    signal?.throwIfAborted();const root=this.store.getProject(projectId)!.path;
    const d=await writeResearchDelivery(root,binding,plan.planRevision,snapshots,result,image,[this.store.agentJournal.read(taskId)?.activeStepId].filter((id):id is string=>!!id));
    signal?.throwIfAborted();for(const s of snapshots)await this.router.verify(s,taskId,signal);
    this.store.research.delivery(d);return d;
  }
  private auditBoundTask(projectId:string,taskId:string,input:unknown,signal?:AbortSignal){
    const q=qualityAuditToolInput.parse(input);
    return this.scientific.audit(projectId,taskId,{...q,snapshotIds:q.snapshotIds??this.store.research.binding(taskId)?.snapshotIds??[]},undefined,signal);
  }
  private assessBoundTask(projectId:string,taskId:string,input:unknown,signal?:AbortSignal){
    const q=methodToolInput.parse(input),question=q.question??this.store.researchPlan(taskId)?.originalRequest;
    if(!question)throw Error('METHOD_QUESTION_REQUIRED: supply the actual research question; no frozen original task was found.');
    return this.scientific.assess(projectId,taskId,{...q,question},signal);
  }
  private runBoundMethod(projectId:string,taskId:string,input:unknown,signal?:AbortSignal){
    const q=methodRunToolInput.parse(input);
    if(q.assessmentId&&q.methodId)return this.scientific.run(projectId,taskId,q,signal);
    // The current admitted run is in flight; never ignore another running or unknown operation.
    const choices=this.scientific.executionCandidates(projectId,taskId,true).filter(c=>
      (!q.assessmentId||c.arguments.assessmentId===q.assessmentId)&&(!q.methodId||c.arguments.methodId===q.methodId));
    if(choices.length!==1)throw Error('METHOD_SELECTION_NOT_UNIQUE: '+choices.length+' eligible choices; read research_data context and supply exact owned IDs to disambiguate. No calculation executed.');
    const choice=choices[0]!;
    return this.scientific.run(projectId,taskId,{...q,assessmentId:q.assessmentId??choice.arguments.assessmentId,methodId:q.methodId??choice.arguments.methodId},signal);
  }
  tools(projectId:string,conversationId:string){
    const task=()=>{const active=this.store.agentJournal.forConversation(conversationId).filter(s=>s.state==='running');if(active.length!==1)throw Error('NO_UNIQUE_ACTIVE_RESEARCH_TASK');return active[0]!.task.taskId;};
    const tool=(name:string,description:string,schema:z.ZodType,execute:(id:string,args:unknown,signal?:AbortSignal)=>Promise<unknown>)=>defineTool({name,label:name,description,parameters:Type.Unsafe(z.toJSONSchema(schema,{io:'input'})),execute:async(_id,args,signal)=>({content:[{type:'text' as const,text:JSON.stringify(await execute(task(),args,signal))}],details:{}})});
    return [tool('campaign_job','本地长期计算 / Run an explicitly approved frozen Node script in a detached offline worker. inputs lists exact configuration IDs; submit requires configurationId and reason. status/cancel requires the original owned jobId. Queued/running is not completion: end this turn and wait. Never invent scripts, IDs, receipts, results or resubmit on recovery. Query original job first.',campaignToolInput,(id,args)=>this.campaigns.tool(projectId,id,args)),...(this.papers?.tools(projectId,conversationId)??[]),
      tool('method_package_search','方法包目录 / Search pinned method packages by Chinese or English query. Read-only. Returns source/license/scope/resource/schema/reference status and existing execution tool. Candidate descriptions and user Skills never authorize code; reference reproduction is not domain validation. Use research_methods and research_method_run for actual analysis.',methodPackageQuery,async(_id,args)=>this.methodPackages.search(args)),
      tool('next_experiment_data','下一轮实验输入 / Read the saved user study and current feedback. Feedback review is a human data check, not scientific qualification. Study edits and measurement feedback use the editor, never model-written values.',z.strictObject({offset:z.number().int().min(0).max(400).default(0),limit:z.number().int().min(1).max(64).default(32)}),async(id,args)=>{const q=args as {offset:number;limit:number};return this.nextExperiments.read(id,q.offset,q.limit);}),
      tool('next_experiment_design','下一轮实验方案 / Produce a real constrained factorial/LHS plan, or qualified fixed-GP Bayesian/active-learning candidate ranking. Exact user studyId required. Complete block controls and independently prepared replicates, seeded randomization, estimated cost/time caps. Optimization requires reviewed source-linked measurements, eight unique coordinates and a grouped holdout improvement over a training-only mean baseline. Outputs JSON/report/candidates/schedule/replay, needs_review; no physical execution or causal certification.',nextDesignInput,(id,args,signal)=>this.nextExperiments.design(projectId,id,args,signal)),
      tool('experiment_data','原始实验 / Raw experimental inputs. List frozen, user-configured tensile inputs, then read actual owned dataset/configuration metadata and first eight original rows. Local-only. CSV/XLSX import and fit/exclusion changes require the experiment editor; do not invent missing metadata.',z.strictObject({action:z.enum(['list','read']),datasetId:z.uuid().optional()}),async(id,args)=>{const q=args as {action:string;datasetId?:string};const choices=this.experiments.taskInputs(projectId,id);if(q.action==='list')return choices;
        if(!q.datasetId||!choices.some(c=>c.datasetId===q.datasetId))throw Error('EXPERIMENT_NOT_FROZEN_OR_CONFIGURED');const o=this.experiments.overview(projectId);return {dataset:o.datasets.find(d=>d.id===q.datasetId),configurations:o.configurations.filter(c=>choices.some(x=>x.configurationId===c.id)&&c.input.datasetId===q.datasetId)};}),
      tool('experiment_analyze','应力应变分析 / Execute fixed engineering tensile analysis on exact frozen configuration IDs from experiment_data. Requires a reason and explicit independentReplicates declaration. Writes real JSON, CSV, SVG, report and same-source replay bundle. No error bars for one curve; crosshead slope is apparent stiffness. Never claims scientific qualification.',experimentRunInput,(id,args,signal)=>this.experiments.run(projectId,id,args,signal)),
      tool('recipe_proposal','记录配方建议 / Record an unverified proposed recipe after reading current sources. Source quantities are rendered by the host, never supplied as model facts. Changes use one-based ingredient component numbers and original units; no unit conversions, new ingredients or inferred missing amounts. Omit baselineSnapshotId only for one complete baseline. Supply name, changes, preparation/checks enum option IDs and gaps. The host preserves original process references and renders bounded recommendations; never supply free-text process quantities or undocumented equipment. This produces a proposal, never a performed experiment or guarantee.',recipeProposalInput,async(id,args,signal)=>{for(const snapshotId of this.store.research.binding(id)?.snapshotIds??[]){this.scientific.assertCurrent(projectId,snapshotId);await this.router.verify(this.store.research.snapshot(projectId,snapshotId),id,signal);}return buildRecipeProposal(this.store,id,args);}),
      tool('research_data','For a source-grounded recipe follow-up call {action:"read_current_recipes"} once to read frozen prior recipes; all parameters are direct fields, never wrapped in value. 材料数据 / Research data. For multiple recipes: search then call {action:read_recipes,candidateIds:[exact chosen candidateId handles]} to select and read up to five recipes together, including ingredients, processes and evidence. Continue until requested distinct count is met; never stop after one. Start with {action:search,query:水性,reviewScope:include-unreviewed} only when explicitly allowed. For search/context, OMIT snapshotId, ref, evidenceId and studyId entirely; never fill unused fields with empty strings, null or guessed IDs. Every search result, including cached project records, returns candidateId. select requires action and that exact candidateId; never turn a snapshot UUID into a handle. Already selected IDs from context can be read with action=read,snapshotId. If project results are fewer than the requested count, search with source=moos; project matches are not the whole catalog. read requires the exact snapshotId returned by select and section=recipe (one bounded bundle with original ingredients, processes and linked evidence). Or read ingredients/processes/readEvidence separately. select alone is not reading. Use context to list already selected snapshot IDs. Follow nextCursor unchanged when needed. Sources are local research only; no simulation execution.',dataInput,(id,args,signal)=>this.data(projectId,id,args,signal)),
      tool('research_delivery','研究交付 / Research delivery. Render selected source data to CSV, SVG and report; checks frozen criteria and separate source quality. Never runs a simulation or certifies scientific accuracy.',deliveryInput,(id,args,signal)=>this.deliver(projectId,id,args,signal)),
      tool('research_quality','科学检查 / Check selected source fields, conditions, original units/bases, duplicate reports, uncertainty and claims against pinned evidence. Writes actual quality report; never stamps validated. Omit snapshotIds to check the frozen task selection; provide exact IDs only for a subset. Explicit invalid IDs never fall back. A claim quantity must match a source field and original unit.',qualityAuditToolInput,(id,args,signal)=>this.auditBoundTask(projectId,id,args,signal)),
      tool('research_methods','方法筛选 / List fixed methods or assess actual owned observations/imported structures. Hard gates first. For assess, input.question may be omitted to use the frozen original user request. Task and owned sample references are required. action=assess returns id and candidates; call research_method_run with a nonempty reason to execute. Omit IDs only when the task has one eligible choice; otherwise copy the exact assessment id and candidate methodId. Listing or assessment alone does not calculate or write the analysis. No arbitrary scripts, unit conversion or qualification upgrades. Atomistic assessment reuses M6; execute via existing materials_science.',z.strictObject({action:z.enum(['list','assess']),input:methodToolInput.optional()}),async(id,args,signal)=>{const q=args as {action:string;input?:unknown};if(q.action==='list')return this.scientific.overview(projectId).methods;if(!q.input)throw Error('METHOD_INPUT_REQUIRED');return this.assessBoundTask(projectId,id,q.input,signal);}),
      tool('research_method_run','运行固定分析 / Run an eligible frozen assessment with a recorded reason. Usually send only reason when the task has one eligible choice; the host binds its actual IDs. Multiple choices require explicit selection; supplied IDs never fall back: original-value summary, linear fit or source-grouped validation with a training-only mean baseline. Produces real JSON/report; fit is not material-law or causal validation. Atomistic execution stays in materials_science.',methodRunToolInput,(id,args,signal)=>this.runBoundMethod(projectId,id,args,signal))];
  }
}
export const dataInput=z.strictObject({action:z.enum(['context','search','select','read','read_recipes','read_current_recipes','evidence','assets','simulation']),query:z.string().max(160).optional(),source:z.enum(['project-first','moos']).optional(),reviewScope:z.enum(['verified','include-unreviewed']).optional(),cursor:z.string().max(2048).optional(),ref:moosRefSchema.optional(),candidateIds:z.array(z.string().regex(/^moos-[a-f0-9]{24}$/)).min(1).max(5).refine(v=>new Set(v).size===v.length,'Duplicate candidates').optional(),candidateId:z.string().regex(/^moos-[a-f0-9]{24}$/).optional(),snapshotId:z.uuid().optional(),evidenceId:z.string().max(220).optional(),studyId:z.string().max(220).optional(),section:z.enum(['recipe','observations','recipes','ingredients','processes','readEvidence','nodes','media_metadata','simulation_metadata']).optional(),offset:z.number().int().nonnegative().max(10000).optional(),limit:z.number().int().min(1).max(20).optional()});
export const deliveryInput=z.strictObject({snapshotIds:z.array(z.uuid()).min(1).max(8),selections:z.array(z.strictObject({snapshotId:z.uuid(),observationId:z.string().min(1).max(220)})).min(2).max(8).optional(),studies:z.array(z.strictObject({snapshotId:z.uuid(),studyId:z.string().min(1).max(220)})).min(1).max(8).optional(),image:z.strictObject({snapshotId:z.uuid(),mediaId:z.string().min(1).max(220)}).optional()}).superRefine((q,c)=>{if(new Set(q.snapshotIds).size!==q.snapshotIds.length)c.addIssue({code:'custom',message:'Duplicate snapshot selection'});});
