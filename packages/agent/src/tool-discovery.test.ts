import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoverTools,rankedTools,capabilityState,initialToolNames} from './tool-discovery.js';
import {hostRouter} from './host-tool-router.js';
import {capabilityContext} from './capability-awareness.js';
import {applicationCapabilities} from '../../../apps/desktop/main/application-capabilities.js';
import {harness} from './task-supervisor.fixture.js';
import type {HostTool} from './host-mcp.js';
const schema={type:'object',properties:{actualId:{type:'string',description:'Use the actual ID'},limit:{type:'integer',default:3}},required:['actualId'],additionalProperties:false};
const tools:HostTool[]=['paper_search','research_data','materials_science','exec_command','research_method_run'].map(name=>({name,description:'Actual registry description',parameters:schema,
 permissions:name==='exec_command'?['terminal']:['search'],execute:async()=>({content:[{type:'text',text:'Actual result'}]})}));
test('Chinese and English research purposes rank actual relevant tools; unknown topics never execute a guess',()=>{
 for(const [q,name] of [['查论文','paper_search'],['search literature','paper_search'],['找水性涂料配方','research_data'],['find waterborne coating recipes','research_data'],
  ['修 Python','exec_command'],['fix a Python script','exec_command'],['计算结构能量','materials_science'],['calculate atomic energy','materials_science']] as const){
  const found=rankedTools(tools,q);assert.equal(found[0]?.value.name,name,q);assert(found.length<=tools.length);
 }
 assert.deepEqual(discoverTools(tools,['search','terminal'],'quux-no-such-topic').tools,[]);
 assert.deepEqual(discoverTools(tools,['search'],'查论文').tools.map(t=>t.name),['paper_search']);
});
test('exact name returns only its original schema, while summaries stay bounded and carry bilingual examples',()=>{
 const exact=discoverTools(tools,['search'],'research_data',null,true);assert.equal(exact.tools.length,1);assert.equal('parameters' in exact.tools[0]!&&exact.tools[0]!.parameters,schema);assert.equal(exact.partial,false);
 const summary=discoverTools(tools,['search'],'找配方');assert(!('parameters' in summary.tools[0]!));assert(summary.tools[0]!.examples?.zh);assert(summary.tools[0]!.examples?.en);assert.equal(summary.executionAuthority,false);
});
test('denied, unconfigured, uninstalled, missing and unverified states stay distinct without exposing denied schemas',()=>{
 const h=harness({capabilityFacts:()=>applicationCapabilities([{name:'not-installed',enabled:true,installed:false}],[],false,true)});
 for(const t of tools)h.context.methods.set(t.name,t.permissions);h.context.methods.set('paper_fetch',['network']);h.control.acceptPlan(h.plan);
 const snap=h.control.capabilities();const found=discoverTools([...tools,{...tools[0]!,name:'paper_fetch',permissions:['network']}],h.context.grant.permissions,'paper_fetch',snap,true);
 assert.equal(found.tools.length,0);assert(found.unavailable.some(f=>f.state==='not-authorized'));assert(!JSON.stringify(found).includes('actualId'));
 const moos=discoverTools(tools,h.context.grant.permissions,'research_data',snap,true);assert.equal(moos.tools[0]!.state,'not-configured');
 assert.equal(capabilityState(snap!.facts.find(f=>f.id==='skill:not-installed')),'not-installed');
 assert.equal(capabilityState({...snap!.facts[0]!,registered:false}),'not-found');assert.equal(capabilityState(undefined),'unverified');
});
test('discovery and invocation reuse the original grant, schema and receipts; neither unknown nor malformed tools execute',async()=>{
 const h=harness();h.plan.originalRequest='查论文';let calls=0;
 const tool={...tools[0]!,execute:async()=>{calls++;return {content:[{type:'text' as const,text:'Real fixture result'}]};}};
 h.context.methods.set(tool.name,tool.permissions);h.control.acceptPlan(h.plan);
 const routed=hostRouter([tool,{...tool,name:'denied',permissions:['network']}],h.context.grant.permissions,h.control);
 const find=routed.find(t=>t.name==='find_tools')!,invoke=routed.find(t=>t.name==='invoke_material_tool')!,signal=new AbortController().signal;
 const result=await find.execute({query:'查论文',includeSchema:true},signal);assert.equal(JSON.parse(result.content[0]!.text).tools[0].name,'paper_search');assert.equal(calls,0);
 await assert.rejects(invoke.execute({name:'denied',arguments:{}},signal),/NOT_APPROVED/);
 await assert.rejects(invoke.execute({name:tool.name,arguments:{inventedId:'x'}},signal));assert.equal(calls,0);
 await invoke.execute({name:tool.name,arguments:{actualId:'owned'}},signal);assert.equal(calls,1);assert.equal(h.control.snapshot().attempts[0]?.method,tool.name);
});
test('catalog growth leaves initial tools and capability projections bounded, with the installation fact always present',()=>{
 const h=harness({capabilityFacts:()=>applicationCapabilities([],[],false,true)});
 const large=[...tools,...Array.from({length:1000},(_,i)=>({...tools[0]!,name:'unrelated_'+i,description:'irrelevant'}))];
 for(const t of tools)h.context.methods.set(t.name,t.permissions);h.plan.originalRequest='查论文';h.control.acceptPlan(h.plan);
 const routed=hostRouter(large,h.context.grant.permissions,h.control);assert(routed.length<=10);const found=discoverTools(large,h.context.grant.permissions,'查论文');assert(found.tools.length<=8);assert(JSON.stringify(found).length<15000);
 const projection=capabilityContext(h.control.capabilities(),'查论文')!;assert(projection.facts.length<=16);assert(projection.toolAuthorization.length<=16);assert(projection.facts.some(f=>f.id==='host:skill.install'));
});

test('many future plan methods do not become permanently exposed initial schemas',()=>{
 const methods=Array.from({length:100},(_,i)=>'future_'+i);const initial=initialToolNames(tools,'查论文',methods);assert(initial.size<=11);assert(initial.has('future_0'));assert(!initial.has('future_99'));
 assert.equal(discoverTools(tools,['search'],'missing-adapter').outcome,'not-found');
});
test('domain-specific reads still discover the real selected-file reader without exposing absent readers',()=>{
 const reader={...tools[0]!,name:'read_material_file',description:'Read approved selected file',permissions:['read'] as const};
 for(const query of ['read approved project input files recipe source','读取水性涂料配方附件']){
  assert(rankedTools([...tools,reader],query).some(r=>r.value.name===reader.name));
  assert(initialToolNames([...tools,reader],query).has(reader.name));
 }
 assert(!initialToolNames(tools,'找配方').has(reader.name));
 assert.equal(discoverTools([...tools,reader],['search'],'read_material_file',null,true).tools.length,0);
 assert(!rankedTools([reader],'find waterborne recipes').length);
});
