import {z} from 'zod';
import {AgentError,type AgentErrorCode} from '../../contracts/src/agent.js';
import {recoveryFaultSchema,type RecoveryFault,type RecoveryKind} from '../../contracts/src/recovery.js';
import {nativeReceiptMetadata} from './execution-receipts.js';
const next:Record<RecoveryKind,RecoveryFault['next']>={arguments:'correct-arguments',protocol:'repair-response',transport:'reconcile',script:'inspect-script',environment:'check-environment',source:'supplement-source',capability:'discover-capability','job-pending':'query-original','operation-unknown':'reconcile',permission:'stop',budget:'stop','science-scope':'stop',acceptance:'verify-delivery','step-selection':'select-step','plan-required':'plan','receipt-exists':'inspect-receipt',cancelled:'stop',internal:'stop'};
export function recoveryFault(kind:RecoveryKind,phase:RecoveryFault['phase']='rejected',extra:Partial<Omit<RecoveryFault,'kind'|'phase'|'next'>>={}):RecoveryFault{return recoveryFaultSchema.parse({kind,phase,next:next[kind],...extra});}
export function recoveryError(code:AgentErrorCode,message:string,kind:RecoveryKind,phase:RecoveryFault['phase']='rejected',extra:Partial<Omit<RecoveryFault,'kind'|'phase'|'next'>>={}){return new AgentError(code,message,false,recoveryFault(kind,phase,extra));}
/** Actual adapter receipt survives thrown errors without being replaced by a generic string. */
export class ToolExecutionError extends AgentError{
 constructor(message:string,public receipt:Record<string,unknown>,kind:RecoveryKind='script'){super('EXECUTION_FAILED',message,false,recoveryFault(kind,'completed'));}
}
export function argumentError(tool:string,parameters:Record<string,unknown>,cause:unknown){
 const issues=cause instanceof z.ZodError?cause.issues.slice(0,8).map(i=>({path:(i.path.map(String).join('.')||(i.code==='unrecognized_keys'?i.keys.join(','):'$')).slice(0,256),code:i.code,
  expected:('expected' in i?String(i.expected):i.code==='unrecognized_keys'?'Only declared properties':i.code==='too_big'?'Within declared maximum':i.code==='too_small'?'Within declared minimum':'Match the declared constraint')})):[{path:'$',code:'invalid_format',expected:'Complete JSON object; literal patch newlines where required'}];
 return recoveryError('PROTOCOL_ERROR','Tool arguments do not match schema: '+tool+'; '+issues.map(i=>i.code==='unrecognized_keys'?'Unrecognized key: '+i.path:i.path+': '+i.expected).join('; '),'arguments','rejected',{tool,issues,...(JSON.stringify(parameters).length<=12000?{parameters}:{})});
}
/** Compatibility only at old/external error boundaries. Core decisions use kind/phase, never these messages. */
function legacyFault(error:Error):RecoveryFault|undefined{
 const message=error.message;
 if(!(error instanceof AgentError)||error.code==='PROTOCOL_ERROR'){
  if(/Incomplete tool arguments|Tool arguments must be an object|Tool arguments do not match schema/.test(message))return recoveryFault('arguments');
  if(/Unparsed model markers|Incomplete model response|Model output truncated|Empty assistant (?:output|message)|Invalid SSE JSON|Unapproved or repeated call|Unapproved tool/.test(message))return recoveryFault('protocol');
 }
 if(error instanceof AgentError&&error.code==='INVALID_PLAN'){
  if(message.startsWith('Answer contradicts current host evidence:')||message.startsWith('Incomplete planned execution'))return recoveryFault('acceptance');
  if(message.startsWith('Incomplete source retrieval:'))return recoveryFault('source');
  if(message.startsWith('PLAN_REQUIRED:'))return recoveryFault('plan-required');
  if(message.startsWith('STEP_SELECTION_REQUIRED:')||message.startsWith('依赖尚未完成：')&&message.includes('Use the actual task_control candidate:'))return recoveryFault('step-selection');
 }
 if(error instanceof AgentError&&error.code==='CONFLICT'&&/^该原生操作已有真实回执[；，]未重复执行$/.test(message))return recoveryFault('receipt-exists');
 // Known adapters report stable machine codes; arbitrary source text is never classified here.
 if(/^(?:MANAGED_PYTHON_UNAVAILABLE|SKILL_NOT_INSTALLED|ASSET_NOT_APPROVED|SKILL_OUTSIDE_APPROVED_ROOT|TOOL_NOT_APPROVED|SKILL_INVALID_LINE_RANGE|INVALID_READ_RANGE)\b/.test(message)){
  return recoveryFault(message.startsWith('MANAGED')?'environment':message.includes('RANGE')?'arguments':message.includes('NOT_INSTALLED')?'capability':'permission');
 }
}
export function failureFor(error:unknown):RecoveryFault{
 if(error instanceof AgentError&&error.recovery)return recoveryFaultSchema.parse(error.recovery);
 if(error instanceof Error){const legacy=legacyFault(error);if(legacy)return legacy;}
 if(error instanceof AgentError){
  const kinds:Partial<Record<AgentErrorCode,RecoveryKind>>={PERMISSION_DENIED:'permission',BUDGET_EXCEEDED:'budget',CANCELLED:'cancelled',RECONCILIATION_REQUIRED:'operation-unknown',UNKNOWN_METHOD:'capability',UNAVAILABLE:'capability'};
  const kind=kinds[error.code];if(kind)return recoveryFault(kind,kind==='operation-unknown'?'unknown':'rejected');
 }
 if(error instanceof Error&&error.name==='AbortError')return recoveryFault('cancelled');
 return recoveryFault('internal','unknown');
}
export function failureFromReceipt(method:string,id:string,result:any,isError:boolean,unknown=false):RecoveryFault|undefined{
 if(unknown)return recoveryFault('operation-unknown','unknown',{tool:method,receiptId:id});
 if(!isError)return;
 const embedded=recoveryFaultSchema.safeParse(result?.recovery??result?.error?.recovery);
 if(embedded.success)return {...embedded.data,tool:method,receiptId:id};
 if(Array.isArray(result?.content)&&result.content.length===1&&result.content[0]?.type==='text'){
  try{const value=JSON.parse(result.content[0].text),fault=recoveryFaultSchema.safeParse(value?.recovery);if(fault.success)return {...fault.data,tool:method,receiptId:id};}catch{/* Ordinary source text is not a host failure contract. */}
 }
 if(['exec_command','write_stdin','bash','engine.execute'].includes(method)){
  const metadata=nativeReceiptMetadata(result?.content??result);const text=JSON.stringify(result).slice(0,32000);
  // Inspect real stderr only after a verified nonzero native exit; stdout/source prose is not evidence of failure.
  const dependency=metadata.exitCode!==null&&metadata.exitCode!==0&&/ModuleNotFoundError:|ImportError:|ERR_MODULE_NOT_FOUND/.test(text);
  return recoveryFault(dependency?'environment':'script','completed',{tool:method,receiptId:id});
 }
 return recoveryFault('internal','completed',{tool:method,receiptId:id});
}
export function toolFailureResult(error:unknown,tool:string){return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:error instanceof Error?error.message:'Tool failed',recovery:{...failureFor(error),tool},...(error instanceof ToolExecutionError?{receipt:error.receipt}:{})})}]};}
