import assert from 'node:assert/strict';
import test from 'node:test';
import {mx03OpsRoutesSchema} from './mx-v03.js';

test('operations route snapshot accepts approved live sales and preserves strict fields',()=>{
 const snapshot={
  releaseId:'mx-v0.3-approved',releaseStatus:'approved',probeReportedAt:null,
  purchaseVersionId:'purchase-v1',fxVersionId:'fx-v1',retailVersionId:'retail-v1',salesEnabled:true,
  routes:[{slotId:'gpt-5.6-sol',credentialRef:'MX_SUPPLIER_GPT56_KEY',proxyAlias:'mx-gpt-5-6-sol',
   routeVersionId:'route-v1',protocol:'chat-completions',runtimeEnabled:true,
   probeStatus:'not_synchronized',discovery:'not_run',selectedProtocol:'',usageComplete:false,salesEnabled:true}],
 };
 assert.ok(mx03OpsRoutesSchema.safeParse(snapshot).success);
 assert.ok(mx03OpsRoutesSchema.safeParse({...snapshot,releaseStatus:'draft',salesEnabled:false}).success);
 assert.ok(!mx03OpsRoutesSchema.safeParse({...snapshot,releaseStatus:'published'}).success);
 assert.ok(!mx03OpsRoutesSchema.safeParse({...snapshot,secret:'should-not-appear'}).success);
});
