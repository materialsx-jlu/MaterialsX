// Real read-only MOOS + real files. No LLM, source mutation, payments or cloud export.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkspaceStore} from '../../apps/desktop/main/store.js';
import {ResearchService} from '../../apps/desktop/main/research-service.js';
import {directPlan} from '../../packages/agent/src/research-planning.js';
const root=resolve('runtime/agent/ua-4'),directory=resolve(process.env.MATERIALSX_MOOS_MCP_DIRECTORY??'../MOOS/services/materials-mcp');
await mkdir(root,{recursive:true});const projectPath=join(root,'projects',randomUUID());await mkdir(projectPath,{recursive:true});
const store=new WorkspaceStore(join(root,'moos-'+randomUUID()+'.sqlite')),project=store.createProject(projectPath),service=new ResearchService(store,{directory,origin:process.env.MATERIALSX_MOOS_ORIGIN??'http://127.0.0.1:8080'});
const results:unknown[]=[];let passed=false,error='';
function task(kind:'comparison'|'recipe-process'|'simulation-gaps',locale:'zh'|'en',selected:string[],image=false){
 const p=store.research.project(project.id);service.save({...p,revision:p.revision+1,materialSystem:'Radiative cooling / 辐射制冷',selected,delivery:{...p.delivery,kind,required:image?['table','chart','report','image']:['table','chart','report'],optional:image?[]:['image']}},p.revision);
 const c=store.createConversation(project.id),r=store.addRun(project.id,'UA.4 '+kind+' '+locale,'running');
 const content=locale==='zh'?'整理真实来源证据，允许待审核记录但不作科研验证声明':'Present actual source evidence; include unreviewed extraction, without claiming scientific validation';
 const b=service.begin(r.id,project.id,content),context={task:{taskId:r.id,projectId:project.id,conversationId:c.id} as any,grant:{grantId:randomUUID(),projectId:project.id,conversationId:c.id,permissions:['read','search','patch'] as any,approvedBy:'local-user' as const,maxCredits:null,maxSeconds:600},methods:new Map([['engine.execute',[]]]),inputVersions:b.approvedInputs,evidence:service.context(r.id)!.evidence};
 store.saveResearchPlan(directPlan(content,context));return r.id;
}
try{
 const found=await service.router.search(project.id,null,{query:process.env.MATERIALSX_MOOS_FIXTURE_QUERY??'WO2025161063A1',reviewScope:'include-unreviewed'});assert(found.items.length>=2,'Two actual experiments required');
 const snapshots=[];for(const candidate of found.items.slice(0,2))snapshots.push(await service.select(project.id,candidate.ref));
 const selections=snapshots.map(s=>({snapshotId:s.id,observationId:(s.data.observations as any[])[0].id}));
 for(const locale of ['zh','en'] as const){const taskId=task('comparison',locale,snapshots.map(s=>s.id)),d=await service.deliver(project.id,taskId,{snapshotIds:snapshots.map(s=>s.id),selections});
 assert.equal(d.status,'accepted-with-limitations',JSON.stringify(d.checks.filter(c=>c.status==='fail')));assert.equal(d.scientificStatus,'needs_review');assert(d.checks.some(c=>c.id==='comparability'));assert((await service.preview(project.id,d.id,'table')).includes(selections[0]!.observationId));store.updateRun(taskId,'completed_with_limitations');results.push({kind:'comparison',locale,deliveryId:d.id,status:d.status,checks:d.checks.length,hashes:d.artifacts.map(a=>a.sha256),scientificStatus:d.scientificStatus});}
 let asset:any,cursor:string|null=null;for(let page=0;page<5&&!asset;page++){const r=await service.router.moos(project.id,null,'moos_search_assets',{reviewScope:'include-unreviewed',modality:'photo',limit:20,...(cursor?{cursor}:{})});asset=r.data.items.find((a:any)=>a.contentAvailable&&a.rightsBasis&&a.originalSha256);cursor=r.data.nextCursor;if(!cursor)break;}assert(asset,'Actual authorized image required');
 const recipe=await service.select(project.id,asset.ref);assert((recipe.data.recipes as any[]).length>0&&(recipe.data.processes as any[]).length>0);
 for(const locale of ['zh','en'] as const){const taskId=task('recipe-process',locale,[recipe.id],true),d=await service.deliver(project.id,taskId,{snapshotIds:[recipe.id],image:{snapshotId:recipe.id,mediaId:asset.mediaId}});assert(['accepted-with-limitations','blocked'].includes(d.status));assert(d.artifacts.some(a=>a.kind==='image'));if(d.status==='blocked')assert(d.checks.filter(c=>c.status==='fail').every(c=>c.id.startsWith('evidence:')),'Only genuine missing field evidence may block this fixture');store.updateRun(taskId,d.status==='blocked'?'blocked':'completed_with_limitations');results.push({kind:'recipe-process',locale,deliveryId:d.id,status:d.status,imageHash:d.artifacts.find(a=>a.kind==='image')!.sha256,checks:d.checks.length});}
 let simulation:any,scursor:string|null=null;for(let page=0;page<12&&!simulation;page++){const r=await service.router.moos(project.id,null,'moos_search',{entityKinds:['simulation'],reviewScope:'include-unreviewed',limit:50,...(scursor?{cursor:scursor}:{})});simulation=r.data.items.find((s:any)=>s.simulationIds.length);scursor=r.data.nextCursor;if(!scursor)break;}assert(simulation,'Actual reported simulation required');
 const sim=await service.select(project.id,simulation.ref);
 for(const locale of ['zh','en'] as const){const taskId=task('simulation-gaps',locale,[sim.id]),d=await service.deliver(project.id,taskId,{snapshotIds:[sim.id],studies:[{snapshotId:sim.id,studyId:simulation.simulationIds[0]}]});assert.equal(d.status,'accepted-with-limitations',JSON.stringify(d.checks));assert.equal((d.sourceResult as any).executionPerformed,false);store.updateRun(taskId,'completed_with_limitations');results.push({kind:'simulation-gaps',locale,deliveryId:d.id,status:d.status,executionPerformed:false,checks:d.checks.length});}
 const previous=store.research.project(project.id);service.save({...previous,revision:previous.revision+1,selected:[],withdrawn:[sim.id]},previous.revision);assert(service.overview(project.id).deliveries.some(d=>d.status==='stale'));passed=true;
}catch(e){error=e instanceof Error?e.message:String(e);process.exitCode=1;}
finally{await service.close();store.close();const report={stage:'UA.4',passed,error,mode:'real MOOS MCP + existing backend + real source presentation artifacts',tasks:results,sourceMutations:0,modelCalls:0,payments:0,cloudExport:false,intelligenceValidated:false,scientificAccuracyValidated:false};await writeFile(join(root,'moos.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));}
