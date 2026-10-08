import {teamLink,type TeamLink} from "../../../packages/contracts/src/team-research.js";
import { migrateStartupModel } from './startup-model-migration.js';
import { DEFAULT_MODEL_SETTINGS } from '../../../packages/contracts/src/model-defaults.js';
import {AgentWorkspaceStore} from './agent-workspace-store.js';
import {SqlitePaperStore} from "./paper-store.js";
import { ResearchStore } from "./research-store.js";
import { AgentJournal } from "./agent-journal.js";
import {researchGoalPlanSchema,type ResearchGoalPlan} from '../../../packages/contracts/src/research-goal.js';
import { randomUUID } from "node:crypto";
import { compatibilityProfileSchema, engineSessionRefSchema, type CompatibilityProfile, type EngineSessionRef } from "../../../packages/contracts/src/engine-selection.js";
import { mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {mcpConfigurationSchema,type McpConfiguration} from "../../../packages/contracts/src/agent-configuration.js";
import type {
  ConversationRecord,
  MessageRecord,
  ModelSettings,
  ProjectRecord,
  RunRecord,
} from "../../../packages/contracts/src/desktop.js";

type Row = Record<string, string | number | null>;

function now(): string {
  return new Date().toISOString();
}

function project(row: Row): ProjectRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function conversation(row: Row): ConversationRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function message(row: Row): MessageRecord {
  return {
    ...(row.task_id ? { taskId: String(row.task_id) } : {}),
    id: String(row.id),
    conversationId: String(row.conversation_id),
    role: row.role as MessageRecord["role"],
    content: String(row.content),
    status: row.status as MessageRecord["status"],
    createdAt: String(row.created_at),
  };
}

function run(row: Row): RunRecord {
  return {
    id: String(row.id),
    projectId: row.project_id === null ? null : String(row.project_id),
    label: String(row.label),
    status: row.status as RunRecord["status"],
    createdAt: String(row.created_at),
  };
}

export class WorkspaceStore {
  readonly #db: DatabaseSync;
  readonly agentJournal: AgentJournal;
  readonly agentWorkspace: AgentWorkspaceStore;
  readonly research: ResearchStore;
  readonly papers: SqlitePaperStore;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.#db = new DatabaseSync(databasePath);
    this.agentJournal = new AgentJournal(this.#db);
    this.agentWorkspace = new AgentWorkspaceStore(this.#db);
    this.research = new ResearchStore(this.#db);
    this.papers = new SqlitePaperStore(this.#db);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS cloud_tasks (
        task_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, conversation_id TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cloud_conversation_tasks ON cloud_tasks(account_id,conversation_id,created_at);

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        label TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        model_mode TEXT NOT NULL,
        model_id TEXT NOT NULL,
        local_endpoint TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      UPDATE runs SET status = 'interrupted' WHERE status = 'running';
    `);
    this.#db.prepare('INSERT OR IGNORE INTO settings(id,model_mode,model_id,local_endpoint) VALUES(1,?,?,?)')
      .run(DEFAULT_MODEL_SETTINGS.mode, DEFAULT_MODEL_SETTINGS.modelId, DEFAULT_MODEL_SETTINGS.localEndpoint);
    migrateStartupModel(this.#db);
    this.agentJournal.interrupted();
  }

  close(): void {
    this.#db.close();
  }

  listProjects(): ProjectRecord[] {
    return (this.#db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as Row[]).map(project);
  }

  getProject(projectId: string): ProjectRecord | null {
    const row = this.#db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Row | undefined;
    return row ? project(row) : null;
  }

  saveResearchPlan(plan:ResearchGoalPlan):void {
    const parsed=researchGoalPlanSchema.parse(plan);
    const run=this.#db.prepare("SELECT project_id FROM runs WHERE id=?").get(parsed.task.taskId);
    const conversation=this.#db.prepare("SELECT project_id FROM conversations WHERE id=?").get(parsed.task.conversationId);
    if(run?.project_id!==parsed.task.projectId||conversation?.project_id!==parsed.task.projectId)throw Error('研究计划与项目、对话或任务记录不匹配');
    const previous=this.researchPlan(parsed.task.taskId);
        if(previous&&(previous.goalId!==parsed.goalId||parsed.planRevision!==previous.planRevision+1))throw Error('研究计划版本冲突');
    const owner=!this.#db.isTransaction;if(owner)this.#db.exec("BEGIN IMMEDIATE");
    try{if(previous)this.research.history(previous);
    this.#db.prepare("INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`research_plan:${parsed.task.taskId}`,JSON.stringify(parsed));
    this.research.history(parsed);if(owner)this.#db.exec("COMMIT");
    }catch(e){if(owner)this.#db.exec("ROLLBACK");throw e;}
  }
  researchPlan(taskId:string):ResearchGoalPlan|null {const row=this.#db.prepare("SELECT value FROM app_meta WHERE key=?").get(`research_plan:${taskId}`);return row?researchGoalPlanSchema.parse(JSON.parse(String(row.value))):null}
  saveAgentReceipt(taskId:string,receipt:any):void {
    const key=`agent_receipt:${taskId}:${receipt.id}`,text=JSON.stringify(receipt);
    const old=this.#db.prepare("SELECT value FROM app_meta WHERE key=?").get(key);
    if(old&&old.value!==text)throw Error("NATIVE_RECEIPT_CONFLICT");
    this.#db.prepare("INSERT OR IGNORE INTO app_meta(key,value) VALUES(?,?)").run(key,text);
  }
  agentThread(key:string):string|null {const row=this.#db.prepare("SELECT value FROM app_meta WHERE key=?").get(`agent_thread:${key}`);return row?String(row.value):null}
  saveAgentThread(key:string,id:string):void {this.#db.prepare("INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`agent_thread:${key}`,id)}
  saveEngineSession(value: EngineSessionRef): void {
    const record = engineSessionRefSchema.parse(value);
    const run = this.listRuns().find((r) => r.id === record.task.taskId);
    const conversation = this.listConversations().find((c) => c.id === record.task.conversationId);
    if (run?.projectId !== record.task.projectId || conversation?.projectId !== record.task.projectId) throw Error("ENGINE_SESSION_SCOPE_MISMATCH");
    const previous = this.engineSession(record.task.taskId);
    if (previous && (JSON.stringify({ ...previous, nativeSessionId: null }) !== JSON.stringify({ ...record, nativeSessionId: null }) ||
        (previous.nativeSessionId !== null && previous.nativeSessionId !== record.nativeSessionId)))
      throw Error("ENGINE_SESSION_IMMUTABLE");
    this.#db.prepare("INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`engine_session:${record.task.taskId}`, JSON.stringify(record));
  }
  engineSession(taskId: string): EngineSessionRef | null {
    const row = this.#db.prepare("SELECT value FROM app_meta WHERE key=?").get(`engine_session:${taskId}`);
    return row ? engineSessionRefSchema.parse(JSON.parse(String(row.value))) : null;
  }
  compatibilities():CompatibilityProfile[]{return this.#db.prepare("SELECT value FROM app_meta WHERE key LIKE 'compat-%'").all().map(r=>compatibilityProfileSchema.parse(JSON.parse(String(r.value))));}
  teamLink(id:string):TeamLink{if(!this.getProject(id))throw Error('TEAM_LOCAL_PROJECT_NOT_FOUND');const r=this.#db.prepare('SELECT value FROM app_meta WHERE key=?').get('team_link:'+id);return r?teamLink.parse(JSON.parse(String(r.value))):{enabled:false,remoteProjectId:null,revision:1};}
  saveTeamLink(id:string,value:TeamLink,expected:number){const v=teamLink.parse(value);if(this.teamLink(id).revision!==expected||v.revision!==expected+1)throw Error('TEAM_LINK_CONFLICT');this.#db.prepare('INSERT INTO app_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('team_link:'+id,JSON.stringify(v));return v;}
  mcpConfiguration():McpConfiguration{const row=this.#db.prepare("SELECT value FROM app_meta WHERE key='mcp_configuration'").get();return row?mcpConfigurationSchema.parse(JSON.parse(String(row.value))):{id:'moos-local',enabled:true,directory:null,origin:'http://127.0.0.1:8080',revision:1};}
  saveMcpConfiguration(value:McpConfiguration,expected:number){const v=mcpConfigurationSchema.parse(value);if(this.mcpConfiguration().revision!==expected||v.revision!==expected+1)throw Error('MCP_REVISION_CONFLICT');this.#db.prepare("INSERT INTO app_meta(key,value) VALUES('mcp_configuration',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(v));return v;}
  saveCompatibility(value: CompatibilityProfile): void {
    const profile = compatibilityProfileSchema.parse(value);
    this.#db.prepare("INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(profile.id, JSON.stringify(profile));
  }
  compatibility(id: string): CompatibilityProfile | null {
    const row = this.#db.prepare("SELECT value FROM app_meta WHERE key=?").get(id);
    return row ? compatibilityProfileSchema.parse(JSON.parse(String(row.value))) : null;
  }

  saveCloudTask(accountId:string,conversationId:string,taskId:string):void {
    this.#db.prepare("INSERT OR IGNORE INTO cloud_tasks(task_id,account_id,conversation_id,created_at) VALUES(?,?,?,?)").run(taskId,accountId,conversationId,new Date().toISOString());
  }
  latestCloudTask(accountId:string,conversationId:string):string|null {
    const row=this.#db.prepare("SELECT task_id FROM cloud_tasks WHERE account_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT 1").get(accountId,conversationId);
    return row ? String(row.task_id) : null;
  }
  cloudTaskIds(accountId:string,conversationId:string):string[] {
    return this.#db.prepare("SELECT task_id FROM cloud_tasks WHERE account_id=? AND conversation_id=? ORDER BY created_at DESC,task_id")
      .all(accountId,conversationId).map(row=>String(row.task_id));
  }
  createProject(path: string): ProjectRecord {
    const normalized = resolve(path);
    const existing = this.#db.prepare("SELECT * FROM projects WHERE path = ?").get(normalized) as Row | undefined;
    if (existing) return project(existing);
    const record: ProjectRecord = {
      id: randomUUID(),
      name: basename(normalized) || "MaterialsX Project",
      path: normalized,
      createdAt: now(),
      updatedAt: now(),
    };
    this.#db
      .prepare("INSERT INTO projects(id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(record.id, record.name, record.path, record.createdAt, record.updatedAt);
    return record;
  }

  listConversations(): ConversationRecord[] {
    return (this.#db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC").all() as Row[]).map(conversation);
  }

  createConversation(projectId: string): ConversationRecord {
    const timestamp = now();
    const record: ConversationRecord = {
      id: randomUUID(),
      projectId,
      title: "新研究任务",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.#db
      .prepare("INSERT INTO conversations(id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(record.id, projectId, record.title, record.createdAt, record.updatedAt);
    return record;
  }

  listMessages(conversationId: string): MessageRecord[] {
    return (
      this.#db.prepare("SELECT m.*, a.value AS task_id FROM messages m LEFT JOIN app_meta a ON a.key = 'message_task:' || m.id WHERE m.conversation_id = ? ORDER BY m.created_at ASC").all(conversationId) as Row[]
    ).map(message);
  }

  appendMessage(
    conversationId: string,
    role: MessageRecord["role"],
    content: string,
    status: MessageRecord["status"],
    taskId?: string,
  ): MessageRecord {
    const session = taskId ? this.engineSession(taskId) : null;
    if (session && (role !== "assistant" || session.task.conversationId !== conversationId)) throw Error("MESSAGE_ENGINE_SCOPE_MISMATCH");
    const record: MessageRecord = {
      id: randomUUID(),
      conversationId,
      role,
      content,
      status,
      ...(session ? { taskId: session.task.taskId } : {}),
      createdAt: now(),
    };
    this.#db
      .prepare("INSERT INTO messages(id, conversation_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(record.id, record.conversationId, record.role, record.content, record.status, record.createdAt);
    if (record.taskId) this.#db.prepare("INSERT INTO app_meta(key,value) VALUES(?,?)").run(`message_task:${record.id}`, record.taskId);
    this.#db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(record.createdAt, conversationId);
    return record;
  }

  renameConversationFromFirstMessage(conversationId: string, content: string): void {
    const title = content.trim().replace(/\s+/g, " ").slice(0, 34) || "新研究任务";
    const current = this.#db.prepare("SELECT title FROM conversations WHERE id = ?").get(conversationId) as Row | undefined;
    if (current?.title === "新研究任务") {
      this.#db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?").run(title, now(), conversationId);
    }
  }

  addRun(projectId: string, label: string, status: RunRecord["status"]): RunRecord {
    const record: RunRecord = { id: randomUUID(), projectId, label, status, createdAt: now() };
    this.#db
      .prepare("INSERT INTO runs(id, project_id, label, status, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(record.id, record.projectId, record.label, record.status, record.createdAt);
    return record;
  }

  updateRun(runId: string, status: RunRecord["status"]): void {
    this.#db.prepare("UPDATE runs SET status = ? WHERE id = ?").run(status, runId);
  }

  listRuns(): RunRecord[] {
    return (this.#db.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT 50").all() as Row[]).map(run);
  }

  getSupportSummary(): {
    databaseIntegrity: string;
    projectCount: number;
    conversationCount: number;
    messageCount: number;
    runStatusCounts: Record<string, number>;
  } {
    const scalar = (query: string): number => {
      const row = this.#db.prepare(query).get() as Row;
      return Number(row.count ?? 0);
    };
    const runRows = this.#db.prepare("SELECT status, COUNT(*) AS count FROM runs GROUP BY status").all() as Row[];
    const quickCheck = this.#db.prepare("PRAGMA quick_check").get() as Row | undefined;
    return {
      databaseIntegrity: String(quickCheck?.quick_check ?? "unknown"),
      projectCount: scalar("SELECT COUNT(*) AS count FROM projects"),
      conversationCount: scalar("SELECT COUNT(*) AS count FROM conversations"),
      messageCount: scalar("SELECT COUNT(*) AS count FROM messages"),
      runStatusCounts: Object.fromEntries(runRows.map((row) => [String(row.status), Number(row.count)])),
    };
  }

  getSettings(): ModelSettings {
    const row = this.#db.prepare("SELECT * FROM settings WHERE id = 1").get() as Row;
    const saved = this.#db.prepare("SELECT value FROM app_meta WHERE key='model_options'").get();
    const options = saved ? JSON.parse(String(saved.value)) as ModelSettings : {} as ModelSettings;
    return {
      ...(this.#db.prepare("SELECT value FROM app_meta WHERE key='agent_engine'").get()?{agentEngine:this.#db.prepare("SELECT value FROM app_meta WHERE key='agent_engine'").get()!.value==='codex'?'codex' as const:'pi' as const}:{agentEngine:DEFAULT_MODEL_SETTINGS.agentEngine}),
      ...(options.localProtocol?{localProtocol:options.localProtocol}:{}),
      ...(options.localContextBudget?{localContextBudget:options.localContextBudget}:{}),
      ...(options.cloudWorkspaceTools!==undefined?{cloudWorkspaceTools:options.cloudWorkspaceTools}:{}),
      mode: row.model_mode as ModelSettings["mode"],
      modelId: String(row.model_id),
      localEndpoint: String(row.local_endpoint),
    };
  }

  saveSettings(settings: ModelSettings): ModelSettings {
    this.#db
      .prepare("UPDATE settings SET model_mode = ?, model_id = ?, local_endpoint = ? WHERE id = 1")
      .run(settings.mode, settings.modelId, settings.localEndpoint);
    if(settings.agentEngine)this.#db.prepare("INSERT INTO app_meta(key,value) VALUES('agent_engine',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(settings.agentEngine);
    const options={localProtocol:settings.localProtocol,localContextBudget:settings.localContextBudget,cloudWorkspaceTools:settings.cloudWorkspaceTools};
    this.#db.prepare("INSERT INTO app_meta(key,value) VALUES('model_options',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(options));
    return this.getSettings();
  }

  getInstallationId(): string {
    const existing = this.#db.prepare("SELECT value FROM app_meta WHERE key = 'installation_id'").get() as Row | undefined;
    if (existing) return String(existing.value);
    const id = randomUUID();
    this.#db.prepare("INSERT INTO app_meta(key, value) VALUES ('installation_id', ?)").run(id);
    return id;
  }
}

export function loadJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}
