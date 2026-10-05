import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
// Explicit opt-in test DB only. No external LLM/provider calls or production credentials.
const dsn=process.env.MATERIALSX_IDENTITY_TEST_DATABASE_URL;
if(!dsn||!new URL(dsn).pathname.includes("test"))throw new Error("Isolated test PostgreSQL DSN required");
const address="127.0.0.1:18788",url=`http://${address}`,email=`fixture-${randomBytes(8).toString("hex")}@example.invalid`;
const password=randomBytes(24).toString("base64url");
const env={...process.env,MATERIALSX_ENV:"development",MATERIALSX_DEV_MODE:"0",MATERIALSX_IDENTITY_ADDR:address,
 MATERIALSX_IDENTITY_PUBLIC_URL:url,MATERIALSX_DATABASE_URL:dsn,MATERIALSX_IDENTITY_MASTER_KEY:randomBytes(32).toString("base64")};
const dir=await mkdtemp(join(tmpdir(),"mx-identity-live-"));const binary=join(dir,process.platform==="win32"?"identity.exe":"identity");
let server: ReturnType<typeof spawn>|null=null;
function run(args:string[],input?:string){const r=spawnSync("go",["-C","services/control-plane",...args],{env,encoding:"utf8",...(input?{input}:{} )});
 if(r.status!==0)throw new Error("Identity fixture build/initialization failed (details suppressed)");}
try {
 run(["build","-o",binary,"./cmd/identity"]);
 run(["run","./cmd/identityctl","--command","migrate"]);
 run(["run","./cmd/identityctl","--command","create-user"],JSON.stringify({email,displayName:"Integration fixture",password}));
 server=spawn(binary,[],{env,stdio:"ignore"});
 let ready=false;
 for(let i=0;i<40;i++){if(server.exitCode!==null)throw new Error("Identity fixture service exited");
  try{const r=await fetch(url+"/health",{signal:AbortSignal.timeout(500)});if(r.ok){ready=true;break}}catch{}await setTimeout(100);}
 if(!ready)throw new Error("Identity fixture service not ready");
 const tests=process.argv.includes("--all")?["packages/**/*.test.ts","apps/**/*.test.ts"]:["packages/control-plane-client/src/identity.test.ts"];
 const result=spawnSync(process.execPath,["--import","tsx","--test",...tests],{stdio:"inherit",env:{...env,
 MATERIALSX_IDENTITY_FIXTURE_URL:url,MATERIALSX_IDENTITY_FIXTURE_EMAIL:email,MATERIALSX_IDENTITY_FIXTURE_PASSWORD:password}});
 process.exitCode=result.status??1;
 if(result.status===0 && process.argv.includes("--electron")) {
  const desktop=spawnSync("node_modules/.bin/electron",["apps/desktop/m51-ui-smoke.cjs"],{stdio:"inherit",env:{...env,
   MATERIALSX_IDENTITY_FIXTURE_URL:url,MATERIALSX_IDENTITY_FIXTURE_EMAIL:email,MATERIALSX_IDENTITY_FIXTURE_PASSWORD:password}});
  process.exitCode=desktop.status??1;
 }
} finally { if(server&&server.exitCode===null){server.kill("SIGTERM");await new Promise<void>(resolve=>server!.once("exit",()=>resolve()));}await rm(dir,{recursive:true,force:true});}
