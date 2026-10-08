// Persistent loopback identity. Paid calls require the explicit private paid-pilot profile.
import { manageLocalIdentity } from './local-identity-launchd.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, chmodSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dir=join(root,'runtime/m5-local'),data=join(dir,'postgres'),socket=join(dir,'socket');
const configFile=join(dir,'private-config.json'),loginFile=join(dir,'LOGIN.md');
const address='127.0.0.1:8788',origin=`http://${address}`,pgPort='55452';
const database='materialsx_local_dev',owner='mx_local_owner',runtimeRole='mx_local_runtime';
const args=process.argv.slice(2),stop=args.includes('--stop'),pilot=args.includes('--wechat-pilot'),mxPilot=args.includes('--mx-pilot'),mxLive=args.includes('--mx-live'),paid=args.includes('--paid-cloud');
if(args.some(v=>v!=='--stop'&&v!=='--wechat-pilot'&&v!=='--mx-pilot'&&v!=='--mx-live'&&v!=='--paid-cloud'&&v!=='--foreground'))throw Error('Only --stop, --wechat-pilot, --mx-pilot, --mx-live, --paid-cloud and --foreground are supported');
if([paid,pilot,mxPilot,mxLive].filter(Boolean).length>1)throw Error('Payment and cloud profiles must run separately');
if(process.platform==='darwin'&&!args.includes('--foreground')){
 try{if(await manageLocalIdentity(root,args))process.exit(0)}catch(error){console.error(error.message);process.exit(1)}
}
let service=null,worker=null,lock=null,log=null,pgBin;
const token=()=>randomBytes(24).toString('base64url');
// launchd has no shell locale; PostgreSQL on macOS requires an explicit valid locale.
const inherited={...process.env,LC_ALL:'C'};
for(const key of Object.keys(inherited))if(key.startsWith('MATERIALSX_')||key.startsWith('ROOTFLOWAI_'))delete inherited[key];
function run(exe,args,env=inherited,input){
 const result=spawnSync(exe,args,{cwd:root,env,encoding:'utf8',stdio:['pipe','pipe','pipe'],...(input===undefined?{}:{input})});
 if(result.status!==0)throw Error(`Local identity: ${exe.endsWith('psql')?'database setup':args.includes('build')?'Go build':exe.endsWith('initdb')?'PostgreSQL initialization':exe.endsWith('pg_ctl')?'PostgreSQL control':'configuration operation'} failed; credentials and command output suppressed`);
 return result.stdout.trim();
}
function privateDir(path){mkdirSync(path,{recursive:true,mode:0o700});if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isDirectory())throw Error('Private runtime directory must not be a symlink');chmodSync(path,0o700)}
function privateWrite(path,text,exclusive=false){if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('Private file must not be a symlink');writeFileSync(path,text,{mode:0o600,flag:exclusive?'wx':'w'});chmodSync(path,0o600)}
function privateRead(path){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>32768)throw Error('Invalid private file');chmodSync(path,0o600);return readFileSync(path,'utf8')}
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const pgQuote=value=>"'"+value.replaceAll("'","'\\''")+"'";
function pgRunning(){return spawnSync(join(pgBin,'pg_ctl'),['-D',data,'status'],{env:inherited,stdio:'ignore'}).status===0}
async function freePort(port){await new Promise((ok,fail)=>{const s=createServer();s.once('error',()=>fail(Error(`Port ${port} is already used; no existing process was changed`)));s.listen(port,'127.0.0.1',()=>s.close(ok))})}
function dsn(role,password){const u=new URL(`postgres://${role}@127.0.0.1:${pgPort}/${database}`);u.password=password;u.searchParams.set('sslmode','disable');return u.href}
function base32(bytes){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0,text='';for(const b of bytes){value=(value<<8)|b;bits+=8;while(bits>=5){text+=alphabet[(value>>>(bits-5))&31];bits-=5}}if(bits)text+=alphabet[(value<<(5-bits))&31];return text}

try{
 pgBin=process.env.MATERIALSX_POSTGRES_BIN||['/opt/homebrew/opt/postgresql@16/bin','/usr/local/opt/postgresql@16/bin','/usr/lib/postgresql/16/bin'].find(p=>existsSync(join(p,'pg_ctl')));
 if(!pgBin)throw Error('PostgreSQL 16 tools required; set MATERIALSX_POSTGRES_BIN to their directory');
 privateDir(join(root,'runtime'));privateDir(dir);
 if(stop){
  if(existsSync(join(dir,'identity.pid'))){const pid=Number(privateRead(join(dir,'identity.pid')).trim());if(!Number.isSafeInteger(pid)||pid<1)throw Error('Invalid service PID');
   // A PID must still belong to this exact private executable before signalling it.
   const result=spawnSync('ps',['-p',String(pid),'-o','comm='],{encoding:'utf8'});
   if(result.status===0){if(result.stdout.trim()!==join(dir,'identity'))throw Error('Saved PID does not identify this local service; no process was stopped');process.kill(pid,'SIGTERM')}else{unlinkSync(join(dir,'identity.pid'))}}
  for(let i=0;i<50&&existsSync(join(dir,'identity.pid'));i++)await delay(100);
  if(existsSync(join(dir,'identity.pid')))throw Error('Service did not stop; PostgreSQL left running');
  if(pgRunning())run(join(pgBin,'pg_ctl'),['-D',data,'-m','fast','stop']);
  console.log('Local identity and its dedicated PostgreSQL stopped. Accounts and keys preserved.');
 }else{
  await freePort(8788);
  const lockFile=join(dir,'launcher.lock');
  if(existsSync(lockFile)){
   const prior=Number(privateRead(lockFile).trim());
   if(Number.isSafeInteger(prior)&&prior>0){
    const result=spawnSync('ps',['-p',String(prior),'-o','command='],{encoding:'utf8'});
    if(result.status===0&&result.stdout.includes(join(root,'scripts/local-identity.mjs')))throw Error('Local launcher already running');
   }
   // The port is free and the lock's owning launcher is gone. Keep accounts and keys.
   unlinkSync(lockFile);
  }
  lock=openSync(lockFile,'wx',0o600);writeFileSync(lock,String(process.pid)+'\n');
  let cfg;
  if(existsSync(configFile)){
   try{cfg=JSON.parse(privateRead(configFile))}catch{throw Error('Private configuration unreadable; keys were not replaced')}
   if(cfg.version!==1||!['masterKey','ownerPassword','runtimePassword','userPassword','adminPassword','adminTOTP'].every(k=>typeof cfg[k]==='string'&&cfg[k].length>=12)||!/^([A-Z2-7]{32})$/.test(cfg.adminTOTP)||Buffer.from(cfg.masterKey,'base64').length!==32)throw Error('Private configuration invalid; keys were not replaced');
  }else{
   if(existsSync(join(data,'PG_VERSION')))throw Error('Existing PostgreSQL without private configuration; refusing to replace its key');
   cfg={version:1,masterKey:randomBytes(32).toString('base64'),ownerPassword:token(),runtimePassword:token(),userPassword:token(),adminPassword:token(),adminTOTP:base32(randomBytes(20))};
   privateWrite(configFile,JSON.stringify(cfg,null,2)+'\n',true);
  }
  privateDir(socket);
  if(!existsSync(join(data,'PG_VERSION'))){
   const passwordFile=join(dir,'initdb-password.tmp');privateWrite(passwordFile,cfg.ownerPassword+'\n');
   try{run(join(pgBin,'initdb'),['-D',data,'--username='+owner,'--pwfile='+passwordFile,'--auth-host=scram-sha-256','--auth-local=trust','--no-locale','--encoding=UTF8'])}finally{unlinkSync(passwordFile)}
  }
  if(!pgRunning()){
   await freePort(Number(pgPort));
   run(join(pgBin,'pg_ctl'),['-D',data,'-l',join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${pgPort} -k ${pgQuote(socket)}`,'start']);
   chmodSync(join(dir,'postgres.log'),0o600);
  }
  const pgEnv={...inherited,PGHOST:'127.0.0.1',PGPORT:pgPort,PGUSER:owner,PGPASSWORD:cfg.ownerPassword};
  const sql=(query,db='postgres')=>run(join(pgBin,'psql'),['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-d',db],pgEnv,query);
  // Use stdin for SQL containing a password, never command-line arguments or logs.
  if(sql(`SELECT count(*) FROM pg_roles WHERE rolname=${literal(runtimeRole)};`)==='0')sql(`CREATE ROLE ${runtimeRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD ${literal(cfg.runtimePassword)};`);
  if(sql(`SELECT count(*) FROM pg_database WHERE datname=${literal(database)};`)==='0')sql(`CREATE DATABASE ${database} OWNER ${owner};`);
  const env={...inherited,MATERIALSX_ENV:'development',MATERIALSX_LOCAL_DISABLE_ADMIN_TOTP:'1',MATERIALSX_DEV_MODE:'0',MATERIALSX_IDENTITY_ADDR:address,MATERIALSX_IDENTITY_PUBLIC_URL:origin,MATERIALSX_MODEL_MANIFEST_PATH:join(root,'runtime/litellm/model-registry.json'),
   MATERIALSX_DATABASE_URL:dsn(owner,cfg.ownerPassword),MATERIALSX_IDENTITY_MASTER_KEY:cfg.masterKey,MATERIALSX_CLOUD_MODE:'disabled',MATERIALSX_PAYMENT_MODE:'disabled',
   MATERIALSX_ADMIN_ASSET_DIR:join(root,'dist/apps/admin'),MATERIALSX_RELEASE_APPROVALS_FILE:''};
  const billingConfigPath=join(root,'runtime/billing-admin/config.json');
  if(existsSync(billingConfigPath)){
   const billing=JSON.parse(privateRead(billingConfigPath));
   if(billing.publicUrl!=='http://127.0.0.1:8790'||billing.goOrigin!==origin||billing.webAddress!=='127.0.0.1:8790'||typeof billing.proxyToken!=='string'||billing.proxyToken.length<32)throw Error('Local billing Web configuration invalid');
   env.MATERIALSX_BILLING_ADMIN_PUBLIC_URL=billing.publicUrl;env.MATERIALSX_BILLING_PROXY_TOKEN=billing.proxyToken;
  }
  if(pilot||mxPilot||mxLive){
   const approval=JSON.parse(privateRead(join(dir,mxLive?'mx-live.json':mxPilot?'mx-pilot.json':'wechat-pilot.json')));
   const fixed=approval.version===1&&/^https:\/\/[a-z0-9-]+\.ngrok-free\.app$/.test(approval.notifyOrigin)&&(mxLive?approval.approvedPriceVersion==='mx-v0.3-rootflow-svip-20261007-3model-approved-v1':approval.accountEmail==='developer@materialsx.local'&&typeof approval.accountId==='string');
   const limits=mxLive?approval.maxNewPaymentFen===50000:mxPilot?approval.maxNewPaymentFen===1000&&approval.productId==='mx-cny-10-v1':approval.maxNewPaymentFen===100&&approval.subscriptionCredits===1000&&approval.importCredits===10;
   if(!fixed||!limits)throw Error('Pilot authorization invalid');
   for(const line of privateRead(join(root,'runtime/wechat-pay/connection.env')).split('\n')){
    const m=line.match(/^export (MATERIALSX_WECHAT_CONFIG_PATH|MATERIALSX_WECHAT_RUNTIME_DIR|WECHAT_PAY_PUBLIC_KEY_ID)=(.+)$/);if(m)env[m[1]]=m[2];
   }
   env.MATERIALSX_PAYMENT_MODE=mxLive?'wechat-mx-live':'wechat-pilot';env.MATERIALSX_WECHAT_NOTIFY_ORIGIN=approval.notifyOrigin;
   if(!mxLive)env.MATERIALSX_WECHAT_PILOT_ACCOUNT=approval.accountId;
   if(mxPilot){env.MATERIALSX_MX03_PAYMENT_MODE='wechat-pilot';env.MATERIALSX_MX03_PILOT_ACCOUNT=approval.accountId}
   if(mxLive){
    env.MATERIALSX_MX03_PAYMENT_MODE='wechat-live';env.MATERIALSX_MX03_GATEWAY_MODE='wallet';env.MATERIALSX_MX03_PRICE_VERSION=approval.approvedPriceVersion;
    env.MATERIALSX_CLOUD_MODE='alpha';env.MATERIALSX_CLOUD_MAX_REQUESTS='16';env.MATERIALSX_CLOUD_MAX_OUTPUT_TOKENS='8192';env.MATERIALSX_CLOUD_MAX_DURATION_SECONDS='3600';env.MATERIALSX_CLOUD_MAX_CONCURRENT='8';
    // Fable's latest real tool call failed; keep its listed price but do not
    // admit paid requests until its terminal usage and service are reliable.
    env.MATERIALSX_MX03_DIAGNOSTIC_MODELS='gpt-5.6-sol,claude-opus-5-5';
    for(const line of privateRead(join(root,'runtime/v03/litellm-gateway.env')).split('\n')){
     const m=line.match(/^(?:export )?(MATERIALSX_LITELLM_URL|MATERIALSX_LITELLM_GATEWAY_KEY)=(.+)$/);if(m)env[m[1]]=m[2];
    }
    if(!env.MATERIALSX_LITELLM_URL||!env.MATERIALSX_LITELLM_GATEWAY_KEY)throw Error('LiteLLM gateway configuration missing');
    let callbackReady=false;
    for(let attempt=0;attempt<3&&!callbackReady;attempt++){
     const callbackCheck=spawnSync('/usr/bin/curl',['-fsS','--max-time','8','-o','/dev/null','-w','%{http_code}',approval.notifyOrigin+'/live'],{env:inherited,encoding:'utf8'});
     callbackReady=callbackCheck.status===0&&callbackCheck.stdout.trim()==='204';
     if(!callbackReady&&attempt<2)await delay(500);
    }
    if(!callbackReady)throw Error('MX payment callback tunnel unavailable');
   }
  }
  run(process.platform==='win32'?'npm.cmd':'npm',['run','build:admin']);
  for(const command of ['identity','identityctl',...((paid||mxPilot||mxLive)?['worker']:[])])run('go',['-C','services/control-plane','build','-o',join(dir,command),'./cmd/'+command]);
  const ctl=(command,input,extra=[])=>run(join(dir,'identityctl'),['--command',command,...extra],env,input);
  ctl('migrate');ctl('grant-runtime',undefined,['--role',runtimeRole]);
  ctl('import-mx-price-snapshot',readFileSync(join(root,'docs/V0_3_ROOTFLOWAI_PRICING.json'),'utf8'));
  if(mxLive)ctl('approve-mx-price-snapshot',readFileSync(join(root,'docs/V0_3_ROOTFLOWAI_PRICING.json'),'utf8'));
  for(const entry of [{email:'developer@materialsx.local',displayName:'本机开发账户',password:cfg.userPassword,role:'user'},
   {email:'admin@materialsx.local',displayName:'本机开发管理员',password:cfg.adminPassword,role:'admin',totpSecret:cfg.adminTOTP}]){
   const role=sql(`SELECT role FROM mx_identity.accounts WHERE email=${literal(entry.email)};`,database);
   if(role&&role!==entry.role)throw Error('Existing development account has an unexpected role; no credentials changed');
   if(!role){const {role,...input}=entry;ctl(role==='admin'?'bootstrap-admin':'create-user',JSON.stringify(input))}
  }
  if(paid){
   const paidPath=join(dir,'paid-cloud.json'),st=lstatSync(paidPath);
   if(st.isSymbolicLink()||!st.isFile()||(st.mode&0o077)!==0)throw Error('Paid profile must be a private regular file with mode 600');
   const profile=JSON.parse(privateRead(paidPath));
   if(profile.version!==1||profile.accountEmail!=='developer@materialsx.local'||profile.model!=='gpt-5.6-sol'||typeof profile.apiKey!=='string'||profile.apiKey.length<20||/[\r\n]/.test(profile.apiKey))throw Error('Private paid profile invalid; credentials suppressed');
   const accountId=sql("SELECT id FROM mx_identity.accounts WHERE email='developer@materialsx.local' AND status='active';",database);
   if(!accountId)throw Error('Active designated development account required');
   const price={id:'paid-sol-20261001-v1',modelId:'materials-research',routeVersionId:'rootflow-sol-responses-2026-10-01-v1',testOnly:false,unit:'paid-credit',tiers:[{minInputTokens:0,inputPerMillion:'10000000',cachedInputPerMillion:'1000000',outputPerMillion:'100000000'}],inputOverheadTokens:0,maxInputTokens:131072,inputPolicy:'paid-pilot-ceiling-v1',evidenceRef:'user-approved-retail-20261001'};
   ctl('publish-sales-price',JSON.stringify(price));
   // These ceilings do not create credits. Wallet funds still require verified payments.
   sql(`INSERT INTO mx_identity.paid_credit_limits VALUES(${literal(accountId)},10000000,10000000) ON CONFLICT(account_id) DO NOTHING;`,database);
   env.MATERIALSX_CLOUD_MAX_REQUESTS='0';env.MATERIALSX_CLOUD_MAX_OUTPUT_TOKENS='8192';env.MATERIALSX_CLOUD_MAX_DURATION_SECONDS='3600';env.MATERIALSX_CLOUD_MAX_CONCURRENT='0';env.MATERIALSX_CLOUD_DISABLE_RATE_LIMIT='1';
   env.MATERIALSX_CLOUD_MODE='paid-pilot';env.MATERIALSX_PAID_PILOT_ACCOUNT=accountId;env.MATERIALSX_METERING_PRICE_VERSION=price.id;env.MATERIALSX_CLOUD_ROUTE_VERIFIED='1';env.ROOTFLOWAI_MODEL=profile.model;env.ROOTFLOWAI_API_KEY=profile.apiKey;env.ROOTFLOWAI_BASE_URL='https://api.rootflowai.com/v1';
  }
  privateWrite(loginFile,`# MaterialsX 本机开发登录资料（私有）\n\n仅用于本机，不得提交 GitHub、Issue、截图或公开日志。\n\n## 桌面普通账户\n\n邮箱：developer@materialsx.local\n\n密码：${cfg.userPassword}\n\n启动 MaterialsX → 云服务中心 → 登录，在浏览器输入上面的账户，勾选授权。\n\n## 运营管理员\n\n后台：${origin}/ops\n\n邮箱：admin@materialsx.local\n\n密码：${cfg.adminPassword}\n\n本机后台已关闭 TOTP，使用邮箱和密码登录。\n\n## 运行\n\n重新启动：npm run identity:local${paid?' -- --paid-cloud':mxLive?' -- --mx-live':mxPilot?' -- --mx-pilot':pilot?' -- --wechat-pilot':''}\n\nmacOS 使用 launchd 托管，关闭终端不停止服务，异常退出自动重启。\n\n停止服务及专用 PostgreSQL：npm run identity:local -- --stop\n\n专用数据库：127.0.0.1:${pgPort}/${database}。主密钥和数据库连接密码在同目录 private-config.json 中，重启不改变。\n\n${paid?'指定开发账户的真实积分消费已启用（0.0001 积分精度）；支付关闭。':mxLive?'本机 MX 四档真实微信支付与 MX 钱包网关模式已启用。':mxPilot?'仅指定本机账户可创建 ¥10 MX 微信订单；云生成禁用。':pilot?'当前仅启用本机账户 ¥1 微信支付联调，真实积分与测试额度分开；云生成禁用。':'云生成和支付均禁用。'}这里没有供应商 Key。删除私有目录会丢失账户和密钥。\n`);
  log=openSync(join(dir,'identity.log'),'a',0o600);chmodSync(join(dir,'identity.log'),0o600);
  if(paid||mxPilot||mxLive){worker=spawn(join(dir,'worker'),[],{cwd:root,env:{...env,MATERIALSX_DATABASE_URL:dsn(runtimeRole,cfg.runtimePassword)},stdio:['ignore',log,log]});worker.once('error',()=>service?.kill('SIGTERM'));worker.once('exit',()=>{if(service?.exitCode===null)service.kill('SIGTERM')})}
  service=spawn(join(dir,'identity'),[],{cwd:root,env:{...env,MATERIALSX_DATABASE_URL:dsn(runtimeRole,cfg.runtimePassword)},stdio:['ignore',log,log]});
  const exited=new Promise(resolve=>{service.once('exit',resolve);service.once('error',()=>resolve(-1))});
  let ready=false;
  for(let i=0;i<100;i++){
   if(service.exitCode!==null)throw Error('Identity service exited; inspect private identity.log (do not publish configuration)');
   try{if((await fetch(origin+'/health',{signal:AbortSignal.timeout(500)})).ok){ready=true;break}}catch{}
   await delay(100);
  }
  if(!ready)throw Error('Identity service failed health check');
  privateWrite(join(dir,'identity.pid'),String(service.pid)+'\n');
  console.log(`MaterialsX local identity ready: ${origin}\nOperations: ${origin}/ops\nPrivate login details: ${loginFile}\n${paid?'Cloud: designated paid-credit pilot. Payments: disabled.':mxLive?'Cloud: MX wallet. MX WeChat: four live denominations.':mxPilot?'Cloud: disabled. MX WeChat: designated ten-yuan pilot only.':pilot?'Cloud: disabled. WeChat: authorized one-yuan pilot only.':'Cloud and payments: disabled.'} Keys/accounts persist across restarts.\nStop: npm run identity:local -- --stop`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{service?.kill('SIGTERM');worker?.kill('SIGTERM')});
  const code=await exited;if(code!==0&&code!==null)process.exitCode=1;
 }
}catch(error){console.error(error instanceof Error?error.message:'Local identity failed');process.exitCode=1}
finally{
 if(worker&&worker.exitCode===null){worker.kill('SIGTERM');await new Promise(ok=>worker.once('exit',ok))}
 if(service&&service.exitCode===null){service.kill('SIGTERM');await new Promise(ok=>service.once('exit',ok))}
 if(log!==null)closeSync(log);
 if(lock!==null){closeSync(lock);for(const file of ['launcher.lock','identity.pid'])if(existsSync(join(dir,file)))unlinkSync(join(dir,file))}
}
