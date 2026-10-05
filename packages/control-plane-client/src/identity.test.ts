import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { IdentityClient, IdentityLoginError, identityOrigin, type CredentialVault } from "./identity.js";

const id="A".repeat(43), origin="https://identity.example.invalid";
const account={id,email:"fixture@example.invalid",displayName:"Fixture",role:"user",status:"active",version:"1",deviceId:id,mfaVerified:false};
const tokens={tokenType:"Bearer",accessToken:"synthetic-access-only",refreshToken:"synthetic-refresh-only",expiresIn:900,deviceId:id};
function vault(initial: {origin:string;refreshToken:string}|null=null) {
 let record=initial;
 return {available:()=>true,read:async()=>record,write:async(v)=>{record=v},clear:async()=>{record=null}} satisfies CredentialVault;
}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});

test("identity origin rejects credentials, paths, insecure production and non-loopback development",()=>{
 assert.equal(identityOrigin("https://identity.example.invalid/",false),origin);
 assert.equal(identityOrigin("http://127.0.0.1:8788",true),"http://127.0.0.1:8788");
 for(const url of ["http://127.0.0.1:8788","https://a:b@identity.example.invalid","https://identity.example.invalid/path","https://identity.example.invalid?token=x"])
  assert.throws(()=>identityOrigin(url,false));
 assert.throws(()=>identityOrigin("http://localhost:8788",true));
});

test("offline login gives controlled startup guidance, closes callback and allows retry without leaking transport errors",async()=>{
 const store=vault();let callbacks:string[]=[],opened=0;
 const client=new IdentityClient("http://127.0.0.1:8788",store,async()=>{opened++},true,async(_input,init)=>{
  callbacks.push(JSON.parse(String(init?.body)).redirectUri);throw new Error("fetch failed synthetic-private-detail");
 });
 for(let i=0;i<2;i++) await assert.rejects(client.login(),error=>{
  assert.ok(error instanceof IdentityLoginError);assert.match(error.message,/无法连接平台账户服务/);
  assert.match(error.message,/启动本地身份服务/);assert.ok(!error.message.includes("synthetic-private-detail"));return true;
 });
 assert.equal(opened,0);assert.equal(await store.read(),null);assert.equal(callbacks.length,2);
 for(const callback of callbacks) await assert.rejects(fetch(callback,{signal:AbortSignal.timeout(500)}));
 const httpError=new IdentityClient(origin,vault(),async()=>{opened++},false,async()=>new Response("synthetic-private-detail",{status:503}));
 await assert.rejects(httpError.login(),/HTTP 503/);assert.equal(opened,0);
});

test("desktop PKCE callback checks state; renderer snapshot contains no credentials",async()=>{
 const store=vault();let redirect="",challenge="",exchanges=0;
 const client=new IdentityClient(origin,store,async()=>{
  const wrong=new URL(redirect);wrong.searchParams.set("state","wrong");assert.equal((await fetch(wrong)).status,400);
  const good=new URL(redirect);good.searchParams.set("flowId",id);good.searchParams.set("state",id);good.searchParams.set("code","synthetic-code");
  assert.equal((await fetch(good)).status,200);
 },false,async(input,init)=>{
  const path=new URL(String(input)).pathname;assert.equal(new URL(String(input)).origin,origin);assert.equal(init?.redirect,"error");
  const body=init?.body?JSON.parse(String(init.body)):null;
  if(path.endsWith("/start")){redirect=body.redirectUri;challenge=body.codeChallenge;assert.equal(body.codeChallengeMethod,"S256");
   return json({flowId:id,state:id,authorizationUrl:`${origin}/auth/desktop/${id}`,expiresAt:new Date(Date.now()+300000).toISOString()});}
  if(path.endsWith("/exchange")){exchanges++;assert.equal(createHash("sha256").update(body.codeVerifier).digest("base64url"),challenge);assert.equal(body.authorizationCode,"synthetic-code");return json(tokens);}
  assert.equal((init?.headers as Record<string,string>).Authorization,`Bearer ${tokens.accessToken}`);
  return json(path.endsWith("/me")?account:{items:[],nextCursor:null});
 });
 const snapshot=await client.login();assert.equal(exchanges,1);assert.equal(snapshot.status,"connected");
 assert.ok(!JSON.stringify(snapshot).includes("synthetic-"));assert.equal((await store.read())?.refreshToken,tokens.refreshToken);
});

test("parallel account reads serialize rotating refresh; credentials remain bound to service",async()=>{
 let refreshes=0;const client=new IdentityClient(origin,vault({origin,refreshToken:"old-fixture"}),async()=>{},false,async(input,init)=>{
  const path=new URL(String(input)).pathname;
  if(path.endsWith("/refresh")){refreshes++;assert.equal(JSON.parse(String(init?.body)).refreshToken,"old-fixture");return json(tokens);}
  return json(path.endsWith("/me")?account:{items:[],nextCursor:null});
 });
 const results=await Promise.all([client.snapshot(),client.snapshot(),client.snapshot()]);
 assert.ok(results.every(v=>v.status==="connected"));assert.equal(refreshes,1);
 let calls=0;const foreign=vault({origin:"https://other.invalid",refreshToken:"foreign-fixture"});
 const bound=new IdentityClient(origin,foreign,async()=>{},false,async()=>{calls++;return json(tokens)});
 assert.equal((await bound.snapshot()).status,"unavailable");assert.equal(calls,0);assert.equal(await foreign.read(),null);
});

test("ambiguous refresh is never retried; insecure storage and foreign authorization fail closed",async()=>{
 let calls=0;const store=vault({origin,refreshToken:"old-fixture"});
 const client=new IdentityClient(origin,store,async()=>{},false,async()=>{calls++;throw new Error("network dropped after upstream rotation")});
 assert.equal((await client.snapshot()).status,"unavailable");assert.equal((await client.snapshot()).status,"signed_out");assert.equal(calls,1);
 let opened=0;const foreign=new IdentityClient(origin,vault(),async()=>{opened++},false,async()=>json({flowId:id,state:id,
  authorizationUrl:`https://attacker.invalid/auth/desktop/${id}`,expiresAt:new Date().toISOString()}));
 await assert.rejects(foreign.login(),/授权页面校验失败/);assert.equal(opened,0);
 const insecure=new IdentityClient(origin,{...vault(),available:()=>false},async()=>{});
 assert.equal((await insecure.snapshot()).status,"unavailable");await assert.rejects(insecure.login(),/安全存储不可用/);
});

test("browser login can be cancelled and logout does not report remote revocation after network failure",async()=>{
 let opened!:()=>void;const browser=new Promise<void>(r=>{opened=r});
 const client=new IdentityClient(origin,vault(),async()=>{opened()},false,async()=>json({flowId:id,state:id,
  authorizationUrl:`${origin}/auth/desktop/${id}`,expiresAt:new Date().toISOString()}));
 const pending=client.login();await browser;client.cancelLogin();await assert.rejects(pending,/已取消登录/);
 const store=vault({origin,refreshToken:"old-fixture"});
 const offline=new IdentityClient(origin,store,async()=>{},false,async(input)=>{
  const path=new URL(String(input)).pathname;if(path.endsWith("/refresh"))return json(tokens);if(path.endsWith("/logout"))throw new Error("offline");
  return json(path.endsWith("/me")?account:{items:[],nextCursor:null});
 });
 await offline.snapshot();await assert.rejects(offline.logout(),/服务端退出未确认/);assert.ok(await store.read());
});

// Runs only against a fixture service initialized by scripts/m5-identity-live.ts.
test("real PostgreSQL identity service: system-browser callback, vault restart and device logout",{skip:!process.env.MATERIALSX_IDENTITY_FIXTURE_URL},async()=>{
 const url=process.env.MATERIALSX_IDENTITY_FIXTURE_URL!;const email=process.env.MATERIALSX_IDENTITY_FIXTURE_EMAIL!;
 const password=process.env.MATERIALSX_IDENTITY_FIXTURE_PASSWORD!;const store=vault();
 const client=new IdentityClient(url,store,async(authorization)=>{
  const page=await fetch(authorization);assert.equal(page.status,200);const html=await page.text();
  const csrf=html.match(/name="csrf" value="([^"]+)"/)?.[1];assert.ok(csrf);
  const approved=await fetch(authorization,{method:"POST",redirect:"manual",headers:{"Content-Type":"application/x-www-form-urlencoded",
   Origin:url,Cookie:page.headers.get("set-cookie")!.split(";")[0]!},body:new URLSearchParams({csrf,email,password,approve:"yes"})});
  assert.equal(approved.status,303);assert.equal((await fetch(approved.headers.get("location")!)).status,200);
 },true);
 assert.equal((await client.login()).user?.email,email);
 const restarted=new IdentityClient(url,store,async()=>{},true);const snapshot=await restarted.snapshot();assert.equal(snapshot.status,"connected");
 assert.equal((await restarted.revoke(snapshot.user!.deviceId)).status,"signed_out");assert.equal(await store.read(),null);
 assert.equal((await client.snapshot()).status,"unavailable");
});

test("gateway transport overwrites renderer-shaped authorization and never replays generation",async()=>{
 let generations=0;
 const client=new IdentityClient(origin,vault({origin,refreshToken:"old-fixture"}),async()=>{},false,async(input,init)=>{
  const path=new URL(String(input)).pathname;
  if(path.endsWith("/refresh"))return json(tokens);
  assert.equal(new Headers(init?.headers).get("Authorization"),`Bearer ${tokens.accessToken}`);
  assert.equal(init?.redirect,"error");generations++;return new Response("untrusted-provider-message",{status:503});
 });
 const response=await client.platformRequest("/v1/model-gateway/responses",{method:"POST",headers:{Authorization:"foreign-fixture"},body:"{}"});
 assert.equal(response.status,503);assert.equal(generations,1);
 await assert.rejects(client.platformRequest("https://foreign.invalid/v1/models"),/路径无效/);
 await assert.rejects(client.platformRequest("/v1/admin/users"),/路径无效/);
 assert.equal(generations,1);
});
