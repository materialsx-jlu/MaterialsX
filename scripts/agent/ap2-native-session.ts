import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CodexEngine} from '../../packages/agent/src/codex-engine.js';
import {TaskSupervisor} from '../../packages/agent/src/task-supervisor.js';
import {directPlan} from '../../packages/agent/src/research-planning.js';
import {composerResponse} from '../../fixtures/agent/composer-response.js';
import {taskRefSchema,permissionGrantSchema} from '../../packages/contracts/src/agent.js';
const dir=await mkdtemp(join(tmpdir(),'mx-ap2-session-')),project=join(dir,'project');await mkdir(project);
const task=taskRefSchema.parse({taskId:randomUUID(),projectId:randomUUID(),conversationId:randomUUID()});
const grant=permissionGrantSchema.parse({grantId:randomUUID(),projectId:task.projectId,conversationId:task.conversationId,permissions:['read','search','terminal','patch'],approvedBy:'local-user',maxCredits:null,maxSeconds:45});
const results=new Map<string,unknown>();
let round=0;const started=Date.now();
const engine:CodexEngine=new CodexEngine({home:join(dir,'home'),maxOutput:512,contextWindow:131072,invoke:async()=>{
 round++;assert(round<=8);const state=control.snapshot();
 const session=state.attempts.flatMap(a=>a.jobs).filter(j=>j.id.startsWith('native-session:')).at(-1);
 const code=round===1?`text(await tools.exec_command(${JSON.stringify({cmd:'python3 session_probe.py',login:false,yield_time_ms:1,max_output_tokens:100})}));`:session?.state==='running'?`text(await tools.write_stdin(${JSON.stringify({session_id:Number(session.id.split(':')[1]),yield_time_ms:10000,max_output_tokens:100})}));`:null;
 return composerResponse(round,code);
}});
const context={task,grant,methods:engine.capabilities.tools};
const control:TaskSupervisor=new TaskSupervisor({context,engine:'codex',connectionId:'fixture',accountRef:'local',projectPath:project,persist:()=>{},savePlan:()=>{},saveResult:(h,v)=>{results.set(h,v);return h;},readResult:h=>results.get(h)});
control.acceptPlan(directPlan('输出 session.json',context));
await writeFile(join(project,'session_probe.py'),"import json,time\nfrom pathlib import Path\ntime.sleep(2)\nPath('session.json').write_text(json.dumps({'status':'actual-finished','value':42}))\n");
try{
 await engine.run({task,grant,projectPath:project,content:'执行项目内 session_probe.py，等待原会话结束，交付 session.json。',control,onEvent:()=>{}});
 control.finish('completed_with_limitations');const state=control.snapshot();
 assert.equal(state.state,'completed_with_limitations');assert.equal(JSON.parse(await readFile(join(project,'session.json'),'utf8')).value,42);
 assert(state.attempts.some(a=>a.method==='exec_command'&&a.nativeReceipt?.sessionId!=null));
 assert(state.attempts.some(a=>a.method==='write_stdin'&&a.nativeReceipt?.exitCode===0));assert.equal(state.steps[0]?.artifacts?.length,1);
 const report={stage:'AP.2',passed:true,realCodexAppServer:true,scriptedProvider:true,modelIntelligenceValidated:false,externalModelCalls:0,rounds:round,elapsedMs:Date.now()-started,attempts:state.attempts.map(a=>({method:a.method,state:a.state,nativeReceipt:a.nativeReceipt,jobs:a.jobs})),artifacts:state.steps[0]?.artifacts};
 await mkdir(resolve('runtime/agent/ap-2'),{recursive:true});await writeFile(resolve('runtime/agent/ap-2/native-session.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}finally{await engine.dispose();await rm(dir,{recursive:true,force:true});}
