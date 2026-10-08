import { z } from "zod";

export const PLATFORM_CONTRACT_VERSION = "m5.6-v1";
const canonicalInteger = /^(0|[1-9]\d{0,18})$/;
export const unsignedInteger = z.string().regex(canonicalInteger)
  .refine((v) => canonicalInteger.test(v) && BigInt(v) <= 9223372036854775807n, "exceeds signed int64");
/** Financial arithmetic uses scaled BigInt; public amounts remain decimal strings. */
export function creditSubunits(value:string):bigint {
 const negative=value.startsWith("-"),[whole,fraction=""]=(negative?value.slice(1):value).split(".");
 const scaled=BigInt(whole!)*10000n+BigInt(fraction.padEnd(4,"0"));return negative?-scaled:scaled;
}
export function creditDisplay(value:bigint):string {
 const sign=value<0n?"-":"",n=value<0n?-value:value,whole=n/10000n,fraction=n%10000n;
 return sign+whole.toString()+(fraction?"."+fraction.toString().padStart(4,"0").replace(/0+$/,""):"");
}
export const creditDecimal=z.string().regex(/^(0|[1-9]\d{0,14})(\.\d{1,4})?$/)
 .refine(v=>/^(0|[1-9]\d{0,14})(\.\d{1,4})?$/.test(v)&&creditSubunits(v)<=9223372036854775807n,"invalid credit precision/range");
export const mxPointDecimal=z.string().regex(/^(0|[1-9]\d{0,12})(\.\d{1,6})?$/);
const mxPointSubunits=(v:string):bigint=>{const [whole,fraction=""]=v.split(".");return BigInt(whole!)*1000000n+BigInt(fraction.padEnd(6,"0"));};
const creditAmount=z.union([unsignedInteger,creditDecimal]);
const signedCreditDecimal=z.string().refine(v=>creditDecimal.safeParse(v.startsWith("-")?v.slice(1):v).success || /^-?(0|[1-9]\d{0,18})$/.test(v)&&BigInt(v)>=-9223372036854775808n&&BigInt(v)<=9223372036854775807n);
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const tokens = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const verifier = z.string().min(43).max(128).regex(/^[A-Za-z0-9._~-]+$/);
export const authStartSchema = z.strictObject({
  deviceName: z.string().min(1).max(100), codeChallenge: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/),
  codeChallengeMethod: z.literal("S256"),
  redirectUri: z.string().regex(/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/auth\/callback$/)
    .refine((v) => { const m = v.match(/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/auth\/callback$/);
      return m !== null && Number(m[1]) <= 65535; }),
});
export const authStartResultSchema = z.strictObject({
  flowId: id, authorizationUrl: z.url(), state: id, expiresAt: z.iso.datetime(),
});
export const authExchangeSchema = z.strictObject({ flowId: id, authorizationCode: z.string().min(1).max(512), codeVerifier: verifier });
export const authRefreshSchema = z.strictObject({ refreshToken: z.string().min(1).max(2048) });
export const authTokensSchema = z.strictObject({
  tokenType: z.literal("Bearer"), accessToken: z.string().min(1).max(4096),
  refreshToken: z.string().min(1).max(2048), expiresIn: z.number().int().positive().max(3600), deviceId: id,
});
export const userSchema = z.strictObject({ id, email: z.email(), displayName: z.string().min(1).max(100),
  role: z.enum(["user", "admin"]), status: z.enum(["active", "suspended"]), version: unsignedInteger });
export const accountSchema = userSchema.extend({ deviceId: id, mfaVerified: z.boolean() });
export const deviceSchema = z.strictObject({ id, name: z.string().min(1).max(100),
  createdAt: z.iso.datetime(), revokedAt: z.iso.datetime().nullable(), current: z.boolean() });
export const revokeSchema = z.strictObject({ revoked: z.literal(true) });
export const adminStatusSchema = z.strictObject({ status: z.enum(["active", "suspended"]),
  reason: z.string().min(1).max(256), expectedVersion: unsignedInteger });
export const adminStatusResultSchema = z.strictObject({ id, status: z.enum(["active", "suspended"]), version: unsignedInteger });
export const auditEventSchema = z.strictObject({ id: unsignedInteger, actorId: id.nullable(), action: z.string(),
  targetId: z.string().nullable(), result: z.string(), reason: z.string(), createdAt: z.iso.datetime() });
export const capabilitySchema = z.strictObject({
  status: z.enum(["unknown", "verified", "unsupported"]),
  evidenceId: id.nullable(),
}).refine((v) => v.status !== "verified" || v.evidenceId !== null, "verified needs evidence");
export const providerSchema = z.strictObject({
  id, name: z.string().min(1), kind: z.enum(["relay", "direct"]),
  status: z.enum(["unconfigured", "unverified", "available", "limited", "failed", "disabled"]),
  documentationUrl: z.url(),
});
export const modelSchema = z.strictObject({
  id, providerId: id, upstreamModelId: z.string().min(2).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]+$/),
  protocol: z.enum(["responses", "chat-completions"]).nullable(),
  enabled: z.boolean(), contextWindow: tokens, maxOutputTokens: tokens,
  capabilities: z.strictObject({ streaming: capabilitySchema, tools: capabilitySchema,
    structuredOutput: capabilitySchema, cancellation: capabilitySchema }),
  salesPriceVersionId: id.nullable(), verifiedAt: z.iso.datetime().nullable(),
  accessMode: z.enum(["paid", "paid-credits", "alpha-test", "test-credits", "alpha-diagnostic", "mx-points"]).optional(), routeVersionId: id.optional(),
}).refine((v) => !v.enabled || (v.protocol !== null && (v.salesPriceVersionId !== null || ["alpha-test", "alpha-diagnostic"].includes(v.accessMode ?? "")) &&
  v.capabilities.streaming.status === "verified" && (["alpha-diagnostic","mx-points"].includes(v.accessMode ?? "") || v.capabilities.tools.status === "verified")),
"enabled cloud model needs protocol, price and streaming/tool evidence");
export const budgetSchema = z.strictObject({
  maxCredits: unsignedInteger.refine((v) => canonicalInteger.test(v) && BigInt(v) > 0n),
  maxRequests: z.number().int().min(1).max(1000),
  maxOutputTokensPerRequest: z.number().int().min(1).max(131072),
  maxDurationSeconds: z.number().int().min(1).max(86400),
});
export const createTaskSchema = z.strictObject({
  clientTaskId: id, modelId: id, budget: budgetSchema,
});
export const taskSchema = createTaskSchema.extend({
  id, state: z.enum(["created", "running", "completed", "cancelled", "interrupted", "failed"]),
  scientificQuality: z.enum(["not_evaluated", "passed", "needs_review"]),
  createdAt: z.iso.datetime(),
});
export const usageSchema = z.strictObject({
  source: z.enum(["responses", "chat-completions"]),
  inputTokens: tokens, outputTokens: tokens, cachedInputTokens: tokens,
  uncachedInputTokens: tokens, reasoningTokens: tokens, cacheCreationTokens: tokens.optional(),
}).refine((v) => v.cachedInputTokens === null || v.inputTokens === null ||
  v.cachedInputTokens <= v.inputTokens, "cache exceeds total input")
  .refine((v) => v.reasoningTokens === null || v.outputTokens === null ||
    v.reasoningTokens <= v.outputTokens, "reasoning exceeds total output")
  .refine((v) => v.uncachedInputTokens === null ||
    (v.inputTokens !== null && v.cachedInputTokens !== null &&
      v.uncachedInputTokens === v.inputTokens - v.cachedInputTokens - (v.cacheCreationTokens??0)), "invalid uncached input");
export const modelRequestSchema = z.strictObject({
  id, taskId: id, modelId: id,
  execution: z.enum(["queued", "running", "completed", "failed", "cancel_requested", "cancelled", "unknown"]),
  settlement: z.enum(["reserved", "settled", "released", "reconciliation_pending"]),
  scientificQuality: z.enum(["not_evaluated", "passed", "needs_review"]),
  usage: usageSchema.nullable(), reservedCredits: unsignedInteger,
  chargedCredits: unsignedInteger.nullable(), salesPriceVersionId: id,
}).refine((v) => v.settlement !== "settled" || (v.usage !== null &&
  v.usage.inputTokens !== null && v.usage.outputTokens !== null && v.chargedCredits !== null),
"settled needs known usage and charge");
export const alphaLimitsSchema = z.strictObject({
  maxRequests: z.number().int().min(0).max(2147483647),
  maxOutputTokensPerRequest: z.number().int().min(1).max(131072),
  maxDurationSeconds: z.number().int().min(1).max(86400),
});
export const cloudConsentSchema = z.strictObject({ policyVersion: z.literal("cloud-alpha-v1"),
  prompt: z.literal(true), history: z.literal("platform-only"),
  fileCount: z.number().int().min(0).max(8), skillCount: z.number().int().min(0).max(8) });
const diagnosticModelId=z.enum(["materials-research","gpt-5.6-sol","gpt-6-sol","claude-opus-5-5","claude-fable-5-1"]);
const cloudTaskFields = { clientTaskId: id, modelId: z.literal("materials-research"), consent: cloudConsentSchema };
const paidLimitsSchema=alphaLimitsSchema.extend({maxCredits:creditDecimal.refine(v=>creditDecimal.safeParse(v).success&&creditSubunits(v)>0n).optional()});
const testLimitsSchema=alphaLimitsSchema.extend({maxCredits:unsignedInteger.refine(v=>canonicalInteger.test(v)&&BigInt(v)>0n).optional()});
export const alphaCreateTaskSchema=z.union([
 z.strictObject({...cloudTaskFields,modelId:diagnosticModelId,billingMode:z.literal("alpha-test"),budget:alphaLimitsSchema}),
 z.strictObject({...cloudTaskFields,billingMode:z.literal("test-credits"),budget:testLimitsSchema}),
 z.strictObject({...cloudTaskFields,billingMode:z.literal("paid-credits"),budget:paidLimitsSchema})
 ,z.strictObject({...cloudTaskFields,modelId:id,billingMode:z.literal("mx-points"),budget:alphaLimitsSchema})
]);
const taskFields={id,state:z.enum(["created","running","completed","cancelled","interrupted","failed"]),scientificQuality:z.literal("not_evaluated"),createdAt:z.iso.datetime(),deadline:z.iso.datetime(),requestCount:z.number().int().nonnegative()};
export const alphaTaskSchema=z.union([
 z.strictObject({...cloudTaskFields,...taskFields,modelId:diagnosticModelId,billingMode:z.literal("alpha-test"),budget:alphaLimitsSchema}),
 z.strictObject({...cloudTaskFields,...taskFields,billingMode:z.literal("test-credits"),budget:testLimitsSchema}),
 z.strictObject({...cloudTaskFields,...taskFields,billingMode:z.literal("paid-credits"),budget:paidLimitsSchema}),
 z.strictObject({...cloudTaskFields,...taskFields,modelId:id,billingMode:z.literal("mx-points"),budget:alphaLimitsSchema})
]);
const requestFields={phase:z.enum(["conversation","extraction","repair","metadata"]).optional(),id,taskId:id,modelId:z.literal("materials-research"),execution:z.enum(["running","completed","failed","cancel_requested","cancelled","unknown"]),scientificQuality:z.literal("not_evaluated"),usage:usageSchema.nullable(),routeVersionId:id,terminalReceived:z.boolean(),errorCode:z.enum(["UPSTREAM_ERROR","STREAM_INTERRUPTED","TASK_BUDGET_EXCEEDED"]).nullable(),dispatched:z.boolean(),cacheDiscountApplied:z.boolean().optional()};
export const alphaRequestSchema=z.union([
 z.strictObject({...requestFields,modelId:diagnosticModelId,billingMode:z.literal("alpha-test"),settlement:z.enum(["not_billed","reconciliation_pending"]),reservedCredits:z.literal("0"),chargedCredits:z.null(),salesPriceVersionId:z.null()}),
 z.strictObject({...requestFields,billingMode:z.literal("test-credits"),settlement:z.enum(["reserved","settled","released","reconciliation_pending"]),reservedCredits:unsignedInteger,chargedCredits:unsignedInteger.nullable(),salesPriceVersionId:id}),
 z.strictObject({...requestFields,billingMode:z.literal("paid-credits"),settlement:z.enum(["reserved","settled","released","reconciliation_pending"]),reservedCredits:creditDecimal,chargedCredits:creditDecimal.nullable(),salesPriceVersionId:id}),
 z.strictObject({...requestFields,modelId:id,billingMode:z.literal("mx-points"),settlement:z.enum(["reserved","settled","released","reconciliation_pending"]),reservedCredits:mxPointDecimal,chargedCredits:mxPointDecimal.nullable(),salesPriceVersionId:id})
]).refine(v=>v.settlement!=="not_billed"||(v.terminalReceived&&v.usage?.inputTokens!=null&&v.usage?.outputTokens!=null),"known usage required")
.refine(v=>v.settlement!=="settled"||(v.chargedCredits!==null&&v.usage?.inputTokens!=null&&v.usage?.outputTokens!=null),"settled requires usage and charge")
.refine(v=>v.billingMode!=="paid-credits"||v.settlement!=="settled"||v.usage?.cachedInputTokens!=null||v.cacheDiscountApplied===true,"paid settlement requires known cached input or explicit customer discount")
.refine(v=>v.settlement!=="released"||v.chargedCredits==="0","released must charge zero")
.refine(v=>v.chargedCredits===null||(v.billingMode==="mx-points"?mxPointSubunits(v.chargedCredits)<=mxPointSubunits(v.reservedCredits):creditSubunits(v.chargedCredits)<=creditSubunits(v.reservedCredits)),"charge exceeds reservation");
export const testPriceSchema=z.strictObject({id,modelId:z.literal("materials-research"),routeVersionId:id,testOnly:z.literal(true),unit:z.literal("test-credit"),tiers:z.array(z.strictObject({minInputTokens:z.number().int().nonnegative(),inputPerMillion:unsignedInteger,cachedInputPerMillion:unsignedInteger,outputPerMillion:unsignedInteger})).min(1).max(16),inputOverheadTokens:z.number().int().nonnegative(),maxInputTokens:z.number().int().positive(),inputPolicy:z.literal("utf8-byte-test-estimate-v1"),evidenceRef:z.string().min(1).max(256)});
export const paidPriceSchema=testPriceSchema.extend({testOnly:z.literal(false),unit:z.literal("paid-credit"),inputPolicy:z.literal("paid-pilot-ceiling-v1")});
export const paidWalletSchema=z.strictObject({unit:z.literal("paid-credit"),availableCredits:creditDecimal,heldCredits:creditDecimal,consumedCredits:creditDecimal,refundFrozenCredits:creditDecimal,returnedCredits:creditDecimal});
export const walletSchema=z.strictObject({unit:z.literal("test-credit"),availableCredits:unsignedInteger,heldCredits:unsignedInteger,consumedCredits:unsignedInteger,refundFrozenCredits:unsignedInteger,returnedCredits:unsignedInteger,pendingRequests:z.number().int().nonnegative(),dailyLimit:unsignedInteger.nullable(),monthlyLimit:unsignedInteger.nullable(),purchased:paidWalletSchema.optional()});
export const creditEntrySchema=z.strictObject({unit:z.enum(["test-credit","paid-credit"]).default("test-credit"),id:unsignedInteger,requestId:id.nullable(),kind:z.enum(["grant","reserve","settle","release","pending","waiver","refund_freeze","refund_release","refund"]),grantId:id,grantedDelta:signedCreditDecimal,heldDelta:signedCreditDecimal,consumedDelta:signedCreditDecimal,frozenDelta:signedCreditDecimal,returnedDelta:signedCreditDecimal,createdAt:z.iso.datetime()});
export const creditLedgerSchema=z.strictObject({items:z.array(creditEntrySchema).max(100),nextCursor:unsignedInteger.nullable()});
export type CreditWallet=z.infer<typeof walletSchema>;
export type PlatformCreditEntry=z.infer<typeof creditEntrySchema>;
export const cloudCatalogSchema = z.strictObject({testPricing:testPriceSchema.nullable().optional(),paidPricing:paidPriceSchema.nullable().optional(), items: z.array(modelSchema).max(100), nextCursor: z.null(),
  alpha: z.strictObject({ configured: z.boolean(), available: z.boolean(), remainingRequests: z.number().int().nonnegative(),
    expiresAt: z.iso.datetime().nullable(), limits: alphaLimitsSchema }) });
export type CloudCatalog = z.infer<typeof cloudCatalogSchema>;
export type AlphaTask = z.infer<typeof alphaTaskSchema>;
export type AlphaRequest = z.infer<typeof alphaRequestSchema>;
export const errorCodes = ["UNAUTHENTICATED", "FORBIDDEN", "VALIDATION_ERROR", "MODEL_UNVERIFIED",
  "RELEASE_GATES_NOT_SATISFIED", "PUBLIC_RELEASE_UNVERIFIED", "MODEL_UNAVAILABLE", "INSUFFICIENT_CREDITS", "TASK_BUDGET_EXCEEDED", "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED", "UPSTREAM_ERROR", "STREAM_INTERRUPTED", "USAGE_PENDING", "PRICE_UNVERIFIED",
  "NOT_FOUND", "OPERATION_CONFLICT"] as const;
export const apiErrorSchema = z.strictObject({
  error: z.strictObject({ code: z.enum(errorCodes), message: z.string().max(512),
    requestId: id, retryable: z.boolean(), dispatched: z.literal(false).optional(), retryAfterSeconds: z.number().int().positive().optional() }),
});
export const entitlementSchema = z.strictObject({
  planId: id, state: z.enum(["active", "suspended", "expired", "none"]),
  cloudEnabled: z.boolean(), grantedCredits: unsignedInteger, usedCredits: unsignedInteger,
  reservedCredits: unsignedInteger, availableCredits: unsignedInteger,
  periodEnd: z.iso.datetime().nullable(),
});
export const planSchema=z.strictObject({id,name:z.string().min(1).max(120),kind:z.enum(["pack","subscription"]),currency:z.literal("CNY"),priceFen:unsignedInteger,credits:unsignedInteger,validDays:z.number().int().min(1).max(366),refundPolicyVersion:id,refundRule:z.enum(["unused-proportional-v1","unused-full-v1"]),testOnly:z.boolean(),dailyLimit:unsignedInteger,monthlyLimit:unsignedInteger,requestLimit:z.number().int().min(1).max(10000)});
export const paymentPlansSchema=z.strictObject({items:z.array(planSchema).max(100),mode:z.enum(["disabled","test","wechat-native","wechat-pilot","wechat-mx-live"]),formalSalesEnabled:z.boolean()}).refine(v=>!v.formalSalesEnabled||v.mode==="wechat-native");
export const createOrderSchema=z.strictObject({productVersionId:id,channel:z.enum(["test","wechat"])});
export const orderSchema=z.strictObject({id,product:planSchema,amountFen:unsignedInteger,currency:z.literal("CNY"),channel:z.enum(["test","wechat"]),state:z.enum(["pending","paid","closed","refund_pending","partially_refunded","refunded"]),closeRequested:z.boolean(),checkoutState:z.enum(["not_started","submitting","ready","unknown"]),codeUrl:z.string().max(2048).nullable(),refundedFen:unsignedInteger,version:z.number().int().positive(),createdAt:z.iso.datetime(),expiresAt:z.iso.datetime(),paidAt:z.iso.datetime().nullable()});
export const paymentOrdersSchema=z.strictObject({items:z.array(orderSchema).max(50),nextCursor:id.nullable()});
export const refundInputSchema=z.strictObject({amountFen:unsignedInteger.refine(v=>canonicalInteger.test(v)&&BigInt(v)>0n),reason:z.string().trim().min(1).max(256)});
export const paymentRefundSchema=z.strictObject({id,orderId:id,amountFen:unsignedInteger,reason:z.string().max(256),approval:z.enum(["requested","reviewing","approved","rejected","canceled"]),execution:z.enum(["not_started","submitting","pending","succeeded","failed"]),frozenCredits:unsignedInteger,version:z.number().int().positive(),createdAt:z.iso.datetime()});
export const paymentRefundsSchema=z.strictObject({items:z.array(paymentRefundSchema).max(100)});
export const subscriptionPeriodSchema=z.strictObject({orderId:id,productId:id,startsAt:z.iso.datetime(),endsAt:z.iso.datetime(),state:z.enum(["pending","active","suspended","expired","canceled"])});
export const subscriptionPeriodsSchema=z.strictObject({items:z.array(subscriptionPeriodSchema).max(100)});
export const refundPreviewSchema=z.strictObject({refund:paymentRefundSchema,orderVersion:z.number().int().positive(),eligible:z.boolean(),recoverCredits:unsignedInteger,availableCredits:creditAmount,heldCredits:creditAmount,explanation:z.string()});
export const refundDecisionSchema=z.strictObject({decision:z.enum(["review","approve","reject"]),reason:z.string().trim().min(1).max(256),expectedVersion:z.number().int().positive(),orderVersion:z.number().int().positive()});
export type PaymentOrder=z.infer<typeof orderSchema>;
export type PaymentRefund=z.infer<typeof paymentRefundSchema>;
export type PaymentPlans=z.infer<typeof paymentPlansSchema>;
export type SubscriptionPeriod=z.infer<typeof subscriptionPeriodSchema>;
// Native provider body remains native; task/request IDs travel in gateway headers.
export const gatewayHeadersSchema = z.strictObject({
  "x-materialsx-task-id": id, "x-materialsx-request-id": id, "idempotency-key": id,
});
export const responsesRequestSchema = z.strictObject({
  model: id, input: z.union([z.string().min(1).max(1_000_000), z.array(z.record(z.string(), z.unknown())).min(1).max(200)]),
  stream: z.literal(true), max_output_tokens: z.number().int().positive().max(131072),
  store: z.literal(false).optional(),
  include: z.array(z.literal("reasoning.encrypted_content")).max(1).optional(),
  tools: z.array(z.record(z.string(), z.unknown())).max(64).optional(),
  tool_choice: z.union([z.enum(["auto", "none", "required"]), z.strictObject({
    type: z.literal("function"), name: id,
  })]).optional(),
});
export const chatRequestSchema = z.strictObject({
  model: id, messages: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
  stream: z.literal(true), max_completion_tokens: z.number().int().positive().max(131072),
  tools: z.array(z.record(z.string(), z.unknown())).max(64).optional(),
});
export const reconciliationEvidenceSchema=z.strictObject({requestId:id,expectedVersion:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),resolution:z.enum(["usage","no-call","waiver"]),sourceRef:id,reason:z.string().min(1).max(256),usage:usageSchema.nullable()}).refine(v=>(v.resolution==="usage")===(v.usage!==null),"usage resolution requires usage only");
export const pendingBillingSchema=z.strictObject({items:z.array(z.strictObject({requestId:id,accountId:id,taskId:id,unit:z.enum(["test-credit","paid-credit"]).default("test-credit"),reservedCredits:creditAmount,version:z.number().int().positive(),reason:z.string(),jobStatus:z.enum(["pending","scheduled","manual"]),createdAt:z.iso.datetime(),alertedAt:z.iso.datetime().nullable(),manualAt:z.iso.datetime().nullable(),purchasePriceVersionId:id.nullable()})).max(100)});
export const billingOverviewSchema=z.strictObject({requests:z.number().int().nonnegative(),pendingRequests:z.number().int().nonnegative(),procurementUnknownRequests:z.number().int().nonnegative(),knownProcurementFen:unsignedInteger,paidChargedCredits:creditDecimal.default("0"),paidHeldCredits:creditDecimal.default("0"),formalSalesEnabled:z.boolean()});
export const reconciliationPreviewSchema=z.strictObject({requestId:id,version:z.number().int().positive(),unit:z.enum(["test-credit","paid-credit"]).default("test-credit"),reservedCredits:creditAmount,chargedCredits:creditAmount,releaseCredits:creditAmount,purchaseCostFen:unsignedInteger.nullable(),salesPriceVersionId:id,resolution:z.enum(["usage","no-call","waiver"])});
export const workspaceControlsSchema=z.strictObject({cloudPaused:z.boolean(),salesPaused:z.boolean(),announcementZh:z.string().max(1000),announcementEn:z.string().max(1000),version:unsignedInteger});
export const workspaceStatusSchema=z.strictObject({controls:workspaceControlsSchema,gatewayConfigured:z.boolean(),gatewayHealth:z.literal('not_measured'),protocol:z.literal('responses'),routeVersionId:id,modelId:z.literal('materials-research'),upstreamModelId:z.literal('gpt-5.6-sol'),providerId:z.literal('rootflowai'),paymentMode:z.enum(['disabled','test','wechat-native','wechat-pilot','wechat-mx-live']),formalSalesEnabled:z.boolean(),limits:alphaLimitsSchema});
export const taskBillSchema=z.strictObject({id,state:z.enum(['created','running','completed','cancelled','interrupted','failed']),billingMode:z.enum(['alpha-test','test-credits','paid-credits']),scientificQuality:z.literal('not_evaluated'),createdAt:z.iso.datetime(),requestCount:z.number().int().nonnegative(),pendingRequests:z.number().int().nonnegative(),heldCredits:creditAmount,chargedCredits:creditAmount,inputTokens:unsignedInteger.nullable(),outputTokens:unsignedInteger.nullable(),salesPriceVersionId:id.nullable()});
export const taskBillsSchema=z.strictObject({items:z.array(taskBillSchema).max(50),nextCursor:id.nullable()});
export const taskRequestsSchema=z.strictObject({items:z.array(alphaRequestSchema),nextCursor:z.null()});
export const releaseAssetSchema=z.strictObject({os:z.enum(['macos','windows']),arch:z.enum(['arm64','x64']),name:z.string().regex(/^[A-Za-z0-9_.-]{1,160}$/),sizeBytes:unsignedInteger,sha256:z.string().regex(/^[0-9a-f]{64}$/),downloadUrl:z.url(),signature:z.enum(['verified','unsigned'])});
export const releaseManifestSchema=z.strictObject({id:z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/),channel:z.enum(['stable','beta']),tag:id,commit:z.string().regex(/^[0-9a-f]{40}$/),sourceUrl:z.url(),minimumProtocol:z.enum(['m5.5-v1','m5.5-v2','m5.6-v1']),databaseMigration:z.enum(['005_workspace_ops.sql','007_paid_consumption.sql','010_email_serialization.sql']),notesZh:z.string().min(1).max(12000),notesEn:z.string().min(1).max(12000),skillsSha256:z.string().regex(/^[0-9a-f]{64}$/),modelsSha256:z.string().regex(/^[0-9a-f]{64}$/),assets:z.array(releaseAssetSchema).min(1).max(4)});
export const releaseSchema=z.strictObject({manifest:releaseManifestSchema,state:z.enum(['draft','published','withdrawn']),version:unsignedInteger,createdAt:z.iso.datetime(),verifiedAt:z.iso.datetime().nullable()});
export const releasesSchema=z.strictObject({items:z.array(releaseSchema).max(100)});
export const releaseMutationSchema=z.strictObject({action:z.enum(['draft','publish','withdraw']),manifest:releaseManifestSchema.nullable(),id:z.string().max(128),expectedVersion:unsignedInteger,reason:z.string().trim().min(1).max(256)});
export const releaseResultSchema=z.strictObject({id:z.string(),state:z.enum(['draft','published','withdrawn']),version:unsignedInteger});
export const opsUsersSchema=z.strictObject({items:z.array(userSchema).max(50),nextCursor:id.nullable()});
export const opsAuditSchema=z.strictObject({items:z.array(auditEventSchema).max(100),nextCursor:unsignedInteger.nullable()});
export const opsControlsInputSchema=workspaceControlsSchema.extend({reason:z.string().trim().min(1).max(256)});
export type WorkspaceStatus=z.infer<typeof workspaceStatusSchema>;
export type WorkspaceControls=z.infer<typeof workspaceControlsSchema>;
export type TaskBill=z.infer<typeof taskBillSchema>;
export type ReleaseManifest=z.infer<typeof releaseManifestSchema>;
export type ReleaseEntry=z.infer<typeof releaseSchema>;

export const billingActivitySchema=z.strictObject({items:z.array(z.strictObject({day:z.iso.date(),requests:z.number().int().nonnegative(),pendingRequests:z.number().int().nonnegative(),paidChargedCredits:creditDecimal.default("0"),chargedCredits:unsignedInteger,inputTokens:unsignedInteger.nullable(),outputTokens:unsignedInteger.nullable()})).length(7),timezone:z.literal("UTC")});
export const opsFinanceSchema=z.strictObject({items:z.array(z.strictObject({accountId:id,order:orderSchema,refunds:z.array(paymentRefundSchema),evidence:z.array(z.strictObject({id,source:z.string(),state:z.string(),transactionId:z.string(),providerRefundId:z.string(),totalFen:unsignedInteger,refundFen:unsignedInteger})),jobs:z.array(z.strictObject({id,kind:z.string(),state:z.string(),attempts:z.number().int(),availableAt:z.iso.datetime(),lastError:z.string()}))})).max(100),mode:z.enum(['disabled','test','wechat-native','wechat-pilot','wechat-mx-live']),formalSalesEnabled:z.boolean(),cashInFen:unsignedInteger,cashRefundedFen:unsignedInteger,syntheticInFen:unsignedInteger,syntheticRefundedFen:unsignedInteger,netCashFen:z.string().regex(/^-?(0|[1-9][0-9]{0,18})$/),pendingJobs:z.number().int(),manualJobs:z.number().int(),alertedJobs:z.number().int(),limitedToLatest:z.literal(100)});

export const platformSchemas = { OpsFinance:opsFinanceSchema, BillingActivity:billingActivitySchema, WorkspaceStatus:workspaceStatusSchema,WorkspaceControls:workspaceControlsSchema,OpsControlsInput:opsControlsInputSchema,TaskBill:taskBillSchema,TaskBills:taskBillsSchema,TaskRequests:taskRequestsSchema,ReleaseManifest:releaseManifestSchema,Releases:releasesSchema,ReleaseMutation:releaseMutationSchema,ReleaseResult:releaseResultSchema,OpsUsers:opsUsersSchema,OpsAudit:opsAuditSchema, PaymentPlans:paymentPlansSchema,PaymentOrders:paymentOrdersSchema,PaymentRefund:paymentRefundSchema,PaymentRefunds:paymentRefundsSchema,RefundInput:refundInputSchema,SubscriptionPeriods:subscriptionPeriodsSchema,RefundPreview:refundPreviewSchema,RefundDecision:refundDecisionSchema, ReconciliationPreview:reconciliationPreviewSchema,ReconciliationEvidence:reconciliationEvidenceSchema,PendingBilling:pendingBillingSchema,BillingOverview:billingOverviewSchema,VerifyLedger:z.strictObject({verified:z.literal(true),grants:z.number().int().nonnegative()}),Wallet:walletSchema, CreditLedger:creditLedgerSchema, TestPrice:testPriceSchema,PaidPrice:paidPriceSchema, AlphaLimits: alphaLimitsSchema, CloudConsent: cloudConsentSchema,
  AlphaCreateTask: alphaCreateTaskSchema, AlphaTask: alphaTaskSchema, AlphaRequest: alphaRequestSchema, CloudCatalog: cloudCatalogSchema,
  FinishTask: z.strictObject({state:z.enum(["completed","cancelled","failed","interrupted"])}), Provider: providerSchema, Model: modelSchema, Budget: budgetSchema,
  AuthStart: authStartSchema, AuthStartResult: authStartResultSchema, AuthExchange: authExchangeSchema,
  AuthRefresh: authRefreshSchema, AuthTokens: authTokensSchema, User: userSchema, Account: accountSchema, Device: deviceSchema,
  RevokeResult: revokeSchema, AdminStatus: adminStatusSchema, AdminStatusResult: adminStatusResultSchema, AuditEvent: auditEventSchema,
  CreateTask: createTaskSchema, Task: taskSchema, Usage: usageSchema, ModelRequest: modelRequestSchema,
  Error: apiErrorSchema, Entitlements: entitlementSchema, Plan: planSchema,
  CreateOrder: createOrderSchema, Order: orderSchema, GatewayHeaders: gatewayHeadersSchema,
  ResponsesRequest: responsesRequestSchema, ChatRequest: chatRequestSchema };
export type PlatformModel = z.infer<typeof modelSchema>;
export type PlatformTask = z.infer<typeof taskSchema>;
export type PlatformModelRequest = z.infer<typeof modelRequestSchema>;
