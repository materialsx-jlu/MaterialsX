import test from 'node:test';
import assert from 'node:assert/strict';
import {CodexDirectTools} from './codex-direct-tools.js';
import {codexResponse} from './codex-protocol.js';
const definition={name:'read_skill',description:'Read approved Skill',parameters:{type:'object',properties:{name:{type:'string'}},required:['name'],additionalProperties:false}};
const converted=()=>({payload:{tools:[{type:'function',name:'exec'}],input:[{role:'user',content:'Use selected skill'}],tool_choice:'auto'},customCalls:{exec:{name:'exec'}}});
const item={type:'function_call',name:'read_skill',call_id:'owned-call',id:'item1',arguments:'{"name":"fixture"}'};
const events=()=>[
 {type:'response.output_item.added',output_index:0,item:{...item,arguments:''}},
 {type:'response.function_call_arguments.delta',item_id:item.id,output_index:0,delta:item.arguments},
 {type:'response.function_call_arguments.done',item_id:item.id,output_index:0,arguments:item.arguments},
 {type:'response.output_item.done',output_index:0,item},
 {type:'response.completed',response:{status:'completed',output:[item],usage:{input_tokens:10,output_tokens:5}}},
];
const response=(frames:unknown[])=>new Response(frames.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
test('provider sees exact tools while the owned Codex still receives a literal native composer call',async()=>{
 const bridge=new CodexDirectTools([definition],new Set(['exec_command','apply_patch']));
 const wire=bridge.prepare(converted(),true);assert.deepEqual(wire.payload.tools.map((t:any)=>t.name),['read_skill','exec_command','apply_patch']);
 assert(wire.payload.tools.filter((t:any)=>['exec_command','apply_patch'].includes(t.name)).every((t:any)=>/ONE native operation per response/.test(t.description)));
 const raw=await codexResponse(wire.adapt(response(events())),true,{exec:{name:'exec'}}).text();
 const frames=raw.split('\n').filter(s=>s.startsWith('data: ')).map(s=>JSON.parse(s.slice(6)));
 const final=frames.at(-1).response;assert.deepEqual(final.usage,{input_tokens:10,output_tokens:5});
 assert.equal(final.output[0].type,'custom_tool_call');assert.equal(final.output[0].name,'exec');
 assert.equal(final.output[0].input,'text(await tools.mcp__materialsx__read_skill({"name":"fixture"}));');
 const next=converted();next.payload.input=[{type:'function_call',name:'exec',call_id:'owned-call',arguments:JSON.stringify({input:final.output[0].input})} as any];
 const restored=bridge.prepare(next,true).payload.input[0];assert.equal(restored.name,'read_skill');assert.equal(restored.arguments,item.arguments);
 assert.deepEqual(bridge.prepare(converted(),false).payload.tools,[]);
});
test('double-escaped patch separators are rejected before native tool admission',()=>{
 const wire=new CodexDirectTools([],new Set(['apply_patch'])).prepare(converted(),true);
 const patch=(text:string)=>({...item,name:'apply_patch',arguments:JSON.stringify({patch:text})});
 assert.throws(()=>wire.validate(patch('*** Begin Patch\\n*** Add File: a.txt\\n+hello\\n*** End Patch')),/Tool arguments do not match schema/);
 assert.doesNotThrow(()=>wire.validate(patch('*** Begin Patch\n*** Add File: a.txt\n+hello\\nworld\n*** End Patch')));
});
test('direct tool schema rejection never generates an executable program',async()=>{
 const bridge=new CodexDirectTools([definition],new Set());
 const wire=bridge.prepare(converted(),true),frames=events();frames[3]!.item={...item,arguments:'{"name":"fixture","value":"undeclared"}'} as any;
 await assert.rejects(wire.adapt(response(frames)).text(),/Tool arguments do not match schema/);
 const bad=events();bad[3]!.item={...item,name:'foreign_tool'} as any;
 await assert.rejects(wire.adapt(response(bad)).text(),/Unapproved tool/);
});
