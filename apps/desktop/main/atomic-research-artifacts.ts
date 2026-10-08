import {join} from 'node:path';
import type {AtomisticRuntime} from '../../../packages/atomistic/src/runtime.js';
import type {TaskExecution} from '../../../packages/contracts/src/task-execution.js';
import {hashOwnedFile} from '../../../packages/atomistic/src/artifact-io.js';
import {readOwnedBytes} from '../../../packages/atomistic/src/artifact-io.js';
import type {ResearchGoalPlan} from '../../../packages/contracts/src/research-goal.js';
import {atomicArtifactRoles} from '../../../packages/agent/src/bounded-atomic-plan.js';
type AtomicBackend=Partial<Pick<AtomisticRuntime,'assess'|'get'>>;
/** Resolve only completed atomic jobs observed in this task/step, never a previous project result. */
export async function resolveAtomicResearchArtifact(runtime:AtomicBackend|null,state:TaskExecution,stepId:string,name:string,projectPath:string):Promise<string|null>{
  if(!runtime?.get)return null;
  const files:Record<string,string>={'JSON':'result.json','报告':'report.zh.md','中文报告':'report.zh.md','英文报告':'report.en.md','3D 结构':'final.json','3D结构':'final.json'};
  const file=files[name];if(!file)return null;
  for(const attempt of state.attempts.filter(a=>a.stepId===stepId&&a.planRevision===state.planRevision&&a.state==='completed').reverse()){
    for(const observed of attempt.jobs.filter(j=>j.state==='completed')){
      let job:ReturnType<AtomisticRuntime['get']>;
      try{job=runtime.get({projectId:state.task.projectId,runId:observed.id});}catch{continue;}
      if(job.job.status!=='completed'||!job.result)continue;
      const artifact=job.artifacts.find(a=>a.relativePath.endsWith('/'+file)&&!a.partial)??(['3D结构','3D 结构'].includes(name)&&job.plan?.task.kind==='singlepoint'?job.artifacts.find(a=>a.relativePath.endsWith('/structure.json')&&!a.partial):undefined);
      if(!artifact)continue;
      await hashOwnedFile(projectPath,join(projectPath,artifact.relativePath),artifact.sha256,64*1048576);
      return artifact.relativePath;
    }
  }
  return null;
}
export function atomicDeliveryReady(plan:ResearchGoalPlan|null,state:TaskExecution){
  return !!plan&&plan.steps.length===1&&plan.steps[0]!.method==='materials_science'&&atomicArtifactRoles.every(r=>plan.steps[0]!.expectedArtifacts.includes(r))&&state.steps.length===1&&state.steps[0]!.state==='completed';
}
export async function atomicResearchDelivery(runtime:AtomicBackend|null,plan:ResearchGoalPlan|null,state:TaskExecution,projectPath:string):Promise<string|null>{
  if(!runtime?.get||!atomicDeliveryReady(plan,state))return null;
  const stepId=plan!.steps[0]!.id;
  for(const role of atomicArtifactRoles)if(!await resolveAtomicResearchArtifact(runtime,state,stepId,role,projectPath))throw Error('ATOMIC_DELIVERY_MISSING: '+role);
  const ids=[...new Set(state.attempts.filter(a=>a.stepId===stepId&&a.planRevision===state.planRevision&&a.state==='completed').flatMap(a=>a.jobs.filter(j=>j.state==='completed').map(j=>j.id)))];
  for(const id of ids.reverse()){
    let job:ReturnType<AtomisticRuntime['get']>;try{job=runtime.get({projectId:state.task.projectId,runId:id});}catch{continue;}
    if(job.job.status!=='completed'||!job.result)continue;
    const zh=/[\u3400-\u9fff]/.test(plan!.originalRequest),report=job.artifacts.find(a=>a.relativePath.endsWith(zh?'/report.zh.md':'/report.en.md'));
    if(!report)throw Error('ATOMIC_REPORT_MISSING');
    const text=(await readOwnedBytes(projectPath,join(projectPath,report.relativePath),report.sha256,4*1048576)).toString('utf8');
    const forces=job.result.forcesEvPerAngstrom,rows=forces.slice(0,16).map((f,i)=>`| ${i+1} | ${f.map(x=>x.toPrecision(8)).join(' | ')} |`).join('\n');
    return `${text}\n\n${zh?'计算 ID':'Calculation ID'}：${job.job.id}\n\n${zh?'原子受力':'Atomic forces'} (eV/Å)\n\n| ${zh?'原子':'Atom'} | Fx | Fy | Fz |\n| --- | --- | --- | --- |\n${rows}\n\n${forces.length>16?(zh?'仅展示前 16 个原子；完整受力数组保存在结果 JSON。':'First 16 atoms shown; the complete force array is in the result JSON.')+'\n\n':''}${zh?'已核对真实结果、报告和最终结构文件。下方可打开 3D 结构和产物；结果仍需科学复核。':'Actual result, report and final structure files verified. Open the 3D structure and artifacts below; scientific review is still required.'}`;
  }
  throw Error('ATOMIC_COMPLETED_JOB_MISSING');
}
