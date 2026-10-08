import type {WorkspaceStore} from './store.js';
import type {ResearchService} from './research-service.js';
import type {SupervisorOptions} from '../../../packages/agent/src/task-supervisor.js';
import type {TaskExecution} from '../../../packages/contracts/src/task-execution.js';
import {parseReferences} from '../../../packages/contracts/src/task-references.js';
import type {BoundReference} from '../../../packages/contracts/src/task-references.js';
import type {WorkingContext,ContextReference} from '../../../packages/contracts/src/working-context.js';
import type {CloudSelection} from '../../../packages/pi-adapter/src/platform-session.js';
import {canonical,hash} from '../../../packages/atomistic/src/discovery-io.js';
import {digest} from '../../../packages/agent/src/execution-context.js';
import {sealContext} from '../../../packages/agent/src/working-context.js';
import {receiptClaimData} from '../../../packages/agent/src/answer-assessment.js';
import {createWorkingContext,verifyWorkingContext,readHistoricalReceipts,ownedHistory,continuationKind} from './research-continuity.js';

/** Adapter to owned sources/journal, shared by both engines and original recovery. */
export function runtimeWorkingContext(store:WorkspaceStore,research:ResearchService|undefined,task:TaskExecution['task'],accountRef:string,
 content:string,projectPath:string,bindings:BoundReference[],selection:CloudSelection,platform:boolean,previous?:WorkingContext)
 :Pick<SupervisorOptions,'workingContext'|'refreshContext'|'readHistoricalReceipts'>{
 const authorizationHash=research?.teamAccessKey(task.projectId)??null;
 const assets=selection.files.concat(selection.skills).filter(a=>!bindings.some(r=>r.id===a.id)).map(a=>({
  kind:selection.files.includes(a)?'file' as const:'skill' as const,id:a.id,label:a.name,projectId:task.projectId,version:a.sha256,sha256:a.sha256,status:'bound' as const,range:'Frozen snapshot; read in bounded line ranges',
 }));
 let context=createWorkingContext(store,task,accountRef,authorizationHash,content,bindings,platform,previous);
 for(const r of assets)if(!context.references.some(v=>v.kind===r.kind&&v.id===r.id))context.references.push({...r,originTaskId:null,exportScope:platform?'approved-cloud':'local-only',readings:[]});
 const kind=continuationKind(content);
 if(kind&&context.references.some(r=>kind==='all'||r.kind===kind))context.ambiguities=context.ambiguities.filter(issue=>!issue.includes('No owned prior object'));
 // A recipe may come from an approved attachment rather than a MOOS recipe object.
 // Bind only an identical, actually read prior source; keep it a file, not a fabricated recipe ID.
 if(kind==='recipe'&&selection.files.length===1&&context.ambiguities.some(issue=>issue.includes('No owned prior object'))){
  const asset=selection.files[0]!;
  const prior=ownedHistory(store,task.projectId,task.conversationId,accountRef,authorizationHash).find(s=>context.history.some(h=>h.taskId===s.task.taskId)&&
   s.workingContext?.references.some(r=>r.kind==='file'&&r.id===asset.id&&r.sha256===asset.sha256&&r.status==='bound')&&
   s.attempts.some(a=>{
    if(a.state!=='completed'||a.planRevision!==s.planRevision||a.method!=='read_material_file'||!a.inputRef||!a.resultRef)return false;
    const args=store.agentJournal.readResult(s.task.taskId,a.inputRef)?.args;
    const result=receiptClaimData(store.agentJournal.readResult(s.task.taskId,a.resultRef)) as any;
    return args?.fileId===asset.id&&result?.id===asset.id&&result?.sha256===asset.sha256&&typeof result?.text==='string';
   }));
  if(prior){
   context.ambiguities=context.ambiguities.filter(issue=>!issue.includes('No owned prior object'));
   context.references.find(r=>r.kind==='file'&&r.id===asset.id)!.originTaskId=prior.task.taskId;
   context.notices.push('引用指向本轮重新批准的来源附件；仍需读取核对，未转换为数据库配方 / Follow-up uses the reapproved source attachment; read and verify it, not a database recipe ID');
  }
 }
 if(kind&&kind!=='all'&&kind!=='recipe'&&context.references.filter(r=>r.kind===kind).length>1&&!bindings.some(r=>r.kind===kind)&&!context.ambiguities.length)
  context.ambiguities.push('存在多个'+kind+'对象，请选择具体 ID / Multiple '+kind+' objects; select an exact ID');
 for(const asset of selection.files){
  const ref=context.references.find(r=>r.kind==='file'&&r.id===asset.id&&r.sha256===asset.sha256);if(!ref||ref.assetRef)continue;
  if(Buffer.byteLength(asset.text)>32768||hash(asset.text)!==asset.sha256)continue;
  ref.assetRef=store.agentJournal.result(task.taskId,digest(asset),asset);ref.assetTaskId=task.taskId;
 }
 context=sealContext(context);
 const inspect=(ref:ContextReference)=>{
  if(ref.kind==='structure'){
   const s=research?.scientific.atomistic?.listStructures?.(task.projectId).find(s=>s.id===ref.id);
   return s?{version:hash(canonical(s)),sha256:hash(canonical(s)),accessible:!platform}:null;
  }
  if(ref.kind==='paper'){
   const p=store.papers.records(task.projectId).find(p=>p.paper.paperId===ref.id);
   return p?{version:p.paper.arxivId,sha256:p.file?.sha256??p.paper.metadataSha256,accessible:!platform}:null;
  }
  const asset=selection.files.concat(selection.skills).find(a=>a.id===ref.id);
  return asset?{version:asset.sha256,sha256:asset.sha256,accessible:true}:platform?null:{version:ref.version,sha256:ref.sha256,accessible:true};
 };
 const refresh=(value:WorkingContext)=>{
  if((research?.teamAccessKey(task.projectId)??null)!==value.authorizationHash)
   return sealContext({...value,references:value.references.map(r=>({...r,status:'not-authorized'})),notices:['项目授权已变更 / Project authorization changed']},value);
  const next=structuredClone(value);
  if(!platform){
   const state=store.agentJournal.read(task.taskId);
   for(const a of state?.attempts??[]){
    if(a.state!=='completed'||!a.inputRef||!a.resultRef||a.planRevision!==state!.planRevision)continue;
    const args=store.agentJournal.readResult(task.taskId,a.inputRef)?.args;
    if(!args)continue;
    const id=['materials_science','inspect_atomic_structure'].includes(a.method)?args.structureId:a.method==='paper_read'?args.paperId:null;
    if(!id||next.references.some(r=>r.id===id)||next.references.length>=128)continue;
    if(a.method==='paper_read'){
     const p=store.papers.records(task.projectId).find(p=>p.paper.paperId===id);if(!p)continue;
     next.references.push({kind:'paper',id,label:p.paper.titleOriginal,projectId:task.projectId,version:p.paper.arxivId,sha256:p.file?.sha256??p.paper.metadataSha256,
      status:'bound',range:'PDF text only; images not reviewed',originTaskId:null,exportScope:'local-only',readings:[]});
    }else{
     const s=research?.scientific.atomistic?.listStructures?.(task.projectId).find(s=>s.id===id);if(!s)continue;
     next.references.push({kind:'structure',id,label:s.atoms.length+' atoms',projectId:task.projectId,version:hash(canonical(s)),sha256:hash(canonical(s)),
      status:'bound',range:'Imported structure; use inspect_atomic_structure for bounded coordinates',originTaskId:null,exportScope:'local-only',readings:[]});
    }
   }
   for(const id of store.research.binding(task.taskId)?.snapshotIds??[]){
    if(next.references.some(r=>r.id===id))continue;
    const s=store.research.snapshot(task.projectId,id);
    if(next.references.length<128)next.references.push({kind:'recipe',id,label:s.title,projectId:task.projectId,version:s.version,sha256:s.sha256,
     status:'metadata-only',range:'Frozen source metadata; read with research_data',originTaskId:null,exportScope:'local-only',readings:[]});
    else next.omitted.references++;
   }
  }
  return verifyWorkingContext(store,sealContext(next,value),projectPath,inspect);
 };
 return {workingContext:refresh(context),refreshContext:refresh,
  readHistoricalReceipts:(value,id,ids)=>readHistoricalReceipts(store,refresh(value),id,ids,platform)};
}

/** Reuse the original approved immutable bytes locally, so segmented reads also survive restart.
 * This never adds cloud export selection, a grant or a successful tool receipt. */
export function restoreContextFiles(store:WorkspaceStore,task:TaskExecution['task'],content:string,authorizationHash:string|null,previous?:WorkingContext){
 const c=createWorkingContext(store,task,'local',authorizationHash,content,[],false,previous);
 const wanted=parseReferences(content).filter(r=>r.kind==='file').map(r=>r.value);
 const refs=[...c.references];
 for(const value of wanted){
  const matches=ownedHistory(store,task.projectId,task.conversationId,'local',authorizationHash).flatMap(s=>s.workingContext?.references??[])
   .filter(r=>r.kind==='file'&&(r.id===value||r.label===value)&&r.assetRef);
  const ids=new Set(matches.map(r=>r.id+':'+r.sha256));if(ids.size>1)throw Error('CONTEXT_FILE_AMBIGUOUS: 请指定唯一文件 ID');
  if(matches[0]&&!refs.some(r=>r.id===matches[0]!.id))refs.push(matches[0]);
 }
 const files:CloudSelection['files']=[];
 for(const ref of refs){
  if(ref.kind!=='file'||!ref.assetTaskId||!ref.assetRef||['stale','not-authorized','unreadable'].includes(ref.status))continue;
  const origin=store.agentJournal.read(ref.assetTaskId);
  if(!origin||origin.accountRef!=='local'||origin.task.projectId!==task.projectId||origin.task.conversationId!==task.conversationId||origin.workingContext?.authorizationHash!==authorizationHash)continue;
  const asset=store.agentJournal.readResult(ref.assetTaskId,ref.assetRef);
  if(asset.id!==ref.id||asset.sha256!==ref.sha256||typeof asset.text!=='string'||Buffer.byteLength(asset.text)>32768||digest(asset)!==ref.assetRef||hash(asset.text)!==ref.sha256)throw Error('CONTEXT_ASSET_INTEGRITY');
  files.push(asset);
 }
 return files;
}
