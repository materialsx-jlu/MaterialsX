// Financial integration suite runs only in disposable databases. Local accounts
// and payment records are never reset. Credentials are passed through child env.
import {readFileSync,lstatSync} from 'node:fs';
import {spawnSync,spawn} from 'node:child_process';
const path='runtime/m5-local/private-config.json';const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('Private configuration required');
const cfg=JSON.parse(readFileSync(path,'utf8')),pgBin=process.env.MATERIALSX_POSTGRES_BIN||'/opt/homebrew/opt/postgresql@16/bin';
const db=`materialsx_payment_test_${process.pid}`,env={...process.env,PGHOST:'127.0.0.1',PGPORT:'55452',PGUSER:'mx_local_owner',PGPASSWORD:cfg.ownerPassword};
function sql(query){const r=spawnSync(pgBin+'/psql',['-X','-q','-v','ON_ERROR_STOP=1','-d','postgres'],{env,input:query,encoding:'utf8'});if(r.status!==0)throw Error('Disposable test database operation failed (details suppressed)')}
const dsn=new URL(`postgres://mx_local_owner@127.0.0.1:55452/${db}?sslmode=disable`);dsn.password=cfg.ownerPassword;
let created=false;
try{sql(`CREATE DATABASE ${db};`);created=true;const result=await new Promise(resolve=>{const child=spawn('go',['-C','services/control-plane','test','-p','1','-race','./...','-count=1',...(process.argv[2]?['-run',process.argv[2]]:[])],{env:{...process.env,MATERIALSX_IDENTITY_TEST_DATABASE_URL:dsn.href},stdio:'inherit'});child.on('exit',resolve);child.on('error',()=>resolve(1))});process.exitCode=result??1}finally{if(created)sql(`DROP DATABASE ${db} WITH (FORCE);`)}
