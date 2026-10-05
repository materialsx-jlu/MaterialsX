import {AgentError} from '../../contracts/src/agent.js';
import type {ExecutionControl} from './execution-control.js';

const formatFailure=/Incomplete tool arguments|Tool arguments must be an object|Tool arguments do not match schema|Unparsed model markers|Incomplete model response|Model output truncated|Empty assistant (?:output|message)|Invalid SSE JSON|Unapproved or repeated call|Unapproved tool/;
export function localResponseFormatError(error:unknown):boolean{
  return error instanceof Error&&formatFailure.test(error.message)&&(!(error instanceof AgentError)||error.code==='PROTOCOL_ERROR');
}
/** Continue the SAME engine after a rejected local model response, never replay a tool. */
export function canRecoverLocalResponse(error:unknown,control?:ExecutionControl):boolean{
  const premature=error instanceof AgentError&&error.code==='INVALID_PLAN'&&error.message.startsWith('Incomplete planned execution');
  // A step mismatch rejected by the host before dispatch can be corrected in the
  // same local session. Other invalid plans, permission and budget failures cannot.
  const rejectedStep=error instanceof AgentError&&error.code==='INVALID_PLAN'&&error.message.startsWith('依赖尚未完成：')&&error.message.includes('Use the actual task_control candidate:');
  // Native dispatch was blocked BEFORE execution because its verified receipt already
  // exists. Continue the same session to inspect that receipt; never replay the call.
  const alreadyCompleted=error instanceof AgentError&&error.code==='CONFLICT'&&
    /^该原生操作已有真实回执[；，]未重复执行$/.test(error.message);
  if((!localResponseFormatError(error)&&!premature&&!rejectedStep&&!alreadyCompleted)||!control)return false;
  // A failed parser response may be retried only when all prior tool operations are known.
  return control.canRecoverModelResponse?.()===true;
}
export function localRecoveryPrompt(error:unknown,control:ExecutionControl):string{
  const state=JSON.parse(control.summary());
  return `The previous model response did not satisfy host validation: ${JSON.stringify((error as Error).message)}.
Continue the original user task in this same session. Existing successful tool receipts and files are real; do not repeat their mutations. Read actual IDs and paths from those receipts, using task_control action=receipt if needed. Call ONE advertised tool with a complete JSON object matching its schema. Do not emit protocol tokens, placeholders, ellipses, invented IDs or comments inside JSON. Preserve the original grant, deadline, goals and scientific limits. Finish only after inspecting the requested actual artifacts.
Actual execution receipts: ${JSON.stringify(state.execution)}. The host attaches the current authoritative goal and research state to the next request.`;
}
export async function withLocalResponseRecovery<T>(run:(correction:string|null)=>Promise<T>,control?:ExecutionControl,onRecovery?:(attempt:number)=>void):Promise<T>{
  let correction:string|null=null,repairs=0;
  const completed=new Set<string>();
  const observeProgress=()=>{
    if(!control)return false;
    const state=JSON.parse(control.summary());let advanced=false;
    for(const step of state.execution?.steps??[])if(step.state==='completed'&&!completed.has(step.id)){
      completed.add(step.id);advanced=true;
    }
    return advanced;
  };
  observeProgress();
  for(;;){
    try{
      const result=await run(correction);
      await control?.verifyBackendSteps?.();
      if(control){const state=JSON.parse(control.summary());
        const pending=state.execution?.steps?.some((s:any)=>{
          const definition=state.goal?.steps?.find((d:any)=>d.id===s.id);
          return s.state!=='completed'&&!(definition?.method==='engine.execute'&&!definition.expectedArtifacts?.length);
        });
        if(state.goal?.executionMode==='planned'&&state.execution?.state==='running'&&state.execution.readySteps?.length&&pending)
          throw new AgentError('INVALID_PLAN','Incomplete planned execution: the engine returned before verified planned steps completed. Use actual task_control candidates and inspect the primary backend artifacts.');
      }
      return result;
    }catch(error){
      // Only a newly host-verified completed step opens the next correction budget.
      // Read calls, control/version changes and model claims cannot reset it.
      if(observeProgress())repairs=0;
      if(repairs>=2||!canRecoverLocalResponse(error,control))throw error;
      // No unknown billable request may be retried. Callers enable this only for local routes.
      correction=localRecoveryPrompt(error,control!);repairs++;onRecovery?.(repairs);
    }
  }
}
