import {HostMcp} from "../../packages/agent/src/host-mcp.js";
import {WorkspaceStore} from '../../apps/desktop/main/store.js';
import {ResearchService} from '../../apps/desktop/main/research-service.js';
import {ResearchPaperService} from '../../apps/desktop/main/paper-service.js';
import {supervisionStore} from '../../apps/desktop/main/agent-supervision-store.js';
import {TaskSupervisor} from '../../packages/agent/src/task-supervisor.js';
import {directPlan} from '../../packages/agent/src/research-planning.js';
import {PublicResearchNetwork,SerialSourceQueue} from '../../packages/agent/src/papers/network.js';
import {PiLocalSessionService} from '../../packages/pi-adapter/src/local-session.js';
import {CodexEngine} from '../../packages/agent/src/codex-engine.js';
import {localModelConnection,localResponsesInvoker,defaultLocalProtocol} from '../../packages/agent/src/local-model-transport.js';
import {permissionGrantSchema,taskRefSchema} from '../../packages/contracts/src/agent.js';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const root=process.cwd(),temp=await mkdtemp(join(tmpdir(),'ua6-agents-')),cases:unknown[]=[];
const fixtureArxivId='2609.67891v3';
const atom=`<feed xmlns="http://www.w3.org/2005/Atom" xmlns:o="urn:opensearch"><o:totalResults>1</o:totalResults><entry><id>http://arxiv.org/abs/${fixtureArxivId}</id><title>MaterialsX synthetic fixture, not a real paper</title><summary>A synthetic paper for testing tool execution. Not scientific validation.</summary><published>2026-09-01T00:00:00Z</published><updated>2026-09-01T00:00:00Z</updated></entry></feed>`;
const pdf=await readFile(resolve('tests/fixtures/agent/ua6-paper.pdf'));
const protocolIndex=process.argv.indexOf('--protocol'),protocolOption=protocolIndex>=0?process.argv[protocolIndex+1]:undefined;
if(protocolIndex>=0&&!['chat-completions','responses'].includes(protocolOption??''))throw Error('Invalid --protocol; no fallback');
const engines: Array<'pi'|'codex'>=process.argv.includes('--pi-only')?['pi']:process.argv.includes('--codex-only')?['codex']:['pi','codex'];
const routes=engines.flatMap(engine=>(protocolOption?[protocolOption]:process.argv.includes('--matrix')?['chat-completions','responses']:[defaultLocalProtocol(engine,'openai/gpt-oss-20b')]).map(protocol=>({engine,protocol:protocol as 'chat-completions'|'responses'})));
try{for(const {engine,protocol} of routes){const home=join(temp,engine+'-'+protocol),path=join(home,'project');await mkdir(path,{recursive:true});const store=new WorkspaceStore(join(home,'state.sqlite')),project=store.createProject(path),conversation=store.createConversation(project.id),run=store.addRun(project.id,'UA.6 real engine / synthetic source','running');
 const research=new ResearchService(store,{client:null}),network=new PublicResearchNetwork((async url=>String(url).includes('/pdf/')?new Response(pdf,{headers:{'content-type':'application/pdf'}}):new Response(atom)) as typeof fetch,new SerialSourceQueue(0));
 const papers=new ResearchPaperService(store,research,root,home,network);research.papers=papers;const pi=new PiLocalSessionService(root,home,(_p,c)=>research.tools(project.id,c));let codex:CodexEngine|undefined,mcp:HostMcp|undefined,control:TaskSupervisor|undefined,lastText='',corrections=0;const started=Date.now(),timer=setTimeout(()=>{void pi.cancel(conversation.id);void codex?.cancel(run.id);},240000);
 try{const connection=await localModelConnection('http://127.0.0.1:1234/v1','openai/gpt-oss-20b',fetch,protocol,{maxOutputTokens:8192}),task=taskRefSchema.parse({taskId:run.id,projectId:project.id,conversationId:conversation.id}),grant=permissionGrantSchema.parse({grantId:randomUUID(),projectId:project.id,conversationId:conversation.id,permissions:['read','search','terminal','patch','network'],approvedBy:'local-user',maxCredits:null,maxSeconds:240});
 const tools=await pi.hostTools(path,conversation.id,grant.permissions),context={task,grant,methods:engine==='pi'?pi.toolCapabilities(path,conversation.id):new Map([['engine.execute',[]],...tools.map(t=>[t.name,t.permissions] as const)])};
 control=new TaskSupervisor({context,engine,connectionId:connection.id,accountRef:'local',projectPath:path,...supervisionStore(store,run.id)});
 const prompt='Execute only four paper tools. This is a synthetic test, not scientific evidence. First paper_search({query:"machine learning potentials",source:"arxiv",publicQueryConfirmed:true,limit:1}). Use the returned paperId to paper_fetch({paperId,grant:"personal-research"}), then paper_read({paperId,fromPage:1,toPage:1}), then paper_export({paperIds:[paperId],format:"bibtex"}). Do not run shell, plan, or invent files. Finally state the real export path and the numeric value read from page 1. Label this a synthetic test.';
 control.acceptPlan(directPlan(prompt,context));research.begin(run.id,project.id,prompt);let text='';
 if(engine==='pi'){pi.setConnection(conversation.id,connection);pi.setPermissions(conversation.id,grant.permissions);pi.setControl(conversation.id,control);text=await pi.prompt(conversation.id,path,{mode:'local',modelId:connection.modelId,localEndpoint:connection.endpoint!,agentEngine:'pi',localProtocol:connection.protocol as 'responses'|'chat-completions'},prompt);}
 else{mcp=new HostMcp({files:[],skills:[]},undefined,{tools,permissions:grant.permissions,signal:new AbortController().signal},control);await mcp.start();codex=new CodexEngine({home:join(home,'codex'),modelId:connection.modelId,contextWindow:connection.contextWindow!,maxOutput:connection.maxOutputTokens,localResponseRecovery:true,invoke:localResponsesInvoker(connection),mcp:{url:mcp.url,token:mcp.token,tools:mcp.toolNames},mcpPermissions:mcp.permissionMap});text=(await codex.run({task,grant,projectPath:path,content:prompt,control,onEvent:e=>{if(e.type==='text'&&e.delta.includes('正在修正模型返回'))corrections++;}})).text;}
 lastText=text;const record=papers.library.list(project.id)[0];assert(record?.file&&record.reading?.pages[0]?.text.includes('3.2 GPa'));const bib=(await readdir(join(path,'materials-output/papers'))).find(f=>f.endsWith('.bib'));assert(bib);assert.equal(record.paper.arxivId,fixtureArxivId);assert((await readFile(join(path,'materials-output/papers',bib),'utf8')).includes(fixtureArxivId));assert(text.includes('3.2')&&text.includes(bib),'Final response must cite the actual numeric value and export file');
 cases.push({engine,modelId:connection.modelId,protocol:connection.protocol,passed:true,fixtureArxivId,elapsedMs:Date.now()-started,text,corrections,actualMethods:control.snapshot().attempts.map(a=>({method:a.method,state:a.state})),fixtureNetwork:true,scientificQualification:false});
 console.log(JSON.stringify({engine,protocol,passed:true,elapsedMs:Date.now()-started}));
 }catch(e){process.exitCode=1;cases.push({engine,protocol,passed:false,error:e instanceof Error?e.message:String(e),elapsedMs:Date.now()-started,corrections,failedTools:control?.snapshot().attempts.filter(a=>a.state==='failed').map(a=>({method:a.method,input:a.inputRef?store.agentJournal.readResult(run.id,a.inputRef):null,result:a.resultRef?store.agentJournal.readResult(run.id,a.resultRef):null})),state:control?.snapshot(),fixtureNetwork:true,scientificQualification:false,text:lastText,records:papers.library.list(project.id).map(r=>({id:r.paper.paperId,status:r.status,readPages:r.reading?.readPages})),exportFiles:await readdir(join(path,'materials-output/papers')).catch(()=>[])});console.log(JSON.stringify(cases.at(-1)));}
 finally{clearTimeout(timer);pi.dispose();await codex?.dispose();await mcp?.close();await research.close();store.close();}
 }}finally{await mkdir(resolve('runtime/agent/ua-6'),{recursive:true});await writeFile(resolve('runtime/agent/ua-6/agents.json'),JSON.stringify({stage:'UA.6',mode:'real-local-model-and-engines/synthetic-public-source',cases},null,2));await rm(temp,{recursive:true,force:true});}
