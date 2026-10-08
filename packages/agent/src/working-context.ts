import type {WorkingContext} from '../../contracts/src/working-context.js';
import type {TaskExecution} from '../../contracts/src/task-execution.js';
import type {ResearchGoalPlan} from '../../contracts/src/research-goal.js';
import {digest,canonical} from './execution-context.js';
import {receiptClaimData} from './answer-assessment.js';
/** A versioned projection of the original journal. Never manufactures executable receipts. */
export function sealContext(value:WorkingContext,previous?:WorkingContext){
 const body={...value,revision:0,sha256:''};
 const sha256=digest(canonical(body));
 return {...value,sha256,revision:previous?.sha256===sha256?previous.revision:(previous?.revision??0)+1};
}
export function attachReadings(context:WorkingContext,state:TaskExecution,readResult:(ref:string)=>unknown){
 const references=structuredClone(context.references);
 for(const a of state.attempts){
  if(a.state!=='completed'||a.planRevision!==state.planRevision||!a.resultRef||!a.inputRef)continue;
  const input=readResult(a.inputRef) as any, args=input?.args;
  const raw=receiptClaimData(readResult(a.resultRef)) as any;
  // Record only real bounded read operations, not search/selection metadata or a model's narration.
  const read=['read','read_recipes','read_current_recipes','recipe'].includes(args?.action)||
   ['paper_read','read_material_file','read_skill','inspect_atomic_structure'].includes(a.method);
  if(!read)continue;
  const items=raw?.snapshots??[raw];
  for(const item of items){
   const id=item?.snapshotId??item?.paperId??item?.id??args?.snapshotId??args?.paperId??args?.structureId;
   const ref=references.find(r=>r.id===id||r.id===args?.id);if(!ref||ref.status==='stale'||ref.status==='not-authorized')continue;
   if((item?.pdfSha256??item?.sha256)&& (item.pdfSha256??item.sha256)!==ref.sha256)continue;
   const pages=item?.readPages??item?.pages;
   const range=typeof item?.section==='string'?item.section:pages?'pages '+JSON.stringify(pages):
    item?.startLine!==undefined?'lines '+item.startLine+'–'+item.endLine:args?.startLine!==undefined?'lines '+args.startLine+'–'+(args.endLine??'bounded by tool'):'bounded read; see original receipt';
   const omitted=item?.coordinatesTruncated?'coordinates truncated to '+(item.atoms?.length??'bounded subset')+' of '+item.atomCount:item?.truncated??item?.omitted??(item?.partial?'total lines '+item.totalLines+'; partial':item?.missingPages)??(a.nativeReceipt?.truncated?'tool output truncated':'not reported by tool');
   const reading={taskId:state.task.taskId,receiptId:a.id,resultRef:a.resultRef,range:range.slice(0,500),omitted:JSON.stringify(omitted).slice(0,500)};
   if(!ref.readings.some(r=>r.receiptId===a.id))ref.readings=[...ref.readings,reading].slice(-32);
  }
 }
 return sealContext({...context,references},context);
}
/** Budget metadata, not evidence text. All hard constraints remain outside this projection. */
export function projectContext(context:WorkingContext,byteBudget=16000){
 const output=structuredClone(context);let omittedHistory=0,omittedReferences=0,omittedReceipts=0;
 const omittedRequests:Array<{taskId:string;sha256:string}>=[];
 const size=()=>Buffer.byteLength(JSON.stringify({...output,omittedRequests}))+1200;
 for(const h of output.history){
  if(size()>byteBudget&&h.request.length>256){omittedRequests.push({taskId:h.taskId,sha256:digest(h.request)});h.request="Original historical request omitted; retrieve the owned task or source. Current hard constraints remain in goal/currentWork.";}
  while(size()>byteBudget&&h.receipts.length>1){h.receipts.shift();omittedReceipts++;}
 }
 while(size()>byteBudget&&output.history.length>1){output.history.pop();omittedHistory++;}
 while(size()>byteBudget&&output.references.length>1){output.references.pop();omittedReferences++;}
 output.omitted={history:context.omitted.history+omittedHistory,references:context.omitted.references+omittedReferences,receipts:context.omitted.receipts+omittedReceipts};
 return {...output,omittedRequests,manifestSha256:context.sha256,projectionSha256:digest(canonical(output)),
  policy:'Historical receipts are read-only provenance, never this task completion. Bound is not read or scientifically validated. Omitted evidence can be retrieved through original bounded tools; do not infer it. Current user request and grant supersede old requests; scientific hypotheses remain hypotheses.'};
}
export function currentWork(plan:ResearchGoalPlan|null,state:TaskExecution,originalRequest:string){
 return {request:originalRequest,goal:plan?.goal??null,constraints:plan?.constraints??state.grant,
  inputs:plan?.inputVersionRefs??[],facts:plan?.cognition.facts??[],missing:plan?.cognition.missing??[],assumptions:plan?.cognition.assumptions??[],
  completed:state.steps.filter(s=>s.state==='completed').map(s=>s.id),
  blockers:[...state.steps.filter(s=>['blocked','failed','unknown','stale'].includes(s.state)).map(s=>({stepId:s.id,reason:s.reason})),
   ...(state.workingContext?.notices??[]).map(reason=>({stepId:null,reason}))],
  next:plan?.steps.filter(s=>state.steps.find(v=>v.id===s.id)?.state!=='completed'&&s.dependsOn.every(id=>state.steps.find(v=>v.id===id)?.state==='completed')).map(s=>({id:s.id,method:s.method,inputRefs:s.inputRefs}))??[]};
}
