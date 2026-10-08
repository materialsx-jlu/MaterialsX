import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from './store.js';
import { migrateStartupModel } from './startup-model-migration.js';
import { DEFAULT_MODEL_SETTINGS } from '../../../packages/contracts/src/model-defaults.js';

test('fresh startup selects the managed cloud route and Codex', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mx-startup-'));
  const store = new WorkspaceStore(join(directory, 'workspace.sqlite'));
  try { assert.deepEqual(store.getSettings(), DEFAULT_MODEL_SETTINGS); }
  finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('legacy local settings migrate once with a backup; later explicit choices survive', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mx-startup-'));
  const file = join(directory, 'workspace.sqlite');
  let store = new WorkspaceStore(file);
  const previous = {
    mode: 'local' as const, modelId: 'openai/gpt-oss-20b',
    localEndpoint: 'http://localhost:1234/v1', agentEngine: 'pi' as const,
    localProtocol: 'chat-completions' as const, localContextBudget: 32768,
    cloudWorkspaceTools: false,
  };
  try {
    store.saveSettings(previous); store.close();
    const fixture = new DatabaseSync(file);
    fixture.exec("DELETE FROM app_meta WHERE key IN ('startup_model_policy:cloud-codex-v1','startup_model_backup:cloud-codex-v1')");
    fixture.close();
    store = new WorkspaceStore(file);
    assert.deepEqual(store.getSettings(), {
      ...previous, mode: 'platform', modelId: 'materials-research', agentEngine: 'codex',
    });
    const inspect = new DatabaseSync(file);
    const backup = String(inspect.prepare("SELECT value FROM app_meta WHERE key='startup_model_backup:cloud-codex-v1'").get()!.value);
    const saved = JSON.parse(backup);
    assert.equal(saved.settings.model_id, previous.modelId);
    assert.equal(saved.settings.local_endpoint, previous.localEndpoint);
    assert.equal(saved.options.find((o: any) => o.key === 'agent_engine').value, 'pi');
    inspect.close();
    store.saveSettings(previous); store.close(); store = new WorkspaceStore(file);
    assert.deepEqual(store.getSettings(), previous);
    const reopened = new DatabaseSync(file);
    assert.equal(reopened.prepare("SELECT value FROM app_meta WHERE key='startup_model_backup:cloud-codex-v1'").get()!.value, backup);
    reopened.close();
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a migration write failure rolls back selection, backup and policy together', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE settings(id INTEGER PRIMARY KEY,model_mode TEXT,model_id TEXT,local_endpoint TEXT);
      CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT);
      INSERT INTO settings VALUES(1,'local','original','http://localhost:1234/v1');
      CREATE TRIGGER fail_engine BEFORE INSERT ON app_meta WHEN NEW.key='agent_engine'
      BEGIN SELECT RAISE(ABORT,'fixture-write-failure'); END;`);
    assert.throws(() => migrateStartupModel(db), /fixture-write-failure/);
    assert.equal(db.prepare('SELECT model_mode FROM settings').get()!.model_mode, 'local');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM app_meta').get()!.n, 0);
  } finally { db.close(); }
});
