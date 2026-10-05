import { z } from "zod";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PLATFORM_CONTRACT_VERSION, platformSchemas } from "../packages/contracts/src/platform.js";

import {lifecycleSchemas} from "../packages/contracts/src/lifecycle.js";

const schemas: Record<string, unknown> = Object.fromEntries(Object.entries({...platformSchemas,...lifecycleSchemas}).map(([name, schema]) =>
  [name, z.toJSONSchema(schema, { target: "draft-2020-12" })]));
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: string) => ({ "application/json": { schema: ref(name) } });
function op(name: string, response: string, request?: string, list = false) {
  if (list) schemas[`${response}Page`] = { type: "object", additionalProperties: false,
    required: ["items", "nextCursor"], properties: { items: { type: "array", maxItems: 200, items: ref(response) },
      nextCursor: { anyOf: [{ type: "string", maxLength: 512 }, { type: "null" }] } } };
  return { operationId: name, security: [{ platformBearer: [] }],
    ...(!list && ((request !== undefined && !["startDesktopAuth", "exchangeDesktopAuth", "refreshAuth"].includes(name)) || ["cancelModelRequest","cancelTask"].includes(name)) ? {
      parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 1, maxLength: 128 } }],
    } : {}),
    ...(list ? { parameters: [{ name: "cursor", in: "query", schema: { type: "string", maxLength: 512 } },
      { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } }] } : {}),
    ...(request ? { requestBody: { required: true, content: json(request) } } : {}),
    responses: { "200": { description: "Success", content: { "application/json": { schema:
      ref(list ? `${response}Page` : response) } } },
      default: { description: "Typed error; see HTTP status mapping", content: json("Error") } } };
}
schemas.Accepted={type:"object",additionalProperties:false,required:["accepted"],properties:{accepted:{const:true}}};
const resourcePath = { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", maxLength: 128 } }] };
function opsOperation(name:string,response:string,request?:string,key=false){
 const base=op(name,response,request);
 return {...base,security:[{operationsCookie:[]}],"x-required-role":"admin-MFA",parameters:request?[{name:"Origin",in:"header",required:true,schema:{type:"string"}},{name:"X-CSRF-Token",in:"header",required:true,schema:{type:"string",minLength:43,maxLength:43}},...(key?[{name:"Idempotency-Key",in:"header",required:true,schema:{type:"string",minLength:1,maxLength:128}}]:[])]:[]};
}
schemas.ImportResult={type:"object",additionalProperties:false,required:["imported"],properties:{imported:{const:true}}};
schemas.AttachmentText={type:"object",additionalProperties:false,required:["text"],properties:{text:{type:"string",maxLength:32768}}};
schemas.AlertAcknowledgement={type:"object",additionalProperties:false,required:["reason"],properties:{reason:{type:"string",minLength:1,maxLength:256}}};
schemas.AlertAcknowledged={type:"object",additionalProperties:false,required:["acknowledged"],properties:{acknowledged:{const:true}}};
schemas.BetaEnrollmentInput={type:"object",additionalProperties:false,required:["state","reason","expectedVersion"],properties:{state:{enum:["active","revoked"]},reason:{type:"string",minLength:1,maxLength:256},expectedVersion:{type:"string",pattern:"^[0-9]+$"}}};
schemas.BetaEnrolled={type:"object",additionalProperties:false,required:["enrolled"],properties:{enrolled:{const:true}}};
const paths = {
 "/v1/support/tickets":{get:op("listSupportTickets","Tickets"),post:op("createSupportTicket","Ticket","NewTicket")},
 "/v1/support/tickets/{id}/reply":{...resourcePath,post:op("replySupportTicket","Ticket","TicketReply")},
 "/v1/support/tickets/{id}/attachments":{...resourcePath,post:op("attachSupportText","Attachment","AttachmentInput")},
 "/v1/support/attachments/{id}":{...resourcePath,get:op("readSupportAttachment","AttachmentText")},
 "/ops/api/support":{get:opsOperation("opsSupportTickets","Tickets")},
 "/ops/api/support/{id}/reply":{...resourcePath,post:opsOperation("opsReplySupport","Ticket","TicketReply",true)},
 "/ops/api/support/attachments/{id}":{...resourcePath,get:opsOperation("opsSupportAttachment","AttachmentText")},
 "/ops/api/procurement":{get:opsOperation("opsProcurement","ProcurementCosts"),post:opsOperation("opsImportProcurement","ImportResult","StatementInput",true)},
 "/ops/api/alerts":{get:opsOperation("opsAlerts","Alerts")},
 "/ops/api/alerts/{id}/acknowledge":{...resourcePath,post:opsOperation("opsAcknowledgeAlert","AlertAcknowledged","AlertAcknowledgement",true)},
 "/ops/api/readiness":{get:opsOperation("opsBetaReadiness","BetaReadiness")},
 "/ops/api/beta":{get:opsOperation("opsBetaEnrollments","BetaEnrollments")},
 "/ops/api/beta/{id}":{...resourcePath,post:opsOperation("opsBetaEnroll","BetaEnrolled","BetaEnrollmentInput",true)},
  "/v1/workspace/status":{get:op("getWorkspaceStatus","WorkspaceStatus")},
 "/v1/billing/tasks":{get:op("getTaskBills","TaskBills")},
 "/v1/billing/activity":{get:op("getBillingActivity","BillingActivity")},
 "/v1/billing/tasks/export":{get:{operationId:"exportTaskBills",security:[{platformBearer:[]}],parameters:[{name:"cursor",in:"query",schema:{type:"string",maxLength:128}}],responses:{"200":{description:"Owned metadata CSV, up to 50 tasks. X-Next-Cursor; unknown tokens are 'unknown'. No prompts, files or procurement costs.",content:{"text/csv":{schema:{type:"string"}}}},default:{description:"Typed error",content:json("Error")}}}},
 "/v1/releases":{get:{...op("getPublicReleases","Releases"),security:[]}},
 "/ops/api/users":{get:opsOperation("opsUsers","OpsUsers")},
 "/ops/api/users/{id}/status":{...resourcePath,post:opsOperation("opsUserStatus","AdminStatusResult","AdminStatus",true)},
 "/ops/api/audit":{get:opsOperation("opsAudit","OpsAudit")},
 "/ops/api/controls":{get:opsOperation("opsControls","WorkspaceStatus"),post:opsOperation("opsSetControls","WorkspaceControls","OpsControlsInput",true)},
 "/ops/api/releases":{get:opsOperation("opsReleases","Releases"),post:opsOperation("opsReleaseMutation","ReleaseResult","ReleaseMutation",true)},
 "/ops/api/finance":{get:opsOperation("opsFinance","OpsFinance")},
  "/v1/auth/desktop/start": { post: { ...op("startDesktopAuth", "AuthStartResult", "AuthStart"), security: [] } },
  "/v1/auth/desktop/exchange": { post: { ...op("exchangeDesktopAuth", "AuthTokens", "AuthExchange"), security: [] } },
  "/v1/auth/refresh": { post: { ...op("refreshAuth", "AuthTokens", "AuthRefresh"), security: [] } },
  "/v1/me": { get: op("getCurrentAccount", "Account") },
  "/v1/devices": { get: op("listDevices", "Device", undefined, true) },
  "/v1/devices/{id}/revoke": { ...resourcePath, post: op("revokeDevice", "RevokeResult") },
  "/v1/auth/logout": { post: op("logoutCurrentDevice", "RevokeResult") },
  "/v1/admin/users": { get: op("adminListUsers", "User", undefined, true) },
  "/v1/admin/users/{id}/status": { ...resourcePath, post: op("adminSetAccountStatus", "AdminStatusResult", "AdminStatus") },
  "/v1/admin/audit-events": { get: op("adminListAuditEvents", "AuditEvent", undefined, true) },
  "/v1/providers": { get: op("listProviders", "Provider", undefined, true) },
  "/v1/models": { get: op("listModels", "CloudCatalog") },
  "/v1/entitlements": { get: op("getEntitlements", "Entitlements") },
  "/v1/tasks/{id}": { ...resourcePath, get: op("getTask", "AlphaTask") },
  "/v1/tasks/{id}/finish": { ...resourcePath, post: op("finishTask", "AlphaTask", "FinishTask") },
  "/v1/tasks/{id}/cancel": { ...resourcePath, post: op("cancelTask", "AlphaTask") },
  "/v1/tasks/{id}/requests": { ...resourcePath, get: { ...op("listTaskRequests", "AlphaRequest", undefined, true), parameters: [] } },
  "/v1/tasks": { post: op("createTask", "AlphaTask", "AlphaCreateTask") },
  "/v1/billing/wallet":{get:op("getCreditWallet","Wallet")},
  "/v1/billing/ledger":{get:{...op("getCreditLedger","CreditLedger"),parameters:[{name:"cursor",in:"query",schema:{type:"string",pattern:"^[0-9]{1,19}$"}}]}},
  "/v1/admin/billing/pending":{get:op("adminPendingBilling","PendingBilling")},
  "/v1/admin/billing/overview":{get:op("adminBillingOverview","BillingOverview")},
  "/v1/admin/billing/verify":{get:op("adminVerifyLedger","VerifyLedger")},
  "/v1/admin/billing/preview":{post:{...op("adminPreviewReconciliation","ReconciliationPreview","ReconciliationEvidence"),parameters:[]}},
  "/v1/admin/billing/reconcile":{post:op("adminReconcileBilling","AlphaRequest","ReconciliationEvidence")},
  "/v1/billing/plans": { get: op("listPlans", "PaymentPlans") },
  "/v1/billing/orders": { get:op("listOrders","PaymentOrders"),post: op("createOrder", "Order", "CreateOrder") },
  "/v1/billing/orders/{id}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], get: op("getOrder", "Order") },
  "/v1/billing/orders/{id}/query": {...resourcePath,post:op("queryPaymentOrder","Order")},
  "/v1/billing/orders/{id}/close": {...resourcePath,post:op("closePaymentOrder","Order")},
  "/v1/billing/orders/{id}/refunds": {...resourcePath,get:op("listOrderRefunds","PaymentRefunds"),post:op("requestRefund","PaymentRefund","RefundInput")},
  "/v1/billing/subscriptions": {get:op("listSubscriptionPeriods","SubscriptionPeriods")},
  "/v1/billing/export": {get:{operationId:"exportOrdersPage",security:[{platformBearer:[]}],parameters:[{name:"cursor",in:"query",schema:{type:"string",maxLength:128}}],responses:{"200":{description:"Owned page, max 50 orders. X-Next-Cursor when more pages. CSV formula defense; no credentials or payer data.",content:{"text/csv":{schema:{type:"string"}}}},default:{description:"Typed error",content:json("Error")}}}},
  "/v1/admin/refunds/{id}/preview": {...resourcePath,post:{...op("previewRefund","RefundPreview"),parameters:[],"x-required-role":"admin-MFA"}},
  "/v1/admin/refunds/{id}/decision": {...resourcePath,post:{...op("decideRefund","Accepted","RefundDecision"),"x-required-role":"admin-MFA"}},
  "/v1/payments/wechat/notify": {post:{operationId:"wechatNotification",security:[],description:"APIv3 signature + AES-GCM + timestamp verified; durable event idempotency; only payment success. Refunds use verified query worker.",responses:{"204":{description:"Transaction committed"},default:{description:"Rejected; channel retries",content:json("Error")}}}},
  "/v1/model-requests/{id}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], get: op("getModelRequest", "AlphaRequest") },
  "/v1/model-requests/{id}/cancel": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], post: op("cancelModelRequest", "AlphaRequest") },
  ...Object.fromEntries([["responses", "ResponsesRequest"], ["chat/completions", "ChatRequest"]].map(([path, schema]) => [
    `/v1/model-gateway/${path}`, { post: { ...op(`gateway-${path}`, "ModelRequest", schema),
      parameters: ["x-materialsx-task-id", "x-materialsx-request-id", "idempotency-key"].map((name) =>
        ({ name, in: "header", required: true, schema: { type: "string", maxLength: 128 } })),
      responses: { "200": { description: "Native protocol SSE; lifecycle and settlement queried separately",
        content: { "text/event-stream": { schema: { type: "string" } } } },
        default: { description: "Typed error before stream starts", content: json("Error") } } } }])),
};
for (const [path, operations] of Object.entries(paths)) {
  Object.assign(operations, {"x-implementation-status": /^\/(?:v1\/support|ops\/api\/(?:support|procurement|alerts|readiness|beta))(?:\/|$)/.test(path)?"implemented-M5.6-lifecycle-general-sales-gated": /^(\/ops\/|\/v1\/(workspace|releases|billing\/(tasks|activity))(\/|$))/.test(path)?"implemented-M5.5-workspace-operations": /^\/v1\/(billing\/(plans|orders|subscriptions|export)|admin\/refunds|payments\/wechat)(\/|$)/.test(path)?"implemented-M5.4-test-business-live-sales-gated": /^\/v1\/(billing\/(wallet|ledger)|admin\/billing)(\/|$)/.test(path)?"implemented-M5.3-test-credits": /^\/v1\/(auth|me|devices|admin)(\/|$)/.test(path) ? "implemented-M5.1" : /^\/v1\/(providers|models|tasks|model-requests)(\/|$)/.test(path) || path === "/v1/model-gateway/responses" ? "implemented-M5.2-alpha" : "planned"});
}
const doc = { openapi: "3.1.0", info: { title: "MaterialsX M5 core contract (M5.1 identity, M5.2 gateway and M5.3 ledger and M5.4 test business, M5.5 desktop and operations, M5.6 lifecycle engineering implemented; production Beta gated)", version: PLATFORM_CONTRACT_VERSION },
  "x-implementation-status": "identity-gateway-ledger-test-payments-implemented-live-sales-gated", paths,
  "x-runtime-invariants": "Zod cross-field refinements and Go authorization/ledger rules supplement JSON Schema; see contracts.md",
  components: { securitySchemes: { operationsCookie:{type:"apiKey",in:"cookie",name:"mx_ops",description:"HttpOnly Secure SameSite=Strict admin MFA session. Writes additionally require exact Origin + X-CSRF-Token."}, platformBearer: { type: "http", scheme: "bearer", description: "MaterialsX token; never a supplier API key" } }, schemas } };
const target = "docs/m5/openapi.json";
const contents = `${JSON.stringify(doc, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (await readFile(target, "utf8") !== contents) throw new Error("M5 contract drift; run npm run m5:contracts");
  console.log("M5 contract artifact matches executable schemas");
} else {
  await mkdir("docs/m5", { recursive: true });
  await writeFile(target, contents);
  console.log(`Generated ${target}; identity, gateway, separate test/paid credit ledgers, paid pilot, test-business and workspace/operations implemented; general sales gated`);
}
