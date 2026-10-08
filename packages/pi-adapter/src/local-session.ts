import {selectedAssetTools} from '../../agent/src/selected-assets.js';
import type {CloudSelection} from './platform-session.js';
import {parseReferences} from '../../contracts/src/task-references.js';
import {projectTools} from '../../agent/src/project-tools.js';
import {runManagedRpsme} from "./managed-rpsme.js";
import {withLocalResponseRecovery} from '../../agent/src/model-recovery.js';
import {recoveryNotice} from '../../agent/src/recovery-presentation.js';
import {discoverTools,initialToolNames} from '../../agent/src/tool-discovery.js';
import {materialToolPermissions} from "../../agent/src/research-tools.js";
import { supervisePi, taskControlTool } from "./supervised-pi.js";
import type { ExecutionControl } from "../../agent/src/execution-control.js";
import type {Permission} from '../../contracts/src/agent.js';
import {localWireFetch} from "../../agent/src/local-wire.js";
import type {ModelConnection} from "../../contracts/src/engine-selection.js";
import {localRuntime} from "./local-runtime.js";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import type { HostTool } from "../../agent/src/host-mcp.js";
import { delimiter, dirname, join, relative, isAbsolute, sep } from "node:path";
import { promisify } from "node:util";
import {
  createAgentSession, DefaultResourceLoader, defineTool, loadSkills,
  SessionManager, SettingsManager, type AgentSession, type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { ModelSettings } from "../../contracts/src/desktop.js";
import { validateModelSelection } from "./capabilities.js";
import { runRpsmeWorkflow } from "./rpsme-workflow.js";
import {
  resolveManagedPython, extractLocalPdfPath, pdfPreprocessSpec, discoverLocalModelLimits,
  sessionUsesRpsme, sessionSourcePdf, sessionContainsFabrication, hasFabricatedExecution,
  isPrematureRpsmeFinalization, rpsmeToolPathError, assistantText, verifyRpsmeDeliverables,
  prepareRpsmeSourceContext, applyLocalExecutionPolicy,
  DEFAULT_SKILL_PATHS, MATERIALS_SYSTEM_PROMPT, createMaterialsReadTool,
  createMaterialsWriteTool, type SessionMessage,
} from "./local-session-tools.js";
export { resolveManagedPython, discoverLocalModels, discoverLocalModelLimits, binaryReadGuidance, pdfPreprocessSpec, prepareRpsmeSourceContext, createMaterialsReadTool, hasFabricatedExecution, extractLocalPdfPath, isPrematureRpsmeFinalization, rpsmeToolPathError, validateRpsmeWrite, verifyRpsmeDeliverables, createMaterialsWriteTool, assistantText, normalizeSkillMention, applyLocalExecutionPolicy } from "./local-session-tools.js";

const execFileAsync = promisify(execFile);

interface ActiveSession {
  signature: string;
  session: AgentSession;
  rpsmeContext: boolean;
  sourcePdfPath: string | undefined;
}

export class PiLocalSessionService {
  readonly #projectRoot: string;
  readonly #userData: string;
  readonly #sessions = new Map<string, ActiveSession>();
  readonly #selections=new Map<string,CloudSelection>();
  setRequestSelection(id:string,selection:CloudSelection){
    if(JSON.stringify(this.#selections.get(id))!==JSON.stringify(selection)){this.invalidate(id);this.#selections.set(id,structuredClone(selection));}
  }
  #definitions(projectPath:string,id:string){
    const selected=selectedAssetTools(this.#selections.get(id)??{files:[],skills:[]}).map(t=>defineTool({...t,label:t.name,parameters:t.parameters as any,
      execute:async(_id,args,signal)=>({...await t.execute(args,signal??new AbortController().signal),details:{}})}));
    return [...selected,...(this.localTools?.(projectPath,id)??[]).filter(t=>!selected.some(s=>s.name===t.name))];
  }
  #skillRevision = 0;
  skillsChanged() { this.#skillRevision++; }
  readonly #permissions=new Map<string,readonly Permission[]>();
  setPermissions(conversationId:string,permissions:readonly Permission[]|null){if(permissions)this.#permissions.set(conversationId,permissions);else this.#permissions.delete(conversationId)}
  readonly #authorizationScopes=new Map<string,string|null>();
  /** Retain history only under the same project/account grant. First remote use never restores unscoped disk history. */
  setAuthorizationScope(id:string,scope:string|null){if(scope===null&&!this.#authorizationScopes.has(id)||this.#authorizationScopes.get(id)===scope)return;
    this.invalidate(id);this.#freshSessions.add(id);this.#authorizationScopes.set(id,scope);}
  readonly #readOnlyWorkspaces=new Set<string>();
  setReadOnlyWorkspace(id:string,enabled:boolean){if(enabled)this.#readOnlyWorkspaces.add(id);else this.#readOnlyWorkspaces.delete(id);}
  readonly #connections=new Map<string,ModelConnection>();
  setConnection(id:string,connection:ModelConnection|null){if(connection)this.#connections.set(id,connection);else this.#connections.delete(id);}
  readonly #controls = new Map<string, ExecutionControl>();
  readonly #supervisionErrors = new Map<string, unknown>();
  setControl(id: string, control: ExecutionControl | null) { if (control) this.#controls.set(id, control); else this.#controls.delete(id); this.#supervisionErrors.delete(id); }
  readonly #freshSessions = new Set<string>();
  readonly #workflowRuns = new Map<string, AbortController>();
  readonly #workflowSources = new Map<string, string>();

  constructor(projectRoot: string, userData: string, private localTools?: (projectPath:string,conversationId:string) => ReturnType<typeof defineTool>[], private userSkills?:()=>string[]) {
    this.#projectRoot = projectRoot;
    this.#userData = userData;
    const managedPython = resolveManagedPython(projectRoot);
    if (existsSync(managedPython)) {
      process.env.MATERIALSX_PYTHON = managedPython;
      const pythonDirectory = dirname(managedPython);
      const currentPath = process.env.PATH ?? "";
      if (!currentPath.split(delimiter).includes(pythonDirectory)) {
        process.env.PATH = `${pythonDirectory}${delimiter}${currentPath}`;
      }
    }
  }

  async extractRpsme(conversationId:string,projectPath:string,pdfPath:string,approvedPdfPath:string,signal:AbortSignal){
    const connection=this.#connections.get(conversationId),control=this.#controls.get(conversationId);if(!connection||!control)throw Error('RPSME_SUPERVISED_CONNECTION_REQUIRED');
    return runManagedRpsme({pdfPath,approvedPdfPath,projectPath,projectRoot:this.#projectRoot,connection,control,signal});
  }
  toolCapabilities(projectPath:string,conversationId:string):ReadonlyMap<string,readonly Permission[]> {
    const tools=new Map<string,readonly Permission[]>([['engine.execute',[]],['read_skill',['read']],['task_control',[]],['find_tools',['search']],['read',['read']],['ls',['read']],['find',['search']],['grep',['search']],['bash',['terminal']],['write',['patch']],['edit',['patch']]]);
    if(this.#readOnlyWorkspaces.has(conversationId))for(const name of ['bash','write','edit','find','grep'])tools.delete(name);
    for(const tool of this.#definitions(projectPath,conversationId))tools.set(tool.name,tool.name==='read_material_file'||tool.name==='read_skill'?['read']:materialToolPermissions(tool.name));
    return tools;
  }
  toolDescriptions(projectPath:string,conversationId:string):ReadonlyMap<string,string>{
    return new Map([['engine.execute','Answer or orchestrate advertised tools with explicit step permissions; this method does not itself calculate or write any artifacts.'],
      ...(this.#definitions(projectPath,conversationId)).map(t=>[t.name,t.description] as const)]);
  }

  /** Reuse installed tool definitions through MCP; no second scientific dispatcher. */
  async hostTools(projectPath: string, conversationId: string, permissions: readonly Permission[]): Promise<HostTool[]> {
    const capabilities = this.toolCapabilities(projectPath, conversationId);
    const definitions = this.#definitions(projectPath,conversationId);
    const tools: HostTool[] = definitions
      .filter((tool) => capabilities.get(tool.name)?.every((p) => permissions.includes(p)))
      .map((tool) => ({
        name: tool.name, description: tool.description,
        parameters: JSON.parse(JSON.stringify(tool.parameters)),
        permissions: capabilities.get(tool.name)!,
        execute: async (args, signal) => {
          const result = await tool.execute(randomUUID(), args, signal, undefined, undefined as any);
          return { content: result.content.filter((part): part is { type: "text"; text: string } => part.type === "text") };
        },
      }));
    if(this.#readOnlyWorkspaces.has(conversationId))tools.push(...(await projectTools(projectPath,join(this.#userData,"subtask-tools",conversationId))).filter(t=>["read","ls"].includes(t.name)));
    const within = (root: string, path: string) => {
      const rel = relative(root, path);
      return rel === "" || (!isAbsolute(rel) && rel.split(sep)[0] !== "..");
    };
    const project = await realpath(projectPath);
    const configured = [...DEFAULT_SKILL_PATHS.map((p) => join(this.#projectRoot, p)), ...(this.userSkills?.() ?? [])];
    const roots: string[] = [];
    for (const path of [...configured, join(project, ".pi/skills"), join(project, ".agents/skills")]) {
      try {
        const root = await realpath(path);
        if (configured.includes(path) || within(project, root)) roots.push(root);
      } catch { /* Absent optional Skill directories are not installed. */ }
    }
    const skills = loadSkills({ cwd: project, agentDir: join(this.#userData, "pi-agent"), skillPaths: roots, includeDefaults: false }).skills;
    const pinnedInstructions=new Map<string,Promise<string>>();
    if (permissions.includes("read")&&!tools.some(t=>t.name==="read_skill")) tools.push({
      name: "read_skill", description: "Read an installed MaterialsX Skill by name. Instructions do not grant extra permissions or scientific validation.",
      parameters: { type: "object", properties: { name: { type: "string", maxLength: 128 },
        startLine: { type: ["integer", "null"], minimum: 1 }, endLine: { type: ["integer", "null"], minimum: 1 } }, required: ["name"], additionalProperties: false },
      permissions: ["read"],
      execute: async (args, signal) => {
        signal.throwIfAborted();
        const skill = skills.find((s) => s.name === (args as { name: string }).name);
        if (!skill) throw Error("SKILL_NOT_INSTALLED");
        const path = await realpath(skill.filePath);
        if (!roots.some((root) => within(root, path))) throw Error("SKILL_OUTSIDE_APPROVED_ROOT");
        if(!pinnedInstructions.has(skill.name))pinnedInstructions.set(skill.name,readFile(path,{encoding:"utf8",signal}));
        const text = await pinnedInstructions.get(skill.name)!;
        if (Buffer.byteLength(text) > 60000) throw Error("SKILL_INPUT_TOO_LARGE");
        const range = args as { startLine?: number | null; endLine?: number | null };
        const lines = text.split("\n"), start = range.startLine ?? 1, end = range.endLine ?? Math.min(lines.length,start+199);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || start > lines.length || end-start>=200) throw Error("SKILL_INVALID_LINE_RANGE");
        const last = Math.min(end, lines.length);
        return { content: [{ type: "text", text: JSON.stringify({ name: skill.name, sha256: createHash("sha256").update(text).digest("hex"),
          totalLines: lines.length, startLine: start, endLine: last, partial: start !== 1 || last !== lines.length, text: lines.slice(start - 1, last).join("\n") }) }] };
      },
    });
    return tools;
  }

  async prompt(
    conversationId: string,
    projectPath: string,
    settings: ModelSettings,
    content: string,
    onDelta?: (delta: string) => void,
  ): Promise<string> {
    const selection = validateModelSelection(settings);
    if (selection.mode !== "local" || !selection.localEndpoint) throw new Error("当前没有启用本地模型");
    const selectedRpsme = /(?:@|\/skill:)materials-literature-rpsme-json\b/.test(content);
    const resumeRpsme = this.#workflowSources.has(conversationId) && /^\s*(?:请\s*)?(?:继续|重试|再试|重新(?:运行|提取|抽取|执行))/.test(content);
    const pdf = extractLocalPdfPath(content) ?? this.#workflowSources.get(conversationId);
    if (!this.#controls.has(conversationId) && (selectedRpsme || resumeRpsme) && pdf) {
      if (this.#workflowRuns.has(conversationId)) throw new Error("该会话的文献抽取仍在运行。");
      const controller = new AbortController();
      this.#workflowRuns.set(conversationId, controller);
      this.#workflowSources.set(conversationId, pdf);
      try {
        onDelta?.("正在准备 PDF 分页证据…");
        const spec = pdfPreprocessSpec(pdf, projectPath, this.#projectRoot);
        // Rebuild source hashes for each run: a PDF may have changed at the same path.
        await execFileAsync(spec.command, spec.args, { cwd: projectPath, signal: controller.signal, timeout: 600_000, maxBuffer: 2 * 1024 * 1024 });
        const limits = await discoverLocalModelLimits(selection.localEndpoint, selection.modelId);
        return await runRpsmeWorkflow({ pdfPath: pdf, projectPath, projectRoot: this.#projectRoot,
          python: spec.command, manifestPath: spec.manifest, endpoint: selection.localEndpoint,
          modelId: selection.modelId, contextWindow: limits.contextWindow, signal: controller.signal,
          ...(onDelta ? { onProgress: onDelta } : {}),
        });
      } catch (cause) {
        if (controller.signal.aborted) throw new Error("aborted");
        throw cause;
      } finally { this.#workflowRuns.delete(conversationId); }
    }
    const signature = `${selection.localEndpoint}|${selection.modelId}|${this.#connections.get(conversationId)?.id??"legacy"}|${this.#controls.has(conversationId) ? "supervised" : "legacy"}|skills:${this.#skillRevision}`;
    let active = this.#sessions.get(conversationId);
    let inheritedRpsme = active?.rpsmeContext || (active ? sessionUsesRpsme(active.session.messages) : false);
    let inheritedPdfPath = active?.sourcePdfPath || (active ? sessionSourcePdf(active.session.messages) : undefined);
    if (active && sessionContainsFabrication(active.session.messages)) {
      active.session.dispose();
      this.#sessions.delete(conversationId);
      this.#freshSessions.add(conversationId);
      active = undefined;
    }
    if (!active || active.signature !== signature) {
      active?.session.dispose();
      const session = await this.#createSession(conversationId, projectPath, selection.localEndpoint, selection.modelId);
      active = {
        signature, session,
        rpsmeContext: inheritedRpsme || sessionUsesRpsme(session.messages),
        sourcePdfPath: inheritedPdfPath || sessionSourcePdf(session.messages),
      };
      this.#sessions.set(conversationId, active);
    }
    if (sessionContainsFabrication(active.session.messages)) {
      inheritedRpsme ||= active.rpsmeContext || sessionUsesRpsme(active.session.messages);
      inheritedPdfPath ||= active.sourcePdfPath || sessionSourcePdf(active.session.messages);
      active.session.dispose();
      this.#freshSessions.add(conversationId);
      active = {
        signature,
        session: await this.#createSession(conversationId, projectPath, selection.localEndpoint, selection.modelId),
        rpsmeContext: inheritedRpsme,
        sourcePdfPath: inheritedPdfPath,
      };
      this.#sessions.set(conversationId, active);
    }
    // The SDK owns scheduling. Supervised stages share one active dependency state.
    active.session.agent.toolExecution=this.#controls.has(conversationId)?'sequential':'parallel';
    // A conversation may switch research domains or lose permissions between tasks.
    // Reapply this turn's scope without replacing the SDK session or its real history.
    active.session.setActiveToolsByName(
      this.#activeTools(conversationId,projectPath,active.session.getAllTools().map(t=>t.name)));
    const turnMessages: SessionMessage[] = [];
    const isEvidenceExtraction = !this.#controls.has(conversationId) && (/(?:@|\/skill:)materials-literature-rpsme-json\b/.test(content)
      || (active.rpsmeContext && /继续|重试|再来一次|刚才|文献|论文|PDF|提取|校验|结果|执行/i.test(content)));
    if (isEvidenceExtraction) active.rpsmeContext = true;
    if (extractLocalPdfPath(content)) active.sourcePdfPath = extractLocalPdfPath(content);
    const toolArgs = new Map<string, { toolName: string; args: unknown }>();
    let evidenceRead = false;
    let workflowFailure: Error | undefined;
    const runStartedAt = Date.now();
    const unsubscribe = active.session.subscribe((event: AgentSessionEvent) => {
      if (event.type === "tool_execution_start") {
        toolArgs.set(event.toolCallId, { toolName: event.toolName, args: event.args });
        const pathError = isEvidenceExtraction ? rpsmeToolPathError(event.toolName, event.args, projectPath) : undefined;
        if (pathError) {
          workflowFailure = new Error(pathError);
          void active.session.abort();
        } else if (isEvidenceExtraction && isPrematureRpsmeFinalization(event.toolName, event.args, evidenceRead, projectPath)) {
          workflowFailure = new Error("模型在真实 RPSME 草稿尚未写入磁盘时调用了校验或资产脚本。已停止本轮任务，未生成有效结果。");
          void active.session.abort();
        }
      }
      if (event.type === "tool_execution_end" && !event.isError) {
        const call = toolArgs.get(event.toolCallId);
        const args = call?.args as { path?: unknown; command?: unknown } | undefined;
        const target = call?.toolName === "read" ? String(args?.path ?? "") : String(args?.command ?? "");
        if (/(?:page-\d{4}\.txt|source-corpus\.md)/.test(target)) evidenceRead = true;
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        turnMessages.push(event.message);
        const text = event.message.content
          .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
          .map((part) => part.text)
          .join("");
        if (isEvidenceExtraction && hasFabricatedExecution(text)) void active.session.abort();
      }
      if (event.type === "agent_end" && turnMessages.length === 0) {
        turnMessages.push(...event.messages.filter((message) => message.role === "assistant"));
      }
      if (!onDelta) return;
      if (isEvidenceExtraction) {
        if (event.type === "tool_execution_start") onDelta(`\n正在运行 ${event.toolName} 工具…`);
      } else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        onDelta(event.assistantMessageEvent.delta);
      }
    });
    try {
      let promptContent = content;
      if (isEvidenceExtraction && active.sourcePdfPath) {
        onDelta?.("\n正在准备并读取 PDF 分页证据…");
        const limits = await discoverLocalModelLimits(selection.localEndpoint, selection.modelId);
        const source = await prepareRpsmeSourceContext(active.sourcePdfPath, projectPath, this.#projectRoot, Math.min(100_000, limits.contextWindow * 2));
        evidenceRead = source.includedPages === source.pageCount;
        promptContent += `\n\n${source.context}\n\n[MaterialsX 执行要求：以上 ${source.includedPages} 页已由应用实际读取。请直接依据这些原文内容写出有证据的真实草稿 JSON；只有草稿文件存在后才能运行质量和校验脚本。]`;
      }
      const answer=await withLocalResponseRecovery(async correction=>{
        if(correction&&this.#controls.get(conversationId)?.sourceRetrievalComplete?.())return '';
        await active.session.prompt(correction??applyLocalExecutionPolicy(promptContent, isEvidenceExtraction));
        if (this.#supervisionErrors.has(conversationId)) throw this.#supervisionErrors.get(conversationId);
        if (workflowFailure) throw workflowFailure;
        return assistantText(turnMessages);
      },this.#controls.get(conversationId),(_attempt,fault)=>onDelta?.('\n'+recoveryNotice(fault)+'\n'),()=> '');
      if (isEvidenceExtraction) await verifyRpsmeDeliverables(projectPath, runStartedAt, evidenceRead);
      return answer;
    } catch (cause) {
      if (turnMessages.some((message) => message.role === "assistant" && hasFabricatedExecution(
        message.content.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text").map((part) => part.text).join(""),
      ))) {
        active.session.dispose();
        this.#sessions.delete(conversationId);
        this.#freshSessions.add(conversationId);
        throw new Error("任务完整性检查未通过：模型试图模拟执行或写入占位事实。已停止本轮工具调用；下次请求将使用干净会话。");
      }
      if (this.#supervisionErrors.has(conversationId)) throw this.#supervisionErrors.get(conversationId);
      if (workflowFailure) throw workflowFailure;
      throw cause;
    } finally {
      unsubscribe();
    }
  }

  async steer(conversationId:string,content:string):Promise<void>{
    const active=this.#sessions.get(conversationId);
    if(this.#workflowRuns.has(conversationId)||!active?.session.isStreaming)throw Error("此任务不支持持续输入，或当前没有执行中的任务");
    await active.session.steer(content);
  }

  async cancel(conversationId: string): Promise<boolean> {
    const workflow = this.#workflowRuns.get(conversationId);
    if (workflow) { workflow.abort(); return true; }
    const active = this.#sessions.get(conversationId);
    if (!active?.session.isStreaming) return false;
    await active.session.abort();
    return true;
  }

  invalidate(conversationId:string):void {const s=this.#sessions.get(conversationId);if(s?.session.isStreaming||this.#workflowRuns.has(conversationId))throw Error("CONVERSATION_ACTIVE");s?.session.dispose();this.#sessions.delete(conversationId);}

  dispose(): void {
    for (const workflow of this.#workflowRuns.values()) workflow.abort();
    this.#workflowRuns.clear();
    for (const active of this.#sessions.values()) active.session.dispose();
    this.#sessions.clear();
  }

  async #createSession(conversationId: string, projectPath: string, endpoint: string, modelId: string): Promise<AgentSession> {
    const {runtime:modelRuntime,model,limits,connection}=await localRuntime(endpoint,modelId,this.#connections.get(conversationId));
    let wireUsage:unknown|null=null;const transport=localWireFetch(connection,fetch,v=>{wireUsage=v;});

    const agentDir = join(this.#userData, "pi-agent");
    const sessionDir = join(this.#userData, "pi-sessions");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(sessionDir, { recursive: true });
    const settingsManager = SettingsManager.inMemory({
      compaction: {
        enabled: true,
        reserveTokens: limits.maxTokens,
        keepRecentTokens: Math.max(8_000, limits.maxTokens),
      },
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: projectPath,
      agentDir,
      settingsManager,
      additionalSkillPaths: [...DEFAULT_SKILL_PATHS.map((path) => join(this.#projectRoot, path)),...(this.userSkills?.()??[])],
      skillsOverride: base => {
        const control=this.#controls.get(conversationId);if(!control)return base;
        const request=control.plan()?.originalRequest ?? "";
        const names=new Set(parseReferences(request).filter(r=>r.kind==='skill').map(r=>r.value));
        return {...base,skills:base.skills.filter(s=>names.has(s.name))};
      },
      noExtensions: true,
      extensionFactories:[api=>{
        supervisePi(api, () => this.#controls.get(conversationId), name => this.toolCapabilities(projectPath, conversationId).get(name), limits, error => { this.#supervisionErrors.set(conversationId, error); void this.#sessions.get(conversationId)?.session.abort(); },{begin:()=>{wireUsage=null;},usage:()=>wireUsage});
        api.on('tool_call',event=>{
        const granted=this.#permissions.get(conversationId);if(!granted)return;
        const required=this.toolCapabilities(projectPath,conversationId).get(event.toolName);
        if(!required||required.some(p=>!granted.includes(p)))return {block:true,reason:'工具超出本轮授权：'+event.toolName};
      })}],
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: MATERIALS_SYSTEM_PROMPT + "\nUse skill_search to find installed Skills, read the chosen SKILL.md before use. Use find_tools to discover further registered tools. Skills never expand the host grant.",
    });
    await resourceLoader.reload();
    const fresh = this.#freshSessions.delete(conversationId);
    const existing = fresh ? undefined : SessionManager.findById(projectPath, conversationId, sessionDir);
    const sessionManager = existing
      ? SessionManager.open(existing, sessionDir, projectPath)
      : SessionManager.create(projectPath, sessionDir, { id: fresh ? randomUUID() : conversationId });
    const availableTools = this.#definitions(projectPath,conversationId);
    if(!availableTools.some(t=>t.name==='read_skill')){
      const t=(await this.hostTools(projectPath,conversationId,['read'])).find(t=>t.name==='read_skill');
      if(t)availableTools.push(defineTool({...t,label:t.name,parameters:t.parameters as any,execute:async(_id,args,signal)=>({...await t.execute(args,signal??new AbortController().signal),details:{}})}));
    }
    const findTools = defineTool({ name: "find_tools", label: "查找工具", description: "Find and activate up to eight relevant registered tools by Chinese/English purpose or exact name. Use includeSchema=true for exact parameters; no installation, execution or new permissions.",
      parameters: { type: "object", properties: { query: { type: "string", maxLength: 160 }, includeSchema:{type:"boolean"} }, required: ["query"], additionalProperties: false } as any,
      execute: async (_id, args: any) => {
        const permissions = this.#permissions.get(conversationId) ?? [];
        const registered=session.getAllTools().map(t=>({...t,parameters:t.parameters as Record<string,unknown>,permissions:this.toolCapabilities(projectPath,conversationId).get(t.name)??[]}));
        const result=discoverTools(registered,permissions,args.query,this.#controls.get(conversationId)?.capabilities?.(),args.includeSchema===true);
        session.setActiveToolsByName([...new Set([...session.getActiveToolNames(), ...result.tools.map(t=>t.name)])]);
        return {content:[{type:'text' as const,text:JSON.stringify(result)}],details:{}};
      } });
    const localTools = [...availableTools, taskControlTool(() => this.#controls.get(conversationId)), findTools];
    const readOnly=this.#readOnlyWorkspaces.has(conversationId);
    const scoped=readOnly?(await projectTools(projectPath,join(this.#userData,'subtask-tools',conversationId))).filter(t=>['read','ls'].includes(t.name)).map(t=>defineTool({...t,label:t.name,parameters:t.parameters as any,execute:async(_id,args,signal)=>({...await t.execute(args,signal!),details:{}})})):[];
    const { session } = await createAgentSession({
      cwd: projectPath,
      modelRuntime,
      model,
      resourceLoader,
      settingsManager,
      sessionManager,
      // SDK tools is a permanent registry allow-list, not just this turn's visible loadout.
      // Register existing tools once; the grant-filtered active list is set before any prompt.
      tools: [...(readOnly?['read','ls']:['read','find','grep','ls','bash','write','edit']),...availableTools.map(t=>t.name),'task_control','find_tools'],
      customTools: [...(readOnly?scoped:[createMaterialsReadTool(projectPath, this.#projectRoot), createMaterialsWriteTool(projectPath)]), ...localTools],
    });
    const originalStream = session.agent.streamFunction;
    session.agent.streamFunction = (model, context, options) => originalStream(model, context, { ...options, maxRetries: 0,
      fetch: async (input, init) => {
        const fault = this.#supervisionErrors.get(conversationId);
        if (fault) throw fault;
        init?.signal?.throwIfAborted();
        return transport(input, init);
      },
    });
    await session.bindExtensions({onError:()=>{}});
    session.setActiveToolsByName(this.#activeTools(conversationId,projectPath,session.getAllTools().map(t=>t.name)));
    return session;
  }
  #activeTools(conversationId:string,projectPath:string,names:string[]){
    const plan=this.#controls.get(conversationId)?.plan(),granted=this.#permissions.get(conversationId);
    const initial=plan?initialToolNames(this.#definitions(projectPath,conversationId).filter(t=>this.toolCapabilities(projectPath,conversationId).get(t.name)?.every(p=>!granted||granted.includes(p))),plan.originalRequest,plan.steps.map(s=>s.method)):null;
    const core=new Set(['read','find','grep','ls','bash','write','edit','task_control','find_tools']);
    const capabilities=this.toolCapabilities(projectPath,conversationId);
    return names.filter(name=>(!initial||core.has(name)||initial.has(name))&&
      (!granted||capabilities.get(name)?.every(p=>granted.includes(p))));
  }
}
