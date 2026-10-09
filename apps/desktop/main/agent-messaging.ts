import {prepareTaskReferences} from './prepare-task-references.js';
import type {PaperRecord} from '../../../packages/contracts/src/papers.js';
import { admittedPlatformModel } from '../../../packages/contracts/src/platform-model-admission.js';
import { registerExecutionIpc } from "./agent-execution-ipc.js";
import { scienceInputGuidance } from './science-input-guidance.js';
import { createSkillChatInstaller, parseSkillInstallCommand } from './skill-installation.js';
import type { SkillInstallationService } from '../../../packages/skills/src/installation-service.js';
import { skillCapabilityQuestion } from '../../../packages/skills/src/installation-capability.js';
import { z } from "zod";
import { directPlan } from "../../../packages/agent/src/research-planning.js";
import {recoveryFailureMessage} from '../../../packages/agent/src/recovery-presentation.js';
import {
  AgentError,
  permissionGrantSchema,
  taskRefSchema,
} from "../../../packages/contracts/src/agent.js";
import { app, dialog, ipcMain, type BrowserWindow } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  SendMessageInput,
  MessageStreamEvent,
  SkillSummary,
} from "../../../packages/contracts/src/desktop.js";
import type { ScientificScope } from "../../../packages/contracts/src/potential-physics.js";
import type { AnalysisScope } from "../../../packages/contracts/src/potential-workflow.js";
import type { IdentityClient } from "../../../packages/control-plane-client/src/identity.js";
import type { PiLocalSessionService } from "../../../packages/pi-adapter/src/local-session.js";
import {
  extractLocalPdfPath,
  pdfPreprocessSpec,
} from "../../../packages/pi-adapter/src/local-session-tools.js";
import {
  createScienceBridge,
  type ScienceBridge,
} from "../../../packages/pi-adapter/src/science-bridge.js";
import type {
  PiPlatformSessionService,
  CloudAsset,
} from "../../../packages/pi-adapter/src/platform-session.js";
import { runRpsmeWorkflow } from "../../../packages/pi-adapter/src/rpsme-workflow.js";
import { TextStreamBuffer } from "../../../packages/pi-adapter/src/text-stream-buffer.js";
import type { AtomisticRuntime } from "../../../packages/atomistic/src/runtime.js";
import type { PotentialAnalysisService } from "../../../packages/atomistic/src/potential-workflow.js";
import type { UserSkillService } from "../../../packages/atomistic/src/user-skills.js";
import { snapshotPdfFile } from "./cloud-files.js";
import type { WorkspaceStore } from "./store.js";
import type { DesktopAgentRuntime } from "./agent-runtime.js";
interface MessagingContext {
  store: WorkspaceStore;
  piSessions: PiLocalSessionService;
  platformSessions: PiPlatformSessionService;
  agentRuntime: DesktopAgentRuntime;
  identityClient: IdentityClient;
  authorizeResearch:(id:string,cloud:boolean)=>Promise<void>;
  atomistic: AtomisticRuntime;
  potentialAnalysis: PotentialAnalysisService;
  userSkills: UserSkillService;
  installedSkills: SkillInstallationService;
  projectRoot: string;
  activeConversations: Set<string>;
  cloudFiles: Map<string, CloudAsset[]>;
  scienceScopes: Map<string, ScientificScope>;
  analysisScopes: Map<string, AnalysisScope>;
  loadSkills(): SkillSummary[];
  papers(projectId:string):PaperRecord[];
  window(): BrowserWindow | null;
  isShuttingDown(): boolean;
  requestAtomicView(projectId: string, structureId: string): void;
  sendMessageStream(event: MessageStreamEvent): void;
  assertText(value: unknown, name: string): string;
}
export function registerAgentMessaging(context: MessagingContext) {
  const {
    store,
    piSessions,
    platformSessions,
    agentRuntime,
    identityClient,
    atomistic,
    potentialAnalysis,
    userSkills,
    projectRoot,
    activeConversations,
    cloudFiles,
    scienceScopes,
    analysisScopes,
    loadSkills,
    window,
    isShuttingDown,
    requestAtomicView,
    sendMessageStream,
    assertText,
  } = context;
  registerExecutionIpc({store,agentRuntime,identityClient,sendMessageStream,activeConversations});
  const skillInstaller = createSkillChatInstaller({service:context.installedSkills,store,active:activeConversations,emit:sendMessageStream});
  ipcMain.handle("agent:plan", (_event, id: unknown) =>
    agentRuntime.plan(assertText(id, "taskId")),
  );
  ipcMain.handle("agent:session", (_event, id: unknown) => agentRuntime.session(assertText(id, "taskId")));
  ipcMain.handle("agent:compatibility", (_event, settings) => agentRuntime.localCompatibility(settings));
  ipcMain.handle(
    "agent:steer",
    (_event, input: { conversationId: string; content: string }) =>
      agentRuntime.steer(
        assertText(input?.conversationId, "conversationId"),
        assertText(input?.content, "content"),
      ),
  );
  ipcMain.handle(
    "workspace:send-message",
    async (_event, input: SendMessageInput) => {
      const projectId = assertText(input?.projectId, "projectId");
      const conversationId = assertText(
        input?.conversationId,
        "conversationId",
      );
      const content = assertText(input?.content, "content");
      const project = store.getProject(projectId);
      if (
        !project ||
        !store
          .listConversations()
          .some((c) => c.id === conversationId && c.projectId === projectId)
      )
        throw new Error("项目或对话不存在");
      if (activeConversations.has(conversationId))
        throw new Error("此对话已有任务正在运行");
      if(skillCapabilityQuestion(content))return skillInstaller.handle({...input,projectId,conversationId,content},null);
      const installSource=parseSkillInstallCommand(content);
      if(installSource!==null)return skillInstaller.handle({...input,projectId,conversationId,content},installSource);
      const recordUnstarted = (status: 'failed' | 'cancelled', reason: string) => {
        const run = store.addRun(projectId, content.slice(0, 80), status, conversationId);
        store.appendMessage(conversationId, 'user', content, 'complete', run.id);
        store.appendMessage(conversationId, 'system', `${reason}\n未发起云模型调用，未扣费。`, status, run.id);
        store.renameConversationFromFirstMessage(conversationId, content);
        return store.listMessages(conversationId);
      };
      activeConversations.add(conversationId);
      let cloud:
        | {
            science?: ScienceBridge;
            workspaceTools?:boolean;
            pdf?: Awaited<ReturnType<typeof snapshotPdfFile>>;
            accountId: string;
            catalog: Awaited<ReturnType<PiPlatformSessionService["catalog"]>>;
            selection: { files: CloudAsset[]; skills: CloudAsset[] };
          }
        | undefined;
      const settings = store.getSettings();
      let references:Awaited<ReturnType<typeof prepareTaskReferences>>;
      try {
        await context.authorizeResearch(projectId,settings.mode==='platform');
        references=await prepareTaskReferences(content,projectId,{store,files:[...(cloudFiles.get(conversationId)??[]),...(settings.mode==='local'?agentRuntime.restorableFiles(projectId,conversationId,content):[])].filter((a,i,all)=>all.findIndex(v=>v.id===a.id)===i),skills:loadSkills(),
          ...(scienceScopes.has(conversationId)?{scope:scienceScopes.get(conversationId)!}:{}),platform:settings.mode==='platform',root:projectRoot,
          installedText:name=>context.installedSkills.text(name),userText:name=>userSkills.text(name),atomistic,papers:()=>context.papers(projectId)});
        if (settings.mode === "platform") {
          const account = await identityClient.snapshot();
          if (account.status !== "connected" || !account.user)
            throw new Error("请先在设置中登录平台账户");
          const catalog = await platformSessions.catalog();
          const selectedModel = admittedPlatformModel(catalog, settings.modelId);
          if (!selectedModel)
            throw new Error("所选平台模型当前不可用，请到设置中刷新模型目录或检查 MX 点余额");
          const {files,skills}=references.selection;
          const named=skills.map(s=>s.name);
          if(skills.length>8)throw Error('一轮最多点名 8 个 Skill / At most 8 Skills');
          const scope = scienceScopes.get(conversationId);
          if (named.includes("materials-mlip-md") && !scope)
            throw Error(
              "平台 MD 任务需要先在势目录选择结构、MD 参数并授权本轮范围",
            );
          if (scope && scope.projectId !== projectId)
            throw Error("科学范围与项目不匹配");
          if (
            (scope &&
              named.includes("materials-mlip-md") &&
              scope.permission !== "md") ||
            (scope &&
              named.some((n) => n === "materials-mlip-relaxation") &&
              scope.permission !== "relaxation") ||
            (scope &&
              named.some(
                (n) =>
                  n === "materials-mlip-singlepoint" ||
                  n === "materials-mlip-comparison",
              ) &&
              scope.permission !== "singlepoint")
          )
            throw Error(
              "选定的科学任务权限与点名 Skill 不一致，请在势目录选择对应任务范围",
            );
          const science = scope
            ? createScienceBridge(
                atomistic,
                projectId,
                scope,
                (id) => requestAtomicView(projectId, id),
                analysisScopes.has(conversationId)
                  ? {
                      service: potentialAnalysis,
                      scope: analysisScopes.get(conversationId)!,
                      prompt: content,
                    }
                  : undefined,
              )
            : undefined;
          const scienceReview = science
            ? `\n\n本轮本机科学授权：${JSON.stringify(scope)}\n自动下载范围：${JSON.stringify(analysisScopes.get(conversationId) ?? null)}\n仅以下结构摘要发给模型（无坐标、完整力数组和本机路径）：\n${JSON.stringify(science.summary, null, 2)}\n最多 2 个 CPU 任务；每个默认 256 原子 / 600 秒 / 4096 MiB / 64 MiB，优化或 MD 按已选参数（MD 最多 2000 步，固定晶胞）；轨迹/速度留在本机。计算不扣积分，LLM 请求按本任务额度结算。模型只能访问本轮结构和自己创建的任务。`
            : "";
          let sourcePdf =
            /(?:@|\/skill:)materials-literature-rpsme-json\b/.test(content)
              ? extractLocalPdfPath(content)
              : undefined;
          if (
            !sourcePdf &&
            /^\s*(?:请\s*)?(?:继续|重试|重新(?:抽取|提取|执行))/.test(
              content,
            ) &&
            store.latestCloudTask(account.user.id, conversationId)
          ) {
            const previous = store
              .listMessages(conversationId)
              .slice()
              .reverse()
              .find(
                (m) =>
                  m.role === "user" &&
                  /(?:@|\/skill:)materials-literature-rpsme-json\b/.test(
                    m.content,
                  ) &&
                  extractLocalPdfPath(m.content),
              );
            if (previous) sourcePdf = extractLocalPdfPath(previous.content);
          }
          const pdf = sourcePdf
            ? await snapshotPdfFile(project.path, sourcePdf)
            : undefined;
          if (pdf && science)
            throw Error("文献流程与科学调度须分开任务；请先清除科学授权");
          if (pdf && settings.modelId !== 'materials-research')
            throw Error('受管 PDF 文献流程当前仅支持 materials-research；请切换模型或移除该 Skill');
          const billingNotice = selectedModel.accessMode === 'mx-points'
            ? `本轮使用 ${selectedModel.id}，按 MX 点价格版本 ${selectedModel.salesPriceVersionId} 计费。模型调用前预留点数；取得可靠终态用量后按实际 Token 扣点并释放剩余预留。用量缺失时预留保留待核对。`
            : catalog.paidPricing
              ? `本轮使用 ${selectedModel.id}，按已发布积分价格版本 ${catalog.paidPricing.id} 计费；调用前预留，取得可靠终态用量后结算。`
              : catalog.testPricing
                ? `本轮使用 ${selectedModel.id}，按测试价格版本 ${catalog.testPricing.id} 消耗 test-credit；调用前预留，取得可靠终态用量后结算。`
                : `本轮使用 ${selectedModel.id} 进行授权测试，不扣 MX 点。`;
          const allowWorkspaceTools = !pdf && settings.cloudWorkspaceTools === true;
          const review = await dialog.showMessageBox(window()!, {
            type: "question",
            title: "确认本轮云端数据范围",
            message: `发送到 MaterialsX 网关 · ${selectedModel.id}`,
            detail: `${billingNotice}\n单次模型调用受供应商接口容量约束；任务最长 ${catalog.alpha.limits.maxDurationSeconds} 秒。\n\n${allowWorkspaceTools ? `本轮项目工具授权：允许读写与搜索项目 ${project.path}，运行项目终端命令；项目内容与工具结果会外发给模型。终端网络关闭，额外目录与权限请求会拒绝。` : ""}\n本轮绑定引用（仅元数据，不增加权限）：\n${JSON.stringify(references.bindings)}\n本轮问题：\n${content}\n\n同账户本对话的平台历史（含之前批准的工具结果）：${pdf ? "本轮受管流程不附对话历史" : settings.agentEngine === "codex" ? "启用原生历史恢复，此前批准的输入和工具结果可能随会话再次外发" : platformSessions.historyLength(account.user.id, conversationId) + " 条"}。\n\n${pdf ? "本轮受管文献流程不读取额外文本附件。" : ""}\n批准读取的文本快照：${files.map((f) => `${f.name} (${Buffer.byteLength(f.text)} bytes, SHA256 ${f.sha256})`).join("\n") || "无"}\n\n点名内置 Skill：${skills.map((s) => s.name).join(", ") || "无"}\n${pdf ? `受管 RPSME 文献流程：本地预处理 PDF ${pdf.name}（${pdf.size} bytes，SHA256 ${pdf.sha256}），逐页原文、修复提示和元数据会发送到模型。图像/PDF 原始字节不上传。所有页归入同一个任务账单；本轮不附历史。` : allowWorkspaceTools ? "项目工具可按本轮授权读取和写入项目文本、执行隔离终端与 Git 状态；文本结果发送给平台模型。科学计算仍需独立范围授权，MOOS 外发未开放。" : "通用对话支持已批准的只读文本与 Skill。"}${scienceReview}`,
            buttons: ["取消", "同意本轮外发"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (review.response !== 1) {
            activeConversations.delete(conversationId);
            return recordUnstarted('cancelled', '已取消本轮云端数据外发。');
          }
          if (science) {
            const directory = join(
              app.getPath("userData"),
              "atomistic",
              "consents",
            );
            await mkdir(directory, { recursive: true });
            await writeFile(
              join(directory, `${randomUUID()}.json`),
              JSON.stringify(
                {
                  version: "m6.4-v1",
                  approvedAt: new Date().toISOString(),
                  scope,
                  summary: science.summary,
                  summarySha256: createHash("sha256")
                    .update(JSON.stringify(science.summary))
                    .digest("hex"),
                  maxLocalJobs: 2,
                  approvedBy: "native-dialog-explicit-accept",
                },
                null,
                2,
              ) + "\n",
              { flag: "wx", mode: 0o600 },
            );
          }
          cloud = {
            workspaceTools:allowWorkspaceTools,
            accountId: account.user.id,
            catalog,
            selection: { files, skills },
            ...(science ? { science } : {}),
            ...(pdf ? { pdf } : {}),
          };
        }
      } catch (e) {
        activeConversations.delete(conversationId);
        return recordUnstarted('failed', `任务准备失败：${e instanceof Error ? e.message : String(e)}`);
      }
      if (isShuttingDown()) {
        activeConversations.delete(conversationId);
        return [];
      }
      const run = store.addRun(projectId, content.slice(0, 80), "running", conversationId);
      store.appendMessage(conversationId, "user", content, "complete", run.id);
      store.renameConversationFromFirstMessage(conversationId, content);
      if (cloud?.pdf) {
        const task = taskRefSchema.parse({
          taskId: run.id,
          projectId,
          conversationId,
        });
        const grant = permissionGrantSchema.parse({
          grantId: randomUUID(),
          projectId,
          conversationId,
          permissions: ["read", "patch"],
          approvedBy: "native-dialog",
          maxCredits: null,
          maxSeconds: cloud.catalog.alpha.limits.maxDurationSeconds,
        });
        const plan = directPlan(content, {
          task,
          grant,
          methods: new Map([["engine.execute", []]]),
        });
        plan.goal.problemType = "受管论文证据提取";
        plan.steps[0]!.expectedArtifacts = [
          "RPSME JSON",
          "中文摘要",
          "校验报告",
        ];
        plan.acceptance.requiredArtifacts = [
          ...plan.steps[0]!.expectedArtifacts,
        ];
        store.saveResearchPlan(plan);
      }
      const streamId = `stream:${conversationId}:${input.streamToken ? z.uuid().parse(input.streamToken) : run.id}`;
      let sequence = 0;
      let streamedText = "";
      const emit = (
        event: Omit<
          MessageStreamEvent,
          "conversationId" | "streamId" | "sequence"
        >,
      ): void => {
        sendMessageStream({
          conversationId,
          streamId,
          sequence: sequence++,
          ...event,
        });
      };
      const buffer = new TextStreamBuffer(
        (delta) => emit({ type: "delta", delta }),
        32,
      );
      emit({ type: "start" });
      try {
        const onDelta = (delta: string) => {
          streamedText += delta;
          buffer.push(delta);
        };
        const inputGuidance=scienceInputGuidance(content,scienceScopes.get(conversationId),analysisScopes.get(conversationId));
        const answer = inputGuidance ?? (cloud
          ? cloud.pdf
            ? await platformSessions.workflow(
                cloud.accountId,
                conversationId,
                cloud.catalog,
                undefined,
                async (signal, invoke) => {
                  onDelta("正在本地准备 PDF 分页证据…");
                  const spec = pdfPreprocessSpec(
                    cloud!.pdf!.path,
                    project.path,
                    projectRoot,
                  );
                  await promisify(execFile)(spec.command, spec.args, {
                    cwd: project.path,
                    signal,
                    timeout: 600000,
                    maxBuffer: 2 * 1024 * 1024,
                  });
                  return runRpsmeWorkflow(
                    {
                      pdfPath: cloud!.pdf!.path,
                      projectPath: project.path,
                      projectRoot,
                      python: spec.command,
                      manifestPath: spec.manifest,
                      endpoint: `materialsx-platform:${cloud!.catalog.items[0]?.routeVersionId}`,
                      modelId: "materials-research",
                      contextWindow: 10000,
                      signal,
                      onProgress: onDelta,
                    },
                    invoke,
                  );
                },
                onDelta,
              )
            : await agentRuntime.run(
                run.id,
                projectId,
                conversationId,
                project.path,
                settings,
                content,
                onDelta,
                cloud,
                event=>emit({type:"phase",executionEvent:event}),
                undefined,undefined,undefined,references,
              )
          : await agentRuntime.run(
              run.id,
              projectId,
              conversationId,
              project.path,
              settings,
              content,
              onDelta,
              undefined,
              event=>emit({type:"phase",executionEvent:event}),
                undefined,undefined,undefined,references,
            ));
        buffer.close();
        if (isShuttingDown()) {
          activeConversations.delete(conversationId);
          return [];
        }
        store.appendMessage(conversationId, "assistant", answer, "complete", run.id);
        store.updateRun(run.id, inputGuidance ? 'blocked' : agentRuntime.execution(run.id)?.state === "waiting" ? "waiting" : agentRuntime.execution(run.id)?.state === "completed_with_limitations" ? "completed_with_limitations" : "completed");
        emit({ type: "complete", content: answer });
      } catch (cause) {
        buffer.close();
        if (isShuttingDown()) {
          activeConversations.delete(conversationId);
          return [];
        }
        const message = recoveryFailureMessage(cause,agentRuntime.execution(run.id));
        const cancelled =
          (cause instanceof AgentError && cause.code === "CANCELLED") ||
          /abort/i.test(message);
        const partial = streamedText.trim();
        if (partial)
          store.appendMessage(
            conversationId,
            "assistant",
            partial,
            cancelled ? "cancelled" : "failed",
            run.id,
          );
        if (!partial || !cancelled) {
          store.appendMessage(
            conversationId,
            "system",
            `${cloud ? "平台" : "本地"}任务${cancelled ? "已停止" : "失败"}：${message}`,
            cancelled ? "cancelled" : "failed",
            run.id,
          );
        }
        store.updateRun(run.id, cancelled ? "cancelled" : agentRuntime.execution(run.id)?.state === "blocked" ? "blocked" : "failed");
        emit({
          type: cancelled ? "cancelled" : "error",
          content: partial,
          error: message,
        });
      }
      activeConversations.delete(conversationId);
      return store.listMessages(conversationId);
    },
  );
  ipcMain.handle(
    "workspace:cancel-run",
    async (_event, conversationId: unknown) =>
      skillInstaller.cancel(assertText(conversationId, "conversationId")) || (await agentRuntime.cancel(
        assertText(conversationId, "conversationId"),
      )) ||
      platformSessions.cancel(assertText(conversationId, "conversationId")) ||
      piSessions.cancel(assertText(conversationId, "conversationId")),
  );
}
