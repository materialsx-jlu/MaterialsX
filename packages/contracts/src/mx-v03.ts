import { z } from "zod";

/** 0.3.0 interface contract. Route verification and sales activation are separate states. */
export const MX03_CONTRACT_VERSION = "mx-v0.3.0-v1";
export const MX03_PAYMENT_CONTRACT_VERSION = "mx-v0.3.3-v1";
export const MX03_PRICE_VERSION = "mx-v0.3-rootflow-svip-20261007-3model-draft";
export const MX03_CNY_FEN_PER_POINT = 10;
export const mx03SlotIds = ["gpt-5.6-sol", "claude-opus-5-5", "claude-fable-5-1"] as const;
export const mx03SlotIdSchema = z.enum(mx03SlotIds);
export type Mx03SlotId = z.infer<typeof mx03SlotIdSchema>;

export const mx03OpsRoutesSchema = z.strictObject({
  releaseId: z.string(),
  releaseStatus: z.enum(["draft", "approved"]),
  probeReportedAt: z.iso.datetime().nullable(),
  purchaseVersionId: z.string(),
  fxVersionId: z.string(),
  retailVersionId: z.string(),
  salesEnabled: z.boolean(),
  routes: z.array(z.strictObject({
    slotId: mx03SlotIdSchema, credentialRef: z.string(), proxyAlias: z.string(),
    routeVersionId: z.string(), protocol: z.string(), runtimeEnabled: z.boolean(),
    probeStatus: z.enum(["not_synchronized", "reported"]), discovery: z.string(),
    selectedProtocol: z.string(), usageComplete: z.boolean(), salesEnabled: z.boolean(),
  })),
});

export const mx03Products = [
  { id: "mx-cny-10-v1", amountFen: 1000, points: 100 },
  { id: "mx-cny-50-v1", amountFen: 5000, points: 500 },
  { id: "mx-cny-100-v1", amountFen: 10000, points: 1000 },
  { id: "mx-cny-500-v1", amountFen: 50000, points: 5000 },
] as const;

export const mx03Routes = [
  { slotId: "gpt-5.6-sol", proxyAlias: "mx-gpt-5-6-sol", credentialRef: "MX_SUPPLIER_GPT56_KEY" },
  { slotId: "claude-opus-5-5", proxyAlias: "mx-claude-opus-5-5", credentialRef: "MX_SUPPLIER_OPUS55_KEY" },
  { slotId: "claude-fable-5-1", proxyAlias: "mx-claude-fable-5-1", credentialRef: "MX_SUPPLIER_FABLE51_KEY" },
] as const;

const decimal = z.string().regex(/^(0|[1-9]\d{0,14})(\.\d{1,6})?$/);
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const dateTime = z.iso.datetime({offset:true});

export const mx03CatalogItemSchema = z.strictObject({
  slotId: mx03SlotIdSchema,
  displayName: z.string().min(1).max(100),
  upstreamModelId: id,
  protocol: z.enum(["responses", "chat-completions"]).nullable(),
  routeVersionId: id.nullable(),
  priceVersionId: id.nullable(),
  status: z.enum(["unverified", "probe-passed", "disabled", "available"]),
  evidenceRef: id.nullable(),
  verifiedAt: dateTime.nullable(),
}).refine(item => item.status !== "available" || Boolean(
  item.protocol && item.routeVersionId && item.priceVersionId && item.evidenceRef && item.verifiedAt),
"available model requires route, price and evidence");

export const mx03WalletSchema = z.strictObject({
  unit: z.literal("mx-point"),
  available: decimal, held: decimal, consumed: decimal,
  refundFrozen: decimal, returned: decimal,
  ledgerCursor: id.nullable(),
});

export const mx03PointProductSchema = z.strictObject({
  id, name: z.string().min(1).max(120), amountFen: z.string().regex(/^[1-9]\d*$/),
  points: decimal, refundPolicyVersion: id, enabled: z.boolean(), testOnly: z.boolean(),
});
export const mx03PointOrderSchema = z.strictObject({
  id, productVersionId: id, amountFen: z.string().regex(/^[1-9]\d*$/), points: decimal,
  channel: z.enum(["test", "wechat"]),
  state: z.enum(["pending", "paid", "closed", "refund_pending", "refunded"]),
  checkoutState: z.enum(["not_started", "submitting", "ready", "unknown"]),
  closeRequested: z.boolean(),
  codeUrl: z.string().nullable(), version: z.number().int().positive(),
  createdAt: dateTime, expiresAt: dateTime, paidAt: dateTime.nullable(),
});
export const mx03PointRefundSchema = z.strictObject({
  id, orderId: id, amountFen: z.string().regex(/^[1-9]\d*$/), points: decimal,
  approval: z.enum(["requested", "approved", "rejected"]),
  execution: z.enum(["not_started", "submitting", "pending", "succeeded", "failed"]),
  version: z.number().int().positive(), policyVersion: id,
});
export const mx03ProductsResponseSchema=z.strictObject({items:z.array(mx03PointProductSchema).max(16),unit:z.literal("mx-point"),salesEnabled:z.boolean(),testMode:z.boolean()});
export const mx03OrdersResponseSchema=z.strictObject({items:z.array(mx03PointOrderSchema).max(100)});
export const mx03RefundsResponseSchema=z.strictObject({items:z.array(mx03PointRefundSchema).max(100)});
export const mx03RetailCatalogSchema=z.strictObject({
  versionId:id,status:z.enum(["draft","approved","withdrawn"]),salesEnabled:z.boolean(),mxPointsPerCny:decimal,
  fieldOrder:z.tuple([z.literal("input"),z.literal("output"),z.literal("cacheRead"),z.literal("cacheCreate")]),
  models:z.array(z.strictObject({id:mx03SlotIdSchema,retailVsOfficialPercentApprox:decimal,
    tiers:z.array(z.strictObject({id,minInputTokens:z.number().int().nonnegative(),mxPointsPer1m:z.tuple([decimal,decimal,decimal,decimal])})).min(1)})).max(3),
});

export const mx03UsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cacheReadTokens: z.number().int().nonnegative().nullable(),
  cacheCreateTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  source: z.enum(["responses", "chat-completions", "supplier-statement"]).nullable(),
}).refine(u => u.inputTokens === null || u.cacheReadTokens === null || u.cacheReadTokens <= u.inputTokens,
"cache read cannot exceed input");

export const mx03ChargeSchema = z.strictObject({
  requestId: id, slotId: mx03SlotIdSchema,
  routeVersionId: id, priceVersionId: id, procurementPriceVersionId: id,
  usage: mx03UsageSchema.nullable(),
  reservedPoints: decimal, chargedPoints: decimal.nullable(),
  state: z.enum(["reserved", "settled", "released", "reconciliation-pending"]),
  usageEvidenceRef: id.nullable(),
}).refine(c => c.state !== "settled" || Boolean(c.usage && c.usage.inputTokens !== null &&
  c.usage.outputTokens !== null && c.chargedPoints !== null && c.usageEvidenceRef),
"settlement requires terminal usage evidence");
export const mx03UsageRowsSchema=z.strictObject({items:z.array(z.strictObject({
  requestId:id,taskId:id.nullable(),modelId:mx03SlotIdSchema,routeVersionId:id,
  retailPriceVersionId:id,reservedPoints:decimal,chargedPoints:decimal.nullable(),
  state:z.enum(["reserved","settled","released","reconciliation_pending"]),usage:z.record(z.string(),z.unknown()).nullable(),
  usageEvidenceRef:id.nullable(),createdAt:dateTime,
})).max(100)});

export const mx03Contracts = {
  catalogItem: mx03CatalogItemSchema,
  wallet: mx03WalletSchema,
  pointProduct: mx03PointProductSchema,
  pointOrder: mx03PointOrderSchema,
  pointRefund: mx03PointRefundSchema,
  usage: mx03UsageSchema,
  charge: mx03ChargeSchema,
} as const;
