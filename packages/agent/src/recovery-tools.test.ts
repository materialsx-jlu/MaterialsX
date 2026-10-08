import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {HostMcp} from './host-mcp.js';import {projectTools} from './project-tools.js';import {harness} from './task-supervisor.fixture.js';
import {ToolExecutionError} from './recovery-failures.js';
test('actual MCP schema rejection executes nothing, returns original field contracts and preserves grant',async()=>{
 const h=harness();h.context.methods.set('research_data',['read']);h.control.acceptPlan(h.plan);let executed=0;
 const mcp=new HostMcp({files:[],skills:[]},undefined,{signal:new AbortController().signal,permissions:h.context.grant.permissions,tools:[{name:'research_data',description:'Fixture reader',parameters:{type:'object',properties:{ownedId:{type:'string'},count:{type:'integer'}},required:['ownedId','count'],additionalProperties:false},permissions:['read'],execute:async()=>{executed++;return {content:[{type:'text',text:'real source'}]};}}]},h.control);
 const client=new Client({name:'ap4',version:'1'});
 try{await mcp.start();await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url),{requestInit:{headers:{Authorization:'Bearer '+mcp.token}}}) as Transport);
  const response=await client.callTool({name:'invoke_material_tool',arguments:{name:'research_data',arguments:{count:'bad',value:'not-an-id'}}});assert(response.isError);
  const value=JSON.parse((response.content as any)[0].text);assert.equal(value.recovery.kind,'arguments');assert.equal(value.recovery.phase,'rejected');assert(value.recovery.issues.some((i:any)=>i.path==='ownedId'));
  assert.equal(executed,0);assert.equal(h.control.snapshot().attempts.length,0);
  await client.callTool({name:'invoke_material_tool',arguments:{name:'research_data',arguments:{ownedId:'approved-fixture',count:1}}});assert.equal(executed,1);assert.equal(h.control.snapshot().attempts[0]?.state,'completed');
  for(let i=0;i<2;i++){const invalid=await client.callTool({name:'invoke_material_tool',arguments:{name:'research_data',arguments:{count:'bad'}}});assert(invalid.isError);}
  assert.equal(h.control.snapshot().state,'blocked');assert.equal(h.control.snapshot().recovery?.total,2);assert.equal(executed,1);
  assert.throws(()=>h.control.beforeRequest({input:[],tools:[]},'execute',131072,128),/Recovery budget exhausted/);
 }finally{await client.close();await mcp.close();}
});
test('real sandboxed failed script can be inspected, patched and rerun, with actual exit codes and verified output hashes',{skip:process.platform!=='darwin'},async()=>{
 const root=await mkdtemp(join(tmpdir(),'mx-ap4-script-'));const h=harness({root}),signal=new AbortController().signal;
 try{await writeFile(join(root,'run.sh'),'#!/bin/sh\nprintf "actual stderr\\n" >&2\nexit 7\n');
  h.plan.steps[0]!.expectedArtifacts=['report.json'];h.plan.acceptance.requiredArtifacts=['report.json'];h.control.acceptPlan(h.plan);
  const definitions=await projectTools(root,join(root,'.tool-home'));for(const t of definitions)h.context.methods.set(t.name,t.permissions);
  const bash=definitions.find(t=>t.name==='bash')!,read=definitions.find(t=>t.name==='read')!,write=definitions.find(t=>t.name==='write')!;
  const invoke=async(id:string,t:typeof bash,args:any)=>{h.control.beforeTool({id,name:t.name,args,permissions:t.permissions});try{const result=await t.execute(args,signal);h.control.afterTool(id,result,(result as any).isError===true);return result;}catch(error){if(!(error instanceof ToolExecutionError))throw error;h.control.afterTool(id,{...error.receipt,recovery:error.recovery},true);return error.receipt;}};
  await invoke('failed',bash,{command:'sh run.sh'});assert.equal(h.control.snapshot().attempts[0]?.nativeReceipt?.exitCode,7);assert.equal(h.control.snapshot().attempts[0]?.failure?.kind,'script');
  assert.throws(()=>h.control.beforeTool({id:'repeat',name:'bash',args:{command:'sh run.sh'},permissions:bash.permissions}),/Identical failed command/);
  const source=await invoke('inspect',read,{path:'run.sh'});assert.match(JSON.stringify(source),/exit 7/);
  await invoke('repair',write,{path:'run.sh',content:'#!/bin/sh\nprintf \'{"value":7,"scientificStatus":"needs_review"}\\n\' > report.json\n'});
  await invoke('verified-run',bash,{command:'sh run.sh'});await invoke('read-back',read,{path:'report.json'});
  await h.control.command({action:'complete',stepId:'execute',receiptIds:['inspect','repair','verified-run','read-back']});
  const state=h.control.snapshot();assert.equal(state.attempts.find(a=>a.id==='verified-run')?.nativeReceipt?.exitCode,0);assert.equal(state.steps[0]?.state,'completed');assert.match(state.steps[0]?.artifacts?.[0]?.sha256??'',/^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(await readFile(join(root,'report.json'),'utf8')).value,7);assert.match(h.control.summary(),/inspect-script/);
  // The actual SDK receipt must retain environment classification, not override it with generic script failure.
  await assert.rejects(bash.execute({command:'printf "ModuleNotFoundError: No module named fixture_only\\n" >&2; exit 1'},signal),(e:any)=>e instanceof ToolExecutionError&&e.recovery?.kind==='environment'&&JSON.stringify(e.receipt).includes('fixture_only'));
 }finally{await rm(root,{recursive:true,force:true});}
});
