import {AgentError} from '../../contracts/src/agent.js';
import type {ModelConnection} from '../../contracts/src/engine-selection.js';
import type {ExecutionControl} from './execution-control.js';
/** The existing planner's response-only request, through the same gateway/task/budget.
 * No tool execution or second agent; native Codex owns the subsequent execution loop. */
export async function interpretPlatform(prompt:string,signal:AbortSignal,control:ExecutionControl,connection:ModelConnection,
 invoke:(payload:unknown,signal:AbortSignal,requestId?:string)=>Promise<Response>):Promise<string>{
 // Match the existing native host request budget when the supplier has not advertised its window; this is not a claim about provider capacity.
 const contextWindow=connection.contextWindow??131072;
 const request=control.beforeRequest({model:'materials-research',input:[
  {type:'message',role:'developer',content:'Interpret the research goal as compact JSON DATA matching the supplied contract. Exact enum values only. No tools, executable instructions, fabricated quantities/evidence or missing conditions that can be checked by an available read tool.'},
  {type:'message',role:'user',content:prompt},
 ],tools:[],tool_choice:'none',stream:true,store:false,max_output_tokens:connection.maxOutputTokens},'interpret',contextWindow,connection.maxOutputTokens);
 let completed=false,failed=false,buffer='',output='',usage:unknown=null;
 try{
  const response=await invoke(request.payload,signal,request.id);if(!response.ok||!response.body)throw new AgentError('UNAVAILABLE','研究计划模型响应不可用');
  const decoder=new TextDecoder();
  for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true}).replace(/\r/g,'');let end:number;
   while((end=buffer.indexOf('\n\n'))>=0){
    const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');
    if(!data||data==='[DONE]')continue;const event=JSON.parse(data);
    if(event.type?.endsWith('.delta'))control.firstToken?.(request.id);
    if(['response.failed','response.incomplete'].includes(event.type)){
     failed=true;usage=event.response?.usage??null;
     throw new AgentError(event.response?.error?.code==='TASK_BUDGET_EXCEEDED'?'BUDGET_EXCEEDED':'EXECUTION_FAILED','研究计划请求已确认失败；未执行工具');
    }
    if(event.type==='response.completed'){
     if(completed)throw new AgentError('PROTOCOL_ERROR','Duplicate plan response terminal');completed=true;usage=event.response?.usage??null;
     output=(event.response?.output??[]).filter((i:any)=>i.type==='message'&&i.role==='assistant').flatMap((i:any)=>i.content??[]).filter((p:any)=>p.type==='output_text').map((p:any)=>p.text).join('');
    }
   }
  }
  if(!completed||buffer.trim()||!output.trim())throw new AgentError('PROTOCOL_ERROR','Incomplete model response: research plan has no verified text');
  control.endRequest(request.id,'completed',usage);return output;
 }catch(error){control.endRequest(request.id,completed?'completed':failed||error instanceof AgentError&&error.code==='BUDGET_EXCEEDED'?'failed':'unknown',usage);throw error;}
}
