import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { WorkspaceStore } from "./store.js";

const temporaryDirectories: string[] = [];

function temporaryDatabase(): { directory: string; database: string } {
  const directory = mkdtempSync(join(tmpdir(), "materialsx-store-"));
  temporaryDirectories.push(directory);
  return { directory, database: join(directory, "workspace.sqlite") };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("WorkspaceStore", () => {
  it("defaults to Codex without overwriting an explicit saved engine",()=>{
    const {database}=temporaryDatabase();const store=new WorkspaceStore(database);
    assert.equal(store.getSettings().agentEngine,"codex");
    store.saveSettings({...store.getSettings(),agentEngine:"pi"});store.close();
    const restored=new WorkspaceStore(database);assert.equal(restored.getSettings().agentEngine,"pi");restored.close();
  });
  it("restores a project, conversation, messages, run, and model settings after restart", () => {
    const { directory, database } = temporaryDatabase();
    const first = new WorkspaceStore(database);
    const project = first.createProject(join(directory, "research-project"));
    const conversation = first.createConversation(project.id);
    first.appendMessage(conversation.id, "user", "分析这组拉伸实验数据", "complete");
    first.renameConversationFromFirstMessage(conversation.id, "分析这组拉伸实验数据");
    first.addRun(project.id, "拉伸实验数据", "waiting_model");
    first.saveSettings({ mode: "local", modelId: "qwen-local", localEndpoint: "http://127.0.0.1:11434" });
    first.close();

    const restored = new WorkspaceStore(database);
    assert.equal(restored.listProjects()[0]?.path, project.path);
    assert.equal(restored.listConversations()[0]?.title, "分析这组拉伸实验数据");
    assert.equal(restored.listMessages(conversation.id)[0]?.content, "分析这组拉伸实验数据");
    assert.equal(restored.listRuns()[0]?.status, "waiting_model");
    assert.deepEqual(restored.getSettings(), {
      agentEngine: "codex",
      mode: "local",
      modelId: "qwen-local",
      localEndpoint: "http://127.0.0.1:11434",
    });
    restored.close();
  });

  it("reuses an existing project record for the same normalized path", () => {
    const { directory, database } = temporaryDatabase();
    const store = new WorkspaceStore(database);
    const first = store.createProject(join(directory, "project", "..", "project"));
    const second = store.createProject(join(directory, "project"));

    assert.equal(second.id, first.id);
    assert.equal(store.listProjects().length, 1);
    store.close();
  });

  it("marks an unfinished run as interrupted when the store reopens", () => {
    const { directory, database } = temporaryDatabase();
    const first = new WorkspaceStore(database);
    const project = first.createProject(join(directory, "project"));
    first.addRun(project.id, "unfinished analysis", "running");
    first.close();

    const restored = new WorkspaceStore(database);
    assert.equal(restored.listRuns()[0]?.status, "interrupted");
    restored.close();
  });

  it("keeps a stable installation identity across restarts", () => {
    const { database } = temporaryDatabase();
    const first = new WorkspaceStore(database);
    const installationId = first.getInstallationId();
    first.close();

    const restored = new WorkspaceStore(database);
    assert.equal(restored.getInstallationId(), installationId);
    restored.close();
  });

  it("creates a privacy-safe support summary without paths or message content", () => {
    const { directory, database } = temporaryDatabase();
    const store = new WorkspaceStore(database);
    const project = store.createProject(join(directory, "private-project"));
    const conversation = store.createConversation(project.id);
    store.appendMessage(conversation.id, "user", "unpublished alloy formula", "complete");
    store.addRun(project.id, "private run label", "completed");

    assert.deepEqual(store.getSupportSummary(), {
      databaseIntegrity: "ok",
      projectCount: 1,
      conversationCount: 1,
      messageCount: 1,
      runStatusCounts: { completed: 1 },
    });
    assert.doesNotMatch(JSON.stringify(store.getSupportSummary()), /private|unpublished/);
    store.close();
  });
});

it("restores cloud task pointers by account without copying credentials or scientific content",()=>{
 const {database}=temporaryDatabase();const first=new WorkspaceStore(database);
 first.saveCloudTask("account-A","conversation","task-fixture");first.close();
 const restarted=new WorkspaceStore(database);
 assert.equal(restarted.latestCloudTask("account-A","conversation"),"task-fixture");
 assert.equal(restarted.latestCloudTask("account-B","conversation"),null);
 restarted.close();
});
