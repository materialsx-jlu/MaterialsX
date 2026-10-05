// Fixed real local model: 30 genuine interpretation/decomposition requests, no paid APIs or scripted answers.
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import {tmpdir} from 'node:os';
import {WorkspaceStore} from '../../apps/desktop/main/store.js';
import {ResearchService} from '../../apps/desktop/main/research-service.js';
import {PiLocalSessionService} from '../../packages/pi-adapter/src/local-session.js';
import { randomUUID } from 'node:crypto';
import { interpretLocal } from '../../packages/pi-adapter/src/local-runtime.js';
import { interpretResearchPlan } from '../../packages/agent/src/research-planning.js';
import { taskRefSchema, permissionGrantSchema } from '../../packages/contracts/src/agent.js';
import { localModelConnection } from '../../packages/agent/src/local-model-transport.js';
import {materialToolPermissions} from '../../packages/agent/src/research-tools.js';
const endpoint = 'http://127.0.0.1:1234/v1', modelId = 'openai/gpt-oss-20b', directory = resolve('runtime/agent/ua-5');
await mkdir(directory, { recursive: true });
const connection = await localModelConnection(endpoint, modelId, fetch, 'chat-completions', { maxOutputTokens: 3200 });
const fixture = JSON.parse(await readFile(resolve('fixtures/agent/research-goals.v1.json'), 'utf8'));
let selected=fixture.cases.slice(0,30).map((c:any,index:number)=>({c,index}));
if(process.argv.includes('--failed-only')){
    const previous=JSON.parse(await readFile(resolve(directory,'goals-local.json'),'utf8'));
    if(previous.stage!=='UA.5'||previous.modelId!==modelId||previous.total!==30||previous.finished!==30||!Array.isArray(previous.results)||previous.results.length!==30)
        throw Error('A complete 30-case report for the same model is required before failed-only recheck');
    const failed=new Set(previous.results.filter((r:any)=>!r.contractPass).map((r:any)=>r.id));
    if([...failed].some(id=>!selected.some(({c}:any)=>c.id===id)))throw Error('Previous failure does not belong to the frozen fixture');
    selected=selected.filter(({c}:any)=>failed.has(c.id));
}
const results: Record<string, any>[] = [];
const temp=await mkdtemp(join(tmpdir(),'mx-ua5-goals-')),store=new WorkspaceStore(join(temp,'state.sqlite')),project=store.createProject(temp),research=new ResearchService(store,{client:null});
const pi=new PiLocalSessionService(process.cwd(),temp,()=>research.tools(project.id,'qualification'));
const methods=new Map(pi.toolCapabilities(temp,'qualification'));
// M6/Skill bindings retain the published permission contract; only plans, never tools, execute here.
for(const name of ['materials_science','skill_search','potential_search'])methods.set(name,materialToolPermissions(name));
const methodDescriptions=pi.toolDescriptions(temp,'qualification');
try{for (const {index, c} of selected) {
    const locale = index % 2 ? 'en' : 'zh', text = c.prompt[locale], projectId = randomUUID(), conversationId = randomUUID();
    const task = taskRefSchema.parse({ taskId: randomUUID(), projectId, conversationId });
    const grant = permissionGrantSchema.parse({ grantId: randomUUID(), projectId, conversationId, permissions: ['read', 'search', 'patch', 'science'], approvedBy: 'local-user', maxCredits: null, maxSeconds: 90 });
    const context = { task, grant, methods, methodDescriptions, inputVersions: [], evidence: [] };
    const start = Date.now(), deadline = start + grant.maxSeconds * 1000;
    let calls = 0;
    let result: Record<string, any> = { id: c.id, locale, contractPass: false, expectedMissing: c.cognition.missing, semanticExpertReview: 'pending' };
    try {
        const plan = await interpretResearchPlan(text, context, (prompt) => { calls++; return interpretLocal(endpoint, modelId, prompt, AbortSignal.timeout(Math.max(1, deadline - Date.now())), 3200, undefined, connection,'interpret'); });
        result.interpretationCalls = calls;
        result = { ...result, contractPass: true, proposal: plan, actualMissing: plan.cognition.missing.map(m => m.question), materialPreserved: c.goal.material === 'unspecified' || JSON.stringify(plan.goal).toLowerCase().includes(c.goal.material.toLowerCase()), numericTarget: c.goal.numericTarget,
            inferredThresholds: plan.goal.metrics.filter(m => m.origin === 'evidence' && m.value !== null).length, executionPerformed: false };
    }
    catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
    }
    result.interpretationCalls = calls;
    result.elapsedMs = Date.now() - start;
    results.push(result);
    const report = { stage: 'UA.5', kind: 'real-model-interpretation', modelId, connection, temperature: 0, outputLimit: 3200, total: selected.length, finished: results.length, contractPass: results.filter(r => r.contractPass).length, results,
        scientificAccuracyValidated: false, semanticExpertReview: 'pending', intelligenceQualified: false, executionEvidence: 'moos.json and agent-live.json are separate; schema validity alone is not research capability', payments: 0, cloudExport: false };
    await writeFile(resolve(directory, process.argv.includes('--failed-only')?'goals-recheck.json':'goals-local.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ id: c.id, locale, contractPass: result.contractPass, elapsedMs: result.elapsedMs, error: result.error }));
    const current = await localModelConnection(endpoint, modelId, fetch, 'chat-completions', { maxOutputTokens: 3200 });
    if (current.revision !== connection.revision)
        throw Error('Primary model changed during qualification; do not mix models');
}}finally{pi.dispose();await research.close();store.close();await rm(temp,{recursive:true,force:true});}
if(results.some(r=>!r.contractPass))process.exitCode=1;
