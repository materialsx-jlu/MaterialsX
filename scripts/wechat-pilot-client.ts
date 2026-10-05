// Authorized one-yuan checkout through the same PKCE API as the desktop.
// Credential vault is in memory only; no bearer tokens or passwords in reports.
import assert from 'node:assert/strict';
import {readFile,lstat,writeFile,mkdir,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import QRCode from 'qrcode';
import {IdentityClient,type CredentialVault} from '../packages/control-plane-client/src/identity.js';
import {paymentPlansSchema,paymentOrdersSchema,orderSchema,walletSchema,subscriptionPeriodsSchema} from '../packages/contracts/src/platform.js';
const mode=process.argv[2];assert.ok(mode&&['--create','--watch','--inspect'].includes(mode));
const dir=resolve('runtime/wechat-pay/subscription-pilot'),origin='http://127.0.0.1:8788',path=resolve('runtime/m5-local/private-config.json');
const st=await lstat(path);assert.ok(st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o077)===0);
const cfg=JSON.parse(await readFile(path,'utf8'));
let record:{origin:string;refreshToken:string}|null=null;
const vault:CredentialVault={available:()=>true,read:async()=>record,write:async value=>{record=value},clear:async()=>{record=null}};
const client=new IdentityClient(origin,vault,async url=>{
 assert.equal(new URL(url).origin,origin);
 const page=await fetch(url,{redirect:'error'}),html=await page.text(),csrf=html.match(/name="csrf" value="([^"]+)"/)?.[1];assert.ok(csrf);
 const result=await fetch(url,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:origin,Cookie:page.headers.get('set-cookie')!.split(';')[0]!},body:new URLSearchParams({csrf,email:'developer@materialsx.local',password:cfg.userPassword,approve:'yes'})});assert.equal(result.status,303);
 const callback=new URL(result.headers.get('location')!);assert.equal(callback.hostname,'127.0.0.1');assert.equal(callback.pathname,'/auth/callback');assert.equal((await fetch(callback,{redirect:'error'})).status,200);
},true);
const get=async(path:string)=>{const r=await client.platformRequest(path);assert.equal(r.status,200);return r.json()};
try{
 await client.login();await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
 if(mode==='--create'){
  const plans=paymentPlansSchema.parse(await get('/v1/billing/plans'));assert.equal(plans.mode,'wechat-pilot');
  const plan=plans.items.find(p=>p.id==='wechat-pilot-month-100fen-v1');assert.ok(plan);assert.equal(plan.priceFen,'100');assert.equal(plan.credits,'1000');assert.equal(plan.testOnly,false);
  const response=await client.platformRequest('/v1/billing/orders',{method:'POST',headers:{'Idempotency-Key':'authorized-one-yuan-20261001-v1'},body:JSON.stringify({productVersionId:plan.id,channel:'wechat'})});assert.equal(response.status,200);
  let order=orderSchema.parse(await response.json());assert.equal(order.channel,'wechat');assert.equal(order.amountFen,'100');
  await writeFile(dir+'/order.json',JSON.stringify(order,null,2)+'\n',{mode:0o600});
  for(let i=0;i<45&&order.state==='pending'&&!order.codeUrl;i++){await delay(1000);order=orderSchema.parse(await get('/v1/billing/orders/'+order.id));}
  await writeFile(dir+'/order.json',JSON.stringify(order,null,2)+'\n',{mode:0o600});
  assert.equal(order.state,'pending','Existing payment already settled; do not recreate');assert.ok(order.codeUrl);assert.ok(order.codeUrl.startsWith('weixin://wxpay/'));assert.ok(new Date(order.expiresAt).getTime()>Date.now());
  const png=await QRCode.toBuffer(order.codeUrl,{type:'png',width:480,margin:4,errorCorrectionLevel:'M'});await writeFile(dir+'/wechat-one-yuan.png',png,{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({amountYuan:'1.00',credits:'1000',subscription:'one calendar month',qr:dir+'/wechat-one-yuan.png',expiresAt:order.expiresAt}));
 }else{
  const end=Date.now()+(mode==='--watch'?20*60*1000:0);
  do{
   const orders=paymentOrdersSchema.parse(await get('/v1/billing/orders')).items;
   const subscription=orders.find(o=>o.product.id==='wechat-pilot-month-100fen-v1');assert.ok(subscription,'Create a reviewed order first');
   if(subscription.state==='paid'||mode==='--inspect'){
    const [wallet,sub]=await Promise.all([get('/v1/billing/wallet'),get('/v1/billing/subscriptions')]);const w=walletSchema.parse(wallet),periods=subscriptionPeriodsSchema.parse(sub).items;
    console.log(JSON.stringify({account:'developer@materialsx.local',subscriptionOrderState:subscription.state,paidCredits:w.purchased,periods:periods.map(({startsAt,endsAt,state})=>({startsAt,endsAt,state}))}));
    if(mode==='--watch'){assert.equal(w.purchased?.availableCredits,'1010');assert.ok(periods.some(p=>p.state==='active'));}break;
   }
   await delay(5000);
  }while(Date.now()<end);
  if(mode==='--watch'&&Date.now()>=end)throw Error('Awaiting real payment; no credits fabricated');
 }
}finally{if(record)await client.logout().catch(()=>{})}
