import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {harness} from './task-supervisor.fixture.js';
import {hostRouter} from './host-tool-router.js';
import {withLocalResponseRecovery} from './model-recovery.js';
import {HostMcp} from './host-mcp.js';

const schema={type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false};
test('an empty cloud bridge advertises only actual grant permissions, not default search rights',()=>{
 const h=harness();h.plan.constraints.permissions=['read'];h.plan.steps[0]!.permissions=['read'];h.control.acceptPlan(h.plan);
 const mcp=new HostMcp({files:[],skills:[]},undefined,{tools:[],permissions:['read'],signal:new AbortController().signal},h.control);
 assert(!mcp.toolNames.includes('find_tools'));assert(!mcp.permissionMap.has('find_tools'));
 assert(!mcp.toolNames.includes('read_material_file'));assert(!mcp.toolNames.includes('read_skill'));
 const selected=new HostMcp({files:[{id:'f',name:'f.txt',text:'approved',sha256:'a'.repeat(64)}],skills:[]},undefined,{tools:[],permissions:['read'],signal:new AbortController().signal},h.control);
 assert(selected.toolNames.includes('read_material_file'));assert(!selected.toolNames.includes('find_tools'));
});
test('real dispatcher completes a unique read prerequisite and admits its dependent without administrative tools',async()=>{
 const h=harness();h.plan.executionMode='planned';h.plan.adjustmentRules=[];
 h.plan.steps=[{...h.plan.steps[0]!,id:'read-source' as any,method:'research_data',permissions:['read']},{...h.plan.steps[0]!,id:'consume' as any,dependsOn:['read-source' as any],method:'research_delivery',permissions:['read'],expectedArtifacts:[]}];
 h.context.methods.set('research_data',['read']);h.context.methods.set('research_delivery',['read']);h.control.acceptPlan(h.plan);let calls=0;
 const tools=hostRouter(['research_data','research_delivery'].map(name=>({name,description:name,parameters:schema,permissions:['read'] as const,execute:async(args:any)=>{calls++;return {content:[{type:'text' as const,text:JSON.stringify({actual:args.id})}]};}})),['read','search'],h.control);
 const invoke=tools.find(t=>t.name==='invoke_material_tool')!;
 await invoke.execute({name:'research_data',arguments:{id:'real-source'}},new AbortController().signal);
 assert.equal(h.control.snapshot().steps[0]?.state,'completed');
 await invoke.execute({name:'research_delivery',arguments:{id:'same-source'}},new AbortController().signal);
 assert.equal(h.control.snapshot().attempts[1]?.stepId,'consume');assert.equal(calls,2);
 assert(h.events.filter(e=>e.type==='step').every(e=>e.state!=='selected'));
 assert.equal(h.control.snapshot().steps[1]?.state,'running','unpublished arbitrary output is not automatic acceptance');
});
test('ambiguous steps never choose the first array element; explicit host selection needs no revision copy',async()=>{
 const h=harness();h.plan.executionMode='planned';h.plan.adjustmentRules=[];
 h.plan.steps=['left','right'].map(id=>({...h.plan.steps[0]!,id:id as any,method:'read',permissions:['read']}));h.control.acceptPlan(h.plan);
 assert.throws(()=>h.control.beforeTool(h.tool('ambiguous','read')),/STEP_SELECTION_REQUIRED/);assert.equal(h.control.snapshot().attempts.length,0);
 await h.control.command({action:'begin',stepId:'right'});h.control.beforeTool(h.tool('chosen','read'));h.control.afterTool('chosen',{source:'right'},false);
 await h.control.verifyBackendSteps();assert.equal(h.control.snapshot().steps[1]?.state,'completed');assert.equal(h.control.snapshot().steps[0]?.state,'pending');
 await assert.rejects(h.control.command({action:'begin',stepId:'left',expectedRevision:9}),/版本/);
});
test('native session polling uses actual owned IDs, preserves truncation and cannot complete before exit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mx-ap2-native-'));try{
  const h=harness({root:dir});h.context.methods.set('exec_command',['terminal']);h.context.methods.set('write_stdin',['terminal']);h.plan.steps[0]!.expectedArtifacts=['out.json'];h.control.acceptPlan(h.plan);
  h.control.beforeTool({id:'start',name:'exec_command',args:{cmd:'long task'},permissions:['terminal']});await writeFile(join(dir,'out.json'),'{}');
  h.control.afterTool('start',[{type:'input_text',text:JSON.stringify({session_id:73,output:'partial',original_token_count:9000,truncated:true})}],false);
  assert.equal(h.control.snapshot().attempts[0]?.nativeReceipt?.truncated,true);assert.deepEqual(await h.control.verifyBackendSteps(),[]);
  assert.throws(()=>h.control.beforeTool({id:'foreign',name:'write_stdin',args:{session_id:74},permissions:['terminal']}),/not owned/);
  assert.throws(()=>h.control.beforeTool({id:'submit-again',name:'exec_command',args:{cmd:'another'},permissions:['terminal']}),/在途/);
  h.control.beforeTool({id:'poll',name:'write_stdin',args:{session_id:73},permissions:['terminal']});h.control.afterTool('poll',{exit_code:0,output:'real done'},false);
  assert.deepEqual(await h.control.verifyBackendSteps(),['execute']);assert.equal(h.control.snapshot().steps[0]?.artifacts?.[0]?.name,'out.json');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('nonzero native exits, unknown status and altered accepted bytes cannot be reported complete',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mx-ap2-receipts-'));try{
  for(const value of [{exit_code:2,output:'failure'},{output:'claimed success'}]){
   const h=harness({root:dir});h.context.methods.set('exec_command',['terminal']);h.plan.steps[0]!.expectedArtifacts=['out.json'];h.control.acceptPlan(h.plan);await writeFile(join(dir,'out.json'),'{}');
   h.control.beforeTool({id:'run',name:'exec_command',args:{cmd:'example'},permissions:['terminal']});h.control.afterTool('run',value,false);
   assert.equal(h.control.snapshot().attempts[0]?.state,'exit_code' in value?'failed':'unknown');assert.deepEqual(await h.control.verifyBackendSteps(),[]);
   h.control.finish('completed_with_limitations');assert.equal(h.control.snapshot().state,'blocked');
  }
  const h=harness({root:dir});h.plan.steps[0]!.expectedArtifacts=['out.json'];h.control.acceptPlan(h.plan);
  h.control.beforeTool(h.tool('write','write'));h.control.afterTool('write',{written:true},false);await h.control.verifyBackendSteps();
  const artifact=h.control.snapshot().steps[0]!.artifacts![0]!;await writeFile(join(dir,'out.json'),'changed');
  await assert.rejects(h.control.verifyBackendSteps(),/Verified artifact changed/);assert.equal(h.control.snapshot().steps[0]!.artifacts![0]!.sha256,artifact.sha256);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('identical call IDs cache reads too; changed arguments or a contradictory terminal cannot overwrite receipts',()=>{
 const h=harness();h.control.acceptPlan(h.plan);const call=h.tool('owned','read',{path:'one'});h.control.beforeTool(call);h.control.afterTool('owned',{data:1},false);
 assert.deepEqual(h.control.beforeTool(call),{data:1});assert.equal(h.control.snapshot().attempts.length,1);
 assert.throws(()=>h.control.beforeTool({...call,args:{path:'two'}}),/不同输入/);assert.throws(()=>h.control.afterTool('owned',{data:1},true),/终态/);
});

test('early file acceptance does not reject native readback; the original step, receipts, grant and deadline are reused',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mx-ap6-readback-'));try{
  const h=harness({root:dir});h.context.methods.set('exec_command',['terminal']);h.plan.steps[0]!.expectedArtifacts=['out.json'];h.control.acceptPlan(h.plan);
  const before=h.control.snapshot();const call={id:'write-file',name:'exec_command',args:{cmd:'generate out.json'},permissions:['terminal'] as const};
  h.control.beforeTool(call);await writeFile(join(dir,'out.json'),'{"verified":true}');h.control.afterTool(call.id,{exit_code:0,output:'written'},false);
  await h.control.verifyBackendSteps();assert.equal(h.control.snapshot().steps[0]!.state,'completed');
  const originalProof=h.control.snapshot().steps[0]!.artifacts![0]!.sha256;
  assert.deepEqual(h.control.beforeTool({...call,id:'same-operation'}),{exit_code:0,output:'written'},'a duplicate write is not executed again');
  h.control.beforeTool({id:'readback',name:'exec_command',args:{cmd:'cat out.json'},permissions:['terminal']});
  h.control.afterTool('readback',{exit_code:0,output:'{"verified":true}'},false);await h.control.verifyBackendSteps();
  const after=h.control.snapshot();assert.equal(after.attempts.length,2);assert.equal(after.attempts[1]!.stepId,'execute');
  assert.deepEqual(after.grant,before.grant);assert.equal(after.deadline,before.deadline);assert.equal(after.planRevision,before.planRevision);
  assert.equal(after.steps[0]!.artifacts![0]!.sha256,originalProof);assert.equal(after.steps[0]!.state,'completed');
  assert.throws(()=>h.control.beforeTool(h.tool('new-science','materials_science')),/actual task_control candidate/);
  h.control.finish('completed_with_limitations');assert.equal(h.control.snapshot().state,'completed_with_limitations');
  assert.throws(()=>h.control.beforeTool(h.tool('after-finish','read')),(error:any)=>error.code==='CONFLICT');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a completed dependency graph cannot reopen a completed file step for post-acceptance commands',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mx-ap6-closed-graph-'));try{
  const h=harness({root:dir});h.plan.executionMode='planned';h.plan.steps[0]!.expectedArtifacts=['out.json'];h.context.methods.set('exec_command',['terminal']);h.control.acceptPlan(h.plan);
  h.control.beforeTool(h.tool('write','write'));await writeFile(join(dir,'out.json'),'{}');h.control.afterTool('write',{written:true},false);await h.control.verifyBackendSteps();
  assert.throws(()=>h.control.beforeTool({id:'later',name:'exec_command',args:{cmd:'cat out.json'},permissions:['terminal']}),/actual task_control candidate/);
  assert.equal(h.control.snapshot().attempts.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('free research cannot finish from narrative alone; missing artifacts preserve successful writes during bounded continuation',async()=>{
 const h=harness();h.plan.executionMode='planned';h.control.acceptPlan(h.plan);h.control.finish('completed_with_limitations');assert.equal(h.control.snapshot().state,'blocked');
 const dir=await mkdtemp(join(tmpdir(),'mx-ap2-continuation-'));try{
  const h=harness({root:dir});h.plan.steps[0]!.expectedArtifacts=['real.json'];h.control.acceptPlan(h.plan);let rounds=0;
  await withLocalResponseRecovery(async correction=>{rounds++;if(!correction){h.control.beforeTool(h.tool('write-once','write'));h.control.afterTool('write-once',{written:true},false);}else await writeFile(join(dir,'real.json'),'{}');return 'done';},h.control);
  assert.equal(rounds,2);assert.equal(h.control.snapshot().attempts.length,1);assert.equal(h.control.snapshot().steps[0]?.state,'completed');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('one-method admission preserves the user contract and binds mandatory science outputs without fabricated goal JSON',async()=>{
 const h=harness();h.plan.planningStage='exploration';h.plan.originalRequest='输出 energy.json，目标 95%';
 h.plan.goal={materialSystem:'Si',problemType:h.plan.originalRequest,metrics:[{name:'反射率',value:95,unit:'%',condition:null,priority:1,origin:'user'}],priorities:['反射率']};
 h.plan.cognition.facts=[{text:'未验证的参考信息',confirmed:false,evidence:[]}];h.plan.constraints.process=['不下载'];h.plan.constraints.dataSources=['公开结构'];
 h.plan.steps[0]!.expectedArtifacts=['energy.json'];h.plan.acceptance.requiredArtifacts=['energy.json'];h.control.acceptPlan(h.plan);
 await assert.rejects(h.control.command({action:'plan',method:'not-a-tool'}),/Unknown registered/);
 await assert.rejects(h.control.command({action:'plan',method:'materials_science',proposal:{}}),/not both/);
 await h.control.command({action:'plan',method:'materials_science'});
 const plan=h.control.plan()!;assert.deepEqual(plan.goal,h.plan.goal);assert.deepEqual(plan.cognition,h.plan.cognition);
 assert.deepEqual(plan.constraints,h.plan.constraints);assert.deepEqual(plan.inputVersionRefs,h.plan.inputVersionRefs);
 assert.deepEqual(plan.acceptance.requiredArtifacts,['JSON','报告','3D结构','energy.json']);assert.deepEqual(plan.steps[0]!.expectedArtifacts,plan.acceptance.requiredArtifacts);
 assert.equal(h.control.snapshot().attempts.length,0);assert.equal(h.control.snapshot().requests.length,0);
});
test('owned pending calculations expose valid exact polling parameters rather than encouraging resubmission',async()=>{
 const h=harness();h.plan.planningStage='exploration';h.control.acceptPlan(h.plan);await h.control.command({action:'plan',method:'materials_science'});
 const args={action:'singlepoint',targetId:'assessment-a',secondaryId:null,potentialId:'installed-si',domain:'inorganic-crystals',mode:'exploratory',evidenceIds:[]};
 h.control.beforeTool(h.tool('science','materials_science',args));h.control.afterTool('science',{runId:'owned-run',status:'running'},false);
 const hints=JSON.parse(h.control.summary()).execution.pendingJobs;assert.equal(hints[0].nextCall.arguments.targetId,'owned-run');assert.equal(hints[0].nextCall.arguments.action,'get');
 assert.equal(hints[0].nextCall.arguments.potentialId,null);assert.deepEqual(await h.control.verifyBackendSteps(),[]);
 assert.throws(()=>h.control.beforeTool(h.tool('new-science','materials_science',{...args,targetId:'different-assessment'})),/owned-run/);
});
test('concurrent plan revision or cancellation cannot accept artifacts verified for an obsolete step',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mx-ap2-race-'));try{
  await writeFile(join(dir,'out.json'),'{}');
  for(const mutation of ['revise','cancel']){
   let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
   const h=harness({root:dir,resolveArtifact:async()=>{entered();await waiting;return 'out.json';}});h.plan.steps[0]!.expectedArtifacts=['out.json'];h.control.acceptPlan(h.plan);
   h.control.beforeTool(h.tool('write','write'));h.control.afterTool('write',{written:true},false);
   const verifying=h.control.verifyBackendSteps();await started;
   if(mutation==='cancel')h.control.finish('cancelled');else{const next=structuredClone(h.plan);next.planRevision++;next.goalRevision++;next.steps[0]!.completionCriteria.push('New verification');h.control.revise(next,1,'user');}
   release();await assert.rejects(verifying,(error:any)=>['CONFLICT','CANCELLED'].includes(error.code));
   assert.notEqual(h.control.snapshot().steps[0]?.state,'completed');assert.equal(h.control.snapshot().steps[0]?.artifacts,undefined);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('workflow queries never substitute a child calculation ID for its owned workflow ID',async()=>{
 const h=harness();h.plan.planningStage='exploration';h.control.acceptPlan(h.plan);await h.control.command({action:'plan',method:'materials_science'});
 const args={action:'auto_get',targetId:'owned-workflow',secondaryId:null,potentialId:null,domain:'inorganic-crystals',mode:'exploratory',evidenceIds:[]};
 h.control.beforeTool(h.tool('workflow','materials_science',args));h.control.afterTool('workflow',{workflowId:'owned-workflow',runId:'child-run',state:'running'},false);
 const hints=JSON.parse(h.control.summary()).execution.pendingJobs;
 assert.equal(hints.find((j:any)=>j.jobId==='owned-workflow').nextCall.arguments.targetId,'owned-workflow');
 assert.equal(hints.find((j:any)=>j.jobId==='child-run').nextCall,undefined);
});
