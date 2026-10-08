import { createScienceBridge } from "./science-bridge.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager } from "@earendil-works/pi-coding-agent";
import { AtomisticRuntime } from "../../atomistic/src/runtime.js";
import { createAtomisticTools } from "./atomistic-tools.js";
test("real Pi SDK exposes the eight scoped local science tools without contacting a model",async()=>{
 const temp=await mkdtemp(join(tmpdir(),"mx-science-tools-"));
 try{
  const runtime=new AtomisticRuntime(process.cwd(),join(temp,"state"),id=>id==="fixture-project"?temp:null);await runtime.restore();
  const agentDir=join(temp,"agent");await mkdir(agentDir);const settingsManager=SettingsManager.inMemory({compaction:{enabled:false}});
  const loader=new DefaultResourceLoader({cwd:temp,agentDir,settingsManager,noContextFiles:true,noSkills:true,noExtensions:true,noPromptTemplates:true,noThemes:true});await loader.reload();
  const modelRuntime=await ModelRuntime.create({authPath:join(temp,"auth.json"),modelsPath:join(temp,"models.json")});
  const bridge=createScienceBridge(runtime,"fixture-project");assert.throws(()=>bridge.completedSummary(true),/NOT_STARTED/);assert.throws(()=>bridge.completedSummary(false,true),/COMPARISON_NOT_EXECUTED/);
  const tools=createAtomisticTools(runtime,"fixture-project");assert.equal(tools.length,8);assert(tools.some(t=>t.name==="relax_atomic_structure"));assert(tools.some(t=>t.name==="run_atomic_md"));
  const {session}=await createAgentSession({cwd:temp,agentDir,resourceLoader:loader,modelRuntime,settingsManager,sessionManager:SessionManager.inMemory(temp),tools:tools.map(t=>t.name),customTools:tools});
  try{await session.bindExtensions({});assert.deepEqual(session.getActiveToolNames().sort(),tools.map(t=>t.name).sort());
    const list=tools.find(t=>t.name==="list_atomistic_jobs")!;const result=await list.execute("call",{},undefined,undefined,{} as never);
    assert.match(JSON.stringify(result),/structures/);const inspect=tools.find(t=>t.name==="inspect_atomic_structure")!;
    await assert.rejects(inspect.execute("call",{structureId:"foreign"},undefined,undefined,{} as never),/STRUCTURE_NOT_OWNED/);
  }finally{session.dispose();runtime.dispose();}
 }finally{await rm(temp,{recursive:true,force:true});}
});
