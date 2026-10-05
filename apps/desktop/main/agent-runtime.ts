import {ResearchSubtasks,type SubtaskLaunch} from './research-subtasks.js';
import {projectTools} from "../../../packages/agent/src/project-tools.js";
import type {HostTool} from "../../../packages/agent/src/host-mcp.js";
import type {ResearchService} from "./research-service.js";
import { supervisionStore } from "./agent-supervision-store.js";
import { needsReconciliation, recoveryDeadline,requireRecoverable, requireHandoffCheckpoint } from "./agent-recovery.js";
import type { TaskExecution } from "../../../packages/contracts/src/task-execution.js";
import { TaskSupervisor } from "../../../packages/agent/src/task-supervisor.js";
import { projectInstructions } from "../../../packages/agent/src/execution-context.js";
import type { ExecutionEvent } from "../../../packages/contracts/src/task-execution.js";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  AgentError,
  permissionGrantSchema,
  taskRefSchema,
} from "../../../packages/contracts/src/agent.js";
import type { ModelSettings } from "../../../packages/contracts/src/desktop.js";
import type { ResearchGoalPlan } from "../../../packages/contracts/src/research-goal.js";
import type {
  AgentEngine,
  AgentEvent,
  AgentRun,
} from "../../../packages/agent/src/engine.js";
import { localModelConnection, localResponsesInvoker, profileFor, probeLocalCodex, defaultLocalProtocol, CODEX_VERSION, PI_VERSION } from "../../../packages/agent/src/local-model-transport.js";
import { engineKindSchema, modelConnectionSchema, type EngineSessionRef, type CompatibilityProfile } from "../../../packages/contracts/src/engine-selection.js";
import { requestedGrant } from "../../../packages/agent/src/request-limits.js";
import { directPlan, executionMode } from "../../../packages/agent/src/research-planning.js";
import { PiEngine } from "../../../packages/agent/src/pi-engine.js";
import type { CodexRuntimeLocation } from "../../../packages/agent/src/codex-runtime.js";
import { CodexEngine } from "../../../packages/agent/src/codex-engine.js";
import { HostMcp } from "../../../packages/agent/src/host-mcp.js";
import { interpretLocal } from "../../../packages/pi-adapter/src/local-runtime.js";
import type { PiLocalSessionService } from "../../../packages/pi-adapter/src/local-session.js";
import type {
  PiPlatformSessionService,
  CloudSelection,
} from "../../../packages/pi-adapter/src/platform-session.js";
import {
  verifiedScientificText,
  type ScienceBridge,
} from "../../../packages/pi-adapter/src/science-bridge.js";
import type { CloudCatalog } from "../../../packages/contracts/src/platform.js";
import type { WorkspaceStore } from "./store.js";
export interface AgentCloud {
  accountId: string;
  catalog: CloudCatalog;
  selection: CloudSelection;
  science?: ScienceBridge;
  workspaceTools?:boolean;
}
export class DesktopAgentRuntime {
  readonly subtasks:ResearchSubtasks;
  private runSettings=new Map<string,ModelSettings>();
  localContext(taskId:string){const a=[...this.active.values()].find(a=>a.taskId===taskId),settings=this.runSettings.get(taskId);const state=a?.control?.snapshot(),connection=state&&this.localConnections.get(state.task.conversationId);if(!a||!state||!connection||!settings)throw Error("ACTIVE_LOCAL_TASK_REQUIRED");return {state,connection,settings,signal:a.controller.signal,control:a.control!};}

  private localConnections=new Map<string,import("../../../packages/contracts/src/engine-selection.js").ModelConnection>();
  private transitions = new Set<string>();
  private active = new Map<
    string,
    { engine?: AgentEngine; taskId: string; controller: AbortController; cancelScience?: () => void; control?: TaskSupervisor }
  >();
  constructor(
    private store: WorkspaceStore,
    private local: PiLocalSessionService,
    private platform: PiPlatformSessionService,
    private userData: string,
    private codexLocation: CodexRuntimeLocation = {},
    private queryJobs?: (projectId:string, ids:string[]) => Promise<Array<{id:string;state:string}>>,
    private research?:ResearchService,
  ) {this.subtasks=new ResearchSubtasks(store,async(record,launch,prompt)=>{
    const abort=()=>{void this.cancel(record.conversationId);};launch.signal.addEventListener('abort',abort,{once:true});
    this.local.setReadOnlyWorkspace(record.conversationId,true);
    try{launch.signal.throwIfAborted();return await this.run(record.id,record.projectId,record.conversationId,record.workspace,launch.settings,prompt,()=>{},undefined,undefined,undefined,launch);}
    finally{launch.signal.removeEventListener('abort',abort);this.local.setReadOnlyWorkspace(record.conversationId,false);this.local.invalidate(record.conversationId);}
  });}
  async run(
    taskId: string,
    projectId: string,
    conversationId: string,
    projectPath: string,
    settings: ModelSettings,
    content: string,
    onDelta: (text: string) => void,
    cloud?: AgentCloud,
    onExecutionEvent?: (event: ExecutionEvent) => void,
    recovery?: TaskExecution,
    child?:SubtaskLaunch,
  ): Promise<string> {
    if(!child&&this.subtasks.scope(conversationId))throw new AgentError("CONFLICT","这是内部子任务工作区，请回到主任务 / Internal child workspace; use the parent task");
    if (this.active.has(conversationId) || this.transitions.has(conversationId)) throw new AgentError("CONFLICT", "此对话已有任务正在运行");
    if (!recovery && this.store.agentJournal.forConversation(conversationId).some(needsReconciliation))
      throw new AgentError("RECONCILIATION_REQUIRED", "此对话的旧任务仍待核对；不能绕过它新建重复任务");
    if (recovery) requireRecoverable(recovery);
    await this.research?.authorizeProject(projectId,!!cloud||settings.mode==='platform');
    if(cloud&&/(?:@|\/skill:)materials-research-workbench\b/.test(content))throw new AgentError("UNAVAILABLE","MOOS 研究入口当前支持本地引擎；平台数据外发尚未开放 / MOOS research currently requires a local engine; cloud export is not enabled");
    if(!child&&this.subtasks.parentOf(taskId,projectId))throw new AgentError("CONFLICT","子任务只能由仍在执行的主任务启动；不能单独恢复或重置预算");
    this.runSettings.set(taskId,structuredClone(settings));
    const runStartedAt = child?.parent.startedAt ?? recovery?.startedAt ?? Date.now();
    const controller = new AbortController();
    const task = taskRefSchema.parse({ taskId, projectId, conversationId });
    let grant = requestedGrant(
      permissionGrantSchema.parse({
        grantId: randomUUID(),
        projectId,
        conversationId,
        permissions:
          cloud?.workspaceTools || !cloud
            ? [
                "read",
                "search",
                "terminal",
                "patch",
                ...(!cloud ? ["network"] : []),
                ...(cloud?.science || !cloud ? ["science"] : []),
              ]
            : ["read", ...(cloud.science ? ["science"] : [])],
        approvedBy: cloud ? "native-dialog" : "local-user",
        maxCredits: cloud ? (settings.cloudMaxCredits ?? "500") : null,
        maxSeconds: cloud ? cloud.catalog.alpha.limits.maxDurationSeconds : 600,
      }),
      content,
    );
    if (recovery) grant = recovery.grant;
    if(this.store.teamLink(projectId).remoteProjectId)grant={...grant,permissions:grant.permissions.filter(p=>p!=='network'&&p!=='terminal')};
    if(child)grant={...child.parent.grant,grantId:randomUUID(),conversationId:task.conversationId,permissions:child.parent.grant.permissions.filter(p=>["read","search","network"].includes(p)&&this.store.researchPlan(child.parent.task.taskId)?.constraints.permissions.includes(p)&&this.store.researchPlan(child.parent.task.taskId)?.steps.find(s=>s.id===child.parent.activeStepId)?.permissions.includes(p))};
    let supervisor: TaskSupervisor | undefined;
    let expired = false;
    let timerDeadline=child?child.parent.deadline:recovery?recoveryDeadline(recovery): runStartedAt + grant.maxSeconds*1000;
    let timer: ReturnType<typeof setTimeout>;
    let mcp: HostMcp | undefined;
    let engine: AgentEngine;
    const scopedCatalog = cloud
      ? {
          ...cloud.catalog,
          alpha: {
            ...cloud.catalog.alpha,
            limits: {
              ...cloud.catalog.alpha.limits,
              maxDurationSeconds: grant.maxSeconds,
            },
          },
        }
      : undefined;
    const onEvent = (event: AgentEvent) => {
      if (event.type === "text") onDelta(event.delta);
      else if (event.type === "plan") {
        if (supervisor) supervisor.acceptPlan(event.plan); else this.store.saveResearchPlan(event.plan);
        if (event.plan.executionMode === "planned")
          onDelta(`研究计划已保存：${event.plan.steps.length} 个步骤。\n`);
      } else this.store.saveAgentReceipt(taskId, event.receipt);
    };
    if(!cloud){this.research?.begin(taskId,projectId,content);this.local.setAuthorizationScope(conversationId,this.research?.teamAccessKey(projectId)??null);}
    const researchContext=!cloud?this.research?.context(taskId):null;
    const input: AgentRun = { task, projectPath, content, grant, onEvent };
    const methods = this.local.toolCapabilities(projectPath, conversationId);
    const inputVersions = cloud
      ? [...cloud.selection.files, ...cloud.selection.skills].map((asset) => ({
          id: asset.id,
          version: asset.sha256,
          sha256: asset.sha256,
        }))
      : researchContext?.inputVersions??[];
    let approvedTools:HostTool[]=[];
    const cloudMethods = new Map<
      string,
      readonly (typeof grant.permissions)[number][]
    >([
      ["engine.execute", []],
      ["task_control", []],
      ["read_material_file", ["read"]],
      ["read_skill", ["read"]],
    ]);
    if (cloud?.science) cloudMethods.set("materials_science", ["science"]);
    const runPi = async () => {
      if (!cloud) this.local.setPermissions(conversationId, grant.permissions);
      engine = new PiEngine({
        capabilities: {
          kind: "pi",
          tools: cloud ? cloudMethods : methods,
          steer: !cloud,
          resume: !cloud,
          persistentHistory: !cloud,
          sandbox: "none",
        },
        preparesInPrompt: !!cloud,
        interpret: (prompt, signal) =>
          interpretLocal(
            settings.localEndpoint,
            settings.modelId,
            prompt,
            signal, undefined, supervisor, this.localConnections.get(conversationId),'interpret',
          ),
        cancel: (id) =>
          cloud ? this.platform.cancel(id) : this.local.cancel(id),
        ...(!cloud
          ? { steer: (id: string, text: string) => this.local.steer(id, text) }
          : {}),
        prompt: (i) =>
          cloud
            ? this.platform.prompt(
                cloud.accountId,
                conversationId,
                settings.modelId,
                content,
                cloud.selection,
                scopedCatalog!,
                onDelta,
                grant.maxCredits ?? "500",
                cloud.science,
                {
                  context: {
                    task,
                    grant,
                    methods: engine.capabilities.tools,
                    inputVersions,
                  },
                  onPlan: (plan) => onEvent({ type: "plan", plan }),
                  ...(supervisor ? { control: supervisor } : {}),
                  tools:approvedTools,
                },
              )
            : this.local.prompt(
                conversationId,
                projectPath,
                settings,
                i.content,
                onDelta,
              ),
      });
      this.active.set(conversationId, {
        engine,
        taskId,
        controller, control: supervisor!,
        ...(cloud?.science
          ? { cancelScience: () => cloud.science!.cancelOwned() }
          : {}),
      });
      return engine.run(input);
    };
    timer = setTimeout(() => { expired = true; void this.cancel(conversationId); }, Math.max(1, timerDeadline - Date.now()));
    this.active.set(conversationId, { taskId, controller });
    try {
      if(cloud?.workspaceTools){approvedTools=(await projectTools(projectPath,join(this.userData,"project-tools",conversationId))).filter(t=>t.permissions.every(p=>grant.permissions.includes(p)));for(const t of approvedTools)cloudMethods.set(t.name,t.permissions);}
      const accountRef = cloud?.accountId ?? "local";
      const kind = engineKindSchema.parse(settings.agentEngine ?? "pi");
      const request: typeof fetch = (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : [])]) });
      const localConnection = child?.connection ?? (!cloud ? await localModelConnection(settings.localEndpoint, settings.modelId, request, settings.localProtocol??defaultLocalProtocol(kind,settings.modelId),{...(settings.localContextBudget?{contextWindow:settings.localContextBudget}:{}),...(settings.localMaxOutputTokens?{maxOutputTokens:settings.localMaxOutputTokens}:{})}) : null);
      if(localConnection){this.localConnections.set(conversationId,localConnection);this.local.setConnection(conversationId,localConnection);}
      controller.signal.throwIfAborted();
      const cloudModel = cloud?.catalog.items.find((model) => model.id === settings.modelId);
      if (cloud && !cloudModel) throw new AgentError("UNAVAILABLE", "平台目录没有所选模型");
      const connection = localConnection ?? modelConnectionSchema.parse({
        id: `model-${createHash("sha256").update(JSON.stringify(cloudModel)).digest("hex").slice(0,32)}`,
        source: "platform", modelId: cloudModel!.upstreamModelId, endpoint: null, protocol: cloudModel!.protocol,
        contextWindow: cloudModel!.contextWindow, maxOutputTokens: Math.min(cloudModel!.maxOutputTokens ?? cloud!.catalog.alpha.limits.maxOutputTokensPerRequest, cloud!.catalog.alpha.limits.maxOutputTokensPerRequest),
        revision: cloudModel!.routeVersionId ?? "unknown-route",
      });
      let profile = profileFor(connection, kind, "unverified", { zh: "待验收", en: "Unverified" });
      if (kind === "codex" && localConnection) {
        profile = child ? this.store.compatibility(profile.id) ?? profile : await this.localCompatibility(settings, false, controller.signal);
        controller.signal.throwIfAborted();
        if (profile.connection.id !== connection.id) throw new AgentError("CONFLICT", "模型在检测期间发生变化，请重新运行");
      }
      const record: EngineSessionRef = {
        task, accountRef, nativeSessionId: null, connection,
        selection: { engine: kind, engineVersion: kind === "codex" ? CODEX_VERSION : PI_VERSION,
          modelConnectionRef: connection.id, compatibilityRef: profile.id,
          selectedBy: settings.agentEngine ? "user" : "legacy-default" },
      };
      this.store.saveCompatibility(profile);
      const oldSession = recovery ? this.store.engineSession(taskId) : null;
      if (recovery && (!oldSession || oldSession.accountRef !== accountRef || oldSession.selection.engine !== kind || oldSession.connection.id !== connection.id))
        throw new AgentError("CONFLICT", "恢复不能改变账户、模型、协议或引擎；请选择显式交接");
      if (oldSession && oldSession.selection.engineVersion !== (kind === "codex" ? CODEX_VERSION : PI_VERSION)) throw new AgentError("CONFLICT", "执行引擎版本已改变，不能按旧版本自动恢复");
      if (oldSession) {record.nativeSessionId = oldSession.nativeSessionId;record.selection=oldSession.selection;}
      this.store.saveEngineSession(record);
      const commonMethods = new Map(cloud?cloudMethods:methods);
      if(kind==='codex'){
        for(const name of ['read','ls','find','grep','bash','write','edit'])if(!child||!['read','ls'].includes(name))commonMethods.delete(name);
        commonMethods.set('exec_command',['terminal']);commonMethods.set('apply_patch',['patch']);
        for(const [name,p] of cloudMethods)commonMethods.set(name,p);
      }
      supervisor = new TaskSupervisor({ context: { task, grant, methods: commonMethods, inputVersions,evidence:researchContext?.evidence??[],...(!cloud?{methodDescriptions:this.local.toolDescriptions(projectPath,conversationId),sourceUnits:researchContext?.sourceUnits??[]}: {}) }, engine: kind, connectionId: connection.id, accountRef,
        projectPath,originalRequest:content, startedAt: runStartedAt,admit:(kind,p)=>this.subtasks.admit(taskId,projectId,kind,p),...(child?{parentTaskId:child.parent.task.taskId,deadline:child.parent.deadline}:{}), ...(recovery ? { previous: recovery, previousPlan: this.store.researchPlan(taskId)! } : {}), instructions: await projectInstructions(projectPath, grant.permissions),
        ...(!cloud&&this.research?{deferJobs:(state)=>this.research!.campaigns.wait(state),researchContext:()=>this.research!.context(taskId),deliveryIssue:()=>child?null:this.research!.deliveryIssue(taskId),
          resolveArtifact:async(stepId:string,name:string)=>{
            const childArtifact=await this.subtasks.resolveArtifact(taskId,stepId,name);if(childArtifact)return childArtifact;
            const ownedRpsme=supervisor!.snapshot().attempts.some(a=>a.method==='materials_rpsme_extract'&&a.stepId===stepId&&a.planRevision===supervisor!.snapshot().planRevision&&a.state==='completed');
            if(ownedRpsme&&['RPSME JSON','中文摘要','校验报告'].includes(name))
              return (await this.research!.papers!.taskArtifacts(taskId,stepId)).find(a=>a.label===name)?.path??null;
            return await this.research!.campaigns.resolveArtifact(taskId,stepId,name)??await this.research!.nextExperiments.resolveTaskArtifact(taskId,stepId,name)??await this.research!.experiments.resolveTaskArtifact(taskId,stepId,name)??this.research!.scientific.resolveTaskArtifact(taskId,stepId,name);
          }}:{}),
        ...supervisionStore(this.store,taskId,event=>{
          const deadline=supervisor?.snapshot().deadline;
          if(deadline && deadline<timerDeadline){clearTimeout(timer);timerDeadline=deadline;timer=setTimeout(()=>{expired=true;void this.cancel(conversationId);},Math.max(1,deadline-Date.now()));}
          onExecutionEvent?.(event);
        }),
      });
      if(child)supervisor.acceptPlan(directPlan(content,{task,grant,methods:commonMethods,inputVersions,evidence:researchContext?.evidence??[]}));
      if (recovery) supervisor.resume();
      input.control = supervisor;
      this.local.setControl(conversationId, supervisor);
      if (kind === "codex" && localConnection && !["available", "limited"].includes(profile.status))
        throw new AgentError("UNAVAILABLE", profile.reason.zh);
      const runCodex = async (invoke: (payload: unknown, signal: AbortSignal, requestId?: string) => Promise<Response>) => {
        const key = `codex:${accountRef}:${projectId}:${conversationId}:${connection.id}${this.research?.teamAccessKey(projectId)?':team:'+this.research.teamAccessKey(projectId):''}`;
        // Retain the pre-extension cloud thread only for its original account/conversation.
        const threadId = oldSession?.nativeSessionId ?? (recovery?.continuation ? null : this.store.agentThread(key)) ?? (cloud ? this.store.agentThread(`codex:${accountRef}:${conversationId}`) : null);
        engine = new CodexEngine({
          ...(process.env.MATERIALSX_AGENT_DIAGNOSTICS === "1" ? { onDiagnostic: (event: any) => {
            if (["runtime/model-request","runtime/model-context"].includes(event.method)) console.log(JSON.stringify(event));
          } } : {}),
          runtime: this.codexLocation,
          home: cloud ? join(this.userData, "codex", accountRef, conversationId) : join(this.userData, "codex", accountRef, conversationId, connection.id),
          maxOutput: connection.maxOutputTokens,
          ...(localConnection?{localToolScope:true}:{}),...(child||this.store.teamLink(projectId).remoteProjectId?{readOnlyWorkspace:true}:{}),
          ...(localConnection ? { modelId: connection.modelId, contextWindow: connection.contextWindow!,localResponseRecovery:true,
            interpret:(prompt:string,signal:AbortSignal)=>interpretLocal(connection.endpoint!,connection.modelId,prompt,AbortSignal.any([signal,controller.signal]),undefined,supervisor!,connection,'interpret') } : {}),
          invoke: (payload, signal, requestId) => invoke(payload, AbortSignal.any([signal, controller.signal]), requestId),
          mcp: { url: mcp!.url, token: mcp!.token, tools: mcp!.toolNames },
          mcpPermissions: mcp!.permissionMap,
          inputVersions, ...(threadId ? { threadId } : {}),
          onThread: (id) => { this.store.saveAgentThread(key, id); record.nativeSessionId = id; this.store.saveEngineSession(record); },
        });
        this.active.set(conversationId, { engine, taskId, controller, control: supervisor!,
          ...(cloud?.science ? { cancelScience: () => cloud.science!.cancelOwned() } : {}) });
        const result = await engine.run(input);
        if (cloud?.science) {
          const verified = verifiedScientificText(cloud.science, cloud.selection.skills.map((s) => s.id));
          result.text += verified; onDelta(verified);
        }
        return result;
      };
      let result: Awaited<ReturnType<AgentEngine["run"]>>;
      if (kind === "pi") result = await runPi();
      else {
        const tools = !cloud ? await this.local.hostTools(projectPath, conversationId, grant.permissions) : approvedTools.length?approvedTools:undefined;
        controller.signal.throwIfAborted();
        mcp = new HostMcp(cloud?.selection ?? { files: [], skills: [] }, cloud?.science,
          tools ? { tools, permissions: grant.permissions, signal: controller.signal } : undefined, supervisor);
        await mcp.start();
        if (localConnection) result = await runCodex(localResponsesInvoker(localConnection));
        else {
          let completion: typeof result | undefined;
          await this.platform.native(cloud!.accountId, conversationId, cloud!.selection, scopedCatalog!,
            grant.maxCredits ?? "500", async (invoke) => { completion = await runCodex((payload,signal,requestId)=>invoke({...payload as object,model:"materials-research"},signal,requestId)); return completion.text; }, taskId);
          result = completion!;
        }
      }
      if(!cloud&&this.research){const jobs=await this.research.campaigns.verifyTask(taskId);if(jobs.length){supervisor.reconcileJobs(jobs);await supervisor.verifyBackendSteps();}}
      if(!cloud)await this.research?.scientific.verifyTaskArtifacts(taskId);
      if(!cloud)await this.research?.experiments.verifyTask(taskId);
      if(!cloud)await this.research?.nextExperiments.verifyTask(taskId);
      let rpsmeText='';
      const plan=supervisor.plan();
      if(!cloud&&plan?.executionMode==='direct'&&/(?:@|\/skill:)materials-literature-rpsme-json\b/.test(plan.originalRequest)){
        await this.research!.papers!.taskArtifacts(taskId);
        const state=supervisor.snapshot(),step=state.steps[0]!;
        if(step.state!=='completed')await supervisor.command({action:'complete',stepId:step.id,expectedRevision:plan.planRevision,
          receiptIds:state.attempts.filter(a=>a.stepId===step.id&&a.state==='completed'&&a.method==='materials_rpsme_extract').map(a=>a.id)});
        rpsmeText='\n\n'+await this.research!.papers!.taskDelivery(taskId);
      }
      const deliveryText=(!cloud?this.research?.deliveryText(taskId)??'':'')+rpsmeText;if(deliveryText)onDelta(deliveryText);
      supervisor.finish(result.state === "cancelled" ? "cancelled" : result.state === "failed" ? "failed" : "completed_with_limitations", result.limitation ?? "");
      if(supervisor.snapshot().state==="failed")throw new AgentError(Date.now()>=supervisor.snapshot().deadline?"BUDGET_EXCEEDED":"EXECUTION_FAILED",supervisor.snapshot().reason ?? "任务未完成");
      if(supervisor.snapshot().state==="cancelled")throw new AgentError("CANCELLED","任务已取消，真实回执保留");
      if (result.state === "blocked" || supervisor.snapshot().state === "blocked")
        throw new AgentError("INVALID_PLAN", result.text + "\n" + supervisor.snapshot().reason);
      if(supervisor.snapshot().state==='completed_with_limitations')this.store.saveCompatibility(profileFor(connection,kind,'limited',{zh:'本轮执行完成；科学结论和复杂任务资格仍需验收',en:'This task completed; scientific conclusions and complex-task qualification remain separate'},['stream',...((supervisor.snapshot().attempts.some(a=>a.state==='completed'))?['tool-call','tool-result'] as const:[]),'native-execution']));
      if(supervisor.snapshot().state==='waiting'){const message='\n\n计算仍在运行，结果尚未完成。请在研究工作区查询原任务，再恢复继续。 / Computation is pending. Query the original job in the research workspace, then resume.';onDelta(message);return result.text+message;}
      return rpsmeText?rpsmeText:result.text+deliveryText;
    } catch (cause) {
      if(!expired&&!controller.signal.aborted&&supervisor?.canWaitForJobs()){
        supervisor.finish('completed_with_limitations');
        if(supervisor.snapshot().state==='waiting'){const message='计算已提交，模型会话已暂停。应用关闭后计算会继续；请在研究工作区查询原任务，完成后核对回执并恢复。 / Computation submitted; model session paused. Query the original job, then reconcile and resume after completion.';onDelta(message);return message;}
      }
      if (expired) cause = new AgentError("BUDGET_EXCEEDED", "任务达到本轮时间上限");
      supervisor?.finish(controller.signal.aborted && !expired ? "cancelled" : "failed", cause instanceof Error ? cause.message : String(cause));
      if (!this.store.researchPlan(taskId) && executionMode(content) === "direct")
        this.store.saveResearchPlan(directPlan(content, { task, grant, methods: new Map([["engine.execute", []]]) }));
      cloud?.science?.cancelOwned();
      throw cause;
    } finally {
      clearTimeout(timer);
      controller.abort();
      this.subtasks.cancelParent(taskId);this.runSettings.delete(taskId);
      this.active.delete(conversationId);
      this.local.setPermissions(conversationId, null);
      this.local.setControl(conversationId, null);
      this.local.setConnection(conversationId,null);this.localConnections.delete(conversationId);
      await engine!?.dispose();
      await mcp?.close();
    }
  }
  async localCompatibility(settings: ModelSettings, refresh = true, signal?: AbortSignal): Promise<CompatibilityProfile> {
    if (settings.mode !== "local") throw new AgentError("UNAVAILABLE", "平台能力按 M5 路由验收；本入口仅检测本地模型");
    const engine = engineKindSchema.parse(settings.agentEngine ?? "pi");
    const request: typeof fetch = (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([...(signal ? [signal] : []), ...(init?.signal ? [init.signal] : [])]) });
    const connection = await localModelConnection(settings.localEndpoint, settings.modelId, request, settings.localProtocol??defaultLocalProtocol(engine,settings.modelId),{...(settings.localContextBudget?{contextWindow:settings.localContextBudget}:{}),...(settings.localMaxOutputTokens?{maxOutputTokens:settings.localMaxOutputTokens}:{})});
    const base = profileFor(connection, engine, "unverified", { zh: "待检测", en: "Unverified" });
    const cached = this.store.compatibility(base.id);
    if (!refresh && connection.revision !== "unknown-model-version" && cached?.testedAt && Date.now() - Date.parse(cached.testedAt) < 86400000) return cached;
    const profile = await probeLocalCodex(connection, request,engine);
    signal?.throwIfAborted();
    this.store.saveCompatibility(profile);
    return profile;
  }
  async reconcile(taskId: string, accountId?: string) {
    const state=this.execution(taskId), plan=this.plan(taskId), project=state&&this.store.getProject(state.task.projectId);
    if(!state||!plan||!project)throw new AgentError("UNAVAILABLE","没有完整执行记录");
    if(this.active.has(state.task.conversationId))throw new AgentError("CONFLICT","执行中使用原工具查询；暂停后才核对恢复记录");
    if(state.accountRef!=="local" && state.accountRef!==accountId)throw new AgentError("PERMISSION_DENIED","请登录原平台账户后核对");
    const control=new TaskSupervisor({context:{task:state.task,grant:state.grant,methods:new Map(plan.steps.map(s=>[s.method,s.permissions])),inputVersions:plan.inputVersionRefs},
      engine:state.engine,connectionId:state.connectionId,accountRef:state.accountRef,projectPath:project.path,previous:state,previousPlan:plan,
      ...supervisionStore(this.store,taskId)});
    const ids=[...new Set(state.attempts.flatMap(a=>a.jobIds))];
    if(ids.length&&this.queryJobs)control.reconcileJobs(await this.queryJobs(state.task.projectId,ids));
    if(state.accountRef!=="local"){
      const id=this.store.latestCloudTask(state.accountRef,state.task.conversationId);
      if(!id)throw new AgentError("RECONCILIATION_REQUIRED","原 M5 任务引用缺失，不新建付费任务");
      const actual=await this.platform.refreshSnapshot(state.task.conversationId,id);
      if(actual.task.clientTaskId!==taskId)throw new AgentError("CONFLICT","M5 回执属于另一轮任务");
      control.reconcileRequests(actual.requests.filter(r=>["settled","released","not_billed"].includes(r.settlement)&&
        (r.terminalReceived||!r.dispatched)&&["completed","failed","cancelled"].includes(r.execution)).map(r=>({id:r.id,state:r.execution==="completed"?"completed":"failed",usage:r.usage})));
    }
    return control.snapshot();
  }
  async handoff(taskId:string, target:"pi"|"codex",onDelta:(text:string)=>void,onEvent?:(event:ExecutionEvent)=>void) {
    const state=this.execution(taskId), plan=this.plan(taskId),session=this.session(taskId);
    if(state?.parentTaskId||state&&this.store.agentWorkspace.subtasks(state.task.projectId).some(s=>s.parentTaskId===taskId))throw new AgentError("CONFLICT","父子任务暂不支持跨引擎交接；保留原预算与回执 / Keep original family engine");
    if(!state||!plan||!session)throw new AgentError("UNAVAILABLE","缺少原任务记录");
    if(this.active.has(state.task.conversationId))throw new AgentError("CONFLICT","先停止当前引擎并核对终态，再显式交接");
    if(state.accountRef!=="local")throw new AgentError("UNAVAILABLE","平台跨引擎交接按 UA.5 原任务计量合同开放，当前不会创建新付费任务");
    if(state.engine===target)throw new AgentError("CONFLICT","同引擎请使用恢复入口");
    requireHandoffCheckpoint(state);
    const project=this.store.getProject(state.task.projectId);if(!project)throw new AgentError("CONFLICT","原项目已不存在");
    const settings:ModelSettings={mode:"local",modelId:session.connection.modelId,localEndpoint:session.connection.endpoint!,localProtocol:session.connection.protocol,localContextBudget:session.connection.contextWindow!,localMaxOutputTokens:session.connection.maxOutputTokens,agentEngine:target};
    if(this.transitions.has(state.task.conversationId))throw new AgentError("CONFLICT","此对话正在交接");
    this.transitions.add(state.task.conversationId);
    try {
    const connection=await localModelConnection(settings.localEndpoint,settings.modelId,fetch,session.connection.protocol,{contextWindow:session.connection.contextWindow!,maxOutputTokens:session.connection.maxOutputTokens});
    if(connection.modelId!==session.connection.modelId||connection.revision!==session.connection.revision)throw new AgentError("CONFLICT","交接时模型版本发生改变");
    if(target==="codex") { const profile=await this.localCompatibility(settings); if(!["available","limited"].includes(profile.status))throw new AgentError("UNAVAILABLE",profile.reason.zh); }
    const run=this.store.addRun(state.task.projectId,"引擎交接 · "+target,"running");
    const next=structuredClone(state);next.task.taskId=taskRefSchema.parse({...next.task,taskId:run.id}).taskId;next.engine=target;next.connectionId=connection.id;next.continuation={taskId,kind:"handoff"};
    next.version=1;next.sequence=1;next.state="interrupted";next.activeStepId=null;next.reason="Explicit local engine handoff; original budgets and completed receipts retained";
    const nextPlan=structuredClone(plan);nextPlan.task=next.task;nextPlan.userMessageRefs=nextPlan.userMessageRefs.map(id=>id===taskId?run.id:id);
    for(const step of nextPlan.steps)step.inputRefs=step.inputRefs.map(id=>id===taskId?run.id:id);
    // Native session history is not copied across engines. Only validated host state and actual receipts cross this boundary.
    const targetMethods=target==="pi"?this.local.toolCapabilities(project.path,state.task.conversationId):new Map<string,readonly (typeof state.grant.permissions)[number][]>([["engine.execute",[]],["exec_command",["terminal"]],["apply_patch",["patch"]],...(await this.local.hostTools(project.path,state.task.conversationId,state.grant.permissions)).map(t=>[t.name,t.permissions] as const)]);
    const {validateResearchPlan}=await import("../../../packages/contracts/src/research-goal.js");
    validateResearchPlan(nextPlan,{task:next.task,grant:next.grant,methods:targetMethods,inputVersions:nextPlan.inputVersionRefs});
    const parent=structuredClone(state);parent.version++;parent.sequence++;parent.state="handed_off";parent.reason="交接到任务 "+run.id;
    this.store.agentJournal.save(next,null,{taskId:run.id,sequence:1,at:Date.now(),planRevision:next.planRevision,type:"step",id:"handoff",state:"interrupted",detail:next.reason},()=>{
    this.store.saveResearchPlan(nextPlan);
    this.store.saveEngineSession({...session,task:next.task,nativeSessionId:null,connection,selection:{...session.selection,engine:target,engineVersion:target==="codex"?CODEX_VERSION:PI_VERSION,modelConnectionRef:connection.id,compatibilityRef:profileFor(connection,target,"unverified",{zh:"交接待验收",en:"Handoff unverified"}).id,selectedBy:"user"}});
    for(const a of next.attempts)for(const ref of [a.inputRef,a.resultRef])if(ref)this.store.agentJournal.result(run.id,ref,this.store.agentJournal.readResult(taskId,ref));
    this.store.agentJournal.save(parent,state.version,{taskId,sequence:parent.sequence,at:Date.now(),planRevision:parent.planRevision,type:"terminal",id:"handoff",state:"handed_off",detail:parent.reason});
    });
    this.transitions.delete(state.task.conversationId);
    return await this.resume(run.id,onDelta,onEvent);
    } finally {this.transitions.delete(state.task.conversationId);}
  }
  async resume(taskId: string, onDelta: (text:string)=>void, onEvent?: (event:ExecutionEvent)=>void) {
    const state = this.store.agentJournal.read(taskId), session=this.store.engineSession(taskId),plan=this.store.researchPlan(taskId);
    if(!state||!session||!plan)throw new AgentError("UNAVAILABLE","没有可恢复的原执行记录");
    if(state.accountRef!=="local")throw new AgentError("RECONCILIATION_REQUIRED","平台任务先按原 M5 回执核对；不会自动创建新的付费任务");
    const project=this.store.getProject(state.task.projectId);if(!project)throw new AgentError("CONFLICT","原项目已不存在");
    requireRecoverable(state);
    const settings:ModelSettings={mode:"local",modelId:session.connection.modelId,localEndpoint:session.connection.endpoint!,localProtocol:session.connection.protocol,localContextBudget:session.connection.contextWindow!,localMaxOutputTokens:session.connection.maxOutputTokens,agentEngine:session.selection.engine};
    this.store.updateRun(taskId,"running");
    try { return await this.run(taskId,state.task.projectId,state.task.conversationId,project.path,settings,plan.originalRequest,onDelta,undefined,onEvent,state); }
    catch(error){this.store.updateRun(taskId,"failed");throw error;}
  }
  revise(taskId:string, expectedRevision:number, proposal:ResearchGoalPlan) {
    if(this.execution(taskId)?.parentTaskId)throw new AgentError("CONFLICT","子任务计划由主任务拥有 / Parent-owned child plan");
    const active=[...this.active.values()].find(a=>a.taskId===taskId);
    if(active?.control){active.control.revise(proposal,expectedRevision,"user");return active.control.snapshot();}
    const state=this.execution(taskId),plan=this.plan(taskId),project=state&&this.store.getProject(state.task.projectId);
    if(!state||!plan||!project)throw new AgentError("CONFLICT","原任务或项目不存在");
    if(state.state==="handed_off")throw new AgentError("CONFLICT","请修改交接后的任务");
    const oldBinding=this.store.research.binding(taskId),nextBinding=oldBinding&&this.research?this.research.revisionBinding(taskId):null;
    const changedInputs=JSON.stringify(proposal.inputVersionRefs)!==JSON.stringify(plan.inputVersionRefs);
    const binding=changedInputs?nextBinding:oldBinding;
    if(changedInputs&&(!binding||JSON.stringify(proposal.inputVersionRefs)!==JSON.stringify(binding.approvedInputs)))throw new AgentError("CONFLICT","新输入必须来自当前项目已选择的来源快照");
    const evidence=binding?.snapshotIds.flatMap(id=>this.store.research.snapshot(state.task.projectId,id).evidence)??[];
    const control=new TaskSupervisor({context:{task:state.task,grant:state.grant,methods:new Map([...this.local.toolCapabilities(project.path,state.task.conversationId),["exec_command",["terminal"] as const],["apply_patch",["patch"] as const]]),inputVersions:plan.inputVersionRefs,evidence},
      engine:state.engine,connectionId:state.connectionId,accountRef:state.accountRef,projectPath:project.path,previous:state,previousPlan:plan,...supervisionStore(this.store,taskId,undefined,()=>{if(changedInputs&&binding)this.store.research.saveBinding(binding,true);})});
    control.revise(proposal,expectedRevision,"user",changedInputs?binding!.approvedInputs:undefined);return control.snapshot();
  }
  execution(taskId: string) { return this.store.agentJournal.read(taskId); }
  events(taskId: string) { return this.store.agentJournal.events(taskId); }
  session(taskId: string) { return this.store.engineSession(taskId); }
  plan(taskId: string): ResearchGoalPlan | null {
    return this.store.researchPlan(taskId);
  }
  async cancel(conversationId: string) {
    const a = this.active.get(conversationId);
    if (!a) return false;
    const stopped = a.engine?.cancel(a.taskId) ?? Promise.resolve(true);
    this.subtasks.cancelParent(a.taskId);
    a.controller.abort();
    a.cancelScience?.();
    this.platform.cancel(conversationId);
    return await stopped;
  }
  async steer(conversationId: string, text: string) {
    const a = this.active.get(conversationId);
    if (!a) throw new AgentError("CONFLICT", "此对话没有执行中的任务");
    if (!a.engine) throw new AgentError("CONFLICT", "正在检查模型连接，请稍后补充指令");
    const plan=a.control?.plan();
    if(plan && a.control){
      const revised=structuredClone(plan);revised.planRevision++;revised.goalRevision++;revised.originalRequest+=`\n用户补充：${text}`;
      revised.goal.problemType+=`；用户补充：${text}`;revised.revisionReason="用户在执行中补充要求";
      const constrained=requestedGrant(a.control.snapshot().grant,text);
      revised.constraints.permissions=constrained.permissions;revised.constraints.maxSeconds=constrained.maxSeconds;revised.constraints.maxCredits=constrained.maxCredits;
      a.control.revise(revised,plan.planRevision,"user");
      this.store.appendMessage(conversationId,"user",text,"complete");
    }
    await a.engine.steer(a.taskId, text);
  }
  async dispose() {
    for (const a of this.active.values()) { a.controller.abort(); await a.engine?.dispose(); }
    this.active.clear();
  }
}
