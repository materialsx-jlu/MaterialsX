import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.#db = new DatabaseSync(databasePath);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
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
      INSERT OR IGNORE INTO settings(id, model_mode, model_id, local_endpoint)
      VALUES (1, 'platform', 'materials-research', 'http://127.0.0.1:11434');
      UPDATE runs SET status = 'interrupted' WHERE status = 'running';
    `);
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
      this.#db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(conversationId) as Row[]
    ).map(message);
  }

  appendMessage(
    conversationId: string,
    role: MessageRecord["role"],
    content: string,
    status: MessageRecord["status"],
  ): MessageRecord {
    const record: MessageRecord = {
      id: randomUUID(),
      conversationId,
      role,
      content,
      status,
      createdAt: now(),
    };
    this.#db
      .prepare("INSERT INTO messages(id, conversation_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(record.id, record.conversationId, record.role, record.content, record.status, record.createdAt);
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
    return {
      mode: row.model_mode as ModelSettings["mode"],
      modelId: String(row.model_id),
      localEndpoint: String(row.local_endpoint),
    };
  }

  saveSettings(settings: ModelSettings): ModelSettings {
    this.#db
      .prepare("UPDATE settings SET model_mode = ?, model_id = ?, local_endpoint = ? WHERE id = 1")
      .run(settings.mode, settings.modelId, settings.localEndpoint);
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
