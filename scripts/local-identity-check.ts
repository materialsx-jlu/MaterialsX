// Explicit local smoke test. Secrets are read privately, never printed or persisted in reports.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {readFile,lstat,mkdir,writeFile} from 'node:fs/promises';
import {IdentityClient,type CredentialVault} from '../packages/control-plane-client/src/identity.js';
import {workspaceStatusSchema,billingActivitySchema,taskBillsSchema,walletSchema} from '../packages/contracts/src/platform.js';
const origin='http://127.0.0.1:8788',path='runtime/m5-local/private-config.json';
const info=await lstat(path);assert.ok(info.isFile()&&!info.isSymbolicLink());assert.equal(info.mode&0o077,0);
const cfg=JSON.parse(await readFile(path,'utf8'));
let record:{origin:string;refreshToken:string}|null=null;
const vault:CredentialVault={available:()=>true,read:async()=>record,write:async value=>{record=value},clear:async()=>{record=null}};
const client=new IdentityClient(origin,vault,async authorization=>{
 assert.equal(new URL(authorization).origin,origin);
 const page=await fetch(authorization,{redirect:'error'});assert.equal(page.status,200);
 const html=await page.text(),csrf=html.match(/name="csrf" value="([^"]+)"/)?.[1];assert.ok(csrf);
 const result=await fetch(authorization,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:origin,Cookie:page.headers.get('set-cookie')!.split(';')[0]!},
  body:new URLSearchParams({csrf,email:'developer@materialsx.local',password:cfg.userPassword,approve:'yes'})});
 assert.equal(result.status,303);const callback=new URL(result.headers.get('location')!);assert.equal(callback.hostname,'127.0.0.1');assert.equal(callback.pathname,'/auth/callback');
 assert.equal((await fetch(callback,{redirect:'error'})).status,200);
},true);
let adminCookies='';
try{
 assert.equal((await fetch(origin+'/health')).status,200);
 assert.equal((await fetch(origin+'/ops')).status,200);
 assert.equal((await client.login()).user?.email,'developer@materialsx.local');
 const status=workspaceStatusSchema.parse(await (await client.platformRequest('/v1/workspace/status')).json());
 assert.equal(status.formalSalesEnabled,false);
 const activity=billingActivitySchema.parse(await (await client.platformRequest('/v1/billing/activity')).json());assert.ok(Array.isArray(activity.items));
 taskBillsSchema.parse(await (await client.platformRequest('/v1/billing/tasks')).json());
 walletSchema.parse(await (await client.platformRequest('/v1/billing/wallet')).json());
 const pgBin=process.env.MATERIALSX_POSTGRES_BIN||['/opt/homebrew/opt/postgresql@16/bin','/usr/local/opt/postgresql@16/bin','/usr/lib/postgresql/16/bin'].find(p=>existsSync(join(p,'psql')));assert.ok(pgBin);
 const role=spawnSync(join(pgBin,'psql'),['-X','-At','-v','ON_ERROR_STOP=1','-d','materialsx_local_dev'],{encoding:'utf8',env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'55452',PGUSER:'mx_local_runtime',PGPASSWORD:cfg.runtimePassword},input:"SELECT current_user, rolsuper, rolcreatedb, rolcreaterole, has_schema_privilege(current_user,'mx_identity','CREATE') FROM pg_roles WHERE rolname=current_user;"});
 assert.equal(role.status,0);assert.equal(role.stdout.trim(),'mx_local_runtime|f|f|f|f');
 const key=Buffer.from(cfg.adminTOTP.split('').map((c:string)=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('').match(/.{8}/g).map((b:string)=>parseInt(b,2)));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const hash=createHmac('sha1',key).update(counter).digest(),offset=hash.at(-1)!&15;
 const policy=await (await fetch(origin+'/ops/api/auth-config')).json() as {totpRequired:boolean};
 const otp=policy.totpRequired?((hash.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0'):'';
 const admin=await fetch(origin+'/ops/api/login',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email:'admin@materialsx.local',password:cfg.adminPassword,otp})});
 assert.equal(admin.status,200,'Administrator login rejected');
 adminCookies=admin.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 const session=await admin.json() as {csrf:string};
 for(const path of ['/ops/api/session','/ops/api/overview','/ops/api/users','/ops/api/controls','/ops/api/releases']){
  assert.equal((await fetch(origin+path,{headers:{Cookie:adminCookies},redirect:'error'})).status,200);
 }
 assert.equal((await fetch(origin+'/ops/api/logout',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Origin:origin,Cookie:adminCookies,'X-CSRF-Token':session.csrf},body:'{}'})).status,200);adminCookies='';
 await client.logout();assert.equal(record,null);
 const report={environment:'persistent-loopback-development',browserPKCE:true,ordinaryAccount:true,adminMFA:policy.totpRequired,adminPasswordLogin:true,restrictedRuntime:true,workspace:true,billingActivity:true,opsVue:true,liveSales:false,externalGeneration:false,generatedAt:new Date().toISOString()};
 await mkdir('runtime/m5-local',{recursive:true});await writeFile('runtime/m5-local/validation.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}finally{
 if(record)await client.logout().catch(()=>{});
 // No credentials, cookies, codes or CSRF values are written to diagnostics.
}
