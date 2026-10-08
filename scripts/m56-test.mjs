// Local-only engineering acceptance. No provider calls, payments or mail are sent.
import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),dir=join(root,'runtime/m5-local'),cfg=JSON.parse(readFileSync(join(dir,'private-config.json'),'utf8'));
const pgBin=['/opt/homebrew/opt/postgresql@16/bin','/usr/local/opt/postgresql@16/bin'].find(v=>existsSync(join(v,'psql')));if(!pgBin)throw Error('PostgreSQL 16 required');
const database='materialsx_m56_acceptance_test',u=new URL(`postgres://mx_local_owner@127.0.0.1:55452/${database}?sslmode=disable`);u.password=cfg.ownerPassword;
const env={...process.env,PGPASSWORD:cfg.ownerPassword,MATERIALSX_IDENTITY_TEST_DATABASE_URL:u.href};
const sql=(input)=>spawnSync(join(pgBin,'psql'),['-h','127.0.0.1','-p','55452','-U','mx_local_owner','-d','postgres','-X','-v','ON_ERROR_STOP=1','-At'],{env,input,encoding:'utf8'});
const exists=sql(`SELECT count(*) FROM pg_database WHERE datname='${database}';`);if(exists.status!==0)throw Error('Local database unavailable; output suppressed');
if(exists.stdout.trim()==='0'&&sql(`CREATE DATABASE ${database};`).status!==0)throw Error('Cannot create isolated acceptance database');
const args=['-C','services/control-plane','test','./...',...(process.argv.includes('--race')?['-race']:[])];const started=new Date();
const result=spawnSync('go',args,{cwd:root,env,encoding:'utf8',maxBuffer:8*1024*1024});
// Test fixtures are synthetic. Still never emit an embedded connection string.
const safe=(result.stdout+'\n'+result.stderr).replaceAll(u.href,'[private test DSN]');process.stdout.write(safe);
const reportDir=join(root,'runtime/m5-local/m56');mkdirSync(reportDir,{recursive:true,mode:0o700});writeFileSync(join(reportDir,'engineering-acceptance.json'),JSON.stringify({version:'m5.6-engineering-v1',startedAt:started.toISOString(),finishedAt:new Date().toISOString(),passed:result.status===0,isolatedPostgres:true,race:process.argv.includes('--race'),providerCalls:0,realPayments:0,realEmails:0,externalGates:'pending'},null,2)+'\n',{mode:0o600});
if(result.status!==0)process.exitCode=1;
