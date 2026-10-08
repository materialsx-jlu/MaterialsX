import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'mx-workspace-')),binary=join(dir,'fixture');
let server:ReturnType<typeof spawn>|undefined;
try{
 if(!process.env.MATERIALSX_IDENTITY_TEST_DATABASE_URL)throw Error('isolated PostgreSQL test DSN required');
 const built=spawnSync('go',['build','-o',binary,'./internal/payments/testfixture'],{cwd:'services/control-plane',stdio:['ignore','ignore','inherit']});if(built.status!==0)throw Error('fixture build failed');
 server=spawn(binary,[],{cwd:'services/control-plane',stdio:['ignore','pipe','pipe'],env:{...process.env,MATERIALSX_WORKSPACE_FIXTURE:'1',ROOTFLOWAI_API_KEY:''}});
 const ready=await new Promise<Record<string,string>>((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('fixture startup timeout')),20000);server!.stdout!.on('data',b=>{text+=String(b);const line=text.split('\n')[0];if(line&&text.includes('\n')){try{const v=JSON.parse(line);clearTimeout(timer);resolve(v)}catch{reject(Error('fixture startup failed'))}}});server!.on('exit',()=>{clearTimeout(timer);reject(Error('fixture exited before ready'))})});
 const result=spawnSync('node_modules/.bin/electron',['apps/desktop/m55-ui-smoke.cjs'],{stdio:['ignore','pipe','pipe'],env:{...process.env,MATERIALSX_IDENTITY_FIXTURE_URL:ready.origin!,MATERIALSX_IDENTITY_FIXTURE_EMAIL:ready.email!,MATERIALSX_IDENTITY_FIXTURE_PASSWORD:ready.password!,MATERIALSX_PAYMENT_FIXTURE_ADMIN:ready.adminEmail!,MATERIALSX_PAYMENT_FIXTURE_TOTP:ready.totpSecret!}});
 if(result.status!==0){console.error(result.stderr.toString());throw Error('workspace desktop/admin acceptance failed')};const output=JSON.parse(result.stdout.toString().trim().split('\n').at(-1)!);await mkdir('runtime/m55',{recursive:true});await writeFile('runtime/m55/local-validation.json',JSON.stringify({...output,generatedAt:new Date().toISOString(),realMoney:false,unverified:['real-wechat-merchant','live-native-QR','actual-payment-and-refund','formal-prices-and-refund-policy','production-metering-bound','Windows-UI']},null,2)+'\n',{mode:0o600});console.log(JSON.stringify(output));
}catch(e){console.error(e instanceof Error?e.message:'M5.5 fixture failed');process.exitCode=1}
finally{if(server&&server.exitCode===null){const exited=new Promise<void>(resolve=>server!.once('exit',()=>resolve()));server.kill('SIGTERM');await exited}await rm(dir,{recursive:true,force:true})}
