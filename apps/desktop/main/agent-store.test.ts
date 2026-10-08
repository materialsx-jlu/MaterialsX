import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkspaceStore } from "./store.js";
import {
  permissionGrantSchema,
  taskRefSchema,
} from "../../../packages/contracts/src/agent.js";
import { directPlan } from "../../../packages/agent/src/research-planning.js";
import { modelConnectionSchema, type EngineSessionRef } from "../../../packages/contracts/src/engine-selection.js";
import { profileFor } from "../../../packages/agent/src/local-model-transport.js";
test("research contract persists once in workspace, owns actual task and rejects stale writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "mx-ua1-store-")),
    file = join(dir, "workspace.sqlite");
  let store = new WorkspaceStore(file);
  try {
    const project = store.createProject(join(dir, "project")),
      conversation = store.createConversation(project.id),
      run = store.addRun(project.id, "goal", "running");
    const task = taskRefSchema.parse({
      taskId: run.id,
      projectId: project.id,
      conversationId: conversation.id,
    });
    const grant = permissionGrantSchema.parse({
      grantId: randomUUID(),
      projectId: project.id,
      conversationId: conversation.id,
      permissions: ["read"],
      approvedBy: "local-user",
      maxCredits: null,
      maxSeconds: 60,
    });
    const plan = directPlan("显示结构", {
      task,
      grant,
      methods: new Map([["engine.execute", []]]),
    });
    store.saveResearchPlan(plan);
    assert.throws(() => store.saveResearchPlan(plan));
    const foreign = { ...plan, task: { ...task, taskId: randomUUID() as any } };
    assert.throws(() => store.saveResearchPlan(foreign));
    store.saveAgentThread("account:conversation", "native-thread");
    store.saveSettings({
      mode: "platform",
      modelId: "materials-research",
      localEndpoint: "",
      agentEngine: "codex",
    });
    store.close();
    store = new WorkspaceStore(file);
    assert.deepEqual(store.researchPlan(run.id), plan);
    assert.equal(store.agentThread("account:conversation"), "native-thread");
    assert.equal(store.getSettings().agentEngine, "codex");
    assert.equal(store.listRuns()[0]?.status, "interrupted");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("engine/model snapshot survives restart and cannot change within a task or escape its scope", () => {
  const dir = mkdtempSync(join(tmpdir(), "mx-engine-store-"));
  const file = join(dir, "state.sqlite");
  let store = new WorkspaceStore(file);
  try {
    const project = store.createProject(join(dir, "project"));
    const conversation = store.createConversation(project.id);
    const run = store.addRun(project.id, "local", "running");
    const connection = modelConnectionSchema.parse({ id: "model-" + "a".repeat(32), source: "local", endpoint: "http://localhost:1234/v1", modelId: "actual-local", protocol: "responses", contextWindow: 32768, maxOutputTokens: 4096, revision: "loaded-v1" });
    const profile = profileFor(connection, "codex", "limited", { zh: "检测通过", en: "Probe passed" }, ["stream", "tool-call", "tool-result"]);
    const session: EngineSessionRef = {
      task: taskRefSchema.parse({ taskId: run.id, projectId: project.id, conversationId: conversation.id }),
      accountRef: "local", nativeSessionId: null, connection,
      selection: { engine: "codex", engineVersion: profile.engineVersion, modelConnectionRef: connection.id, compatibilityRef: profile.id, selectedBy: "user" },
    };
    store.saveCompatibility(profile); store.saveEngineSession(session);
    const started = { ...session, nativeSessionId: "native-thread" };
    store.saveEngineSession(started);
    const answer = store.appendMessage(conversation.id, "assistant", "Actual answer", "complete", run.id);
    assert.equal(answer.taskId, run.id);
    const otherConversation = store.createConversation(project.id);
    assert.throws(() => store.appendMessage(otherConversation.id, "assistant", "Wrong task", "complete", run.id), /SCOPE/);
    assert.equal(store.listMessages(otherConversation.id).length, 0);
    assert.equal(store.appendMessage(conversation.id, "assistant", "Legacy answer", "complete").taskId, undefined);
    assert.throws(() => store.saveEngineSession({ ...started, selection: { ...started.selection, engine: "pi" } }), /IMMUTABLE/);
    assert.throws(() => store.saveEngineSession({ ...started, nativeSessionId: null }), /IMMUTABLE/);
    assert.throws(() => store.saveEngineSession({ ...started, task: { ...started.task, projectId: randomUUID() as any } }), /SCOPE/);
    store.close(); store = new WorkspaceStore(file);
    assert.deepEqual(store.engineSession(run.id), started);
    assert.equal(store.listMessages(conversation.id).find(m => m.id === answer.id)?.taskId, run.id);
    assert.deepEqual(store.compatibility(profile.id), profile);
    assert.equal(modelConnectionSchema.safeParse({ ...connection, endpoint: "invalid" }).success, false);
    assert.equal(modelConnectionSchema.safeParse({ ...connection, contextWindow: null }).success, false);
    assert.equal(modelConnectionSchema.safeParse({ ...connection, source: "platform", endpoint: null, contextWindow: null }).success, true);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
