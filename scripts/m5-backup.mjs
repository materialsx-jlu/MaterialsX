// Owner-only backup / isolated restore drill. Never accepts the source as a restore destination.
import {spawnSync} from 'node:child_process';
import {mkdirSync,chmodSync,lstatSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
const args=process.argv.slice(2),command=args.shift(),output=args.shift();if(!['backup','restore-drill'].includes(command)||!output)throw Error('Use backup <absolute.dump> or restore-drill <absolute.dump> <local _restore_test DSN supplied through MATERIALSX_RESTORE_DATABASE_URL>');
const root=resolve(import.meta.dirname,'..'),file=resolve(output);if(file!==output)throw Error('Absolute backup path required');
const source=process.env.MATERIALSX_DATABASE_URL;if(!source)throw Error('Owner MATERIALSX_DATABASE_URL required');
const pgBin=process.env.MATERIALSX_POSTGRES_BIN||['/opt/homebrew/opt/postgresql@16/bin','/usr/lib/postgresql/16/bin'].find(p=>existsSync(join(p,'pg_dump')));if(!pgBin)throw Error('PostgreSQL 16 tools required');
function connection(dsn){const u=new URL(dsn);if(!['postgres:','postgresql:'].includes(u.protocol))throw Error('Invalid database URL');return {...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:u.pathname.slice(1),PGSSLMODE:u.searchParams.get('sslmode')||'verify-full'}}
function run(name,argv,env,input){const r=spawnSync(name,argv,{cwd:root,env,input,encoding:'utf8',maxBuffer:1024*1024});if(r.status!==0)throw Error('Backup/restore operation failed; private command output suppressed');return r.stdout.trim()}
if(command==='backup'){
 if(existsSync(file))throw Error('Refusing to replace an existing backup');mkdirSync(dirname(file),{recursive:true,mode:0o700});if(lstatSync(dirname(file)).mode&0o077)throw Error('Private backup directory required');
 run(join(pgBin,'pg_dump'),['--format=custom','--no-owner','--no-privileges','--file='+file],connection(source));chmodSync(file,0o600);console.log('Private PostgreSQL snapshot saved. Treat it as containing user data and encrypted credentials.');
}else{
 const target=process.env.MATERIALSX_RESTORE_DATABASE_URL;if(!target||target===source)throw Error('Distinct isolated restore target required');const u=new URL(target),src=new URL(source);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||!/^\/[a-z][a-z0-9_]*_restore_test$/.test(u.pathname)||(u.hostname===src.hostname&&u.port===src.port&&u.pathname===src.pathname))throw Error('Restore is restricted to a distinct local *_restore_test database');
 if(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()||(lstatSync(file).mode&0o077))throw Error('Private regular backup file required');const env=connection(target);
 const count=run(join(pgBin,'psql'),['-X','-At','-v','ON_ERROR_STOP=1'],env,"SELECT count(*) FROM pg_tables WHERE schemaname='mx_identity';");if(count!=='0')throw Error('Restore target must be empty');
 run(join(pgBin,'pg_restore'),['--exit-on-error','--no-owner','--no-privileges','--dbname='+u.pathname.slice(1),file],env);
 const cfg={...process.env,MATERIALSX_ENV:'development',MATERIALSX_DATABASE_URL:target,MATERIALSX_IDENTITY_PUBLIC_URL:'http://127.0.0.1:8788',MATERIALSX_IDENTITY_ADDR:'127.0.0.1:8788'};
 run('go',['-C','services/control-plane','run','./cmd/identityctl','--command=migrate'],cfg);
 run('go',['-C','services/control-plane','run','./cmd/identityctl','--command=invalidate-sessions'],cfg);
 run('go',['-C','services/control-plane','run','./cmd/identityctl','--command=verify-ledger'],cfg);
 console.log('Isolated restore checked; restored sessions invalidated; original source untouched. No service or Worker was started against the clone.');
}
