import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { z } from "zod";
import { AgentError, type Permission } from "../../contracts/src/agent.js";
import { validateResearchPlan, type PlanContext, type ResearchGoalPlan } from "../../contracts/src/research-goal.js";
import { taskExecutionSchema, type TaskExecution, type ExecutionEvent } from "../../contracts/src/task-execution.js";
import {pendingJobGuidance} from './pending-job-guidance.js';
import {recoveryError,failureFromReceipt} from './recovery-failures.js';
import {admitCorrection,requireFailureBudget} from './recovery-policy.js';
import {failureGuidance} from './recovery-presentation.js';
import { completionReceipts, acceptedDesignReceipt } from "./step-completion.js";
import { observedJobs, nativeToolFailed, nativeReceiptMetadata } from "./execution-receipts.js";
import { canonical, digest, fitRequest } from "./execution-context.js";
import {VerifiedSourceReady,type ExecutionControl,type ToolExecution} from "./execution-control.js";
import {supportsPlannedMethod} from './research-tools.js';
import { bindProposal, interpretationPrompt, selectedMethodPlan } from './research-planning.js';
import { initialInterpretation, preserveConstraints, isMutableTool, requiresResearchPlan, taskUnderstandingGuidance } from './task-understanding.js';
import { capabilitySnapshot, capabilityContext, toolCapabilityFacts, capabilityKnowledge, receiptKnowledge } from './capability-awareness.js';
import {attachReadings,currentWork,projectContext} from "./working-context.js";
import {verifiedArtifactIssues} from "./answer-paths.js";
import {assessDelivery} from "./delivery-assessment.js";
import type {WorkingContext} from "../../contracts/src/working-context.js";
import { assessAnswer } from './answer-assessment.js';
import { answerClaimSchema, type CapabilityFact, type AnswerClaim, type KnowledgeFact } from '../../contracts/src/capability-awareness.js';
const commandSchema = z.strictObject({ action: z.enum(["status", "capabilities", "receipt", "validate_answer", "plan", "begin", "complete", "replan"]), stepId: z.string().optional(),
  answer:z.string().max(60000).optional(),claims:z.array(answerClaimSchema).max(64).optional(),
  query:z.string().max(160).optional(),method:z.string().max(128).optional(),
  sourceTaskId:z.uuid().optional(), receiptIds: z.array(z.string()).max(512).optional(), expectedRevision: z.number().int().positive().optional(), proposal: z.unknown().optional() });
export interface SupervisorOptions {
  context: PlanContext; engine: "pi" | "codex"; connectionId: string; accountRef: string; projectPath: string;
  previous?: TaskExecution; previousPlan?: ResearchGoalPlan; instructions?: string;
  originalRequest?:string;
  workingContext?:WorkingContext;
  refreshContext?:(context:WorkingContext)=>WorkingContext;
  readHistoricalReceipts?:(context:WorkingContext,taskId:string,receiptIds:string[])=>unknown;
  capabilityFacts?:()=>CapabilityFact[];
  deferJobs?:(state:TaskExecution)=>{campaignId:string;until:number;jobIds:string[]}|null;
  sourceRetrievalComplete?:()=>boolean;
  modelCompletionIssue?:()=>string|null;
  deliveryIssue?:()=>string|null;
  resolveArtifact?:(stepId:string,name:string)=>Promise<string|null>;
  researchContext?: () => { inputVersions?:NonNullable<PlanContext["inputVersions"]>;evidence: NonNullable<PlanContext["evidence"]>; guidance:string;sourceUnits?:readonly string[] } | null;
  now?: () => number; startedAt?: number;
  parentTaskId?:string; deadline?:number;
  admit?:(kind:"check"|"request"|"tool",permissions?:readonly Permission[])=>void;
  persist(state: TaskExecution, expectedVersion: number | null, event: ExecutionEvent): void;
  savePlan(plan: ResearchGoalPlan): void;
  saveResult(hash: string, value: unknown): string;
  readResult(ref: string): unknown;
}
/** One journal and admission policy. It NEVER executes, retries or resubmits an engine tool. */
export class TaskSupervisor implements ExecutionControl {
  private current: ResearchGoalPlan | null;
  private state: TaskExecution;
  private clock: () => number;
  constructor(private options: SupervisorOptions) {
    this.clock = options.now ?? Date.now;
    this.current = options.previousPlan ?? null;
    const startedAt = options.startedAt ?? this.clock();
    this.state = options.previous ? taskExecutionSchema.parse(structuredClone(options.previous)) : taskExecutionSchema.parse({
      schemaVersion: "task-execution-v1", ...(options.parentTaskId?{parentTaskId:options.parentTaskId}:{}), task: options.context.task, grant: options.context.grant,
      engine: options.engine, connectionId: options.connectionId, accountRef: options.accountRef,
      version: 0, sequence: 0, planRevision: 0, startedAt, deadline: options.deadline ?? startedAt + options.context.grant.maxSeconds * 1000,
      state: "running", reason: null, activeStepId: null, steps: [], attempts: [], requests: [], ...(options.workingContext?{workingContext:options.workingContext}:{}),
    });
    if (options.previous && (digest(this.state.task) !== digest(options.context.task) || this.state.engine !== options.engine ||
      this.state.connectionId !== options.connectionId || this.state.accountRef !== options.accountRef || digest(this.state.grant) !== digest(options.context.grant)))
      throw new AgentError("CONFLICT", "恢复必须使用原任务、授权、账户、引擎和模型连接");
    if (options.previous && this.current?.planRevision !== this.state.planRevision) throw new AgentError("CONFLICT", "计划与执行记录版本不一致，先核对回执");
    if (!options.previous) this.save("step", "task", "running", null, null);
  }
  private refreshCapabilities() {
    const previous = this.state.awareness?.capabilities ?? null;
    const next = capabilitySnapshot(previous, [...toolCapabilityFacts(this.options.context.methods,this.state.grant.permissions,this.current,this.state.activeStepId,this.state.attempts),...(this.options.capabilityFacts?.()??[])]);
    if (next === previous) return;
    this.state.awareness ??= { capabilities:null,knowledgeRevision:0,facts:[],corrections:[] };
    this.state.awareness.capabilities = next;
    const facts = capabilityKnowledge(next);
    for(const old of this.state.awareness.facts.filter(f=>f.key.startsWith('capability:')&&!facts.some(n=>n.key===f.key)))
      facts.push({key:old.key,value:null,source:'capabilities:'+next.revision,sourceHash:next.digest});
    this.updateKnowledge(facts);
    delete this.state.answerAssessment;
    this.save('revision','capabilities','updated','Host capabilities revision '+next.revision);
  }
  private updateKnowledge(facts:Array<Pick<KnowledgeFact,'key'|'value'|'source'|'sourceHash'>>) {
    const awareness=this.state.awareness ??= { capabilities:null,knowledgeRevision:0,facts:[],corrections:[] };
    for(const fact of facts){
      const previous=awareness.facts.find(f=>f.key===fact.key);
      if(previous?.value===fact.value&&(fact.key.startsWith('capability:')||previous.source===fact.source&&previous.planRevision===this.state.planRevision))continue;
      awareness.knowledgeRevision++;
      if(previous)awareness.corrections.push({key:fact.key,previousSource:previous.source,source:fact.source,revision:awareness.knowledgeRevision});
      awareness.facts=awareness.facts.filter(f=>f.key!==fact.key);
      awareness.facts.push({...fact,revision:awareness.knowledgeRevision,planRevision:this.state.planRevision});
    }
    awareness.facts=awareness.facts.slice(-512);awareness.corrections=awareness.corrections.slice(-64);
  }
  checkAnswer(text:string,claims?:AnswerClaim[]){
    this.refreshCapabilities();
    const currentClaims=claims??(this.state.answerAssessment?.answerHash===digest(text)?this.state.answerAssessment.claims:[]);
    const assessment=assessAnswer(text,currentClaims,this.state.awareness?.capabilities??null,this.snapshot(),this.options.readResult,this.options.projectPath);
    this.state.answerAssessment=assessment;
    this.save('revision','answer',assessment.status,assessment.issues.join('; ')||'Structured claims only; narrative and scientific validity require review');
    return structuredClone(assessment);
  }
  capabilities(){this.refreshCapabilities();return structuredClone(this.state.awareness?.capabilities??null);}
  snapshot() { return structuredClone(this.state); }
  recordRecovery(fault:import('../../contracts/src/recovery.js').RecoveryFault){
    if(this.state.state==='blocked'&&this.state.recovery?.lastFault.kind==='budget')return false;
    this.check();if(!this.canRecoverModelResponse())return false;
    const admitted=admitCorrection(this.state,fault);
    if(!admitted){this.state.state='blocked';this.state.reason='有限恢复预算已用尽；保留原回执 / Recovery budget exhausted';this.state.recovery!.lastFault={kind:'budget',phase:'rejected',next:'stop'};}
    this.save('revision','recovery',admitted?'admitted':'exhausted',fault.kind);return admitted;
  }
  recordFailure(fault:import('../../contracts/src/recovery.js').RecoveryFault){
    this.state.recovery={corrections:0,total:0,progress:[],...this.state.recovery,lastFault:fault};this.save('revision','failure','recorded',fault.kind);
  }
  canRecoverModelResponse(){return (this.state.accountRef==='local'||this.state.requests.length>0&&this.state.requests.every(r=>r.state==='completed'))&&this.state.state==='running'&&this.clock()<this.state.deadline&&
    !this.state.attempts.some(a=>['running','unknown'].includes(a.state))&&!this.unfinishedJobs();}
  sourceRetrievalComplete(){return this.canRecoverModelResponse()&&this.options.sourceRetrievalComplete?.()===true;}
  modelCompletionIssue(){return this.options.modelCompletionIssue?.()??null;}
  plan() { return this.current ? structuredClone(this.current) : null; }
  originalRequest(){return this.current?.originalRequest??this.options.originalRequest??'';}
  planningContext(){
    const research=this.options.researchContext?.(),descriptions=this.options.context.methodDescriptions,units=research?.sourceUnits??this.options.context.sourceUnits;
    return {interactivePlanning:true,inputVersions:this.options.context.inputVersions??[],evidence:research?.evidence??this.options.context.evidence??[],
      ...(descriptions?{methodDescriptions:descriptions}:{}),...(units?{sourceUnits:units}:{})};
  }
  private save(type: ExecutionEvent["type"], id: string, state: string, detail: string | null, expected: number | null = this.state.version) {
    this.state.sequence++; this.state.version++;
    const event: ExecutionEvent = { taskId: this.state.task.taskId, sequence: this.state.sequence, at: this.clock(), planRevision: this.state.planRevision, type, id, state, detail };
    this.refreshWorkingContext();
    this.options.persist(this.snapshot(), expected, event);
  }
  private refreshWorkingContext(){
    const context=this.state.workingContext;if(!context)return;
    const updated=this.options.refreshContext?.(context)??context;
    this.state.workingContext=attachReadings(updated,this.state,this.options.readResult);
  }
  private continuityIssue(){
    this.refreshWorkingContext();const c=this.state.workingContext;
    return c?.ambiguities.join('; ')||c?.references.filter(r=>['stale','not-authorized','unreadable'].includes(r.status)).map(r=>'Input changed or unavailable: '+r.kind+':'+r.id).join('; ')||null;
  }
  private check() {
    this.options.admit?.("check");
    if(this.state.state==='blocked'&&this.state.recovery?.lastFault.kind==='budget')throw recoveryError('EXECUTION_FAILED',this.state.reason??'Recovery budget exhausted','budget');
    if (this.state.state !== "running") throw new AgentError(this.state.state === "cancelled" ? "CANCELLED" : "CONFLICT", this.state.reason ?? "任务不是执行状态");
    if (this.clock() >= this.state.deadline) throw new AgentError("BUDGET_EXCEEDED", "任务达到时间上限；保留真实回执，未重新提交");
  }
  acceptPlan(plan: ResearchGoalPlan) {
    this.check();
    if (this.current) {
      if (digest(this.current) === digest(plan)) return;
      throw new AgentError("CONFLICT", "已有研究计划；修订必须检查预期版本");
    }
    const valid = validateResearchPlan(plan, {...this.options.context,...this.planningContext()});
    this.options.savePlan(valid); this.current = valid; this.state.planRevision = valid.planRevision;
    this.state.deadline = Math.min(this.state.deadline, this.state.startedAt + valid.constraints.maxSeconds * 1000);
    this.state.steps = valid.steps.map(s => ({ id: s.id, state: "pending", reason: null }));
    this.refresh(); this.save("plan", valid.goalId, "accepted", null);
  }
  private refresh() {
    if (!this.current) return;
    for (const step of this.state.steps) {
      if (!["pending", "blocked"].includes(step.state)) continue;
      const missing = this.current.cognition.missing.filter(m => m.blocks.includes(step.id as any));
      const conflicts = this.current.cognition.conflicts.filter((_c,i)=>{const scope=this.current!.cognition.conflictScopes?.find(s=>s.conflictIndex===i);return !scope||scope.blocks.includes(step.id as any);});
      if (missing.length || conflicts.length) { step.state = "blocked"; step.reason = [...missing.map(m => m.question), ...conflicts].join("；"); }
      else { step.state = "pending"; step.reason = null; }
    }
  }
  private ready(method?: string) {
    if (!this.current) return [];
    return this.current.steps.filter(s => {
      const status = this.state.steps.find(x => x.id === s.id)!;
      return ["pending", "running", "failed"].includes(status.state) && (!method || supportsPlannedMethod(s.method,method)) &&
        s.dependsOn.every(id => this.state.steps.find(x => x.id === id)?.state === "completed");
    });
  }
  authorize(name: string, permissions: readonly Permission[]) {
    this.check();
    if (!this.current) throw new AgentError("INVALID_PLAN", "计划尚未校验，不执行工具");
    if (name === "task_control") return;
    this.options.admit?.("check",permissions);
    if (["find_tools", "invoke_material_tool"].includes(name)) {
      if (permissions.some(p => !this.state.grant.permissions.includes(p) || !this.current!.constraints.permissions.includes(p))) throw new AgentError("PERMISSION_DENIED", "工具发现超出授权");
      return;
    }
    const candidates = this.ready(name);
    const primary=candidates.filter(s=>s.method===name);
    const choices=primary.length?primary:candidates;
    // Fixed file contracts can complete before the native turn finishes reading back/correcting its files.
    // Continue only this single direct file step, never a completed backend or a dependency graph.
    const fileContinuation=this.current.executionMode==='direct'&&this.current.steps.length===1&&
      this.current.steps[0]!.method==='engine.execute'&&this.current.steps[0]!.expectedArtifacts.length>0&&
      this.state.steps[0]?.state==='completed'&&
      ['read','ls','find','grep','rg','read_skill','read_material_file','exec_command','write_stdin','apply_patch','write','edit','bash'].includes(name)
      ?this.current.steps[0]:undefined;
    const selected = choices.find(s => s.id === this.state.activeStepId) ?? (choices.length===1?choices[0]:fileContinuation);
    if(choices.length>1&&!selected)throw recoveryError("INVALID_PLAN", "STEP_SELECTION_REQUIRED: 多个已就绪步骤可接收工具；请使用 task_control {action:begin,stepId} 选择 / Select one ready step: "+JSON.stringify(choices.map(s=>({stepId:s.id,method:s.method,inputRefs:s.inputRefs}))),'step-selection');
    if (!selected) throw recoveryError("INVALID_PLAN", "依赖尚未完成：先完成当前步骤再开始已就绪步骤；实际控制候选 / Use the actual task_control candidate: "+JSON.stringify(this.controlCandidates()),'step-selection');
    if (permissions.some(p => !this.state.grant.permissions.includes(p) || !this.current!.constraints.permissions.includes(p) || !selected.permissions.includes(p)))
      throw new AgentError("PERMISSION_DENIED", "工具超出本轮或当前步骤授权");
    return selected.id;
  }
  beforeTool(call: ToolExecution) {
    this.check();
    if(call.permissions.some(p=>!this.state.grant.permissions.includes(p)||!this.current?.constraints.permissions.includes(p)))throw new AgentError("PERMISSION_DENIED","工具超出原授权");
    const old=this.state.attempts.find(a=>a.id===call.id);
    if(old){
      const input=old.inputRef?this.options.readResult(old.inputRef):null;
      if(digest(canonical(input))!==digest(canonical({method:call.name,args:call.args})))throw new AgentError("CONFLICT","工具调用 ID 被用于不同输入");
      if(old.planRevision!==this.state.planRevision||old.state!=="completed"||!old.resultRef)throw new AgentError("RECONCILIATION_REQUIRED","原调用未完成或属于旧版本，未重复执行");
      return this.options.readResult(old.resultRef);
    }
    this.check();
    const selected=this.authorize(call.name, call.permissions);
    if(call.name==="write_stdin"&&!this.state.attempts.some(a=>a.stepId===selected&&a.planRevision===this.state.planRevision&&a.jobIds.includes("native-session:"+(call.args as any)?.session_id)))throw new AgentError("PERMISSION_DENIED","终端会话不属于当前步骤 / Native session is not owned by this step");
    if(this.current?.planningStage==='exploration'&&requiresResearchPlan(call))
      throw recoveryError('INVALID_PLAN','PLAN_REQUIRED: This call has not executed. For this one backend use task_control '+JSON.stringify({action:'plan',method:call.name})+'; the host preserves the original goal, constraints, inputs and budget. For dependent multi-step research submit a full proposal in the SAME task.','plan-required');
    const stepId = selected!;
    const fingerprint = digest(canonical({ stepId, name: call.name, args: call.args, inputs: this.current!.inputVersionRefs }));
    const action = (call.args as any)?.action;
    const mutable = isMutableTool(call);
    const continuity=mutable?this.continuityIssue():null;
    if(continuity&&action!=="cancel")throw new AgentError("INVALID_PLAN",continuity);
    if (mutable && call.name!=="write_stdin" && action !== "cancel" && !call.name.startsWith("cancel_")) {
      const latest=new Map<string,string>();
      for(const a of this.state.attempts.filter(a=>a.stepId===stepId&&a.state!=="stale"))for(const job of a.jobs)latest.set(job.id,job.state);
      if([...latest.values()].some(s=>!["completed","failed","cancelled","interrupted"].includes(s)))throw recoveryError("RECONCILIATION_REQUIRED","本步骤已有在途计算；先查询或取消，不再提交计算 / Owned pending queries: "+JSON.stringify(pendingJobGuidance(this.state,this.options.readResult).filter(j=>j.stepId===stepId)),'job-pending','pending');
    }
    const matching = this.state.attempts.filter(a => a.fingerprint === fingerprint && a.state !== "stale");
    if (mutable && matching.some(a => ["running", "unknown"].includes(a.state)))
      throw new AgentError("RECONCILIATION_REQUIRED", "同一操作仍在运行或回执未知；先查询真实状态，不重复提交");
    const completed = mutable ? matching.find(a => a.state === "completed" && a.resultRef) : undefined;
    if (completed) return this.options.readResult(completed.resultRef!);
    const failedCommand=this.state.attempts.filter(a=>a.fingerprint===fingerprint&&a.failure&&['script','environment'].includes(a.failure.kind)).at(-1);
    const repaired=failedCommand&&this.state.attempts.slice(this.state.attempts.indexOf(failedCommand)+1).some(a=>a.state==='completed'&&['apply_patch','write','edit','environment_repair'].includes(a.method));
    if(mutable&&failedCommand&&!repaired)
      throw recoveryError('EXECUTION_FAILED','已失败的相同脚本未再次执行；先读取真实 stderr 和源码，做出有效修正再核验 / Identical failed command was not replayed','script','rejected');
    if(mutable)requireFailureBudget(this.state);
    const stepAttempts=this.state.attempts.filter(a=>a.stepId===stepId);
    const failedJobs=new Set(stepAttempts.flatMap(a=>a.jobs.filter(j=>j.state==="failed").map(j=>j.id)));
    const failed = stepAttempts.filter(a=>a.state==="failed").length + (mutable?failedJobs.size:0);
    const rules = this.current!.adjustmentRules.filter(r => r.affectedSteps.includes(stepId as any) && r.action !== "stop");
    const repairs = rules.length ? Math.min(2, Math.max(...rules.map(r => r.maxRetries))) : 2;
    if (mutable&&failed > repairs) throw recoveryError("EXECUTION_FAILED", "本步骤两次纠错仍失败；停止重试并保留回执",'budget');
    if (this.state.attempts.length >= 512) throw new AgentError("BUDGET_EXCEEDED", "工具回执达到本轮上限");
    this.options.admit?.("tool",call.permissions);
    const input={method:call.name,args:call.args};const inputRef=this.options.saveResult(digest(input),input);
    this.state.attempts.push({ inputRef, id: call.id, stepId, method: call.name, fingerprint, planRevision: this.state.planRevision,
      state: "running", startedAt: this.clock(), endedAt: null, resultRef: null, errorFingerprint: null, jobIds: [], jobs: [] });
    this.state.activeStepId=stepId;
    const step = this.state.steps.find(s => s.id === stepId)!; step.state = "running"; step.reason = null;
    delete this.state.answerAssessment;
    this.save("tool", call.id, "running", call.name);
    return undefined;
  }
  afterTool(id: string, result: unknown, isError: boolean, jobs: string[] = []) {
    const attempt = this.state.attempts.find(a => a.id === id);
    if (!attempt) return; // A denied call is never represented as an executed tool.
    const native=["exec_command","write_stdin","engine.execute"].includes(attempt.method);
    isError=isError||(result as any)?.isError===true||(native&&nativeToolFailed(result));
    if (attempt.state !== "running") {
      if (attempt.resultRef === digest(result)&&((attempt.state==="failed")===isError)) return;
      throw new AgentError("CONFLICT", "终态回执不能被重复或乱序输出覆盖");
    }
    attempt.endedAt = this.clock(); attempt.resultRef = this.options.saveResult(digest(result), result);
    attempt.errorFingerprint = isError ? digest(canonical({ method: attempt.method, result })) : null;
    attempt.jobs = native||["read","read_skill","read_material_file","research_data","paper_read","paper_get"].includes(attempt.method)?[]:observedJobs(result);
    if(native||attempt.method==='bash'){attempt.nativeReceipt=nativeReceiptMetadata((result as any)?.content??result);
      const input=attempt.inputRef?this.options.readResult(attempt.inputRef) as any:null;
      const session=attempt.nativeReceipt.sessionId??(attempt.method==="write_stdin"?input?.args?.session_id:null);
      if(session!=null)attempt.jobs.push({id:"native-session:"+session,state:attempt.nativeReceipt.exitCode!=null?(isError?"failed":"completed"):"running"});
    }
    if(attempt.jobs.some(j=>j.state==="failed"))attempt.errorFingerprint=digest(canonical({method:attempt.method,jobs:attempt.jobs}));
    attempt.jobIds = [...new Set([...jobs, ...attempt.jobs.map(j=>j.id)])].slice(0, 32);
    attempt.state = isError ? "failed" : native&&["exec_command","write_stdin"].includes(attempt.method)&&attempt.nativeReceipt?.exitCode===null&&attempt.nativeReceipt.sessionId===null ? "unknown" : "completed";
    attempt.failure=failureFromReceipt(attempt.method,id,result,isError||attempt.jobs.some(j=>j.state==='failed'),attempt.state==='unknown');
    if (this.state.state === "cancelled" || attempt.planRevision !== this.state.planRevision) attempt.state = "stale";
    const step = this.state.steps.find(s => s.id === attempt.stepId);
    if (step && attempt.state !== "stale") step.state = isError ? "failed" : "running";
    if(attempt.state==='completed')this.updateKnowledge(receiptKnowledge(attempt.method,id,result,digest(result)));
    delete this.state.answerAssessment;
    this.save("tool", id, attempt.state, attempt.method);
  }
  summary(contextByteBudget=16000) {
    this.refreshCapabilities();this.refreshWorkingContext();
    const capabilities=capabilityContext(this.state.awareness?.capabilities??null,this.originalRequest());
    const currentKeys=new Set(capabilities?.facts.map(f=>'capability:'+f.id));
    let research:unknown=this.options.researchContext?.()?.guidance??null;
    if(typeof research==='string'){try{research=JSON.parse(research);}catch{/* Plain guidance remains plain text. */}}
    return JSON.stringify({ goal: this.current, ...(this.state.workingContext?{currentWork:currentWork(this.current,this.state,this.originalRequest()),
      workingContext:projectContext(this.state.workingContext,contextByteBudget)}:{}), execution: { taskId: this.state.task.taskId, planRevision: this.state.planRevision,
      state: this.state.state, deadline: this.state.deadline, activeStepId: this.state.activeStepId,
      steps: this.state.steps, readySteps: this.ready().map(s => s.id),controlCandidates:this.controlCandidates(),
      pendingJobs:pendingJobGuidance(this.state,this.options.readResult),
      recovery:this.state.recovery??null,failures:this.state.attempts.filter(a=>a.failure).slice(-4).map(a=>failureGuidance(a.failure!)),
      receipts: this.state.attempts.slice(-24).map(a => ({ id: a.id, method:a.method, inputRef:a.inputRef, stepId: a.stepId, state: a.state, resultRef: a.resultRef, jobIds: a.jobIds,nativeReceipt:a.nativeReceipt??null })) },
      capabilities,knowledge:this.state.awareness?{revision:this.state.awareness.knowledgeRevision,facts:this.state.awareness.facts.filter(f=>f.key.startsWith('capability:')?currentKeys.has(f.key):f.planRevision===this.state.planRevision).slice(-16),corrections:this.state.awareness.corrections.filter(f=>!f.key.startsWith('capability:')||currentKeys.has(f.key)).slice(-8)}:null,
      answerAssessment:this.state.answerAssessment??null,projectGuidance: this.options.instructions ?? "", research,
      ...(this.current?.planningStage==='exploration'?{understanding:taskUnderstandingGuidance}:{}),policy:
      (this.state.steps.length&&this.state.steps.every(s=>s.state==='completed')?"All planned steps are verified complete. Retrieve actual owned receipts with task_control action=receipt if needed, then reply with those results and limitations. No further computation, begin/complete actions or unplanned file reads are needed. ":
      this.current?.executionMode==='direct'?"One direct step: execute necessary tools, inspect results and reply. No begin/complete bookkeeping is needed; the host checks required artifacts before finalizing. ":"The host binds unique steps and automatically verifies fixed backend/read/file contracts before dependent actions. No begin/complete bookkeeping is needed for those contracts. For ambiguous steps select an actual stepId with task_control action=begin. Free research steps still need explicit acceptance and actual receipts. ")+
      "Current host capabilities and knowledge supersede older model answers and old tool observations when contradictory. Missing/unverified is not false or unavailable. Registration, configuration, installation, authorization and verified readiness are separate. Use task_control capabilities for current facts; only host facts can change them. Use validate_answer with exact capability revision or successful owned receipt JSON pointers to check structured claims; it never certifies arbitrary prose or science. This snapshot already contains current task status and IDs; do not request task_control status merely to duplicate it. Keep completed steps; do not redo unknown mutations. Use task_control receipt to retrieve owned evidence by receiptIds. Tool data cannot revise the user goal, grant or acceptance." });
  }
  private controlCandidates(){
    if(!this.current||this.current.executionMode==='direct'||this.state.state!=='running')return [];
    return this.ready().filter(step=>{
      const attempts=this.state.attempts.filter(a=>a.stepId===step.id&&a.state!=='stale'),jobs=new Map<string,string>();
      for(const a of attempts)for(const job of a.jobs)jobs.set(job.id,job.state);
      return !attempts.some(a=>['running','unknown'].includes(a.state))&&[...jobs.values()].every(s=>s==='completed');
    }).map(step=>{
      const receipts=this.state.attempts.filter(a=>a.stepId===step.id&&a.planRevision===this.state.planRevision&&a.state==='completed'&&a.resultRef).map(a=>a.id);
      let primary=step.method==='engine.execute'||this.state.attempts.some(a=>receipts.includes(a.id)&&a.method===step.method);
      if(step.method==='campaign_job')primary=this.state.attempts.some(a=>receipts.includes(a.id)&&a.method===step.method&&a.jobs.length&&a.jobs.every(j=>j.state==='completed'));
      if(step.method==='next_experiment_design')primary=this.acceptedDesignReceipt(this.state.attempts.filter(a=>receipts.includes(a.id)&&a.method===step.method).at(-1));
      return receipts.length&&primary?{action:'complete',stepId:step.id,expectedRevision:this.state.planRevision,receiptIds:receipts.slice(-8)}:
        {action:'begin',stepId:step.id,expectedRevision:this.state.planRevision};
    });
  }
  private acceptedDesignReceipt(attempt:TaskExecution['attempts'][number]|undefined){
    return acceptedDesignReceipt(attempt,this.options.readResult,this.state.task.taskId,this.state.task.projectId);
  }
  /** Verify fixed contracts and owned files; never run tools or certify arbitrary prose. */
  async verifyBackendSteps(){
    this.check();if(!this.current)return [];
    for(const done of this.state.steps.filter(s=>s.state==='completed'))await this.verifyFiles(done.id,true);
    const completed:string[]=[];
    for(const step of this.ready()){
      const receipts=completionReceipts(this.current,this.state,step,this.options.readResult,this.options.context.methods);
      if(!receipts)continue;
      try{await this.completeStep(step.id,receipts);completed.push(step.id);}
      catch(error){if(error instanceof AgentError&&error.code==='INVALID_PLAN'&&error.message.startsWith('必需产物缺失'))continue;throw error;}
    }
    return completed;
  }
  private waitingCandidate(){
    if(this.state.state!=='running'||this.clock()>=this.state.deadline||this.state.requests.some(r=>['running','unknown'].includes(r.state))||this.state.attempts.some(a=>['running','unknown','failed'].includes(a.state)))return null;
    if(this.state.requests.at(-1)?.phase==='execute'&&this.state.requests.at(-1)?.planRevision!==this.state.planRevision)return null;
    const candidate=this.options.deferJobs?.(this.snapshot());if(!candidate||candidate.until<=this.clock())return null;
    const jobs=new Map<string,string>();for(const a of this.state.attempts.filter(a=>a.state!=='stale'))for(const j of a.jobs)jobs.set(j.id,j.state);
    const pending=[...jobs].filter(([,s])=>s!=='completed');
    return pending.length&&pending.every(([id,s])=>candidate.jobIds.includes(id)&&['queued','running','prepared'].includes(s))?candidate:null;
  }
  canWaitForJobs(){return !!this.waitingCandidate();}
  beforeRequest(payload: any, phase: "interpret" | "execute" | "compact", window: number, maxOutput: number, requestId?: string) {
    this.check();
    if(this.sourceRetrievalComplete())throw new VerifiedSourceReady();
    if(this.canWaitForJobs())throw new AgentError('RECONCILIATION_REQUIRED','COMPUTATION_PENDING: model session paused; query the original job before resume');
    if (this.state.accountRef !== "local" && this.current && this.current.constraints.maxCredits !== this.state.grant.maxCredits)
      throw new AgentError("BUDGET_EXCEEDED", "积分上限已收紧，当前 M5 任务不能扩大或重建预算；先核对原任务账单");
    if (requestId && this.state.requests.some(r => r.id === requestId)) throw new AgentError("CONFLICT", "请求 ID 已使用，未再次提交");
    const fitted = fitRequest(payload, window, maxOutput, this.summary(Math.max(2048,Math.min(16000,Math.floor((window-maxOutput)/8))))), id = requestId ?? randomUUID();
    this.options.admit?.("request");
    this.state.requests.push({ id, planRevision:this.state.planRevision, phase, firstTokenAt:null, startedAt: this.clock(), endedAt: null, inputUpperBound: fitted.inputUpperBound,
      outputLimit: maxOutput, compacted: fitted.compacted, ...(this.state.workingContext?{contextSha256:this.state.workingContext.sha256}:{}),...(fitted.historyCompaction?{historyCompaction:fitted.historyCompaction}:{}),state: "running", usage: null });
    this.save("request", id, "running", phase);
    return { id, payload: fitted.payload };
  }
  firstToken(id:string) {
    const request=this.state.requests.find(r=>r.id===id);
    if(!request||request.state!=="running"||request.firstTokenAt!==null)return;
    request.firstTokenAt=this.clock();this.save("request",id,"streaming","first provider delta");
  }
  endRequest(id: string, state: "completed" | "failed" | "unknown", usage: unknown = null, noDispatch=false) {
    const request = this.state.requests.find(r => r.id === id);
    if (!request || request.state !== "running") return;
    request.state = state; request.endedAt = this.clock(); request.usage = usage; if(noDispatch&&state==="failed")request.reconciledAt=this.clock();
    this.save("request", id, state, request.phase);
  }
  async command(input: unknown) {
    const args = commandSchema.parse(input);
    this.check();
    if (args.action === "status") return JSON.parse(this.summary());
    if (args.action === 'capabilities') {this.refreshCapabilities();return capabilityContext(this.state.awareness?.capabilities??null,this.originalRequest(),args.query??'');}
    if (args.action === 'validate_answer') {
      if(args.answer===undefined)throw new AgentError('INVALID_PLAN','validate_answer requires answer and optional exact claims');
      return this.checkAnswer(args.answer,args.claims??[]);
    }
    if (args.action === "receipt") {
      if(!args.receiptIds?.length||args.receiptIds.length>8)throw new AgentError("INVALID_PLAN","每次查询 1–8 个真实回执 ID");
      if(args.sourceTaskId&&args.sourceTaskId!==this.state.task.taskId){
        this.refreshWorkingContext();
        if(!this.state.grant.permissions.includes('read')||!this.state.workingContext||!this.options.readHistoricalReceipts)throw new AgentError('PERMISSION_DENIED','历史回执读取未授权');
        return this.options.readHistoricalReceipts(this.state.workingContext,args.sourceTaskId,args.receiptIds);
      }
      const receipts=args.receiptIds.map(id=>{
        const a=this.state.attempts.find(a=>a.id===id);if(!a)throw new AgentError("PERMISSION_DENIED","回执不属于原任务");
        return {id:a.id,state:a.state,stepId:a.stepId,planRevision:a.planRevision,resultRef:a.resultRef,input:a.inputRef?this.options.readResult(a.inputRef):null,result:a.resultRef?this.options.readResult(a.resultRef):null};
      });
      if(Buffer.byteLength(JSON.stringify(receipts))>65536)throw new AgentError("BUDGET_EXCEEDED","回执查询超过摘要上限，请使用原工具按页/范围读取");
      return {receipts,evidenceOnly:true};
    }
    if(args.action==='plan'){
      if(this.current?.planningStage!=='exploration')throw new AgentError('INVALID_PLAN','初始任务已解释；请保留目标和验收，通过 replan 调整剩余方法');
      const context={...this.options.context,...this.planningContext(),previous:this.current};
      if(args.method!==undefined&&args.proposal!==undefined)throw new AgentError('INVALID_PLAN','Choose method OR a full proposal, not both');
      if(args.proposal===undefined&&args.method===undefined)return {planRevision:this.state.planRevision,
        methods:[...context.methods].filter(([,p])=>p.every(v=>this.state.grant.permissions.includes(v))).map(([method])=>method),
        policy:'For ONE backend use {action:plan,method:<exact registered method>}. Host preserves the current user contract and binds required artifacts. For dependent multi-step research submit the full proposal contract.',
        instruction:interpretationPrompt(this.originalRequest(),context)};
      const next=args.method!==undefined?selectedMethodPlan(this.current,args.method,context):bindProposal(args.proposal,this.originalRequest(),context);
      this.revise(next,this.state.planRevision,'engine');return JSON.parse(this.summary());
    }
    args.expectedRevision??=this.state.planRevision;
    if (args.expectedRevision !== this.state.planRevision) throw new AgentError("CONFLICT", "计划版本不匹配；当前 planRevision="+this.state.planRevision+"，请读取当前版本");
    if (args.action === "replan") {
      this.revise(args.proposal, args.expectedRevision, "engine"); return JSON.parse(this.summary());
    }
    const step = this.state.steps.find(s => s.id === args.stepId);
    if (!step) throw new AgentError("INVALID_PLAN", "不存在的研究步骤");
    if (args.action === "begin") {
      if (!this.ready().some(s => s.id === step.id)) throw new AgentError("INVALID_PLAN", step.reason ?? "步骤依赖未完成");
      this.state.activeStepId = step.id; this.save("step", step.id, "selected", null);
    } else {
      const receipts=args.receiptIds??this.state.attempts.filter(a=>a.stepId===step.id&&a.planRevision===this.state.planRevision&&a.state==='completed').map(a=>a.id);
      await this.completeStep(step.id,receipts);
    }
    return {action:args.action,stepId:step.id,stepState:step.state,planRevision:this.state.planRevision,
      readySteps:this.ready().map(s=>s.id),controlCandidates:this.controlCandidates(),scientificStatus:'needs_review'};
  }
  private async completeStep(stepId:string,receiptIds:string[]){
    const revision=this.state.planRevision,step=this.state.steps.find(s=>s.id===stepId)!;
    if(step.state==='completed'){await this.verifyFiles(stepId,true);return;}
      if(!this.ready().some(s=>s.id===stepId))throw new AgentError('INVALID_PLAN','步骤依赖未完成');
      const receipts = receiptIds;
      if (!receipts.length || receipts.some(id => !this.state.attempts.some(a => a.id === id && a.stepId === stepId && a.planRevision===this.state.planRevision && a.state === "completed")))
        throw new AgentError("INVALID_PLAN", "完成步骤需要本版本、同一步骤的真实成功回执");
      const primary=this.current!.steps.find(s=>s.id===stepId)!.method;
      if(this.current!.executionMode==='direct'&&primary==='engine.execute'){const issue=this.modelCompletionIssue();if(issue)throw new AgentError('INVALID_PLAN',issue);}
      if(primary!=='engine.execute'&&!receipts.some(id=>this.state.attempts.some(a=>a.id===id&&a.method===primary&&a.planRevision===this.state.planRevision)))
        throw new AgentError('INVALID_PLAN','步骤的主要方法尚未完成；前置评估或数据读取不能代替 '+primary);
      if (this.state.attempts.some(a => a.stepId === stepId && ["running", "unknown"].includes(a.state)))
        throw new AgentError("RECONCILIATION_REQUIRED", "步骤还有未确认操作");
      const latestJobs = new Map<string,string>();
      for (const a of this.state.attempts.filter(a=>a.stepId===stepId && a.state!=="stale")) for (const job of a.jobs) latestJobs.set(job.id,job.state);
      if ([...latestJobs.values()].some(state=>state!=="completed")) throw new AgentError("RECONCILIATION_REQUIRED", "实际计算/进程尚未成功结束；先查询真实任务终态");
      if(primary==='materials_science'&&!this.state.attempts.some(a=>receipts.includes(a.id)&&a.method===primary&&a.jobs.length))throw new AgentError('INVALID_PLAN','主要方法缺少真实计算任务回执 / No actual science job receipt');
      await this.verifyFiles(stepId);
      this.check();
      if(revision!==this.state.planRevision||step!==this.state.steps.find(s=>s.id===stepId))throw new AgentError('CONFLICT','Plan changed during completion verification');
      if(!this.ready().some(s=>s.id===stepId)||this.state.attempts.some(a=>a.stepId===stepId&&['running','unknown'].includes(a.state)))throw new AgentError('RECONCILIATION_REQUIRED','Step changed during completion verification');
      const currentJobs=new Map<string,string>();for(const a of this.state.attempts.filter(a=>a.stepId===stepId&&a.state!=='stale'))for(const j of a.jobs)currentJobs.set(j.id,j.state);
      if([...currentJobs.values()].some(s=>s!=='completed'))throw new AgentError('RECONCILIATION_REQUIRED','Job changed during completion verification');
      step.state="completed";step.reason=null;if(this.state.activeStepId===stepId)this.state.activeStepId=null;
      this.save("step",stepId,"completed","host-verified technical receipts; scientific acceptance remains separate");
  }
  private async verifyFiles(id: string, existing=false) {
    const revision=this.state.planRevision,status=this.state.steps.find(s=>s.id===id)!;
    const artifacts:NonNullable<typeof status.artifacts>=[];
    const step = this.current!.steps.find(s => s.id === id)!;
    const root = await realpath(this.options.projectPath);
    for (const name of step.expectedArtifacts) {
      const resolved=await this.options.resolveArtifact?.(id,name);
      const path = await realpath(resolve(root, resolved??name)).catch(() => null);
      const rel = path ? relative(root, path) : "..";
      if (!path || isAbsolute(rel) || rel === ".." || rel.startsWith("../")) throw new AgentError("INVALID_PLAN", "必需产物缺失或不在项目内：" + name);
      const before = await stat(path);
      if (!before.isFile() || before.size > 64 * 1024 * 1024) throw new AgentError("BUDGET_EXCEEDED", "产物大小超过读取上限或不是普通文件");
      const bytes = await readFile(path);
      const after = await stat(path);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new AgentError("CONFLICT", "验证期间产物发生变化");
      if (bytes.length > 64 * 1024 * 1024) throw new AgentError("BUDGET_EXCEEDED", "产物验证超过本轮读取上限");
      const value = { name, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, verified: true as const };
      const prior=status.artifacts?.find(a=>a.name===name);
      if(existing&&prior&&(prior.sha256!==value.sha256||prior.bytes!==value.bytes||prior.path!==relative(root,path)))throw new AgentError("INVALID_PLAN","已验收产物发生变化 / Verified artifact changed: "+name);
      artifacts.push({...value,path:relative(root,path),planRevision:this.state.planRevision});
      this.options.saveResult(digest(value), value);
    }
    this.check();
    if(revision!==this.state.planRevision||status!==this.state.steps.find(s=>s.id===id)||step!==this.current?.steps.find(s=>s.id===id))throw new AgentError('CONFLICT','Plan changed during artifact verification');
    if(!existing||!status.artifacts)status.artifacts=artifacts;
  }
  revise(input: unknown, expectedRevision: number, actor: "user" | "engine", trustedInputs?: ResearchGoalPlan["inputVersionRefs"]) {
    if(this.state.waiting)throw new AgentError('RECONCILIATION_REQUIRED','先核对并恢复原计算任务，再修订计划');
    if (!this.current || expectedRevision !== this.state.planRevision) throw new AgentError("CONFLICT", "研究计划版本冲突");
    const next = validateResearchPlan(input, { ...this.options.context, ...this.planningContext(), previous: this.current, inputVersions: trustedInputs ?? this.options.context.inputVersions ?? [] });
    if(actor==='engine')preserveConstraints(this.current,next);
    const interpreted=actor==='engine'&&initialInterpretation(this.current,next,this.state,this.options.context.methods,this.options.readResult);
    if(actor==='engine'&&!interpreted&&next.planningStage!==this.current.planningStage)throw new AgentError('PERMISSION_DENIED','模型不能重置已确认的解释阶段');
    if (actor === "engine" && !interpreted && (digest(next.goal) !== digest(this.current.goal) || next.originalRequest !== this.current.originalRequest ||
      digest(next.acceptance) !== digest(this.current.acceptance) || digest(next.inputVersionRefs) !== digest(this.current.inputVersionRefs) ||
      digest(next.cognition.facts) !== digest(this.current.cognition.facts))) throw new AgentError("PERMISSION_DENIED", "模型重规划不能改变用户目标、验收、输入或确认事实");
    if (this.state.attempts.some(a => ["running", "unknown"].includes(a.state)) || this.unfinishedJobs()) throw new AgentError("RECONCILIATION_REQUIRED", "先取消并核实在途工具，未确认前不能重复提交");
    const changed = new Set<string>();
    for(const old of this.current.steps)if(!next.steps.some(s=>s.id===old.id))changed.add(old.id);
    for (const step of next.steps) {
      const old = this.current.steps.find(s => s.id === step.id);
      const affectedInput = step.inputRefs.some(id => digest(next.inputVersionRefs.find(i => i.id === id)) !== digest(this.current!.inputVersionRefs.find(i => i.id === id)));
      if (!old || digest(step) !== digest(old) || affectedInput || digest(next.constraints) !== digest(this.current.constraints) || (digest(next.goal) !== digest(this.current.goal) && step.inputRefs.some(id => this.current!.userMessageRefs.includes(id)))) changed.add(step.id);
    }
    let more = true;
    while (more) { more = false; for (const step of next.steps) if (!changed.has(step.id) && step.dependsOn.some(id => changed.has(id))) { changed.add(step.id); more = true; } }
    if (actor === "engine" && !changed.size && digest(next.cognition) === digest(this.current.cognition)) throw new AgentError("INVALID_PLAN", "重规划需要实际改变方法、输入依赖或缺失条件，不能只增加版本来重试");
    this.options.savePlan(next); this.current = next; this.options.context.inputVersions = next.inputVersionRefs; this.state.planRevision = next.planRevision;
    delete this.state.answerAssessment;
    this.state.deadline = Math.min(this.state.deadline, this.state.startedAt + next.constraints.maxSeconds * 1000 + (this.state.waitingMs??0));
    this.state.steps = next.steps.map(s => changed.has(s.id) ? { id: s.id, state: "pending" as const, reason: "input/method/dependency revised" } : this.state.steps.find(x => x.id === s.id)!);
    for (const a of this.state.attempts) if (!interpreted && changed.has(a.stepId) && ["completed", "failed"].includes(a.state)) a.state = "stale";
    if(actor==="user"&&changed.size&&this.state.state==="completed_with_limitations")this.state.state="interrupted";
    this.state.activeStepId = null; this.refresh(); this.save("revision", next.goalId, "accepted", actor);
  }
  private unfinishedJobs() {
    const latest = new Map<string, string>();
    for (const a of this.state.attempts.filter(a => a.state !== "stale")) for (const j of a.jobs) latest.set(j.id, j.state);
    return [...latest.values()].some(s => !["completed", "failed", "cancelled", "interrupted"].includes(s));
  }
  reconcileRequests(records: Array<{id:string; state:"completed"|"failed"; usage:unknown}>,detail="actual M5 receipts, no provider invocation") {
    for (const record of records) {
      const request = this.state.requests.find(r => r.id === record.id);
      if (!request || !["running", "unknown","failed"].includes(request.state)) continue;
      request.state = record.state; request.endedAt ??= this.clock(); request.usage = record.usage;request.reconciledAt=this.clock();
      delete this.state.answerAssessment;
    }
    this.save("request", "reconcile", "checked", detail);
  }
  reconcileJobs(records: Array<{ id: string; state: string;runId?:string }>) {
    for (const record of records) for (const attempt of this.state.attempts) {
      if (!attempt.jobIds.includes(record.id)) continue;
      if (!["completed", "failed", "cancelled", "interrupted"].includes(record.state)) continue;
      delete this.state.answerAssessment;
      attempt.jobs = attempt.jobs.filter(j=>j.id!==record.id).concat({id:record.id,state:record.state});
      if(record.runId&&record.state==='completed'){
        attempt.jobIds=[...new Set([...attempt.jobIds,record.runId])];
        attempt.jobs=attempt.jobs.filter(j=>j.id!==record.runId).concat({id:record.runId,state:'completed'});
      }
      if (attempt.state === "unknown" && attempt.jobIds.every(id=>attempt.jobs.some(j=>j.id===id&&["completed","failed","cancelled","interrupted"].includes(j.state)))) attempt.state = attempt.jobs.every(j=>j.state==="completed") ? "completed" : "failed";
    }
    this.save("tool", "reconcile", "checked", "queried actual owned job receipts; no resubmission");
  }
  resume() {
    if(this.state.waiting){
      const w=this.state.waiting;if(this.state.state!=='waiting'||this.clock()>=w.until)throw new AgentError('BUDGET_EXCEEDED','计算等待期限已结束');
      if(this.unfinishedJobs()||this.state.attempts.some(a=>['running','unknown'].includes(a.state)))throw new AgentError('RECONCILIATION_REQUIRED','先查询原计算终态，未提交新任务');
      this.state.deadline=Math.min(w.until,this.clock()+w.remainingActiveMs);this.state.waitingMs=(this.state.waitingMs??0)+this.clock()-w.startedAt;delete this.state.waiting;
    }
    if (this.clock() >= this.state.deadline) throw new AgentError("BUDGET_EXCEEDED", "原任务时间预算已耗尽，恢复不会重置预算");
    if (this.state.attempts.some(a=>["running","unknown"].includes(a.state)) || this.unfinishedJobs() ||
      (this.state.accountRef!=="local" && this.state.requests.some(r=>["running","unknown"].includes(r.state))))
      throw new AgentError("RECONCILIATION_REQUIRED", "回执尚未确认；先查询原任务，不提交新 attempt 或重复扣费");
    this.state.state="running";this.state.reason=null;this.save("step","resume","running","original budget, engine, connection and receipts retained");
  }
  finish(state: "completed_with_limitations" | "failed" | "cancelled", reason = "") {
    if (this.state.state !== "running") return;
    if(state==="completed_with_limitations" && this.clock()>=this.state.deadline){state="failed";reason="任务达到时间上限，未放宽完成条件";}
    for (const request of this.state.requests) if (request.state === "running") { request.state = "unknown"; request.endedAt = this.clock(); }
    for (const attempt of this.state.attempts) if (attempt.state === "running") attempt.state = "unknown";
    const latestJobs = new Map<string,string>();
    for (const a of this.state.attempts.filter(a=>a.state!=="stale")) for (const job of a.jobs) latestJobs.set(job.id,job.state);
    const outdatedResponse=this.state.requests.at(-1)?.phase === "execute" && this.state.requests.at(-1)?.planRevision !== this.state.planRevision;
    const waiting=state==='completed_with_limitations'?this.waitingCandidate():null;
    if(waiting){
      this.state.waiting={campaignId:waiting.campaignId,startedAt:this.clock(),until:waiting.until,remainingActiveMs:this.state.deadline-this.clock()};
      this.state.state='waiting';this.state.reason='计算仍在运行；恢复先查询原任务 / Computation pending; query original job before resume';this.save('terminal',this.state.task.taskId,'waiting',this.state.reason);return;
    }
    const unresolved = outdatedResponse || this.state.attempts.some(a => a.state === "unknown") || [...latestJobs.values()].some(s=>s!=="completed");
    const artifactIssues=verifiedArtifactIssues(this.options.projectPath,this.state);
    const deliveryIssue=state==="completed_with_limitations"?(this.state.answerAssessment?.status==='blocked'?this.state.answerAssessment.issues.join('; '):this.continuityIssue()||artifactIssues.join("; ")||this.options.deliveryIssue?.()):null;
    if (state === "completed_with_limitations" && !unresolved && !deliveryIssue && this.current) {
      for (const s of this.state.steps) {
        const definition = this.current.steps.find(x => x.id === s.id)!;
        if (this.current.executionMode==="direct" && definition.method === "engine.execute" && !definition.expectedArtifacts.length && ["pending", "running"].includes(s.state) &&
          definition.dependsOn.every(id => this.state.steps.find(x => x.id === id)?.state === "completed")) s.state = "completed";
      }
    }
    const uncovered=state==='completed_with_limitations'?(this.current?.acceptance.requiredArtifacts??[]).filter(name=>
      !this.current!.steps.some(s=>s.expectedArtifacts.includes(name)&&this.state.steps.find(x=>x.id===s.id)?.state==='completed')):[];
    const missing = this.state.steps.filter(s => s.state !== "completed");
    this.state.state = state === "completed_with_limitations" && (missing.length || unresolved || deliveryIssue || uncovered.length) ? "blocked" : state;
    this.state.reason = deliveryIssue || (uncovered.length?'验收产物未由已完成步骤核实 / Unverified acceptance artifacts: '+uncovered.join(', '):null) || (outdatedResponse ? "模型响应属于旧计划版本；保留回执，继续当前计划前先恢复" : missing.length&&state==='completed_with_limitations'?missing.map(s=>s.reason??`步骤 ${s.id} 尚未按真实回执验收`).join('；'):reason||"Scientific and artifact acceptance is separate");
    this.state.deliveryAssessment=assessDelivery(this.current,this.state,deliveryIssue??(state!=="completed_with_limitations"?reason:null),artifactIssues);
    this.save("terminal", this.state.task.taskId, this.state.state, this.state.reason);
  }
}
