/** Opt-in local-model / real-MOOS regression; isolated workspace, read-only upstream. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {WorkspaceStore} from '../../apps/desktop/main/store.js';
import {ResearchService} from '../../apps/desktop/main/research-service.js';
import {DesktopAgentRuntime} from '../../apps/desktop/main/agent-runtime.js';
import {recipeSnapshots} from '../../apps/desktop/main/research-recipe-view.js';
import {PiLocalSessionService} from '../../packages/pi-adapter/src/local-session.js';
const root=process.cwd(),dir=await mkdtemp(join(tmpdir(),'mx-moos-recipes-live-')),projectPath=join(dir,'project');await mkdir(projectPath);
const store=new WorkspaceStore(join(dir,'state.sqlite')),project=store.createProject(projectPath),conversation=store.createConversation(project.id);
const service=new ResearchService(store,{directory:process.env.MATERIALSX_MOOS_MCP_DIRECTORY??resolve(root,'../MOOS/services/materials-mcp'),origin:process.env.MATERIALSX_MOOS_API_ORIGIN??'http://127.0.0.1:8080',assetRoot:root,jobStateRoot:join(dir,'jobs')});
const pi=new PiLocalSessionService(root,dir,(_path,id)=>service.tools(project.id,id));
const runtime=new DesktopAgentRuntime(store,pi,{} as any,dir,{projectRoot:root},undefined,service);
const request='搜索 MOOS 中的水性辐射制冷涂料配方，允许本次读取待复核记录，列出组分、原始用量、制备步骤及证据页码。并最终形成 3个实验配方';
const output=join(root,'runtime/agent/moos-setup');await mkdir(output,{recursive:true});
let timer:ReturnType<typeof setTimeout>|undefined,taskId='';
try{
 // Preselect actual current records to reproduce the project-cache path, not just a fresh search.
 const candidates=await service.router.search(project.id,null,{query:'水性辐射制冷涂料',reviewScope:'include-unreviewed',source:'moos'});assert(candidates.items.length>=2);
 for(const item of candidates.items.slice(0,2))await service.select(project.id,item.ref);
 const run=store.addRun(project.id,request,'running');taskId=run.id;const started=Date.now();timer=setTimeout(()=>{void runtime.cancel(conversation.id);},480000);
 const result=await runtime.run(taskId,project.id,conversation.id,projectPath,{mode:'local',modelId:'openai/gpt-oss-20b',localEndpoint:'http://localhost:1234/v1',localProtocol:'chat-completions',agentEngine:'codex',localMaxOutputTokens:16384},request,()=>{});
 const plan=store.researchPlan(taskId)!,state=store.agentJournal.read(taskId)!,sources=recipeSnapshots(store,taskId);
 assert.equal(plan.executionMode,'direct');assert.equal(state.state,'completed_with_limitations');assert.equal(service.deliveryIssue(taskId),null);assert(sources.length>=3);assert.equal((result.match(/### 实验配方候选/g)??[]).length,3);
 assert.equal(new Set(sources.map(s=>s.ref?.experimentId)).size,sources.length);assert.match(result,/PDF p\./);
 for(const s of sources.slice(0,3)){assert(result.includes(s.title));assert(result.includes(s.sha256));for(const i of s.data.ingredients as any[]){if(i.amount?.original_value!==undefined&&i.amount?.original_unit!==undefined)assert(result.includes(' | '+i.amount.original_value+' | '+i.amount.original_unit+' | '));}}
 const report={passed:true,engine:'codex',model:'openai/gpt-oss-20b',request,elapsedMs:Date.now()-started,seededProjectRecords:2,state:state.state,requests:state.requests.length,tools:state.attempts.map(a=>({method:a.method,state:a.state})),sourceMutations:0,cloudCalls:0,scientificQualification:'pending_review',sources:sources.map(s=>({title:s.title,experimentId:s.ref?.experimentId,ingredients:(s.data.ingredients as any[]).length,processes:(s.data.processes as any[]).length,evidence:s.evidence.length,sha256:s.sha256})),result};
 await writeFile(join(output,'codex-three-recipes-live.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({...report,result:undefined}));
}catch(error){await writeFile(join(output,'codex-three-recipes-failure.json'),JSON.stringify({error:String(error),journal:taskId?store.agentJournal.read(taskId):null,overview:service.overview(project.id)},null,2),{mode:0o600});throw error;}
finally{if(timer)clearTimeout(timer);await runtime.dispose();pi.dispose();await service.close();store.close();await rm(dir,{recursive:true,force:true});}
