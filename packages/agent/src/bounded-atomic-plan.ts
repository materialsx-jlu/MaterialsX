import type {PlanContext} from '../../contracts/src/research-goal.js';
import {requestedOutputQuantities} from './output-quantities.js';
export const atomicArtifactRoles=['JSON','报告','3D结构'] as const;
/** One explicitly bounded backend workflow, not a new agent or scientific default. */
export function boundedAtomicProposal(request:string,context:PlanContext){
  const steps=request.match(/(?:最多|至多|up to|at most)\s*(\d+)\s*(?:步|steps?)/i);
  const permissions=context.methods.get('materials_science');
  if(!steps||Number(steps[1])<1||Number(steps[1])>64||!permissions?.includes('science')||!permissions.every(p=>context.grant.permissions.includes(p)))return null;
  if(!/固定晶胞|fixed[- ]cell/i.test(request)||!/弛豫|relax/i.test(request)||!/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i.test(request))return null;
  if(!/auto_plan|自动.{0,24}(?:选择|匹配)|(?:choose|select).{0,30}potential/i.test(request)||/比较|对比|之后|然后.*(?:拟合|模拟)|compare|comparison|followed by/i.test(request))return null;
  return {
    goal:{materialSystem:null,problemType:request,metrics:requestedOutputQuantities(context,request).map(q=>({name:q.name,value:null,unit:q.units[0],condition:null,priority:0,origin:'user'})),priorities:[]},
    constraints:{process:[request],dataSources:[]},cognition:{facts:[],missing:[],assumptions:[],conflicts:[]},
    steps:[{id:'step1',inputRefs:[context.task.taskId],method:'materials_science',dependsOn:[],permissions:[...permissions],expectedArtifacts:[...atomicArtifactRoles],completionCriteria:['Use auto_plan, select one eligible candidate using its actual nextCalls, then auto_run and auto_get until the actual job completes.','Verify energy, forces, actual convergence/stop reason, bilingual reports and final 3D structure. Never expand the approved structure, physics, step or download scope.']}],
    adjustmentRules:[{trigger:'No eligible model, missing structure, or failed calculation',action:'stop',affectedSteps:['step1'],maxRetries:0}],
    acceptance:{requiredArtifacts:[...atomicArtifactRoles],criteria:['Only actual completed job receipts and unchanged generated files satisfy completion; scientific quality remains needs_review.'],requiredEvidence:[],allowedLimitations:['Exploratory potential results require scientific review; reaching the requested step limit is not convergence.']},
  };
}
