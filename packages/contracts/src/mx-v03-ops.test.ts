import assert from 'node:assert/strict';
import test from 'node:test';
import {mx03OpsRoutesSchema,mx03UsageRowsSchema} from './mx-v03.js';

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
test('MX usage history accepts reviewed dynamic model IDs without dropping other rows',()=>{
 const row={requestId:'1314bd0b-e2b7-46cd-9a42-964ca8f2fbd6',taskId:'task-1',modelId:'gpt-56-sol-onboarding-test',
  routeVersionId:'mx-model-gpt-56-sol-onboarding-test-v14',retailPriceVersionId:'mx-model-gpt-56-sol-onboarding-test-v14-retail',
  reservedPoints:'37.240832',chargedPoints:'1.86655',state:'settled',
  usage:{inputTokens:10504,outputTokens:27,cacheReadTokens:0,cacheCreateTokens:0},
  usageEvidenceRef:'provider_terminal_usage',createdAt:'2026-10-08T09:44:27+08:00'};
 const parsed=mx03UsageRowsSchema.parse({items:[row,{...row,requestId:'request-2',modelId:'gpt-5.6-sol'}]});
 assert.equal(parsed.items.length,2);
 assert.equal(parsed.items[0]?.modelId,'gpt-56-sol-onboarding-test');
 assert.ok(!mx03UsageRowsSchema.safeParse({items:[{...row,modelId:'invalid/model'}]}).success);
});
