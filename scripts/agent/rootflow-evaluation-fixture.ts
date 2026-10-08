// Explicit live evaluation only. Private credentials stay in memory; only a newly owned test DB is mutated.
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFile,lstat,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {IdentityClient,type CredentialVault} from '../../packages/control-plane-client/src/identity.js';
import {PiPlatformSessionService} from '../../packages/pi-adapter/src/platform-session.js';
import {hash,canonical} from '../../packages/atomistic/src/discovery-io.js';
import { observeRootflowWire } from './rootflow-wire-observer.js';

export async function isolatedRootflowEvaluation(onWire?: (event:unknown)=>void,requestAllowance=160,grantDurationMs=3600000) {
  if(!Number.isInteger(requestAllowance)||requestAllowance<1||requestAllowance>10000)throw Error('Invalid isolated evaluation allowance');
  if(!Number.isInteger(grantDurationMs)||grantDurationMs<60000||grantDurationMs>86400000)throw Error('Invalid isolated grant lifetime');
  const config=JSON.parse(await readFile(resolve('runtime/m5-local/private-config.json'),'utf8'));
  const path=resolve('runtime/m5-local/paid-cloud.json'),stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw Error('Private supplier profile required');
  const supplier=JSON.parse(await readFile(path,'utf8'));
  if(supplier.model!=='gpt-5.6-sol'||typeof supplier.apiKey!=='string')throw Error('Expected reviewed gpt-5.6-sol supplier profile');
  const database='materialsx_rootflow_eval_'+randomBytes(6).toString('hex')+'_test';
  const dsn=new URL('postgres://mx_local_owner@127.0.0.1:55452/'+database+'?sslmode=disable');dsn.password=config.ownerPassword;
  const listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));
  const port=(listener.address() as {port:number}).port;await new Promise<void>(r=>listener.close(()=>r()));
  const origin='http://127.0.0.1:'+port,temp=await mkdtemp(join(tmpdir(),'mx-rootflow-eval-'));
  const env:NodeJS.ProcessEnv={...process.env,PGPASSWORD:config.ownerPassword,MATERIALSX_ENV:'development',MATERIALSX_DEV_MODE:'0',
    MATERIALSX_DATABASE_URL:dsn.href,MATERIALSX_IDENTITY_MASTER_KEY:randomBytes(32).toString('base64'),
    MATERIALSX_IDENTITY_ADDR:'127.0.0.1:'+port,MATERIALSX_IDENTITY_PUBLIC_URL:origin,
    MATERIALSX_CLOUD_MODE:'alpha',MATERIALSX_CLOUD_ROUTE_VERIFIED:'1',MATERIALSX_PAYMENT_MODE:'disabled',
    ROOTFLOWAI_API_KEY:supplier.apiKey,ROOTFLOWAI_MODEL:supplier.model,ROOTFLOWAI_BASE_URL:'https://api.rootflowai.com/v1',
    MATERIALSX_METERING_PRICE_VERSION:'',MATERIALSX_PROCUREMENT_PRICE_VERSION:'',MATERIALSX_PAID_PRICE_VERSION:'',
    MATERIALSX_CLOUD_MAX_REQUESTS:'16',MATERIALSX_CLOUD_MAX_OUTPUT_TOKENS:'4096',MATERIALSX_CLOUD_MAX_DURATION_SECONDS:'300'};
  const sql=(input:string)=>{const r=spawnSync('/opt/homebrew/opt/postgresql@16/bin/psql',
    ['-h','127.0.0.1','-p','55452','-U','mx_local_owner','-d','postgres','-X','-v','ON_ERROR_STOP=1','-At'],{env,input,encoding:'utf8'});
    if(r.status!==0)throw Error('Isolated database operation failed; private diagnostics suppressed');};
  const go=(args:string[],input?:unknown)=>{const r=spawnSync('go',['-C','services/control-plane',...args],{env,encoding:'utf8',timeout:120000,
    ...(input?{input:JSON.stringify(input)}:{})});if(r.status!==0)throw Error('Evaluation gateway initialization failed; private diagnostics suppressed');return r.stdout;};
  let server:ChildProcess|null=null,created=false,client:IdentityClient|undefined;
  const observations:Promise<void>[]=[];
  const close=async()=>{
    await Promise.allSettled(observations);
    try{await client?.logout();}catch{/* Isolation teardown must continue after network errors. */}
    if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise<void>(r=>server!.once('exit',()=>r()));}
    env.ROOTFLOWAI_API_KEY='';supplier.apiKey='';
    if(created){sql('DROP DATABASE '+database);created=false;}
    await rm(temp,{recursive:true,force:true});
  };
  try{
    sql('CREATE DATABASE '+database);created=true;go(['run','./cmd/identityctl','--command','migrate']);
    const email='rootflow-eval-'+randomBytes(6).toString('hex')+'@example.invalid',password=randomBytes(24).toString('base64url');
    const id=go(['run','./cmd/identityctl','--command','create-user'],{email,password,displayName:'Isolated RootFlow evaluation'}).match(/id=([A-Za-z0-9_-]+)/)?.[1];assert(id);
    go(['run','./cmd/identityctl','--command','grant-cloud'],{accountId:id,requestLimit:requestAllowance,expiresAt:new Date(Date.now()+grantDurationMs).toISOString()});
    const binary=join(temp,'identity');go(['build','-o',binary,'./cmd/identity']);server=spawn(binary,[],{env,stdio:'ignore'});
    let ready=false;
    for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Evaluation gateway exited');
      try{if((await fetch(origin+'/health',{signal:AbortSignal.timeout(500)})).ok){ready=true;break;}}catch{}
      await new Promise(r=>setTimeout(r,100));}
    assert(ready,'Evaluation gateway not ready');let credentials:Awaited<ReturnType<CredentialVault['read']>>=null;
    const vault:CredentialVault={available:()=>true,read:async()=>credentials,write:async v=>{credentials=v;},clear:async()=>{credentials=null;}};
    client=new IdentityClient(origin,vault,async authorization=>{
      const page=await fetch(authorization),html=await page.text(),csrf=html.match(/name="csrf" value="([^"]+)"/)?.[1];assert(csrf);
      const r=await fetch(authorization,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:origin,
        Cookie:page.headers.get('set-cookie')!.split(';')[0]!},body:new URLSearchParams({csrf,email,password,approve:'yes'})});
      assert.equal(r.status,303);assert.equal((await fetch(r.headers.get('location')!)).status,200);
    },true);
    const account=await client.login();assert(account.user);
    const transport={origin:client.origin,platformRequest:async(path:string,init?:RequestInit)=>{
      const startedAt=Date.now(),response=await client!.platformRequest(path,init),headersAt=Date.now();
      if(onWire&&path==='/v1/model-gateway/responses')observations.push(observeRootflowWire(response.clone(),startedAt,headersAt)
        .then(observation=>{const body=JSON.parse(String(init?.body??'{}'));onWire({requestId:new Headers(init?.headers).get('X-Materialsx-Request-Id'),status:response.status,requestMetadata:{model:body.model,maxOutputTokens:body.max_output_tokens,contextBytes:Buffer.byteLength(JSON.stringify(body)),toolContractSha256:hash(canonical(body.tools??[]))},...observation});})
        .catch(()=>{onWire({requestId:new Headers(init?.headers).get('X-Materialsx-Request-Id'),status:response.status,startedAt,headersAt,streamObservation:'interrupted'});}));
      return response;
    }};
    const platform=new PiPlatformSessionService(transport),catalog=await platform.catalog();
    assert.equal(catalog.items[0]?.upstreamModelId,'gpt-5.6-sol');assert(catalog.alpha.available);
    return {accountId:account.user.id,platform,catalog,temp,close,flushWire:()=>Promise.allSettled(observations),testDatabaseUrl:dsn.href,identityFixture:{origin,email,password}};
  }catch(error){await close();throw error;}
}
