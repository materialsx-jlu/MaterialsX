import { composerAdmission } from './composer-admission.js';
import { AgentError, type Permission } from '../../contracts/src/agent.js';
import type { ExecutionControl } from './execution-control.js';
import {recoveryError} from './recovery-failures.js';
import {validateNativeArguments} from './codex-direct-tools.js';

/** A terminal barrier: observe/admit calls, then let the original engine execute them. */
export function supervisedStream(response:Response,control:ExecutionControl,requestId:string,
 tools:ReadonlyMap<string,readonly Permission[]>,phase:'interpret'|'execute',mappings:Record<string,{name:string}>={},hostTools?:ReadonlySet<string>,validateCall?:(item:unknown)=>void){
 if(!response.body){control.endRequest(requestId,'unknown');throw recoveryError('PROTOCOL_ERROR','模型未返回数据流','protocol');}
 const decoder=new TextDecoder(),encoder=new TextEncoder();let buffer='',terminal=false,withheld='';
 const finalized=new Map<string,any>();
 const calls=(items:any[])=>{
  const byId=new Map<string,any>();
  for(const item of items){
   if(item?.type!=='function_call')continue;
   if(typeof item.call_id!=='string'||!item.call_id||typeof item.arguments!=='string')throw recoveryError('PROTOCOL_ERROR','Incomplete tool arguments','arguments');
   const previous=byId.get(item.call_id);
   if(previous&&(previous.name!==item.name||previous.arguments!==item.arguments))throw recoveryError('PROTOCOL_ERROR','Unapproved or repeated call: conflicting call ID','protocol');
   byId.set(item.call_id,item);
  }
  return [...byId.values()];
 };
 const prepare=(item:any)=>{
  if(phase!=='execute')throw new AgentError('PERMISSION_DENIED','需求解释阶段禁止工具调用');
  validateCall?.(item);
  const name=mappings[item.name]?.name??item.name;
  const required=tools.get(name)??(['agent_exec','exec'].includes(name)?['read','search','terminal','patch'] as const:['agent_wait','wait'].includes(name)?[]:undefined);
  if(!required)throw recoveryError('PROTOCOL_ERROR','Unapproved tool: '+JSON.stringify(name),'protocol');
  let args:any;try{args=JSON.parse(item.arguments);}catch{throw recoveryError('PROTOCOL_ERROR','Incomplete tool arguments','arguments');}
  if(!args||typeof args!=='object'||Array.isArray(args))throw recoveryError('PROTOCOL_ERROR','Tool arguments must be an object','arguments');
  if(['exec','agent_exec'].includes(name)){
   const admitted=composerAdmission(args.input,control,tools,hostTools);
   if(!admitted.host)validateNativeArguments(admitted.name,admitted.args);
   return {...admitted,id:item.call_id};
  }
  if(hostTools?.has(name))return {id:item.call_id,name,args,permissions:required,host:true};
  const actual=['wait','agent_wait'].includes(name)?'engine.execute':name;
  validateNativeArguments(name,args,mappings[item.name]!==undefined);
  control.authorize(actual,required);
  return {id:item.call_id,name:actual,args,permissions:required,host:false};
 };
 const stream=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
  transform(chunk,out){
   buffer+=decoder.decode(chunk,{stream:true}).replace(/\r/g,'');
   if(buffer.length+withheld.length>1024*1024)throw new AgentError('BUDGET_EXCEEDED','流事件超过大小上限');
   let end:number;
   while((end=buffer.indexOf('\n\n'))>=0){
    const block=buffer.slice(0,end);buffer=buffer.slice(end+2);
    const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data||data==='[DONE]'){out.enqueue(encoder.encode(block+'\n\n'));continue;}
    let event:any;try{event=JSON.parse(data);}catch{throw recoveryError('PROTOCOL_ERROR','Invalid SSE JSON','protocol');}
    if(terminal)throw recoveryError('PROTOCOL_ERROR','Unapproved or repeated call: event after terminal','protocol');
    if(event.type?.endsWith('.delta'))control.firstToken?.(requestId);
    if(event.type==='response.output_item.done'){
     const key=event.item?.id??event.item?.call_id;
     if(!key)throw recoveryError('PROTOCOL_ERROR','Incomplete model response: missing item ID','protocol');
     const old=finalized.get(key);
     if(old){if(JSON.stringify(old)!==JSON.stringify(event.item))throw recoveryError('PROTOCOL_ERROR','Unapproved or repeated call: changed finalized item','protocol');continue;}
     finalized.set(key,event.item);withheld+=block+'\n\n';continue;
    }
    if(event.type==='response.function_call_arguments.done'){withheld+=block+'\n\n';continue;}
    if(['response.completed','response.failed','response.incomplete'].includes(event.type)){
     terminal=true;control.endRequest(requestId,event.type==='response.completed'?'completed':'failed',event.response?.usage??null);
     if(event.type==='response.completed'){
      const output=event.response?.output??[];
      if(calls(output).length!==output.filter((i:any)=>i.type==='function_call').length)throw recoveryError('PROTOCOL_ERROR','Unapproved or repeated call: duplicate terminal call ID','protocol');
      const finalCalls=calls([...finalized.values(),...output]);
      for(const call of calls([...finalized.values()]))if(!output.some((i:any)=>i.type==='function_call'&&i.call_id===call.call_id))throw recoveryError('PROTOCOL_ERROR','Incomplete model response: terminal omitted a tool call','protocol');
      const prepared=finalCalls.map(prepare);
      if(prepared.filter(c=>!c.host).length>1)throw recoveryError('PROTOCOL_ERROR','Unapproved or repeated call: use one native operation per response','protocol');
      for(const call of prepared)if(!call.host){const cached=control.beforeTool(call);if(cached!==undefined)throw recoveryError('CONFLICT','该原生操作已有真实回执；未重复执行','receipt-exists');}
      if(withheld)out.enqueue(encoder.encode(withheld));withheld='';
     }
    }
    out.enqueue(encoder.encode(block+'\n\n'));
   }
  },
  flush(){if(!terminal||buffer.trim())throw recoveryError('PROTOCOL_ERROR','模型流缺少可靠终态','protocol');}
 }));
 const reader=stream.getReader();
 const observed=new ReadableStream<Uint8Array>({
  async pull(out){try{const next=await reader.read();if(next.done)out.close();else out.enqueue(next.value);}catch(error){if(!terminal)control.endRequest(requestId,'unknown');out.error(error);}},
  async cancel(reason){if(!terminal)control.endRequest(requestId,'unknown');await reader.cancel(reason);}
 });
 return new Response(observed,{status:response.status,headers:response.headers});
}
