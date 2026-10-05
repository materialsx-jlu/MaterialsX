// Explicit local acceptance against an already paid account. Generates real provider usage.
// No grants, payments, refunds, provider retries, or research data are created here.
import {readFileSync,writeFileSync,mkdirSync,lstatSync} from 'node:fs';
import {IdentityClient,type CredentialVault} from '../packages/control-plane-client/src/identity.js';
import {PiPlatformSessionService} from '../packages/pi-adapter/src/platform-session.js';
import {walletSchema,taskBillsSchema,alphaTaskSchema,alphaRequestSchema,creditLedgerSchema,creditSubunits,creditDisplay,billingActivitySchema} from '../packages/contracts/src/platform.js';
const verifyOnly=process.argv.includes('--verify-existing');
if(!verifyOnly&&!process.argv.includes('--authorized-local-paid-call'))throw Error('Explicit local paid-call acceptance flag required');
const path='runtime/m5-local/private-config.json',stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('Private development configuration required');
const cfg=JSON.parse(readFileSync(path,'utf8')),origin='http://127.0.0.1:8788';
let stored:Awaited<ReturnType<CredentialVault['read']>>=null;
const vault:CredentialVault={available:()=>true,read:async()=>stored,write:async v=>{stored=v},clear:async()=>{stored=null}};
const client=new IdentityClient(origin,vault,async authorization=>{
 const page=await fetch(authorization),html=await page.text(),csrf=html.match(/name="csrf" value="([^"]+)"/)?.[1];if(!csrf)throw Error('Local authorization page unavailable');
 const r=await fetch(authorization,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:origin,Cookie:page.headers.get('set-cookie')!.split(';')[0]!},body:new URLSearchParams({csrf,email:'developer@materialsx.local',password:cfg.userPassword,approve:'yes'})});
 const location=r.headers.get('location');if(r.status!==303||!location||new URL(location).hostname!=='127.0.0.1')throw Error('Local approval failed');
 if(!(await fetch(location)).ok)throw Error('Local callback failed');
},true);
const get=async<T>(path:string,schema:{parse(v:unknown):T})=>{const r=await client.platformRequest(path);if(!r.ok)throw Error('Authenticated validation read failed');return schema.parse(await r.json())};
try{
 const account=await client.login();if(!account.user||account.user.email!=='developer@materialsx.local')throw Error('Designated account required');
 const pi=new PiPlatformSessionService(client),catalog=await pi.catalog();
 if(!catalog.alpha.available||catalog.paidPricing?.id!=='paid-sol-20261001-v1'||catalog.paidPricing.tiers[0]?.inputPerMillion!=='1000'||catalog.paidPricing.tiers[0]?.cachedInputPerMillion!=='100'||catalog.paidPricing.tiers[0]?.outputPerMillion!=='10000')throw Error('Paid pilot not available');
 const before=await get('/v1/billing/wallet',walletSchema);
 const conversation=`m53b-live-${Date.now()}`;let deltas:number|null=0;
 let answer="",run:ReturnType<typeof pi.snapshot>;
 if(verifyOnly){const all=await get('/v1/billing/tasks',taskBillsSchema),bill=all.items.find(b=>b.billingMode==='paid-credits'&&b.state==='completed');if(!bill)throw Error('No completed paid task');const task=await get(`/v1/tasks/${bill.id}`,alphaTaskSchema),response=await client.platformRequest(`/v1/tasks/${bill.id}/requests`),page=await response.json();run={task,requests:page.items.map((v:unknown)=>alphaRequestSchema.parse(v))};answer="既有任务账单核对；该模式不读取回答正文或重新调用模型";deltas=null;} else {answer=await pi.prompt(account.user.id,conversation,'materials-research','必须先调用 read_material_file 读取已批准的 synthetic-silicon.txt，然后仅用一句中文报告文件中的元素符号与原子序数。',
  {files:[{id:'synthetic-silicon',name:'synthetic-silicon.txt',text:'Synthetic test fixture. Element Si; atomic number 14. This is public synthetic data, not a research document.',sha256:'synthetic-public-test'}],skills:[]},catalog,()=>{deltas=(deltas??0)+1},'500');run=pi.snapshot(conversation);if(run){mkdirSync('runtime/m53b',{recursive:true,mode:0o700});writeFileSync('runtime/m53b/live-checkpoint.json',JSON.stringify({run,before,deltaCount:deltas,answer})+'\n',{mode:0o600})}}if(!run||run.task.state!=='completed'||run.task.billingMode!=='paid-credits'||run.requests.length!==2||!verifyOnly&&(!answer.includes('14')||(deltas??0)<1)||run.requests.some(r=>r.settlement!=='settled'||r.chargedCredits===null||!r.terminalReceived))throw Error('Real paid Pi flow did not complete; inspect account bill, never auto-retry');
 const after=await get('/v1/billing/wallet',walletSchema),bills=await get('/v1/billing/tasks',taskBillsSchema),ledger=await get('/v1/billing/ledger',creditLedgerSchema),activity=await get('/v1/billing/activity',billingActivitySchema);
 const charged=run.requests.reduce((n,r)=>n+creditSubunits(r.chargedCredits!),0n),bill=bills.items.find(b=>b.id===run.task.id);
 if(!before.purchased||!after.purchased||!verifyOnly&&creditSubunits(before.purchased.availableCredits)-creditSubunits(after.purchased.availableCredits)!==charged||after.purchased.heldCredits!=='0'||!bill||creditSubunits(bill.chargedCredits)!==charged||bill.billingMode!=='paid-credits'||bill.heldCredits!=='0'||before.consumedCredits!==after.consumedCredits)throw Error('Wallet and task bill mismatch');
 const entries=ledger.items.filter(e=>run.requests.some(r=>r.id===e.requestId)&&e.kind==='settle');if(run.requests.some(r=>!entries.some(e=>e.requestId===r.id))||entries.reduce((n,e)=>n+creditSubunits(e.consumedDelta),0n)!==charged||entries.some(e=>e.unit!=='paid-credit'))throw Error('Immutable real ledger mismatch');
 mkdirSync('runtime/m53b',{recursive:true,mode:0o700});writeFileSync('runtime/m53b/real-paid-validation.json',JSON.stringify({generatedAt:new Date().toISOString(),task:run.task,requests:run.requests,before:verifyOnly?{...before.purchased,availableCredits:creditDisplay(creditSubunits(before.purchased.availableCredits)+charged),consumedCredits:creditDisplay(creditSubunits(before.purchased.consumedCredits)-charged)}:before.purchased,verificationRecovery:verifyOnly,beforeBasis:verifyOnly?"reconstructed-from-request-ledger":"measured-wallet",after:after.purchased,charged:creditDisplay(charged),deltaCount:deltas,toolRoundtrip:verifyOnly?null:true,bill,activity,answer},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({realProvider:true,model:'gpt-5.6-sol',paidRequests:run.requests.length,chargedCredits:creditDisplay(charged),remainingCredits:after.purchased.availableCredits,heldCredits:after.purchased.heldCredits,deltaCount:deltas,toolRoundtrip:verifyOnly?null:true,walletBillLedgerMatch:true,procurementCost:'unknown'}));
} finally {await client.logout();}
