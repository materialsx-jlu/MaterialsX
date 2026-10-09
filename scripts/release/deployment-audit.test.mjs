import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
test('publish and rollback append only digests and preserve prior audit rows',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mx-od6-audit-'));await chmod(dir,0o700);
 const release=join(dir,'release.json'),config=join(dir,'deployment.yaml'),audit=join(dir,'audit.jsonl');
 await writeFile(release,JSON.stringify({schemaVersion:1,channel:'preview',version:'0.3.0-preview.2',assets:[{name:'MaterialsX-0.3.0-preview.2-mac-arm64.dmg',bytes:100,sha256:'a'.repeat(64)}]}));
 await writeFile(config,'supplierSecret: fixture-secret\n');
 const env={...process.env,MATERIALSX_OD6_AUDIT_FILE:audit,MATERIALSX_OD6_CHANNEL:'preview',MATERIALSX_OD6_OPERATOR:'tester',MATERIALSX_OD6_REASON:'fixture change'};
 const script=resolve('scripts/release/deployment-audit.mjs');
 execFileSync(process.execPath,[script,'publish',release,config],{env});execFileSync(process.execPath,[script,'rollback',release,config],{env:{...env,MATERIALSX_OD6_PREVIOUS_VERSION:'0.3.0-preview.1'}});
 const text=await readFile(audit,'utf8');assert.equal(text.trim().split('\n').length,2);assert.ok(!text.includes('fixture-secret'));
 const rows=text.trim().split('\n').map(JSON.parse);assert.deepEqual(rows.map(r=>r.action),['publish','rollback']);assert.equal(rows[1].previousVersion,'0.3.0-preview.1');
});
