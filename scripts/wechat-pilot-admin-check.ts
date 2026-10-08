// Read-only protected finance acceptance. No real refund or success simulation.
import assert from 'node:assert/strict';
import {readFile,lstat,writeFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {opsFinanceSchema} from '../packages/contracts/src/platform.js';
const origin='http://127.0.0.1:8788',path='runtime/m5-local/private-config.json';const st=await lstat(path);assert.equal(st.mode&0o077,0);assert.ok(st.isFile()&&!st.isSymbolicLink());const cfg=JSON.parse(await readFile(path,'utf8'));
const bits=cfg.adminTOTP.split('').map((c:string)=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('');const key=Buffer.from(bits.match(/.{8}/g).map((b:string)=>parseInt(b,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',key).update(counter).digest(),offset=h.at(-1)!&15;const otp=((h.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');
const r=await fetch(origin+'/ops/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email:'admin@materialsx.local',password:cfg.adminPassword,otp})});assert.equal(r.status,200,'MFA step may be used only once');const login=await r.json() as {csrf:string},cookies=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
try{
 const finance=await fetch(origin+'/ops/api/finance',{headers:{Cookie:cookies}});assert.equal(finance.status,200);const f=opsFinanceSchema.parse(await finance.json());assert.equal(f.cashInFen,'101');assert.equal(f.netCashFen,'101');assert.equal(f.cashRefundedFen,'0');assert.equal(f.syntheticInFen,'0');assert.equal(f.items.filter(v=>v.order.state==='paid'&&v.order.channel==='wechat').length,2);
 const verification=await fetch(origin+'/ops/api/verify',{headers:{Cookie:cookies}});assert.equal(verification.status,200);const v=await verification.json() as {verified:boolean;grants:number};assert.equal(v.verified,true);assert.equal(v.grants,2);
 const result={adminMFA:true,protectedFinance:true,cashInFen:f.cashInFen,cashRefundedFen:f.cashRefundedFen,netCashFen:f.netCashFen,syntheticInFen:f.syntheticInFen,ledgerVerified:true,realRefundExecuted:false,generatedAt:new Date().toISOString()};await writeFile('runtime/wechat-pay/subscription-pilot/admin-validation.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result));
}finally{await fetch(origin+'/ops/api/logout',{method:'POST',headers:{Cookie:cookies,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':login.csrf},body:'{}'})}
