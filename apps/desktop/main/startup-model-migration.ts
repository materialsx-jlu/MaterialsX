import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_MODEL_SETTINGS } from '../../../packages/contracts/src/model-defaults.js';

const policyKey = 'startup_model_policy:cloud-codex-v1';
const backupKey = 'startup_model_backup:cloud-codex-v1';

/** Apply the requested default once; later explicit user choices survive restart. */
export function migrateStartupModel(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT value FROM app_meta WHERE key=?').get(policyKey)) {
      db.exec('COMMIT');
      return;
    }
    const settings = db.prepare('SELECT * FROM settings WHERE id=1').get();
    const options = db.prepare("SELECT key,value FROM app_meta WHERE key IN ('agent_engine','model_options','cloud_max_credits')").all();
    db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?)').run(
      backupKey, JSON.stringify({ settings, options }),
    );
    db.prepare('UPDATE settings SET model_mode=?,model_id=? WHERE id=1').run(
      DEFAULT_MODEL_SETTINGS.mode, DEFAULT_MODEL_SETTINGS.modelId,
    );
    db.prepare("INSERT INTO app_meta(key,value) VALUES('agent_engine',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(DEFAULT_MODEL_SETTINGS.agentEngine);
    db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?)').run(policyKey, 'ap0');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
