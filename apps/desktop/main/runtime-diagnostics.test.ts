import assert from 'node:assert/strict';
import test from 'node:test';
import { mxPointsDiagnostic } from './runtime-diagnostics.js';

const wallet = { unit:'mx-point', available:'99.5', held:'0', consumed:'0.5', refundFrozen:'0', returned:'0', ledgerCursor:null };
const prices = { versionId:'retail-v1', status:'approved', salesEnabled:true, mxPointsPerCny:'10', fieldOrder:['input','output','cacheRead','cacheCreate'], models:[] };
const capability = { status:'unknown', evidenceId:null };
const catalog = { items:[{ id:'gpt-5.6-sol', providerId:'rootflowai', upstreamModelId:'gpt-5.6-sol', protocol:'responses', enabled:true,
  contextWindow:null, maxOutputTokens:1024, capabilities:{streaming:{status:'verified',evidenceId:'probe-v1'},tools:capability,structuredOutput:capability,cancellation:capability},
  salesPriceVersionId:'retail-v1', verifiedAt:null, accessMode:'mx-points', routeVersionId:'route-v1' }], nextCursor:null,
  alpha:{configured:false,available:false,remainingRequests:0,expiresAt:null,limits:{maxRequests:3,maxOutputTokensPerRequest:1024,maxDurationSeconds:120}} };

test('MX diagnostic reports wallet and usable models without legacy M3 health', async () => {
  const calls:string[]=[];
  const identity = { snapshot:async()=>({status:'connected'}), platformRequest:async(path:string)=>{
    calls.push(path);
    return Response.json(path.endsWith('/wallet')?wallet:path.endsWith('/prices')?prices:catalog);
  } };
  const result=await mxPointsDiagnostic(identity as any);
  assert.equal(result.status,'ready');
  assert.match(result.detail,/99\.5 MX 点/);
  assert.deepEqual(calls.sort(),['/v1/models','/v1/mx-points/prices','/v1/mx-points/wallet']);
});

test('MX diagnostic asks for sign-in instead of reporting removed control plane offline', async () => {
  const result=await mxPointsDiagnostic({snapshot:async()=>({status:'signed_out'}),platformRequest:async()=>{throw Error('must not call');}} as any);
  assert.equal(result.status,'attention');
  assert.match(result.detail,/登录平台账户/);
});
