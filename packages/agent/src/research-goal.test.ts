import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  permissionGrantSchema,
  taskRefSchema,
} from "../../contracts/src/agent.js";
import { validateResearchPlan } from "../../contracts/src/research-goal.js";
import {
  bindProposal,
  directPlan,
  executionMode,
  prepareResearchPlan,
  interpretationPrompt,
} from "./research-planning.js";
import { PiEngine } from "./pi-engine.js";
const projectId = randomUUID(),
  conversationId = randomUUID();
const task = taskRefSchema.parse({
  projectId,
  conversationId,
  taskId: randomUUID(),
});
const grant = permissionGrantSchema.parse({
  projectId,
  conversationId,
  grantId: randomUUID(),
  permissions: ["read", "search"],
  approvedBy: "local-user",
  maxCredits: "10",
  maxSeconds: 60,
});
const methods = new Map([
  ["engine.execute", []],
  ["read", ["read"]],
  ["search", ["search"]],
]) as any;
const context = { task, grant, methods };
const base = () => structuredClone(directPlan("解释 Si 单点计算", context));
test('interpretation never advertises an unavailable fixed calculation prerequisite under a narrow grant',()=>{
  const prompt=interpretationPrompt('分析已有实验数据',context);
  assert(!prompt.includes('research_method_run must use'));assert(prompt.includes('No additional backend is available'));
  const available={...context,grant:{...grant,permissions:['read','search','patch','science'] as const},methods:new Map([...methods,['research_method_run',['read','patch','science']],['research_methods',['read','science']]])};
  assert(interpretationPrompt('分析已有实验数据',available as any).includes('research_method_run must use'));
});
test('omitted metric priority is neutral only for unranked requests; explicit rankings and invalid priority values are not guessed',()=>{
  const p=base(),proposal:any={goal:{...p.goal,metrics:[{name:'energy',value:null,unit:null,condition:null,origin:'user'}]},constraints:{process:[],dataSources:[]},cognition:p.cognition,steps:p.steps,adjustmentRules:p.adjustmentRules,acceptance:p.acceptance};
  assert.equal(bindProposal(proposal,'分析 energy',context).goal.metrics[0]!.priority,0);
  assert.throws(()=>bindProposal(proposal,'Prioritize energy first',context),/priority/);
  proposal.goal.priorities=['energy'];assert.throws(()=>bindProposal(proposal,'分析 energy',context),/priority/);
  proposal.goal.priorities=[];proposal.goal.metrics[0].priority='1';assert.throws(()=>bindProposal(proposal,'分析 energy',context),/priority/);
});
test("simple task skips interpretation; original request and six sections retained", async () => {
  const p = await prepareResearchPlan("解释 Si 单点计算", context, async () => {
    throw Error("unexpected model call");
  });
  assert.equal(p.originalRequest, "解释 Si 单点计算");
  assert.equal(p.executionMode, "direct");
  assert.equal(
    Object.keys(p).filter((k) =>
      [
        "goal",
        "constraints",
        "cognition",
        "steps",
        "adjustmentRules",
        "acceptance",
      ].includes(k),
    ).length,
    6,
  );
});
test("rejects missing dependencies, cycles, unknown methods, permission escalation and wrong references", () => {
  for (const mutate of [
    (p: any) => (p.steps[0].dependsOn = ["absent"]),
    (p: any) =>
      (p.cognition.facts = [
        {
          text: "claimed",
          confirmed: true,
          evidence: [
            {
              sourceId: "made-up",
              generation: "v1",
              sha256: "a".repeat(64),
              locator: "p1",
            },
          ],
        },
      ]),
    (p: any) => (p.steps[0].dependsOn = ["execute"]),
    (p: any) => (p.steps[0].method = "invented"),
    (p: any) => p.constraints.permissions.push("network"),
    (p: any) => (p.task.projectId = randomUUID()),
    (p: any) => (p.steps[0].inputRefs = ["unknown"]),
    (p: any) => (p.constraints.maxCredits = "11"),
    (p: any) =>
      (p.cognition.missing = [
        { id: "density", question: "density?", blocks: ["absent"] },
      ]),
    (p: any) =>
      (p.cognition.assumptions = [
        { text: "assumed", evidence: [], confirmed: true },
      ]),
  ]) {
    const p = base();
    mutate(p);
    assert.throws(() => validateResearchPlan(p, context));
  }
});
test("rejects fabricated target numbers and units; grants come from host", () => {
  const p = base();
  const proposal = {
    goal: {
      ...p.goal,
      metrics: [
        {
          name: "strength",
          value: 100,
          unit: "MPa",
          condition: null,
          priority: 0,
          origin: "user",
        },
      ],
    },
    constraints: { process: [], dataSources: [] },
    cognition: p.cognition,
    steps: p.steps,
    adjustmentRules: p.adjustmentRules,
    acceptance: p.acceptance,
  };
  assert.throws(() => bindProposal(proposal, "比较强度", context));
  const plan = bindProposal(proposal, "比较强度，100 MPa", context);
  assert.equal(plan.constraints.grantId, grant.grantId);
});
test("planned contract uses actual dependency graph and optimistic version", () => {
  const p = base();
  p.executionMode = "planned";
  p.steps.push({
    ...p.steps[0]!,
    id: "analyze" as any,
    dependsOn: ["execute" as any],
  });
  const good = validateResearchPlan(p, context);
  assert.equal(good.steps.length, 2);
  assert.throws(() =>
    validateResearchPlan(good, { ...context, previous: good }),
  );
});
test("Pi adapter delegates tools once, exposes real steer/cancel/resume capability", async () => {
  let prompts = 0,
    steered = 0;
  let finish: ((text: string) => void) | undefined;
  const engine = new PiEngine({
    capabilities: {
      kind: "pi",
      tools: methods,
      steer: true,
      resume: true,
      persistentHistory: true,
      sandbox: "none",
    },
    prompt: async () => {
      prompts++;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    },
    interpret: async () => {
      throw Error("unexpected");
    },
    cancel: () => true,
    steer: async () => {
      steered++;
    },
  });
  const input = {
    task,
    projectPath: "/tmp",
    content: "解释 Si",
    grant,
    onEvent: () => {},
  };
  const result = engine.run(input);
  await new Promise((resolve) => setImmediate(resolve));
  await engine.steer(task.taskId, "补充");
  finish!("answer");
  assert.equal((await result).state, "completed_with_limitations");
  assert.equal(prompts, 1);
  assert.equal(steered, 1);
  await assert.rejects(engine.resume(input, randomUUID()));
});
test("complex comparisons remain planned in both languages", () => {
  assert.equal(executionMode("比较 PDMS 配方"), "planned");
  assert.equal(executionMode("Compare PDMS recipes"), "planned");
});

test("host recognizes mass/volume ambiguity and missing mandatory artifact without inventing a density", () => {
  const plan = directPlan("比较10 wt%和10 vol%，不要直接等同", context);
  assert(plan.cognition.missing.length);
  assert.deepEqual(plan.cognition.missing[0]?.blocks, ["execute"]);
  const missing = directPlan(
    "Required JSON file is absent; do not claim completion",
    context,
  );
  assert(missing.cognition.missing.length);
});

test("existing PDF extraction uses managed workflow without another planning request", async () => {
  const plan = await prepareResearchPlan(
    "@materials-literature-rpsme-json 提取 /project/paper.pdf，输出 JSON、中文摘要和校验报告。",
    context,
    async () => {
      throw Error("unneeded planning call");
    },
  );
  assert.equal(plan.executionMode, "direct");
  assert.equal(plan.acceptance.requiredArtifacts.length, 3);
});

test("local Pi receives the admitted complex plan and never executes blocked plans", async () => {
  for (const blocked of [false, true]) {
    const p = base();
    if (blocked)
      p.cognition.missing.push({
        id: "missing" as any,
        question: "需要结构",
        blocks: ["execute" as any],
      });
    const proposal = {
      goal: p.goal,
      cognition: p.cognition,
      steps: p.steps,
      adjustmentRules: p.adjustmentRules,
      acceptance: p.acceptance,
      constraints: { process: [], dataSources: [] },
    };
    let executionCalls = 0,
      interpretationCalls = 0,
      savedOriginal = "";
    const engine = new PiEngine({
      capabilities: {
        kind: "pi",
        tools: methods,
        steer: false,
        resume: true,
        persistentHistory: true,
        sandbox: "none",
      },
      interpret: async () => {
        interpretationCalls++;
        return JSON.stringify(proposal);
      },
      prompt: async (input) => {
        executionCalls++;
        assert.ok(input.content.includes("Validated research plan"));
        assert.ok(input.content.startsWith("比较硅结构"));
        return "result";
      },
      cancel: () => true,
    });
    const result = await engine.run({
      task,
      projectPath: "/tmp",
      content: "比较硅结构",
      grant,
      onEvent: (event) => {
        if (event.type === "plan") savedOriginal = event.plan.originalRequest;
      },
    });
    assert.equal(interpretationCalls, 1);
    assert.equal(executionCalls, blocked ? 0 : 1);
    assert.equal(savedOriginal, "比较硅结构");
    assert.equal(
      result.state,
      blocked ? "blocked" : "completed_with_limitations",
    );
  }
});

test('bounded plan repair preserves original request and host grant and never executes tools',async()=>{
 const {interpretResearchPlan}=await import('./research-planning.js');let calls=0;
 const full=base();const valid={goal:full.goal,cognition:full.cognition,steps:full.steps,adjustmentRules:full.adjustmentRules,acceptance:full.acceptance,constraints:{process:[],dataSources:[]}};
 const plan=await interpretResearchPlan('解释 Si 单点计算',context,async prompt=>{calls++;if(calls===1)return 'invalid JSON';assert(prompt.includes('Repair the previous JSON once'));assert(prompt.includes('invalid JSON'));return JSON.stringify(valid);});
 assert.equal(calls,2);assert.equal(plan.originalRequest,'解释 Si 单点计算');assert.deepEqual(plan.constraints.permissions,grant.permissions);
 calls=0;await assert.rejects(interpretResearchPlan('解释 Si 单点计算',context,async()=>{calls++;return '{}';}),/修复未通过/);assert.equal(calls,2);
 calls=0;await assert.rejects(interpretResearchPlan('解释 Si 单点计算',context,async()=>{calls++;throw Error('Transport unavailable');}),/Transport unavailable/);assert.equal(calls,1);
});

test('explicit no-extra-files scope rejects an invented narrative report before tools; original generated files remain required',()=>{
 const p=base(),proposal:any={goal:p.goal,constraints:{process:[],dataSources:[]},cognition:p.cognition,steps:[{...p.steps[0],permissions:[],expectedArtifacts:['报告']}],adjustmentRules:p.adjustmentRules,acceptance:{...p.acceptance,requiredArtifacts:['报告']}};
 assert.throws(()=>bindProposal(proposal,'核对子任务报告后对话汇总，不新增额外产物',context),/Narrative-only/);
 proposal.steps[0].expectedArtifacts=[];proposal.acceptance.requiredArtifacts=[];assert.equal(bindProposal(proposal,'核对子任务报告后对话汇总，不新增额外产物',context).steps[0]?.expectedArtifacts.length,0);
 proposal.steps[0].expectedArtifacts=['explicit.md'];assert.deepEqual(bindProposal(proposal,'核对已生成 explicit.md，不生成额外文件',context).steps[0]?.expectedArtifacts,['explicit.md']);
});
