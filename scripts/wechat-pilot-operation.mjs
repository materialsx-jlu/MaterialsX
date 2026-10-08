// Private local pilot operations. No secret is included in argv or printed.
import {readFileSync,lstatSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve('.'),dir=resolve('runtime/m5-local');
const read=path=>{const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||st.size>65536||(st.mode&0o077))throw Error('Private file required');return readFileSync(path,'utf8')};
const cfg=JSON.parse(read(dir+'/private-config.json')),approval=JSON.parse(read(dir+'/wechat-pilot.json'));
const args=process.argv.slice(2);if(!['--publish','--import','--serve','--verify'].includes(args[0])||args.length!==1)throw Error('Select --publish, --import, --serve or --verify');
if(approval.version!==1||approval.maxNewPaymentFen!==100||approval.subscriptionCredits!==1000||approval.importCredits!==10||approval.accountEmail!=='developer@materialsx.local')throw Error('Invalid authorization');
const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('MATERIALSX_')||k.startsWith('ROOTFLOWAI_'))delete env[k];
Object.assign(env,{MATERIALSX_ENV:'development',MATERIALSX_IDENTITY_PUBLIC_URL:'http://127.0.0.1:8788',MATERIALSX_IDENTITY_MASTER_KEY:cfg.masterKey,MATERIALSX_CLOUD_MODE:'disabled',MATERIALSX_PAYMENT_MODE:'wechat-pilot',MATERIALSX_WECHAT_PILOT_ACCOUNT:approval.accountId,MATERIALSX_WECHAT_NOTIFY_ORIGIN:approval.notifyOrigin});
for(const line of read(resolve('runtime/wechat-pay/connection.env')).split('\n')){const m=line.match(/^export (MATERIALSX_WECHAT_CONFIG_PATH|MATERIALSX_WECHAT_RUNTIME_DIR|WECHAT_PAY_PUBLIC_KEY_ID)=(.+)$/);if(m)env[m[1]]=m[2]}
const role=args[0]==='--publish'?'mx_local_owner':'mx_local_runtime';const url=new URL(`postgres://${role}@127.0.0.1:55452/materialsx_local_dev?sslmode=disable`);url.password=role==='mx_local_owner'?cfg.ownerPassword:cfg.runtimePassword;env.MATERIALSX_DATABASE_URL=url.href;
const flags=args[0]==='--serve'?[]:args[0]==='--import'?['--import-order',JSON.parse(read(resolve('runtime/wechat-pay/probe-20261001-one-fen/order.json'))).orderId]:args;
const exe=resolve('runtime/m5-local/wechatpilot');if(!existsSync(exe))throw Error('Build private wechatpilot executable first');
const child=spawn(exe,flags,{cwd:root,env,stdio:'inherit'});for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>child.kill('SIGTERM'));child.on('exit',code=>process.exitCode=code??1);
