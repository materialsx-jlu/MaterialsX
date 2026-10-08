import {z} from 'zod';
import {AgentError} from '../../contracts/src/agent.js';
import {argumentError,recoveryError} from './recovery-failures.js';
import type {HostTool} from './host-mcp.js';
import type {CustomCallMapping} from './codex-protocol.js';
const nativeDefinitions=[
 {name:'exec_command',description:'Run ONE native operation per response inside the approved project sandbox; wait for its receipt before the next operation. Use login=false and the managed Python. No internet/package installation or credential reads.',parameters:{type:'object',properties:{cmd:{type:'string'},workdir:{type:'string'},login:{type:'boolean'},yield_time_ms:{type:'integer',minimum:1,maximum:30000},max_output_tokens:{type:'integer',minimum:1},tty:{type:'boolean'}},required:['cmd'],additionalProperties:false}},
 {name:'write_stdin',description:'Poll or interact with an actual owned native terminal session. At most ONE native operation per response. Empty chars only queries it; use the returned session_id, never invent it.',parameters:{type:'object',properties:{session_id:{type:'integer'},chars:{type:'string'},yield_time_ms:{type:'integer',minimum:1,maximum:300000},max_output_tokens:{type:'integer',minimum:1}},required:['session_id'],additionalProperties:false}},
 {name:'apply_patch',description:'Apply a patch inside the approved project. At most ONE native operation per response. patch is literal *** Begin Patch / *** End Patch text with actual line breaks after JSON decoding, never double-escaped backslash-n separators.',parameters:{type:'object',properties:{patch:{type:'string'}},required:['patch'],additionalProperties:false}},
] as const;
/** Validate actual native JSON/freeform adapters before original-engine dispatch. */
export function validateNativeArguments(name:string,args:unknown,custom=false){
 const definition=nativeDefinitions.find(t=>t.name===name);if(!definition)return;
 try{
  if(name==='apply_patch'&&(typeof args==='string'||custom&&(args as any)?.input!==undefined)){const v=typeof args==='string'?{input:args}:args as any;if(typeof v?.input!=='string'||!/^\*\*\* Begin Patch\r?\n[\s\S]*\r?\n\*\*\* End Patch\r?\n?$/.test(v.input))throw Error('Invalid patch');return;}
  z.fromJSONSchema(definition.parameters as any).parse(args);
 }catch(error){throw argumentError(name,definition.parameters,error);}
}
/** A protocol adapter, not an executor. Native Codex still runs every command/MCP call and its original loop.
 * The provider sees exact JSON tools instead of having to author a JavaScript composer program. */
export class CodexDirectTools {
 private calls=new Map<string,{name:string;arguments:string}>();
 constructor(private host:ReadonlyArray<Pick<HostTool,'name'|'description'|'parameters'>>,private nativeNames:ReadonlySet<string>){ }
 prepare(converted:{payload:any;customCalls?:CustomCallMapping},allowTools:boolean){
  const composer=converted.payload.tools?.find((t:any)=>['exec','agent_exec'].includes(t.name));
  if(!composer)return {payload:converted.payload,adapt:(r:Response)=>r,validate:(_item:unknown)=>{}};
  const definitions=[...this.host,...nativeDefinitions.filter(t=>this.nativeNames.has(t.name))];
  if(definitions.length>32)throw new AgentError('BUDGET_EXCEEDED','直接工具目录超过平台上限；未隐藏已授权工具');
  const byName=new Map(definitions.map(t=>[t.name,t]));
  const payload={...converted.payload,tools:allowTools?definitions.map(t=>({type:'function',name:t.name,description:t.description.slice(0,4096),parameters:t.parameters})):[],tool_choice:allowTools?'auto':'none'};
  payload.input=payload.input.map((item:any)=>{
   const original=this.calls.get(item.call_id);return item.type==='function_call'&&original?{...item,name:original.name,arguments:original.arguments}:item;
  });
  const decode=(item:any)=>{
   const definition=byName.get(item.name);if(!definition)throw recoveryError('PROTOCOL_ERROR','Unapproved tool: '+item.name,'protocol');
   try{const args:any=z.fromJSONSchema(definition.parameters as any).parse(JSON.parse(item.arguments));if(item.name==='apply_patch'&&!/^\*\*\* Begin Patch\r?\n[\s\S]*\r?\n\*\*\* End Patch\r?\n?$/.test(args.patch))throw Error('Patch needs actual line breaks');return args;}catch(error){throw argumentError(item.name,definition.parameters,error);}
  };
  const validate=(item:any)=>{if(item?.type==='function_call')decode(item);};
  const compose=(item:any)=>{
   if(item?.type!=='function_call')return item;
   const args=decode(item);
   this.calls.set(item.call_id,{name:item.name,arguments:item.arguments});
   const target=this.host.some(t=>t.name===item.name)?'mcp__materialsx__'+item.name:item.name;
   const expression=item.name==='apply_patch'?JSON.stringify(args.patch):JSON.stringify(args);
   return {...item,name:composer.name,arguments:JSON.stringify({input:`text(await tools.${target}(${expression}));`})};
  };
  return {payload,validate,adapt:(response:Response)=>{
   if(!response.body)return response;
   const decoder=new TextDecoder(),encoder=new TextEncoder();let buffer='';
   return new Response(response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
    transform(chunk,out){
     buffer+=decoder.decode(chunk,{stream:true});let end:number;
     while((end=buffer.indexOf('\n\n'))>=0){
      const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');
      if(!data||data==='[DONE]'){out.enqueue(encoder.encode(block+'\n\n'));continue;}
      const event=JSON.parse(data);
      if(event.type==='response.output_item.added'&&event.item?.type==='function_call'){
       event.item={...event.item,name:composer.name,arguments:''};
      }else if(event.type==='response.function_call_arguments.delta'||event.type==='response.function_call_arguments.done')continue;
      else if(event.type==='response.output_item.done'&&event.item?.type==='function_call'){
       event.item=compose(event.item);out.enqueue(encoder.encode('data: '+JSON.stringify({type:'response.function_call_arguments.done',output_index:event.output_index,item_id:event.item.id,arguments:event.item.arguments})+'\n\n'));
      }
      if(event.response?.output)event.response.output=event.response.output.map(compose);
      out.enqueue(encoder.encode('data: '+JSON.stringify(event)+'\n\n'));
     }
    },flush(){if(buffer.trim())throw recoveryError('PROTOCOL_ERROR','Incomplete model response','protocol');}
   })),{status:response.status,headers:response.headers});
  }};
 }
}
