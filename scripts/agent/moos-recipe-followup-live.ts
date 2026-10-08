/** Opt-in replay of a failed recipe follow-up in an isolated copy, including native history. */
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,mkdir,cp,chmod,writeFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {WorkspaceStore} from '../../apps/desktop/main/store.js';
import {ResearchService} from '../../apps/desktop/main/research-service.js';
import {DesktopAgentRuntime} from '../../apps/desktop/main/agent-runtime.js';
import {recipeSnapshots} from '../../apps/desktop/main/research-recipe-view.js';
import {recipeProposalFollowup} from '../../packages/agent/src/research-intent.js';
import {PiLocalSessionService} from '../../packages/pi-adapter/src/local-session.js';
const root=process.cwd(),userData=process.env.MATERIALSX_REPLAY_USER_DATA??join(homedir(),'Library/Application Support/MaterialsX');
const dir=await mkdtemp(join(tmpdir(),'mx-recipe-followup-'));await chmod(dir,0o700);
const database=new DatabaseSync(join(userData,'materialsx.sqlite'),{readOnly:true});
const states=database.prepare("SELECT value FROM app_meta WHERE key LIKE 'task_execution:%' ORDER BY json_extract(value,'$.startedAt') DESC").all().map(r=>JSON.parse(String(r.value)));
const previous=states.find(s=>s.state==='failed'&&recipeProposalFollowup(JSON.parse(String(database.prepare('SELECT value FROM app_meta WHERE key=?').get('research_plan:'+s.task.taskId)?.value??'{}')).originalRequest??''));
assert(previous,'No failed recipe follow-up is available to replay');
await backup(database,join(dir,'state.sqlite'));database.close();
const projectPath=join(dir,'project');await mkdir(projectPath);
const copy=new DatabaseSync(join(dir,'state.sqlite'));copy.prepare('UPDATE projects SET path=? WHERE id=?').run(projectPath,previous.task.projectId);copy.close();
const history=join('codex','local',previous.task.conversationId,previous.connectionId);
await cp(join(userData,history),join(dir,history),{recursive:true});
// Relocate only the copied native thread index. Never let a replay open/write the live home.
const nativeIndex=new DatabaseSync(join(dir,history,'state_5.sqlite'));
for(const row of nativeIndex.prepare('SELECT id,rollout_path FROM threads').all()){
 const path=String(row.rollout_path);assert(path.startsWith(join(userData,history)+'/'));
 nativeIndex.prepare('UPDATE threads SET rollout_path=?,cwd=? WHERE id=?').run(join(dir,history,path.slice(join(userData,history).length+1)),projectPath,String(row.id));
}nativeIndex.close();
const store=new WorkspaceStore(join(dir,'state.sqlite'));
const service=new ResearchService(store,{directory:process.env.MATERIALSX_MOOS_MCP_DIRECTORY??resolve(root,'../MOOS/services/materials-mcp'),origin:'http://127.0.0.1:8080',assetRoot:root,jobStateRoot:join(dir,'jobs')});
const pi=new PiLocalSessionService(root,dir,(_path,id)=>service.tools(previous.task.projectId,id));
const runtime=new DesktopAgentRuntime(store,pi,{} as any,dir,{projectRoot:root},undefined,service);
const request='基于上述配方，生成你建议的配方工艺',run=store.addRun(previous.task.projectId,request,'running'),started=Date.now();
const output=join(root,'runtime/agent/moos-setup');await mkdir(output,{recursive:true});
const timer=setTimeout(()=>{void runtime.cancel(previous.task.conversationId);},480000);
try{
 const result=await runtime.run(run.id,previous.task.projectId,previous.task.conversationId,projectPath,{mode:'local',modelId:'openai/gpt-oss-20b',localEndpoint:'http://localhost:1234/v1',localProtocol:'chat-completions',agentEngine:'codex',localMaxOutputTokens:16384},request,()=>{});
 const state=store.agentJournal.read(run.id)!,plan=store.researchPlan(run.id)!,sources=recipeSnapshots(store,run.id);
 assert.equal(plan.executionMode,'direct');assert.equal(state.state,'completed_with_limitations');assert.equal(service.deliveryIssue(run.id),null);
 assert.equal(sources.length,3);assert(state.attempts.some(a=>a.method==='research_data'&&store.agentJournal.readResult(run.id,a.inputRef!).args.action==='read_current_recipes'));
 assert(state.attempts.some(a=>a.method==='recipe_proposal'&&a.state==='completed'));assert.match(result,/来源原值/);assert.match(result,/建议用量（待验证）/);
 assert.match(result,/配方|组分/);assert.match(result,/工艺|制备/);assert.match(result,/建议|候选|假设/);assert.match(result,/验证|待复核|未.*验证/);assert.match(result,/PDF|页码|p\.\s*2|第\s*2\s*页|第\s*二\s*页|p\.?\s*2|页\s*2/);
 const report={passed:true,engine:'codex',model:'openai/gpt-oss-20b',request,copiedNativeHistory:true,elapsedMs:Date.now()-started,state:state.state,requests:state.requests.length,sourceMutations:0,cloudCalls:0,tools:state.attempts.map(a=>({method:a.method,args:store.agentJournal.readResult(run.id,a.inputRef!).args,state:a.state})),sources:sources.map(s=>({title:s.title,sha256:s.sha256,reviewStatus:s.reviewStatus})),result};
 await writeFile(join(output,'codex-recipe-followup-live.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({...report,result:undefined}));
}catch(error){await writeFile(join(output,'codex-recipe-followup-failure.json'),JSON.stringify({error:String(error),journal:store.agentJournal.read(run.id),plan:store.researchPlan(run.id)},null,2)+'\n',{mode:0o600});throw error;}
finally{clearTimeout(timer);await runtime.dispose();pi.dispose();await service.close();store.close();await rm(dir,{recursive:true,force:true});}
