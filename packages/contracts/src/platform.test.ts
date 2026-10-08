import assert from "node:assert/strict";
import { test } from "node:test";
import { authStartSchema, createTaskSchema, modelRequestSchema, providerSchema, unsignedInteger, usageSchema } from "./platform.js";

test("wire amounts preserve int64 and reject number, overflow and leading zero", () => {
  assert.equal(unsignedInteger.parse("9223372036854775807"), "9223372036854775807");
  for (const v of [1, "-1", "01", "9223372036854775808", "", "abc", "1.5"]) assert.equal(unsignedInteger.safeParse(v).success, false);
});
test("desktop auth callback and PKCE cannot be replaced by arbitrary redirects", () => {
  const a = { deviceName: "fixture", codeChallenge: "A".repeat(43), codeChallengeMethod: "S256",
    redirectUri: "http://127.0.0.1:49152/auth/callback" };
  assert.ok(authStartSchema.safeParse(a).success);
  for (const redirectUri of ["https://evil.example/auth/callback", "http://127.0.0.1:99999/auth/callback", "http://127.0.0.1:80/auth/callback?next=evil"]) {
    assert.equal(authStartSchema.safeParse({ ...a, redirectUri }).success, false);
  }
});
test("public provider contract rejects credential injection", () => {
  assert.equal(providerSchema.safeParse({ id: "rootflowai", name: "RootFlowAI", kind: "relay",
    status: "unverified", documentationUrl: "https://rootflowai.com/docs", apiKey: "must-not-cross" }).success, false);
});
test("task contract does not accept client account or authoritative charge", () => {
  const task = { clientTaskId: "task-1", modelId: "mx-gpt-5.6", budget: {
    maxCredits: "100", maxRequests: 5, maxOutputTokensPerRequest: 512, maxDurationSeconds: 120 } };
  assert.ok(createTaskSchema.safeParse(task).success);
  assert.equal(createTaskSchema.safeParse({ ...task, accountId: "another-user" }).success, false);
  assert.equal(createTaskSchema.safeParse({ ...task, budget: { ...task.budget, maxCredits: "0" } }).success, false);
});
test("usage rejects overlapping impossible counts and preserves unknown", () => {
  const u = { source: "responses", inputTokens: 10, outputTokens: 5, cachedInputTokens: null,
    uncachedInputTokens: null, reasoningTokens: null };
  assert.ok(usageSchema.safeParse(u).success);
  assert.equal(usageSchema.safeParse({ ...u, cachedInputTokens: 11 }).success, false);
  assert.equal(usageSchema.safeParse({ ...u, reasoningTokens: 6 }).success, false);
  assert.equal(usageSchema.safeParse({ ...u, cachedInputTokens: 2, uncachedInputTokens: 10 }).success, false);
});
test("request cannot declare settled without actual usage", () => {
  const r = { id: "r", taskId: "t", modelId: "mx-gpt-5.6", execution: "completed", settlement: "reconciliation_pending",
    scientificQuality: "needs_review", usage: null, reservedCredits: "100", chargedCredits: null, salesPriceVersionId: "p" };
  assert.ok(modelRequestSchema.safeParse(r).success);
  assert.equal(modelRequestSchema.safeParse({ ...r, settlement: "settled" }).success, false);
});

test("alpha access cannot pretend to be paid settlement or invent unknown usage",async()=>{
 const {alphaCreateTaskSchema,alphaRequestSchema}=await import("./platform.js");
 const create={clientTaskId:"fixture",modelId:"materials-research",billingMode:"alpha-test",budget:{maxRequests:2,maxOutputTokensPerRequest:256,maxDurationSeconds:30},consent:{policyVersion:"cloud-alpha-v1",prompt:true,history:"platform-only",fileCount:1,skillCount:0}};
 assert.ok(alphaCreateTaskSchema.safeParse(create).success);
 assert.ok(!alphaCreateTaskSchema.safeParse({...create,budget:{...create.budget,maxCredits:"100"}}).success);
 const record={id:"fixture",taskId:"task",modelId:"materials-research",billingMode:"alpha-test",execution:"unknown",settlement:"reconciliation_pending",scientificQuality:"not_evaluated",usage:null,reservedCredits:"0",chargedCredits:null,salesPriceVersionId:null,routeVersionId:"fixture-v1",terminalReceived:false,errorCode:"STREAM_INTERRUPTED",dispatched:true};
 assert.ok(alphaRequestSchema.safeParse(record).success);
 assert.ok(!alphaRequestSchema.safeParse({...record,settlement:"not_billed"}).success);
 assert.ok(!alphaRequestSchema.safeParse({...record,chargedCredits:"0"}).success);
});

test("payment contracts exclude client money authority and require exact fen",async()=>{
 const {createOrderSchema,refundInputSchema,paymentPlansSchema}=await import("./platform.js");
 assert.ok(createOrderSchema.safeParse({productVersionId:"fixture",channel:"test"}).success);
 assert.ok(createOrderSchema.safeParse({productVersionId:"fixture",channel:"wechat"}).success);
  assert.ok(!createOrderSchema.safeParse({productVersionId:"fixture",channel:"wechat",amountFen:"100"}).success);
 assert.ok(!createOrderSchema.safeParse({productVersionId:"fixture",channel:"test",amountFen:"1"}).success);
 assert.ok(!refundInputSchema.safeParse({amountFen:1,reason:"refund"}).success);
 assert.ok(!refundInputSchema.safeParse({amountFen:"0",reason:"refund"}).success);
 assert.ok(!paymentPlansSchema.safeParse({items:[],mode:"test",formalSalesEnabled:true}).success);
});

test('operations accepts the live MX payment mode without loosening finance fields',async()=>{
 const {paymentPlansSchema,opsFinanceSchema}=await import('./platform.js');
 assert.ok(paymentPlansSchema.safeParse({items:[],mode:'wechat-mx-live',formalSalesEnabled:false}).success);
 const finance={items:[],mode:'wechat-mx-live',formalSalesEnabled:false,cashInFen:'0',cashRefundedFen:'0',syntheticInFen:'0',syntheticRefundedFen:'0',netCashFen:'0',pendingJobs:0,manualJobs:0,alertedJobs:0,limitedToLatest:100};
 assert.ok(opsFinanceSchema.safeParse(finance).success);
 assert.ok(!opsFinanceSchema.safeParse({...finance,mode:'unknown'}).success);
 assert.ok(!opsFinanceSchema.safeParse({...finance,cashInFen:'1.5'}).success);
});

test('workspace bills preserve unknown totals and cannot expose research or supplier secrets',async()=>{
 const {taskBillsSchema,workspaceStatusSchema}=await import('./platform.js');
 const bill={id:'fixture',state:'completed',billingMode:'test-credits',scientificQuality:'not_evaluated',createdAt:'2026-10-01T00:00:00Z',requestCount:2,pendingRequests:1,heldCredits:'100',chargedCredits:'14',inputTokens:null,outputTokens:null,salesPriceVersionId:'test-price'};
 assert.ok(taskBillsSchema.safeParse({items:[bill],nextCursor:null}).success);
 for(const changes of [{prompt:'private research'},{procurementCostFen:'123'},{inputTokens:10},{heldCredits:100}])assert.equal(taskBillsSchema.safeParse({items:[{...bill,...changes}],nextCursor:null}).success,false);
 const status={controls:{cloudPaused:true,salesPaused:false,announcementZh:'',announcementEn:'',version:'1'},gatewayConfigured:true,gatewayHealth:'not_measured',protocol:'responses',routeVersionId:'fixture',modelId:'materials-research',upstreamModelId:'gpt-5.6-sol',providerId:'rootflowai',paymentMode:'disabled',formalSalesEnabled:false,limits:{maxRequests:3,maxOutputTokensPerRequest:256,maxDurationSeconds:60}};
 assert.ok(workspaceStatusSchema.safeParse(status).success);
 assert.ok(workspaceStatusSchema.safeParse({...status,paymentMode:'wechat-mx-live'}).success);
 assert.ok(!workspaceStatusSchema.safeParse({...status,apiKey:'not-a-real-key'}).success);
 assert.ok(!workspaceStatusSchema.safeParse({...status,gatewayHealth:'healthy'}).success);
});

test('paid amounts keep four decimal precision and reject test/paid denomination crossover', async()=>{
 const {creditDecimal,creditSubunits,creditDisplay,paidWalletSchema,alphaCreateTaskSchema,alphaRequestSchema}=await import('./platform.js');
 assert.equal(creditSubunits('0.0001'),1n);assert.equal(creditSubunits('-141.312'),-1413120n);assert.equal(creditDisplay(creditSubunits('1000')-1n),'999.9999');
 for(const value of ['0.00001','01','-1','1e3','922337203685477.5808'])assert.equal(creditDecimal.safeParse(value).success,false);
 const task={clientTaskId:'t',modelId:'materials-research',billingMode:'paid-credits',budget:{maxCredits:'500.0001',maxRequests:3,maxOutputTokensPerRequest:1024,maxDurationSeconds:120},consent:{policyVersion:'cloud-alpha-v1',prompt:true,history:'platform-only',fileCount:0,skillCount:0}};
 assert.ok(alphaCreateTaskSchema.safeParse(task).success);assert.equal(alphaCreateTaskSchema.safeParse({...task,billingMode:'test-credits'}).success,false);
 assert.ok(alphaCreateTaskSchema.safeParse({...task,budget:{maxRequests:0,maxOutputTokensPerRequest:1024,maxDurationSeconds:120}}).success);
 assert.ok(paidWalletSchema.safeParse({unit:'paid-credit',availableCredits:'999.9999',heldCredits:'0',consumedCredits:'0.0001',refundFrozenCredits:'0',returnedCredits:'0'}).success);
 const request={id:'r',taskId:'t',modelId:'materials-research',billingMode:'paid-credits',execution:'completed',settlement:'settled',scientificQuality:'not_evaluated',usage:{source:'responses',inputTokens:1,cachedInputTokens:1,uncachedInputTokens:0,outputTokens:0,reasoningTokens:0},routeVersionId:'v',terminalReceived:true,errorCode:null,dispatched:true,salesPriceVersionId:'p',reservedCredits:'141.312',chargedCredits:'0.0001'};
 assert.ok(alphaRequestSchema.safeParse(request).success);assert.equal(alphaRequestSchema.safeParse({...request,chargedCredits:'141.3121'}).success,false);assert.equal(alphaRequestSchema.safeParse({...request,billingMode:'test-credits'}).success,false);
 const missingCache={...request,usage:{...request.usage,cachedInputTokens:null,uncachedInputTokens:null},chargedCredits:'0.0001'};
 assert.equal(alphaRequestSchema.safeParse(missingCache).success,false);
 assert.equal(alphaRequestSchema.safeParse({...missingCache,cacheDiscountApplied:true}).success,true);
});

test('MX diagnostic model is unbilled and its unknown tools cannot imply paid readiness',async()=>{
 const {modelSchema,alphaCreateTaskSchema}=await import('./platform.js');
 const capability={status:'unknown',evidenceId:null};
 const model={id:'claude-opus-5-5',providerId:'rootflowai-via-litellm',upstreamModelId:'claude-opus-5-5',protocol:'responses',enabled:true,contextWindow:null,maxOutputTokens:1024,
  capabilities:{streaming:{status:'verified',evidenceId:'stream-evidence'},tools:capability,structuredOutput:capability,cancellation:capability},salesPriceVersionId:null,verifiedAt:null,accessMode:'alpha-diagnostic',routeVersionId:'route-v1'};
 assert.ok(modelSchema.safeParse(model).success);
 assert.equal(modelSchema.safeParse({...model,accessMode:'paid-credits'}).success,false);
 const task={clientTaskId:'diagnostic-task',modelId:model.id,billingMode:'alpha-test',budget:{maxRequests:2,maxOutputTokensPerRequest:1024,maxDurationSeconds:60},consent:{policyVersion:'cloud-alpha-v1',prompt:true,history:'platform-only',fileCount:0,skillCount:0}};
 assert.ok(alphaCreateTaskSchema.safeParse(task).success);
 assert.equal(alphaCreateTaskSchema.safeParse({...task,billingMode:'paid-credits'}).success,false);
});
