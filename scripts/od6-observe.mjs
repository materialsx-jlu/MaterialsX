import { assessOperations } from '../deploy/od6-monitor.mjs';
import { spawnSync } from 'node:child_process';

const local = (raw,name) => {const value=new URL(raw);if(!['127.0.0.1','localhost','[::1]'].includes(value.hostname)||value.username||value.password||value.search||value.hash)throw Error(`${name}_MUST_BE_LOOPBACK`);return value.origin};
const identity=local(process.env.MATERIALSX_OD6_IDENTITY_ORIGIN||'http://127.0.0.1:8788','IDENTITY');
const litellm=local(process.env.MATERIALSX_OD6_LITELLM_ORIGIN||'http://127.0.0.1:4001','LITELLM');
const billing=local(process.env.MATERIALSX_OD6_BILLING_ORIGIN||'http://127.0.0.1:8790','BILLING');
async function probe(url,headers={}){try{const result=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(3000)});return result.ok?result:null}catch{return null}}
const [ready,proxy,finance,metricResponse,catalogResponse]=await Promise.all([
  probe(`${identity}/health/ready`,process.env.MATERIALSX_OD6_IDENTITY_HOST?{Host:process.env.MATERIALSX_OD6_IDENTITY_HOST}:{}),
  probe(`${litellm}/health/readiness`),probe(`${billing}/healthz`),
  process.env.MATERIALSX_METRICS_TOKEN?probe(`${identity}/internal/metrics`,{'X-MX-Metrics-Key':process.env.MATERIALSX_METRICS_TOKEN}):null,
  probe(`${identity}/v1/client-config`,process.env.MATERIALSX_OD6_IDENTITY_HOST?{Host:process.env.MATERIALSX_OD6_IDENTITY_HOST}:{})]);
let metrics=null,catalogRevision=null;
try{if(metricResponse)metrics=await metricResponse.json();if(catalogResponse)catalogRevision=(await catalogResponse.json()).catalogRevision}catch{ /* malformed probe is reported as unavailable */ }
let litellmDatabaseBytes=null;
if(process.env.MATERIALSX_LITELLM_DATABASE_URL){
  try{const u=new URL(process.env.MATERIALSX_LITELLM_DATABASE_URL);if(!['postgres:','postgresql:'].includes(u.protocol))throw Error('invalid');
    const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:u.pathname.slice(1),PGSSLMODE:u.searchParams.get('sslmode')||'verify-full'};
    const result=spawnSync('psql',['-X','-At','-v','ON_ERROR_STOP=1','-c','SELECT pg_database_size(current_database())'],{env,encoding:'utf8',timeout:3000,maxBuffer:1024});
    if(result.status===0&&/^\d+$/.test(result.stdout.trim()))litellmDatabaseBytes=Number(result.stdout.trim());
  }catch{ /* inaccessible database is reported by alert logic */ }
}
const moosOrigin=process.env.MATERIALSX_OD6_MOOS_HEALTH_ORIGIN;
const moosConfigured=!!moosOrigin,moosResponse=moosConfigured?await probe(`${local(moosOrigin,'MOOS')}/v1/research/health`,process.env.MATERIALSX_OD6_MOOS_HOST?{Host:process.env.MATERIALSX_OD6_MOOS_HOST}:{}):null;
let moosFailures=null;try{if(moosResponse)moosFailures=(await moosResponse.json()).moosFailures}catch{}
const moosHealthy=!!moosResponse;
const state={services:{identity:!!ready,litellm:!!proxy,billing:!!finance},metrics,litellmDatabaseConfigured:!!process.env.MATERIALSX_LITELLM_DATABASE_URL,litellmDatabaseBytes,catalogRevision,expectedCatalogRevision:process.env.MATERIALSX_OD6_EXPECTED_CATALOG_REVISION,moosConfigured,moosHealthy,moosFailures};
const alerts=assessOperations(state);
console.log(JSON.stringify({checkedAt:new Date().toISOString(),services:state.services,moos:moosConfigured?moosHealthy?'healthy':'unavailable':'not_configured',moosFailures,catalogRevision,litellmDatabaseBytes,metrics:metrics?{routes:metrics.routes,database:metrics.database}:null,alerts}));
if(alerts.length)process.exitCode=2;
