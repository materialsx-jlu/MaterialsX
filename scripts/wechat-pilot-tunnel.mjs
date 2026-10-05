// A bounded, callback-only tunnel. Never expose localhost:8788 or ngrok's inspector.
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,lstatSync,writeFileSync,mkdirSync,chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'node:net';
const root=resolve('.'),dir=resolve('runtime/wechat-pay/subscription-pilot');mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
const privatePath=resolve('runtime/m5-local/private-config.json'),st=lstatSync(privatePath);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077))throw Error('Private configuration required');const cfg=JSON.parse(readFileSync(privatePath,'utf8'));
await new Promise((ok,fail)=>{const s=createServer();s.on('error',()=>fail(Error('Inspector port already used; existing tunnels unchanged')));s.listen(4040,'127.0.0.1',()=>s.close(ok))});
const env={...process.env};for(const k of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete env[k];
const log=dir+`/ngrok-${Date.now()}.log`;writeFileSync(log,'',{mode:0o600,flag:'wx'});
const child=spawn('ngrok',['http','127.0.0.1:8899','--inspect=false','--log='+log,'--log-format=json'],{env,cwd:root,stdio:'ignore'});
const ended=new Promise(ok=>{child.once('exit',ok);child.once('error',()=>ok(1))});const timer=setTimeout(()=>child.kill('SIGTERM'),25*60*1000);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill('SIGTERM'));
try{
 let origin;
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Tunnel stopped; inspect private ngrok log');try{const result=await fetch('http://127.0.0.1:4040/api/tunnels',{signal:AbortSignal.timeout(500)});const meta=await result.json();origin=meta.tunnels?.find(t=>t.proto==='https'&&t.config?.addr==='http://127.0.0.1:8899')?.public_url;if(origin)break}catch{}await delay(100)}
 if(!origin||!/^https:\/\/[a-z0-9-]+\.ngrok-free\.app$/.test(origin))throw Error('No validated callback-only HTTPS tunnel');
 const r=spawnSync('/opt/homebrew/opt/postgresql@16/bin/psql',['-X','-At','-v','ON_ERROR_STOP=1','-d','materialsx_local_dev'],{env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'55452',PGUSER:'mx_local_owner',PGPASSWORD:cfg.ownerPassword},encoding:'utf8',input:"SELECT id FROM mx_identity.accounts WHERE email='developer@materialsx.local' AND role='user' AND status='active';"});if(r.status!==0||!/^[A-Za-z0-9_-]{1,128}$/.test(r.stdout.trim()))throw Error('Authorized development account unavailable');
 const approval={version:1,accountEmail:'developer@materialsx.local',accountId:r.stdout.trim(),maxNewPaymentFen:100,subscriptionCredits:1000,importCredits:10,notifyOrigin:origin,createdAt:new Date().toISOString()};
 writeFileSync(resolve('runtime/m5-local/wechat-pilot.json'),JSON.stringify(approval,null,2)+'\n',{mode:0o600});chmodSync(resolve('runtime/m5-local/wechat-pilot.json'),0o600);
 writeFileSync(dir+'/tunnel.json',JSON.stringify({pid:child.pid,origin,callbackOnly:true,maxDurationMinutes:25},null,2)+'\n',{mode:0o600});
 console.log(`Callback-only tunnel ready: ${origin}; automatic stop in 25 minutes`);
 await ended;
}finally{clearTimeout(timer);if(child.exitCode===null){child.kill('SIGTERM');await ended}console.log('Owned callback-only tunnel stopped')}
