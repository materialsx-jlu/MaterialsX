import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdentityClient, type CredentialVault } from "../packages/control-plane-client/src/identity.js";
import {runRpsmeWorkflow} from "../packages/pi-adapter/src/rpsme-workflow.js";
import {pdfPreprocessSpec} from "../packages/pi-adapter/src/local-session.js";
import {walletSchema} from "../packages/contracts/src/platform.js";
import { PiPlatformSessionService } from "../packages/pi-adapter/src/platform-session.js";
const live=process.argv.includes("--provider"),metered=process.argv.includes("--metered");
if(live&&metered)throw new Error("M5.3 ledger validation uses the synthetic provider only");
const dsn=process.env.MATERIALSX_IDENTITY_TEST_DATABASE_URL;
if(!dsn||!new URL(dsn).pathname.includes("test"))throw new Error("isolated test database required");
let key="";
if(live){if(!process.argv.includes("--key-stdin")||!process.argv.includes("--unbudgeted-test"))throw new Error("explicit authorized provider flags required");for await(const chunk of process.stdin){key+=String(chunk);if(Buffer.byteLength(key)>4096)throw new Error("invalid private credential")};key=key.trim();if(!key)throw new Error("private credential required")}
const listener=createServer();await new Promise<void>(r=>listener.listen(0,"127.0.0.1",r));const port=(listener.address() as {port:number}).port;await new Promise<void>(r=>listener.close(()=>r()));
const address=`127.0.0.1:${port}`,url=`http://${address}`,email=`gateway-${randomBytes(8).toString("hex")}@example.invalid`,password=randomBytes(24).toString("base64url");
const env={...process.env,MATERIALSX_ENV:"development",MATERIALSX_DEV_MODE:"0",MATERIALSX_IDENTITY_ADDR:address,MATERIALSX_IDENTITY_PUBLIC_URL:url,MATERIALSX_DATABASE_URL:dsn,MATERIALSX_IDENTITY_MASTER_KEY:randomBytes(32).toString("base64"),
 MATERIALSX_CLOUD_MODE:live?"alpha":"disabled",MATERIALSX_CLOUD_ROUTE_VERIFIED:live?"1":"0",ROOTFLOWAI_API_KEY:key,ROOTFLOWAI_MODEL:"gpt-5.6-sol",ROOTFLOWAI_BASE_URL:"https://api.rootflowai.com/v1",
 MATERIALSX_METERING_PRICE_VERSION:metered?"m53-fixture-price-v1":"",MATERIALSX_PROCUREMENT_PRICE_VERSION:"",MATERIALSX_CLOUD_MAX_REQUESTS:"3",MATERIALSX_CLOUD_MAX_OUTPUT_TOKENS:"256",MATERIALSX_CLOUD_MAX_DURATION_SECONDS:"120"};
key="";const dir=await mkdtemp(join(tmpdir(),"mx-gateway-live-"));const binary=join(dir,process.platform==="win32"?"gateway.exe":"gateway");let server:ReturnType<typeof spawn>|null=null;
function run(args:string[],input?:string){const r=spawnSync("go",["-C","services/control-plane",...args],{env,encoding:"utf8",...(input?{input}:{})});if(r.status!==0)throw new Error("fixture initialization rejected");return r.stdout}
try{
 // Discovery verifies exact route before any bounded generation; no supplier text logged.
 if(live){const r=await fetch("https://api.rootflowai.com/v1/models",{redirect:"error",headers:{Authorization:`Bearer ${env.ROOTFLOWAI_API_KEY}`},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error("provider discovery failed");const body=await r.json() as {data?:Array<{id:string}>};if(!body.data?.some(m=>m.id==="gpt-5.6-sol"))throw new Error("verified model not available")}
 run(["run","./cmd/identityctl","--command","migrate"]);
 const output=run(["run","./cmd/identityctl","--command","create-user"],JSON.stringify({email,displayName:"Gateway integration fixture",password}));
 const accountId=output.match(/id=([A-Za-z0-9_-]+)/)?.[1];if(!accountId)throw new Error("fixture account id missing");
 run(["run","./cmd/identityctl","--command","grant-cloud"],JSON.stringify({accountId,requestLimit:8,expiresAt:new Date(Date.now()+3600000).toISOString()}));
 if(metered){run(["run","./cmd/identityctl","--command","publish-sales-price"],JSON.stringify({id:env.MATERIALSX_METERING_PRICE_VERSION,modelId:"materials-research",routeVersionId:"rootflow-sol-responses-2026-10-01-v1",testOnly:true,unit:"test-credit",tiers:[{minInputTokens:0,inputPerMillion:"1000000",cachedInputPerMillion:"1000000",outputPerMillion:"1000000"}],inputOverheadTokens:1000,maxInputTokens:100000,inputPolicy:"utf8-byte-test-estimate-v1",evidenceRef:"synthetic-fixture-only"}));run(["run","./cmd/identityctl","--command","grant-test-credits"],JSON.stringify({id:`m53-${accountId}`,accountId,eventId:`m53-grant-${accountId}`,source:"trial",credits:"1000000",expiresAt:new Date(Date.now()+3600000).toISOString(),dailyLimit:"1000000",monthlyLimit:"1000000"}))}
 run(["build","-o",binary,live?"./cmd/identity":"./internal/gateway/testfixture"]);server=spawn(binary,[],{env,stdio:"ignore"});
 let ready=false;for(let i=0;i<50;i++){if(server.exitCode!==null)throw new Error("fixture server exited");try{if((await (await fetch(url+"/health",{signal:AbortSignal.timeout(500)})).json() as {service?:string}).service==="materialsx-identity"){ready=true;break}}catch{}await setTimeout(100)}if(!ready)throw new Error("fixture not ready");
 let stored:Awaited<ReturnType<CredentialVault["read"]>>=null;const vault:CredentialVault={available:()=>true,read:async()=>stored,write:async v=>{stored=v},clear:async()=>{stored=null}};
 const client=new IdentityClient(url,vault,async authorization=>{
  const page=await fetch(authorization),html=await page.text(),csrf=html.match(/name="csrf" value="([^"]+)"/)?.[1];if(!csrf)throw new Error("fixture browser form missing");
  const response=await fetch(authorization,{method:"POST",redirect:"manual",headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:url,Cookie:page.headers.get("set-cookie")!.split(";")[0]!},body:new URLSearchParams({csrf,email,password,approve:"yes"})});
  if(response.status!==303||(await fetch(response.headers.get("location")!)).status!==200)throw new Error("fixture browser approval failed");
 },true,async(input,init)=>{const r=await fetch(input,init);if(!live&&!r.ok){const b=await r.clone().json().catch(()=>null);console.error({path:new URL(String(input)).pathname,status:r.status,code:b?.error?.code})};return r});
 const account=await client.login();if(!account.user)throw new Error("fixture login failed");
 const pi=new PiPlatformSessionService(client),catalog=await pi.catalog();let deltaCount=0;
 const answer=await pi.prompt(account.user.id,"fixture-conversation","materials-research","You must call read_material_file to read the approved silicon text before answering. Then state its atomic number in Chinese. Do not use prior knowledge.",
  {files:[{id:"fixture-silicon",name:"synthetic-silicon.txt",text:"Synthetic fixture: silicon (Si), atomic number 14. No real research data.",sha256:"synthetic-fixture-not-a-real-file"}],skills:[]},catalog,()=>deltaCount++);
 const snapshot=pi.snapshot("fixture-conversation");if(!answer.includes("14")||snapshot?.task.state!=="completed"||snapshot.requests.length!==2||!snapshot.requests.every(r=>r.terminalReceived&&r.usage?.inputTokens!=null&&r.usage?.outputTokens!=null)||deltaCount<1)throw new Error("gateway Pi roundtrip did not meet acceptance");
 let materialWorkflow:unknown=null;
 if(metered){
  const root=process.cwd(),pdf=join(dir,"synthetic-silicon.pdf"),spec=pdfPreprocessSpec(pdf,dir,root);
  const generated=spawnSync(spec.command,["-c","import fitz,sys;d=fitz.open();p=d.new_page();p.insert_text((72,72),'Synthetic silicon methods\\nThe silicon sample was heated at 300 K.');d.save(sys.argv[1])",pdf],{encoding:"utf8"});if(generated.status!==0)throw new Error("synthetic PDF generation failed");
  let progress="";const result=await pi.workflow(account.user.id,"fixture-rpsme",catalog,"100000",async(signal,invoke)=>{const prep=spawnSync(spec.command,spec.args,{encoding:"utf8"});if(prep.status!==0)throw new Error("synthetic preprocessing failed");return runRpsmeWorkflow({pdfPath:pdf,projectPath:dir,projectRoot:root,python:spec.command,manifestPath:spec.manifest,endpoint:"materialsx-platform:fixture-v1",modelId:"materials-research",contextWindow:10000,signal},invoke)},text=>progress+=text);
  const workflow=pi.snapshot("fixture-rpsme");if(!result.includes("RPSME JSON")||workflow?.requests.length!==2||!workflow.requests.every(r=>r.settlement==="settled"))throw new Error("managed RPSME workflow failed");
  const after=walletSchema.parse(await(await client.platformRequest("/v1/billing/wallet")).json());let cacheInvoked=false;
  await pi.workflow(account.user.id,"fixture-rpsme-cached",catalog,"100000",async(signal,invoke)=>runRpsmeWorkflow({pdfPath:pdf,projectPath:dir,projectRoot:root,python:spec.command,manifestPath:spec.manifest,endpoint:"materialsx-platform:fixture-v1",modelId:"materials-research",contextWindow:10000,signal},async(...args)=>{cacheInvoked=true;return invoke(...args)}),()=>{});
  const cachedWallet=walletSchema.parse(await(await client.platformRequest("/v1/billing/wallet")).json());if(cacheInvoked||after.consumedCredits!==cachedWallet.consumedCredits)throw new Error("cache incurred model charge");
  run(["run","./cmd/identityctl","--command","verify-ledger"]);materialWorkflow={realLocalPdf:true,realPythonValidation:true,modelRequests:workflow.requests.length,phases:workflow.requests.map(r=>r.phase),sameTask:true,cacheCalls:0,consumedCredits:after.consumedCredits,scientificQuality:"needs_review"};
 }
 const evidence={materialWorkflow,schemaVersion:metered?"m5.3-validation-v1":"m5.2-validation-v1",generatedAt:new Date().toISOString(),environment:live?"real-rootflowai":"synthetic-provider-real-postgres",model:"gpt-5.6-sol",protocol:"responses",identity:"real-PKCE-PG",toolRoundtrip:true,requests:snapshot.requests.map(({execution,settlement,usage,terminalReceived})=>({execution,settlement,usage,terminalReceived})),deltaCount,taskState:snapshot.task.state,scientificQuality:"not_evaluated",unverified:["procurement_price","formal_sales_price","upstream_cancellation","production_TLS","Windows_UI",...(metered?[]:["full_PDF_workflow"])]};
 await mkdir(metered?"runtime/m53":"runtime/m52",{recursive:true});await writeFile(metered?"runtime/m53/local-validation.json":live?"runtime/m52/provider-validation.json":"runtime/m52/local-validation.json",JSON.stringify(evidence,null,2)+"\n",{mode:0o600});console.log(JSON.stringify({environment:evidence.environment,toolRoundtrip:true,requests:snapshot.requests.length,deltaCount,completed:true}));
 if(!live){
  const pending=pi.prompt(account.user.id,"fixture-stop","materials-research","slow-fixture",{files:[],skills:[]},catalog,()=>{});await setTimeout(700);if(!pi.cancel("fixture-stop"))throw new Error("fixture cancel unavailable");let stopped=false;try{await pending}catch(e){stopped=e instanceof Error&&/Abort/.test(e.message)}if(!stopped)throw new Error("cancellation failed");console.log("Fixture cancellation passed; upstream usage remains unconfirmed");
 }
 await client.logout();
 if(process.argv.includes("--electron")){if(live)throw new Error("live Electron path requires separate explicit approval fixture");const r=spawnSync("node_modules/.bin/electron",[metered?"apps/desktop/m53-ui-smoke.cjs":"apps/desktop/m52-ui-smoke.cjs"],{stdio:"inherit",env:{...env,MATERIALSX_IDENTITY_FIXTURE_URL:url,MATERIALSX_IDENTITY_FIXTURE_EMAIL:email,MATERIALSX_IDENTITY_FIXTURE_PASSWORD:password}});if(r.status!==0)throw new Error("desktop fixture failed")}
}catch(error){if(!live)console.error(error);console.error("M5.2 integration failed; credentials and provider payload suppressed");process.exitCode=1}
finally{env.ROOTFLOWAI_API_KEY="";if(server&&server.exitCode===null){server.kill("SIGTERM");await new Promise<void>(resolve=>server!.once("exit",()=>resolve()))}await rm(dir,{recursive:true,force:true})}
