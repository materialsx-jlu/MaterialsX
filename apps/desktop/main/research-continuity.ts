import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import type {WorkspaceStore} from './store.js';
import type {TaskExecution} from '../../../packages/contracts/src/task-execution.js';
import type {WorkingContext,ContextReference} from '../../../packages/contracts/src/working-context.js';
import type {BoundReference} from '../../../packages/contracts/src/task-references.js';
import {sealContext} from '../../../packages/agent/src/working-context.js';
import {recipeSnapshots} from './research-recipe-view.js';
import {recipeProposalFollowup} from '../../../packages/agent/src/research-intent.js';
import {receiptClaimData} from '../../../packages/agent/src/answer-assessment.js';

/** A reference cue, not an intent router: the existing engine still decides the task/method. */
export function continuationKind(content:string):'recipe'|'structure'|'paper'|'file'|'all'|null{
 content=content.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`|"[^"]*"|“[^”]*”/g,'');
 if(recipeProposalFollowup(content)||/上述配方|这些配方|previous recipes|those recipes/i.test(content))return 'recipe';
 if(/这个结构|该结构|上述结构|this structure|that structure|previous structure/i.test(content))return 'structure';
 if(/这篇论文|上述论文|this paper|that paper|previous paper/i.test(content))return 'paper';
 if(/这个文件|上述文件|this file|previous file/i.test(content))return 'file';
 return /继续|接着|上述结果|上一步|continue|previous results|last step/i.test(content)?'all':null;
}
export function ownedHistory(store:WorkspaceStore,projectId:string,conversationId:string,accountRef:string,authorizationHash:string|null){
 return store.agentJournal.forConversation(conversationId).filter(s=>s.task.projectId===projectId&&s.accountRef===accountRef&&!s.parentTaskId&&
  (s.workingContext?.authorizationHash??store.research.binding(s.task.taskId)?.approvedInputs.find(i=>i.id==='team-access:'+projectId)?.sha256??null)===authorizationHash)
  .sort((a,b)=>b.startedAt-a.startedAt||b.sequence-a.sequence);
}
function sourceReferences(store:WorkspaceStore,state:TaskExecution):ContextReference[]{
 const existing=structuredClone(state.workingContext?.references??[]);
 const binding=store.research.binding(state.task.taskId);
 for(const id of binding?.snapshotIds??[]){
  if(existing.some(r=>r.id===id))continue;
  const s=store.research.snapshot(state.task.projectId,id);
  existing.push({kind:'recipe',id:s.id,label:s.title,projectId:s.projectId,version:s.version,sha256:s.sha256,status:'metadata-only',
   range:'Source metadata; read with research_data',originTaskId:state.task.taskId,exportScope:'local-only',readings:[]});
 }
 for(const a of state.attempts){
  if(a.state!=='completed'||a.planRevision!==state.planRevision||!a.inputRef||!a.resultRef)continue;
  const input=store.agentJournal.readResult(state.task.taskId,a.inputRef),args=input?.args;
  if(a.method!=='research_data'||!['read','read_recipes','read_current_recipes'].includes(args?.action))continue;
  const result=receiptClaimData(store.agentJournal.readResult(state.task.taskId,a.resultRef)) as any;
  for(const row of result?.snapshots??[result]){
   const id=row?.snapshotId??row?.id??args.snapshotId,ref=existing.find(r=>r.id===id);if(!ref)continue;
   const reading={taskId:state.task.taskId,receiptId:a.id,resultRef:a.resultRef,range:String(row?.section??args.section??'bounded source rows'),omitted:JSON.stringify(row?.truncated??'not reported by tool')};
   if(!ref.readings.some(r=>r.receiptId===a.id))ref.readings=[...ref.readings,reading].slice(-32);
  }
 }
 return existing;
}
export function createWorkingContext(store:WorkspaceStore,task:TaskExecution['task'],accountRef:string,authorizationHash:string|null,
 content:string,bindings:BoundReference[],platform:boolean,previous?:WorkingContext):WorkingContext{
 if(previous){
  if(previous.projectId!==task.projectId||previous.conversationId!==task.conversationId||previous.accountRef!==accountRef||previous.authorizationHash!==authorizationHash)
   throw Error('CONTEXT_SCOPE_CHANGED: 工作上下文的账户或项目授权已变更');
  return structuredClone(previous);
 }
 const kind=continuationKind(content),refs:ContextReference[]=bindings.filter(r=>['bound','metadata-only','not-authorized'].includes(r.status))
  .map(r=>({...r,status:r.status as ContextReference['status'],originTaskId:null,exportScope:platform?'approved-cloud':'local-only',readings:[]}));
 const history:WorkingContext['history']=[],ambiguities:string[]=[],notices:string[]=[];
 let eligible:TaskExecution[]=[],omittedReceipts=0;
 if(kind){
  const all=ownedHistory(store,task.projectId,task.conversationId,accountRef,authorizationHash).filter(s=>s.task.taskId!==task.taskId&&s.state!=='handed_off');
  const latest=all.find(s=>s.attempts.some(a=>a.state==='completed')||s.workingContext?.references.length);
  if(latest){
   const chain=new Set([latest.task.taskId,...(latest.workingContext?.history??[]).map(h=>h.taskId)]);
   eligible=all.filter(s=>chain.has(s.task.taskId));
   const prior=sourceReferences(store,latest).filter(r=>kind==='all'||r.kind===kind);
   for(const r of prior){
    if(bindings.some(b=>b.kind===r.kind)||refs.some(v=>v.kind===r.kind&&v.id===r.id))continue;
    // Cloud mode requires the current explicit export selection; metadata cannot authorize it.
    if(platform&&!bindings.some(b=>b.id===r.id&&b.sha256===r.sha256)){notices.push('历史输入未获本轮云外发授权 / Historical input needs current export selection');continue;}
    refs.push({...r,originTaskId:r.originTaskId??latest.task.taskId});
   }
   for(const s of eligible.slice(0,8)){
    const plan=store.researchPlan(s.task.taskId),receipts=s.attempts.filter(a=>a.state==='completed'&&a.planRevision===s.planRevision&&a.resultRef);
    omittedReceipts+=platform?receipts.length:Math.max(0,receipts.length-32);
    history.push({taskId:s.task.taskId,planRevision:s.planRevision,request:platform?'Prior approved cloud task; original history remains engine-owned':plan?.originalRequest??'',state:s.state,
     receipts:platform?[]:receipts.slice(-32).map(a=>({id:a.id,method:a.method,resultRef:a.resultRef!})),
     artifacts:platform?[]:s.steps.filter(v=>v.state==='completed').flatMap(v=>v.artifacts??[]).slice(0,64).map(a=>({...a,status:'verified'}))});
   }
  }
  const matching=refs.filter(r=>kind==='all'||r.kind===kind);
  if(!matching.length&&(kind!=='all'||!history.length))ambiguities.push('未找到本对话可引用的真实对象，请指定输入 / No owned prior object; select an input');
  if(kind!=='all'&&kind!=='recipe'&&matching.length>1&&!bindings.some(r=>r.kind===kind))
   ambiguities.push('存在多个'+kind+'对象，请选择具体 ID / Multiple '+kind+' objects; select an exact ID');
 }
 return sealContext({schemaVersion:'working-context-v1',revision:1,sha256:'0'.repeat(64),projectId:task.projectId,conversationId:task.conversationId,accountRef,authorizationHash,
  references:refs.slice(0,128),history,notices:[...new Set(notices)].slice(0,64),ambiguities,
  omitted:{history:Math.max(0,eligible.length-history.length),references:Math.max(0,refs.length-128),receipts:omittedReceipts}});
}
/** Revalidate against the original owned stores. A source revision never silently substitutes evidence. */
export function verifyWorkingContext(store:WorkspaceStore,context:WorkingContext,projectPath:string,
 inspect?:(ref:ContextReference)=>{version:string;sha256:string;accessible:boolean}|null){
 const value=structuredClone(context),p=store.research.project(context.projectId),notices=[...context.notices];
 for(const ref of value.references){
  try{
   if(ref.kind==='recipe'){
    const s=store.research.snapshot(context.projectId,ref.id),state=store.research.sourceState(context.projectId,ref.id);
    const denied=state==='denied',changed=p.withdrawn.includes(ref.id)||store.research.sourceNotices(context.projectId).some(n=>n.snapshotId===ref.id)||['stale','invalid'].includes(state??'');
    ref.status=denied?'not-authorized':changed||s.sha256!==ref.sha256||s.version!==ref.version?'stale':ref.status;
   }else if(inspect){const actual=inspect(ref);ref.status=!actual?'unreadable':!actual.accessible?'not-authorized':actual.sha256!==ref.sha256||actual.version!==ref.version?'stale':ref.status;}
  }catch{ref.status='unreadable';}
  if(['stale','not-authorized','unreadable'].includes(ref.status))notices.push('输入已变更或不可访问 / Input changed or unavailable: '+ref.kind+':'+ref.id);
 }
 for(const h of value.history)for(const a of h.artifacts){
  try{
   const root=realpathSync(projectPath),path=realpathSync(resolve(root,a.path)),rel=relative(root,path),stat=statSync(path);
   if(isAbsolute(rel)||rel==='..'||rel.startsWith('../')||!stat.isFile()||stat.size>64*1024*1024)throw Error('scope');
   a.status=stat.size===a.bytes&&createHash('sha256').update(readFileSync(path)).digest('hex')===a.sha256?'verified':'stale';
  }catch{a.status='unreadable';}
  if(a.status!=='verified')notices.push('历史产物已变更 / Historical artifact changed: '+a.path);
 }
 value.notices=[...new Set(notices)].slice(0,64);return sealContext(value,context);
}
export function readHistoricalReceipts(store:WorkspaceStore,context:WorkingContext,taskId:string,receiptIds:string[],platform:boolean){
 if(platform||!context.history.some(h=>h.taskId===taskId)||!ownedHistory(store,context.projectId,context.conversationId,context.accountRef,context.authorizationHash).some(s=>s.task.taskId===taskId))throw Error('HISTORICAL_RECEIPT_NOT_AUTHORIZED');
 if(context.references.some(r=>['stale','not-authorized','unreadable'].includes(r.status)))throw Error('HISTORICAL_EVIDENCE_CHANGED: 旧证据不可继续引用');
 const h=context.history.find(h=>h.taskId===taskId)!;
 const receipts=receiptIds.map(id=>{const r=h.receipts.find(r=>r.id===id);if(!r)throw Error('HISTORICAL_RECEIPT_NOT_OWNED');
  return {...r,originTaskId:taskId,result:store.agentJournal.readResult(taskId,r.resultRef),qualification:'Historical receipt only; does not complete a current step'};});
 if(Buffer.byteLength(JSON.stringify(receipts))>65536)throw Error('HISTORICAL_RECEIPT_SIZE_LIMIT: 请通过原工具按范围读取 / Read through bounded source tools');
 return {receipts};
}
/** Compatibility for source-bound proposal tools; shares the same journal selection, no separate state. */
export function priorRecipeSources(store:WorkspaceStore,projectId:string,conversationId:string,content:string,accessKey:string|null){
 if(!recipeProposalFollowup(content))return [];
 const states=ownedHistory(store,projectId,conversationId,'local',accessKey);
 const previous=states.find(s=>['completed','completed_with_limitations'].includes(s.state)&&recipeSnapshots(store,s.task.taskId).length);
 return previous?recipeSnapshots(store,previous.task.taskId):[];
}
