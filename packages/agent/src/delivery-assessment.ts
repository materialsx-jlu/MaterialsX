import type {ResearchGoalPlan} from '../../contracts/src/research-goal.js';
import type {TaskExecution} from '../../contracts/src/task-execution.js';
import type {DeliveryAssessment} from '../../contracts/src/working-context.js';
const ISSUE_LIMIT=1200;
const OMITTED='…（完整原因见运行记录 / Full detail in task log）';
function deliveryIssue(value:string):string{
 return value.length<=ISSUE_LIMIT?value:value.slice(0,ISSUE_LIMIT-OMITTED.length)+OMITTED;
}
/** Technical receipts/files and scientific validity have independent states. */
export function assessDelivery(plan:ResearchGoalPlan|null,state:TaskExecution,issue:string|null=null,invalidFiles:readonly string[]=[]):DeliveryAssessment{
 const required=plan?.acceptance.requiredArtifacts??[];
 const verified=state.steps.filter(s=>s.state==='completed').flatMap(s=>s.artifacts??[])
  .filter(a=>a.verified&&a.planRevision===state.planRevision&&!invalidFiles.some(i=>i.endsWith(': '+a.path))).map(a=>a.name);
 const missing=required.filter(name=>!verified.includes(name));
 const incomplete=state.steps.filter(s=>s.state!=='completed').map(s=>s.id);
 const issues=[...(issue?[issue]:[]),...incomplete.map(id=>'Incomplete step: '+id),
  ...(state.attempts.some(a=>['running','unknown'].includes(a.state))?['Operation receipt unresolved']:[]),
  ...(state.answerAssessment?.status==='blocked'?state.answerAssessment.issues:[])];
 const complete=!missing.length&&!issues.length;
 return {schemaVersion:'delivery-assessment-v1',planRevision:state.planRevision,
  technical:complete?'complete':verified.length||state.steps.some(s=>s.state==='completed')?'partial':'incomplete',scientific:'needs_review',
  verified:[...new Set(verified)].slice(0,128),missing:missing.slice(0,128),issues:issues.slice(0,64).map(deliveryIssue)};
}
