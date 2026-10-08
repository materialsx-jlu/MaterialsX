import {recoveryError} from '../../agent/src/recovery-failures.js';
import {scienceActionSchema as argsSchema,scienceParameters} from '../../contracts/src/science-action.js';
export {scienceParameters,molecularScienceParameters,legacyScienceParameters} from '../../contracts/src/science-action.js';
import {currentScientificScopeSchema as scientificScopeSchema,type ScientificScope} from '../../contracts/src/potential-physics.js';
import { defaultMDOptions } from "../../contracts/src/atomistic-dynamics.js";
import { z } from 'zod';
import type { AtomisticRuntime } from '../../atomistic/src/runtime.js';
import {mountedId as runnablePotentialId} from '../../contracts/src/potential-packages.js';
import type { SelectionAssessment } from '../../contracts/src/potential-packages.js';
import type { AtomicStructure } from '../../contracts/src/atomistic.js';
import { analysisScopeSchema,type AnalysisScope } from '../../contracts/src/potential-workflow.js';
import type { PotentialAnalysisService } from '../../atomistic/src/potential-workflow.js';

function scienceFailure(message:string){
 const code=message.split(':',1)[0]!;
 if(code==='LOCAL_JOB_LIMIT')return recoveryError('BUDGET_EXCEEDED',message,'budget');
 if(code==='SCIENCE_REQUIREMENT_MISMATCH'||code==='COMPARISON_SCOPE_MISMATCH')return recoveryError('PERMISSION_DENIED',message,'science-scope');
 if(code==='SCIENTIFIC_TASK_INCOMPLETE'||code==='AUTOMATIC_ANALYSIS_INCOMPLETE'||code==='RESULT_NOT_COMPLETED')return recoveryError('RECONCILIATION_REQUIRED',message,'job-pending','pending');
 if(code.endsWith('_REQUIRED')||code==='ASSESSMENT_NOT_APPROVED')return recoveryError('INVALID_PLAN',message,'source');
 if(code.endsWith('_NOT_APPROVED')||code.endsWith('_NOT_OWNED')||code.endsWith('_MISMATCH')||code.endsWith('_NOT_AUTHORIZED'))return recoveryError('PERMISSION_DENIED',message,'permission');
 return recoveryError('EXECUTION_FAILED',message,'acceptance');
}

export const scienceDescription='Trusted local MaterialsX science dispatcher. All fields required; unused IDs are null and evidenceIds empty. inspect/view: targetId=structure ID. import_sample: targetId=bundled sample name (local mode only). select: targetId=structure ID, secondaryId=singlepoint/relaxation/md locally (null in platform mode). singlepoint/relaxation/md: targetId=assessment ID, potentialId=eligible ID, evidenceIds=candidate citations. get/cancel: targetId=owned job ID. compare: targetId and secondaryId=completed singlepoint job IDs on the same immutable structure. auto_plan: targetId=approved structure ID; find eligible installed or audited downloadable candidates. auto_run: targetId=auto assessment ID, potentialId=eligible ID, evidenceIds=candidate citations; freezes a plan and runs ONLY with explicit automatic-analysis scope including download byte limit. auto_get/auto_cancel: targetId=owned workflow ID. M6.15: the reviewed Si MACE+D3(BJ) profile adds baseline and two-body dispersion exactly once; interaction=dispersion-required selects it. D3 is not electrostatics. Spin, field, delta and unresolved multi-head requirements are blocked. No arbitrary paths, URLs or code. Domain and mode must match approved scope; production lacks independent DFT evidence and is blocked. Fixed FIRE defaults 100 steps/.05 eV/A; platform relaxation options frozen by user approval. Scientific quality stays needs_review. NEP_CPU silicon tutorial checkpoint supports pure-Si bulk fixed-cell singlepoint/FIRE only: <=256 atoms, cell minimum singular value >=4 A, volume/atom >=5 A^3. It is not the GPUMD GPU simulator; no added D3 or long-range physics. ANI-2x only supports explicitly declared neutral singlet isolated molecules, not ions, radicals, periodic structures or explicit long-range physics. Plain XYZ has unknown charge/spin: never assume them. Local tools accept optional interaction=long-range-required and hard-exclude short-range-only models. Molecular FIRE needs an explicit nonperiodic display box, whose volume is not physical. MD: bounded fixed-cell NVE/NVT, approved options on platform; local defaults NVE 200 steps, 0.5 fs, 300 K, sample10, seed20261001. No long-term stability claim.';
export function structureSummary(s:AtomicStructure){const elements:Record<string,number>={};for(const a of s.atoms)elements[a.element]=(elements[a.element]??0)+1;return {structureId:s.id,sourceSha256:s.source.sha256,atomCount:s.atoms.length,elements,pbc:s.pbc,charge:s.charge,spinMultiplicity:s.spinMultiplicity,blockingIssues:s.issues.filter(i=>i.severity==='blocking').map(i=>i.code)};}
export function createScienceBridge(runtime:AtomisticRuntime,projectId:string,scopeInput?:ScientificScope,onView?:(structureId:string)=>void,automation?:{service:PotentialAnalysisService;scope:AnalysisScope;prompt:string}){
 const scope=scopeInput?scientificScopeSchema.parse(scopeInput):undefined;
 if(scope&&scope.projectId!==projectId)throw scienceFailure('SCIENCE_SCOPE_PROJECT_MISMATCH');
 if(automation){analysisScopeSchema.parse(automation.scope);if(automation.scope.projectId!==projectId||!scope||scope.structureId!==automation.scope.structureId||scope.permission!==automation.scope.permission||scope.conversationId!==automation.scope.conversationId||automation.scope.maxSteps<(scope.options?.maxSteps??1))throw scienceFailure('AUTOMATION_SCOPE_MISMATCH');}
 const workflows=new Set<string>();
 const assessments=new Map<string,SelectionAssessment>(),ownedJobs=new Set<string>(),selectedRuns=new Map<string,ReturnType<AtomisticRuntime['startSelected']>>();let starts=0;let compared=false;
 const autoRunCalls=(a:SelectionAssessment)=>a.selection.candidates.map(c=>({action:'auto_run',targetId:a.id,secondaryId:null,potentialId:c.potentialId,domain:a.request.domain,mode:a.request.mode,evidenceIds:c.evidenceIds,...(a.request.interaction?{interaction:a.request.interaction}:{})}));
 const checkStructure=(id:string)=>{if(scope&&id!==scope.structureId)throw scienceFailure('STRUCTURE_NOT_APPROVED');return runtime.inspect({projectId,structureId:id});};
 const checkJob=(id:string)=>{if(scope&&!ownedJobs.has(id))throw scienceFailure('JOB_NOT_APPROVED');return runtime.get({projectId,runId:id});};
 return {artifactBackend:{get:(input:{projectId:string;runId:string})=>{if(input.projectId!==projectId||!ownedJobs.has(input.runId))throw scienceFailure('ARTIFACT_JOB_NOT_OWNED');return checkJob(input.runId);}},tool:{name:'materials_science',description:scienceDescription,parameters:scienceParameters},scope,summary:scope?structureSummary(checkStructure(scope.structureId)):null,
  completedSummary(required=false,comparisonRequired=false){if(automation){for(const id of workflows){const w=automation.service.get(projectId,id);if(w.state!=='completed'||!w.runId)throw scienceFailure('AUTOMATIC_ANALYSIS_INCOMPLETE');ownedJobs.add(w.runId);}}if(comparisonRequired&&!compared)throw scienceFailure("SCIENTIFIC_COMPARISON_NOT_EXECUTED");if(required&&workflows.size===0&&ownedJobs.size===0&&(assessments.size===0||[...assessments.values()].some(a=>a.selection.candidates.length>0)))throw scienceFailure('SCIENTIFIC_TASK_NOT_STARTED');const jobs=[...ownedJobs].map(runId=>checkJob(runId));if(jobs.some(j=>j.job.status!=='completed'))throw scienceFailure('SCIENTIFIC_TASK_INCOMPLETE');return jobs.map(j=>({runId:j.job.id,potentialId:j.plan.potentialId,stopReason:j.result?.stopReason,quality:j.job.quality}));},
  cancelOwned(){if(automation)for(const id of workflows)automation.service.cancel(projectId,id);for(const runId of ownedJobs)runtime.cancel({projectId,runId});},
  async execute(input:unknown,signal?:AbortSignal):Promise<unknown>{
   signal?.throwIfAborted();const args=argsSchema.parse(input);if(scope&&(args.domain!==scope.domain||args.mode!==scope.mode))throw scienceFailure('SCIENCE_SCOPE_MISMATCH');
   if(args.action==='import_sample'){if(scope)throw scienceFailure('IMPORT_NOT_APPROVED');if(!args.targetId)throw scienceFailure('SAMPLE_REQUIRED');return structureSummary(await runtime.importSample(projectId,args.targetId));}
   if(args.action.startsWith('auto_')){
    if(!automation||!scope)throw scienceFailure('AUTOMATIC_ANALYSIS_NOT_AUTHORIZED');
    if(!args.targetId)throw scienceFailure('AUTOMATIC_TARGET_REQUIRED');
    if(args.action==='auto_plan'){
      checkStructure(args.targetId);const task=automation.scope.permission;
      const options=task==='relaxation'?scope.options:undefined;if(task==='relaxation'&&!options)throw scienceFailure('RELAXATION_OPTIONS_REQUIRED');
      const a=await automation.service.assess({projectId,structureId:args.targetId,prompt:automation.prompt||'Analyze approved crystal',locale:/[\u3400-\u9fff]/.test(automation.prompt)?'zh':'en',domain:scope.domain,mode:scope.mode,interaction:scope.interaction??args.interaction??(/长程|long.?range|electrostatics|静电/i.test(automation.prompt)?'long-range-required':'short-range'),task,...(options?{options}:{}),budget:{maxAtoms:256,maxSteps:Math.min(automation.scope.maxSteps,options?.maxSteps??1),maxWallSeconds:600,maxMemoryMiB:4096,maxOutputMiB:64,threads:4},maxDownloadBytes:automation.scope.maxDownloadBytes});
      assessments.set(a.id,a);return {id:a.id,assessmentId:a.id,nextCalls:autoRunCalls(a),selection:{...a.selection,exclusions:a.selection.exclusions.slice(0,8)},exclusionCount:a.selection.exclusions.length,exclusionsTruncated:a.selection.exclusions.length>8,rankingBasis:a.rankingBasis,phase:'A',downloadLimitBytes:automation.scope.maxDownloadBytes,note:'Choose one nextCalls entry using its actual assessment ID and evidence IDs, not the structure ID. Remaining exclusions stay in the host assessment; no excluded model is selectable.'};
    }
    if(args.action==='auto_run'){
      if(starts>=2)throw scienceFailure('LOCAL_JOB_LIMIT');const a=assessments.get(args.targetId);if(!a||a.request.structureId!==scope.structureId)throw scienceFailure('ASSESSMENT_NOT_APPROVED: use an actual auto_plan assessmentId and its candidate evidenceIds. Valid nextCalls: '+JSON.stringify([...assessments.values()].filter(a=>a.request.structureId===scope.structureId).slice(-2).flatMap(autoRunCalls)));
      const w=await automation.service.freeze(projectId,{assessmentId:a.id,potentialId:args.potentialId,evidenceIds:args.evidenceIds,reason:'Agent selected this eligible candidate using registry evidence within the approved scope; no accuracy ranking.'});
      workflows.add(w.id);starts++;automation.service.approve(projectId,w.id,w.plan.planSha256);const abort=()=>automation.service.cancel(projectId,w.id);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();return {workflowId:w.id,nextCall:{...args,action:'auto_get',targetId:w.id,potentialId:null,evidenceIds:[]},planSha256:w.plan.planSha256,potentialId:w.plan.potentialId,downloadBytes:w.plan.downloadBytes,state:'checking',quality:'needs_review'};
    }
    if(!workflows.has(args.targetId))throw scienceFailure('WORKFLOW_NOT_APPROVED');
    if(args.action==='auto_cancel')return {cancelled:automation.service.cancel(projectId,args.targetId)};
    const deadline=Date.now()+25000;let w=automation.service.get(projectId,args.targetId);while(!['completed','failed','cancelled','interrupted'].includes(w.state)&&Date.now()<deadline){signal?.throwIfAborted();await new Promise(r=>setTimeout(r,250));w=automation.service.get(projectId,args.targetId);}
    const job=w.runId?runtime.get({projectId,runId:w.runId}):null;if(job?.job.status==='completed'){const a=job.artifacts.find(a=>a.relativePath.endsWith(job.relaxation?'/final.json':'/structure.json'));if(!a)throw scienceFailure('REAL_RESULT_MISSING');await runtime.view({kind:'artifact',projectId,runId:job.job.id,artifactId:a.id});}
    return {workflowId:w.id,state:w.state,error:w.error?'LOCAL_AUTOMATIC_ANALYSIS_FAILED: see desktop workflow':null,potentialId:w.plan.potentialId,planSha256:w.plan.planSha256,events:w.events.map(e=>({state:e.state,at:e.at})),quality:'needs_review',runId:w.runId,result:job?.result?{energyEv:job.result.energyEv,maxForceEvPerAngstrom:Math.max(...job.result.forcesEvPerAngstrom.map(f=>Math.hypot(...f))),stopReason:job.result.stopReason,completedSteps:job.result.completedSteps}:null,artifacts:job?.artifacts.map(a=>({id:a.id,type:a.type,sha256:a.sha256,bytes:a.bytes}))??[]};
   }
   if(['inspect','view','select'].includes(args.action)){
    if(!args.targetId)throw scienceFailure('STRUCTURE_REQUIRED');const s=checkStructure(args.targetId);
    if(args.action==='view'){await runtime.view({kind:'import',projectId,structureId:s.id});onView?.(s.id);return {viewRequested:true,...structureSummary(s),note:'Geometry preview only; inferred bonds are not a simulation.'};}
    if(args.action==='inspect')return structureSummary(s);
    const task=scope?(scope.permission==='md'?'md':scope.permission==='relaxation'?'relaxation':'singlepoint'):z.enum(['singlepoint','relaxation','md']).parse(args.secondaryId??'singlepoint');const assessment=await runtime.assess({projectId,structureId:s.id,domain:args.domain,mode:args.mode,interaction:scope?.interaction??args.interaction,task},signal);assessments.set(assessment.id,assessment);
    // Only bounded evidence metadata is returned; never coordinates or local paths.
    return {assessmentId:assessment.id,id:assessment.id,request:assessment.request,selection:assessment.selection,rankingBasis:assessment.rankingBasis,registrySha256:assessment.registrySha256};
   }
   if(args.action==='singlepoint'||args.action==='relaxation'||args.action==='md'){
    if(scope&&scope.permission!==args.action)throw scienceFailure('CALCULATION_NOT_APPROVED');
    const assessment=args.targetId?assessments.get(args.targetId):undefined;if(!assessment)throw scienceFailure('ASSESSMENT_NOT_APPROVED');checkStructure(assessment.request.structureId);
    if(assessment.request.task!==args.action)throw scienceFailure('TASK_NOT_APPROVED');
    if(args.domain!==assessment.request.domain||args.mode!==assessment.request.mode||(args.interaction!==undefined&&args.interaction!==(assessment.request.interaction??'short-range')))throw scienceFailure('SCIENCE_REQUIREMENT_MISMATCH');
    const potentialId=runnablePotentialId.parse(args.potentialId);
    const key=`${assessment.id}:${potentialId}`,previous=selectedRuns.get(key);
    if(previous){const original=await previous,job=checkJob(original.job.id);return {runId:job.job.id,status:job.job.status,potentialId:job.plan.potentialId,quality:'needs_review',reused:true};}
    if(starts>=2)throw scienceFailure('LOCAL_JOB_LIMIT');
    const options=scope?.options??{optimizer:'FIRE' as const,cellMode:'fixed' as const,cellConstraint:'none' as const,externalPressureGPa:null,maxSteps:100,fmaxEvPerAngstrom:.05};
    const execution=runtime.startSelected({projectId,proposal:{assessmentId:assessment.id,selectedPotentialId:potentialId,evidenceIds:args.evidenceIds},...(args.action==='relaxation'?{options}:args.action==='md'?{mdOptions:scope?.mdOptions??defaultMDOptions}:{})},signal).then(job=>{ownedJobs.add(job.job.id);signal?.addEventListener('abort',()=>runtime.cancel({projectId,runId:job.job.id}),{once:true});if(signal?.aborted)runtime.cancel({projectId,runId:job.job.id});return job;});
    starts++;selectedRuns.set(key,execution);const job=await execution;
    return {runId:job.job.id,status:job.job.status,potentialId:job.plan.potentialId,quality:'needs_review',billing:'local CPU computation consumes no platform credits'};
   }
   if(!args.targetId)throw scienceFailure('JOB_REQUIRED');const item=checkJob(args.targetId);
   if(args.action==='cancel')return {cancelled:runtime.cancel({projectId,runId:args.targetId})};
   if(args.action==='compare'){
    if(!args.secondaryId)throw scienceFailure('SECOND_JOB_REQUIRED');const b=checkJob(args.secondaryId);
    if(item.md&&b.md){const comparison=await runtime.compareMD({projectId,runIds:[item.job.id,b.job.id]});compared=true;return {runIds:comparison.runIds,potentialIds:comparison.potentialIds,definition:comparison.energyDefinition,diagnostics:[item.md.summary,b.md.summary],quality:'needs_review',accuracy:'Agreement does not establish accuracy; total energies have unaligned references.'};}
    // Read hashed registered artifacts before trusting persisted forces.
    for(const job of [item,b]){const artifact=job.artifacts.find(a=>a.relativePath.endsWith('/structure.json'));if(!artifact)throw scienceFailure('RESULT_NOT_COMPLETED');await runtime.view({kind:'artifact',projectId,runId:job.job.id,artifactId:artifact.id});}
    if(item.plan.task.kind!=='singlepoint'||b.plan.task.kind!=='singlepoint'||item.plan.structureSha256!==b.plan.structureSha256||!item.result||!b.result||item.plan.potentialId===b.plan.potentialId)throw scienceFailure('COMPARISON_SCOPE_MISMATCH');
    const differences=item.result.forcesEvPerAngstrom.map((f,i)=>Math.hypot(...f.map((v,j)=>v-b.result!.forcesEvPerAngstrom[i]![j]!)));
    compared=true;return {runs:[item.job.id,b.job.id],potentialIds:[item.plan.potentialId,b.plan.potentialId],atomCount:differences.length,forceDifferenceRmsEvPerAngstrom:Math.sqrt(differences.reduce((s,v)=>s+v*v,0)/differences.length),forceDifferenceMaxEvPerAngstrom:Math.max(...differences),totalEnergyComparison:'blocked: references not aligned',quality:'needs_review',accuracy:'Agreement does not establish accuracy.'};
   }
   const deadline=Date.now()+25_000;let job=item;
   while(!['completed','failed','cancelled','interrupted'].includes(job.job.status)&&Date.now()<deadline){signal?.throwIfAborted();await new Promise(r=>setTimeout(r,250));job=checkJob(args.targetId);}
   if(job.result){const a=job.artifacts.find(a=>a.relativePath.endsWith('/structure.json'))!;await runtime.view({kind:'artifact',projectId,runId:job.job.id,artifactId:a.id});}
   return {md:job.md?{options:job.md.options,progress:job.md.progress,summary:job.md.summary}:null,runId:job.job.id,status:job.job.status,error:job.job.error?'LOCAL_CALCULATION_FAILED: inspect local task details':null,potentialId:job.plan.potentialId,quality:job.job.quality,result:job.result?{energyEv:job.result.energyEv,atomCount:job.result.atomCount,maxForceEvPerAngstrom:Math.max(...job.result.forcesEvPerAngstrom.map(f=>Math.hypot(...f))),stopReason:job.result.stopReason,completedSteps:job.result.completedSteps,stress:job.result.stress}:null,artifacts:job.artifacts.map(a=>({id:a.id,type:a.type,sha256:a.sha256,bytes:a.bytes})),relaxation:job.relaxation?{options:job.relaxation.options,stopReason:job.relaxation.summary?.stopReason??null}:null};
  }
 };
}
export type ScienceBridge=ReturnType<typeof createScienceBridge>;

/** Both engines use the same real scientific completion check. */
export function verifiedScientificText(bridge:ScienceBridge,skillIds:readonly string[]):string{
 const required=skillIds.some(id=>['materials-mlip-singlepoint','materials-mlip-relaxation','materials-mlip-md','materials-mlip-comparison'].includes(id));
 const jobs=bridge.completedSummary(required,skillIds.includes('materials-mlip-comparison'));
 return `\n\nMaterialsX 本机工具核验：${jobs.length?JSON.stringify(jobs):'本轮未执行本地计算'}。`;
}
