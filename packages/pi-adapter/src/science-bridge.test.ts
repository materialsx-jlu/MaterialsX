import assert from "node:assert/strict";
import { test } from "node:test";
import { createScienceBridge } from "./science-bridge.js";
import type { AtomisticRuntime } from "../../atomistic/src/runtime.js";

test('automatic selection returns literal next calls from actual assessment IDs; wrong structure IDs never launch',async()=>{
  let starts=0;
  const assessment={id:'assessment',request:{domain:'inorganic-crystals',mode:'exploratory',structureId:'structure',interaction:'short-range'},selection:{candidates:[{potentialId:'chgnet-0.3.0',evidenceIds:['actual-citation']}],exclusions:Array.from({length:10},(_,i)=>({potentialId:'excluded-'+i,reasonCodes:['UNVERIFIED']}))}};
  const scope={projectId:'project',conversationId:'conversation',structureId:'structure',domain:'inorganic-crystals' as const,mode:'exploratory' as const,permission:'relaxation' as const,options:{optimizer:'FIRE' as const,cellMode:'fixed' as const,cellConstraint:'none' as const,externalPressureGPa:null,maxSteps:3,fmaxEvPerAngstrom:.05}};
  const runtime={inspect:()=>({id:'structure',source:{sha256:'fixture'},atoms:[{element:'Si'}],pbc:[true,true,true],issues:[]})} as unknown as AtomisticRuntime;
  const service={assess:async()=>assessment,freeze:async(_project:string,args:any)=>{starts++;assert.equal(args.assessmentId,'assessment');assert.deepEqual(args.evidenceIds,['actual-citation']);return {id:'workflow',plan:{planSha256:'fixture',potentialId:args.potentialId,downloadBytes:0}};},approve:()=>{}} as any;
  const bridge=createScienceBridge(runtime,'project',scope,undefined,{service,scope:{projectId:'project',conversationId:'conversation',structureId:'structure',permission:'relaxation',maxSteps:3,maxDownloadBytes:0},prompt:'Select an installed potential'});
  const base={domain:'inorganic-crystals',mode:'exploratory',secondaryId:null,potentialId:null,evidenceIds:[]};
  const planned=await bridge.execute({...base,action:'auto_plan',targetId:'structure'}) as any;
  assert.equal(planned.assessmentId,'assessment');assert.equal(planned.exclusionCount,10);assert.equal(planned.selection.exclusions.length,8);assert(planned.exclusionsTruncated);
  await assert.rejects(bridge.execute({...base,action:'auto_run',targetId:'structure',potentialId:'chgnet-0.3.0'}),/Valid nextCalls.*assessment/);assert.equal(starts,0);
  const started=await bridge.execute(planned.nextCalls[0]) as any;assert.equal(starts,1);assert.equal(started.nextCall.action,'auto_get');assert.equal(started.nextCall.targetId,'workflow');
});

test("scientific calls cannot change selected physics or resubmit the same assessment/potential", async () => {
  let starts = 0;
  const job = { job: { id: "job", status: "validating" }, plan: { potentialId: "chgnet-0.3.0" } };
  const runtime = {
    inspect: () => ({ id: "structure" }),
    assess: async () => ({ id: "assessment", request: { projectId: "project", structureId: "structure", task: "singlepoint", domain: "inorganic-crystals", mode: "exploratory", interaction: "short-range" }, selection: {}, rankingBasis: "hard gates", registrySha256: "fixture" }),
    startSelected: async () => { starts++; return job; },
    get: () => job,
  } as unknown as AtomisticRuntime;
  const bridge = createScienceBridge(runtime, "project");
  const base = { domain: "inorganic-crystals", mode: "exploratory", potentialId: null, secondaryId: null, evidenceIds: [] };
  const selected = await bridge.execute({ ...base, action: "select", targetId: "structure", secondaryId: "singlepoint", interaction: null }) as any;
  assert.equal(selected.assessmentId, "assessment");
  const call = { ...base, action: "singlepoint", targetId: selected.assessmentId, potentialId: "chgnet-0.3.0", evidenceIds: ["actual-citation"] };
  await assert.rejects(bridge.execute({ ...call, interaction: "long-range-required" }), /REQUIREMENT_MISMATCH/);
  await assert.rejects(bridge.execute({ ...call, mode: "production" }), /REQUIREMENT_MISMATCH/);
  await assert.rejects(bridge.execute({ ...call, domain: "molecules" }), /REQUIREMENT_MISMATCH/);
  assert.equal(starts, 0);
  const [first, repeated] = await Promise.all([bridge.execute({ ...call, interaction: null }), bridge.execute(call)]) as any[];
  assert.equal(starts, 1); assert.equal(repeated.runId, first.runId); assert.equal(repeated.reused, true);
});
