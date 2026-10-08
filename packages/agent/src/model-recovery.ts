import {VerifiedSourceReady,type ExecutionControl} from './execution-control.js';

import {failureFor,recoveryError} from './recovery-failures.js';
import {correctiveKinds,recoveryInstructions} from './recovery-policy.js';
import type {RecoveryFault} from '../../contracts/src/recovery.js';
export function localResponseFormatError(error:unknown):boolean{
  return ['arguments','protocol'].includes(failureFor(error).kind);
}
/** Same engine/session only, after the host confirms all prior operations and paid requests. */
export function canRecoverLocalResponse(error:unknown,control?:ExecutionControl):boolean{
  const fault=failureFor(error);
  return correctiveKinds.has(fault.kind)&&['rejected','completed'].includes(fault.phase)&&control?.canRecoverModelResponse?.()===true;
}
export function localRecoveryPrompt(error:unknown,control:ExecutionControl):string{
  const state=JSON.parse(control.summary()),fault=failureFor(error);
  return `Failure contract: ${JSON.stringify(fault)}. Required next action: ${recoveryInstructions(fault)}.
The previous model response did not satisfy host validation: ${JSON.stringify((error as Error).message)}.
Continue the original user task in this same session. Existing successful tool receipts and files are real; do not repeat their mutations. Read actual IDs and paths from those receipts, using task_control action=receipt if needed. Call advertised tools one at a time with complete JSON objects matching their schemas; continue the existing tool loop until the requested sources and artifacts are read and checked. Do not emit protocol tokens, placeholders, ellipses, invented IDs or comments inside JSON. Preserve the original grant, deadline, goals and scientific limits. Finish only after inspecting the requested actual artifacts.
Actual execution receipts: ${JSON.stringify(state.execution)}. Exact current source-read call, when applicable: ${JSON.stringify(state.research?.recipeProposal?.readCall??null)}. Current proposal status and required next tool: ${JSON.stringify(state.research?.recipeProposal?{sourcesRead:state.research.recipeProposal.sourcesRead,proposalCall:state.research.recipeProposal.proposalCall}:null)}. If sourcesRead is true, do not read/search the same recipes again; proceed to recipe_proposal. The host attaches the current authoritative goal and research state to the next request.`;
}
export async function withLocalResponseRecovery<T>(run:(correction:string|null)=>Promise<T>,control?:ExecutionControl,onRecovery?:(attempt:number,fault:RecoveryFault)=>void,onVerifiedSource?:()=>T):Promise<T>{
  let correction:string|null=null,repairs=0,total=0;
  const completed=new Set<string>();
  const observeProgress=()=>{
    if(!control)return false;
    const state=JSON.parse(control.summary());let advanced=false;
    for(const step of state.execution?.steps??[])if(step.state==='completed')for(const artifact of step.artifacts??[])if(artifact.verified){
      const key=artifact.path+':'+artifact.sha256;if(!completed.has(key)){completed.add(key);advanced=true;}
    }
    return advanced;
  };
  observeProgress();
  for(;;){
    try{
      const result=await run(correction);
      if(typeof result==='string'&&control?.checkAnswer){const assessment=control.checkAnswer(result);
        if(assessment.status==='blocked')throw recoveryError('INVALID_PLAN','Answer contradicts current host evidence: '+assessment.issues.join('; '),'acceptance');}
      await control?.verifyBackendSteps?.();
      if(control){const state=JSON.parse(control.summary());
        const pending=state.execution?.steps?.some((s:any)=>{
          const definition=state.goal?.steps?.find((d:any)=>d.id===s.id);
          return s.state!=='completed'&&!(definition?.method==='engine.execute'&&!definition.expectedArtifacts?.length);
        });
        if(state.goal&&state.execution?.state==='running'&&state.execution.readySteps?.length&&pending)
          throw recoveryError('INVALID_PLAN','Incomplete planned execution: the engine returned before verified planned steps completed. Complete the actual pending action and inspect the primary backend artifacts; the host verifies fixed steps. Select a step only when the host reports ambiguity. Required outputs: '+JSON.stringify(state.goal?.acceptance?.requiredArtifacts??[]),'acceptance');
      }
      const issue=control?.modelCompletionIssue?.();if(issue)throw recoveryError('INVALID_PLAN',issue,'source');
      return result;
    }catch(error){
      if(error instanceof VerifiedSourceReady&&control?.sourceRetrievalComplete?.()&&onVerifiedSource){await control.verifyBackendSteps?.();return onVerifiedSource();}
      // Only a newly host-verified completed step opens the next correction budget.
      // Read calls, control/version changes and model claims cannot reset it.
      if(observeProgress())repairs=0;
      if(!canRecoverLocalResponse(error,control))throw error;
      const fault=failureFor(error);
      if(control?.recordRecovery?!control.recordRecovery(fault):repairs>=2||total>=8)
        throw recoveryError('EXECUTION_FAILED','有限恢复预算已用尽；保留原回执。 / Recovery budget exhausted: '+(error as Error).message,'budget');
      // Cloud continuation requires host-confirmed completed requests; unknown/failed billable calls never reopen admission.
      correction=localRecoveryPrompt(error,control!);repairs++;total++;onRecovery?.(repairs,fault);
    }
  }
}
