import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtemp,
  copyFile,
  mkdir,
  writeFile,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkspaceStore } from "../../apps/desktop/main/store.js";
import { hash } from "../../packages/atomistic/src/discovery-io.js";
const dir = await mkdtemp(join(tmpdir(), "mx-ua14-migrate-")),
  db = join(dir, "legacy.sqlite"),
  backup = join(dir, "backup.sqlite");
const projectId = randomUUID(),
  conversationId = randomUUID(),
  messageId = randomUUID(),
  date = "2026-09-01T00:00:00.000Z";
try {
  // Authored M0 core schema, not today's store relabeled as a legacy database.
  const old = new DatabaseSync(db);
  old.exec(`
 CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE conversations(id TEXT PRIMARY KEY,project_id TEXT,title TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE runs(id TEXT PRIMARY KEY,project_id TEXT,label TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE settings(id INTEGER PRIMARY KEY,model_mode TEXT NOT NULL,model_id TEXT NOT NULL,local_endpoint TEXT NOT NULL);
 CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  old
    .prepare("INSERT INTO projects VALUES(?,?,?,?,?)")
    .run(
      projectId,
      "Legacy synthetic project",
      join(dir, "project"),
      date,
      date,
    );
  old
    .prepare("INSERT INTO conversations VALUES(?,?,?,?,?)")
    .run(conversationId, projectId, "Legacy session", date, date);
  old
    .prepare("INSERT INTO messages VALUES(?,?,?,?,?,?)")
    .run(
      messageId,
      conversationId,
      "user",
      "Preserve original synthetic research request",
      "completed",
      date,
    );
  old
    .prepare("INSERT INTO settings VALUES(?,?,?,?)")
    .run(1, "local", "fixture", "http://127.0.0.1:1234/v1");
  old.close();
  await copyFile(db, backup);
  const before = hash(await readFile(backup));
  await mkdir(join(dir, "project"));
  const artifact = join(dir, "project", "m6-result.json");
  await writeFile(artifact, '{"synthetic":true,"energyEv":-1}\n');
  const artifactBefore = hash(await readFile(artifact));
  let migrated = new WorkspaceStore(db);
  assert.equal(
    migrated.getProject(projectId)?.name,
    "Legacy synthetic project",
  );
  assert.equal(migrated.listMessages(conversationId)[0]?.id, messageId);
  migrated.saveCloudTask(
    "m5-synthetic-account",
    conversationId,
    "existing-task-id",
  );
  migrated.close();
  migrated = new WorkspaceStore(db);
  assert.equal(
    migrated.latestCloudTask("m5-synthetic-account", conversationId),
    "existing-task-id",
  );
  assert.equal(migrated.getSupportSummary().databaseIntegrity, "ok");
  migrated.close();
  // Simulate failed-upgrade recovery only on isolated copies. Never touch the user's DB or billing ledger.
  const corrupt = new DatabaseSync(db);
  corrupt.exec("DROP TABLE messages");
  corrupt.close();
  await copyFile(backup, db);
  assert.equal(hash(await readFile(db)), before);
  const restored = new WorkspaceStore(db);
  assert.equal(
    restored.listMessages(conversationId)[0]?.content,
    "Preserve original synthetic research request",
  );
  assert.equal(restored.getSupportSummary().databaseIntegrity, "ok");
  restored.close();
  assert.equal(hash(await readFile(artifact)), artifactBefore);
  assert.equal(hash(await readFile(backup)), before);
  const report = {
    passed: true,
    legacyCore: "authored-M0-schema",
    currentAdditiveMigration: true,
    restart: true,
    rollbackFromClosedBackup: true,
    m6FileHashPreserved: true,
    m5TaskPointerPreserved: true,
    productionBillingLedgerTested: false,
    realInstallerUpdateTested: false,
    actualPlatform: process.platform + "-" + process.arch,
  };
  await mkdir(resolve("runtime/agent/ua-14"), { recursive: true });
  await writeFile(
    resolve("runtime/agent/ua-14/migration.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
} finally {
  await rm(dir, { recursive: true, force: true });
}
