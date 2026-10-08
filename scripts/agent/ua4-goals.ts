// Fixed real local model: 30 genuine interpretation/decomposition requests, no paid APIs or scripted answers.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {interpretLocal} from '../../packages/pi-adapter/src/local-runtime.js';
import {interpretationPrompt,bindProposal} from '../../packages/agent/src/research-planning.js';
import {taskRefSchema,permissionGrantSchema} from '../../packages/contracts/src/agent.js';
import {localModelConnection} from '../../packages/agent/src/local-model-transport.js';
const endpoint='http://127.0.0.1:1234/v1',modelId='openai/gpt-oss-20b',directory=resolve('runtime/agent/ua-4');await mkdir(directory,{recursive:true});
const connection=await localModelConnection(endpoint,modelId,fetch,'chat-completions');
const fixture=JSON.parse(await readFile(resolve('fixtures/agent/research-goals.v1.json'),'utf8'));
const results:Record<string,any>[]=[];
for(const [index,c]of fixture.cases.slice(0,30).entries()){
 const locale=index%2?'en':'zh',text=c.prompt[locale],projectId=randomUUID(),conversationId=randomUUID();
 const task=taskRefSchema.parse({taskId:randomUUID(),projectId,conversationId});
 const grant=permissionGrantSchema.parse({grantId:randomUUID(),projectId,conversationId,permissions:['read','search','patch','science'],approvedBy:'local-user',maxCredits:null,maxSeconds:90});
 const context={task,grant,methods:new Map<string,readonly any[]>([['engine.execute',[]],['research_data',['read','search']],['research_delivery',['read','patch']],['materials_science',['science']],['skill_search',['search']],['potential_search',['search']]]),inputVersions:[],evidence:[]};
 const start=Date.now();let result:Record<string,any>={id:c.id,locale,contractPass:false,expectedMissing:c.cognition.missing,semanticExpertReview:'pending'};
 try{
  const answer=await interpretLocal(endpoint,modelId,interpretationPrompt(text,context)+'\nUse compact JSON and 1–3 steps. For unsupported PDF/arXiv/training/experimental measurements, preserve the request and record missing inputs or an unsupported-method limitation. Known MOOS methods retrieve reports, not new experiments. Do not convert scientific targets into verified facts.',AbortSignal.timeout(90000),1800);
  const proposal=JSON.parse(answer.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')),plan=bindProposal(proposal,text,context);
  result={...result,contractPass:true,proposal:plan,actualMissing:plan.cognition.missing.map(m=>m.question),materialPreserved:c.goal.material==='unspecified'||JSON.stringify(plan.goal).toLowerCase().includes(c.goal.material.toLowerCase()),numericTarget:c.goal.numericTarget,
    inferredThresholds:plan.goal.metrics.filter(m=>m.origin==='evidence'&&m.value!==null).length,executionPerformed:false};
 }catch(e){result.error=e instanceof Error?e.message:String(e);}
 result.elapsedMs=Date.now()-start;results.push(result);
 const report={stage:'UA.4',kind:'real-model-interpretation',modelId,connection,temperature:0,outputLimit:1800,total:30,finished:results.length,contractPass:results.filter(r=>r.contractPass).length,results,
  scientificAccuracyValidated:false,semanticExpertReview:'pending',intelligenceQualified:false,executionEvidence:'moos.json and agent-live.json are separate; schema validity alone is not research capability',payments:0,cloudExport:false};
 await writeFile(resolve(directory,'goals-local.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({id:c.id,locale,contractPass:result.contractPass,elapsedMs:result.elapsedMs,error:result.error}));
 const current=await localModelConnection(endpoint,modelId,fetch,'chat-completions');if(current.revision!==connection.revision)throw Error('Primary model changed during qualification; do not mix models');
}
