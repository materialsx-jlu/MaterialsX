import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('separate credential and SQLite snapshots authenticate before restore drill',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mx-od6-'));await chmod(dir,0o700);
  const key=join(dir,'key'),source=join(dir,'credential.json'),snapshot=join(dir,'credentials.mxbackup');
  await writeFile(key,'a'.repeat(64)+'\n',{mode:0o600});await writeFile(source,'{"fixture":"secret marker"}',{mode:0o600});
  const env={...process.env,MATERIALSX_BACKUP_KEY_FILE:key,MATERIALSX_MODEL_CREDENTIALS_PATH:source};
  const script=resolve('scripts/od6-backup.mjs');
  execFileSync(process.execPath,[script,'backup','model-credentials',snapshot],{env});
  assert.ok(!(await readFile(snapshot)).includes(Buffer.from('secret marker')));
  execFileSync(process.execPath,[script,'restore-drill','model-credentials',snapshot],{env});
  assert.notEqual(spawnSync(process.execPath,[script,'backup','model-credentials',resolve('runtime/do-not-write.mxbackup')],{env,stdio:'ignore'}).status,0);
  const bad=join(dir,'bad-key');await writeFile(bad,'b'.repeat(64)+'\n',{mode:0o600});
  assert.notEqual(spawnSync(process.execPath,[script,'restore-drill','model-credentials',snapshot],{env:{...env,MATERIALSX_BACKUP_KEY_FILE:bad},stdio:'ignore'}).status,0);
  if(spawnSync('sqlite3',['-version'],{stdio:'ignore'}).status===0){
    const db=join(dir,'team.sqlite'),sealed=join(dir,'team.mxbackup');execFileSync('sqlite3',[db,'CREATE TABLE note(value TEXT); INSERT INTO note VALUES("fixture");']);
    const sqliteEnv={...env,MATERIALSX_TEAM_SQLITE_PATH:db};
    execFileSync(process.execPath,[script,'backup','team-sqlite',sealed],{env:sqliteEnv});
    execFileSync(process.execPath,[script,'restore-drill','team-sqlite',sealed],{env:sqliteEnv});
  }
  if(spawnSync('tar',['--version'],{stdio:'ignore'}).status===0){
    const moos=join(dir,'moos-source'),sealed=join(dir,'moos.mxbackup');await mkdir(moos);await writeFile(join(moos,'recipe.json'),'{}');
    const moosEnv={...env,MATERIALSX_MOOS_SOURCE_PATH:moos};
    execFileSync(process.execPath,[script,'backup','moos-source',sealed],{env:moosEnv});
    execFileSync(process.execPath,[script,'restore-drill','moos-source',sealed],{env:moosEnv});
  }
});
