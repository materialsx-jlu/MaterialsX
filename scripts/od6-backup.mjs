// Independent encrypted snapshots. No secret, DSN, source path or command output is printed.
import { spawn, spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, stat, lstat, mkdir, writeFile, appendFile, rename, rm, open } from 'node:fs/promises';
import { dirname, resolve, basename, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';

const kinds = new Set(['postgres','litellm-postgres','team-sqlite','model-credentials','moos-source']);
const [command,kind,output]=process.argv.slice(2);
process.umask(0o077);
if (!['backup','restore-drill'].includes(command)||!kinds.has(kind)||!output||!output.startsWith('/')) throw Error('Usage: od6-backup.mjs backup|restore-drill <kind> <absolute encrypted file>');
const target=resolve(output),keyPath=process.env.MATERIALSX_BACKUP_KEY_FILE;
if(!keyPath||!keyPath.startsWith('/'))throw Error('MATERIALSX_BACKUP_KEY_FILE must be an absolute owner-only file');
const repository=resolve(import.meta.dirname,'..');
for(const file of [target,resolve(keyPath)])if(file===repository||file.startsWith(repository+sep))throw Error('BACKUP_AND_KEY_MUST_BE_OUTSIDE_REPOSITORY');
const keyStat=await lstat(keyPath);
if(!keyStat.isFile()||keyStat.isSymbolicLink()||(keyStat.mode&0o077))throw Error('BACKUP_KEY_FILE_NOT_PRIVATE');
const keyHex=(await readFile(keyPath,'utf8')).trim();
if(!/^[a-fA-F0-9]{64}$/.test(keyHex))throw Error('BACKUP_KEY_MUST_BE_32_BYTES_HEX');
const key=Buffer.from(keyHex,'hex');
function pgEnv(dsn){
  let url;try{url=new URL(dsn)}catch{throw Error('INVALID_DATABASE_URL')}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.pathname.slice(1))throw Error('INVALID_DATABASE_URL');
  return { ...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGSSLMODE:url.searchParams.get('sslmode')||'verify-full' };
}
function pgURL(){const name=kind==='postgres'?'MATERIALSX_DATABASE_URL':'MATERIALSX_LITELLM_DATABASE_URL';if(!process.env[name])throw Error(`${name}_REQUIRED`);return process.env[name]}
function isolatedRestoreTarget(){
  const raw=process.env.MATERIALSX_OD6_RESTORE_DATABASE_URL;if(!raw)return null;
  let target,source;try{target=new URL(raw);source=new URL(pgURL())}catch{throw Error('INVALID_RESTORE_DATABASE_URL')}
  if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||!/^\/[a-z][a-z0-9_]*_restore_test$/.test(target.pathname)||
    (target.hostname===source.hostname&&(target.port||'5432')===(source.port||'5432')&&target.pathname===source.pathname))throw Error('ISOLATED_RESTORE_TARGET_REQUIRED');
  return {name:target.pathname.slice(1),env:pgEnv(raw)};
}
async function privateDir(file){await mkdir(dirname(file),{recursive:true,mode:0o700});if((await lstat(dirname(file))).mode&0o077)throw Error('BACKUP_DIRECTORY_NOT_PRIVATE')}
function childStream(name,args,env){const process=spawn(name,args,{env,stdio:['ignore','pipe','ignore']});const done=new Promise((ok,reject)=>{process.on('error',reject);process.on('close',ok)});return {process,done}}
function sourcePath(envName){const value=process.env[envName];if(!value||!value.startsWith('/'))throw Error(`${envName}_ABSOLUTE_PATH_REQUIRED`);return resolve(value)}
async function backup(){
  await privateDir(target);try{await lstat(target);throw Error('BACKUP_ALREADY_EXISTS')}catch(e){if(e.code!=='ENOENT')throw e}
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),part=`${target}.partial-${process.pid}`;
  let source,child,tmp;
  try{
    if(kind==='postgres'||kind==='litellm-postgres'){
      child=childStream(process.env.MATERIALSX_PG_DUMP||'pg_dump',['--format=custom','--no-owner','--no-privileges'],pgEnv(pgURL()));source=child.process.stdout;
    }else if(kind==='team-sqlite'){
      const input=sourcePath('MATERIALSX_TEAM_SQLITE_PATH');if(!(await lstat(input)).isFile())throw Error('INVALID_SQLITE_SOURCE');
      tmp=join(tmpdir(),`mx-sqlite-snapshot-${process.pid}-${randomBytes(6).toString('hex')}`);
      const p=spawnSync('sqlite3',[input,`.backup ${tmp}`],{stdio:'ignore'});if(p.status!==0)throw Error('SQLITE_BACKUP_FAILED');source=createReadStream(tmp);
    }else if(kind==='model-credentials'){
      const input=sourcePath('MATERIALSX_MODEL_CREDENTIALS_PATH');const st=await lstat(input);if(!st.isFile()||st.isSymbolicLink())throw Error('INVALID_CREDENTIAL_SOURCE');source=createReadStream(input);
    }else{
      const input=sourcePath('MATERIALSX_MOOS_SOURCE_PATH');const st=await lstat(input);if(!st.isDirectory()||st.isSymbolicLink())throw Error('INVALID_MOOS_SOURCE');
      child=childStream('tar',['-C',dirname(input),'-cf','-',basename(input)],process.env);source=child.process.stdout;
    }
    const header=JSON.stringify({magic:'MaterialsX-OD6',version:1,kind,iv:iv.toString('hex')})+'\n';
    cipher.setAAD(Buffer.from(header));
    await writeFile(part,header,{mode:0o600,flag:'wx'});
    await pipeline(source,cipher,createWriteStream(part,{flags:'a',mode:0o600}));if(child && await child.done!==0)throw Error('SOURCE_COMMAND_FAILED');
    await appendFile(part,cipher.getAuthTag());await rename(part,target);
  }catch(e){child?.process.kill();await rm(part,{force:true});throw e}
  finally{if(tmp)await rm(tmp,{force:true})}
  console.log(`Encrypted ${kind} snapshot completed.`);
}
async function restoreDrill(){
  const st=await lstat(target);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077))throw Error('BACKUP_FILE_NOT_PRIVATE');
  const handle=await open(target,'r');const head=Buffer.alloc(256);const {bytesRead}=await handle.read(head,0,256,0);const tag=Buffer.alloc(16);await handle.read(tag,0,16,st.size-16);await handle.close();
  const end=head.subarray(0,bytesRead).indexOf(10);if(end<0||end>180||st.size<end+18)throw Error('INVALID_BACKUP_HEADER');
  const meta=JSON.parse(head.subarray(0,end).toString());if(meta.magic!=='MaterialsX-OD6'||meta.version!==1||meta.kind!==kind||!(/^[a-f0-9]{24}$/.test(meta.iv)))throw Error('BACKUP_KIND_OR_HEADER_MISMATCH');
  const temp=join(tmpdir(),`mx-restore-${process.pid}-${randomBytes(6).toString('hex')}`);
  try{
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(meta.iv,'hex'));decipher.setAAD(head.subarray(0,end+1));decipher.setAuthTag(tag);
    await pipeline(createReadStream(target,{start:end+1,end:st.size-17}),decipher,createWriteStream(temp,{flags:'wx',mode:0o600}));
    let args,tool,env=process.env;
    if(kind==='postgres'||kind==='litellm-postgres'){tool=process.env.MATERIALSX_PG_RESTORE||'pg_restore';args=['--list',temp]}
    else if(kind==='team-sqlite'){tool='sqlite3';args=[temp,'PRAGMA quick_check;']}
    else if(kind==='moos-source'){tool='tar';args=['-tf',temp]}
    else {if((await stat(temp)).size===0)throw Error('EMPTY_CREDENTIAL_SNAPSHOT')}
    if(tool){const result=spawnSync(tool,args,{env,encoding:'utf8',maxBuffer:1024*1024});if(result.status!==0||(kind==='team-sqlite'&&result.stdout.trim()!=='ok'))throw Error('RESTORE_VALIDATION_FAILED')}
    if(kind==='postgres'||kind==='litellm-postgres'){
      const isolated=isolatedRestoreTarget();
      if(isolated){
        const query=(sql)=>spawnSync('psql',['-X','-At','-v','ON_ERROR_STOP=1','-c',sql],{env:isolated.env,encoding:'utf8',maxBuffer:1024*1024});
        const before=query("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')");
        if(before.status!==0||before.stdout.trim()!=='0')throw Error('RESTORE_TARGET_NOT_EMPTY');
        const restored=spawnSync(tool,['--exit-on-error','--no-owner','--no-privileges',`--dbname=${isolated.name}`,temp],{env:isolated.env,stdio:'ignore'});
        if(restored.status!==0)throw Error('ISOLATED_RESTORE_FAILED');
        const after=query("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')");
        if(after.status!==0||Number(after.stdout.trim())<1)throw Error('ISOLATED_RESTORE_EMPTY');
        console.log(`Isolated ${kind} database restore verified; original source untouched.`);
      }
    }
    console.log(`Encrypted ${kind} restore drill passed; no production source changed.`);
  }finally{await rm(temp,{force:true})}
}
if(command==='backup')await backup();else await restoreDrill();
